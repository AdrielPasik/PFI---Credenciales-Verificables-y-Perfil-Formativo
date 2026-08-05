from __future__ import annotations

import base64
import json
import time
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient

from src.api.internal_auth import InternalAuthSettings
from src.api.main import create_app
from tests.profile_builder._fixtures import pdf_artifact


SECRET = "internal-test-secret-that-is-not-a-user-secret-and-is-long-enough"
OTHER_SECRET = "different-internal-test-secret-that-is-also-long-enough-value"
ISSUER = "traza-api"
AUDIENCE = "traza-ai-service"


def _jwt_settings() -> InternalAuthSettings:
    return InternalAuthSettings(
        mode="jwt",
        secret=SECRET,
        issuer=ISSUER,
        audience=AUDIENCE,
        clock_skew_seconds=0,
    )


def _claims(**overrides: Any) -> dict[str, Any]:
    now = int(time.time())
    claims: dict[str, Any] = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "sub": "traza-api",
        "iat": now,
        "exp": now + 60,
        "jti": "test-request-1",
    }
    claims.update(overrides)
    return claims


def _profile_request(client: TestClient, token: str | None = None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return client.post(
        "/v1/formative-profile/build",
        headers=headers,
        json={"artifacts": [pdf_artifact()]},
    )


def test_disabled_mode_allows_v1_without_authorization() -> None:
    client = TestClient(create_app(InternalAuthSettings(mode="disabled")))

    assert _profile_request(client).status_code == 200


def test_jwt_mode_rejects_missing_token_with_sanitized_response() -> None:
    client = TestClient(create_app(_jwt_settings()))

    response = _profile_request(client)

    assert response.status_code == 401
    assert response.json() == {"detail": "Internal service credential required."}


def test_jwt_mode_accepts_valid_internal_token() -> None:
    client = TestClient(create_app(_jwt_settings()))
    token = jwt.encode(_claims(), SECRET, algorithm="HS256")

    assert _profile_request(client, token).status_code == 200


@pytest.mark.parametrize(
    ("token"),
    [
        jwt.encode(_claims(exp=int(time.time()) - 120), SECRET, algorithm="HS256"),
        jwt.encode(_claims(iss="other-service"), SECRET, algorithm="HS256"),
        jwt.encode(_claims(aud="other-audience"), SECRET, algorithm="HS256"),
        jwt.encode(_claims(sub="other-service"), SECRET, algorithm="HS256"),
        jwt.encode(_claims(), OTHER_SECRET, algorithm="HS256"),
        jwt.encode(_claims(), SECRET, algorithm="HS384"),
    ],
    ids=[
        "expired",
        "wrong-issuer",
        "wrong-audience",
        "wrong-subject",
        "wrong-signature",
        "wrong-algorithm",
    ],
)
def test_jwt_mode_rejects_invalid_tokens_uniformly(token: str) -> None:
    client = TestClient(create_app(_jwt_settings()))

    response = _profile_request(client, token)

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid internal service credential."}
    assert SECRET not in response.text
    assert token not in response.text


def test_jwt_mode_rejects_none_algorithm() -> None:
    encoded_header = _base64url({"alg": "none", "typ": "JWT"})
    encoded_payload = _base64url(_claims())
    token = f"{encoded_header}.{encoded_payload}."
    client = TestClient(create_app(_jwt_settings()))

    response = _profile_request(client, token)

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid internal service credential."}


@pytest.mark.parametrize(
    "missing_name",
    [
        "AI_INTERNAL_JWT_SECRET",
        "AI_INTERNAL_JWT_ISSUER",
        "AI_INTERNAL_JWT_AUDIENCE",
    ],
)
def test_jwt_mode_missing_config_fails_when_building_app(
    monkeypatch: pytest.MonkeyPatch,
    missing_name: str,
) -> None:
    values = {
        "AI_INTERNAL_AUTH_MODE": "jwt",
        "AI_INTERNAL_JWT_SECRET": SECRET,
        "AI_INTERNAL_JWT_ISSUER": ISSUER,
        "AI_INTERNAL_JWT_AUDIENCE": AUDIENCE,
    }
    for name, value in values.items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv(missing_name, raising=False)

    with pytest.raises(RuntimeError, match=f"{missing_name} is required"):
        create_app()


def test_jwt_mode_rejects_reuse_of_human_jwt_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AI_INTERNAL_AUTH_MODE", "jwt")
    monkeypatch.setenv("AI_INTERNAL_JWT_SECRET", SECRET)
    monkeypatch.setenv("AI_INTERNAL_JWT_ISSUER", ISSUER)
    monkeypatch.setenv("AI_INTERNAL_JWT_AUDIENCE", AUDIENCE)
    monkeypatch.setenv("JWT_SECRET", SECRET)

    with pytest.raises(RuntimeError, match="must be different from JWT_SECRET"):
        create_app()


@pytest.mark.parametrize("value", ["", "unknown", "passthrough"])
def test_unknown_auth_mode_fails_when_building_app(
    monkeypatch: pytest.MonkeyPatch,
    value: str,
) -> None:
    monkeypatch.setenv("AI_INTERNAL_AUTH_MODE", value)

    with pytest.raises(RuntimeError, match="must be disabled or jwt"):
        create_app()


@pytest.mark.parametrize("value", ["", "invalid", "-1", "301"])
def test_invalid_clock_skew_fails_when_building_app(
    monkeypatch: pytest.MonkeyPatch,
    value: str,
) -> None:
    monkeypatch.setenv("AI_INTERNAL_AUTH_MODE", "disabled")
    monkeypatch.setenv("AI_INTERNAL_JWT_CLOCK_SKEW_SECONDS", value)

    with pytest.raises(RuntimeError, match="must be an integer between 0 and 300"):
        create_app()


def test_health_remains_public_in_jwt_mode() -> None:
    client = TestClient(create_app(_jwt_settings()))

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "pfi-ai-service"}


def _base64url(value: dict[str, Any]) -> str:
    encoded = json.dumps(value, separators=(",", ":")).encode("utf8")
    return base64.urlsafe_b64encode(encoded).decode("ascii").rstrip("=")
