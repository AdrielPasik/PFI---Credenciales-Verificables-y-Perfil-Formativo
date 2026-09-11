"""Objective Understanding productivo — slice P2.2.

FIXTURES SINTETICAS EN ESPANOL. Reproducen los FENOMENOS que P2.0 congelo y que
P2.1 midio, escritas para este test. No se copian avisos de terceros: el fenomeno
es lo que importa, no el texto ajeno.

EL PROVEEDOR ESTA STUBBEADO EN TODOS LOS CASOS.

    REAL_PROVIDER_CALLS = 0

Lo que se prueba aca es el CONTRATO PRODUCTIVO: que el pipeline preserve lo que el
proveedor emitio, que el codigo confiable ancle bien y que nada invente autoridad.
La calidad semantica del proveedor se midio en P2.1 con adjudicacion humana y no
se re-afirma aca.
"""

from __future__ import annotations

import pytest

from src.api.objective_understanding.builder import build_proposal_artifact
from src.api.objective_understanding.contracts import (
    MAX_OBJECTIVE_CHARACTERS,
    ObjectiveInputError,
    ObjectiveTooLargeError,
    ProviderInvalidOutputError,
    ProviderObservation,
)
from src.api.objective_understanding.service import (
    assert_objective_fits,
    run_objective_understanding,
)
from src.api.objective_understanding.validation import validate_provider_output

# ---------------------------------------------------------------------------
# Fixtures sinteticas
# ---------------------------------------------------------------------------

OBJECTIVE_MODALIDADES = """**Requisitos**

- Manejo de Hoja de Calculo y Procesador de Texto (excluyente); Herramienta A, Herramienta B; (no excluyente).
- Experiencia minima de 3 anos en el area.
- Titulo universitario en una carrera afin.

**Valoramos**

- Certificacion de la plataforma X.
- Ingles avanzado.

Somos una empresa con mas de 40 anos de trayectoria que opera sobre Herramienta C.
"""

OBJECTIVE_SIN_CRITERIOS = """Somos una cooperativa fundada en 1998.

Trabajamos con Herramienta Z y tenemos oficinas en tres ciudades.

Nos gusta el mate.
"""

OBJECTIVE_CITA_REPETIDA = """**Responsabilidades**

- Disenar e implementar APIs REST.

**Requisitos**

- Disenar e implementar APIs REST.
"""


class StubProvider:
    """Proveedor de prueba. Registra las llamadas para poder contarlas."""

    def __init__(self, output: dict, reported_model: str | None = "modelo-de-prueba") -> None:
        self.output = output
        self.reported_model = reported_model
        self.calls: list[dict] = []

    def complete(self, **kwargs: object) -> ProviderObservation:
        self.calls.append(dict(kwargs))
        return ProviderObservation(output=self.output, reported_model=self.reported_model)


def _proposal(text: str, primary: str, auxiliary: list[str] | None = None, section: str = "") -> dict:
    return {
        "proposedRequirementText": text,
        "primarySourceQuote": primary,
        "auxiliarySourceQuotes": auxiliary or [],
        "sourceSectionLabel": section,
    }


def _run(monkeypatch: pytest.MonkeyPatch, raw: str, output: dict) -> tuple[dict, StubProvider]:
    monkeypatch.setenv("OBJECTIVE_UNDERSTANDING_OPENAI_MODEL", "modelo-de-prueba")
    provider = StubProvider(output)
    result = run_objective_understanding(
        objective_type="EMPLOYMENT",
        title="Titulo de contexto",
        raw_objective_text=raw,
        provider=provider,
    )
    return result, provider


# ---------------------------------------------------------------------------
# Topologia y autoridad
# ---------------------------------------------------------------------------


def test_una_sola_llamada_por_objective(monkeypatch: pytest.MonkeyPatch) -> None:
    raw = OBJECTIVE_MODALIDADES
    output = {
        "proposedRequirements": [
            _proposal("Experiencia minima de 3 anos en el area.", "- Experiencia minima de 3 anos en el area.")
        ],
        "unresolvedPassages": [],
    }
    result, provider = _run(monkeypatch, raw, output)
    assert len(provider.calls) == 1
    assert result["execution"]["providerAuthority"] == "PROPOSAL_ONLY"
    assert result["execution"]["persistence"] == "NONE"


def test_el_titulo_viaja_solo_como_contexto(monkeypatch: pytest.MonkeyPatch) -> None:
    """El prompt rotula el titulo como contexto y el texto crudo como autoridad."""
    output = {"proposedRequirements": [], "unresolvedPassages": []}
    _, provider = _run(monkeypatch, OBJECTIVE_SIN_CRITERIOS, output)
    prompt = provider.calls[0]["prompt"]
    assert "title (SOLO CONTEXTO, no crea Requirements): Titulo de contexto" in prompt
    assert "--- texto crudo del Objective (unica autoridad) ---" in prompt


