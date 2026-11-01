"""Presupuesto de los consumidores productivos: extraccion sin cupo + seleccion.

CONTRATO QUE SE PRUEBA.

    sin presupuesto   el comportamiento evaluado en P2.1: un prompt congelado,
                      un schema congelado, una llamada. Nada nuevo.
    con presupuesto   1. extraccion con la politica, SIN cupo y sin `maxItems`;
                      2. si sobran candidatos, UNA llamada de seleccion que
                         devuelve NUMEROS de candidatos ya extraidos;
                      3. los no elegidos quedan en `omittedCandidates`.

LO QUE **NO** SE HACE en ningun camino: `candidates[:N]`. Recortar despues de un
orden de fuente acepta como autoritativa una seleccion que nadie hizo.

Los dos consumidores comparten la politica y difieren solo en el maximo: 12 el
verificador publico, 15 el titular.

    REAL_PROVIDER_CALLS = 0
"""

from __future__ import annotations

import hashlib

import pytest

from src.api.objective_understanding.contracts import (
    ProviderInvalidOutputError,
    ProviderObservation,
    ProviderTransportError,
)
from src.api.objective_understanding.prompt import (
    EXTRACTION_POLICY_VERSION,
    INSTRUCTIONS,
    OU_A2_INSTRUCTIONS_SHA256,
)
from src.api.objective_understanding.schema import OBJECTIVE_UNDERSTANDING_OUTPUT_SCHEMA
from src.api.objective_understanding.selection import SELECTION_POLICY_VERSION
from src.api.objective_understanding.service import (
    MAX_EXTRACTED_CANDIDATES,
    run_objective_understanding,
)

PUBLIC_MAXIMUM = 12
HOLDER_MAXIMUM = 15

AVISO_LARGO = """**Sobre nosotros**

Somos una cooperativa de software fundada en 2004, con oficinas en tres ciudades y
mas de 180 personas. Trabajamos para clientes del sector salud y educacion.

**Responsabilidades**

- Participaras del ciclo completo de desarrollo de nuestros servicios.
- Colaboraras con los equipos de producto, infraestructura y seguridad.
- Escribiras documentacion tecnica de las decisiones que tomes.
- Revisaras el codigo de tus companeros y recibiras revisiones del tuyo.

**Requisitos**

- Titulo universitario en Ingenieria en Sistemas, Ciencias de la Computacion o carrera afin (excluyente).
- Experiencia minima de 4 anos en desarrollo backend.
- Programacion en Python.
- Conocimiento de bases de datos como MariaDB, MongoDB y KeyDB.
- Conocimiento de mensajeria y event streaming como Kafka y RabbitMQ.
- Experiencia con Docker y Kubernetes.
- Diseno y consumo de APIs REST.
- Manejo de Git como sistema de control de versiones.
- Ingles tecnico para lectura de documentacion.

**Valoramos**

- Experiencia previa en sistemas de alta disponibilidad.
"""

LINEAS = [
    "- Titulo universitario en Ingenieria en Sistemas, Ciencias de la Computacion o carrera afin (excluyente).",
    "- Experiencia minima de 4 anos en desarrollo backend.",
    "- Programacion en Python.",
    "- Conocimiento de bases de datos como MariaDB, MongoDB y KeyDB.",
    "- Conocimiento de mensajeria y event streaming como Kafka y RabbitMQ.",
    "- Experiencia con Docker y Kubernetes.",
    "- Diseno y consumo de APIs REST.",
    "- Manejo de Git como sistema de control de versiones.",
    "- Ingles tecnico para lectura de documentacion.",
    "- Experiencia previa en sistemas de alta disponibilidad.",
]


class SequencedProvider:
    """Proveedor de prueba: devuelve una salida por llamada, en orden."""

    def __init__(self, *outputs: object) -> None:
        self.outputs = list(outputs)
        self.calls: list[dict] = []

    def complete(self, **kwargs: object) -> ProviderObservation:
        self.calls.append(dict(kwargs))
        output = self.outputs.pop(0)
        if isinstance(output, Exception):
            raise output
        return ProviderObservation(output=output, reported_model="modelo-de-prueba")


def _proposal(text: str, quote: str) -> dict:
    return {
        "proposedRequirementText": text,
        "primarySourceQuote": quote,
        "auxiliarySourceQuotes": [],
        "sourceSectionLabel": "",
    }


def _extraction(count: int) -> dict:
    """`count` candidatos anclados en lineas reales (repitiendo si hace falta)."""
    proposals = [
        _proposal(f"Requisito {i + 1}", LINEAS[i % len(LINEAS)]) for i in range(count)
    ]
    return {"proposedRequirements": proposals, "unresolvedPassages": []}


