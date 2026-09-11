"""Ruta `/v1/objective-analysis` — slice F3.3B.

Lo que se prueba acá es TRANSPORTE, no clasificación: que el request sea
evidence-blind por construcción, y que los tres fallos que NestJS distingue
lleguen como códigos HTTP distintos, porque de ese código depende si el run
termina failed o sigue reintentable.

    409 + EXECUTION_PLAN_MISMATCH     el plan no describe lo que se ejecutaría
    502 + PROVIDER_INVALID_OUTPUT     salida completa que no cumple el contrato
    503 + PROVIDER_TRANSPORT_FAILURE  no hubo respuesta semántica utilizable
    422 sin envelope                  request mal armado — problema del borde

Desde F3.3B.1 el status ya no alcanza: los fallos de aplicación llevan
`ai_service_error_v1`, y ese `code` es la autoridad semántica.

Sin proveedor real y sin red: el cliente se inyecta.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from src.api import main as main_module
from src.api.internal_auth import InternalAuthSettings
from src.api.main import create_app
from src.api.objective_analysis import contracts, provider as provider_module
from src.api.objective_analysis.contracts import (
    ProviderConfigurationError,
    ProviderInvalidOutputError,
    ProviderObservation,
    ProviderTransportError,
)

MODEL = "gpt-5.6-terra"

ANALYSED = {
    "requirementId": "req_01",
    "epistemicTarget": "FORMATIVE_EVIDENCE",
    "epistemicTargetRationale": "Pide formación sobre el objeto.",
    "atomicity": "ATOMIC",
    "evaluability": {
        "requiredEvidenceType": "FORMATIVE_EVIDENCE",
        "formativeEvidenceCapable": True,
        "rationale": "Evaluable con evidencia formativa.",
    },
    "qualifiers": [],
    "normalizedRequirement": "Formación sobre el objeto del requisito.",
}


class SpyProvider:
    """Doble inyectado en el módulo de servicio. Cuenta llamadas."""

    calls = 0
    output: Any = {"requirements": [ANALYSED]}
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
    SpyProvider.output = {"requirements": [ANALYSED]}
    SpyProvider.raises = None
    monkeypatch.setenv(provider_module.ENV_MODEL, MODEL)
    # El servicio construye el proveedor DESPUES del guard; interceptamos ahí.
    monkeypatch.setattr(
        "src.api.objective_analysis.service.OpenAIObjectiveAnalysisProvider",
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
        "artifactSchemaVersion": contracts.ARTIFACT_SCHEMA_VERSION,
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
        "objectiveType": "EMPLOYMENT",
        "objectiveContext": "Backend Developer Junior",
        "requirements": [
            {"requirementId": "req_01", "requirementText": "Diseño de APIs REST"}
        ],
    }
    value.update(overrides)
    return value



def envelope_code(response) -> str:
    """El `code` del envelope, exigiendo la forma completa de `ai_service_error_v1`."""
    body = response.json()
    assert body["schemaVersion"] == "ai_service_error_v1", body
    return body["code"]

def post(client: TestClient, **overrides: Any):
    return client.post("/v1/objective-analysis", json=body(**overrides))


# ---------------------------------------------------------------------------
# Camino feliz
# ---------------------------------------------------------------------------


def test_returns_artifact_and_execution_envelope(client: TestClient) -> None:
    response = post(client)
    assert response.status_code == 200

    payload = response.json()
    assert payload["schemaVersion"] == contracts.RESPONSE_SCHEMA_VERSION
    assert payload["artifact"]["schemaVersion"] == "objective_analysis_v1"
    assert payload["execution"]["effectiveModelVerification"] == "MATCH"
    assert SpyProvider.calls == 1


def test_response_carries_no_raw_provider_output_or_prompt(client: TestClient) -> None:
    text = post(client).text
    for forbidden in ("rawResponse", "OBJECTIVE_DATA", "NORMATIVE_POLICY", "usage"):
        assert forbidden not in text


# ---------------------------------------------------------------------------
# Evidence-blind por construcción
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "extra",
    [
        {"evidenceUnits": []},
        {"credentials": []},
        {"inventory": []},
        {"excerpts": ["algo"]},
        {"ownerUserId": "user_01"},
    ],
)
def test_request_rejects_any_evidence_or_ownership_field(
    client: TestClient, extra: dict[str, Any]
) -> None:
    # `extra="forbid"` hace que sea estructural en vez de una promesa del prompt.
    response = client.post("/v1/objective-analysis", json=body(**extra))
    assert response.status_code == 422
    assert SpyProvider.calls == 0


def test_requirements_cannot_be_empty(client: TestClient) -> None:
    assert post(client, requirements=[]).status_code == 422


def test_empty_objective_context_is_accepted(client: TestClient) -> None:
    assert post(client, objectiveContext="").status_code == 200


def test_unsupported_request_schema_version_is_rejected(client: TestClient) -> None:
    response = post(client, schemaVersion="product_objective_analysis_request_v2")
    assert response.status_code == 422
    assert response.json()["detail"] == "objective_analysis_request_schema_unsupported"
    assert SpyProvider.calls == 0


# ---------------------------------------------------------------------------
# 409 · plan congelado contra configuración local
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "override",
    [
        {"promptVersion": "otro_prompt"},
        {"adapterVersion": "otro_adapter"},
        {"provider": "anthropic"},
        {"reasoningEffort": "high"},
        {"model": "otro-modelo"},
        {"artifactSchemaVersion": "objective_analysis_v2"},
    ],
)
def test_plan_mismatch_is_409_with_zero_provider_calls(
    client: TestClient, override: dict[str, Any]
) -> None:
    response = post(client, executionPlan=plan(**override))
    assert response.status_code == 409
    assert envelope_code(response) == "EXECUTION_PLAN_MISMATCH"
    assert response.json()["message"].startswith(
        "objective_analysis_execution_plan_mismatch:"
    )
    assert SpyProvider.calls == 0


def test_plan_mismatch_detail_leaks_no_configuration_values(client: TestClient) -> None:
    response = post(client, executionPlan=plan(model="modelo-de-despliegue"))
    assert "modelo-de-despliegue" not in response.text
    assert MODEL not in response.text


def test_reported_model_mismatch_is_409(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    class DriftedProvider(SpyProvider):
        def complete(self, **_: Any) -> ProviderObservation:
            SpyProvider.calls += 1
            return ProviderObservation(
                output={"requirements": [ANALYSED]},
                reported_model="gpt-5.6-terra-2026-01-01",
            )

    monkeypatch.setattr(
        "src.api.objective_analysis.service.OpenAIObjectiveAnalysisProvider",
        DriftedProvider,
    )
    response = post(client)
    assert response.status_code == 409
    assert envelope_code(response) == "EXECUTION_PLAN_MISMATCH"
    assert response.json()["message"].endswith("effective_model_mismatch")


# ---------------------------------------------------------------------------
# 422 · salida inválida recibida por completo
# ---------------------------------------------------------------------------


def test_invalid_provider_output_is_502_and_not_retried(client: TestClient) -> None:
    SpyProvider.output = {"requirements": [ANALYSED, ANALYSED]}
    response = post(client)
    # 502 y no 422: FastAPI ya usa 422 para su propia validacion de request, y
    # colapsarlos haria que un request mal armado se leyera como fallo terminal
    # del run.
    assert response.status_code == 502
    assert envelope_code(response) == "PROVIDER_INVALID_OUTPUT"
    assert response.json()["message"].startswith(
        "objective_analysis_invalid_provider_output:"
    )
    assert SpyProvider.calls == 1, "no se le vuelve a preguntar al modelo"


def test_invalid_output_detail_carries_no_objective_text(client: TestClient) -> None:
    SpyProvider.output = {"requirements": []}
    response = post(client)
    assert "Diseño de APIs REST" not in response.text


# ---------------------------------------------------------------------------
# 503 · sin respuesta utilizable
# ---------------------------------------------------------------------------


def test_transport_failure_is_503(client: TestClient) -> None:
    SpyProvider.raises = ProviderTransportError("provider_timeout")
    response = post(client)
    assert response.status_code == 503
    assert envelope_code(response) == "PROVIDER_TRANSPORT_FAILURE"
    assert response.json()["message"] == (
        "objective_analysis_provider_transport_failure:provider_timeout"
    )


def test_missing_provider_configuration_is_503_not_409(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Falta de configuración NO es un fallo del run: es infraestructura.
    monkeypatch.delenv(provider_module.ENV_MODEL, raising=False)
    response = post(client)
    assert response.status_code == 503
    # Colapsa con el transporte: los dos dejan el run intacto y reintentable. La
    # diferencia operativa sobrevive en `message`, que no clasifica.
    assert envelope_code(response) == "PROVIDER_TRANSPORT_FAILURE"
    assert response.json()["message"].startswith(
        "objective_analysis_provider_unavailable:"
    )


def test_non_json_provider_body_is_invalid_output_not_transport(
    client: TestClient,
) -> None:
    # El proveedor CONTESTO; que su cuerpo no sirva no es un problema de red.
    SpyProvider.raises = ProviderInvalidOutputError("provider_body_not_json")
    assert post(client).status_code == 502


# ---------------------------------------------------------------------------
# La ruta vive detrás del auth interno
# ---------------------------------------------------------------------------


def test_route_is_registered_once_with_auth_dependency() -> None:
    app = create_app(
        InternalAuthSettings(mode="disabled", secret=None, issuer=None, audience=None)
    )
    routes = [r for r in app.routes if getattr(r, "path", None) == "/v1/objective-analysis"]
    assert len(routes) == 1, "ONE_CALL_PER_OBJECTIVE: no hay ruta por Requirement"
    assert routes[0].dependencies, "la ruta no puede quedar sin auth interno"
    assert list(routes[0].methods) == ["POST"]


def test_secrets_are_not_exposed_by_the_module() -> None:
    # Los valores viven solo en el entorno del AI service. NestJS recibe el
    # nombre del modelo solicitado —que es plan, no secreto— y nada más.
    assert not hasattr(main_module, provider_module.ENV_API_KEY)
    assert provider_module.ENV_API_KEY == "OBJECTIVE_ANALYSIS_OPENAI_API_KEY"


def test_malformed_request_is_422_and_never_a_terminal_run_failure(
    client: TestClient,
) -> None:
    # Un request mal armado por NestJS es un bug de despliegue, no un desenlace
    # del run: tiene que ser distinguible del 502 del proveedor.
    response = client.post("/v1/objective-analysis", json={"schemaVersion": 1})
    assert response.status_code == 422
    assert SpyProvider.calls == 0


# ---------------------------------------------------------------------------
# Envelope de error de aplicación — F3.3B.1
# ---------------------------------------------------------------------------


def test_every_application_failure_carries_the_exact_envelope(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Un fallo de aplicación sin envelope sería indistinguible de un 502 de proxy,
    # y NestJS tendría que adivinar si el proveedor llegó a responder.
    cases = [
        (409, "EXECUTION_PLAN_MISMATCH", lambda: post(
            client, executionPlan=plan(promptVersion="otro")
        )),
        (502, "PROVIDER_INVALID_OUTPUT", lambda: (
            setattr(SpyProvider, "output", {"requirements": []}), post(client)
        )[1]),
        (503, "PROVIDER_TRANSPORT_FAILURE", lambda: (
            setattr(SpyProvider, "raises", ProviderTransportError("provider_timeout")),
            post(client),
        )[1]),
    ]

    for status_code, code, run in cases:
        SpyProvider.output = {"requirements": [ANALYSED]}
        SpyProvider.raises = None
        response = run()
        assert response.status_code == status_code
        body = response.json()
        assert set(body) == {"schemaVersion", "code", "message"}
        assert body["schemaVersion"] == "ai_service_error_v1"
        assert body["code"] == code


def test_the_envelope_is_at_the_root_not_nested_under_detail(
    client: TestClient,
) -> None:
    # Anidarlo bajo `detail` obligaría al consumidor a conocer la convención de
    # HTTPException de FastAPI para leer un contrato nuestro.
    response = post(client, executionPlan=plan(provider="anthropic"))
    body = response.json()
    assert "detail" not in body
    assert body["code"] == "EXECUTION_PLAN_MISMATCH"


def test_status_and_code_are_consistent_by_construction(client: TestClient) -> None:
    from src.api.error_envelope import STATUS_BY_CODE

    for code, expected_status in STATUS_BY_CODE.items():
        assert code in {
            "EXECUTION_PLAN_MISMATCH",
            "PROVIDER_INVALID_OUTPUT",
            "PROVIDER_TRANSPORT_FAILURE",
            "PROVIDER_CONFIGURATION_FAILURE",
        }
        assert expected_status in {409, 502, 503, 424}

    # El status NO se elige por separado: sale de la tabla. Emitir un par
    # incoherente no es representable desde este lado.
    from src.api.error_envelope import application_error

    assert application_error("EXECUTION_PLAN_MISMATCH").status_code == 409
    assert application_error("PROVIDER_INVALID_OUTPUT").status_code == 502
    assert application_error("PROVIDER_TRANSPORT_FAILURE").status_code == 503
    assert application_error("PROVIDER_CONFIGURATION_FAILURE").status_code == 424

    # Biyectiva: ningun par de codigos comparte status, porque compartirlo
    # borraria la diferencia entre terminal y reintentable.
    assert len(set(STATUS_BY_CODE.values())) == len(STATUS_BY_CODE)


def test_no_catch_all_terminal_code_exists() -> None:
    from src.api.error_envelope import APPLICATION_ERROR_CODES

    assert "OTHER" not in APPLICATION_ERROR_CODES
    assert "UNKNOWN" not in APPLICATION_ERROR_CODES
    assert len(APPLICATION_ERROR_CODES) == 4


def test_the_envelope_leaks_no_objective_or_provider_content(
    client: TestClient,
) -> None:
    marker = "ZZ-SENSITIVE-REQUIREMENT"
    SpyProvider.output = {"requirements": [ANALYSED, ANALYSED]}
    response = client.post(
        "/v1/objective-analysis",
        json=body(
            requirements=[
                {"requirementId": "req_01", "requirementText": f"APIs REST {marker}"}
            ],
            objectiveContext=f"contexto {marker}",
        ),
    )

    assert response.status_code == 502
    text = response.text
    assert marker not in text
    for forbidden in ("epistemicTarget", "normalizedRequirement", "OBJECTIVE_DATA",
                      "Traceback", "gpt-5.6-terra"):
        assert forbidden not in text


def test_request_validation_422_carries_no_envelope(client: TestClient) -> None:
    # Sigue separado a propósito: es un problema del borde, no un desenlace del
    # run, y darle envelope lo haría parecer un juicio sobre el ReasoningRun.
    for response in (
        client.post("/v1/objective-analysis", json={"schemaVersion": 1}),
        post(client, schemaVersion="product_objective_analysis_request_v2"),
    ):
        assert response.status_code == 422
        assert "schemaVersion" not in response.json() or "code" not in response.json()
        assert response.json().get("code") is None


# ---------------------------------------------------------------------------
# Fallo determinista del proveedor — F3.3B.2
# ---------------------------------------------------------------------------


def test_deterministic_provider_rejection_is_424_with_its_own_code(
    client: TestClient,
) -> None:
    # Status PROPIO: no puede compartir el 503 del fallo transitorio, que
    # significa lo contrario para el run.
    SpyProvider.raises = ProviderConfigurationError("provider_http_404:model_not_found")
    response = post(client)

    assert response.status_code == 424
    assert envelope_code(response) == "PROVIDER_CONFIGURATION_FAILURE"
    assert response.json()["message"].startswith(
        "objective_analysis_provider_configuration_failure:"
    )


def test_configuration_failure_is_distinguishable_from_transient(
    client: TestClient,
) -> None:
    SpyProvider.raises = ProviderTransportError("provider_http_503")
    transient = post(client)
    SpyProvider.raises = ProviderConfigurationError("provider_http_401:invalid_api_key")
    deterministic = post(client)

    assert transient.status_code != deterministic.status_code
    assert envelope_code(transient) != envelope_code(deterministic)


def test_configuration_failure_message_carries_no_credential(
    client: TestClient,
) -> None:
    SpyProvider.raises = ProviderConfigurationError("provider_http_401:invalid_api_key")
    text = post(client).text
    for forbidden in ("sk-", "Bearer", "authorization"):
        assert forbidden not in text
