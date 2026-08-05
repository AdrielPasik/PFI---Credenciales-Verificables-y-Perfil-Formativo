from fastapi.testclient import TestClient

from src.api.main import app


client = TestClient(app)


def test_health_returns_ok_without_running_a_pipeline() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "pfi-ai-service"}

