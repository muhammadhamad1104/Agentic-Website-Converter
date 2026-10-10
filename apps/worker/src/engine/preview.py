"""Leased local previews built exclusively from the worker's trusted runtime."""
from __future__ import annotations

import atexit
import hashlib
import json
import os
import secrets
import shutil
import signal
import subprocess
import tempfile
import threading
import time
from pathlib import Path

from src.config.settings import settings
from src.engine.package_builder import write_runtime_project
from src.engine.preserved_site import generate_preserved_site


class PreviewManager:
    def __init__(self, ttl=75, prepare=None):
        self.ttl = ttl
        self.prepare = prepare or self._prepare
        self.lock = threading.RLock()
        self.sessions = {}
        self.closed = {}
        self.done = threading.Event()
        threading.Thread(target=self._sweep, daemon=True).start()
        atexit.register(self.shutdown)

    def start(self, owner, lease, job):
        with self.lock:
            if (owner, lease) in self.closed:
                return {"status": "stopped", "leaseId": lease}
            previous = self.sessions.get(owner)
            if previous and previous["leaseId"] == lease:
                if previous["jobId"] != job["job_id"]:
                    raise ValueError("Preview lease belongs to another job")
                return self._public(previous)
            if previous:
                self._stop(owner, previous["leaseId"])
            session = {"leaseId": lease, "jobId": job["job_id"], "status": "starting",
                       "stage": "queued", "message": "Preparing an isolated preview", "progress": 4,
                       "startedAt": int(time.time() * 1000),
                       "touched": time.monotonic(), "cancel": threading.Event(),
                       "process": None, "root": None}
            self.sessions[owner] = session
            threading.Thread(target=self._run, args=(session, job), daemon=True).start()
            return self._public(session)

    def status(self, owner, lease, heartbeat=False):
        with self.lock:
            session = self.sessions.get(owner)
            if not session or session["leaseId"] != lease:
                return {"status": "stopped", "leaseId": lease}
            if heartbeat:
                session["touched"] = time.monotonic()
            process = session["process"]
            if session["status"] == "ready" and process and process.poll() is not None:
                session.update(status="failed", error="Preview process exited. Start a new preview.")
            return self._public(session)

    @staticmethod
    def _public(session):
        result = {key: session[key] for key in
                  ("leaseId", "status", "stage", "message", "progress", "startedAt", "url", "error")
                  if key in session}
        if "startedAt" in session:
            result["elapsedSeconds"] = max(0, int((time.time() * 1000 - session["startedAt"]) / 1000))
        return result

    def _stage(self, session, stage, message, progress):
        with self.lock:
            if session["cancel"].is_set():
                raise InterruptedError()
            session.update(stage=stage, message=message, progress=progress)

    def stop(self, owner, lease):
        with self.lock:
            self._stop(owner, lease)
        return {"status": "stopped", "leaseId": lease}

    def _stop(self, owner, lease):
        # A cancelled request may arrive before its start request.
        self.closed[owner, lease] = time.monotonic()
        session = self.sessions.get(owner)
        if not session or session["leaseId"] != lease:
            return
        session["cancel"].set()
        session["status"] = "stopped"
        self._kill(session["process"])
        del self.sessions[owner]

    @staticmethod
    def _kill(process):
        if process is None:
            return
        try:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass
            # Also kill children left behind by an npm parent.
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()

    def _spawn(self, session, command, cwd, env, output):
        with self.lock:
            if session["cancel"].is_set():
                raise InterruptedError()
            process = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                       stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
            session["process"] = process
            return process

    @staticmethod
    def _frontend_fingerprint(root):
        digest = hashlib.sha256()
        frontend = root / "frontend"
        for path in sorted(frontend.rglob("*")):
            if not path.is_file() or any(part in {"node_modules", "dist"} for part in path.relative_to(frontend).parts):
                continue
            digest.update(str(path.relative_to(frontend)).encode())
            digest.update(path.read_bytes())
        return digest.hexdigest()

    @staticmethod
    def _validated_project(job):
        report = job.get("validation_report") or {}
        if report.get("build_status") != "passed" or not report.get("project_dir"):
            return None
        try:
            generated = Path(settings.GENERATED_OUTPUT_PATH).resolve()
            expected = (generated / ("validation_" + str(job["job_id"]))).resolve()
            candidate = Path(report["project_dir"]).resolve()
            if candidate != expected or not candidate.is_dir():
                return None
            return candidate
        except (KeyError, OSError, RuntimeError, TypeError, ValueError):
            return None

    def _reuse_validated_build(self, session, job, root):
        candidate = self._validated_project(job)
        if candidate is None:
            return False, False
        pairs = [(candidate / name / "package.json", root / name / "package.json",
                  candidate / name / "node_modules", root / name / "node_modules")
                 for name in ("backend", "frontend")]
        if not all(source_package.is_file() and target_package.is_file() and modules.is_dir() and
                   source_package.read_bytes() == target_package.read_bytes()
                   for source_package, target_package, modules, _target_modules in pairs):
            return False, False
        self._stage(session, "dependencies", "Reusing validated dependencies", 28)
        for _source_package, _target_package, modules, target_modules in pairs:
            target_modules.symlink_to(modules, target_is_directory=True)
        validated_dist = candidate / "frontend" / "dist"
        same_frontend = validated_dist.is_dir() and self._frontend_fingerprint(candidate) == self._frontend_fingerprint(root)
        if same_frontend:
            shutil.copytree(validated_dist, root / "frontend" / "dist")
        return True, same_frontend

    def _prepare(self, session, job):
        self._stage(session, "project", "Assembling the generated application", 10)
        root = Path(tempfile.mkdtemp(prefix="converter-preview-"))
        session["root"] = root
        # Do not execute arbitrary generated backend files or package scripts.
        artifacts = generate_preserved_site(job)
        write_runtime_project(root, artifacts, job["job_id"])
        env = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR", "SystemRoot") if key in os.environ}
        env.update(DATABASE_URL="file:./preview.db", HOST="127.0.0.1", PORT="0",
                   ADMIN_EMAIL="preview@example.invalid", ADMIN_PASSWORD=secrets.token_urlsafe(32),
                   PREVIEW_MODE="1")
        reused_dependencies, reused_frontend = self._reuse_validated_build(session, job, root)
        commands = [] if reused_dependencies else [
            ("dependencies", "Installing backend dependencies", 20, "backend",
             ["npm", "install", "--ignore-scripts", "--prefer-offline", "--no-audit", "--no-fund"]),
            ("dependencies", "Installing frontend dependencies", 42, "frontend",
             ["npm", "install", "--ignore-scripts", "--prefer-offline", "--no-audit", "--no-fund"]),
        ]
        commands.append(("database", "Initializing the preview database", 66, "backend",
                         (["node", "node_modules/prisma/build/index.js", "db", "push", "--skip-generate"]
                          if reused_dependencies else ["npm", "run", "setup"])))
        if not reused_frontend:
            commands.append(("build", "Building the generated interface", 82, "frontend", ["npm", "run", "build"]))
        with (root / "setup.log").open("w") as log:
            for stage, message, progress, directory, command in commands:
                self._stage(session, stage, message, progress)
                process = self._spawn(session, command, root / directory, env, log)
                try:
                    code = process.wait(timeout=300)
                except subprocess.TimeoutExpired:
                    self._kill(process)
                    raise ValueError("Preview setup timed out. Please try again.")
                if session["cancel"].is_set():
                    raise InterruptedError()
                if code:
                    raise ValueError(message + " failed. Retry the preview; if it repeats, check the worker logs.")
        log_path = root / "runtime.log"
        with log_path.open("w") as log:
            self._stage(session, "launch", "Starting the generated application", 94)
            process = self._spawn(session, ["node", "src/index.js"], root / "backend", env, log)
            for _ in range(300):
                if session["cancel"].wait(.1):
                    raise InterruptedError()
                if process.poll() is not None:
                    raise ValueError("Preview exited during startup.")
                for line in log_path.read_text().splitlines():
                    try:
                        event = json.loads(line)
                    except ValueError:
                        continue
                    if event.get("event") == "listening":
                        return "http://127.0.0.1:" + str(event["port"])
            raise ValueError("Preview did not become ready.")

    def _run(self, session, job):
        try:
            url = self.prepare(session, job)
            with self.lock:
                if session["cancel"].is_set():
                    raise InterruptedError()
                session.update(status="ready", stage="ready", message="Preview ready", progress=100, url=url)
            session["cancel"].wait()
        except InterruptedError:
            pass
        except Exception as error:
            with self.lock:
                session.update(status="failed", error=str(error))
        finally:
            self._kill(session["process"])
            if session["root"]:
                shutil.rmtree(session["root"], ignore_errors=True)

    def _sweep(self):
        while not self.done.wait(5):
            with self.lock:
                now = time.monotonic()
                for owner, session in list(self.sessions.items()):
                    if now - session["touched"] > self.ttl:
                        self._stop(owner, session["leaseId"])
                self.closed = {key: timestamp for key, timestamp in self.closed.items() if now - timestamp < 600}

    def shutdown(self):
        self.done.set()
        with self.lock:
            for owner, session in list(self.sessions.items()):
                self._stop(owner, session["leaseId"])