def _selection(*numbers: int) -> dict:
    return {"selectedCandidateNumbers": list(numbers)}


def _run(monkeypatch: pytest.MonkeyPatch, provider: SequencedProvider, maximum: int | None):
    monkeypatch.setenv("OBJECTIVE_UNDERSTANDING_OPENAI_MODEL", "modelo-de-prueba")
    return run_objective_understanding(
        objective_type="EMPLOYMENT",
        title="Desarrollador backend",
        raw_objective_text=AVISO_LARGO,
        max_proposed_requirements=maximum,
        provider=provider,
    )


# ---------------------------------------------------------------------------
# Sin presupuesto: P2.1 intacto
# ---------------------------------------------------------------------------


def test_el_cuerpo_congelado_no_cambio() -> None:
    assert hashlib.sha256(INSTRUCTIONS.encode("utf-8")).hexdigest() == OU_A2_INSTRUCTIONS_SHA256


def test_sin_presupuesto_es_exactamente_p21(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = SequencedProvider(_extraction(40))
    result = _run(monkeypatch, provider, None)

    assert len(provider.calls) == 1
    call = provider.calls[0]
    assert call["prompt"].endswith("--- fin del texto crudo ---\n")
    assert call["schema"] is OBJECTIVE_UNDERSTANDING_OUTPUT_SCHEMA
    assert len(result["artifact"]["candidates"]) == 40
    assert "omittedCandidates" not in result["artifact"]
    assert "selection" not in result["execution"]


# ---------------------------------------------------------------------------
# Con presupuesto: la extraccion no lleva cupo
# ---------------------------------------------------------------------------


def test_la_extraccion_gobernada_no_lleva_cupo_ni_maxitems(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = SequencedProvider(_extraction(3))
    _run(monkeypatch, provider, HOLDER_MAXIMUM)

    call = provider.calls[0]
    assert call["schema"] is OBJECTIVE_UNDERSTANDING_OUTPUT_SCHEMA
    assert "maxItems" not in str(call["schema"])
    assert "POLITICA DE EXTRACCION DE REQUISITOS" in call["prompt"]
    # El numero del tope no aparece en la extraccion: no hay presion de cupo.
    assert "15" not in call["prompt"].split("=== POLITICA DE EXTRACCION")[1]


@pytest.mark.parametrize("maximum", [PUBLIC_MAXIMUM, HOLDER_MAXIMUM])
def test_hasta_el_maximo_no_hay_seleccion_ni_segunda_llamada(
    monkeypatch: pytest.MonkeyPatch, maximum: int
) -> None:
    provider = SequencedProvider(_extraction(maximum))
    result = _run(monkeypatch, provider, maximum)

    assert len(provider.calls) == 1
    assert len(result["artifact"]["candidates"]) == maximum
    assert result["artifact"]["omittedCandidates"] == []
    assert result["execution"]["selection"] == {
        "applied": False,
        "extractedCandidateCount": maximum,
        "selectedCandidateCount": maximum,
        "omittedCandidateCount": 0,
        "providerLogicalCalls": 1,
    }
    assert result["execution"]["requestedMaxProposedRequirements"] == maximum
    assert result["execution"]["extractionPolicyVersion"] == EXTRACTION_POLICY_VERSION
    assert result["execution"]["selectionPolicyVersion"] == SELECTION_POLICY_VERSION


def test_cuatro_son_cuatro_el_tope_no_es_una_meta(monkeypatch: pytest.MonkeyPatch) -> None:
    result = _run(monkeypatch, SequencedProvider(_extraction(4)), HOLDER_MAXIMUM)
    assert len(result["artifact"]["candidates"]) == 4


def test_cero_es_una_respuesta_valida(monkeypatch: pytest.MonkeyPatch) -> None:
    result = _run(monkeypatch, SequencedProvider(_extraction(0)), HOLDER_MAXIMUM)
    assert result["artifact"]["candidates"] == []
    assert result["artifact"]["omittedCandidates"] == []


# ---------------------------------------------------------------------------
# Seleccion: elegida por el modelo, nunca por orden
# ---------------------------------------------------------------------------


def test_si_sobran_se_eligen_por_seleccion_y_no_por_orden(monkeypatch: pytest.MonkeyPatch) -> None:
    # 20 extraidos, tope 15: la seleccion elige los ULTIMOS 15. Un recorte por
    # orden habria dado los primeros 15.
    elegidos = list(range(6, 21))
    provider = SequencedProvider(_extraction(20), _selection(*reversed(elegidos)))
    result = _run(monkeypatch, provider, HOLDER_MAXIMUM)

    assert len(provider.calls) == 2
    textos = [c["proposedRequirementText"] for c in result["artifact"]["candidates"]]
    # Orden de fuente, aunque el modelo los devolvio al reves.
    assert textos == [f"Requisito {n}" for n in elegidos]
    omitidos = [c["proposedRequirementText"] for c in result["artifact"]["omittedCandidates"]]
    assert omitidos == [f"Requisito {n}" for n in range(1, 6)]
    assert result["execution"]["selection"]["applied"] is True
    assert result["execution"]["selection"]["providerLogicalCalls"] == 2


def test_los_omitidos_quedan_anclados_y_con_ids_que_no_chocan(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = SequencedProvider(_extraction(18), _selection(*range(1, 16)))
    result = _run(monkeypatch, provider, HOLDER_MAXIMUM)

    elegidos = result["artifact"]["candidates"]
    omitidos = result["artifact"]["omittedCandidates"]
    ids = [c["candidateId"] for c in elegidos + omitidos]
    assert len(ids) == len(set(ids)) == 18
    assert [c["order"] for c in omitidos] == [1, 2, 3]
    for candidate in omitidos:
        reference = candidate["primarySourceReference"]
        assert reference is not None
        assert AVISO_LARGO[reference["charStart"]:reference["charEnd"]] == reference["exactExcerpt"]


def test_la_seleccion_ve_los_candidatos_numerados_y_el_texto_como_contexto(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = SequencedProvider(_extraction(13), _selection(*range(1, 13)))
    _run(monkeypatch, provider, PUBLIC_MAXIMUM)

    prompt = provider.calls[1]["prompt"]
    assert "1. Requisito 1 -- cita:" in prompt
    assert "13. Requisito 13 -- cita:" in prompt
    assert "como maximo 12" in prompt
    assert AVISO_LARGO in prompt
    assert provider.calls[1]["schema_name"] == "requirement_selection_v1"
    assert "maxItems" not in str(provider.calls[1]["schema"])


@pytest.mark.parametrize(
    "seleccion",
    [
        _selection(),
        _selection(*range(1, 17)),
        _selection(1, 1, 2),
        _selection(0, 1),
        _selection(1, 21),
        {"selectedCandidateNumbers": ["1", "2"]},
        {"selectedCandidateNumbers": [True]},
        {"selectedCandidateNumbers": [1], "extra": True},
        {"otra": []},
    ],
    ids=[
        "vacia",
        "16_sobre_15",
        "repetidos",
        "cero",
        "fuera_de_rango",
        "strings",
        "booleano",
        "campo_extra",
        "forma_ajena",
    ],
)
def test_una_seleccion_invalida_falla_explicita_sin_recortar(
    monkeypatch: pytest.MonkeyPatch, seleccion: dict
) -> None:
    provider = SequencedProvider(_extraction(20), seleccion)
    with pytest.raises(ProviderInvalidOutputError):
        _run(monkeypatch, provider, HOLDER_MAXIMUM)
    # Una sola seleccion: ningun reintento.
    assert len(provider.calls) == 2


def test_un_fallo_de_transporte_en_la_seleccion_no_fabrica_propuesta(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = SequencedProvider(_extraction(20), ProviderTransportError("read_timeout"))
    with pytest.raises(ProviderTransportError):
        _run(monkeypatch, provider, HOLDER_MAXIMUM)
    assert len(provider.calls) == 2


def test_una_extraccion_por_encima_del_techo_de_cordura_falla_sin_seleccionar(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = SequencedProvider(_extraction(MAX_EXTRACTED_CANDIDATES + 1))
    with pytest.raises(ProviderInvalidOutputError):
        _run(monkeypatch, provider, HOLDER_MAXIMUM)
    assert len(provider.calls) == 1


def test_el_maximo_publico_sigue_siendo_12(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = SequencedProvider(_extraction(15), _selection(*range(1, 13)))
    result = _run(monkeypatch, provider, PUBLIC_MAXIMUM)
    assert len(result["artifact"]["candidates"]) == 12
    assert len(result["artifact"]["omittedCandidates"]) == 3
    assert result["execution"]["requestedMaxProposedRequirements"] == 12


def test_nada_introduce_puntaje_ni_ranking(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = SequencedProvider(_extraction(20), _selection(*range(1, 16)))
    result = _run(monkeypatch, provider, HOLDER_MAXIMUM)
    for prohibido in ("score", "ranking", "confidence", "\"fit\""):
        assert prohibido not in str(result).lower()
