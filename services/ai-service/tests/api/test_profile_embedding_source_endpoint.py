from __future__ import annotations

import math
from pathlib import Path

import jwt
import pytest
from fastapi.testclient import TestClient

import src.api.main as api_main
from src.api.internal_auth import InternalAuthSettings
from src.area_embedding_reranker import (
    MODEL_EMBEDDING_DIMENSION,
    MODEL_ID,
    MODEL_REVISION,
    AreaEmbeddingSettings,
    ProfileEmbeddingSettings,
    ProfileEmbeddingSourceResult,
)


SECRET = "profile-embedding-internal-test-secret-long-enough"
ISSUER = "traza-api"
AUDIENCE = "traza-ai-service"
SOURCE = "Contenido curricular canonico de prueba."


@pytest.fixture(autouse=True)
def _disable_real_area_embedding_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    """Endpoint tests must never inherit a developer's local E5 configuration."""
    monkeypatch.setattr(api_main, "_embedding_settings_for_startup", lambda: AreaEmbeddingSettings(enabled=False))
    monkeypatch.setattr(api_main, "_profile_embedding_settings_for_startup", lambda: ProfileEmbeddingSettings(enabled=False))


def _enabled_app(monkeypatch, *, result: ProfileEmbeddingSourceResult | None = None) -> TestClient:
    monkeypatch.setattr(
        api_main,
        "_profile_embedding_settings_for_startup",
        lambda: ProfileEmbeddingSettings(enabled=True, model_dir=Path("/models/e5")),
    )
    monkeypatch.setattr(api_main, "prewarm_profile_embeddings", lambda _: None)
    response = result or _result()
    monkeypatch.setattr(api_main, "encode_profile_embedding_source", lambda source, _: response)
    return TestClient(api_main.create_app(InternalAuthSettings(mode="disabled")))


def _result() -> ProfileEmbeddingSourceResult:
    return ProfileEmbeddingSourceResult(
        vector=[1.0] + [0.0] * (MODEL_EMBEDDING_DIMENSION - 1),
        model_id=MODEL_ID,
        model_revision=MODEL_REVISION,
        embedding_dimension=MODEL_EMBEDDING_DIMENSION,
        source_policy_version="profile_embedding_source_v1",
        long_text_policy_version="area_embedding_long_text_policy_v1",
        long_text_policy_sha256="1319e903ae818b2a0290dc3b952e7f4ca89a15621c4dc176b27fd0c7197f4cc1",
    )


def _request(source: str = SOURCE) -> dict[str, str]:
    return {
        "schemaVersion": "profile_embedding_source_request_v1",
        "embeddingSource": source,
    }


def test_profile_embedding_source_requires_the_independent_feature_flag(monkeypatch) -> None:
    called = False

    def fail_if_called(*_args):
        nonlocal called
        called = True
        raise AssertionError("disabled route must not load or encode a model")

    monkeypatch.setattr(api_main, "encode_profile_embedding_source", fail_if_called)
    client = TestClient(api_main.create_app(InternalAuthSettings(mode="disabled")))

    response = client.post("/v1/profile-embedding/source", json=_request())

    assert response.status_code == 503
    assert response.json() == {"detail": "profile_embeddings_disabled"}
    assert called is False


def test_profile_embedding_source_returns_only_the_versioned_embedding_contract(monkeypatch) -> None:
    client = _enabled_app(monkeypatch)

    response = client.post("/v1/profile-embedding/source", json=_request())

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {
        "schemaVersion",
        "vector",
        "modelId",
        "modelRevision",
        "embeddingDimension",
        "sourcePolicyVersion",
        "longTextPolicyVersion",
        "longTextPolicySha256",
    }
    assert body["schemaVersion"] == "profile_embedding_source_response_v1"
    assert body["modelId"] == MODEL_ID
    assert body["modelRevision"] == MODEL_REVISION
    assert body["embeddingDimension"] == 384
    assert body["sourcePolicyVersion"] == "profile_embedding_source_v1"
    assert body["longTextPolicyVersion"] == "area_embedding_long_text_policy_v1"
    assert len(body["vector"]) == 384
    assert all(math.isfinite(value) for value in body["vector"])
    assert math.isclose(sum(value * value for value in body["vector"]), 1.0, rel_tol=1e-12)
    assert SOURCE not in body
    assert "credentialId" not in body


def test_profile_embedding_source_rejects_derived_or_malformed_request_shapes_before_encoding(monkeypatch) -> None:
    calls: list[str] = []
    monkeypatch.setattr(
        api_main,
        "_profile_embedding_settings_for_startup",
        lambda: ProfileEmbeddingSettings(enabled=True, model_dir=Path("/models/e5")),
    )
    monkeypatch.setattr(api_main, "prewarm_profile_embeddings", lambda _: None)
    monkeypatch.setattr(api_main, "encode_profile_embedding_source", lambda source, _: calls.append(source) or _result())
    client = TestClient(api_main.create_app(InternalAuthSettings(mode="disabled")))

    invalid_payloads = [
        {"schemaVersion": "other", "embeddingSource": SOURCE},
        _request("   "),
        {"schemaVersion": "profile_embedding_source_request_v1", "embeddingSource": SOURCE, "areas": []},
        {"schemaVersion": "profile_embedding_source_request_v1", "embeddingSource": 7},
    ]
    for payload in invalid_payloads:
        response = client.post("/v1/profile-embedding/source", json=payload)
        assert response.status_code == 422
    assert calls == []


def test_profile_embedding_source_requires_existing_internal_auth(monkeypatch) -> None:
    monkeypatch.setattr(
        api_main,
        "_profile_embedding_settings_for_startup",
        lambda: ProfileEmbeddingSettings(enabled=True, model_dir=Path("/models/e5")),
    )
    monkeypatch.setattr(api_main, "prewarm_profile_embeddings", lambda _: None)
    monkeypatch.setattr(api_main, "encode_profile_embedding_source", lambda _source, _settings: _result())
    client = TestClient(
        api_main.create_app(
            InternalAuthSettings(mode="jwt", secret=SECRET, issuer=ISSUER, audience=AUDIENCE, clock_skew_seconds=0)
        )
    )

    missing = client.post("/v1/profile-embedding/source", json=_request())
    assert missing.status_code == 401

    token = jwt.encode(
        {"iss": ISSUER, "aud": AUDIENCE, "sub": "traza-api", "iat": 1_700_000_000, "exp": 1_900_000_000, "jti": "profile-embedding"},
        SECRET,
        algorithm="HS256",
    )
    authorized = client.post(
        "/v1/profile-embedding/source",
        json=_request(),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert authorized.status_code == 200


def test_profile_embedding_source_sanitizes_encoder_failures(monkeypatch) -> None:
    monkeypatch.setattr(
        api_main,
        "_profile_embedding_settings_for_startup",
        lambda: ProfileEmbeddingSettings(enabled=True, model_dir=Path("/models/e5")),
    )
    monkeypatch.setattr(api_main, "prewarm_profile_embeddings", lambda _: None)

    def fail(source: str, _settings: ProfileEmbeddingSettings) -> ProfileEmbeddingSourceResult:
        raise RuntimeError(f"must not disclose {source}")

    monkeypatch.setattr(api_main, "encode_profile_embedding_source", fail)
    response = TestClient(api_main.create_app(InternalAuthSettings(mode="disabled"))).post(
        "/v1/profile-embedding/source", json=_request()
    )

    assert response.status_code == 503
    assert response.json() == {"detail": "profile_embedding_unavailable"}
    assert SOURCE not in response.text
