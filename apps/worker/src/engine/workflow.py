"""
workflow.py — 100% resilient LangGraph conversion workflow.

Architecture (mirrors Figure_3_4_LangGraph_Orchestration.png):

  crawl_site ──► sitemap_gate ──► extract_content ──► infer_candidates
      ▲               │ (retry_crawl)                        │
      └───────────────┘                              infer_schema
                                                          │
                                                  schema_review_gate
                                                    │          │
                                               (retry_schema)  │
                                                    └──────────┘
                                                          │ schema_approved
                                                  mint_schema_version
                                                          │
                                                   generation_gate
                                                          │ generation_approved
                                              prepare_template_scaffold
                                                          │
                                                  generate_backend ◄────────────────┐
                                                    │  (backend_needs_retry loops)   │
                                                  generate_frontend ◄──────────────┐│
                                                    │  (frontend_needs_retry loops) ││
                                                  generate_admin ◄─────────────────┘│
                                                    │  (admin_needs_retry loops)     │
                                               validate_consistency                  │
                                                          │                          │
                                               validate_build_smoke                  │
                                                    │          │                     │
                                               (smoke_failed)  │                     │
                                                    │          │ smoke_validated      │
                                          validation_review_gate                     │
                                           │    │      │                             │
                                    (retry_*) ──┘      │ package_approved            │
                                     routes ───────────┘──────────────────────────► │
                                                  package_export
                                                          │
                                                       __end__

Fallback on any terminal failure → END_CANCELLED (always reaches __end__).

Retry budgets (default 3 each):
  crawl_retry_count, schema_retry_count,
  backend_retry_count, frontend_retry_count, admin_retry_count,
  validation_retry_count
"""
from __future__ import annotations

import time
from typing import Callable, Any

from langgraph.graph import END, StateGraph
from src.engine.failover_llm import PromptLLM

from src.engine.nodes import (
    crawl_site_node,
    extract_content_node,
    infer_schema_node,
    prepare_template_scaffold_node,
)
from src.engine.resilient_nodes import (
    sitemap_gate_node,
    infer_candidates_node,
    schema_review_gate_node,
    mint_schema_version_node,
    generation_gate_node,
    generate_backend_node,
    generate_frontend_node,
    generate_admin_node,
    validate_consistency_node,
    validate_build_smoke_node,
    validation_review_gate_node,
    package_export_node,
    end_cancelled_node,
)
from src.engine.observability import traced
from src.engine.state import ConversionState


# ─────────────────────────────────────────────────────────────────────────────
# Telemetry wrapper
# ─────────────────────────────────────────────────────────────────────────────

def _with_node_telemetry(
    node_name: str,
    node_func: Callable[[ConversionState], ConversionState],
) -> Callable[[ConversionState], ConversionState]:

    @traced(f"node.{node_name}")
    def _wrapped(state: ConversionState) -> ConversionState:
        start = time.perf_counter()
        input_status = str(state.get("status", "unknown"))
        input_error_count = len(state.get("errors") or [])
        job_id = str(state.get("job_id", ""))

        result = node_func(state)

        elapsed_ms = round((time.perf_counter() - start) * 1000, 2)
        output_status = str(result.get("status", "unknown"))
        output_error_count = len(result.get("errors") or [])

        trace_events = list(result.get("trace_events") or state.get("trace_events") or [])
        trace_events.append({
            "node": node_name,
            "job_id": job_id,
            "input_status": input_status,
            "output_status": output_status,
            "duration_ms": elapsed_ms,
            "input_error_count": input_error_count,
            "output_error_count": output_error_count,
            "timestamp_ms": int(time.time() * 1000),
        })
        return {**result, "trace_events": trace_events}

    return _wrapped


# ─────────────────────────────────────────────────────────────────────────────
# Router helpers  (pure functions so they are easy to unit-test)
# ─────────────────────────────────────────────────────────────────────────────

def _route_after_crawl(state: ConversionState) -> str:
    status = state.get("status")
    if status == "approved":
        return "mint_schema_version"
    elif status == "generation_approved":
        return "prepare_template_scaffold"
    return "sitemap_gate" if status in ("crawled", "ready") else "END_CANCELLED"


def _route_after_sitemap(state: ConversionState) -> str:
    return "crawl_site" if state.get("status") == "retry_crawl" else "extract_content"


