import asyncio
from unittest.mock import Mock, patch

import pytest
from fastapi import BackgroundTasks, HTTPException

from src.api import main
from src.api.lifecycle import JobLifecycle
from src.engine.job_store import InMemoryJobStore, SqliteJobStore
from src.engine.models import JobStatus
from src.engine.service import ConversionEngine


@pytest.fixture
def api_engine(monkeypatch):
    with patch.object(ConversionEngine, "_build_failover_llm", return_value=Mock()):
        engine = ConversionEngine(store=InMemoryJobStore())
    monkeypatch.setattr(main, "engine", engine)
    monkeypatch.setattr(main, "lifecycle", JobLifecycle())
    return engine


def saved_job(engine, status=JobStatus.CRAWLED, approved=False):
    job_id = engine.create_job(html_pages=["<h1>Services</h1>"])["job_id"]
    job = engine.store.get_job(job_id)
    job.status = status
    job.extraction_report = {"quality_gate": "open"}
    if approved or status == JobStatus.AWAITING_APPROVAL:
        job.schema_proposal = {"entities": [{"name": "Service"}]}
        job.schema_quality_report = {"quality_gate": "open"}
    if approved:
        job.schema_decision = "approved"
    engine.store.save_job(job)
    return job_id


def test_duplicate_inference_is_claimed_before_background_starts(api_engine, monkeypatch):
    job_id = saved_job(api_engine)
    infer = Mock(return_value={"status": "awaiting_approval"})
    monkeypatch.setattr(api_engine, "infer_schema_stage", infer)

    async def scenario():
        first, second = BackgroundTasks(), BackgroundTasks()
        result = await main.infer_schema_endpoint(job_id, first)
        duplicate = await main.infer_schema_endpoint(job_id, second)
        assert result["job"]["status"] == duplicate["job"]["status"] == "inferring_schema"
        assert len(first.tasks) == 1 and not second.tasks
        assert (await main.get_job_status(job_id))["job"]["active_stage"] == "schema"
        await first()
        assert job_id not in main.lifecycle.active

    asyncio.run(scenario())
    infer.assert_called_once_with(job_id)


@pytest.mark.parametrize("status", [JobStatus.AWAITING_APPROVAL, JobStatus.APPROVED, JobStatus.VALIDATED])
def test_inference_does_not_repeat_after_schema_is_available(api_engine, status):
    job_id = saved_job(api_engine, status, approved=True)
    tasks = BackgroundTasks()
    result = asyncio.run(main.infer_schema_endpoint(job_id, tasks))
    assert result["job"]["status"] == status.value
    assert not tasks.tasks


def test_duplicate_approval_starts_only_one_generation(api_engine, monkeypatch):
    job_id = saved_job(api_engine, JobStatus.AWAITING_APPROVAL)
    generate = Mock(return_value={"status": "validated"})
    monkeypatch.setattr(api_engine, "run_job", generate)

    async def scenario():
        first, second = BackgroundTasks(), BackgroundTasks()
        decision = main.DecisionRequest(decision="approved")
        await main.submit_schema_decision(job_id, decision, first)
        duplicate = await main.submit_schema_decision(job_id, decision, second)
        assert duplicate["job"]["status"] == "generating"
        assert not second.tasks
        with pytest.raises(HTTPException) as conflict:
            await main.submit_schema_decision(job_id, main.DecisionRequest(decision="rejected"), second)
        assert conflict.value.status_code == 409
        assert api_engine.get_job(job_id)["schema_proposal"]["entities"]
        await first()

    asyncio.run(scenario())
    generate.assert_called_once_with(job_id, target_stage="generate")


@pytest.mark.parametrize("stage", ["crawl", "schema", "generate"])
def test_uncaught_stage_errors_are_persisted_and_claims_released(api_engine, monkeypatch, stage):
    job_id = saved_job(api_engine, JobStatus.FAILED, approved=stage == "generate")
    method = "infer_schema_stage" if stage == "schema" else "run_job"
    monkeypatch.setattr(api_engine, method, Mock(side_effect=RuntimeError("provider isolated failure")))
    operation = {"crawl": main.execute_real_conversion_job, "schema": main.execute_schema_inference,
                 "generate": main.execute_code_generation}[stage]
    tasks = BackgroundTasks()
    main.queue_stage(job_id, stage, tasks, operation)
    asyncio.run(tasks())
    job = api_engine.get_job(job_id)
    assert job["status"] == "failed"
    assert "provider isolated failure" in job["errors"][-1]
    assert job["trace_events"][-1]["node"] == f"api.{stage}"
    assert job_id not in main.lifecycle.active


