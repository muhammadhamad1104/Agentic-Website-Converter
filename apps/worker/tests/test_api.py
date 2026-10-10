from fastapi.testclient import TestClient
from src.api.main import app
import pytest
from src.api import main
from src.engine.job_store import InMemoryJobStore


@pytest.fixture(autouse=True)
def isolate_api(monkeypatch):
    monkeypatch.setattr(main.engine, "store", InMemoryJobStore())
    async def skip_background(job_id):
        pass
    monkeypatch.setattr(main, "execute_real_conversion_job", skip_background)

client = TestClient(app)

def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "worker"}

def test_create_job():
    payload = {
        "url": "https://example.com",
        "crawl_depth": 2,
        "extract_images": True,
        "ai_provider": "openai"
    }
    response = client.post("/api/jobs", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "job_id" in data
    assert data["status"] == "PENDING"
    
    # Check status
    job_id = data["job_id"]
    status_response = client.get(f"/api/jobs/{job_id}")
    assert status_response.status_code == 200
    assert status_response.json()["job"]["job_id"] == job_id

def test_create_job_missing_args():
    # Neither url nor file_path provided
    payload = {}
    response = client.post("/api/jobs", json=payload)
    assert response.status_code == 400
    assert "Must provide either URL or file_path" in response.json()["detail"]

def test_get_invalid_job():
    response = client.get("/api/jobs/invalid-job-123")
    assert response.status_code == 404
    assert "Unknown job_id" in response.json()["detail"]
