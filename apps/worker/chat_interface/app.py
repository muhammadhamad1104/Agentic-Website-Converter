from __future__ import annotations

from pathlib import Path
import re
import sys
from typing import Any

import gradio as gr

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.engine.service import ConversionEngine
from src.engine.observability import configure_langsmith
from src.config.settings import settings


URL_REGEX = re.compile(r"https?://[^\s]+", re.IGNORECASE)
QUOTED_ZIP_REGEX = re.compile(r"[\"']([^\"']+\.zip)[\"']", re.IGNORECASE)
ZIP_TOKEN_REGEX = re.compile(
    r"([A-Za-z]:\\[^\s\"']+\.zip|/[^\s\"']+\.zip|(?:\./|\.\\)?[^\s\"']+\.zip)",
    re.IGNORECASE,
)
GENERIC_NAMES = {
    "a",
    "div",
    "span",
    "img",
    "link",
    "meta",
    "title",
    "container",
    "row",
    "col",
    "btn",
    "nav",
    "li",
    "ul",
}

engine = ConversionEngine()
configure_langsmith()


def _find_first_source(text: str) -> str | None:
    message = str(text or "")
    url_match = URL_REGEX.search(message)
    if url_match:
        return url_match.group(0).strip()

    quoted_zip_match = QUOTED_ZIP_REGEX.search(message)
    if quoted_zip_match:
        return quoted_zip_match.group(1).strip()

    zip_match = ZIP_TOKEN_REGEX.search(message)
    if zip_match:
        return zip_match.group(1).strip().strip('"').strip("'")

    return None


def _format_step_summary(step: dict[str, Any]) -> str:
    status = step.get("status", "unknown")
    entities = step.get("schema_proposal", {}).get("entities", [])
    endpoints = step.get("generated_artifacts", {}).get("backend", {}).get("endpoints", [])
    validation_gate = step.get("validation_report", {}).get("validation_gate", "n/a")

    return (
        f"- Status: {status}\n"
        f"- Entity count: {len(entities)}\n"
        f"- Sample entities: {', '.join([e.get('name', '') for e in entities[:8]]) or 'None'}\n"
        f"- Backend endpoints: {', '.join(endpoints[:8]) or 'None'}\n"
        f"- Validation gate: {validation_gate}"
    )


def _semantic_quality(entities: list[dict[str, Any]]) -> tuple[float, int]:
    names = [str(entity.get("name", "")).strip() for entity in entities if str(entity.get("name", "")).strip()]
    if not names:
        return 0.0, 0
    generic = sum(1 for name in names if re.sub(r"[^a-zA-Z0-9]+", "", name).lower() in GENERIC_NAMES)
    ratio = max(0.0, (len(names) - generic) / len(names))
    return ratio, generic


