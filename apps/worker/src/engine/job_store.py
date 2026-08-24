from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
import json
from pathlib import Path
import sqlite3
from threading import Lock
import time
from typing import Any
from uuid import uuid4

from src.engine.models import JobStatus


@dataclass
class ConversionJob:
    job_id: str
    input_url: str | None = None
    html_pages: list[str] = field(default_factory=list)
    crawl_config: dict[str, Any] = field(default_factory=dict)
    crawl_artifacts: dict[str, Any] = field(default_factory=dict)
    crawled_page_map: dict[str, str] = field(default_factory=dict)
    extraction_report: dict[str, Any] = field(default_factory=dict)
    schema_proposal: dict[str, Any] = field(default_factory=dict)
    schema_quality_report: dict[str, Any] = field(default_factory=dict)
    schema_decision: str = "pending"
    schema_rejection_feedback: Any = None
    scaffold_quality_report: dict[str, Any] = field(default_factory=dict)
    generated_artifacts: dict[str, Any] = field(default_factory=dict)
    artifact_generation_report: dict[str, Any] = field(default_factory=dict)
    validation_report: dict[str, Any] = field(default_factory=dict)
    trace_events: list[dict[str, Any]] = field(default_factory=list)
    status: JobStatus = JobStatus.DRAFT
    errors: list[str] = field(default_factory=list)
    created_at_ms: float = field(default_factory=lambda: time.time() * 1000)
    updated_at_ms: float = field(default_factory=lambda: time.time() * 1000)

    @staticmethod
    def _resolve_gate(report: dict[str, Any], *keys: str) -> str:
        if not isinstance(report, dict):
            return "unknown"
        for key in keys:
            value = str(report.get(key, "") or "").strip().lower()
            if value:
                return value
        return "unknown"

    @staticmethod
    def _count_report_issues(report: dict[str, Any]) -> tuple[int, int]:
        blockers = 0
        warnings = 0
        issues = report.get("issues", []) if isinstance(report, dict) else []
        if not isinstance(issues, list):
            return blockers, warnings

        for issue in issues:
            if not isinstance(issue, dict):
                continue
            severity = str(issue.get("severity", "") or "").strip().lower()
            if severity == "blocker":
                blockers += 1
            elif severity == "warning":
                warnings += 1
        return blockers, warnings

    def _build_quality_summary(self) -> dict[str, Any]:
        phase_gates = {
            "extraction": self._resolve_gate(self.extraction_report, "quality_gate"),
            "schema": self._resolve_gate(self.schema_quality_report, "quality_gate"),
            "scaffold": self._resolve_gate(self.scaffold_quality_report, "quality_gate"),
            "generation": self._resolve_gate(self.artifact_generation_report, "quality_gate"),
            "validation": self._resolve_gate(self.validation_report, "validation_gate", "quality_gate"),
        }

        blocked_phases = [name for name, gate in phase_gates.items() if gate == "blocked"]
        known_gates = [gate for gate in phase_gates.values() if gate != "unknown"]
        if phase_gates["validation"] in {"open", "blocked"}:
            overall_gate = phase_gates["validation"]
        elif blocked_phases:
            overall_gate = "blocked"
        elif len(known_gates) == len(phase_gates) and all(gate == "open" for gate in known_gates):
            overall_gate = "open"
        else:
            overall_gate = "unknown"

        reports = [
            self.extraction_report,
            self.schema_quality_report,
            self.scaffold_quality_report,
            self.artifact_generation_report,
            self.validation_report,
        ]
        blocker_count = 0
        warning_count = 0
        for report in reports:
            blockers, warnings = self._count_report_issues(report)
            blocker_count += blockers
            warning_count += warnings

        return {
            "overall_gate": overall_gate,
            "phase_gates": phase_gates,
            "blocked_phases": blocked_phases,
            "blocker_count": blocker_count,
            "warning_count": warning_count,
            "deployment_ready": bool(self.validation_report.get("deployment_ready", False)),
            "readiness_score": float(self.validation_report.get("readiness_score", 0.0) or 0.0),
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "input_url": self.input_url,
            "html_pages": self.html_pages,
            "crawl_config": self.crawl_config,
            "crawl_artifacts": self.crawl_artifacts,
            "crawled_page_map": self.crawled_page_map,
            "extraction_report": self.extraction_report,
            "schema_proposal": self.schema_proposal,
            "schema_quality_report": self.schema_quality_report,
            "schema_decision": self.schema_decision,
            "schema_rejection_feedback": self.schema_rejection_feedback,
            "scaffold_quality_report": self.scaffold_quality_report,
            "generated_artifacts": self.generated_artifacts,
            "artifact_generation_report": self.artifact_generation_report,
            "validation_report": self.validation_report,
            "quality_summary": self._build_quality_summary(),
            "trace_events": self.trace_events,
            "status": self.status.value,
            "errors": self.errors,
            "created_at_ms": self.created_at_ms,
            "updated_at_ms": self.updated_at_ms,
            "duration_ms": max(0.0, self.updated_at_ms - self.created_at_ms),
        }


