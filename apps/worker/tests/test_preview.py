import os
import subprocess
import threading
import time
import pytest
from src.engine.preview import PreviewManager


def eventually(predicate, timeout=3):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.02)
    assert predicate()


@pytest.fixture
def manager():
    value = PreviewManager(prepare=lambda session, job: "http://127.0.0.1:12345")
    yield value
    value.shutdown()


def test_cancel_before_start_cannot_resurrect(manager):
    manager.stop("owner", "lease")
    assert manager.start("owner", "lease", {"job_id": "job"})["status"] == "stopped"
    assert not manager.sessions


def test_new_lease_replaces_previous_and_stale_stop_is_harmless(manager):
    manager.start("owner", "old", {"job_id": "first"})
    previous = manager.sessions["owner"]
    manager.start("owner", "new", {"job_id": "second"})
    assert previous["cancel"].is_set()
    manager.stop("owner", "old")
    eventually(lambda: manager.status("owner", "new")["status"] == "ready")
    assert manager.status("stranger", "new")["status"] == "stopped"


def test_cancel_during_preparation(manager):
    entered = threading.Event()
    released = threading.Event()
    def prepare(session, job):
        entered.set()
        released.wait(2)
        return "http://127.0.0.1:12345"
    manager.prepare = prepare
    manager.start("owner", "lease", {"job_id": "job"})
    assert entered.wait(2)
    session = manager.sessions["owner"]
    manager.stop("owner", "lease")
    released.set()
    eventually(lambda: session["status"] == "stopped")
    assert manager.status("owner", "lease")["status"] == "stopped"


def test_stops_real_process_group(manager, tmp_path):
    def prepare(session, job):
        process = manager._spawn(session, ["sleep", "60"], tmp_path, os.environ.copy(), subprocess.DEVNULL)
        assert process.poll() is None
        return "http://127.0.0.1:12345"
    manager.prepare = prepare
    manager.start("owner", "lease", {"job_id": "job"})
    eventually(lambda: manager.status("owner", "lease")["status"] == "ready")
    process = manager.sessions["owner"]["process"]
    manager.stop("owner", "lease")
    assert process.poll() is not None


def test_idle_lease_expires(manager):
    manager.start("owner", "lease", {"job_id": "job"})
    manager.sessions["owner"]["touched"] -= 100
    eventually(lambda: not manager.sessions, timeout=6)


def test_heartbeat_extends_lease(manager):
    manager.start("owner", "lease", {"job_id": "job"})
    manager.sessions["owner"]["touched"] -= 60
    manager.status("owner", "lease", heartbeat=True)
    assert time.monotonic() - manager.sessions["owner"]["touched"] < 1


def test_setup_failure_is_reported(manager):
    def fail(session, job):
        raise ValueError("Test preparation failed")
    manager.prepare = fail
    manager.start("owner", "lease", {"job_id": "job"})
    eventually(lambda: manager.status("owner", "lease")["status"] == "failed")
    assert manager.status("owner", "lease")["error"] == "Test preparation failed"
