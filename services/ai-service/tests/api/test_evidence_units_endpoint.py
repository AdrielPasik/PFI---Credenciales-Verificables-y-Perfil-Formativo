"""Ruta `/v1/evidence-units` — slice F3.4.

Transporte, no grounding: que el request sea evidence-only por construcción y que
los fallos lleguen con el mismo envelope `ai_service_error_v1` y la misma
taxonomía que F3.3B/F3.3B.2, porque de eso depende el desenlace del run.

Sin proveedor real y sin red.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from src.api.internal_auth import InternalAuthSettings
from src.api.main import create_app
from src.api.evidence_units import contracts, provider as provider_module
from src.api.evidence_units.contracts import (
    ProviderConfigurationError,
    ProviderObservation,
    ProviderTransportError,
)

MODEL = "gpt-5.6-terra"
TEXT = "Curso de APIs REST.\n\nContenidos: endpoints y testing."


class SpyProvider:
    calls = 0
    output: Any = {"evidenceUnits": []}
    raises: Exception | None = None

    def __init__(self) -> None:
        pass

    def complete(self, **_: Any) -> ProviderObservation:
        type(self).calls += 1
        if type(self).raises is not None:
            raise type(self).raises
        return ProviderObservation(output=type(self).output, reported_model=MODEL)


@pytest.fixture(autouse=True)
def spy(monkeypatch: pytest.MonkeyPatch) -> type[SpyProvider]:
    SpyProvider.calls = 0
    SpyProvider.output = {"evidenceUnits": []}
    SpyProvider.raises = None
    monkeypatch.setenv(provider_module.ENV_MODEL, MODEL)
    monkeypatch.setattr(
        "src.api.evidence_units.service.OpenAIEvidenceUnitsProvider", SpyProvider
    )
    return SpyProvider


@pytest.fixture()
def client() -> TestClient:
    app = create_app(
        InternalAuthSettings(mode="disabled", secret=None, issuer=None, audience=None)
    )
    return TestClient(app)


def plan(**overrides: Any) -> dict[str, Any]:
    value = {
        "artifactSchemaVersion": contracts.ARTIFACT_SCHEMA_VERSION,
        "promptVersion": contracts.PRODUCT_PROMPT_VERSION,
        "adapterVersion": contracts.PRODUCT_ADAPTER_VERSION,
        "provider": contracts.SUPPORTED_PROVIDER,
        "model": MODEL,
        "reasoningEffort": contracts.SUPPORTED_REASONING_EFFORT,
    }
    value.update(overrides)
    return value


def source(source_id: str = "src_01") -> dict[str, Any]:
    return {
        "sourceId": source_id,
        "sourceSha256": "a" * 64,
        "coverageStatus": "FULL",
        "canonicalText": TEXT,
        "segments": [
            {"segmentId": "d:0-19", "charStart": 0, "charEnd": 19, "exactExcerpt": TEXT[0:19]},
            {"segmentId": "d:21-53", "charStart": 21, "charEnd": 53, "exactExcerpt": TEXT[21:53]},
        ],
        "pages": [],
        "diagnostics": [],
    }


def body(**overrides: Any) -> dict[str, Any]:
    value: dict[str, Any] = {
        "schemaVersion": contracts.REQUEST_SCHEMA_VERSION,
        "executionPlan": plan(),
        "sources": [source()],
    }
    value.update(overrides)
    return value


def post(client: TestClient, **overrides: Any):
    return client.post("/v1/evidence-units", json=body(**overrides))


def envelope_code(response) -> str:
    payload = response.json()
    assert payload["schemaVersion"] == "ai_service_error_v1", payload
    return payload["code"]


# ---------------------------------------------------------------------------
# Camino feliz
# ---------------------------------------------------------------------------


def test_returns_artifact_and_execution_envelope(client: TestClient) -> None:
    SpyProvider.output = {
        "evidenceUnits": [
            {
                "sourceId": "src_01",
                "segmentId": "d:0-19",
                "quoteText": "Curso de APIs REST.",
                "normalizedProposition": "El curso cubre APIs REST.",
                "claimType": "DECLARED_CONTENT",
                "semanticQualifiers": [],
            }
        ]
    }
    response = post(client)

    assert response.status_code == 200
    payload = response.json()
    assert payload["schemaVersion"] == contracts.RESPONSE_SCHEMA_VERSION
    assert payload["artifact"]["schemaVersion"] == "evidence_units_v1"
    assert payload["execution"]["effectiveModelVerification"] == "MATCH"
    assert SpyProvider.calls == 1


def test_zero_sources_returns_empty_catalog_without_calling(client: TestClient) -> None:
    response = post(client, sources=[])

    assert response.status_code == 200
    assert SpyProvider.calls == 0
    artifact = response.json()["artifact"]
    assert artifact["sources"] == []
    assert artifact["evidenceUnits"] == []


def test_response_carries_no_raw_output_or_prompt(client: TestClient) -> None:
    text = post(client).text
    for forbidden in ("rawResponse", "SOURCES=", "NORMATIVE_POLICY", "usage"):
        assert forbidden not in text


# ---------------------------------------------------------------------------
# Evidence-only por construcción
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "extra",
    [
        {"objectiveContext": "Backend"},
        {"requirements": []},
        {"objectiveAnalysisArtifact": {}},
        {"semanticAnalysis": {}},
        {"formativeProfile": {}},
        {"credentials": []},
        {"ownerUserId": "user_01"},
    ],
)
def test_request_rejects_objective_and_legacy_semantic_input(
    client: TestClient, extra: dict[str, Any]
) -> None:
    # `extra="forbid"` hace la independencia estructural, no una promesa del prompt.
    response = client.post("/v1/evidence-units", json=body(**extra))
    assert response.status_code == 422
    assert SpyProvider.calls == 0


@pytest.mark.parametrize(
    "extra_source_field",
    ["credentialId", "documentEvidenceId", "textEvidenceId", "artifactBlobSha256"],
)
def test_source_cannot_carry_database_identity(
    client: TestClient, extra_source_field: str
) -> None:
    tainted = source()
    tainted[extra_source_field] = "x"
    response = client.post("/v1/evidence-units", json=body(sources=[tainted]))
    assert response.status_code == 422
    assert SpyProvider.calls == 0


def test_unsupported_request_schema_version_is_rejected(client: TestClient) -> None:
    response = post(client, schemaVersion="product_evidence_units_request_v2")
    assert response.status_code == 422
    assert response.json()["detail"] == "evidence_units_request_schema_unsupported"
    assert SpyProvider.calls == 0


# ---------------------------------------------------------------------------
# Grounding set inutilizable
# ---------------------------------------------------------------------------


def test_unusable_grounding_input_is_422_without_envelope(client: TestClient) -> None:
    # No es un hecho sobre el proveedor: es material congelado que no sirve.
    broken = source()
    broken["segments"][0]["exactExcerpt"] = "manipulado"
    response = client.post("/v1/evidence-units", json=body(sources=[broken]))

    assert response.status_code == 422
    assert response.json().get("code") is None
    assert response.json()["detail"].startswith("evidence_units_grounding_input_invalid:")
    assert SpyProvider.calls == 0


# ---------------------------------------------------------------------------
# Taxonomía de fallos — la misma que F3.3B
# ---------------------------------------------------------------------------


def test_plan_mismatch_is_409_with_zero_provider_calls(client: TestClient) -> None:
    response = post(client, executionPlan=plan(promptVersion="otra"))
    assert response.status_code == 409
    assert envelope_code(response) == "EXECUTION_PLAN_MISMATCH"
    assert SpyProvider.calls == 0


def test_invalid_provider_output_is_502(client: TestClient) -> None:
    SpyProvider.output = {"evidenceUnits": "no es lista"}
    response = post(client)
    assert response.status_code == 502
    assert envelope_code(response) == "PROVIDER_INVALID_OUTPUT"
    assert SpyProvider.calls == 1


def test_transport_failure_is_503(client: TestClient) -> None:
    SpyProvider.raises = ProviderTransportError("provider_timeout")
    response = post(client)
    assert response.status_code == 503
    assert envelope_code(response) == "PROVIDER_TRANSPORT_FAILURE"


def test_deterministic_configuration_failure_is_424(client: TestClient) -> None:
    SpyProvider.raises = ProviderConfigurationError("provider_http_404:model_not_found")
    response = post(client)
    assert response.status_code == 424
    assert envelope_code(response) == "PROVIDER_CONFIGURATION_FAILURE"


def test_error_bodies_leak_no_source_text(client: TestClient) -> None:
    secret = "TEXTO-CONFIDENCIAL"
    tainted = source()
    tainted["canonicalText"] = f"Curso con {secret}."
    tainted["segments"] = [
        {"segmentId": "d:0-10", "charStart": 0, "charEnd": 10, "exactExcerpt": "manipulado"}
    ]
    response = client.post("/v1/evidence-units", json=body(sources=[tainted]))
    assert secret not in response.text


# ---------------------------------------------------------------------------
# Superficie
# ---------------------------------------------------------------------------


def test_route_is_registered_once_with_auth_dependency() -> None:
    app = create_app(
        InternalAuthSettings(mode="disabled", secret=None, issuer=None, audience=None)
    )
    routes = [r for r in app.routes if getattr(r, "path", None) == "/v1/evidence-units"]
    assert len(routes) == 1, "una llamada por run: no hay ruta por fuente"
    assert routes[0].dependencies
    assert list(routes[0].methods) == ["POST"]
