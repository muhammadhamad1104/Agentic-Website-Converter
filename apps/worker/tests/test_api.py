from fastapi.testclient import TestClient
from src.api.main import app

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
    assert status_response.json()["job_id"] == job_id

def test_create_job_missing_args():
    # Neither url nor file_path provided
    payload = {}
    response = client.post("/api/jobs", json=payload)
    assert response.status_code == 400
    assert "Must provide either URL or file_path" in response.json()["detail"]

def test_get_invalid_job():
    response = client.get("/api/jobs/invalid-job-123")
    assert response.status_code == 404
    assert response.json()["detail"] == "Job not found"
