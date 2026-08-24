from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
import os
import asyncio
from pathlib import Path
from typing import Any

from src.engine.service import ConversionEngine

app = FastAPI(
    title="Agentic Converter API",
    description="FastAPI bridge for the LangGraph Python AI Worker",
    version="1.0.0"
)

# Global ConversionEngine instance
engine = ConversionEngine()

class JobRequest(BaseModel):
    url: str | None = None
    file_path: str | None = None
    crawl_depth: int = 2
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
async def create_job(request: JobRequest, background_tasks: BackgroundTasks):
    target_url = request.url or request.file_path
    if not target_url:
        raise HTTPException(status_code=400, detail="Must provide either URL or file_path")
        
    crawl_config = {
        "depth_limit": request.crawl_depth,
        "extract_images": request.extract_images,
        "max_pages": 100 if request.crawl_depth >= 3 else (50 if request.crawl_depth == 2 else 20),
        "max_assets": 100 if request.extract_images else 0,
        "render_js": True,
        "enforce_static_source": False
    }

    job_data = engine.create_job(
        input_url=target_url if request.url else None,
        html_pages=[target_url] if request.file_path else None,
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
        job_data = engine.run_job(job_id)
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
        print(f"[Worker Engine] Triggering Stage 2 Schema Inference for job_id={job_id}")
        background_tasks.add_task(execute_schema_inference, job_id)
        return {"message": "Schema inference started", "job_id": job_id}
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
        export_manifest = engine.export_job(job_id)
        zip_path = export_manifest.get("download", {}).get("zip_path")
        if not zip_path:
            raise ValueError("Zip path not found in export manifest")
        return FileResponse(path=zip_path, filename=f"export-{job_id}.zip", media_type="application/zip")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
