from __future__ import annotations

from unittest.mock import patch
import pytest
from src.engine.job_store import InMemoryJobStore

pytestmark = pytest.mark.usefixtures("successful_runtime_build")

from src.engine.service import ConversionEngine


SAMPLE_HTML = """
<html>
  <body>
    <li class=\"team-card\">Alice</li>
    <li class=\"team-card\">Bob</li>
    <li class=\"team-card\">Cara</li>
  </body>
</html>
"""


class _FakeLLM:
    def invoke(self, prompt: str) -> str:
        return '{"entities":[{"name":"TeamMember","confidence":0.95,"fields":[{"name":"name","type":"string","confidence":0.95,"evidence":["team-card"]}]}]}'


def _build_engine_without_external_llm() -> ConversionEngine:
    with patch.object(ConversionEngine, "_build_failover_llm", return_value=_FakeLLM()):
        return ConversionEngine(store=InMemoryJobStore())


def test_engine_flow_human_gate_then_approval() -> None:
    engine = _build_engine_without_external_llm()
    created = engine.create_job(html_pages=[SAMPLE_HTML])
    job_id = created["job_id"]

    assert engine.run_job(job_id)["status"] == "crawled"
    first_run = engine.infer_schema_stage(job_id)
    assert first_run["status"] == "awaiting_approval"
    assert first_run["schema_proposal"]["entities"]
    assert first_run["crawl_artifacts"]["totals"]["pages_crawled"] == 1
    assert "extraction_report" in first_run
    assert "schema_quality_report" in first_run
    assert "quality_summary" in first_run
    assert "phase_gates" in first_run["quality_summary"]

    engine.decide_schema(job_id, "approved")
    second_run = engine.run_job(job_id)
    assert second_run["status"] == "validated"
    assert second_run["validation_report"]["build_status"] == "passed"
    assert second_run["scaffold_quality_report"]["quality_gate"] == "open"
    assert second_run["artifact_generation_report"]["quality_gate"] == "open"
    assert second_run["quality_summary"]["phase_gates"]["validation"] == "open"
    assert second_run["quality_summary"]["overall_gate"] == "open"


def test_engine_reject_path_requires_new_schema_approval() -> None:
    engine = _build_engine_without_external_llm()
    created = engine.create_job(html_pages=[SAMPLE_HTML])
    job_id = created["job_id"]

    engine.run_job(job_id)
    engine.infer_schema_stage(job_id)
    rejected = engine.decide_schema(job_id, "rejected", "Revise team fields")
    assert not rejected["schema_proposal"]
    assert rejected["schema_decision"] == "pending"
    result = engine.infer_schema_stage(job_id)

    assert result["status"] == "awaiting_approval"
    assert not result["generated_artifacts"]


def test_run_job_is_idempotent_after_validated() -> None:
    engine = _build_engine_without_external_llm()
    created = engine.create_job(html_pages=[SAMPLE_HTML])
    job_id = created["job_id"]

    engine.run_job(job_id)
    engine.infer_schema_stage(job_id)
    engine.decide_schema(job_id, "approved")
    validated = engine.run_job(job_id)
    assert validated["status"] == "validated"

    with patch.object(engine.workflow, "invoke", side_effect=AssertionError("workflow should not run again")):
        second = engine.run_job(job_id)
    assert second["status"] == "validated"


def test_run_job_returns_node_trace_events() -> None:
    engine = _build_engine_without_external_llm()
    created = engine.create_job(html_pages=[SAMPLE_HTML])
    job_id = created["job_id"]

    engine.run_job(job_id)
    first = engine.infer_schema_stage(job_id)
    assert first["status"] == "awaiting_approval"
    events = first.get("trace_events", [])
    assert events
    assert all("node" in event for event in events)
    assert all("duration_ms" in event for event in events)


def test_trace_events_persist_in_job_store() -> None:
    engine = _build_engine_without_external_llm()
    created = engine.create_job(html_pages=[SAMPLE_HTML])
    job_id = created["job_id"]

    engine.run_job(job_id)
    fetched = engine.get_job(job_id)
    events = fetched.get("trace_events", [])
    assert events
    assert events[-1].get("node") == "extract_content"
    assert fetched.get("crawl_artifacts", {}).get("totals", {}).get("pages_crawled") == 1
    assert "extraction_report" in fetched
    assert "schema_quality_report" in fetched
    assert "quality_summary" in fetched


def test_get_crawl_report_returns_summary_fields() -> None:
    engine = _build_engine_without_external_llm()
    created = engine.create_job(html_pages=[SAMPLE_HTML])
    job_id = created["job_id"]

    engine.run_job(job_id)
    report = engine.get_crawl_report(job_id)

    assert report["job_id"] == job_id
    assert report["totals"]["pages_crawled"] == 1
    assert "success_ratio" in report["totals"]
    assert "resume" in report
