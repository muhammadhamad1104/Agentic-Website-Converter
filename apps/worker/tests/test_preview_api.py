from types import SimpleNamespace
from fastapi.testclient import TestClient
from src.api import main
from src.config.settings import settings

LEASE = "11111111-1111-4111-8111-111111111111"


def test_preview_requires_shared_secret(monkeypatch):
    monkeypatch.setattr(settings, "PREVIEW_API_SECRET", "private")
    client = TestClient(main.app)
    assert client.post("/api/jobs/job/preview/start", json={"owner_id": "owner", "lease_id": LEASE}).status_code == 403
    assert client.get("/api/previews/" + LEASE + "/proxy/").status_code == 403


def test_stopped_preview_proxy_returns_gone(monkeypatch):
    monkeypatch.setattr(settings, "PREVIEW_API_SECRET", "private")
    client = TestClient(main.app)
    response = client.get("/api/previews/" + LEASE + "/proxy/", headers={"X-Preview-Secret": "private", "X-Preview-Owner": "stranger"})
    assert response.status_code == 410


def test_proxy_uses_registered_runtime_and_keeps_query_parameters(monkeypatch):
    monkeypatch.setattr(settings, "PREVIEW_API_SECRET", "private")
    called = {}
    def status(owner, lease):
        assert owner == "owner" and lease == LEASE
        return {"status": "ready", "url": "http://127.0.0.1:12345"}
    def upstream(method, url, **kwargs):
        called.update(method=method, url=url, **kwargs)
        return SimpleNamespace(content=b"<h1>Captured page</h1>", status_code=200,
                               headers={"Content-Type": "text/html", "Content-Encoding": "gzip"})
    monkeypatch.setattr(main.previews, "status", status)
    monkeypatch.setattr(main.requests, "request", upstream)
    client = TestClient(main.app)
    response = client.get("/api/previews/" + LEASE + "/proxy/__site/services?tag=a&tag=b",
                          headers={"X-Preview-Secret": "private", "X-Preview-Owner": "owner", "Authorization": "must-not-forward"})
    assert response.status_code == 200
    assert called["url"] == "http://127.0.0.1:12345/__site/services"
    assert called["params"] == [("tag", "a"), ("tag", "b")]
    assert called["allow_redirects"] is False
    assert "authorization" not in called["headers"]
    assert "Content-Encoding" not in response.headers
