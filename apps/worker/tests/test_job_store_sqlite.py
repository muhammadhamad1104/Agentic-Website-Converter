from __future__ import annotations

import sqlite3

from src.engine.job_store import SqliteJobStore
from src.engine.models import JobStatus


def test_sqlite_job_store_create_and_get(tmp_path) -> None:
    db_path = tmp_path / "jobs.db"
    store = SqliteJobStore(str(db_path))

    created = store.create_job(input_url="https://example.com", html_pages=["<html></html>"])
    loaded = store.get_job(created.job_id)

    assert loaded is not None
    assert loaded.job_id == created.job_id
    assert loaded.input_url == "https://example.com"
    assert loaded.html_pages == ["<html></html>"]
    assert loaded.status == JobStatus.DRAFT


def test_sqlite_job_store_save_updates_values(tmp_path) -> None:
    db_path = tmp_path / "jobs.db"
    store = SqliteJobStore(str(db_path))

    job = store.create_job(html_pages=["<div class='card'>A</div>"])
    job.crawl_artifacts = {"totals": {"pages_crawled": 1, "assets_downloaded": 0, "failures": 0}}
    job.extraction_report = {"quality_gate": "open", "pages_with_blocks": 1}
    job.schema_decision = "approved"
    job.status = JobStatus.APPROVED
    job.schema_proposal = {"entities": [{"name": "Card", "fields": []}]}
    job.schema_quality_report = {"quality_gate": "open"}
    job.scaffold_quality_report = {"quality_gate": "open", "dir_count": 26, "file_count": 35}
    job.artifact_generation_report = {"quality_gate": "open", "entity_count": 1}
    store.save_job(job)

    loaded = store.get_job(job.job_id)
    assert loaded is not None
    assert loaded.schema_decision == "approved"
    assert loaded.status == JobStatus.APPROVED
    assert loaded.schema_proposal["entities"][0]["name"] == "Card"
    assert loaded.crawl_artifacts["totals"]["pages_crawled"] == 1
    assert loaded.extraction_report["quality_gate"] == "open"
    assert loaded.schema_quality_report["quality_gate"] == "open"
    assert loaded.scaffold_quality_report["quality_gate"] == "open"
    assert loaded.artifact_generation_report["quality_gate"] == "open"
    assert loaded.to_dict()["quality_summary"]["phase_gates"]["schema"] == "open"
    assert loaded.to_dict()["quality_summary"]["phase_gates"]["validation"] == "unknown"

    schema_versions = store.get_schema_history(job.job_id)
    assert len(schema_versions) >= 1

    job.generated_artifacts = {"backend": {"endpoints": ["/card"]}}
    store.save_job(job)
    artifact_versions = store.get_artifact_history(job.job_id)
    assert len(artifact_versions) >= 1


def test_sqlite_job_store_migrates_legacy_schema_with_missing_columns(tmp_path) -> None:
    db_path = tmp_path / "legacy_jobs.db"

    with sqlite3.connect(str(db_path)) as conn:
        conn.execute(
            """
            CREATE TABLE conversion_jobs (
                job_id TEXT PRIMARY KEY,
                input_url TEXT,
                html_pages TEXT NOT NULL,
                schema_proposal TEXT NOT NULL,
                schema_decision TEXT NOT NULL,
                generated_artifacts TEXT NOT NULL,
                validation_report TEXT NOT NULL,
                status TEXT NOT NULL,
                errors TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            INSERT INTO conversion_jobs (
                job_id,
                input_url,
                html_pages,
                schema_proposal,
                schema_decision,
                generated_artifacts,
                validation_report,
                status,
                errors
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "legacy-job-1",
                "https://example.com",
                "[]",
                "{}",
                "pending",
                "{}",
                "{}",
                "draft",
                "[]",
            ),
        )
        conn.commit()

    store = SqliteJobStore(str(db_path))
    loaded = store.get_job("legacy-job-1")

    assert loaded is not None
    assert loaded.status == JobStatus.DRAFT
    assert loaded.crawl_config == {}
    assert loaded.crawl_artifacts == {}
    assert loaded.extraction_report == {}
    assert loaded.schema_quality_report == {}
    assert loaded.scaffold_quality_report == {}
    assert loaded.artifact_generation_report == {}
    assert loaded.trace_events == []

    with sqlite3.connect(str(db_path)) as conn:
        columns = {
            row[1]
            for row in conn.execute("PRAGMA table_info(conversion_jobs)").fetchall()
        }

    assert "crawl_config" in columns
    assert "crawl_artifacts" in columns
    assert "extraction_report" in columns
    assert "schema_quality_report" in columns
    assert "scaffold_quality_report" in columns
    assert "artifact_generation_report" in columns
    assert "trace_events" in columns
