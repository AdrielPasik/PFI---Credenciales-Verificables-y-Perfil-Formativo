"""Ruta `/v1/objective-requirement-proposal` — slice P2.2.

Lo que se prueba acá es TRANSPORTE y FRONTERA, no calidad semántica: que el
request sea evidence-blind por construcción, que los fallos lleguen como códigos
distintos porque de eso depende si repetir el pedido tiene sentido, y que la
respuesta no filtre nada del proveedor.

    413 + OBJECTIVE_TOO_LARGE              no entra en una sola llamada
    502 + PROVIDER_INVALID_OUTPUT          salida completa que no cumple contrato
    503 + PROVIDER_TRANSPORT_FAILURE       no hubo respuesta utilizable
    424 + PROVIDER_CONFIGURATION_FAILURE   rechazo determinista del proveedor
    422 sin envelope                       request mal armado — problema del borde

Sin proveedor real y sin red: el cliente se inyecta.

    REAL_PROVIDER_CALLS = 0
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from src.api.internal_auth import InternalAuthSettings
from src.api.main import create_app
from src.api.objective_understanding import service as service_module
from src.api.objective_understanding.contracts import (
    MAX_OBJECTIVE_CHARACTERS,
    REQUEST_SCHEMA_VERSION,
    ProviderConfigurationError,
    ProviderInvalidOutputError,
    ProviderObservation,
    ProviderTransportError,
    ProviderUnavailableError,
)

MODEL = "modelo-de-prueba"

RAW = """**Requisitos**

