"""Build and smoke-test the runtime before allowing export."""
from __future__ import annotations

import os
import socket
import secrets
import subprocess
import time
from pathlib import Path

import requests

from src.config.settings import settings
from src.engine.package_builder import write_runtime_project


def _source_issues(artifacts, captured):
    accepted = set(captured.get("accepted_source_failures", []))
    issues = []
    source = artifacts.get("source_report", {})
    for url in source.get("missing_assets", []):
        issues.append({"severity": "warning" if url in accepted else "blocker",
                       "code": "missing_source_asset", "url": url,
                       "accepted_by_user": url in accepted, "message": "Missing captured asset: " + url})
    if any(captured.get("limits", {}).values()):
        issues.append({"severity": "blocker", "message": "Capture reached a configured limit; the website is incomplete."})
    page_failures = [item for item in captured.get("failures", []) if item.get("kind") == "page"]
    for failure in page_failures:
        url = failure.get("url", "")
        issues.append({"severity": "warning" if url in accepted else "blocker",
                       "code": "source_page_failed", "url": url,
                       "accepted_by_user": url in accepted, "message": "Page request failed during capture: " + url})
    return issues


def validate_runtime(state):
    artifacts = state.get("generated_artifacts") or {}
    captured = state.get("crawl_artifacts") or {}
    source = artifacts.get("source_report", {})
    issues = _source_issues(artifacts, captured)
    report = {"validation_gate": "blocked", "deployment_ready": False, "build_status": "not_run",
              "lint_status": "not_run", "checks": [], "issues": issues, "readiness_score": 0,
              "source_completeness": "incomplete" if issues else "complete"}
    job_id = state.get("job_id", "unidentified")
    project = Path(settings.GENERATED_OUTPUT_PATH).resolve() / ("validation_" + job_id)
    env = {**os.environ, "DATABASE_URL": "file:./verification.db"}
    # Verification uses an isolated database and ephemeral credentials.
    env["ADMIN_EMAIL"] = "validation@example.invalid"
    env["ADMIN_PASSWORD"] = secrets.token_urlsafe(32)
    try:
        write_runtime_project(project, artifacts, job_id)
        commands = [
            ("backend", ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"]),
            ("frontend", ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"]),
            ("backend", ["npm", "run", "check"]),
            ("backend", ["npm", "run", "setup"]),
            ("frontend", ["npm", "run", "build"]),
        ]
        for directory, command in commands:
            completed = subprocess.run(command, cwd=project / directory, env=env, capture_output=True, text=True, timeout=300)
            report["checks"].append({"id": directory + ":" + " ".join(command), "passed": completed.returncode == 0,
                                     "output": (completed.stdout + completed.stderr)[-4000:]})
            if completed.returncode:
                raise ValueError(directory + " " + " ".join(command) + " failed: " + (completed.stdout + completed.stderr)[-1500:])
        report["build_status"] = "passed"
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        process = subprocess.Popen(["node", "src/index.js"], cwd=project / "backend",
                                   env={**env, "HOST": "127.0.0.1", "PORT": str(port)},
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            ready = False
            for _ in range(100):
                if process.poll() is not None:
                    raise ValueError("Generated backend exited during startup")
                try:
                    ready = requests.get(f"http://127.0.0.1:{port}/health", timeout=1).status_code == 200
                except requests.RequestException:
                    pass
                if ready: break
                time.sleep(.1)
            if not ready: raise ValueError("Generated backend did not become healthy")
            for route in source.get("routes", []):
                response = requests.get(f"http://127.0.0.1:{port}/__site{route}", timeout=10)
                if response.status_code != 200 or not response.text.strip():
                    raise ValueError(f"Generated page failed smoke test: {route}")
            report["checks"].append({"id": "backend_health_and_pages", "passed": True})
        finally:
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
    except Exception as exc:
        issues.append({"severity": "blocker", "message": str(exc)})
    blockers = any(issue["severity"] == "blocker" for issue in issues)
    report.update({"validation_gate": "blocked" if blockers else "open", "deployment_ready": not blockers,
                   "readiness_score": 0 if blockers else 100, "min_readiness_score_required": 100,
                   "visual_status": "not_run", "project_dir": str(project)})
    return {**state, "validation_report": report, "status": "failed" if blockers else "validated",
            "errors": list(state.get("errors", [])) + [issue["message"] for issue in issues if issue["severity"] == "blocker"]}
