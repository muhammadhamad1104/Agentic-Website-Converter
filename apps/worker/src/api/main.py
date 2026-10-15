from fastapi import FastAPI, BackgroundTasks, HTTPException, Header, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
import os
import asyncio
from pathlib import Path
from typing import Any

from src.engine.service import ConversionEngine
from src.engine.preview import PreviewManager
from src.engine.models import JobStatus
from src.api.lifecycle import JobLifecycle
from src.config.settings import settings
from src.api.source_uploads import router as source_router, authorize as authorize_source, uploaded_source
import secrets
import hashlib
from uuid import UUID
import requests

app = FastAPI(
    title="Agentic Converter API",
    description="FastAPI bridge for the LangGraph Python AI Worker",
    version="1.0.0"
)

# Global ConversionEngine instance
engine = ConversionEngine()
previews = PreviewManager()
lifecycle = JobLifecycle()
app.include_router(source_router)


@app.on_event("shutdown")
def stop_previews():
    previews.shutdown()


class PreviewRequest(BaseModel):
    owner_id: str = Field(min_length=1, max_length=128)
    lease_id: UUID


@app.api_route("/api/previews/{lease_id}/proxy/{path:path}", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
async def preview_proxy(lease_id: UUID, path: str, request: Request,
                        x_preview_secret: str = Header(default=""), x_preview_owner: str = Header(default="")):
    if not settings.PREVIEW_API_SECRET or not secrets.compare_digest(settings.PREVIEW_API_SECRET, x_preview_secret):
        raise HTTPException(status_code=403, detail="Preview service is not authorized")
    state = await asyncio.to_thread(previews.status, x_preview_owner, str(lease_id))
    if state["status"] != "ready":
        return Response("Preview has stopped.", status_code=410, media_type="text/plain")
    body = await request.body()
    if len(body) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Preview request is too large")
    headers = {key: value for key, value in request.headers.items() if key.lower() in {"content-type", "cookie", "range", "accept"}}
    if (path == "api/admin" or path.startswith("api/admin/")) and request.headers.get("authorization"):
        headers["authorization"] = request.headers["authorization"]
    try:
        upstream = await asyncio.to_thread(requests.request, request.method, state["url"] + "/" + path,
            params=list(request.query_params.multi_items()), headers=headers, data=body, timeout=25, allow_redirects=False)
    except requests.RequestException:
        return Response("Preview is unavailable.", status_code=503, media_type="text/plain")
    forwarded = {key: value for key, value in upstream.headers.items()
                 if key.lower() in {"content-type", "content-range", "accept-ranges", "location", "set-cookie"}}
    return Response(upstream.content, status_code=upstream.status_code, headers=forwarded)


@app.api_route("/api/jobs/{job_id}/preview/{action}", methods=["POST"])
async def preview_action(job_id: str, action: str, request: PreviewRequest,
                         x_preview_secret: str = Header(default="")):
    expected = settings.PREVIEW_API_SECRET
    if not expected or not secrets.compare_digest(expected, x_preview_secret):
        raise HTTPException(status_code=403, detail="Preview service is not authorized")
    owner, lease = request.owner_id, str(request.lease_id)
    if action == "stop":
        return await asyncio.to_thread(previews.stop, owner, lease)
    if action in {"status", "heartbeat"}:
        return await asyncio.to_thread(previews.status, owner, lease, heartbeat=action == "heartbeat")
    if action != "start":
        raise HTTPException(status_code=404, detail="Unknown preview action")
    try:
        job = await asyncio.to_thread(engine.get_job, job_id)
        if not job.get("generated_artifacts"):
            raise HTTPException(status_code=409, detail="Generate the website before previewing")
        return await asyncio.to_thread(previews.start, owner, lease, job)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error))

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "worker"}

