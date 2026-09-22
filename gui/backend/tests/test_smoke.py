"""Smoke tests: app imports cleanly and core read-only endpoints respond."""

from fastapi.testclient import TestClient

from app.main import app


def test_health() -> None:
    with TestClient(app) as client:
        resp = client.get("/api/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}


def test_app_metadata() -> None:
    assert app.title == "Nautilus GUI Backend"
    assert app.version == "0.2.0"


def test_get_endpoints_respond() -> None:
    with TestClient(app) as client:
        for path in ("/api/node", "/api/summary", "/api/strategies", "/api/adapters"):
            resp = client.get(path)
            assert resp.status_code == 200, (path, resp.status_code, resp.text[:200])
