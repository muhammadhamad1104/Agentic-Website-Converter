from __future__ import annotations

from unittest.mock import patch


class _FakeLLM:
    def invoke(self, prompt: str) -> str:
                return """
                {
                    "entities": [
                        {
                            "name": "BlogCard",
                            "confidence": 0.9,
                            "evidence": ["class=blog-card"],
                            "fields": [
                                {"name": "title", "type": "string", "confidence": 0.92, "evidence": ["text"]}
                            ]
                        }
                    ],
                    "relationships": [],
                    "assumptions": ["blog cards map to content rows"]
                }
                """


def test_mcp_tool_functions_work_end_to_end() -> None:
    with patch("src.engine.service.ConversionEngine._build_failover_llm", return_value=_FakeLLM()):
        from src import mcp_server

        created = mcp_server.create_conversion_job_impl(
            html_pages=[
                "<div class='blog-card'>A</div><div class='blog-card'>B</div><div class='blog-card'>C</div>"
            ],
            depth_limit=1,
            max_pages=3,
            same_domain_only=True,
        )
        job_id = created["job_id"]
        assert "max_assets" in created["crawl_config"]

        first = mcp_server.run_conversion_impl(job_id)
        assert first["status"] == "awaiting_approval"
        assert "extraction_report" in first
        assert "schema_quality_report" in first
        assert "quality_summary" in first

        mcp_server.submit_schema_decision_impl(job_id, "approved")
        second = mcp_server.run_conversion_impl(job_id)
        assert second["status"] == "validated"
        assert second["scaffold_quality_report"]["quality_gate"] == "open"
        assert second["artifact_generation_report"]["quality_gate"] == "open"
        assert second["quality_summary"]["phase_gates"]["validation"] == "open"

        fetched = mcp_server.get_conversion_job_impl(job_id)
        assert fetched["job_id"] == job_id
        assert "schema_quality_report" in fetched
        assert "artifact_generation_report" in fetched
        assert "quality_summary" in fetched

        schema_history = mcp_server.get_schema_history_impl(job_id)
        assert schema_history["schema_versions"]

        artifact_history = mcp_server.get_artifact_history_impl(job_id)
        assert artifact_history["artifact_versions"]

        trace_all = mcp_server.get_trace_events_impl(job_id)
        assert trace_all["trace_events"]

        trace_filtered = mcp_server.get_trace_events_impl(job_id, node="approval_gate")
        assert trace_filtered["trace_events"]
        assert all(event.get("node") == "approval_gate" for event in trace_filtered["trace_events"])

        trace_limited = mcp_server.get_trace_events_impl(job_id, limit=2)
        assert len(trace_limited["trace_events"]) <= 2

        crawl_report = mcp_server.get_crawl_report_impl(job_id)
        assert crawl_report["job_id"] == job_id
        assert crawl_report["totals"]["pages_crawled"] >= 1

        exported = mcp_server.export_conversion_impl(job_id)
        assert exported["export_status"] == "ready"
