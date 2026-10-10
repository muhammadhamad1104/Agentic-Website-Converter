"""Leased local previews built exclusively from the worker's trusted runtime."""
from __future__ import annotations

import atexit
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
        return {key: session[key] for key in ("leaseId", "status", "url", "error") if key in session}

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

    def _prepare(self, session, job):
        root = Path(tempfile.mkdtemp(prefix="converter-preview-"))
        session["root"] = root
        # Do not execute arbitrary generated backend files or package scripts.
        artifacts = generate_preserved_site(job)
        write_runtime_project(root, artifacts, job["job_id"])
        env = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR", "SystemRoot") if key in os.environ}
        env.update(DATABASE_URL="file:./preview.db", HOST="127.0.0.1", PORT="0",
                   ADMIN_EMAIL="preview@example.invalid", ADMIN_PASSWORD=secrets.token_urlsafe(32),
                   PREVIEW_MODE="1")
        commands = [
            ("backend", ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"]),
            ("frontend", ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"]),
            ("backend", ["npm", "run", "setup"]),
            ("frontend", ["npm", "run", "build"]),
        ]
        with (root / "setup.log").open("w") as log:
            for directory, command in commands:
                process = self._spawn(session, command, root / directory, env, log)
                try:
                    code = process.wait(timeout=300)
                except subprocess.TimeoutExpired:
                    self._kill(process)
                    raise ValueError("Preview setup timed out. Please try again.")
                if session["cancel"].is_set():
                    raise InterruptedError()
                if code:
                    raise ValueError("Preview setup failed during " + directory + " " + " ".join(command[:3]))
        log_path = root / "runtime.log"
        with log_path.open("w") as log:
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
                session.update(status="ready", url=url)
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
