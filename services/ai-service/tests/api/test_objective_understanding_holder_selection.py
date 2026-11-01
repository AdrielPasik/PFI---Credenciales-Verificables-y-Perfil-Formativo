"""P0 — Requirements del titular: politica de extraccion, seleccion y no-recorte.

QUE SE PRUEBA Y QUE NO.

El proveedor esta STUBBEADO en todos los casos:

    REAL_PROVIDER_CALLS = 0

Por eso estos tests prueban el CONTRATO, no la calidad semantica del modelo:

  - que la politica de extraccion pide exactamente lo que el producto necesita
    (que excluir, que conservar aunque no haya evidencia, que no inflar, como
    agrupar, como deduplicar) y que no lleva cupo;
  - que la seleccion pondera criterios en vez de imponer una jerarquia fija;
  - que el pipeline conserva tal cual lo que el proveedor eligio -- 8 son 8, 0
    es 0 -- sin rellenar, partir ni inventar;
  - que cuando sobran candidatos los no elegidos quedan visibles, no se pierden.

Que el modelo real efectivamente descarte "buena predisposicion" o elija bien los
15 de 50 solo se mide con llamadas reales contra el set de referencia de
`experiments/requirement_selection_eval/`. Eso no se hace aca, y no se afirma.
"""

from __future__ import annotations

import pytest

from src.api.objective_understanding.contracts import (
    ProviderInvalidOutputError,
    ProviderObservation,
    ProviderTransportError,
)
from src.api.objective_understanding.prompt import (
    INSTRUCTIONS,
    build_objective_understanding_prompt,
)
from src.api.objective_understanding.selection import SELECTION_INSTRUCTIONS
from src.api.objective_understanding.service import run_objective_understanding

HOLDER_MAXIMUM = 15

# Aviso sintetico: 8 requisitos legitimos mezclados con actitudes, actividades
# rutinarias, contexto y una repeticion entre secciones.
AVISO_MIXTO = """**Sobre nosotros**

Somos una empresa con 20 anos en el mercado. Nos encanta trabajar en equipo.

**Que vas a hacer**

- Participar en reuniones de planificacion.
- Revisar documentos del area.
- Realizar tareas asignadas por el lider.
- Colaborar con el equipo.
- Disenar e implementar APIs REST para los servicios de pagos.

**Requisitos**

- Titulo de grado en Ingenieria en Sistemas o afin (excluyente).
- Experiencia minima de 3 anos en desarrollo backend.
- Dominio de Python y SQL.
- Ingles intermedio para lectura tecnica.
- Experiencia con Docker en entornos productivos.
- Conocimientos de seguridad en aplicaciones web.
- Buena actitud y predisposicion.
- Ser proactivo y comprometido.

**Valoramos**

- Conocimientos de Kubernetes.
- Experiencia disenando APIs REST.
"""

LEGITIMOS = [
    ("Titulo de grado en Ingenieria en Sistemas o afin (excluyente)",
     "- Titulo de grado en Ingenieria en Sistemas o afin (excluyente)."),
    ("Experiencia minima de 3 anos en desarrollo backend",
     "- Experiencia minima de 3 anos en desarrollo backend."),
    ("Dominio de Python y SQL", "- Dominio de Python y SQL."),
    ("Ingles intermedio para lectura tecnica", "- Ingles intermedio para lectura tecnica."),
    ("Experiencia con Docker en entornos productivos",
     "- Experiencia con Docker en entornos productivos."),
    ("Diseno e implementacion de APIs REST",
     "- Disenar e implementar APIs REST para los servicios de pagos."),
    ("Valorado: conocimientos de Kubernetes", "- Conocimientos de Kubernetes."),
    ("Conocimientos de seguridad en aplicaciones web",
     "- Conocimientos de seguridad en aplicaciones web."),
]


class SequencedProvider:
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


def _output(proposals: list[dict]) -> dict:
    return {"proposedRequirements": proposals, "unresolvedPassages": []}


def _run(monkeypatch: pytest.MonkeyPatch, provider: SequencedProvider, raw: str = AVISO_MIXTO) -> dict:
    monkeypatch.setenv("OBJECTIVE_UNDERSTANDING_OPENAI_MODEL", "modelo-de-prueba")
    return run_objective_understanding(
        objective_type="EMPLOYMENT",
        title="Backend",
        raw_objective_text=raw,
        max_proposed_requirements=HOLDER_MAXIMUM,
        provider=provider,
    )


def _prompt() -> str:
    return build_objective_understanding_prompt(
        objective_type="EMPLOYMENT",
        title="Backend",
        raw_objective_text=AVISO_MIXTO,
        extraction_policy=True,
    )