def _route_after_extract(state: ConversionState) -> str:
    status = state.get("status")
    target_stage = state.get("target_stage") or ""
    # Pause after Stage 1 (crawl & extract) unless stage2/schema inference explicitly requested
    if target_stage == "crawl" or (status in ("extracted", "crawled") and target_stage != "schema" and not state.get("schema_proposal")):
        return "END"
    valid_statuses = ("extracted", "crawled", "inferring_schema", "pending", "draft", "failed", "cancelled")
    return "infer_candidates" if status in valid_statuses or target_stage == "schema" else "END_CANCELLED"


def _route_after_infer_schema(state: ConversionState) -> str:
    # infer_schema_node sets status="schema_proposed" on success, "failed" on error
    status = state.get("status")
    if status in ("schema_proposed", "awaiting_approval", "extracted", "crawled"):
        return "schema_review_gate"
    return "END_CANCELLED"


def _route_after_schema_review(state: ConversionState) -> str:
    status = state.get("status")
    if status == "schema_approved":
        return "mint_schema_version"
    if status == "awaiting_approval":
        return "END"
    if status == "retry_schema":
        return "infer_schema"
    return "END_CANCELLED"


def _route_after_generation_gate(state: ConversionState) -> str:
    return "prepare_template_scaffold" if state.get("status") == "generation_approved" else "END_CANCELLED"


def _route_after_scaffold(state: ConversionState) -> str:
    # prepare_template_scaffold_node sets status="template_ready" on success
    return "generate_backend" if state.get("status") == "template_ready" else "END_CANCELLED"


def _route_after_backend(state: ConversionState) -> str:
    status = state.get("status")
    if status == "backend_needs_retry":
        return "generate_backend"       # self-healing retry loop
    if status == "backend_generated":
        return "generate_frontend"
    return "END_CANCELLED"


def _route_after_frontend(state: ConversionState) -> str:
    status = state.get("status")
    if status == "frontend_needs_retry":
        return "generate_frontend"      # self-healing retry loop
    if status == "frontend_generated":
        return "generate_admin"
    return "END_CANCELLED"


def _route_after_admin(state: ConversionState) -> str:
    status = state.get("status")
    if status == "admin_needs_retry":
        return "generate_admin"         # self-healing retry loop
    if status == "admin_generated":
        return "validate_consistency"
    return "END_CANCELLED"


def _route_after_smoke(state: ConversionState) -> str:
    status = state.get("status")
    if status == "smoke_validated":
        return "validation_review_gate"
    if status == "smoke_failed":
        return "validation_review_gate"  # gate decides the targeted retry
    return "END_CANCELLED"


def _route_after_validation_review(state: ConversionState) -> str:
    status = state.get("status")
    if status == "package_approved":
        return "package_export"
    if status == "retry_backend":
        return "generate_backend"
    if status == "retry_frontend":
        return "generate_frontend"
    if status == "retry_admin":
        return "generate_admin"
    if status == "retry_schema":
        return "infer_schema"
    return "END_CANCELLED"


# ─────────────────────────────────────────────────────────────────────────────
# Graph builder
# ─────────────────────────────────────────────────────────────────────────────