def test_sin_criterios_evaluables_devuelve_cero_candidatos(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Cero candidatos es un resultado VALIDO, no un fallo del proveedor.

    La invariante de F2 de al menos un Requirement aplica recien al confirmar.
    """
    output = {"proposedRequirements": [], "unresolvedPassages": []}
    result, _ = _run(monkeypatch, OBJECTIVE_SIN_CRITERIOS, output)
    assert result["artifact"]["candidates"] == []
    assert result["artifact"]["grounding"]["candidateCount"] == 0


# ---------------------------------------------------------------------------
# Fenomenos congelados: el contrato tiene que poder representarlos
# ---------------------------------------------------------------------------


def test_modalidades_opuestas_en_la_misma_linea_sobreviven() -> None:
    """El caso critico del Holdout de P2.1, en version sintetica.

    Una sola linea marca `(excluyente)` para un grupo y `(no excluyente)` para
    otro. El contrato tiene que poder llevar los dos claims con su modalidad, y el
    codigo confiable tiene que anclar los dos a la MISMA cita sin colapsarlos.
    """
    linea = (
        "- Manejo de Hoja de Calculo y Procesador de Texto (excluyente); "
        "Herramienta A, Herramienta B; (no excluyente)."
    )
    proposals = [
        _proposal("Manejo excluyente de Hoja de Calculo.", linea),
        _proposal("Manejo excluyente de Procesador de Texto.", linea),
        _proposal("Manejo no excluyente de Herramienta A.", linea),
        _proposal("Manejo no excluyente de Herramienta B.", linea),
    ]
    artifact = build_proposal_artifact(OBJECTIVE_MODALIDADES, proposals, [])

    textos = [c["proposedRequirementText"] for c in artifact["candidates"]]
    assert sum(1 for t in textos if "no excluyente" in t) == 2
    assert sum(1 for t in textos if t.startswith("Manejo excluyente")) == 2
    # Las cuatro citan la misma linea y las cuatro anclan de forma unica.
    assert all(c["primarySourceGrounding"] == "UNIQUE" for c in artifact["candidates"])
    assert len({c["primarySourceReference"]["charStart"] for c in artifact["candidates"]}) == 1
    # Ninguna se colapsa: comparten cita pero NO son duplicados exactos.
    assert artifact["grounding"]["exactDuplicates"] == 0


def test_qualifier_de_anos_y_formacion_academica_se_preservan_literalmente() -> None:
    proposals = [
        _proposal(
            "Experiencia minima de 3 anos en el area.",
            "- Experiencia minima de 3 anos en el area.",
        ),
        _proposal(
            "Titulo universitario en una carrera afin.",
            "- Titulo universitario en una carrera afin.",
        ),
    ]
    artifact = build_proposal_artifact(OBJECTIVE_MODALIDADES, proposals, [])
    for candidate in artifact["candidates"]:
        excerpt = candidate["primarySourceReference"]["exactExcerpt"]
        start = candidate["primarySourceReference"]["charStart"]
        end = candidate["primarySourceReference"]["charEnd"]
        # El excerpt es EXACTAMENTE lo que hay en esos offsets.
        assert OBJECTIVE_MODALIDADES[start:end] == excerpt


def test_modalidad_gobernada_por_encabezado_ancla_de_forma_contigua() -> None:
    """La cita se extiende desde el encabezado hasta la vineta, sin concatenar."""
    cita = "**Valoramos**\n\n- Certificacion de la plataforma X."
    assert cita in OBJECTIVE_MODALIDADES
    proposals = [_proposal("Valorado: certificacion de la plataforma X.", cita)]
    artifact = build_proposal_artifact(OBJECTIVE_MODALIDADES, proposals, [])
    candidate = artifact["candidates"][0]
    assert candidate["primarySourceGrounding"] == "UNIQUE"
    assert "Valoramos" in candidate["primarySourceReference"]["exactExcerpt"]


def test_una_cita_concatenada_no_adyacente_no_ancla() -> None:
    """El fallo que corrigio OU_A1: pegar encabezado con vineta posterior.

    El codigo confiable lo detecta como `NOT_FOUND` y el candidato queda no
    confirmable como derivado de la fuente, en vez de recibir offsets inventados.
    """
    inventada = "**Valoramos**\n\n- Ingles avanzado."
    assert inventada not in OBJECTIVE_MODALIDADES
    proposals = [_proposal("Valorado: ingles avanzado.", inventada)]
    artifact = build_proposal_artifact(OBJECTIVE_MODALIDADES, proposals, [])
    candidate = artifact["candidates"][0]
    assert candidate["primarySourceGrounding"] == "NOT_FOUND"
    assert candidate["primarySourceReference"] is None
    assert candidate["confirmableAsSourceDerived"] is False
    assert candidate["unmatchedReferences"] == [inventada]


def test_cita_repetida_en_dos_secciones_queda_ambigua_y_no_puede_ser_primaria() -> None:
    """P2.0 §15: nunca se elige la primera ocurrencia en silencio."""
    repetida = "- Disenar e implementar APIs REST."
    proposals = [_proposal("Disenar e implementar APIs REST.", repetida)]
    artifact = build_proposal_artifact(OBJECTIVE_CITA_REPETIDA, proposals, [])
    candidate = artifact["candidates"][0]
    assert candidate["primarySourceGrounding"] == "AMBIGUOUS"
    assert candidate["primarySourceReference"] is None
    assert candidate["confirmableAsSourceDerived"] is False
    assert candidate["ambiguousReferences"][0]["occurrences"] == 2
    # El candidato SE MUESTRA igual: la persona decide.
    assert candidate["proposedRequirementText"] == "Disenar e implementar APIs REST."


def test_requirement_compuesto_se_preserva_como_un_solo_candidato() -> None:
    """El contrato no fuerza a partir un compuesto: lleva UN claim con su cita."""
    proposals = [
        _proposal(
            "Disenar e implementar APIs REST.",
            "**Responsabilidades**\n\n- Disenar e implementar APIs REST.",
        )
    ]
    artifact = build_proposal_artifact(OBJECTIVE_CITA_REPETIDA, proposals, [])
    assert len(artifact["candidates"]) == 1


def test_tecnologia_de_contexto_no_se_promueve_sola() -> None:
    """La empresa menciona Herramienta C fuera de los requisitos.

    Cuando el proveedor no la propone —que es lo que P2.1 midio en Holdout— el
    artefacto no la contiene: el codigo confiable no agrega candidatos.
    """
    proposals = [
        _proposal("Titulo universitario en una carrera afin.", "- Titulo universitario en una carrera afin.")
    ]
    artifact = build_proposal_artifact(OBJECTIVE_MODALIDADES, proposals, [])
    textos = " ".join(c["proposedRequirementText"] for c in artifact["candidates"])
    assert "Herramienta C" not in textos
    assert "40 anos" not in textos


def test_trampa_de_tramo_salarial_no_se_convierte_en_requisito() -> None:
    """Equivalente sintetico de la trampa del Holdout (EMP_043).

    El rol pide 3 anos; el tramo salarial menciona 8. Con el proveedor emitiendo
    solo el requisito real —que es lo que P2.1 observo—, el artefacto productivo
    no contiene ningun claim de 8 anos. El codigo confiable NO puede juzgar esto:
    la conducta semantica se midio en P2.1 y aca se verifica que el pipeline no la
    contamine.
    """
    raw = (
        "**Requisitos**\n\n- Experiencia minima de 3 anos en el area.\n\n"
        "**Remuneracion**\n\nEl tramo superior de la banda salarial requiere "
        "acreditar 8 anos de experiencia laboral.\n"
    )
    proposals = [
        _proposal("Experiencia minima de 3 anos en el area.", "- Experiencia minima de 3 anos en el area.")
    ]
    artifact = build_proposal_artifact(raw, proposals, [])
    assert len(artifact["candidates"]) == 1
    assert "8 anos" not in artifact["candidates"][0]["proposedRequirementText"]


def test_pasajes_no_resueltos_se_anclan_y_no_son_un_puntaje() -> None:
    cita = "- Ingles avanzado."
    artifact = build_proposal_artifact(
        OBJECTIVE_MODALIDADES, [], [{"quote": cita, "reason": "modalidad indecidible"}]
    )
    passage = artifact["unresolvedPassages"][0]
    assert passage["grounding"] == "UNIQUE"
    assert OBJECTIVE_MODALIDADES[passage["charStart"] : passage["charEnd"]] == cita
    assert passage["reason"] == "modalidad indecidible"
    assert "confidence" not in passage and "score" not in passage


# ---------------------------------------------------------------------------
# Duplicados: V1 acepta la carga de revision
# ---------------------------------------------------------------------------


def test_duplicados_semanticos_se_preservan_los_dos() -> None:
    """P2.2 NO deduplica semanticamente. Preservar ambos es la decision congelada.

    Deduplicar con heuristica o con embeddings seria inventar un juicio que la
    evaluacion nunca midio. El humano borra el que sobre.
    """
    proposals = [
        _proposal("Disenar e implementar APIs REST.", "**Responsabilidades**\n\n- Disenar e implementar APIs REST."),
        _proposal("Capacidad de disenar y de implementar APIs REST.", "**Requisitos**\n\n- Disenar e implementar APIs REST."),
    ]
    artifact = build_proposal_artifact(OBJECTIVE_CITA_REPETIDA, proposals, [])
    assert len(artifact["candidates"]) == 2
    assert artifact["grounding"]["exactDuplicates"] == 0


def test_duplicado_exacto_se_marca_pero_no_se_elimina() -> None:
    """Comportamiento del builder EVALUADO: marca, no colapsa."""
    cita = "- Titulo universitario en una carrera afin."
    proposals = [
        _proposal("Titulo universitario en una carrera afin.", cita),
        _proposal("Titulo universitario en una carrera afin.", cita),
    ]
    artifact = build_proposal_artifact(OBJECTIVE_MODALIDADES, proposals, [])
    assert len(artifact["candidates"]) == 2
    assert artifact["candidates"][0]["exactDuplicateOfEarlier"] is False
    assert artifact["candidates"][1]["exactDuplicateOfEarlier"] is True
    assert artifact["grounding"]["exactDuplicates"] == 1


# ---------------------------------------------------------------------------
# Autoridad del proveedor
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "campo",
    ["candidateId", "charStart", "charEnd", "finalState", "confidence", "requirementId", "owner"],
)
def test_el_proveedor_no_puede_aportar_campos_de_autoridad(campo: str) -> None:
    proposal = _proposal("Un claim.", "- Titulo universitario en una carrera afin.")
    proposal[campo] = "lo-que-sea"
    with pytest.raises(ProviderInvalidOutputError) as excinfo:
        validate_provider_output(
            {"proposedRequirements": [proposal], "unresolvedPassages": []}
        )
    assert "forbidden_proposal_field" in str(excinfo.value)


def test_el_codigo_confiable_asigna_los_ids_y_el_orden() -> None:
    proposals = [
        _proposal("Uno.", "- Experiencia minima de 3 anos en el area."),
        _proposal("Dos.", "- Titulo universitario en una carrera afin."),
    ]
    artifact = build_proposal_artifact(OBJECTIVE_MODALIDADES, proposals, [])
    assert [c["candidateId"] for c in artifact["candidates"]] == ["cand_01", "cand_02"]
    assert [c["order"] for c in artifact["candidates"]] == [1, 2]


def test_salida_del_proveedor_malformada_se_rechaza() -> None:
    with pytest.raises(ProviderInvalidOutputError):
        validate_provider_output({"proposedRequirements": []})
    with pytest.raises(ProviderInvalidOutputError):
        validate_provider_output({"proposedRequirements": {}, "unresolvedPassages": []})
    with pytest.raises(ProviderInvalidOutputError):
        validate_provider_output(
            {
                "proposedRequirements": [_proposal("   ", "- Titulo universitario en una carrera afin.")],
                "unresolvedPassages": [],
            }
        )


# ---------------------------------------------------------------------------
# Guards de entrada
# ---------------------------------------------------------------------------


def test_objective_demasiado_grande_no_se_trunca_ni_se_segmenta() -> None:
    with pytest.raises(ObjectiveTooLargeError):
        assert_objective_fits("x" * (MAX_OBJECTIVE_CHARACTERS + 1))


def test_objective_vacio_se_rechaza() -> None:
    with pytest.raises(ObjectiveInputError):
        assert_objective_fits("   \n  ")


def test_el_guard_de_tamano_corre_antes_de_cualquier_llamada(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OBJECTIVE_UNDERSTANDING_OPENAI_MODEL", "modelo-de-prueba")
    provider = StubProvider({"proposedRequirements": [], "unresolvedPassages": []})
    with pytest.raises(ObjectiveTooLargeError):
        run_objective_understanding(
            objective_type="EMPLOYMENT",
            title="",
            raw_objective_text="x" * (MAX_OBJECTIVE_CHARACTERS + 1),
            provider=provider,
        )
    assert provider.calls == []


# ---------------------------------------------------------------------------
# Higiene del envelope
# ---------------------------------------------------------------------------


def test_la_respuesta_no_lleva_prompt_ni_salida_cruda(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    output = {
        "proposedRequirements": [
            _proposal("Un claim.", "- Titulo universitario en una carrera afin.")
        ],
        "unresolvedPassages": [],
    }
    result, _ = _run(monkeypatch, OBJECTIVE_MODALIDADES, output)
    serialized = repr(result)
    assert "Sos un extractor de criterios" not in serialized
    assert "rawProviderResponse" not in serialized
    for prohibido in ("finalState", "confidence", "fitScore", "policyTrace"):
        assert prohibido not in serialized


def test_sin_puntaje_global_en_ninguna_parte(monkeypatch: pytest.MonkeyPatch) -> None:
    output = {
        "proposedRequirements": [
            _proposal("Un claim.", "- Titulo universitario en una carrera afin.")
        ],
        "unresolvedPassages": [],
    }
    result, _ = _run(monkeypatch, OBJECTIVE_MODALIDADES, output)

    def walk(node: object) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                assert key not in {"score", "qualityScore", "fitPercentage", "confidence"}
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(result)