class JobRequest(BaseModel):
    url: str | None = None
    file_path: str | None = None
    source_upload_id: UUID | None = None
    crawl_depth: int = Field(default=3, ge=0)
    full_site: bool = True
    max_pages: int = Field(default=0, ge=0)
    max_assets: int = Field(default=0, ge=0)
    extract_images: bool = True
    ai_provider: str = "openai"

class DecisionRequest(BaseModel):
    decision: str = Field(default="approved", pattern="^(approved|rejected|pending)$")
    feedback: Any = None

async def execute_real_conversion_job(job_id: str):
    """
    Background task to execute Stage 1: Crawl & Extract content ONLY.
    Pauses at status=crawled waiting for user to proceed to schema inference.
    """
    print(f"[Worker Engine] Running Stage 1 Crawl workflow for job_id={job_id}")
    return await asyncio.to_thread(engine.run_job, job_id, target_stage="crawl")


def queue_stage(job_id, stage, background_tasks, operation):
    if not lifecycle.claim(job_id, stage):
        return False
    background_tasks.add_task(lifecycle.execute, engine, job_id, stage, operation)
    return True


def job_or_404(job_id):
    try:
        return engine.get_job(job_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


def restore_generation(job_id):
    job = engine.store.get_job(job_id)
    job.status = JobStatus.APPROVED
    engine.store.save_job(job)


FINISHED = {"validated", "completed", "ready", "exported", "package_approved"}

@app.post("/api/jobs")
async def create_job(request: JobRequest, background_tasks: BackgroundTasks,
                     x_preview_secret: str = Header(default=""), x_source_owner: str = Header(default=""),
                     x_conversion_id: str = Header(default="", max_length=128)):
    target_url = request.url or request.file_path
    if sum(bool(value) for value in (request.url, request.file_path, request.source_upload_id)) > 1:
        raise HTTPException(status_code=400, detail="Provide exactly one input source")
    if request.source_upload_id:
        authorize_source(x_preview_secret)
        archive, _info = uploaded_source(request.source_upload_id, x_source_owner)
        target_url = str(archive)
    if not target_url:
        raise HTTPException(status_code=400, detail="Must provide either URL or file_path")
    creation_key = hashlib.sha256(f"{x_source_owner}:{x_conversion_id}".encode()).hexdigest() if x_conversion_id else None
    existing_job = engine.store.find_job_by_request_key(creation_key) if creation_key else None
    if existing_job is not None:
        existing = existing_job.to_dict()
        return {"job_id": existing["job_id"], "status": existing["status"].upper(), "job": lifecycle.view(existing)}
        
    crawl_config = {
        "depth_limit": request.crawl_depth,
        "full_site": request.full_site,
        "max_pages": request.max_pages,
        "max_assets": request.max_assets,
        "render_js": True,
        "enforce_static_source": bool(request.source_upload_id)
    }

    if creation_key:
        crawl_config["_request_key"] = creation_key
    job_data = engine.create_job(
        input_url=target_url,
        crawl_config=crawl_config
    )
    job_id = job_data["job_id"]
    
    # Schedule background execution of Stage 1 (crawling ONLY)
    queue_stage(job_id, "crawl", background_tasks, execute_real_conversion_job)
    
    return {"job_id": job_id, "status": "PENDING", "job": job_data}

@app.get("/api/jobs/{job_id}")
async def get_job_status(job_id: str):
    return {"job": lifecycle.view(job_or_404(job_id))}

@app.post("/api/jobs/{job_id}/run")
async def run_job(job_id: str, background_tasks: BackgroundTasks):
    job = job_or_404(job_id)
    if job_id in lifecycle.active or job["status"] in FINISHED | {"crawled", "extracted", "awaiting_approval", "schema_proposed"}:
        return {"job": lifecycle.view(job)}
    if job.get("schema_decision") == "approved":
        restore_generation(job_id)
        queue_stage(job_id, "generate", background_tasks, execute_code_generation)
    elif job["status"] == "inferring_schema" or (job["status"] == "failed" and
            job.get("extraction_report", {}).get("quality_gate") == "open"):
        queue_stage(job_id, "schema", background_tasks, execute_schema_inference)
    else:
        queue_stage(job_id, "crawl", background_tasks, execute_real_conversion_job)
    return {"job": lifecycle.view(job_or_404(job_id))}

async def execute_schema_inference(job_id: str):
    """
    Background task to execute Stage 2: Schema Inference.
    Wraps the call with proper error handling so failures are logged
    and the job status is updated to FAILED instead of silently swallowing.
    """
    return await asyncio.to_thread(engine.infer_schema_stage, job_id)


async def execute_code_generation(job_id: str):
    return await asyncio.to_thread(engine.run_job, job_id, target_stage="generate")

async def execute_schema_reinference(job_id: str):
    return await execute_schema_inference(job_id)


@app.post("/api/jobs/{job_id}/infer-schema")
async def infer_schema_endpoint(job_id: str, background_tasks: BackgroundTasks):
    try:
        job = job_or_404(job_id)
        if job_id in lifecycle.active:
            if lifecycle.active[job_id] != "schema":
                raise HTTPException(status_code=409, detail="Another stage is running")
            return {"job_id": job_id, "job": lifecycle.view(job), "message": "Schema inference already running"}
        if job["status"] in FINISHED | {"awaiting_approval", "schema_proposed", "approved", "generated"}:
            return {"job_id": job_id, "job": job, "message": "Schema inference already complete"}
        retryable = job["status"] == "failed" and job.get("extraction_report", {}).get("quality_gate") == "open"
        if job["status"] not in {"crawled", "extracted", "inferring_schema"} and not retryable:
            raise HTTPException(status_code=409, detail="Crawl must complete before schema inference")
        print(f"[Worker Engine] Triggering Stage 2 Schema Inference for job_id={job_id}")
        queue_stage(job_id, "schema", background_tasks, execute_schema_inference)
        return {"message": "Schema inference started", "job_id": job_id, "job": lifecycle.view(job)}
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/jobs/{job_id}/schema-decision")
async def submit_schema_decision(job_id: str, request: DecisionRequest, background_tasks: BackgroundTasks):
    try:
        job = job_or_404(job_id)
        if job_id in lifecycle.active:
            if request.decision == "approved" and lifecycle.active[job_id] == "generate" and job.get("schema_decision") == "approved":
                return {"job": lifecycle.view(job)}
            raise HTTPException(status_code=409, detail="Another stage is running")
        if request.decision == "approved" and job["status"] in FINISHED:
            return {"job": job}
        if job["status"] not in {"awaiting_approval", "schema_proposed", "approved", "failed", "generated"}:
            raise HTTPException(status_code=409, detail="Schema is not ready for review")
        if not job.get("schema_proposal", {}).get("entities"):
            raise HTTPException(status_code=409, detail="A schema proposal is required before review")
        print(f"[Worker Engine] Processing schema decision '{request.decision}' for job_id={job_id}")
        job_data = engine.decide_schema(job_id, request.decision, request.feedback)
        if request.decision == "approved":
            print(f"[Worker Engine] Schema approved. Triggering Stage 3 Code Generation for job_id={job_id}")
            queue_stage(job_id, "generate", background_tasks, execute_code_generation)
        elif request.decision == "rejected":
            print(f"[Worker Engine] Schema rejected. Triggering re-inference for Stage 2 for job_id={job_id}")
            queue_stage(job_id, "schema", background_tasks, execute_schema_reinference)
        return {"job": lifecycle.view(job_data)}
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/jobs/{job_id}/export")
async def export_job(job_id: str):
    try:
        export_manifest = await asyncio.to_thread(engine.export_job, job_id)
        zip_path = export_manifest.get("download", {}).get("zip_path")
        if not zip_path:
            raise ValueError("Zip path not found in export manifest")
        return FileResponse(path=zip_path, filename=f"export-{job_id}.zip", media_type="application/zip")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
