from __future__ import annotations

from pathlib import Path
import json
import zipfile
from unittest.mock import patch

import pytest

pytestmark = pytest.mark.usefixtures("successful_runtime_build")

from src.engine.job_store import InMemoryJobStore
from src.engine.package_builder import RUNTIME_REQUIRED_FILES
from src.engine.service import ConversionEngine


HTML_REPEAT = """
<html><body>
<div class=\"card\">A</div><div class=\"card\">B</div><div class=\"card\">C</div>
</body></html>
"""

HTML_NON_REPEAT = """
<html><body><section>Only one block</section></body></html>
"""


class _InvalidLLM:
    def invoke(self, prompt: str) -> str:
        return "invalid-json"


class _StructuredLLM:
    def invoke(self, prompt: str) -> str:
        return """
        {
          "entities": [
            {
              "name": "Service",
              "confidence": 0.9,
              "evidence": ["class=card"],
              "fields": [
                {"name": "title", "type": "string", "confidence": 0.9, "evidence": ["text"]}
              ]
            }
          ],
          "relationships": [],
          "assumptions": ["cards are entity rows"]
        }
        """


def test_lineage_versions_created_for_schema_and_artifacts() -> None:
    store = InMemoryJobStore()
    with patch.object(ConversionEngine, "_build_failover_llm", return_value=_StructuredLLM()):
        engine = ConversionEngine(store=store)

    created = engine.create_job(html_pages=[HTML_REPEAT])
    job_id = created["job_id"]

    engine.run_job(job_id)
    first = engine.infer_schema_stage(job_id)
    assert first["status"] == "awaiting_approval"

    schema_history = engine.get_schema_history(job_id)
    assert len(schema_history) >= 1

    engine.decide_schema(job_id, "approved")
    second = engine.run_job(job_id)
    assert second["status"] == "validated"

    artifact_history = engine.get_artifact_history(job_id)
    assert len(artifact_history) >= 1


def test_export_requires_generated_files() -> None:
    store = InMemoryJobStore()
    with patch.object(ConversionEngine, "_build_failover_llm", return_value=_InvalidLLM()):
        engine = ConversionEngine(store=store)

    created = engine.create_job(html_pages=[HTML_NON_REPEAT])
    job_id = created["job_id"]

    engine.run_job(job_id)
    assert engine.infer_schema_stage(job_id)["status"] == "failed"
    with pytest.raises(ValueError, match="valid schema proposal"):
        engine.decide_schema(job_id, "approved")

    with pytest.raises(ValueError, match="No generated files"):
        engine.export_job(job_id)


def test_export_succeeds_when_validation_gate_open() -> None:
    store = InMemoryJobStore()
    with patch.object(ConversionEngine, "_build_failover_llm", return_value=_StructuredLLM()):
        engine = ConversionEngine(store=store)

    created = engine.create_job(html_pages=[HTML_REPEAT])
    job_id = created["job_id"]

    engine.run_job(job_id)
    engine.infer_schema_stage(job_id)
    engine.decide_schema(job_id, "approved")
    engine.run_job(job_id)

    manifest = engine.export_job(job_id)
    assert manifest["export_status"] == "ready"
    assert manifest["schema_versions"]
    assert manifest["artifact_versions"]
    assert manifest["download"]["zip_path"]
    assert manifest["download"]["project_dir"]


def test_export_zip_contains_runtime_dynamic_website_only() -> None:
    store = InMemoryJobStore()
    with patch.object(ConversionEngine, "_build_failover_llm", return_value=_StructuredLLM()):
        engine = ConversionEngine(store=store)

    created = engine.create_job(html_pages=[HTML_REPEAT])
    job_id = created["job_id"]

    engine.run_job(job_id)
    engine.infer_schema_stage(job_id)
    engine.decide_schema(job_id, "approved")
    engine.run_job(job_id)

    manifest = engine.export_job(job_id)
    zip_path = Path(manifest["download"]["zip_path"])
    assert zip_path.is_file()

    with zipfile.ZipFile(zip_path, "r") as archive:
        names = [name for name in archive.namelist() if name and not name.endswith("/")]

    assert "runtime-manifest.json" in names
    assert all(required in names for required in RUNTIME_REQUIRED_FILES)
    assert not any(name.startswith(".vscode/") for name in names)
    assert not any(name.startswith(".pytest_cache/") for name in names)



@pytest.mark.parametrize("gate,build", [("blocked", "failed"), ("blocked", "not_run"), ("open", "passed")])
def test_export_available_despite_quality_failures(gate, build) -> None:
    store = InMemoryJobStore()
    with patch.object(ConversionEngine, "_build_failover_llm", return_value=_StructuredLLM()):
        engine = ConversionEngine(store=store)

    created = engine.create_job(html_pages=[HTML_REPEAT])
    job_id = created["job_id"]

    engine.run_job(job_id)
    engine.infer_schema_stage(job_id)
    engine.decide_schema(job_id, "approved")
    engine.run_job(job_id)

    job = store.get_job(job_id)
    assert job is not None
    job.validation_report = {
        **(job.validation_report or {}),
        "validation_gate": gate,
        "build_status": build,
        "deployment_ready": False,
        "readiness_score": 40.0,
        "min_readiness_score_required": 80.0,
    }
    store.save_job(job)

    manifest = engine.export_job(job_id)
    assert manifest["export_status"] == "ready"
    assert manifest["quality_status"] == "warnings"
    with zipfile.ZipFile(manifest["download"]["zip_path"]) as archive:
        report = json.loads(archive.read("export-report.json"))
        assert report["deployment_ready"] is False
        assert report["validation_gate"] == gate
        assert report["build_status"] == build
    assert store.get_job(job_id).validation_report["deployment_ready"] is False