class InMemoryJobStore:
    """Simple thread-safe store for conversion jobs."""

    def __init__(self) -> None:
        self._jobs: dict[str, ConversionJob] = {}
        self._schema_histories: dict[str, list[dict[str, Any]]] = {}
        self._artifact_histories: dict[str, list[dict[str, Any]]] = {}
        self._lock = Lock()

    def create_job(
        self,
        input_url: str | None = None,
        html_pages: list[str] | None = None,
        crawl_config: dict[str, Any] | None = None,
    ) -> ConversionJob:
        job = ConversionJob(
            job_id=str(uuid4()),
            input_url=input_url,
            html_pages=html_pages or [],
            crawl_config=crawl_config or {},
        )
        with self._lock:
            self._jobs[job.job_id] = job
        return job

    def get_job(self, job_id: str) -> ConversionJob | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return deepcopy(job) if job is not None else None

    def save_job(self, job: ConversionJob) -> None:
        job.updated_at_ms = time.time() * 1000
        with self._lock:
            prior = deepcopy(self._jobs.get(job.job_id))
            self._jobs[job.job_id] = deepcopy(job)

            if job.schema_proposal:
                previous_schema = prior.schema_proposal if prior else None
                if previous_schema != job.schema_proposal:
                    versions = self._schema_histories.setdefault(job.job_id, [])
                    versions.append(
                        {
                            "version": len(versions) + 1,
                            "schema": job.schema_proposal,
                        }
                    )

            if job.generated_artifacts:
                previous_artifacts = prior.generated_artifacts if prior else None
                if previous_artifacts != job.generated_artifacts:
                    versions = self._artifact_histories.setdefault(job.job_id, [])
                    versions.append(
                        {
                            "version": len(versions) + 1,
                            "artifacts": job.generated_artifacts,
                        }
                    )

    def get_schema_history(self, job_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._schema_histories.get(job_id, []))

    def get_artifact_history(self, job_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._artifact_histories.get(job_id, []))


