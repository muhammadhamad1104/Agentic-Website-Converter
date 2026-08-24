from __future__ import annotations

from pathlib import Path
from unittest.mock import Mock, patch

from src.engine.nodes import (
    approval_gate_node,
    crawl_site_node,
    extract_content_node,
    generate_artifacts_node,
    infer_schema_node,
    prepare_template_scaffold_node,
    validate_artifacts_node,
)
from src.engine.workflow import build_conversion_workflow


SAMPLE_HTML = """
<html>
  <body>
    <div class=\"product-card\"><h2>Alpha</h2><p>A</p><a href=\"/a\">Read</a></div>
    <div class=\"product-card\"><h2>Beta</h2><p>B</p><a href=\"/b\">Read</a></div>
    <div class=\"product-card\"><h2>Gamma</h2><p>C</p><a href=\"/c\">Read</a></div>
  </body>
</html>
"""


def test_infer_schema_node_produces_entities() -> None:
    state = {"html_pages": [SAMPLE_HTML], "schema_decision": "pending", "errors": []}
    result = infer_schema_node(state)
    assert result["status"] == "schema_proposed"
    assert result["schema_proposal"]["entities"]


def test_crawl_node_uses_inline_html_when_provided() -> None:
    result = crawl_site_node({"html_pages": [SAMPLE_HTML], "errors": []})
    assert result["status"] == "crawled"
    assert result["crawled_pages"]


def test_extract_node_produces_blocks_from_crawled_pages() -> None:
    result = extract_content_node({"crawled_pages": [SAMPLE_HTML], "errors": []})
    assert result["status"] == "extracted"
    assert result["extracted_blocks"]


def test_extract_node_keeps_per_page_fallback_for_sparse_pages() -> None:
    pages = [
        "<html><body><main>Alpha minimal content</main></body></html>",
        "<html><body><main>Beta minimal content</main></body></html>",
    ]

    with patch("src.engine.nodes.settings.QUALITY_USE_PROFILE_PRESETS", False):
        with patch("src.engine.nodes.settings.QUALITY_EXTRACTION_MIN_BLOCK_CHAR_LENGTH", 1):
            result = extract_content_node({"crawled_pages": pages, "errors": []})

    assert result["status"] == "extracted"
    assert any("Alpha minimal content" in block for block in result["extracted_blocks"])
    assert any("Beta minimal content" in block for block in result["extracted_blocks"])


def test_extract_node_respects_configured_block_limit() -> None:
    html = """
    <html><body>
      <div class='alpha'>A1</div><div class='alpha'>A2</div>
      <section class='beta'>B1</section><section class='beta'>B2</section>
      <article class='gamma'>C1</article><article class='gamma'>C2</article>
    </body></html>
    """

    with patch("src.engine.nodes.settings.QUALITY_USE_PROFILE_PRESETS", False):
        with patch("src.engine.nodes.settings.QUALITY_EXTRACTION_MAX_BLOCKS", 2):
            with patch("src.engine.nodes.settings.QUALITY_EXTRACTION_MIN_BLOCK_CHAR_LENGTH", 1):
                result = extract_content_node({"crawled_pages": [html], "errors": []})

    assert result["status"] == "extracted"
    assert len(result["extracted_blocks"]) == 2
    assert result["extraction_report"]["max_blocks"] == 2


def test_crawl_node_respects_depth_and_same_domain() -> None:
    root_html = """
    <html><body>
      <a href='/a'>A</a>
      <a href='https://external.example/x'>X</a>
    </body></html>
    """
    page_a_html = """
    <html><body>
      <a href='/b'>B</a>
      <div class='item'>1</div><div class='item'>2</div>
    </body></html>
    """

    def fake_get(url: str, timeout: int = 12):
        resp = Mock()
        resp.raise_for_status = Mock()
        if url.endswith("/a"):
            resp.text = page_a_html
        else:
            resp.text = root_html
        return resp

    with patch("src.engine.nodes.requests.get", side_effect=fake_get):
        result = crawl_site_node(
            {
                "input_url": "https://example.com",
                "crawl_depth_limit": 1,
                "crawl_max_pages": 4,
                "crawl_same_domain_only": True,
                "crawl_include_sitemap_seeds": False,
                "crawl_render_js": False,
                "errors": [],
            }
        )

    assert result["status"] == "crawled"
    assert len(result["crawled_pages"]) == 2
    assert all("external.example" not in p for p in result["sitemap"]["pages"])