def build_conversion_workflow(
    infer_node: Callable[[ConversionState], ConversionState] | None = None,
    llm: PromptLLM | None = None,
) -> object:
    """
    Build and compile the fully resilient conversion workflow.

    Parameters
    ----------
    infer_node:
        Optional override for the schema-inference node (useful for testing
        with a mock LLM).  Defaults to `infer_schema_node`.

    Returns
    -------
    Compiled LangGraph app.
    """
    graph = StateGraph(ConversionState)
    T = _with_node_telemetry  # alias

    # ── Phase 1: Crawl & Extract ──────────────────────────────────────────────
    graph.add_node("crawl_site",        T("crawl_site",        crawl_site_node))
    graph.add_node("sitemap_gate",      T("sitemap_gate",      sitemap_gate_node))
    graph.add_node("extract_content",   T("extract_content",   extract_content_node))
    graph.add_node("infer_candidates",  T("infer_candidates",  infer_candidates_node))

    # ── Phase 2: Schema ───────────────────────────────────────────────────────
    graph.add_node("infer_schema",          T("infer_schema",         infer_node or infer_schema_node))
    graph.add_node("schema_review_gate",    T("schema_review_gate",   schema_review_gate_node))
    graph.add_node("mint_schema_version",   T("mint_schema_version",  mint_schema_version_node))

    # ── Phase 3: Generation Gate ──────────────────────────────────────────────
    graph.add_node("generation_gate",           T("generation_gate",           generation_gate_node))
    graph.add_node("prepare_template_scaffold", T("prepare_template_scaffold", prepare_template_scaffold_node))

    # ── Phase 4: Code Generation (self-healing loops) ─────────────────────────
    def _generate_backend_with_llm(state: ConversionState) -> ConversionState:
        return generate_backend_node(state, llm=llm)

    graph.add_node("generate_backend",  T("generate_backend",  _generate_backend_with_llm))
    graph.add_node("generate_frontend", T("generate_frontend", generate_frontend_node))
    graph.add_node("generate_admin",    T("generate_admin",    generate_admin_node))

    # ── Phase 5: Validation ───────────────────────────────────────────────────
    graph.add_node("validate_consistency",  T("validate_consistency",  validate_consistency_node))
    graph.add_node("validate_build_smoke",  T("validate_build_smoke",  validate_build_smoke_node))
    graph.add_node("validation_review_gate",T("validation_review_gate",validation_review_gate_node))

    # ── Phase 6: Export & Cancel ──────────────────────────────────────────────
    graph.add_node("package_export",  T("package_export",  package_export_node))
    graph.add_node("END_CANCELLED",   T("END_CANCELLED",   end_cancelled_node))

    # ── Entry point ───────────────────────────────────────────────────────────
    graph.set_entry_point("crawl_site")

    # ── Conditional edges ─────────────────────────────────────────────────────

    graph.add_conditional_edges(
        "crawl_site", _route_after_crawl,
        {
            "mint_schema_version": "mint_schema_version",
            "prepare_template_scaffold": "prepare_template_scaffold",
            "sitemap_gate": "sitemap_gate", 
            "END_CANCELLED": "END_CANCELLED"
        },
    )
    graph.add_conditional_edges(
        "sitemap_gate", _route_after_sitemap,
        {"extract_content": "extract_content", "crawl_site": "crawl_site"},
    )
    graph.add_conditional_edges(
        "extract_content", _route_after_extract,
        {"infer_candidates": "infer_candidates", "END": END, "END_CANCELLED": "END_CANCELLED"},
    )

    # infer_candidates → infer_schema (straight edge — candidates node handles its own cancel)
    graph.add_edge("infer_candidates", "infer_schema")

    graph.add_conditional_edges(
        "infer_schema", _route_after_infer_schema,
        {"schema_review_gate": "schema_review_gate", "END_CANCELLED": "END_CANCELLED"},
    )
    graph.add_conditional_edges(
        "schema_review_gate", _route_after_schema_review,
        {
            "mint_schema_version": "mint_schema_version",
            "infer_schema":        "infer_schema",       # retry loop
            "END":                 END,                  # pause for human approval
            "END_CANCELLED":       "END_CANCELLED",
        },
    )

    graph.add_edge("mint_schema_version", "generation_gate")

    graph.add_conditional_edges(
        "generation_gate", _route_after_generation_gate,
        {"prepare_template_scaffold": "prepare_template_scaffold", "END_CANCELLED": "END_CANCELLED"},
    )
    graph.add_conditional_edges(
        "prepare_template_scaffold", _route_after_scaffold,
        {"generate_backend": "generate_backend", "END_CANCELLED": "END_CANCELLED"},
    )

    # Self-healing generation loops
    graph.add_conditional_edges(
        "generate_backend", _route_after_backend,
        {
            "generate_backend":  "generate_backend",   # retry loop
            "generate_frontend": "generate_frontend",
            "END_CANCELLED":     "END_CANCELLED",
        },
    )
    graph.add_conditional_edges(
        "generate_frontend", _route_after_frontend,
        {
            "generate_frontend": "generate_frontend",  # retry loop
            "generate_admin":    "generate_admin",
            "END_CANCELLED":     "END_CANCELLED",
        },
    )
    graph.add_conditional_edges(
        "generate_admin", _route_after_admin,
        {
            "generate_admin":       "generate_admin",  # retry loop
            "validate_consistency": "validate_consistency",
            "END_CANCELLED":        "END_CANCELLED",
        },
    )

    graph.add_edge("validate_consistency", "validate_build_smoke")

    graph.add_conditional_edges(
        "validate_build_smoke", _route_after_smoke,
        {
            "validation_review_gate": "validation_review_gate",
            "END_CANCELLED":          "END_CANCELLED",
        },
    )
    graph.add_conditional_edges(
        "validation_review_gate", _route_after_validation_review,
        {
            "package_export":    "package_export",
            "generate_backend":  "generate_backend",   # targeted retry
            "generate_frontend": "generate_frontend",  # targeted retry
            "generate_admin":    "generate_admin",     # targeted retry
            "infer_schema":      "infer_schema",       # major redesign fallback
            "END_CANCELLED":     "END_CANCELLED",
        },
    )

    graph.add_edge("package_export", END)
    graph.add_edge("END_CANCELLED",  END)

    return graph.compile()