def _politica() -> str:
    """La politica en minusculas y con el espaciado normalizado (los saltos de
    linea del bloque no son parte del contrato)."""
    texto = " ".join(_prompt().lower().split())
    return texto[texto.index("=== politica de extraccion de requisitos ==="):]


def _seccion(inicio: str, fin: str) -> str:
    politica = _politica()
    return politica[politica.index(inicio):politica.index(fin)]


# ---------------------------------------------------------------------------
# Politica de extraccion
# ---------------------------------------------------------------------------


def test_el_cuerpo_congelado_sigue_intacto_y_la_politica_va_al_final() -> None:
    prompt = _prompt()
    assert prompt.startswith(INSTRUCTIONS)
    assert prompt.index("--- fin del texto crudo ---") < prompt.index("=== POLITICA DE EXTRACCION")


def test_la_politica_no_lleva_cupo_y_cero_es_valido() -> None:
    politica = _politica()
    assert "no te limites a una cantidad" in politica
    assert "una etapa posterior elige" in politica
    assert "si no hay ninguno, emiti una lista vacia" in politica
    assert not any(ch.isdigit() for ch in politica.replace("5 o mas personas", ""))


@pytest.mark.parametrize(
    "categoria",
    [
        "un conocimiento tecnico",
        "una formacion o acreditacion",
        "una experiencia profesional",
        "un idioma con su nivel",
        "una capacidad profesional concreta con objeto o dominio",
    ],
)
def test_se_emiten_las_categorias_evaluables(categoria: str) -> None:
    assert categoria in _seccion("que se emite", "la relevancia no depende")


@pytest.mark.parametrize(
    "excluido",
    [
        "buena actitud",
        "buena predisposicion",
        "proactividad",
        "compromiso",
        "trabajo en equipo",
        "colaborar con el equipo",
        "participar en reuniones",
        "revisar documentos",
        "realizar tareas asignadas",
        "contexto del aviso",
    ],
)
def test_actitudes_conductas_genericas_rutina_y_contexto_no_se_emiten(excluido: str) -> None:
    assert excluido in _seccion("que no se emite", "condiciones no formativas")


def test_la_exclusion_prevalece_sobre_la_regla_congelada_solo_para_lo_generico() -> None:
    texto = " ".join(_prompt().lower().split())
    # El cuerpo congelado sigue diciendo que las soft skills son validas.
    assert "soft skills son todos requirements validos" in texto
    seccion = _seccion("que no se emite", "condiciones no formativas")
    assert "para estos casos, esta politica prevalece" in seccion
    assert "esa regla sigue vigente para todo lo demas" in seccion
    assert "titulos, anos, idiomas y certificaciones se emiten" in seccion
    # Una soft skill CON objeto sigue siendo un requisito.
    assert "liderar equipos de 5 o mas personas" in seccion


def test_las_condiciones_no_formativas_quedan_visibles_y_no_consumen_el_tope() -> None:
    seccion = _seccion("condiciones no formativas", "no conviertas una frase")
    for condicion in ("disponibilidad horaria o de turnos", "residencia", "edad",
                      "documentacion a presentar"):
        assert condicion in seccion
    # Existen y no se borran: van por el canal que OU_A2 ya tiene, con su cita.
    assert "existe y no se borra, pero no se emite como requirement" in seccion
    assert "va a unresolvedpassages con su cita literal" in seccion
    assert 'empiece exactamente con "condicion no formativa:"' in seccion
    # Una acreditacion habilitante NO es una condicion: se emite.
    assert "matricula o una licencia habilitante no son condiciones no formativas" in seccion


def test_la_relevancia_no_depende_de_que_la_persona_tenga_evidencia() -> None:
    seccion = _seccion("la relevancia no depende", "que no se emite")
    for requisito in ("python", "sql", "ingles avanzado", "titulo universitario"):
        assert requisito in seccion
    assert "vos no ves el perfil de nadie" in seccion


def test_un_requisito_cualitativo_sin_metricas_se_emite() -> None:
    assert "no hace falta que tenga numeros, porcentajes ni fechas" in _politica()


def test_no_se_infla_una_tarea_o_una_actitud_en_una_capacidad() -> None:
    seccion = _seccion("no conviertas una frase", "agrupacion y qualifiers")
    assert '"participar en reuniones de equipo" no es "capacidad de liderazgo' in seccion
    assert '"buena predisposicion" no es "competencias avanzadas' in seccion
    assert "no agregues anos, niveles, certificaciones ni metricas" in seccion
    assert "no se convierte en un requirement por cada oracion" in seccion


def test_agrupacion_sin_fusionar_condiciones_independientes() -> None:
    seccion = _seccion("agrupacion y qualifiers", "un requisito, una vez")
    assert "mariadb, mongodb y keydb" in seccion
    assert "no fusiones condiciones independientes" in seccion
    assert "excluyente\" queda pegado al requisito exacto" in seccion