def test_approval_gate_pending_blocks_generation() -> None:
    state = {"schema_decision": "pending", "status": "schema_proposed", "errors": []}
    result = approval_gate_node(state)
    assert result["status"] == "awaiting_approval"


def test_generation_requires_approved_schema() -> None:
    result = generate_artifacts_node({"status": "schema_proposed", "errors": []})
    assert result["status"] == "failed"
    assert "before template scaffold preparation" in result["errors"][0]


def test_prepare_template_scaffold_node_after_approval(tmp_path: Path) -> None:
    scaffold_dir = tmp_path / "website_template_j1"
    scaffold_dir.mkdir(parents=True)

    with patch("src.engine.nodes.materialize_template_structure") as mock_template:
        mock_template.return_value = {
            "name": "website_template_j1",
            "path": str(scaffold_dir),
            "dir_count": 26,
            "file_count": 35,
            "source": "generate_same_project.py",
        }
        result = prepare_template_scaffold_node({"job_id": "j1", "status": "approved", "errors": []})

    assert result["status"] == "template_ready"
    assert result["template_scaffold"]["dir_count"] == 26
    assert result["scaffold_quality_report"]["quality_gate"] == "open"


def test_generate_artifacts_blocks_when_schema_gate_not_open() -> None:
    state = {
        "status": "template_ready",
        "schema_proposal": {
            "entities": [
                {
                    "name": "Product",
                    "confidence": 0.9,
                    "fields": [{"name": "title", "type": "string", "confidence": 0.9, "evidence": []}],
                }
            ]
        },
        "schema_quality_report": {"quality_gate": "blocked"},
        "scaffold_quality_report": {"quality_gate": "open"},
        "template_scaffold": {
            "name": "website_template_j1",
            "path": "generated/website_template_j1",
            "dir_count": 26,
            "file_count": 35,
        },
        "errors": [],
    }

    with patch("src.engine.nodes.settings.QUALITY_USE_PROFILE_PRESETS", False):
        with patch("src.engine.nodes.settings.QUALITY_GENERATION_REQUIRE_SCHEMA_QUALITY_GATE", True):
            result = generate_artifacts_node(state)

    assert result["status"] == "failed"
    assert any("schema quality gate" in message.lower() for message in result["errors"])
    assert result["artifact_generation_report"]["quality_gate"] == "blocked"
    quality_events = [event for event in result.get("trace_events", []) if event.get("event_type") == "quality_gate"]
    assert any(event.get("gate") == "artifact_generation" for event in quality_events)


def test_generate_artifacts_emits_quality_report_when_inputs_ready() -> None:
    state = {
        "status": "template_ready",
        "schema_proposal": {
            "entities": [
                {
                    "name": "Product",
                    "confidence": 0.9,
                    "fields": [{"name": "title", "type": "string", "confidence": 0.9, "evidence": []}],
                }
            ]
        },
        "schema_quality_report": {"quality_gate": "open"},
        "scaffold_quality_report": {"quality_gate": "open"},
        "template_scaffold": {
            "name": "website_template_j1",
            "path": "generated/website_template_j1",
            "dir_count": 26,
            "file_count": 35,
        },
        "errors": [],
    }

    with patch("src.engine.nodes.settings.QUALITY_USE_PROFILE_PRESETS", False):
        with patch("src.engine.nodes.settings.QUALITY_GENERATION_REQUIRE_SCHEMA_QUALITY_GATE", True):
            with patch("src.engine.nodes.settings.QUALITY_GENERATION_REQUIRE_SCAFFOLD_QUALITY_GATE", True):
                result = generate_artifacts_node(state)

    assert result["status"] == "generated"
    assert result["artifact_generation_report"]["quality_gate"] == "open"
    assert result["artifact_generation_report"]["inherited_gates"]["schema_quality_gate"] == "open"
    assert result["artifact_generation_report"]["inherited_gates"]["scaffold_quality_gate"] == "open"
    quality_events = [event for event in result.get("trace_events", []) if event.get("event_type") == "quality_gate"]
    assert any(event.get("gate") == "artifact_generation" for event in quality_events)


