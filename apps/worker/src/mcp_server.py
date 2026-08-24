from __future__ import annotations

import importlib
from typing import Any

try:
    FastMCP = getattr(importlib.import_module("fastmcp"), "FastMCP")
except ModuleNotFoundError:
    class FastMCP:  # type: ignore[override]
        def __init__(self, name: str) -> None:
            self.name = name

        def tool(self, name: str | None = None):
            def _decorator(func):
                return func

            return _decorator

        def run(self) -> None:
            raise RuntimeError("fastmcp is not installed. Install dependencies from requirements.txt")

from src.engine.service import ConversionEngine
from src.engine.observability import configure_langsmith
from src.config.settings import settings

configure_langsmith()

mcp = FastMCP("agentic-static-to-dynamic-converter")
engine = ConversionEngine()


def create_conversion_job_impl(
    input_url: str = "",
    html_pages: list[str] | None = None,
    depth_limit: int = settings.CRAWL_DEPTH_LIMIT_DEFAULT,
    max_pages: int = settings.CRAWL_MAX_PAGES_DEFAULT,
    max_assets: int = settings.CRAWL_MAX_ASSETS_DEFAULT,
    same_domain_only: bool = settings.CRAWL_SAME_DOMAIN_ONLY_DEFAULT,
    follow_asset_domains: bool = settings.CRAWL_FOLLOW_ASSET_DOMAINS_DEFAULT,
    request_timeout_seconds: int = settings.CRAWL_REQUEST_TIMEOUT_SECONDS,
    request_retries: int = settings.CRAWL_REQUEST_RETRIES,
    verify_tls: bool = settings.CRAWL_VERIFY_TLS_DEFAULT,
    enforce_static_source: bool = settings.CRAWL_ENFORCE_STATIC_SOURCE_DEFAULT,
    resume_from_checkpoint: bool = settings.CRAWL_RESUME_FROM_CHECKPOINT_DEFAULT,
    include_sitemap_seeds: bool = settings.CRAWL_INCLUDE_SITEMAP_SEEDS_DEFAULT,
    render_js: bool = settings.CRAWL_RENDER_JS_DEFAULT,
    render_wait_seconds: int = settings.CRAWL_RENDER_WAIT_SECONDS,
    render_headless: bool = settings.CRAWL_RENDER_HEADLESS,
) -> dict[str, Any]:
    """Create a conversion job from URL and/or raw HTML pages."""
    crawl_config = {
        "depth_limit": depth_limit,
        "max_pages": max_pages,
        "max_assets": max_assets,
        "same_domain_only": same_domain_only,
        "follow_asset_domains": follow_asset_domains,
        "request_timeout_seconds": request_timeout_seconds,
        "request_retries": request_retries,
        "verify_tls": verify_tls,
        "enforce_static_source": enforce_static_source,
        "resume_from_checkpoint": resume_from_checkpoint,
        "include_sitemap_seeds": include_sitemap_seeds,
        "render_js": render_js,
        "render_wait_seconds": render_wait_seconds,
        "render_headless": render_headless,
    }
    return engine.create_job(input_url=input_url or None, html_pages=html_pages, crawl_config=crawl_config)


def run_conversion_impl(job_id: str) -> dict[str, Any]:
    """Run the LangGraph conversion flow until validation or approval hold."""
    return engine.run_job(job_id)


def submit_schema_decision_impl(job_id: str, decision: str) -> dict[str, Any]:
    """Human gate: approve/reject/pending for inferred schema."""
    return engine.decide_schema(job_id, decision)


def get_conversion_job_impl(job_id: str) -> dict[str, Any]:
    """Retrieve the latest state of a conversion job."""
    return engine.get_job(job_id)


def get_schema_history_impl(job_id: str) -> dict[str, Any]:
    return {
        "job_id": job_id,
        "schema_versions": engine.get_schema_history(job_id),
    }


def get_artifact_history_impl(job_id: str) -> dict[str, Any]:
    return {
        "job_id": job_id,
        "artifact_versions": engine.get_artifact_history(job_id),
    }