def test_failed_generation_resumes_approved_schema_and_preserves_artifacts(api_engine, monkeypatch):
    job_id = saved_job(api_engine, JobStatus.FAILED, approved=True)
    job = api_engine.store.get_job(job_id)
    job.generated_artifacts = {"backend": "preserved"}
    api_engine.store.save_job(job)
    observed = []

    def generate(job_id, target_stage):
        observed.append(api_engine.get_job(job_id))
        return observed[-1]

    monkeypatch.setattr(api_engine, "run_job", generate)

    async def scenario():
        tasks = BackgroundTasks()
        response = await main.run_job(job_id, tasks)
        assert response["job"]["status"] == "generating"
        await tasks()

    asyncio.run(scenario())
    assert observed[0]["status"] == "approved"
    assert observed[0]["generated_artifacts"] == {"backend": "preserved"}


def test_failed_inference_can_resume_and_rejection_reuses_captured_pages(api_engine, monkeypatch):
    job_id = saved_job(api_engine, JobStatus.FAILED)
    infer = Mock(return_value={"status": "awaiting_approval"})
    monkeypatch.setattr(api_engine, "infer_schema_stage", infer)

    async def scenario():
        tasks = BackgroundTasks()
        await main.infer_schema_endpoint(job_id, tasks)
        await tasks()
        job = api_engine.store.get_job(job_id)
        job.status = JobStatus.AWAITING_APPROVAL
        job.schema_proposal = {"entities": [{"name": "Service"}]}
        api_engine.store.save_job(job)
        tasks = BackgroundTasks()
        await main.submit_schema_decision(job_id, main.DecisionRequest(decision="rejected"), tasks)
        await tasks()

    asyncio.run(scenario())
    assert infer.call_count == 2


def test_creation_idempotency_recovers_a_lost_response(api_engine):
    async def scenario():
        first, duplicate = BackgroundTasks(), BackgroundTasks()
        request = main.JobRequest(url="https://example.invalid")
        created = await main.create_job(request, first, "", "", "conversion-1")
        recovered = await main.create_job(request, duplicate, "", "", "conversion-1")
        assert recovered["job_id"] == created["job_id"]
        assert len(first.tasks) == 1 and not duplicate.tasks

    asyncio.run(scenario())


def test_creation_idempotency_survives_a_worker_restart(api_engine, monkeypatch, tmp_path):
    monkeypatch.setattr(api_engine, "store", SqliteJobStore(str(tmp_path / "jobs.db")))
    async def scenario():
        request = main.JobRequest(url="https://example.invalid")
        created = await main.create_job(request, BackgroundTasks(), "", "owner", "durable-conversion")
        monkeypatch.setattr(main, "lifecycle", JobLifecycle())
        monkeypatch.setattr(api_engine, "store", SqliteJobStore(str(tmp_path / "jobs.db")))
        tasks = BackgroundTasks()
        recovered = await main.create_job(request, tasks, "", "owner", "durable-conversion")
        assert recovered["job_id"] == created["job_id"]
        assert recovered["job"]["interrupted_stage"] == "crawl"
        assert not tasks.tasks
        other = await main.create_job(request, BackgroundTasks(), "", "other-owner", "durable-conversion")
        assert other["job_id"] != created["job_id"]
    asyncio.run(scenario())


def test_missing_job_is_404_and_pending_review_does_not_generate(api_engine):
    with pytest.raises(HTTPException) as missing:
        asyncio.run(main.run_job("missing", BackgroundTasks()))
    assert missing.value.status_code == 404
    job_id = saved_job(api_engine, JobStatus.AWAITING_APPROVAL)
    tasks = BackgroundTasks()
    response = asyncio.run(main.submit_schema_decision(job_id, main.DecisionRequest(decision="pending"), tasks))
    assert response["job"]["status"] == "awaiting_approval"
    assert not tasks.tasks


def test_restart_reports_interrupted_inference_and_resume_claims_saved_job(api_engine, monkeypatch):
    job_id = saved_job(api_engine, JobStatus.INFERRING_SCHEMA)
    monkeypatch.setattr(api_engine, "infer_schema_stage", Mock(return_value={"status": "awaiting_approval"}))
    async def scenario():
        interrupted = (await main.get_job_status(job_id))["job"]
        assert interrupted["status"] == "failed"
        assert interrupted["interrupted_stage"] == "schema"
        assert api_engine.get_job(job_id)["status"] == "inferring_schema"
        tasks = BackgroundTasks()
        resumed = await main.run_job(job_id, tasks)
        assert resumed["job"]["status"] == "inferring_schema"
        assert len(tasks.tasks) == 1
        await tasks()
    asyncio.run(scenario())
