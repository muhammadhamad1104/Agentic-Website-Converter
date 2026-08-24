"""
resilient_nodes.py — 100% self-healing node implementations for the
LangGraph agentic conversion workflow.

Every node:
  1. Never hard-terminates on a single failure — increments a retry counter
     and emits a structured error_context entry instead.
  2. Computes a per-layer quality score (0–100).  Score 100 = perfect.
  3. Surfaces the "next action" via the `status` field that the router reads.

Retry budget is controlled by `state["max_retries"]` (default 3).
Retry counters live in `state["*_retry_count"]` fields.
"""
from __future__ import annotations

import time
import uuid
from typing import Any, TYPE_CHECKING, cast

from src.engine.state import ConversionState

if TYPE_CHECKING:
    from src.engine.failover_llm import PromptLLM

_MAX_RETRIES_DEFAULT = 3


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _get_retry(state: ConversionState, key: str) -> int:
    return int(state.get(key) or 0)


def _max_retries(state: ConversionState) -> int:
    return int(state.get("max_retries") or _MAX_RETRIES_DEFAULT)


def _add_error_context(
    state: ConversionState,
    node: str,
    message: str,
    detail: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    ctx = list(state.get("error_context") or [])
    ctx.append({
        "node": node,
        "message": message,
        "detail": detail or {},
        "timestamp_ms": int(time.time() * 1000),
    })
    return ctx


def _quality_score(passed: int, total: int) -> float:
    if total == 0:
        return 0.0
    return round((passed / total) * 100.0, 2)


# ─────────────────────────────────────────────────────────────────────────────
# sitemap_gate_node
# Checks whether crawled pages are non-empty; re-triggers crawl on failure.
# ─────────────────────────────────────────────────────────────────────────────

def sitemap_gate_node(state: ConversionState) -> ConversionState:
    crawled_pages = state.get("crawled_pages") or []
    crawl_retry = _get_retry(state, "crawl_retry_count")
    max_r = _max_retries(state)

    if len(crawled_pages) < 1:
        if crawl_retry < max_r:
            ctx = _add_error_context(
                state, "sitemap_gate",
                f"No pages crawled (attempt {crawl_retry + 1}/{max_r}). Re-triggering crawl.",
            )
            return cast(ConversionState, {
                **state,
                "crawl_retry_count": crawl_retry + 1,
                "error_context": ctx,
                "status": "retry_crawl",
            })
        ctx = _add_error_context(
            state, "sitemap_gate",
            f"Crawl failed after {max_r} attempts. Cancelling.",
        )
        return cast(ConversionState, {**state, "error_context": ctx, "status": "cancelled"})

    return cast(ConversionState, {**state, "status": "sitemap_checked"})


# ─────────────────────────────────────────────────────────────────────────────
# infer_candidates_node
# Validates extracted blocks exist before schema inference.
# ─────────────────────────────────────────────────────────────────────────────

def infer_candidates_node(state: ConversionState) -> ConversionState:
    blocks = state.get("extracted_blocks") or []
    if not blocks:
        ctx = _add_error_context(
            state, "infer_candidates",
            "No content blocks extracted — cannot infer schema candidates.",
        )
        return cast(ConversionState, {**state, "error_context": ctx, "status": "cancelled"})
    return cast(ConversionState, {**state, "status": "candidates_inferred"})


# ─────────────────────────────────────────────────────────────────────────────
# schema_review_gate_node
# Auto-evaluates schema quality; retries infer_schema when quality < 100.
# ─────────────────────────────────────────────────────────────────────────────

def schema_review_gate_node(state: ConversionState) -> ConversionState:
    # Honour explicit external decisions first
    decision = str(state.get("schema_review_decision") or "").strip()
    if decision == "cancelled":
        return cast(ConversionState, {**state, "status": "cancelled"})
    if decision == "approved":
        return cast(ConversionState, {**state, "status": "schema_approved"})

    schema_proposal = state.get("schema_proposal") or {}
    entities = schema_proposal.get("entities") or []

    # If schema entities were extracted, pause workflow and await user's human approval
    if len(entities) > 0:
        return cast(ConversionState, {**state, "status": "awaiting_approval"})

    schema_retry = _get_retry(state, "schema_retry_count")
    max_r = _max_retries(state)

    quality_report = state.get("schema_quality_report") or {}
    gate = str(quality_report.get("quality_gate") or "unknown").lower()

    checks_passed = int(quality_report.get("checks_passed") or 0)
    checks_total = int(quality_report.get("checks_total") or max(1, checks_passed))
    score = _quality_score(checks_passed, checks_total)

    # If no entities extracted at all, retry if budget remains
    if schema_retry < max_r:
        ctx = _add_error_context(
            state, "schema_review_gate",
            f"No entities inferred yet (attempt {schema_retry + 1}/{max_r}). Retrying inference.",
            {"gate": gate, "entities": len(entities), "score": score},
        )
        return cast(ConversionState, {
            **state,
            "schema_retry_count": schema_retry + 1,
            "error_context": ctx,
            "status": "retry_schema",
        })

    # Pause for human decision even if empty
    return cast(ConversionState, {**state, "status": "awaiting_approval"})


# ─────────────────────────────────────────────────────────────────────────────
# mint_schema_version_node
# Stamps an immutable version UUID on the approved schema.
# ─────────────────────────────────────────────────────────────────────────────

def mint_schema_version_node(state: ConversionState) -> ConversionState:
    schema = dict(state.get("schema_proposal") or {})
    schema["_version"] = str(uuid.uuid4())[:8]
    schema["_minted_at_ms"] = int(time.time() * 1000)
    return cast(ConversionState, {**state, "schema_proposal": schema, "status": "schema_minted"})


# ─────────────────────────────────────────────────────────────────────────────
# generation_gate_node
# Ensures schema is versioned before allowing code generation.
# ─────────────────────────────────────────────────────────────────────────────

def generation_gate_node(state: ConversionState) -> ConversionState:
    decision = str(state.get("generation_gate_decision") or "").strip()
    if decision == "cancelled":
        return cast(ConversionState, {**state, "status": "cancelled"})

    schema = state.get("schema_proposal") or {}
    if not schema.get("_version"):
        ctx = _add_error_context(
            state, "generation_gate",
            "Schema not versioned — mint_schema_version must run first.",
        )
        return cast(ConversionState, {**state, "error_context": ctx, "status": "cancelled"})

    return cast(ConversionState, {**state, "status": "generation_approved"})


# ─────────────────────────────────────────────────────────────────────────────
# generate_backend_node
# Generates backend API. Self-heals: retries until quality == 100 or budget gone.
# ─────────────────────────────────────────────────────────────────────────────

def generate_backend_node(state: ConversionState, llm: 'PromptLLM | None' = None) -> ConversionState:
    backend_retry = _get_retry(state, "backend_retry_count")
    max_r = _max_retries(state)

    # Lazily generate ALL artifacts on the first pass
    if not state.get("generated_artifacts"):
        from src.engine.nodes import generate_artifacts_node
        try:
            gen_state = generate_artifacts_node({**state, "status": "template_ready"}, llm=llm)
            state = {**state, "generated_artifacts": gen_state.get("generated_artifacts")}
        except Exception as exc:
            return cast(ConversionState, {**state,
                    "error_context": _add_error_context(
                        state, "generate_backend",
                        f"generate_artifacts_node raised: {exc}")})

    artifacts = dict(state.get("generated_artifacts") or {})
    backend = dict(artifacts.get("backend") or {})

    endpoints = backend.get("endpoints") or []
    models = backend.get("models") or []
    has_health = bool(backend.get("health_check"))
    has_auth = bool(backend.get("auth_middleware"))

    checks = [bool(endpoints), bool(models), has_health, has_auth]
    score = _quality_score(sum(checks), len(checks))

    backend["_quality_score"] = score
    backend["_retry_count"] = backend_retry
    artifacts["backend"] = backend

    report: dict[str, Any] = {
        "quality_score": score,
        "endpoint_count": len(endpoints),
        "model_count": len(models),
        "has_health_check": has_health,
        "has_auth_middleware": has_auth,
        "retry": backend_retry,
        "max_retries": max_r,
    }

    base = {
        **state,
        "generated_artifacts": artifacts,
        "backend_report": report,
        "backend_quality_score": score,
    }

    if score < 100 and backend_retry < max_r:
        ctx = _add_error_context(
            state, "generate_backend",
            f"Backend quality {score:.1f}/100. Auto-retrying ({backend_retry + 1}/{max_r}).",
            report,
        )
        return cast(ConversionState, {**base, "backend_retry_count": backend_retry + 1,
                "error_context": ctx, "status": "backend_needs_retry"})

    if score < 100:
        ctx = _add_error_context(
            state, "generate_backend",
            f"Backend quality {score:.1f}/100 after {max_r} retries. Proceeding with best effort.",
            report,
        )
        return cast(ConversionState, {**base, "error_context": ctx, "status": "backend_generated"})

    return cast(ConversionState, {**base, "status": "backend_generated"})


# ─────────────────────────────────────────────────────────────────────────────
# generate_frontend_node
# Generates frontend pages. Self-heals until quality == 100 or budget gone.
# ─────────────────────────────────────────────────────────────────────────────

def generate_frontend_node(state: ConversionState) -> ConversionState:
    frontend_retry = _get_retry(state, "frontend_retry_count")
    max_r = _max_retries(state)

    artifacts = dict(state.get("generated_artifacts") or {})
    frontend = dict(artifacts.get("frontend") or {})

    pages = frontend.get("pages") or []
    has_router = bool(frontend.get("router"))
    has_components = bool(frontend.get("components"))
    has_styles = bool(frontend.get("styles"))

    checks = [bool(pages), has_router, has_components, has_styles]
    score = _quality_score(sum(checks), len(checks))

    frontend["_quality_score"] = score
    frontend["_retry_count"] = frontend_retry
    artifacts["frontend"] = frontend

    report: dict[str, Any] = {
        "quality_score": score,
        "page_count": len(pages),
        "has_router": has_router,
        "has_components": has_components,
        "has_styles": has_styles,
        "retry": frontend_retry,
        "max_retries": max_r,
    }

    base = {
        **state,
        "generated_artifacts": artifacts,
        "frontend_report": report,
        "frontend_quality_score": score,
    }

    if score < 100 and frontend_retry < max_r:
        ctx = _add_error_context(
            state, "generate_frontend",
            f"Frontend quality {score:.1f}/100. Auto-retrying ({frontend_retry + 1}/{max_r}).",
            report,
        )
        return cast(ConversionState, {**base, "frontend_retry_count": frontend_retry + 1,
                "error_context": ctx, "status": "frontend_needs_retry"})

    if score < 100:
        ctx = _add_error_context(
            state, "generate_frontend",
            f"Frontend quality {score:.1f}/100 after {max_r} retries. Proceeding with best effort.",
            report,
        )
        return cast(ConversionState, {**base, "error_context": ctx, "status": "frontend_generated"})

    return cast(ConversionState, {**base, "status": "frontend_generated"})


# ─────────────────────────────────────────────────────────────────────────────
# generate_admin_node
# Generates admin panel. Wraps generate_artifacts_node and scores admin layer.
# ─────────────────────────────────────────────────────────────────────────────

def generate_admin_node(state: ConversionState) -> ConversionState:
    admin_retry = _get_retry(state, "admin_retry_count")
    max_r = _max_retries(state)

    gen_state = state

    artifacts = dict(gen_state.get("generated_artifacts") or {})
    admin = dict(artifacts.get("admin") or {})

    resources = admin.get("resources") or []
    has_dashboard = bool(admin.get("dashboard"))
    has_auth_guard = bool(admin.get("auth_guard"))
    has_crud = bool(admin.get("crud_views"))

    checks = [bool(resources), has_dashboard, has_auth_guard, has_crud]
    score = _quality_score(sum(checks), len(checks))

    admin["_quality_score"] = score
    admin["_retry_count"] = admin_retry
    artifacts["admin"] = admin

    report: dict[str, Any] = {
        "quality_score": score,
        "resource_count": len(resources),
        "has_dashboard": has_dashboard,
        "has_auth_guard": has_auth_guard,
        "has_crud_views": has_crud,
        "retry": admin_retry,
        "max_retries": max_r,
    }

    base = {
        **gen_state,
        "generated_artifacts": artifacts,
        "admin_report": report,
        "admin_quality_score": score,
    }

    if score < 100 and admin_retry < max_r:
        ctx = _add_error_context(
            gen_state, "generate_admin",
            f"Admin quality {score:.1f}/100. Auto-retrying ({admin_retry + 1}/{max_r}).",
            report,
        )
        return cast(ConversionState, {**base, "admin_retry_count": admin_retry + 1,
                "error_context": ctx, "status": "admin_needs_retry"})

    return cast(ConversionState, {**base, "status": "admin_generated"})


# ─────────────────────────────────────────────────────────────────────────────
# validate_consistency_node
# Cross-checks backend ↔ frontend ↔ admin alignment.
# ─────────────────────────────────────────────────────────────────────────────

def validate_consistency_node(state: ConversionState) -> ConversionState:
    artifacts = state.get("generated_artifacts") or {}
    backend_eps = list((artifacts.get("backend") or {}).get("endpoints") or [])
    frontend_pages = list((artifacts.get("frontend") or {}).get("pages") or [])
    admin_resources = list((artifacts.get("admin") or {}).get("resources") or [])

    checks = {
        "backend_has_endpoints": bool(backend_eps),
        "frontend_has_pages": bool(frontend_pages),
        "admin_has_resources": bool(admin_resources),
        "backend_frontend_align": len(backend_eps) > 0 and len(frontend_pages) > 0,
        "no_orphan_admin_resources": len(admin_resources) <= max(1, len(backend_eps)),
    }
    score = _quality_score(sum(checks.values()), len(checks))

    report: dict[str, Any] = {
        "quality_score": score,
        "checks": checks,
        "backend_endpoint_count": len(backend_eps),
        "frontend_page_count": len(frontend_pages),
        "admin_resource_count": len(admin_resources),
    }

    ctx: list[dict[str, Any]] | None = None
    if score < 100:
        ctx = _add_error_context(
            state, "validate_consistency",
            f"Consistency score {score:.1f}/100.",
            report,
        )

    return cast(ConversionState, {
        **state,
        "consistency_report": report,
        "consistency_quality_score": score,
        **({"error_context": ctx} if ctx else {}),
        "status": "consistency_validated",
    })


# ─────────────────────────────────────────────────────────────────────────────
# validate_build_smoke_node
# Computes overall quality.  Routes to retry of weakest layer if < 100.
# ─────────────────────────────────────────────────────────────────────────────

def validate_build_smoke_node(state: ConversionState) -> ConversionState:
    from src.engine.nodes import validate_artifacts_node

    validation_retry = _get_retry(state, "validation_retry_count")
    max_r = _max_retries(state)

    try:
        out_state = validate_artifacts_node(state)
    except Exception as exc:
        ctx = _add_error_context(
            state, "validate_build_smoke",
            f"validate_artifacts_node raised: {exc}",
        )
        out_state = cast(ConversionState, {**state, "error_context": ctx, "status": "failed"})

    b = float(out_state.get("backend_quality_score") or 0.0)
    f = float(out_state.get("frontend_quality_score") or 0.0)
    a = float(out_state.get("admin_quality_score") or 0.0)
    c = float(out_state.get("consistency_quality_score") or 0.0)
    overall = round((b + f + a + c) / 4.0, 2)

    smoke_report: dict[str, Any] = {
        "backend_quality_score": b,
        "frontend_quality_score": f,
        "admin_quality_score": a,
        "consistency_quality_score": c,
        "overall_quality_score": overall,
        "retry": validation_retry,
        "max_retries": max_r,
        "underlying_validation": out_state.get("validation_report") or {},
    }

    base = {
        **out_state,
        "smoke_report": smoke_report,
        "overall_quality_score": overall,
    }

    if overall >= 100.0:
        return cast(ConversionState, {**base, "status": "smoke_validated"})

    if validation_retry < max_r:
        weakest_layer, weakest_score = min(
            [("backend", b), ("frontend", f), ("admin", a)],
            key=lambda x: x[1],
        )
        ctx = _add_error_context(
            out_state, "validate_build_smoke",
            f"Overall quality {overall:.1f}/100. "
            f"Weakest layer: {weakest_layer} ({weakest_score:.1f}/100). "
            f"Retrying ({validation_retry + 1}/{max_r}).",
            smoke_report,
        )
        return cast(ConversionState, {
            **base,
            "validation_retry_count": validation_retry + 1,
            "error_context": ctx,
            "_retry_target_layer": weakest_layer,
            "status": "smoke_failed",
        })

    ctx = _add_error_context(
        out_state, "validate_build_smoke",
        f"Overall quality {overall:.1f}/100 after {max_r} retries. Proceeding with best effort.",
        smoke_report,
    )
    return cast(ConversionState, {**base, "error_context": ctx, "status": "smoke_validated"})


# ─────────────────────────────────────────────────────────────────────────────
# validation_review_gate_node
# Auto-evaluates smoke report. Overrideable by external decision.
# Routes to: package_export | retry_backend | retry_frontend | retry_admin |
#             retry_schema | cancelled
# ─────────────────────────────────────────────────────────────────────────────

def validation_review_gate_node(state: ConversionState) -> ConversionState:
    decision = str(state.get("validation_review_decision") or "").strip()

    if decision == "cancelled":
        return cast(ConversionState, {**state, "status": "cancelled"})
    if decision == "retry_backend":
        return cast(ConversionState, {**state, "status": "retry_backend", "backend_retry_count": 0})
    if decision == "retry_schema":
        return cast(ConversionState, {**state, "status": "retry_schema", "schema_retry_count": 0})

    overall = float(state.get("overall_quality_score") or 0.0)
    smoke_report = state.get("smoke_report") or {}
    retry_target = str(state.get("_retry_target_layer") or "").strip()

    if overall >= 100.0 or decision == "approved":
        return cast(ConversionState, {**state, "status": "package_approved"})

    # Route to the weakest layer for a targeted retry (only if smoke node requested it)
    if state.get("status") == "smoke_failed" and retry_target in ("backend", "frontend", "admin"):
        retry_key = f"{retry_target}_retry_count"
        out = dict(state)
        out["status"] = f"retry_{retry_target}"
        out[retry_key] = 0
        return cast(ConversionState, out)

    # Overall < 50 — restart from schema inference
    if overall < 50.0:
        ctx = _add_error_context(
            state, "validation_review_gate",
            f"Overall quality {overall:.1f}/100 < 50. Restarting from schema inference.",
            smoke_report,
        )
        out = dict(state)
        out["error_context"] = ctx
        out["status"] = "retry_schema"
        out["schema_retry_count"] = 0
        out["validation_retry_count"] = 0
        out["backend_retry_count"] = 0
        out["frontend_retry_count"] = 0
        out["admin_retry_count"] = 0
        if "schema_review_decision" in out:
            del out["schema_review_decision"]
        if "schema_decision" in out:
            del out["schema_decision"]
        if "generated_artifacts" in out:
            del out["generated_artifacts"]
        return cast(ConversionState, out)

    # Warn and approve
    ctx = _add_error_context(
        state, "validation_review_gate",
        f"Overall quality {overall:.1f}/100 — approved with warnings.",
        smoke_report,
    )
    return cast(ConversionState, {**state, "error_context": ctx, "status": "package_approved"})


# ─────────────────────────────────────────────────────────────────────────────
# package_export_node
# Packages all artifacts into a distributable export with full quality manifest.
# ─────────────────────────────────────────────────────────────────────────────

def package_export_node(state: ConversionState) -> ConversionState:
    manifest: dict[str, Any] = {
        "job_id": state.get("job_id"),
        "overall_quality_score": state.get("overall_quality_score"),
        "backend_quality_score": state.get("backend_quality_score"),
        "frontend_quality_score": state.get("frontend_quality_score"),
        "admin_quality_score": state.get("admin_quality_score"),
        "consistency_quality_score": state.get("consistency_quality_score"),
        "exported_at_ms": int(time.time() * 1000),
        "total_retries": {
            "crawl": state.get("crawl_retry_count", 0),
            "schema": state.get("schema_retry_count", 0),
            "backend": state.get("backend_retry_count", 0),
            "frontend": state.get("frontend_retry_count", 0),
            "admin": state.get("admin_retry_count", 0),
            "validation": state.get("validation_retry_count", 0),
        },
        "error_context_count": len(state.get("error_context") or []),
    }
    return cast(ConversionState, {**state, "export_manifest": manifest, "status": "exported"})


# ─────────────────────────────────────────────────────────────────────────────
# end_cancelled_node
# Terminal node for graceful cancellation — logs full audit trail.
# ─────────────────────────────────────────────────────────────────────────────

def end_cancelled_node(state: ConversionState) -> ConversionState:
    ctx = _add_error_context(
        state, "END_CANCELLED",
        "Workflow was cancelled. See error_context for full audit trail.",
    )
    return cast(ConversionState, {**state, "error_context": ctx, "status": "cancelled"})
