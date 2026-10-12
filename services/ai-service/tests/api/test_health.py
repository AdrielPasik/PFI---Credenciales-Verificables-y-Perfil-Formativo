from pathlib import Path

from fastapi.testclient import TestClient

import src.api.main as api_main
from src.api.internal_auth import InternalAuthSettings
from src.area_embedding_reranker import AreaEmbeddingSettings
from src.api.main import app


client = TestClient(app)


def test_health_returns_ok_without_running_a_pipeline() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "pfi-ai-service"}


def test_ready_is_immediate_and_model_free_when_feature_is_off(monkeypatch) -> None:
    monkeypatch.setattr(api_main, "_embedding_settings_for_startup", lambda: AreaEmbeddingSettings(enabled=False))

    def fail_if_called(_: AreaEmbeddingSettings) -> None:
        raise AssertionError("prewarm must not run while embeddings are disabled")

    monkeypatch.setattr(api_main, "prewarm_area_embeddings", fail_if_called)
    application = api_main.create_app(InternalAuthSettings(mode="disabled"))
    with TestClient(application) as client:
        assert client.get("/health").json() == {"status": "ok", "service": "pfi-ai-service"}
        response = client.get("/ready")
        assert response.status_code == 200
        assert response.json() == {"status": "ready"}


def test_ready_stays_negative_when_enabled_prewarm_fails(monkeypatch) -> None:
    monkeypatch.setattr(
        api_main,
        "_embedding_settings_for_startup",
        lambda: AreaEmbeddingSettings(enabled=True, model_dir=Path("/models/e5")),
    )
    monkeypatch.setattr(api_main, "prewarm_area_embeddings", lambda _: (_ for _ in ()).throw(RuntimeError("failure")))
    application = api_main.create_app(InternalAuthSettings(mode="disabled"))
    assert application.state.embedding_readiness.ready is False
    with TestClient(application) as client:
        assert client.get("/health").status_code == 200
        response = client.get("/ready")
        assert response.status_code == 503
        assert response.json() == {"status": "not_ready"}


def test_ready_becomes_positive_only_after_enabled_prewarm_completes(monkeypatch) -> None:
    calls: list[AreaEmbeddingSettings] = []
    settings = AreaEmbeddingSettings(enabled=True, model_dir=Path("/models/e5"))
    monkeypatch.setattr(api_main, "_embedding_settings_for_startup", lambda: settings)
    monkeypatch.setattr(api_main, "prewarm_area_embeddings", lambda value: calls.append(value))
    application = api_main.create_app(InternalAuthSettings(mode="disabled"))
    assert application.state.embedding_readiness.ready is False
    with TestClient(application) as client:
        response = client.get("/ready")
        assert response.status_code == 200
        assert response.json() == {"status": "ready"}
    assert calls == [settings]

