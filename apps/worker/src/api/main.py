from fastapi import FastAPI, BackgroundTasks, HTTPException, Header, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
import os
import asyncio
from pathlib import Path
from typing import Any

from src.engine.service import ConversionEngine
from src.engine.preview import PreviewManager
from src.config.settings import settings
from src.api.source_uploads import router as source_router, authorize as authorize_source, uploaded_source
import secrets
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
    decision: str = "approved"
    feedback: Any = None

async def execute_real_conversion_job(job_id: str):
    """
    Background task to execute Stage 1: Crawl & Extract content ONLY.
    Pauses at status=crawled waiting for user to proceed to schema inference.
    """
    print(f"[Worker Engine] Running Stage 1 Crawl workflow for job_id={job_id}")
    try:
        res1 = await asyncio.to_thread(engine.run_job, job_id, target_stage="crawl")
        current_status = str(res1.get("status", "")).lower()
        print(f"[Worker Engine] Stage 1 Crawl for job {job_id} reached status={current_status}")
    except Exception as e:
        print(f"[Worker Engine] Job {job_id} failed with error: {e}")

@app.post("/api/jobs")
async def create_job(request: JobRequest, background_tasks: BackgroundTasks,
                     x_preview_secret: str = Header(default=""), x_source_owner: str = Header(default="")):
    target_url = request.url or request.file_path
    if sum(bool(value) for value in (request.url, request.file_path, request.source_upload_id)) > 1:
        raise HTTPException(status_code=400, detail="Provide exactly one input source")
    if request.source_upload_id:
        authorize_source(x_preview_secret)
        archive, _info = uploaded_source(request.source_upload_id, x_source_owner)
        target_url = str(archive)
    if not target_url:
        raise HTTPException(status_code=400, detail="Must provide either URL or file_path")
        
    crawl_config = {
        "depth_limit": request.crawl_depth,
        "full_site": request.full_site,
        "max_pages": request.max_pages,
        "max_assets": request.max_assets,
        "render_js": True,
        "enforce_static_source": bool(request.source_upload_id)
    }

    job_data = engine.create_job(
        input_url=target_url,
        crawl_config=crawl_config
    )
    job_id = job_data["job_id"]
    
    # Schedule background execution of Stage 1 (crawling ONLY)
    background_tasks.add_task(execute_real_conversion_job, job_id)
    
    return {"job_id": job_id, "status": "PENDING", "job": job_data}

@app.get("/api/jobs/{job_id}")
async def get_job_status(job_id: str):
    try:
        job_data = engine.get_job(job_id)
        return {"job": job_data}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.post("/api/jobs/{job_id}/run")
async def run_job(job_id: str):
    try:
        job_data = await asyncio.to_thread(engine.run_job, job_id)
        return {"job": job_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

async def execute_schema_inference(job_id: str):
    """
    Background task to execute Stage 2: Schema Inference.
    Wraps the call with proper error handling so failures are logged
    and the job status is updated to FAILED instead of silently swallowing.
    """
    print(f"[Worker Engine] Starting Stage 2 Schema Inference background task for job_id={job_id}")
    try:
        result = await asyncio.to_thread(engine.infer_schema_stage, job_id)
        status = result.get("status", "unknown") if isinstance(result, dict) else "unknown"
        schema = result.get("schema_proposal", {}) if isinstance(result, dict) else {}
        entity_count = len(schema.get("entities", []))
        print(f"[Worker Engine] Stage 2 Schema Inference for job {job_id} completed: status={status}, entities={entity_count}")
    except Exception as e:
        print(f"[Worker Engine] Stage 2 Schema Inference for job {job_id} FAILED with error: {e}")
        import traceback
        traceback.print_exc()
        # Try to mark the job as failed so the frontend stops polling
        try:
            job_data = engine.get_job(job_id)
        except Exception:
            pass


async def execute_code_generation(job_id: str):
    print(f"[Worker Engine] Starting Stage 3 Code Generation background task for job_id={job_id}")
    try:
        await asyncio.to_thread(engine.run_job, job_id, target_stage="generate")
        print(f"[Worker Engine] Stage 3 Code Generation for job {job_id} completed.")
    except Exception as e:
        print(f"[Worker Engine] Stage 3 Code Generation for job {job_id} FAILED with error: {e}")
        import traceback
        traceback.print_exc()

async def execute_schema_reinference(job_id: str):
    print(f"[Worker Engine] Starting Re-Inference background task for job_id={job_id}")
    try:
        await asyncio.to_thread(engine.run_job, job_id, target_stage="schema")
        print(f"[Worker Engine] Re-Inference for job {job_id} completed.")
    except Exception as e:
        print(f"[Worker Engine] Re-Inference for job {job_id} FAILED with error: {e}")
        import traceback
        traceback.print_exc()


@app.post("/api/jobs/{job_id}/infer-schema")
async def infer_schema_endpoint(job_id: str, background_tasks: BackgroundTasks):
    try:
        job = engine.get_job(job_id)
        if job["status"] not in {"crawled", "extracted", "awaiting_approval", "schema_proposed"}:
            raise HTTPException(status_code=409, detail="Crawl must complete before schema inference")
        print(f"[Worker Engine] Triggering Stage 2 Schema Inference for job_id={job_id}")
        background_tasks.add_task(execute_schema_inference, job_id)
        return {"message": "Schema inference started", "job_id": job_id}
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/jobs/{job_id}/schema-decision")
async def submit_schema_decision(job_id: str, request: DecisionRequest, background_tasks: BackgroundTasks):
    try:
        print(f"[Worker Engine] Processing schema decision '{request.decision}' for job_id={job_id}")
        job_data = engine.decide_schema(job_id, request.decision, request.feedback)
        if request.decision == "approved":
            print(f"[Worker Engine] Schema approved. Triggering Stage 3 Code Generation for job_id={job_id}")
            background_tasks.add_task(execute_code_generation, job_id)
        elif request.decision == "rejected":
            print(f"[Worker Engine] Schema rejected. Triggering re-inference for Stage 2 for job_id={job_id}")
            background_tasks.add_task(execute_schema_reinference, job_id)
        return {"job": job_data}
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