def get_trace_events_impl(
    job_id: str,
    node: str | None = None,
    limit: int | None = None,
    from_timestamp: int | None = None,
) -> dict[str, Any]:
    return {
        "job_id": job_id,
        "trace_events": engine.get_trace_events(
            job_id=job_id,
            node=node,
            limit=limit,
            from_timestamp=from_timestamp,
        ),
    }


def get_crawl_report_impl(job_id: str) -> dict[str, Any]:
    return engine.get_crawl_report(job_id)


def export_conversion_impl(job_id: str) -> dict[str, Any]:
    return engine.export_job(job_id)


@mcp.tool(name="create_conversion_job")
def create_conversion_job(
    input_url: str = "",
    html_pages: list[str] | None = None,
    depth_limit: int = settings.CRAWL_DEPTH_LIMIT_DEFAULT,
    max_pages: int = settings.CRAWL_MAX_PAGES_DEFAULT,
    max_assets: int = settings.CRAWL_MAX_ASSETS_DEFAULT,
    same_domain_only: bool = settings.CRAWL_SAME_DOMAIN_ONLY_DEFAULT,
    follow_asset_domains: bool = settings.CRAWL_FOLLOW_ASSET_DOMAINS_DEFAULT,
    request_timeout_seconds: int = settings.CRAWL_REQUEST_TIMEOUT_SECONDS,
    request_retries: int = settings.CRAWL_REQUEST_RETRIES,
    verify_tls: bool = settings.CRAWL_VERIFY_TLS_DEFAULT,
    enforce_static_source: bool = settings.CRAWL_ENFORCE_STATIC_SOURCE_DEFAULT,
    resume_from_checkpoint: bool = settings.CRAWL_RESUME_FROM_CHECKPOINT_DEFAULT,
    include_sitemap_seeds: bool = settings.CRAWL_INCLUDE_SITEMAP_SEEDS_DEFAULT,
    render_js: bool = settings.CRAWL_RENDER_JS_DEFAULT,
    render_wait_seconds: int = settings.CRAWL_RENDER_WAIT_SECONDS,
    render_headless: bool = settings.CRAWL_RENDER_HEADLESS,
) -> dict[str, Any]:
    return create_conversion_job_impl(
        input_url=input_url,
        html_pages=html_pages,
        depth_limit=depth_limit,
        max_pages=max_pages,
        max_assets=max_assets,
        same_domain_only=same_domain_only,
        follow_asset_domains=follow_asset_domains,
        request_timeout_seconds=request_timeout_seconds,
        request_retries=request_retries,
        verify_tls=verify_tls,
        enforce_static_source=enforce_static_source,
        resume_from_checkpoint=resume_from_checkpoint,
        include_sitemap_seeds=include_sitemap_seeds,
        render_js=render_js,
        render_wait_seconds=render_wait_seconds,
        render_headless=render_headless,
    )


@mcp.tool(name="run_conversion")
def run_conversion(job_id: str) -> dict[str, Any]:
    return run_conversion_impl(job_id)


@mcp.tool(name="submit_schema_decision")
def submit_schema_decision(job_id: str, decision: str) -> dict[str, Any]:
    return submit_schema_decision_impl(job_id, decision)


@mcp.tool(name="get_conversion_job")
def get_conversion_job(job_id: str) -> dict[str, Any]:
    return get_conversion_job_impl(job_id)


@mcp.tool(name="get_schema_history")
def get_schema_history(job_id: str) -> dict[str, Any]:
    return get_schema_history_impl(job_id)


@mcp.tool(name="get_artifact_history")
def get_artifact_history(job_id: str) -> dict[str, Any]:
    return get_artifact_history_impl(job_id)


@mcp.tool(name="get_trace_events")
def get_trace_events(
    job_id: str,
    node: str | None = None,
    limit: int | None = None,
    from_timestamp: int | None = None,
) -> dict[str, Any]:
    return get_trace_events_impl(
        job_id=job_id,
        node=node,
        limit=limit,
        from_timestamp=from_timestamp,
    )


@mcp.tool(name="get_crawl_report")
def get_crawl_report(job_id: str) -> dict[str, Any]:
    return get_crawl_report_impl(job_id)


@mcp.tool(name="export_conversion")
def export_conversion(job_id: str) -> dict[str, Any]:
    return export_conversion_impl(job_id)


if __name__ == "__main__":
    mcp.run()