def test_validation_passes_with_generated_artifacts() -> None:
    state = {
        "schema_proposal": {
            "entities": [
                {
                    "name": "Product",
                    "confidence": 0.9,
                    "fields": [{"name": "title", "type": "string", "confidence": 0.9, "evidence": []}],
                }
            ]
        },
        "generated_artifacts": {
            "backend": {"endpoints": ["/product"]},
            "frontend": {"pages": ["product"]},
            "admin": {"resources": ["Product"]},
            "entity_catalog": [{"name": "Product", "slug": "product"}],
            "deployment": {
                "health_endpoint": "/health",
                "backend_start_command": "npm run start",
                "frontend_build_command": "npm run build",
            },
        }
    }
    result = validate_artifacts_node(state)
    assert result["status"] == "validated"
    assert result["validation_report"]["validation_gate"] == "open"
    assert result["validation_report"]["deployment_ready"] is True


def test_validation_blocks_when_deployment_metadata_missing() -> None:
    state = {
        "schema_proposal": {
            "entities": [
                {
                    "name": "Product",
                    "confidence": 0.9,
                    "fields": [{"name": "title", "type": "string", "confidence": 0.9, "evidence": []}],
                }
            ]
        },
        "generated_artifacts": {
            "backend": {"endpoints": ["/product"]},
            "frontend": {"pages": ["product"]},
            "admin": {"resources": ["Product"]},
        },
        "errors": [],
    }
    result = validate_artifacts_node(state)
    assert result["status"] == "failed"
    assert result["validation_report"]["validation_gate"] == "blocked"
    assert any("deployment" in message.lower() for message in result["errors"])


def test_workflow_stops_at_human_gate_when_pending() -> None:
    workflow = build_conversion_workflow()
    result = workflow.invoke(
        {
            "job_id": "j1",
            "html_pages": [SAMPLE_HTML],
            "schema_decision": "pending",
            "status": "draft",
            "errors": [],
        }
    )
    assert result["status"] == "awaiting_approval"
    assert result["schema_proposal"]["entities"]


def test_workflow_reaches_validated_when_approved() -> None:
    workflow = build_conversion_workflow()
    result = workflow.invoke(
        {
            "job_id": "j2",
            "html_pages": [SAMPLE_HTML],
            "schema_decision": "approved",
            "status": "draft",
            "errors": [],
        }
    )
    assert result["status"] == "validated"
    assert result["generated_artifacts"]["backend"]["endpoints"]


def test_workflow_emits_structured_quality_gate_audit_events() -> None:
    workflow = build_conversion_workflow()
    result = workflow.invoke(
        {
            "job_id": "j2-audit",
            "html_pages": [SAMPLE_HTML],
            "schema_decision": "approved",
            "status": "draft",
            "errors": [],
        }
    )

    assert result["status"] == "validated"
    trace_events = result.get("trace_events", [])
    quality_events = [event for event in trace_events if event.get("event_type") == "quality_gate"]
    assert quality_events

    gate_names = {str(event.get("gate", "")) for event in quality_events}
    assert {
        "extraction_quality",
        "schema_quality",
        "template_scaffold",
        "artifact_generation",
        "artifact_validation",
    }.issubset(gate_names)
    assert all("blocker_count" in event for event in quality_events)
    assert all("quality_gate" in event for event in quality_events)


def test_workflow_stops_after_schema_inference_failure() -> None:
    workflow = build_conversion_workflow()
    result = workflow.invoke(
        {
            "job_id": "j3",
            "html_pages": ["<html><body><div>Only one value</div></body></html>"],
            "schema_decision": "pending",
            "status": "draft",
            "errors": [],
        }
    )
    assert result["status"] == "failed"
    assert any(
        any(token in message.lower() for token in {"schema", "extraction", "representative content"})
        for message in result["errors"]
    )
