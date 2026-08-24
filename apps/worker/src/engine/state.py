from __future__ import annotations

from typing import Any, Literal, TypedDict


class ConversionState(TypedDict, total=False):
    # ── Core identifiers ──────────────────────────────────────────────────────
    job_id: str
    input_url: str
    target_stage: str

    # ── Crawl config ──────────────────────────────────────────────────────────
    crawl_depth_limit: int
    crawl_max_pages: int
    crawl_max_assets: int
    crawl_same_domain_only: bool
    crawl_follow_asset_domains: bool
    crawl_request_timeout_seconds: int
    crawl_request_retries: int
    crawl_verify_tls: bool
    crawl_enforce_static_source: bool
    crawl_resume_from_checkpoint: bool
    crawl_include_sitemap_seeds: bool
    crawl_render_js: bool
    crawl_render_wait_seconds: int
    crawl_render_headless: bool

    # ── Crawl output ──────────────────────────────────────────────────────────
    html_pages: list[str]
    crawled_pages: list[str]
    crawled_page_map: dict[str, str]
    crawl_asset_urls: list[str]
    crawl_artifacts: dict[str, Any]

    # ── Extract output ────────────────────────────────────────────────────────
    extracted_blocks: list[str]
    extraction_report: dict[str, Any]
    sitemap: dict[str, Any]

    # ── Schema ────────────────────────────────────────────────────────────────
    schema_proposal: dict[str, Any]
    schema_quality_report: dict[str, Any]
    schema_decision: Literal["approved", "rejected", "pending"]
    schema_rejection_feedback: Any

    # ── Scaffold ──────────────────────────────────────────────────────────────
    template_scaffold: dict[str, Any]
    scaffold_quality_report: dict[str, Any]

    # ── Generation ────────────────────────────────────────────────────────────
    generated_artifacts: dict[str, Any]
    artifact_generation_report: dict[str, Any]
    backend_report: dict[str, Any]
    frontend_report: dict[str, Any]
    admin_report: dict[str, Any]

    # ── Validation ────────────────────────────────────────────────────────────
    consistency_report: dict[str, Any]
    smoke_report: dict[str, Any]
    validation_report: dict[str, Any]

    # ── Export ────────────────────────────────────────────────────────────────
    export_manifest: dict[str, Any]

    # ── Observability ─────────────────────────────────────────────────────────
    trace_events: list[dict[str, Any]]
    error_context: list[dict[str, Any]]

    # ── Runtime state ─────────────────────────────────────────────────────────
    status: str
    errors: list[str]

    # ── Retry counters (prevent infinite loops) ───────────────────────────────
    crawl_retry_count: int          # retries for crawl_site
    schema_retry_count: int         # retries for infer_schema loop
    backend_retry_count: int        # retries for generate_backend
    frontend_retry_count: int       # retries for generate_frontend
    admin_retry_count: int          # retries for generate_admin
    validation_retry_count: int     # retries for validate_build_smoke
    max_retries: int                # global cap per layer  (default 3)

    # ── Per-layer quality scores (0–100, must reach 100 to pass) ─────────────
    backend_quality_score: float
    frontend_quality_score: float
    admin_quality_score: float
    consistency_quality_score: float
    overall_quality_score: float

    # ── Human/automated review gate decisions (set externally or by evaluator) ─
    schema_review_decision: Literal["approved", "retry", "cancelled"]
    generation_gate_decision: Literal["approved", "cancelled"]
    validation_review_decision: Literal["approved", "retry_backend", "retry_schema", "cancelled"]

    # ── Internal router hints ─────────────────────────────────────────────────
    _retry_target_layer: str
