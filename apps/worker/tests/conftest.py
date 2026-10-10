from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.config.settings import settings


@pytest.fixture(autouse=True)
def isolate_worker_settings(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "LANGSMITH_TRACING", False)
    monkeypatch.setattr(settings, "QUALITY_PROFILE", "prod")
    monkeypatch.setattr(settings, "QUALITY_USE_PROFILE_PRESETS", True)
    monkeypatch.setattr(settings, "EXPORT_COPY_TO_DOWNLOADS", False)
    monkeypatch.setenv("LANGSMITH_TRACING", "false")
    monkeypatch.setenv("LANGCHAIN_TRACING_V2", "false")


@pytest.fixture
def successful_runtime_build(monkeypatch):
    # Orchestration tests isolate npm/browser work; the opt-in integration test
    # exercises the real validator and generated application.
    def validated(state):
        return {**state, "status": "validated", "validation_report": {
            "validation_gate": "open", "build_status": "passed", "deployment_ready": True,
            "readiness_score": 100, "min_readiness_score_required": 100, "checks": [], "issues": []}}
    monkeypatch.setattr("src.engine.runtime_validation.validate_runtime", validated)


@pytest.fixture(autouse=True, scope="session")
def _redirect_generated_output_for_tests(tmp_path_factory: pytest.TempPathFactory):
    original = settings.GENERATED_OUTPUT_PATH
    temp_output = tmp_path_factory.mktemp("generated_artifacts")
    settings.GENERATED_OUTPUT_PATH = str(temp_output)
    try:
        yield
    finally:
        settings.GENERATED_OUTPUT_PATH = original
