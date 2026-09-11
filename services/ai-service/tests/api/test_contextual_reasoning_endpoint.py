"""Ruta `/v1/contextual-reasoning` — slice F3.5.

Transporte: que el request sea evidence-only y sin material crudo por
construcción, que atienda UN Requirement, y que los fallos lleguen con el mismo
envelope `ai_service_error_v1` que las otras dos etapas.

Sin proveedor real y sin red.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from src.api.internal_auth import InternalAuthSettings
from src.api.main import create_app
from src.api.contextual_reasoning import contracts, provider as provider_module
from src.api.contextual_reasoning.contracts import (
    ProviderConfigurationError,
    ProviderObservation,
    ProviderTransportError,
)

MODEL = "gpt-5.6-terra"
REQUIREMENT_TEXT = "Diseno de APIs REST"


def contextual_output() -> dict[str, Any]:
    return {
        "requirementId": "req_01",
        "evaluatedEvidence": [],
        "facets": [],
        "compositionAssessment": {
            "mode": "NONE",
            "nonRedundantEvidenceUnitIds": [],
            "jointlySupportsFullRequirement": False,
            "integrationRequired": False,
            "integrationDemonstrated": False,
            "integrationEvidenceIds": [],
            "missingFacetLocalKeys": [],
            "unresolved": False,
            "rationale": "Sin evidencia relevante.",
        },
        "fullClaimAssessment": {
            "status": "NOT_REACHED",
            "supportedQualifierIds": [],
            "missingQualifierIds": [],
            "coveredFacetLocalKeys": [],
            "missingFacetLocalKeys": [],
            "rationale": "No alcanza.",
        },
        "jointClaimCeiling": {"text": "Nada defendible.", "supportingEvidenceUnitIds": []},
        "observabilityAssessment": {
            "incompleteSourceAssessments": [],
            "independentObservableSupport": "NONE",
            "observabilityStatus": "SUFFICIENT",
            "rationale": "Completa.",
        },
        "weakerClaimSearch": {"status": "NONE", "rationale": "Buscada.", "candidate": None},
        "semanticUnresolved": False,
        "unresolvedReason": "",
    }


class SpyProvider:
    calls = 0
    output: Any = None
    raises: Exception | None = None

    def __init__(self) -> None:
        pass

    def complete(self, **_: Any) -> ProviderObservation:
        type(self).calls += 1
        if type(self).raises is not None:
            raise type(self).raises
        return ProviderObservation(
            output=type(self).output or contextual_output(), reported_model=MODEL
        )


@pytest.fixture(autouse=True)
def spy(monkeypatch: pytest.MonkeyPatch) -> type[SpyProvider]:
    SpyProvider.calls = 0
    SpyProvider.output = None
    SpyProvider.raises = None
    monkeypatch.setenv(provider_module.ENV_MODEL, MODEL)
    monkeypatch.setattr(
        "src.api.contextual_reasoning.service.OpenAIContextualReasoningProvider",
        SpyProvider,
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
        "artifactSchemaVersion": contracts.STAGE_ARTIFACT_SCHEMA_VERSION,
        "promptVersion": contracts.PRODUCT_PROMPT_VERSION,
        "adapterVersion": contracts.PRODUCT_ADAPTER_VERSION,
        "provider": contracts.SUPPORTED_PROVIDER,
        "model": MODEL,
        "reasoningEffort": contracts.SUPPORTED_REASONING_EFFORT,
    }
    value.update(overrides)
    return value


def body(**overrides: Any) -> dict[str, Any]:
    value: dict[str, Any] = {
        "schemaVersion": contracts.REQUEST_SCHEMA_VERSION,
        "executionPlan": plan(),
        "objectiveContext": "Backend Developer Junior",
        "requirement": {
            "requirementId": "req_01",
            "requirementText": REQUIREMENT_TEXT,
            "epistemicTarget": "FORMATIVE_EVIDENCE",
            "atomicity": "ATOMIC",
            "evaluability": {
                "requiredEvidenceType": "FORMATIVE_EVIDENCE",
                "formativeEvidenceCapable": True,
                "rationale": "Evaluable.",
            },
            "qualifiers": [],
            "normalizedRequirement": "Formacion.",
        },
        "evidenceUnits": [],
        "sources": [],
        "preparation": {
            "mode": "FULL_SCAN",
            "evidenceUnitIds": [],
            "exactRedundancyGroups": [],
            "sourceObservabilityFacts": [],
            "discardedEvidenceProposalCount": 0,
        },
    }
    value.update(overrides)
    return value


def post(client: TestClient, **overrides: Any):
    return client.post("/v1/contextual-reasoning", json=body(**overrides))


def envelope_code(response) -> str:
    payload = response.json()
    assert payload["schemaVersion"] == "ai_service_error_v1", payload
    return payload["code"]


# ---------------------------------------------------------------------------
# Camino feliz
# ---------------------------------------------------------------------------


def test_returns_the_transient_contextual_result(client: TestClient) -> None:
    response = post(client)

    assert response.status_code == 200
    payload = response.json()
    assert payload["schemaVersion"] == contracts.RESPONSE_SCHEMA_VERSION
    assert payload["contextualResult"]["requirementId"] == "req_01"
    assert payload["execution"]["effectiveModelVerification"] == "MATCH"
    assert SpyProvider.calls == 1


def test_empty_evidence_catalog_still_calls_the_reasoner(client: TestClient) -> None:
    # A diferencia de F3.4 con cero fuentes, acá sigue habiendo evaluabilidad,
    # target y observabilidad que interpretar: el candidato congelado llama igual.
    assert post(client).status_code == 200
    assert SpyProvider.calls == 1


def test_response_carries_no_raw_output_or_prompt(client: TestClient) -> None:
    text = post(client).text
    for forbidden in ("rawResponse", "CONTEXT=", "NORMATIVE_POLICY", "usage"):
        assert forbidden not in text


# ---------------------------------------------------------------------------
# Evidence-only y un solo Requirement, por construcción
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "extra",
    [
        {"requirements": []},
        {"objectiveAnalysisArtifact": {}},
        {"semanticAnalysis": {}},
        {"formativeProfile": {}},
        {"canonicalText": "x"},
        {"sourceExtraction": {}},
        {"credentials": []},
    ],
)
def test_request_rejects_forbidden_input(client: TestClient, extra: dict[str, Any]) -> None:
    response = client.post("/v1/contextual-reasoning", json=body(**extra))
    assert response.status_code == 422
    assert SpyProvider.calls == 0


def test_evidence_unit_cannot_carry_raw_source_material(client: TestClient) -> None:
    unit = {
        "evidenceUnitId": "eu_01",
        "sourceId": "src_01",
        "normalizedProposition": "x",
        "claimType": "DECLARED_CONTENT",
        "semanticQualifiers": [],
        "exactQuote": "y",
        "contextBefore": "",
        "contextAfter": "",
        "sectionLabel": None,
        "interpretationProvenance": "AI_INFERRED",
        "extractionQuality": "FULL",
        "documentCanonicalText": "TEXTO COMPLETO",
    }
    response = client.post("/v1/contextual-reasoning", json=body(evidenceUnits=[unit]))
    assert response.status_code == 422
    assert SpyProvider.calls == 0


def test_unsupported_request_schema_version_is_rejected(client: TestClient) -> None:
    response = post(client, schemaVersion="product_contextual_reasoning_request_v2")
    assert response.status_code == 422
    assert response.json()["detail"] == "contextual_reasoning_request_schema_unsupported"
    assert SpyProvider.calls == 0


def test_unusable_reasoning_input_is_422_without_envelope(client: TestClient) -> None:
    unit = {
        "evidenceUnitId": "eu_01",
        "sourceId": "src_99",
        "normalizedProposition": "x",
        "claimType": "DECLARED_CONTENT",
        "semanticQualifiers": [],
        "exactQuote": "y",
        "contextBefore": "",
        "contextAfter": "",
        "sectionLabel": None,
        "interpretationProvenance": "AI_INFERRED",
        "extractionQuality": "FULL",
    }
    response = client.post("/v1/contextual-reasoning", json=body(evidenceUnits=[unit]))
    assert response.status_code == 422
    assert response.json().get("code") is None
    assert response.json()["detail"].startswith("contextual_reasoning_input_invalid:")
    assert SpyProvider.calls == 0


# ---------------------------------------------------------------------------
# Taxonomía de fallos — la misma de F3.3B/F3.4
# ---------------------------------------------------------------------------


def test_plan_mismatch_is_409_with_zero_calls(client: TestClient) -> None:
    response = post(client, executionPlan=plan(promptVersion="otra"))
    assert response.status_code == 409
    assert envelope_code(response) == "EXECUTION_PLAN_MISMATCH"
    assert SpyProvider.calls == 0


def test_invalid_provider_output_is_502(client: TestClient) -> None:
    SpyProvider.output = {"requirementId": "req_01"}
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


def test_error_bodies_leak_no_requirement_text(client: TestClient) -> None:
    secret = "TEXTO-CONFIDENCIAL"
    requirement = body()["requirement"]
    requirement["requirementText"] = f"Requisito con {secret}"
    SpyProvider.output = {"requirementId": "req_01"}
    response = client.post("/v1/contextual-reasoning", json=body(requirement=requirement))
    assert secret not in response.text


# ---------------------------------------------------------------------------
# Superficie
# ---------------------------------------------------------------------------


def test_route_is_registered_once_with_auth_dependency() -> None:
    app = create_app(
        InternalAuthSettings(mode="disabled", secret=None, issuer=None, audience=None)
    )
    routes = [
        r for r in app.routes if getattr(r, "path", None) == "/v1/contextual-reasoning"
    ]
    assert len(routes) == 1
    assert routes[0].dependencies
    assert list(routes[0].methods) == ["POST"]