def run_conversion_for_source(source: str) -> tuple[str, str | None]:
    crawl_cfg = {
        "depth_limit": settings.CRAWL_DEPTH_LIMIT_DEFAULT,
        "max_pages": settings.CRAWL_MAX_PAGES_DEFAULT,
        "max_assets": settings.CRAWL_MAX_ASSETS_DEFAULT,
        "same_domain_only": settings.CRAWL_SAME_DOMAIN_ONLY_DEFAULT,
        "follow_asset_domains": settings.CRAWL_FOLLOW_ASSET_DOMAINS_DEFAULT,
        "request_timeout_seconds": settings.CRAWL_REQUEST_TIMEOUT_SECONDS,
        "request_retries": settings.CRAWL_REQUEST_RETRIES,
        "verify_tls": settings.CRAWL_VERIFY_TLS_DEFAULT,
        "enforce_static_source": settings.CRAWL_ENFORCE_STATIC_SOURCE_DEFAULT,
        "resume_from_checkpoint": settings.CRAWL_RESUME_FROM_CHECKPOINT_DEFAULT,
        "include_sitemap_seeds": settings.CRAWL_INCLUDE_SITEMAP_SEEDS_DEFAULT,
        "render_js": settings.CRAWL_RENDER_JS_DEFAULT,
        "render_wait_seconds": settings.CRAWL_RENDER_WAIT_SECONDS,
        "render_headless": settings.CRAWL_RENDER_HEADLESS,
    }

    created = engine.create_job(input_url=source, crawl_config=crawl_cfg)
    job_id = created["job_id"]

    step1 = engine.run_job(job_id)
    if step1.get("status") == "failed":
        return (
            f"I could not complete conversion for {source}.\n\n"
            f"Job ID: {job_id}\n"
            f"Errors: {step1.get('errors', [])}"
        ), None

    entities = step1.get("schema_proposal", {}).get("entities", [])
    semantic_ratio, generic_count = _semantic_quality(entities)

    if semantic_ratio < 0.45:
        return (
            f"Conversion paused for {source} because inferred schema quality is too generic.\n\n"
            f"Job ID: {job_id}\n"
            f"Step 1 summary:\n{_format_step_summary(step1)}\n"
            f"- Semantic ratio: {semantic_ratio:.2f}\n"
            f"- Generic entity count: {generic_count}\n\n"
            "Reason: this usually happens when model quota is unavailable and heuristic inference dominates HTML utility classes.\n"
            "Action: add a working LLM key/quota (OpenAI or Gemini), then retry the same URL."
        ), None

    if step1.get("status") == "awaiting_approval":
        engine.decide_schema(job_id, "approved")

    step2 = engine.run_job(job_id)
    if step2.get("status") != "validated":
        return (
            f"Conversion did not reach validated state for {source}.\n\n"
            f"Job ID: {job_id}\n"
            f"Step summary:\n{_format_step_summary(step2)}\n"
            f"Errors: {step2.get('errors', [])}"
        ), None

    try:
        manifest = engine.export_job(job_id)
        export_status = manifest.get("export_status", "unknown")
        schema_versions = len(manifest.get("schema_versions", []))
        artifact_versions = len(manifest.get("artifact_versions", []))
        download_info = manifest.get("download", {})
        download_zip = download_info.get("downloads_path") or download_info.get("zip_path")
        downloads_copy = download_info.get("downloads_copy", {}) if isinstance(download_info, dict) else {}
        if bool(downloads_copy.get("copied")):
            download_copy_status = f"Copied to Downloads: {downloads_copy.get('path', '')}"
        elif bool(downloads_copy.get("attempted")):
            download_copy_status = f"Downloads copy not available: {downloads_copy.get('error', 'unknown error')}"
        else:
            download_copy_status = "Downloads copy disabled"
    except Exception as exc:
        export_status = f"blocked ({exc})"
        schema_versions = 0
        artifact_versions = 0
        download_zip = None
        download_copy_status = "Downloads copy not attempted"

    return (
        f"Conversion completed for {source}.\n\n"
        f"Job ID: {job_id}\n"
        f"Step 1 summary:\n{_format_step_summary(step1)}\n\n"
        f"Step 2 summary:\n{_format_step_summary(step2)}\n\n"
        f"Semantic ratio: {semantic_ratio:.2f}\n"
        f"Export status: {export_status}\n"
        f"Schema versions: {schema_versions}\n"
        f"Artifact versions: {artifact_versions}\n"
        f"{download_copy_status}\n"
        f"Download zip: {download_zip or 'Not available'}"
    ), download_zip


def chat_handler(message: str, history: list[dict[str, str]]) -> str:
    source = _find_first_source(message)
    if not source:
        return (
            "Send either a static website URL or a static-site ZIP path/URL and I will run conversion.\n"
            "Examples:\n"
            "- https://getbootstrap.com/docs/5.0/examples/album/\n"
            "- C:\\sites\\my-static-site.zip"
        )

    try:
        text, _ = run_conversion_for_source(source)
        return text
    except Exception as exc:
        return f"Unexpected error while processing {source}: {exc}"


def convert_with_download(source: str) -> tuple[str, str | None]:
    if not source.strip():
        return "Please provide a static website URL or static-site ZIP path/URL.", None
    return run_conversion_for_source(source.strip())


def build_ui() -> gr.Blocks:
    with gr.Blocks() as demo:
        gr.Markdown(
            "# Agentic Static-to-Dynamic Converter\n"
            "ChatGPT-style interface: paste a static website link and get conversion results."
        )

        with gr.Row():
            with gr.Column(scale=2):
                single_url = gr.Textbox(
                    label="Single Source Conversion (Static URL or ZIP)",
                    placeholder="https://example.com or C:\\sites\\my-static-site.zip",
                )
                convert_btn = gr.Button("Convert and Build Downloadable Package")
                single_output = gr.Markdown()
            with gr.Column(scale=1):
                download_file = gr.File(label="Download Generated Dynamic Website (.zip)")

        convert_btn.click(
            fn=convert_with_download,
            inputs=[single_url],
            outputs=[single_output, download_file],
        )

        gr.Markdown("---")

        gr.ChatInterface(
            fn=chat_handler,
            title="Conversion Assistant",
            description=(
                "Paste one source per message (static website URL or static-site ZIP). "
                "I will validate source type, crawl/extract, infer schema, generate artifacts, validate, and export."
            ),
            examples=[
                "https://getbootstrap.com/docs/5.0/examples/album/",
                "https://example.com",
                "C:\\sites\\my-static-site.zip",
            ],
        )

    return demo


if __name__ == "__main__":
    app = build_ui()
    app.launch(server_name="127.0.0.1", server_port=7860, share=False, inbrowser=False)