class SqliteJobStore:
    """Thread-safe SQLite-backed store for resumable conversion jobs."""

    def __init__(self, db_path: str) -> None:
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS conversion_jobs (
                    job_id TEXT PRIMARY KEY,
                    input_url TEXT,
                    html_pages TEXT NOT NULL,
                    crawl_config TEXT NOT NULL,
                    crawl_artifacts TEXT NOT NULL,
                    crawled_page_map TEXT NOT NULL,
                    extraction_report TEXT NOT NULL,
                    schema_proposal TEXT NOT NULL,
                    schema_quality_report TEXT NOT NULL,
                    schema_decision TEXT NOT NULL,
                    schema_rejection_feedback TEXT NOT NULL,
                    scaffold_quality_report TEXT NOT NULL,
                    generated_artifacts TEXT NOT NULL,
                    artifact_generation_report TEXT NOT NULL,
                    validation_report TEXT NOT NULL,
                    trace_events TEXT NOT NULL,
                    status TEXT NOT NULL,
                    errors TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

            # Backward-compatible migrations for previously created databases.
            columns = {
                row["name"]
                for row in conn.execute("PRAGMA table_info(conversion_jobs)").fetchall()
            }
            if "crawl_config" not in columns:
                conn.execute(
                    "ALTER TABLE conversion_jobs ADD COLUMN crawl_config TEXT NOT NULL DEFAULT '{}'"
                )
            if "crawl_artifacts" not in columns:
                conn.execute(
                    "ALTER TABLE conversion_jobs ADD COLUMN crawl_artifacts TEXT NOT NULL DEFAULT '{}'"
                )
            if "crawled_page_map" not in columns:
                conn.execute(
                    "ALTER TABLE conversion_jobs ADD COLUMN crawled_page_map TEXT NOT NULL DEFAULT '{}'"
                )
            if "extraction_report" not in columns:
                conn.execute(
                    "ALTER TABLE conversion_jobs ADD COLUMN extraction_report TEXT NOT NULL DEFAULT '{}'"
                )
            if "schema_rejection_feedback" not in columns:
                conn.execute(
                    "ALTER TABLE conversion_jobs ADD COLUMN schema_rejection_feedback TEXT NOT NULL DEFAULT 'null'"
                )
            if "schema_quality_report" not in columns:
                conn.execute(
                    "ALTER TABLE conversion_jobs ADD COLUMN schema_quality_report TEXT NOT NULL DEFAULT '{}'"
                )
            if "scaffold_quality_report" not in columns:
                conn.execute(
                    "ALTER TABLE conversion_jobs ADD COLUMN scaffold_quality_report TEXT NOT NULL DEFAULT '{}'"
                )
            if "artifact_generation_report" not in columns:
                conn.execute(
                    "ALTER TABLE conversion_jobs ADD COLUMN artifact_generation_report TEXT NOT NULL DEFAULT '{}'"
                )
            if "trace_events" not in columns:
                conn.execute(
                    "ALTER TABLE conversion_jobs ADD COLUMN trace_events TEXT NOT NULL DEFAULT '[]'"
                )

            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_versions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    schema_json TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS artifact_versions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    artifacts_json TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.commit()

    def _get_last_version_payload(self, conn: sqlite3.Connection, table: str, column: str, job_id: str) -> str | None:
        row = conn.execute(
            f"SELECT {column} FROM {table} WHERE job_id = ? ORDER BY version DESC LIMIT 1",
            (job_id,),
        ).fetchone()
        if row is None:
            return None
        return str(row[0])

    def _next_version_number(self, conn: sqlite3.Connection, table: str, job_id: str) -> int:
        row = conn.execute(
            f"SELECT MAX(version) AS max_version FROM {table} WHERE job_id = ?",
            (job_id,),
        ).fetchone()
        max_version = int(row["max_version"] or 0)
        return max_version + 1

    def _row_to_job(self, row: sqlite3.Row) -> ConversionJob:
        row_keys = set(row.keys())
        return ConversionJob(
            job_id=row["job_id"],
            input_url=row["input_url"],
            html_pages=json.loads(row["html_pages"]),
            crawl_config=json.loads(row["crawl_config"]),
            crawl_artifacts=json.loads(row["crawl_artifacts"]),
            crawled_page_map=(json.loads(row["crawled_page_map"]) if "crawled_page_map" in row_keys else {}),
            extraction_report=(json.loads(row["extraction_report"]) if "extraction_report" in row_keys else {}),
            schema_proposal=json.loads(row["schema_proposal"]),
            schema_quality_report=(
                json.loads(row["schema_quality_report"])
                if "schema_quality_report" in row_keys
                else {}
            ),
            schema_decision=row["schema_decision"],
            schema_rejection_feedback=(
                json.loads(row["schema_rejection_feedback"])
                if "schema_rejection_feedback" in row_keys
                else None
            ),
            scaffold_quality_report=(
                json.loads(row["scaffold_quality_report"])
                if "scaffold_quality_report" in row_keys
                else {}
            ),
            generated_artifacts=json.loads(row["generated_artifacts"]),
            artifact_generation_report=(
                json.loads(row["artifact_generation_report"])
                if "artifact_generation_report" in row_keys
                else {}
            ),
            validation_report=json.loads(row["validation_report"]),
            trace_events=json.loads(row["trace_events"]),
            status=JobStatus(row["status"]),
            errors=json.loads(row["errors"]),
        )

    def create_job(
        self,
        input_url: str | None = None,
        html_pages: list[str] | None = None,
        crawl_config: dict[str, Any] | None = None,
    ) -> ConversionJob:
        job = ConversionJob(
            job_id=str(uuid4()),
            input_url=input_url,
            html_pages=html_pages or [],
            crawl_config=crawl_config or {},
        )
        self.save_job(job)
        return job

    def get_job(self, job_id: str) -> ConversionJob | None:
        with self._lock:
            with self._connect() as conn:
                row = conn.execute(
                    "SELECT * FROM conversion_jobs WHERE job_id = ?",
                    (job_id,),
                ).fetchone()
        if row is None:
            return None
        return self._row_to_job(row)

    def save_job(self, job: ConversionJob) -> None:
        with self._lock:
            with self._connect() as conn:
                conn.execute(
                    """
                    INSERT INTO conversion_jobs (
                        job_id,
                        input_url,
                        html_pages,
                        crawl_config,
                        crawl_artifacts,
                        crawled_page_map,
                        extraction_report,
                        schema_proposal,
                        schema_quality_report,
                        schema_decision,
                        schema_rejection_feedback,
                        scaffold_quality_report,
                        generated_artifacts,
                        artifact_generation_report,
                        validation_report,
                        trace_events,
                        status,
                        errors,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(job_id) DO UPDATE SET
                        input_url = excluded.input_url,
                        html_pages = excluded.html_pages,
                        crawl_config = excluded.crawl_config,
                        crawl_artifacts = excluded.crawl_artifacts,
                        crawled_page_map = excluded.crawled_page_map,
                        extraction_report = excluded.extraction_report,
                        schema_proposal = excluded.schema_proposal,
                        schema_quality_report = excluded.schema_quality_report,
                        schema_decision = excluded.schema_decision,
                        schema_rejection_feedback = excluded.schema_rejection_feedback,
                        scaffold_quality_report = excluded.scaffold_quality_report,
                        generated_artifacts = excluded.generated_artifacts,
                        artifact_generation_report = excluded.artifact_generation_report,
                        validation_report = excluded.validation_report,
                        trace_events = excluded.trace_events,
                        status = excluded.status,
                        errors = excluded.errors,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (
                        job.job_id,
                        job.input_url,
                        json.dumps(job.html_pages),
                        json.dumps(job.crawl_config),
                        json.dumps(job.crawl_artifacts),
                        json.dumps(job.crawled_page_map),
                        json.dumps(job.extraction_report),
                        json.dumps(job.schema_proposal),
                        json.dumps(job.schema_quality_report),
                        job.schema_decision,
                        json.dumps(job.schema_rejection_feedback),
                        json.dumps(job.scaffold_quality_report),
                        json.dumps(job.generated_artifacts),
                        json.dumps(job.artifact_generation_report),
                        json.dumps(job.validation_report),
                        json.dumps(job.trace_events),
                        job.status.value,
                        json.dumps(job.errors),
                    ),
                )

                if job.schema_proposal:
                    schema_payload = json.dumps(job.schema_proposal, sort_keys=True)
                    last_schema = self._get_last_version_payload(conn, "schema_versions", "schema_json", job.job_id)
                    if last_schema != schema_payload:
                        conn.execute(
                            """
                            INSERT INTO schema_versions (job_id, version, schema_json)
                            VALUES (?, ?, ?)
                            """,
                            (job.job_id, self._next_version_number(conn, "schema_versions", job.job_id), schema_payload),
                        )

                if job.generated_artifacts:
                    artifact_payload = json.dumps(job.generated_artifacts, sort_keys=True)
                    last_artifacts = self._get_last_version_payload(
                        conn,
                        "artifact_versions",
                        "artifacts_json",
                        job.job_id,
                    )
                    if last_artifacts != artifact_payload:
                        conn.execute(
                            """
                            INSERT INTO artifact_versions (job_id, version, artifacts_json)
                            VALUES (?, ?, ?)
                            """,
                            (
                                job.job_id,
                                self._next_version_number(conn, "artifact_versions", job.job_id),
                                artifact_payload,
                            ),
                        )

                conn.commit()

    def get_schema_history(self, job_id: str) -> list[dict[str, Any]]:
        with self._lock:
            with self._connect() as conn:
                rows = conn.execute(
                    """
                    SELECT version, schema_json, created_at
                    FROM schema_versions
                    WHERE job_id = ?
                    ORDER BY version ASC
                    """,
                    (job_id,),
                ).fetchall()
        return [
            {
                "version": int(row["version"]),
                "schema": json.loads(row["schema_json"]),
                "created_at": row["created_at"],
            }
            for row in rows
        ]

    def get_artifact_history(self, job_id: str) -> list[dict[str, Any]]:
        with self._lock:
            with self._connect() as conn:
                rows = conn.execute(
                    """
                    SELECT version, artifacts_json, created_at
                    FROM artifact_versions
                    WHERE job_id = ?
                    ORDER BY version ASC
                    """,
                    (job_id,),
                ).fetchall()
        return [
            {
                "version": int(row["version"]),
                "artifacts": json.loads(row["artifacts_json"]),
                "created_at": row["created_at"],
            }
            for row in rows
        ]