def test_dos_redacciones_del_mismo_requisito_son_uno() -> None:
    seccion = _seccion("un requisito, una vez", "no recortes")
    assert "aparezcan en secciones distintas" in seccion
    assert "cita auxiliar, no como otro candidato" in seccion
    # Coherente con DUPLICADOS del cuerpo congelado: distinta fuerza, dos claims.
    assert "si difieren materialmente en fuerza, siguen siendo dos" in seccion


def test_la_politica_no_introduce_puntajes_ni_ranking() -> None:
    politica = _politica()
    for prohibido in ("score", "puntaje", "ranking", "porcentaje de ajuste", "match"):
        assert prohibido not in politica


# ---------------------------------------------------------------------------
# Politica de seleccion
# ---------------------------------------------------------------------------


def _seleccion() -> str:
    return " ".join(SELECTION_INSTRUCTIONS.lower().split())


def test_la_seleccion_pondera_criterios_sin_jerarquia_fija() -> None:
    texto = _seleccion()
    assert "no una jerarquia fija" in texto
    for criterio in ("caracter explicito", "centralidad", "especificidad",
                     "capacidad de diferenciar", "sin redundancia"):
        assert criterio in texto
    assert "un titulo generico no le gana automaticamente a una capacidad tecnica" in texto
    assert "conservalos todos" in texto
    assert "el orden en que aparecen no es un criterio" in texto


def test_la_seleccion_no_puede_escribir_requisitos() -> None:
    texto = _seleccion()
    assert "no escribas requisitos. no reformules. no agregues nada" in texto
    assert "solo contexto: no crea requisitos" in texto


# ---------------------------------------------------------------------------
# Pipeline con proveedor simulado
# ---------------------------------------------------------------------------


def test_ocho_legitimos_son_ocho_sin_relleno_ni_seleccion(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = SequencedProvider(_output([_proposal(text, quote) for text, quote in LEGITIMOS]))
    result = _run(monkeypatch, provider)

    assert len(provider.calls) == 1
    candidatos = result["artifact"]["candidates"]
    assert len(candidatos) == 8
    assert result["artifact"]["omittedCandidates"] == []
    assert len({c["proposedRequirementText"] for c in candidatos}) == 8
    assert sum("apis rest" in c["proposedRequirementText"].lower() for c in candidatos) == 1
    textos = " | ".join(c["proposedRequirementText"].lower() for c in candidatos)
    for generico in ("actitud", "predisposicion", "proactivo", "reuniones", "tareas asignadas"):
        assert generico not in textos
    for candidato in candidatos:
        reference = candidato["primarySourceReference"]
        assert reference is not None
        assert AVISO_MIXTO[reference["charStart"]:reference["charEnd"]] == reference["exactExcerpt"]


def test_cincuenta_candidatos_pasan_por_seleccion_y_los_omitidos_quedan_visibles(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cincuenta = [
        _proposal(f"Requisito {i}", LEGITIMOS[i % len(LEGITIMOS)][1]) for i in range(1, 51)
    ]
    elegidos = [3, 5, 8, 12, 17, 21, 22, 30, 31, 33, 40, 44, 47, 49, 50]
    provider = SequencedProvider(_output(cincuenta), {"selectedCandidateNumbers": elegidos})
    result = _run(monkeypatch, provider)

    assert len(provider.calls) == 2
    textos = [c["proposedRequirementText"] for c in result["artifact"]["candidates"]]
    assert textos == [f"Requisito {n}" for n in elegidos]
    assert len(result["artifact"]["omittedCandidates"]) == 35
    assert result["execution"]["selection"]["extractedCandidateCount"] == 50


def test_cero_requisitos_es_una_respuesta_controlada(monkeypatch: pytest.MonkeyPatch) -> None:
    sin_criterios = "Somos una cooperativa. Valoramos la buena actitud y el compromiso."
    result = _run(monkeypatch, SequencedProvider(_output([])), raw=sin_criterios)
    assert result["artifact"]["candidates"] == []
    assert result["artifact"]["omittedCandidates"] == []


def test_un_fallo_del_proveedor_no_fabrica_una_propuesta(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = SequencedProvider(ProviderTransportError("read_timeout"))
    with pytest.raises(ProviderTransportError):
        _run(monkeypatch, provider)
    assert len(provider.calls) == 1


def test_una_salida_invalida_tampoco(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = SequencedProvider({"proposedRequirements": "no es una lista", "unresolvedPassages": []})
    with pytest.raises(ProviderInvalidOutputError):
        _run(monkeypatch, provider)
