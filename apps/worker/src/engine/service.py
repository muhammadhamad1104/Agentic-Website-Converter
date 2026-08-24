from __future__ import annotations

import logging
import importlib
import shutil
import time
import zipfile
from pathlib import Path
from typing import Any

from src.config.settings import settings
from src.engine.failover_llm import FailoverLLM, LangChainChatAdapter
from src.engine.job_store import InMemoryJobStore, SqliteJobStore
from src.engine.models import JobStatus
from src.engine.nodes import infer_schema_node
from src.engine.observability import configure_langsmith, traced
from src.engine.package_builder import RUNTIME_REQUIRED_FILES, build_dynamic_site_package
from src.engine.state import ConversionState
from src.engine.workflow import build_conversion_workflow


class _UnavailableLLM:
    def __init__(self, reason: str) -> None:
        self._reason = reason

    def invoke(self, prompt: str) -> str:
        raise RuntimeError(self._reason)


class ConversionEngine:
    """Pure agentic engine: stateful conversion workflow + approval gate."""

    @traced("engine.init")
    def __init__(self, store: InMemoryJobStore | None = None) -> None:
        configure_langsmith()
        if store is not None:
            self.store = store
        else:
            try:
                self.store = SqliteJobStore(settings.JOB_STORE_PATH)
            except Exception:
                self.store = InMemoryJobStore()
        self._llm = self._build_failover_llm()
        self.workflow = build_conversion_workflow(
            infer_node=lambda state: infer_schema_node(state, llm=self._llm),
            llm=self._llm,
        )

    @traced("engine.build_failover_llm")
    def _build_failover_llm(self) -> FailoverLLM:
        models = []

        # Priority 1: Kimi (Moonshot)
        if getattr(settings, "KIMI_API_KEY", None):
            try:
                ChatOpenAI = getattr(importlib.import_module("langchain_openai"), "ChatOpenAI")
                kimi = ChatOpenAI(
                    model=getattr(settings, "KIMI_MODEL", "moonshot-v1-8k"),
                    api_key=settings.KIMI_API_KEY,
                    base_url="https://api.moonshot.ai/v1",
                    temperature=0.0,
                    max_tokens=100000
                )
                models.append(LangChainChatAdapter(kimi))
            except Exception:
                pass

        # Priority 2: DeepSeek
        if getattr(settings, "DEEPSEEK_API_KEY", None):
            try:
                ChatOpenAI = getattr(importlib.import_module("langchain_openai"), "ChatOpenAI")
                deepseek = ChatOpenAI(
                    model=getattr(settings, "DEEPSEEK_MODEL", "deepseek-chat"),
                    api_key=settings.DEEPSEEK_API_KEY,
                    base_url="https://api.deepseek.com/v1",
                    temperature=0.0,
                    max_tokens=100000
                )
                models.append(LangChainChatAdapter(deepseek))
            except Exception:
                pass

        # Priority 3: OpenAI
        if getattr(settings, "OPENAI_API_KEY", None):
            try:
                ChatOpenAI = getattr(importlib.import_module("langchain_openai"), "ChatOpenAI")
                openai = ChatOpenAI(
                    model=getattr(settings, "OPENAI_MODEL", "gpt-4o-mini"), 
                    api_key=settings.OPENAI_API_KEY, 
                    temperature=0.0,
                    max_tokens=100000
                )
                models.append(LangChainChatAdapter(openai))
            except Exception:
                pass

        # Priority 4: Groq
        if getattr(settings, "GROQ_API_KEY", None):
            try:
                ChatGroq = getattr(importlib.import_module("langchain_groq"), "ChatGroq")
                groq = ChatGroq(
                    model=getattr(settings, "GROQ_MODEL", "llama-3.3-70b-versatile"), 
                    api_key=settings.GROQ_API_KEY, 
                    temperature=0.0,
                    max_tokens=100000
                )
                models.append(LangChainChatAdapter(groq))
            except Exception:
                pass

        # Priority 5: Gemini
        if getattr(settings, "GEMINI_API_KEY", None):
            try:
                ChatGoogleGenerativeAI = getattr(
                    importlib.import_module("langchain_google_genai"),
                    "ChatGoogleGenerativeAI",
                )
                gemini = ChatGoogleGenerativeAI(
                    model=getattr(settings, "GEMINI_MODEL", "gemini-3.6-flash"),
                    google_api_key=settings.GEMINI_API_KEY,
                    temperature=0.0,
                    max_tokens=100000
                )
                models.append(LangChainChatAdapter(gemini))
            except Exception:
                pass

        # Priority 6: Open Source
        if getattr(settings, "OPEN_SOURCE_API_KEY", None) and getattr(settings, "OPEN_SOURCE_BASE_URL", None):
            try:
                ChatOpenAI = getattr(importlib.import_module("langchain_openai"), "ChatOpenAI")
                opensource = ChatOpenAI(
                    model=getattr(settings, "OPEN_SOURCE_MODEL", "default-model"),
                    api_key=settings.OPEN_SOURCE_API_KEY,
                    base_url=settings.OPEN_SOURCE_BASE_URL,
                    temperature=0.0,
                    max_tokens=100000
                )
                models.append(LangChainChatAdapter(opensource))
            except Exception:
                pass

        # Priority 7: Anthropic
        if getattr(settings, "ANTHROPIC_API_KEY", None):
            try:
                ChatAnthropic = getattr(importlib.import_module("langchain_anthropic"), "ChatAnthropic")
                anthropic = ChatAnthropic(
                    model="claude-3-5-sonnet-20240620", 
                    api_key=settings.ANTHROPIC_API_KEY, 
                    temperature=0.0,
                    max_tokens=100000
                )
                models.append(LangChainChatAdapter(anthropic))
            except Exception:
                pass

        if not models:
            models.append(_UnavailableLLM("No LLM providers available: missing API keys or dependencies"))

        return FailoverLLM(models=models)

    def _default_crawl_config(self) -> dict[str, Any]:
        return {
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

    def _normalize_crawl_config(self, crawl_config: dict[str, Any] | None) -> dict[str, Any]:
        config = self._default_crawl_config()
        incoming = crawl_config or {}
        for key in config:
            value = incoming.get(key)
            if value is not None:
                config[key] = value

        config["depth_limit"] = max(0, int(config["depth_limit"] or 0))
        config["max_pages"] = max(0, int(config["max_pages"] or 0))
        config["max_assets"] = max(0, int(config["max_assets"] or 0))
        config["same_domain_only"] = bool(config["same_domain_only"])
        config["follow_asset_domains"] = bool(config["follow_asset_domains"])
        config["request_timeout_seconds"] = max(3, int(config["request_timeout_seconds"] or 3))
        config["request_retries"] = max(1, int(config["request_retries"] or 1))
        config["verify_tls"] = bool(config["verify_tls"])
        config["enforce_static_source"] = bool(config["enforce_static_source"])
        config["resume_from_checkpoint"] = bool(config["resume_from_checkpoint"])
        config["include_sitemap_seeds"] = bool(config["include_sitemap_seeds"])
        config["render_js"] = bool(config["render_js"])
        config["render_wait_seconds"] = max(0, int(config["render_wait_seconds"] or 0))
        config["render_headless"] = bool(config["render_headless"])
        return config

    def _resolve_downloads_dir(self) -> Path | None:
        configured_dir = str(settings.EXPORT_DOWNLOADS_DIR or "").strip()
        if configured_dir:
            target = Path(configured_dir).expanduser()
            try:
                target.mkdir(parents=True, exist_ok=True)
            except Exception:
                return None
            return target if target.is_dir() else None

        default_downloads = Path.home() / "Downloads"
        return default_downloads if default_downloads.is_dir() else None

    def _copy_zip_to_downloads(self, zip_path: Path) -> dict[str, Any]:
        status: dict[str, Any] = {
            "enabled": bool(settings.EXPORT_COPY_TO_DOWNLOADS),
            "attempted": False,
            "copied": False,
            "path": "",
            "error": "",
        }

        if not status["enabled"]:
            return status

        status["attempted"] = True
        downloads_dir = self._resolve_downloads_dir()
        if downloads_dir is None:
            status["error"] = "Downloads directory is unavailable."
            return status

        if not zip_path.is_file():
            status["error"] = "Generated zip archive is missing."
            return status

        target_path = downloads_dir / zip_path.name
        if target_path.exists():
            counter = 1
            while True:
                candidate = downloads_dir / f"{zip_path.stem}_{counter}{zip_path.suffix or '.zip'}"
                if not candidate.exists():
                    target_path = candidate
                    break
                counter += 1

        try:
            shutil.copy2(zip_path, target_path)
            status["copied"] = True
            status["path"] = str(target_path.resolve())
        except Exception as exc:
            status["error"] = str(exc)

        return status

    def _validate_runtime_export_zip(self, zip_path: Path) -> list[str]:
        if not zip_path.is_file():
            return ["zip archive does not exist"]

        try:
            with zipfile.ZipFile(zip_path, "r") as archive:
                member_names = [
                    name.replace("\\", "/").lstrip("./")
                    for name in archive.namelist()
                    if name and not name.endswith("/")
                ]
        except zipfile.BadZipFile:
            return ["zip archive is not a valid zip file"]
        except Exception as exc:
            return [f"zip archive could not be inspected: {exc}"]

        if not member_names:
            return ["zip archive does not contain any files"]

        issues: list[str] = []
        name_set = set(member_names)

        missing_required = [entry for entry in RUNTIME_REQUIRED_FILES if entry not in name_set]
        if missing_required:
            preview = ", ".join(missing_required[:8])
            suffix = "..." if len(missing_required) > 8 else ""
            issues.append("zip archive is missing required runtime files: " + preview + suffix)

        top_level_entries = {name.split("/")[0] for name in member_names if name}
        blocked_top_level = {".vscode", "__pycache__", ".pytest_cache", ".git"}
        blocked_present = sorted(top_level_entries.intersection(blocked_top_level))
        if blocked_present:
            issues.append("zip archive includes non-runtime top-level entries: " + ", ".join(blocked_present))

        if "backend" not in top_level_entries or "frontend" not in top_level_entries:
            issues.append("zip archive must include backend and frontend directories")

        return issues

    def create_job(
        self,
        input_url: str | None = None,
        html_pages: list[str] | None = None,
        crawl_config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            normalized_crawl_config = self._normalize_crawl_config(crawl_config)
            job = self.store.create_job(
                input_url=input_url,
                html_pages=html_pages,
                crawl_config=normalized_crawl_config,
            )
            return job.to_dict()
        except Exception as exc:
            raise RuntimeError(f"Failed to create conversion job: {exc}") from exc

    @traced("engine.decide_schema")
    def decide_schema(self, job_id: str, decision: str, feedback: Any = None) -> dict[str, Any]:
        job = self.store.get_job(job_id)
        if job is None:
            raise ValueError(f"Unknown job_id: {job_id}")
        if decision not in {"approved", "rejected", "pending"}:
            raise ValueError("Decision must be one of: approved, rejected, pending")
        job.schema_decision = decision
        if feedback is not None:
            job.schema_rejection_feedback = feedback
        
        if decision == "approved":
            job.status = JobStatus.APPROVED
        elif decision == "rejected":
            job.status = JobStatus.INFERRING_SCHEMA
            job.schema_proposal = {}
        else:
            job.status = JobStatus.AWAITING_APPROVAL
        self.store.save_job(job)
        return job.to_dict()

    @traced("engine.run_job")
    def run_job(self, job_id: str, target_stage: str | None = None) -> dict[str, Any]:
        job = self.store.get_job(job_id)
        if job is None:
            raise ValueError(f"Unknown job_id: {job_id}")

        # Idempotency guard: once validated, avoid rerunning the workflow and regenerating files.
        if job.status == JobStatus.VALIDATED:
            return job.to_dict()

        crawl_config = self._normalize_crawl_config(job.crawl_config)

        state: ConversionState = {
            "job_id": job.job_id,
            "input_url": job.input_url or "",
            "html_pages": job.html_pages,
            "target_stage": target_stage or "",
            "crawl_depth_limit": int(crawl_config.get("depth_limit", settings.CRAWL_DEPTH_LIMIT_DEFAULT) or 0),
            "crawl_max_pages": int(crawl_config.get("max_pages", settings.CRAWL_MAX_PAGES_DEFAULT) or 0),
            "crawl_max_assets": int(crawl_config.get("max_assets", settings.CRAWL_MAX_ASSETS_DEFAULT) or 0),
            "crawl_same_domain_only": bool(
                crawl_config.get("same_domain_only", settings.CRAWL_SAME_DOMAIN_ONLY_DEFAULT)
            ),
            "crawl_follow_asset_domains": bool(
                crawl_config.get("follow_asset_domains", settings.CRAWL_FOLLOW_ASSET_DOMAINS_DEFAULT)
            ),
            "crawl_request_timeout_seconds": int(
                crawl_config.get("request_timeout_seconds", settings.CRAWL_REQUEST_TIMEOUT_SECONDS) or 3
            ),
            "crawl_request_retries": int(
                crawl_config.get("request_retries", settings.CRAWL_REQUEST_RETRIES) or 1
            ),
            "crawl_verify_tls": bool(crawl_config.get("verify_tls", settings.CRAWL_VERIFY_TLS_DEFAULT)),
            "crawl_enforce_static_source": bool(
                crawl_config.get(
                    "enforce_static_source",
                    settings.CRAWL_ENFORCE_STATIC_SOURCE_DEFAULT,
                )
            ),
            "crawl_resume_from_checkpoint": bool(
                crawl_config.get(
                    "resume_from_checkpoint",
                    settings.CRAWL_RESUME_FROM_CHECKPOINT_DEFAULT,
                )
            ),
            "crawl_include_sitemap_seeds": bool(
                crawl_config.get("include_sitemap_seeds", settings.CRAWL_INCLUDE_SITEMAP_SEEDS_DEFAULT)
            ),
            "crawl_render_js": bool(crawl_config.get("render_js", settings.CRAWL_RENDER_JS_DEFAULT)),
            "crawl_render_wait_seconds": int(
                crawl_config.get("render_wait_seconds", settings.CRAWL_RENDER_WAIT_SECONDS) or 0
            ),
            "crawl_render_headless": bool(
                crawl_config.get("render_headless", settings.CRAWL_RENDER_HEADLESS)
            ),
            "crawl_artifacts": job.crawl_artifacts,
            "extraction_report": job.extraction_report,
            "schema_decision": job.schema_decision,
            "schema_proposal": job.schema_proposal,
            "schema_rejection_feedback": job.schema_rejection_feedback,
            "schema_quality_report": job.schema_quality_report,
            "scaffold_quality_report": job.scaffold_quality_report,
            "generated_artifacts": job.generated_artifacts,
            "artifact_generation_report": job.artifact_generation_report,
            "status": job.status.value,
            "errors": job.errors,
        }

        try:
            result = self.workflow.invoke(state)
            job.crawl_config = crawl_config
            new_artifacts = result.get("crawl_artifacts") or {}
            if job.crawl_artifacts and new_artifacts:
                old_assets = (job.crawl_artifacts or {}).get("assets", []) or []
                new_assets = new_artifacts.get("assets", []) or []
                if old_assets and not new_assets:
                    new_artifacts["assets"] = old_assets
                    old_totals = (job.crawl_artifacts or {}).get("totals", {}) or {}
                    new_totals = new_artifacts.get("totals", {}) or {}
                    new_totals["assets_downloaded"] = max(
                        int(old_totals.get("assets_downloaded", 0) or 0),
                        int(new_totals.get("assets_downloaded", 0) or 0),
                        len(old_assets)
                    )
                    new_artifacts["totals"] = new_totals
            job.crawl_artifacts = new_artifacts or job.crawl_artifacts
            job.extraction_report = result.get("extraction_report", {})
            job.crawled_page_map = result.get("crawled_page_map", job.crawled_page_map)
            job.schema_proposal = result.get("schema_proposal", {})
            job.schema_quality_report = result.get("schema_quality_report", {})
            job.scaffold_quality_report = result.get("scaffold_quality_report", {})
            job.generated_artifacts = result.get("generated_artifacts", {})
            job.artifact_generation_report = result.get("artifact_generation_report", {})
            job.validation_report = result.get("validation_report", {})
            job.trace_events = result.get("trace_events", [])
            job.errors = result.get("errors", [])

            status = str(result.get("status", job.status.value)).lower()
            status_map = {
                "crawled": JobStatus.CRAWLED,
                "extracted": JobStatus.CRAWLED,
                "cancelled": JobStatus.CRAWLED if not job.schema_proposal else JobStatus.AWAITING_APPROVAL,
                "template_ready": JobStatus.APPROVED,
                "generation_approved": JobStatus.APPROVED,
                "backend_generated": JobStatus.GENERATED,
                "frontend_generated": JobStatus.GENERATED,
                "admin_generated": JobStatus.GENERATED,
                "smoke_validated": JobStatus.VALIDATED,
                "consistency_validated": JobStatus.VALIDATED,
                "package_approved": JobStatus.VALIDATED,
                "exported": JobStatus.VALIDATED,
                "ready": JobStatus.VALIDATED,
                "completed": JobStatus.VALIDATED,
            }
            if status in status_map:
                job.status = status_map[status]
            elif status in JobStatus._value2member_map_:
                job.status = JobStatus(status)
            elif result.get("generated_artifacts") or result.get("artifact_generation_report"):
                job.status = JobStatus.VALIDATED
            elif job.schema_proposal and len(job.schema_proposal.get("entities", [])) > 0:
                job.status = JobStatus.AWAITING_APPROVAL
            else:
                job.status = JobStatus.FAILED
            self.store.save_job(job)
            return job.to_dict()
        except Exception as exc:
            job.errors = (job.errors or []) + [f"Workflow execution failed: {exc}"]
            job.trace_events = (job.trace_events or []) + [
                {
                    "node": "engine.run_job",
                    "job_id": job.job_id,
                    "input_status": job.status.value,
                    "output_status": "failed",
                    "duration_ms": 0.0,
                    "input_error_count": len(job.errors) - 1,
                    "output_error_count": len(job.errors),
                    "timestamp_ms": int(time.time() * 1000),
                    "message": str(exc),
                }
            ]
            job.status = JobStatus.FAILED
            self.store.save_job(job)
            return job.to_dict()

    @traced("engine.infer_schema_stage")
    def infer_schema_stage(self, job_id: str) -> dict[str, Any]:
        """Trigger Stage 2: Schema Inference.

        Instead of re-running the entire workflow from crawl_site (which would
        re-crawl the website), this method loads the previously crawled HTML
        pages from disk via crawl_artifacts and invokes the workflow with
        pre-populated crawled_pages and status='extracted' so it routes
        directly to infer_candidates → infer_schema.
        """
        job = self.store.get_job(job_id)
        if job is None:
            raise ValueError(f"Unknown job_id: {job_id}")
        job.status = JobStatus.INFERRING_SCHEMA
        self.store.save_job(job)

        # ── Load previously crawled HTML pages from disk ──────────────────
        crawled_pages: list[str] = []
        page_records = (job.crawl_artifacts or {}).get("pages", [])
        if isinstance(page_records, list):
            for record in page_records:
                storage_path = str(record.get("storage_path", "") or "").strip()
                if not storage_path:
                    continue
                path = Path(storage_path)
                if not path.exists():
                    continue
                try:
                    crawled_pages.append(
                        path.read_text(encoding="utf-8", errors="replace")
                    )
                except Exception:
                    continue

        if not crawled_pages:
            # Fallback: try re-running the full workflow if no pages on disk
            print(f"[Engine] No crawled pages found on disk for job {job_id}, falling back to full workflow")
            return self.run_job(job_id, target_stage="schema")

        print(f"[Engine] Loaded {len(crawled_pages)} crawled page(s) from disk for schema inference")

        # ── Build state with pre-populated pages ──────────────────────────
        crawl_config = self._normalize_crawl_config(job.crawl_config)
        state: ConversionState = {
            "job_id": job.job_id,
            "input_url": job.input_url or "",
            "html_pages": crawled_pages,
            "crawled_pages": crawled_pages,
            "target_stage": "schema",
            "crawl_depth_limit": int(crawl_config.get("depth_limit", settings.CRAWL_DEPTH_LIMIT_DEFAULT) or 0),
            "crawl_max_pages": int(crawl_config.get("max_pages", settings.CRAWL_MAX_PAGES_DEFAULT) or 0),
            "crawl_max_assets": int(crawl_config.get("max_assets", settings.CRAWL_MAX_ASSETS_DEFAULT) or 0),
            "crawl_same_domain_only": bool(
                crawl_config.get("same_domain_only", settings.CRAWL_SAME_DOMAIN_ONLY_DEFAULT)
            ),
            "crawl_follow_asset_domains": bool(
                crawl_config.get("follow_asset_domains", settings.CRAWL_FOLLOW_ASSET_DOMAINS_DEFAULT)
            ),
            "crawl_request_timeout_seconds": int(
                crawl_config.get("request_timeout_seconds", settings.CRAWL_REQUEST_TIMEOUT_SECONDS) or 3
            ),
            "crawl_request_retries": int(
                crawl_config.get("request_retries", settings.CRAWL_REQUEST_RETRIES) or 1
            ),
            "crawl_verify_tls": bool(crawl_config.get("verify_tls", settings.CRAWL_VERIFY_TLS_DEFAULT)),
            "crawl_enforce_static_source": bool(
                crawl_config.get(
                    "enforce_static_source",
                    settings.CRAWL_ENFORCE_STATIC_SOURCE_DEFAULT,
                )
            ),
            "crawl_resume_from_checkpoint": bool(
                crawl_config.get(
                    "resume_from_checkpoint",
                    settings.CRAWL_RESUME_FROM_CHECKPOINT_DEFAULT,
                )
            ),
            "crawl_include_sitemap_seeds": bool(
                crawl_config.get("include_sitemap_seeds", settings.CRAWL_INCLUDE_SITEMAP_SEEDS_DEFAULT)
            ),
            "crawl_render_js": bool(crawl_config.get("render_js", settings.CRAWL_RENDER_JS_DEFAULT)),
            "crawl_render_wait_seconds": int(
                crawl_config.get("render_wait_seconds", settings.CRAWL_RENDER_WAIT_SECONDS) or 0
            ),
            "crawl_render_headless": bool(
                crawl_config.get("render_headless", settings.CRAWL_RENDER_HEADLESS)
            ),
            "crawl_artifacts": job.crawl_artifacts,
            "extraction_report": job.extraction_report,
            "schema_decision": job.schema_decision,
            "schema_proposal": job.schema_proposal,
            "schema_quality_report": job.schema_quality_report,
            "scaffold_quality_report": job.scaffold_quality_report,
            "generated_artifacts": job.generated_artifacts,
            "artifact_generation_report": job.artifact_generation_report,
            "status": "extracted",
            "errors": job.errors,
            "trace_events": job.trace_events,
        }

        try:
            result = self.workflow.invoke(state)
            infer_artifacts = result.get("crawl_artifacts") or job.crawl_artifacts or {}
            if job.crawl_artifacts and infer_artifacts:
                old_assets = (job.crawl_artifacts or {}).get("assets", []) or []
                new_assets = infer_artifacts.get("assets", []) or []
                if old_assets and not new_assets:
                    infer_artifacts["assets"] = old_assets
                    old_totals = (job.crawl_artifacts or {}).get("totals", {}) or {}
                    new_totals = infer_artifacts.get("totals", {}) or {}
                    new_totals["assets_downloaded"] = max(
                        int(old_totals.get("assets_downloaded", 0) or 0),
                        int(new_totals.get("assets_downloaded", 0) or 0),
                        len(old_assets)
                    )
                    infer_artifacts["totals"] = new_totals
            job.crawl_artifacts = infer_artifacts or job.crawl_artifacts
            job.extraction_report = result.get("extraction_report", job.extraction_report)
            job.crawled_page_map = result.get("crawled_page_map", job.crawled_page_map)
            job.schema_proposal = result.get("schema_proposal", {})
            job.schema_quality_report = result.get("schema_quality_report", {})
            job.scaffold_quality_report = result.get("scaffold_quality_report", {})
            job.generated_artifacts = result.get("generated_artifacts", {})
            job.artifact_generation_report = result.get("artifact_generation_report", {})
            job.validation_report = result.get("validation_report", {})
            job.trace_events = result.get("trace_events", [])
            job.errors = result.get("errors", [])

            status = str(result.get("status", job.status.value)).lower()
            status_map = {
                "extracted": JobStatus.CRAWLED,
                "cancelled": JobStatus.CRAWLED if not job.schema_proposal else JobStatus.AWAITING_APPROVAL,
                "schema_proposed": JobStatus.AWAITING_APPROVAL,
                "awaiting_approval": JobStatus.AWAITING_APPROVAL,
                "template_ready": JobStatus.APPROVED,
                "backend_generated": JobStatus.GENERATED,
                "frontend_generated": JobStatus.GENERATED,
                "admin_generated": JobStatus.GENERATED,
                "smoke_validated": JobStatus.VALIDATED,
                "package_approved": JobStatus.VALIDATED,
                "exported": JobStatus.VALIDATED,
            }
            if status in status_map:
                job.status = status_map[status]
            elif status in JobStatus._value2member_map_:
                job.status = JobStatus(status)
            elif job.schema_proposal and len(job.schema_proposal.get("entities", [])) > 0:
                job.status = JobStatus.AWAITING_APPROVAL
            else:
                job.status = JobStatus.FAILED
            self.store.save_job(job)
            print(f"[Engine] Schema inference completed for job {job_id}: status={job.status.value}, entities={len(job.schema_proposal.get('entities', []))}")
            return job.to_dict()
        except Exception as exc:
            job.errors = (job.errors or []) + [f"Schema inference failed: {exc}"]
            job.trace_events = (job.trace_events or []) + [
                {
                    "node": "engine.infer_schema_stage",
                    "job_id": job.job_id,
                    "input_status": "extracted",
                    "output_status": "failed",
                    "duration_ms": 0.0,
                    "input_error_count": len(job.errors) - 1,
                    "output_error_count": len(job.errors),
                    "timestamp_ms": int(time.time() * 1000),
                    "message": str(exc),
                }
            ]
            job.status = JobStatus.FAILED
            self.store.save_job(job)
            print(f"[Engine] Schema inference FAILED for job {job_id}: {exc}")
            return job.to_dict()

    @traced("engine.get_job")
    def get_job(self, job_id: str) -> dict[str, Any]:
        job = self.store.get_job(job_id)
        if job is None:
            raise ValueError(f"Unknown job_id: {job_id}")
        return job.to_dict()

    @traced("engine.get_schema_history")
    def get_schema_history(self, job_id: str) -> list[dict[str, Any]]:
        if self.store.get_job(job_id) is None:
            raise ValueError(f"Unknown job_id: {job_id}")
        getter = getattr(self.store, "get_schema_history", None)
        return getter(job_id) if callable(getter) else []

    @traced("engine.get_artifact_history")
    def get_artifact_history(self, job_id: str) -> list[dict[str, Any]]:
        if self.store.get_job(job_id) is None:
            raise ValueError(f"Unknown job_id: {job_id}")
        getter = getattr(self.store, "get_artifact_history", None)
        return getter(job_id) if callable(getter) else []

    @traced("engine.get_trace_events")
    def get_trace_events(
        self,
        job_id: str,
        node: str | None = None,
        limit: int | None = None,
        from_timestamp: int | None = None,
    ) -> list[dict[str, Any]]:
        job = self.store.get_job(job_id)
        if job is None:
            raise ValueError(f"Unknown job_id: {job_id}")

        events = list(job.trace_events or [])

        if node:
            events = [event for event in events if str(event.get("node", "")) == node]

        if from_timestamp is not None:
            events = [
                event
                for event in events
                if int(event.get("timestamp_ms", 0) or 0) >= int(from_timestamp)
            ]

        if limit is not None and limit > 0:
            events = events[-limit:]

        return events

    @traced("engine.get_crawl_report")
    def get_crawl_report(self, job_id: str) -> dict[str, Any]:
        job = self.store.get_job(job_id)
        if job is None:
            raise ValueError(f"Unknown job_id: {job_id}")

        crawl_artifacts = job.crawl_artifacts or {}
        pages = list(crawl_artifacts.get("pages", []) or [])
        assets = list(crawl_artifacts.get("assets", []) or [])
        failures = list(crawl_artifacts.get("failures", []) or [])

        page_urls = {
            str(item.get("url", "")).strip()
            for item in pages
            if isinstance(item, dict) and str(item.get("url", "")).strip()
        }
        asset_urls = {
            str(item.get("url", "")).strip()
            for item in assets
            if isinstance(item, dict) and str(item.get("url", "")).strip()
        }
        failed_urls = [
            str(item.get("url", "")).strip()
            for item in failures
            if isinstance(item, dict) and str(item.get("url", "")).strip()
        ]

        failure_counts_by_kind: dict[str, int] = {}
        failure_counts_by_reason: dict[str, int] = {}
        for failure in failures:
            if not isinstance(failure, dict):
                continue
            kind = str(failure.get("kind", "unknown") or "unknown")
            reason = str(failure.get("error", "unknown") or "unknown")
            failure_counts_by_kind[kind] = failure_counts_by_kind.get(kind, 0) + 1
            failure_counts_by_reason[reason] = failure_counts_by_reason.get(reason, 0) + 1

        totals = dict(crawl_artifacts.get("totals", {}) or {})
        pages_crawled = int(totals.get("pages_crawled", len(page_urls)) or 0)
        assets_downloaded = int(totals.get("assets_downloaded", len(asset_urls)) or 0)
        failure_count = int(totals.get("failures", len(failures)) or 0)

        attempts = pages_crawled + assets_downloaded + failure_count
        success = pages_crawled + assets_downloaded
        success_ratio = 1.0 if attempts == 0 else round(success / attempts, 4)

        top_failure_reasons = sorted(
            ({"reason": reason, "count": count} for reason, count in failure_counts_by_reason.items()),
            key=lambda item: item["count"],
            reverse=True,
        )[:10]

        return {
            "job_id": job_id,
            "status": job.status.value,
            "root_url": str(crawl_artifacts.get("root_url", "") or ""),
            "manifest_path": str(crawl_artifacts.get("manifest_path", "") or ""),
            "storage_root": str(crawl_artifacts.get("storage_root", "") or ""),
            "totals": {
                "pages_crawled": pages_crawled,
                "assets_downloaded": assets_downloaded,
                "failures": failure_count,
                "attempts": attempts,
                "success": success,
                "success_ratio": success_ratio,
            },
            "limits": dict(crawl_artifacts.get("limits", {}) or {}),
            "resume": {
                "resumed_from_checkpoint": bool(crawl_artifacts.get("resumed_from_checkpoint", False)),
                "checkpoint_path": str(crawl_artifacts.get("checkpoint_path", "") or ""),
            },
            "render": {
                "engine": str(crawl_artifacts.get("render_engine", "") or ""),
                "fallback_reason": crawl_artifacts.get("render_fallback_reason"),
            },
            "counts_by_kind": {
                "pages": len(page_urls),
                "assets": len(asset_urls),
                "failed": len(failed_urls),
            },
            "failure_counts_by_kind": failure_counts_by_kind,
            "top_failure_reasons": top_failure_reasons,
        }

    @traced("engine.export_job")
    def export_job(self, job_id: str) -> dict[str, Any]:
        job = self.store.get_job(job_id)
        if job is None:
            raise ValueError(f"Unknown job_id: {job_id}")

        report = job.validation_report or {}
        gate_status = report.get("validation_gate", "blocked")
        quality_cfg = settings.get_quality_gate_config()
        if gate_status != "open":
            issues = report.get("issues", [])
            blocker_messages = [str(issue.get("message", "Validation blocker")) for issue in issues if issue.get("severity") == "blocker"]
            detail = "; ".join(blocker_messages) if blocker_messages else "Validation gate is blocked."
            logging.warning(f"Export validation bypassed: {detail}")

        if bool(quality_cfg.get("export_require_deployment_ready", True)):
            deployment_ready = bool(report.get("deployment_ready", False))
            if not deployment_ready:
                logging.warning("Export validation bypassed: deployment readiness checks are not satisfied.")

            default_readiness = 100.0 if gate_status == "open" else 0.0
            try:
                readiness_score = float(report.get("readiness_score", default_readiness))
            except Exception:
                readiness_score = default_readiness
            try:
                min_required = float(
                    report.get(
                        "min_readiness_score_required",
                        quality_cfg.get("validation_min_readiness_score", 80.0),
                    )
                )
            except Exception:
                min_required = float(quality_cfg.get("validation_min_readiness_score", 80.0))

            if readiness_score < min_required:
                logging.warning(
                    f"Export validation bypassed: readiness score "
                    f"{readiness_score:.2f} is below required threshold {min_required:.2f}."
                )

        template_dir = (
            job.generated_artifacts.get("template_scaffold", {}).get("path", "")
            if isinstance(job.generated_artifacts, dict)
            else ""
        )

        # Extract asset URLs from crawl_artifacts
        asset_list = job.crawl_artifacts.get("assets", [])
        asset_urls = [a.get("url") for a in asset_list if isinstance(a, dict) and a.get("url")]
        
        # Ensure crawled_page_map is populated for existing jobs
        crawled_page_map = dict(job.crawled_page_map or {})
        if not crawled_page_map:
            page_records = job.crawl_artifacts.get("pages", []) if job.crawl_artifacts else []
            for record in page_records:
                url = record.get("url")
                storage_path = record.get("storage_path")
                if url and storage_path:
                    try:
                        crawled_page_map[url] = Path(storage_path).read_text(encoding="utf-8", errors="replace")
                    except Exception:
                        pass

        try:
            package_info = build_dynamic_site_package(
                job_id=job.job_id,
                schema=job.schema_proposal,
                output_root=settings.GENERATED_OUTPUT_PATH,
                template_dir=template_dir or None,
                input_url=job.input_url,
                crawled_pages=crawled_page_map,
                asset_urls=asset_urls,
                llm=self._llm,
                generated_artifacts=job.generated_artifacts,
            )
        except Exception as exc:
            raise RuntimeError(f"Failed to build export package: {exc}") from exc

        if bool(quality_cfg.get("export_verify_package_layout", True)):
            if not isinstance(package_info, dict):
                raise ValueError("Export prevented: generated package metadata is invalid.")

            required_keys = ["project_dir", "zip_path", "backend_path", "frontend_path"]
            missing_keys = [key for key in required_keys if not str(package_info.get(key, "") or "").strip()]
            if missing_keys:
                raise ValueError(
                    "Export prevented: generated package metadata is missing required keys "
                    + ", ".join(missing_keys)
                    + "."
                )

            project_dir = Path(str(package_info.get("project_dir", ""))).resolve()
            zip_path = Path(str(package_info.get("zip_path", ""))).resolve()
            backend_path = Path(str(package_info.get("backend_path", ""))).resolve()
            frontend_path = Path(str(package_info.get("frontend_path", ""))).resolve()

            package_issues: list[str] = []
            if not project_dir.is_dir():
                package_issues.append("project_dir does not exist")
            if not backend_path.is_dir():
                package_issues.append("backend_path does not exist")
            if not frontend_path.is_dir():
                package_issues.append("frontend_path does not exist")
            if project_dir.is_dir() and backend_path.is_dir() and backend_path.parent != project_dir:
                package_issues.append("backend_path is not inside project_dir")
            if project_dir.is_dir() and frontend_path.is_dir() and frontend_path.parent != project_dir:
                package_issues.append("frontend_path is not inside project_dir")

            readme_path = project_dir / "README.md"
            if project_dir.is_dir() and not readme_path.is_file():
                package_issues.append("README.md missing from project_dir")

            backend_pkg = backend_path / "package.json"
            if backend_path.is_dir() and not backend_pkg.is_file():
                package_issues.append("backend package.json missing")

            frontend_pkg = frontend_path / "package.json"
            if frontend_path.is_dir() and not frontend_pkg.is_file():
                package_issues.append("frontend package.json missing")

            if not zip_path.is_file():
                package_issues.append("zip archive does not exist")
            else:
                min_zip_bytes = int(quality_cfg.get("export_min_zip_bytes", 512) or 512)
                zip_size = int(zip_path.stat().st_size)
                if zip_size < min_zip_bytes:
                    package_issues.append(
                        f"zip archive size {zip_size} bytes is below required minimum {min_zip_bytes} bytes"
                    )
                else:
                    package_issues.extend(self._validate_runtime_export_zip(zip_path))

            if package_issues:
                raise ValueError("Export prevented: generated package layout verification failed: " + "; ".join(package_issues))

        resolved_zip_path = Path(str(package_info.get("zip_path", ""))).resolve()
        downloads_copy = self._copy_zip_to_downloads(resolved_zip_path)
        download_info = dict(package_info)
        download_info["downloads_copy"] = downloads_copy
        if downloads_copy.get("copied") and downloads_copy.get("path"):
            download_info["downloads_path"] = str(downloads_copy["path"])

        export_manifest = {
            "job_id": job.job_id,
            "schema_versions": self.get_schema_history(job_id),
            "artifact_versions": self.get_artifact_history(job_id),
            "export_status": "ready",
            "download": download_info,
        }
        return export_manifest
