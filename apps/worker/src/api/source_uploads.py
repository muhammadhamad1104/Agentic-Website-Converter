"""Durable website uploads accessible only to the backend service."""
import asyncio
import json
import secrets
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, Header, HTTPException, Request

from src.config.settings import settings
from src.engine.source_zip import MAX_UPLOAD_BYTES, inspect_static_archive

router = APIRouter()


def authorize(secret):
    if not settings.PREVIEW_API_SECRET or not secrets.compare_digest(settings.PREVIEW_API_SECRET, secret):
        raise HTTPException(status_code=403, detail="Source upload service is not authorized")


def upload_directory():
    return Path(settings.JOB_STORE_PATH).resolve().parent / "source-uploads"


def uploaded_source(source_id, owner):
    try:
        source_id = str(UUID(str(source_id)))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid source upload")
    root = upload_directory()
    archive = root / (source_id + ".zip")
    metadata = root / (source_id + ".json")
    if not archive.is_file() or not metadata.is_file():
        raise HTTPException(status_code=404, detail="Uploaded ZIP is unavailable. Upload it again.")
    info = json.loads(metadata.read_text())
    if not owner or info["owner_id"] != owner:
        raise HTTPException(status_code=403, detail="Source upload belongs to another account")
    return archive, info


@router.post("/api/sources/zip", status_code=201)
async def upload_zip(request: Request, filename: str, x_preview_secret: str = Header(default=""),
                     x_source_owner: str = Header(default="")):
    authorize(x_preview_secret)
    filename = Path(filename.replace("\\", "/")).name
    if not x_source_owner or len(x_source_owner) > 128:
        raise HTTPException(status_code=400, detail="Source owner is required")
    if not filename.lower().endswith(".zip") or len(filename) > 255:
        raise HTTPException(status_code=400, detail="Choose a .zip website archive")
    root = upload_directory()
    root.mkdir(parents=True, exist_ok=True)
    source_id = str(uuid4())
    temporary = root / (source_id + ".upload")
    archive = root / (source_id + ".zip")
    metadata = root / (source_id + ".json")
    total = 0
    try:
        with temporary.open("xb") as output:
            async for chunk in request.stream():
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="ZIP exceeds the 100 MB upload limit")
                output.write(chunk)
        report = await asyncio.to_thread(inspect_static_archive, temporary)
        temporary.replace(archive)
        info = {"id": source_id, "filename": filename, "bytes": total, **report, "owner_id": x_source_owner}
        metadata.write_text(json.dumps(info))
        return {key: value for key, value in info.items() if key != "owner_id"}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except BaseException:
        archive.unlink(missing_ok=True)
        metadata.unlink(missing_ok=True)
        raise
    finally:
        temporary.unlink(missing_ok=True)


@router.delete("/api/sources/zip/{source_id}")
async def delete_upload(source_id: UUID, x_preview_secret: str = Header(default=""),
                        x_source_owner: str = Header(default="")):
    authorize(x_preview_secret)
    archive, _info = uploaded_source(str(source_id), x_source_owner)
    archive.unlink()
    archive.with_suffix(".json").unlink()
    return {"ok": True}
