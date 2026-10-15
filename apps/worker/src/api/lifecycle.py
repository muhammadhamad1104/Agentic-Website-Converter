"""Serialize API launches while keeping engine state and artifacts authoritative."""
import asyncio
import logging
import time
from threading import Lock

from src.engine.models import JobStatus


class JobLifecycle:
    def __init__(self):
        self.active = {}
        self._lock = Lock()

    def claim(self, job_id, stage):
        with self._lock:
            if job_id in self.active:
                return False
            self.active[job_id] = stage
            return True

    def release(self, job_id):
        with self._lock:
            self.active.pop(job_id, None)

    def view(self, job):
        stage = self.active.get(job["job_id"])
        if not stage:
            interrupted = {"draft": "crawl", "inferring_schema": "schema", "approved": "generate", "generated": "generate"}.get(job["status"])
            if interrupted:
                return {**job, "status": "failed", "interrupted_stage": interrupted,
                        "errors": [*(job.get("errors") or []), "Worker execution was interrupted. Resume the saved conversion to continue."]}
            return job
        return {**job, "active_stage": stage, "status": {
            "crawl": "crawling", "schema": "inferring_schema", "generate": "generating"
        }[stage]}

    async def execute(self, engine, job_id, stage, operation):
        try:
            # Shield the thread: cancellation must not permit a second writer
            # while the original operation is still running.
            task = asyncio.create_task(operation(job_id))
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                await task
                raise
        except Exception as error:
            logging.exception("API %s stage failed for %s", stage, job_id)
            job = engine.store.get_job(job_id)
            if job is not None:
                job.errors = [*(job.errors or []), f"{stage} execution failed: {error}"]
                job.trace_events = [*(job.trace_events or []), {
                    "node": f"api.{stage}", "output_status": "failed",
                    "timestamp_ms": int(time.time() * 1000), "duration_ms": 0,
                    "message": str(error),
                }]
                job.status = JobStatus.FAILED
                engine.store.save_job(job)
        finally:
            self.release(job_id)