- Experiencia minima de 3 anos en el area.
- Titulo universitario en una carrera afin.
"""

VALID_OUTPUT: dict[str, Any] = {
    "proposedRequirements": [
        {
            "proposedRequirementText": "Experiencia minima de 3 anos en el area.",
            "primarySourceQuote": "- Experiencia minima de 3 anos en el area.",
            "auxiliarySourceQuotes": [],
            "sourceSectionLabel": "Requisitos",
        }
    ],
    "unresolvedPassages": [],
}


class SpyProvider:
    """Doble inyectado en el módulo de servicio. Cuenta llamadas."""

    calls = 0
    output: Any = VALID_OUTPUT
    raises: Exception | None = None
    reported_model: str | None = MODEL

    def __init__(self) -> None:
        type(self).calls += 1

    def complete(self, **kwargs: object) -> ProviderObservation:
        if type(self).raises is not None:
            raise type(self).raises
        return ProviderObservation(
            output=type(self).output, reported_model=type(self).reported_model
        )


@pytest.fixture(autouse=True)
def _reset(monkeypatch: pytest.MonkeyPatch) -> None:
    SpyProvider.calls = 0
    SpyProvider.output = VALID_OUTPUT
    SpyProvider.raises = None
    SpyProvider.reported_model = MODEL
    monkeypatch.setenv("OBJECTIVE_UNDERSTANDING_OPENAI_MODEL", MODEL)
    monkeypatch.setattr(
        service_module, "OpenAIObjectiveUnderstandingProvider", SpyProvider
    )


@pytest.fixture()
def client() -> TestClient:
    return TestClient(create_app(InternalAuthSettings(mode="disabled")))


def _post(client: TestClient, **overrides: Any):
    body: dict[str, Any] = {
        "schemaVersion": REQUEST_SCHEMA_VERSION,
        "objectiveType": "EMPLOYMENT",
        "title": "Titulo de contexto",
        "rawObjectiveText": RAW,
    }
    body.update(overrides)
    return client.post("/v1/objective-requirement-proposal", json=body)


# ---------------------------------------------------------------------------
# Camino feliz
# ---------------------------------------------------------------------------


def test_devuelve_propuesta_anclada(client: TestClient) -> None:
    response = _post(client)
    assert response.status_code == 200
    payload = response.json()
    assert payload["artifact"]["schemaVersion"] == "objective_requirement_proposal_v1"
    assert payload["artifact"]["offsetUnit"] == "UNICODE_CODE_POINT"
    assert payload["artifact"]["sourceNormalization"] == "NONE"
    candidate = payload["artifact"]["candidates"][0]
    assert candidate["candidateId"] == "cand_01"
    reference = candidate["primarySourceReference"]
    assert RAW[reference["charStart"] : reference["charEnd"]] == reference["exactExcerpt"]
    assert SpyProvider.calls == 1


def test_cero_candidatos_es_exito(client: TestClient) -> None:
    SpyProvider.output = {"proposedRequirements": [], "unresolvedPassages": []}
    response = _post(client)
    assert response.status_code == 200
    assert response.json()["artifact"]["candidates"] == []


# ---------------------------------------------------------------------------
# Evidence-blind por construcción
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "campo",
    [
        "ownerUserId",
        "holderId",
        "credentials",
        "profile",
        "skills",
        "evidenceUnits",
        "reasoningRunId",
        "executionPlan",
        "provider",
        "model",
    ],
)
def test_el_request_no_admite_datos_del_holder_ni_de_ejecucion(
    client: TestClient, campo: str
) -> None:
    """`extra="forbid"` lo hace estructural, no una promesa de prosa."""
    response = _post(client, **{campo: "lo-que-sea"})
    assert response.status_code == 422
    assert SpyProvider.calls == 0


def test_schema_version_desconocida_no_lleva_envelope(client: TestClient) -> None:
    response = _post(client, schemaVersion="otra_version")
    assert response.status_code == 422
    assert "schemaVersion" not in response.json()
    assert SpyProvider.calls == 0


# ---------------------------------------------------------------------------
# Fallos: cada uno con su código
# ---------------------------------------------------------------------------


def test_objective_demasiado_grande(client: TestClient) -> None:
    response = _post(client, rawObjectiveText="x" * (MAX_OBJECTIVE_CHARACTERS + 1))
    assert response.status_code == 413
    body = response.json()
    assert body["schemaVersion"] == "ai_service_error_v1"
    assert body["code"] == "OBJECTIVE_TOO_LARGE"
    # No se trunca y no se segmenta: el proveedor nunca se toca.
    assert SpyProvider.calls == 0


def test_salida_invalida_del_proveedor(client: TestClient) -> None:
    SpyProvider.output = {"proposedRequirements": "no-es-una-lista", "unresolvedPassages": []}
    response = _post(client)
    assert response.status_code == 502
    assert response.json()["code"] == "PROVIDER_INVALID_OUTPUT"


def test_fallo_de_transporte_del_proveedor(client: TestClient) -> None:
    SpyProvider.raises = ProviderTransportError("provider_timeout")
    response = _post(client)
    assert response.status_code == 503
    assert response.json()["code"] == "PROVIDER_TRANSPORT_FAILURE"


def test_rechazo_determinista_del_proveedor(client: TestClient) -> None:
    SpyProvider.raises = ProviderConfigurationError("provider_http_404")
    response = _post(client)
    assert response.status_code == 424
    assert response.json()["code"] == "PROVIDER_CONFIGURATION_FAILURE"


def test_configuracion_ausente_colapsa_con_transporte(client: TestClient) -> None:
    SpyProvider.raises = ProviderUnavailableError("missing_key")
    response = _post(client)
    assert response.status_code == 503
    assert response.json()["code"] == "PROVIDER_TRANSPORT_FAILURE"


def test_modelo_sin_configurar_no_llama_al_proveedor(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("OBJECTIVE_UNDERSTANDING_OPENAI_MODEL", raising=False)
    response = _post(client)
    assert response.status_code == 503
    assert SpyProvider.calls == 0


# ---------------------------------------------------------------------------
# Higiene del contrato de error y de la respuesta
# ---------------------------------------------------------------------------


def test_el_vocabulario_de_error_es_cerrado_y_biyectivo() -> None:
    from src.api.objective_understanding.errors import (
        OBJECTIVE_UNDERSTANDING_ERROR_CODES,
        STATUS_BY_CODE,
    )

    assert "OTHER" not in OBJECTIVE_UNDERSTANDING_ERROR_CODES
    assert "UNKNOWN" not in OBJECTIVE_UNDERSTANDING_ERROR_CODES
    assert set(OBJECTIVE_UNDERSTANDING_ERROR_CODES) == set(STATUS_BY_CODE)
    assert len(set(STATUS_BY_CODE.values())) == len(STATUS_BY_CODE)
    # No existe en esta etapa: no hay plan congelado de un tercero.
    assert "EXECUTION_PLAN_MISMATCH" not in OBJECTIVE_UNDERSTANDING_ERROR_CODES


def test_el_vocabulario_compartido_de_f3_no_cambio() -> None:
    """P2.2 no toca `error_envelope.py`, y este test lo fija."""
    from src.api.error_envelope import APPLICATION_ERROR_CODES

    assert len(APPLICATION_ERROR_CODES) == 4
    assert "OBJECTIVE_TOO_LARGE" not in APPLICATION_ERROR_CODES


def test_la_respuesta_no_expone_nada_del_proveedor(client: TestClient) -> None:
    payload = response_text = _post(client).text
    for prohibido in (
        "Sos un extractor",
        "rawProviderResponse",
        "authorization",
        "api_key",
        "OBJECTIVE_UNDERSTANDING_OPENAI_API_KEY",
    ):
        assert prohibido not in payload
    assert response_text is not None
