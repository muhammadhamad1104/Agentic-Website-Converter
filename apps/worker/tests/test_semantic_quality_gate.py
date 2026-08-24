from __future__ import annotations

from unittest.mock import patch

from src.engine.nodes import validate_artifacts_node


def test_validation_blocks_generic_entity_schema() -> None:
    state = {
        "schema_proposal": {
            "entities": [
                {"name": "Link"},
                {"name": "Div"},
                {"name": "Container"},
                {"name": "Row"},
                {"name": "Img"},
            ]
        },
        "generated_artifacts": {
            "backend": {"endpoints": ["/link", "/div", "/container"]},
            "frontend": {"pages": ["link"]},
            "admin": {"resources": ["Link"]},
        },
    }

    result = validate_artifacts_node(state)
    assert result["status"] == "failed"
    assert result["validation_report"]["validation_gate"] == "blocked"
    assert any(issue["id"] == "semantic_entity_quality" for issue in result["validation_report"]["issues"])


def test_validation_allows_semantic_entity_schema() -> None:
    state = {
        "schema_proposal": {
            "entities": [
                {"name": "Project"},
                {"name": "Service"},
                {"name": "Testimonial"},
            ]
        },
        "generated_artifacts": {
            "backend": {"endpoints": ["/project", "/service", "/testimonial"]},
            "frontend": {"pages": ["project", "service", "testimonial"]},
            "admin": {"resources": ["Project", "Service", "Testimonial"]},
            "entity_catalog": [
                {"name": "Project", "slug": "project"},
                {"name": "Service", "slug": "service"},
                {"name": "Testimonial", "slug": "testimonial"},
            ],
            "deployment": {
                "health_endpoint": "/health",
                "backend_start_command": "npm run start",
                "frontend_build_command": "npm run build",
            },
        },
    }

    result = validate_artifacts_node(state)
    assert result["status"] == "validated"
    assert result["validation_report"]["validation_gate"] == "open"


def test_validation_blocks_when_entity_endpoints_do_not_align() -> None:
    state = {
        "schema_proposal": {
            "entities": [
                {"name": "Project"},
                {"name": "Service"},
            ]
        },
        "generated_artifacts": {
            "backend": {"endpoints": ["/project"]},
            "frontend": {"pages": ["project", "service"]},
            "admin": {"resources": ["Project", "Service"]},
            "entity_catalog": [
                {"name": "Project", "slug": "project"},
                {"name": "Service", "slug": "service"},
            ],
            "deployment": {
                "health_endpoint": "/health",
                "backend_start_command": "npm run start",
                "frontend_build_command": "npm run build",
            },
        },
        "errors": [],
    }

    result = validate_artifacts_node(state)
    assert result["status"] == "failed"
    assert any(issue["id"] == "endpoint_entity_alignment" for issue in result["validation_report"]["issues"])


def test_validation_respects_configurable_readiness_threshold() -> None:
    state = {
        "schema_proposal": {
            "entities": [
                {"name": "Project"},
                {"name": "Service"},
                {"name": "Testimonial"},
            ]
        },
        "generated_artifacts": {
            "backend": {"endpoints": ["/project", "/service", "/testimonial"]},
            "frontend": {"pages": ["project", "service", "testimonial"]},
            "admin": {"resources": ["Project", "Service", "Testimonial"]},
            "entity_catalog": [
                {"name": "Project", "slug": "project"},
                {"name": "Service", "slug": "service"},
                {"name": "Testimonial", "slug": "testimonial"},
            ],
            "deployment": {
                "health_endpoint": "/health",
                "backend_start_command": "npm run start",
                "frontend_build_command": "npm run build",
            },
        },
        "errors": [],
    }

    with patch("src.engine.nodes.settings.QUALITY_USE_PROFILE_PRESETS", False):
        with patch("src.engine.nodes.settings.QUALITY_VALIDATION_MIN_READINESS_SCORE", 95.0):
            result = validate_artifacts_node(state)

    assert result["status"] == "failed"
    assert any(issue["id"] == "readiness_score_threshold" for issue in result["validation_report"]["issues"])