def test_export_blocked_when_package_layout_metadata_invalid() -> None:
    store = InMemoryJobStore()
    with patch.object(ConversionEngine, "_build_failover_llm", return_value=_StructuredLLM()):
        engine = ConversionEngine(store=store)

    created = engine.create_job(html_pages=[HTML_REPEAT])
    job_id = created["job_id"]

    engine.run_job(job_id)
    engine.infer_schema_stage(job_id)
    engine.decide_schema(job_id, "approved")
    engine.run_job(job_id)

    with patch("src.engine.service.build_dynamic_site_package", return_value={"project_dir": "", "zip_path": ""}):
        with pytest.raises(ValueError, match="missing required keys"):
            engine.export_job(job_id)


def test_export_blocked_when_zip_is_below_minimum_size(tmp_path: Path) -> None:
    store = InMemoryJobStore()
    with patch.object(ConversionEngine, "_build_failover_llm", return_value=_StructuredLLM()):
        engine = ConversionEngine(store=store)

    created = engine.create_job(html_pages=[HTML_REPEAT])
    job_id = created["job_id"]

    engine.run_job(job_id)
    engine.infer_schema_stage(job_id)
    engine.decide_schema(job_id, "approved")
    engine.run_job(job_id)

    project_dir = tmp_path / "generated_project"
    backend_dir = project_dir / "backend"
    frontend_dir = project_dir / "frontend"
    backend_dir.mkdir(parents=True)
    frontend_dir.mkdir(parents=True)
    (project_dir / "README.md").write_text("generated", encoding="utf-8")
    (backend_dir / "package.json").write_text("{}", encoding="utf-8")
    (frontend_dir / "package.json").write_text("{}", encoding="utf-8")

    zip_path = tmp_path / "generated_project.zip"
    zip_path.write_bytes(b"tiny")

    package_info = {
        "project_dir": str(project_dir),
        "zip_path": str(zip_path),
        "backend_path": str(backend_dir),
        "frontend_path": str(frontend_dir),
    }

    # Build a realistic quality config override for export checks only.
    cfg = {
        "export_require_deployment_ready": True,
        "validation_min_readiness_score": 80.0,
        "export_verify_package_layout": True,
        "export_min_zip_bytes": 1024,
    }

    with patch("src.config.settings.Settings.get_quality_gate_config", return_value=cfg):
        with patch("src.engine.service.build_dynamic_site_package", return_value=package_info):
            with pytest.raises(ValueError, match="below required minimum"):
                engine.export_job(job_id)


def test_export_copies_zip_to_configured_downloads_dir(tmp_path: Path) -> None:
    store = InMemoryJobStore()
    with patch.object(ConversionEngine, "_build_failover_llm", return_value=_StructuredLLM()):
        engine = ConversionEngine(store=store)

    created = engine.create_job(html_pages=[HTML_REPEAT])
    job_id = created["job_id"]

    engine.run_job(job_id)
    engine.infer_schema_stage(job_id)
    engine.decide_schema(job_id, "approved")
    engine.run_job(job_id)

    project_dir = tmp_path / "generated_project"
    backend_dir = project_dir / "backend"
    frontend_dir = project_dir / "frontend"
    backend_dir.mkdir(parents=True)
    frontend_dir.mkdir(parents=True)
    (project_dir / "README.md").write_text("generated", encoding="utf-8")
    (backend_dir / "package.json").write_text("{}", encoding="utf-8")
    (frontend_dir / "package.json").write_text("{}", encoding="utf-8")

    zip_path = tmp_path / "generated_project.zip"
    with zipfile.ZipFile(zip_path, "w") as archive:
        archive.writestr("runtime-manifest.json", "{}")
        for required in RUNTIME_REQUIRED_FILES:
            archive.writestr(required, "ok")

    downloads_dir = tmp_path / "downloads"
    downloads_dir.mkdir(parents=True)

    package_info = {
        "project_dir": str(project_dir),
        "zip_path": str(zip_path),
        "backend_path": str(backend_dir),
        "frontend_path": str(frontend_dir),
    }

    cfg = {
        "export_require_deployment_ready": True,
        "validation_min_readiness_score": 80.0,
        "export_verify_package_layout": True,
        "export_min_zip_bytes": 512,
    }

    with patch("src.config.settings.Settings.get_quality_gate_config", return_value=cfg):
        with patch("src.engine.service.build_dynamic_site_package", return_value=package_info):
            with patch("src.engine.service.settings.EXPORT_COPY_TO_DOWNLOADS", True):
                with patch("src.engine.service.settings.EXPORT_DOWNLOADS_DIR", str(downloads_dir)):
                    manifest = engine.export_job(job_id)

    copy_report = manifest["download"]["downloads_copy"]
    assert copy_report["copied"] is True
    assert Path(copy_report["path"]).is_file()
    assert Path(copy_report["path"]).parent == downloads_dir
    assert manifest["download"]["downloads_path"] == copy_report["path"]
