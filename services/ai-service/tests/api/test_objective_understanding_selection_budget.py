"""Presupuesto de seleccion de Objective Understanding — cota de 12 requisitos.

QUE PROBLEMA CIERRA. Un aviso de empleo real produjo 34 candidatos. El consumidor
publico solo puede confirmar 12, asi que la propuesta expuesta era un estado que
nadie podia confirmar nunca.

LO QUE **NO** SE HACE, y es la mitad del contrato: `candidates[:12]`. Recortar
despues de un orden de fuente acepta como autoritativa una seleccion que nadie
hizo. En un aviso tipico, el titulo requerido, el idioma y el excluyente estan
DESPUES de la seccion de responsabilidades: recortar los deja afuera en silencio y
deja adentro doce oraciones de tareas.

    la unica etapa que puede elegir CUALES 12 es la que lee la fuente

TRES CAPAS, y ninguna reemplaza a las otras: el prompt pide elegir, el json_schema
lo restringe estructuralmente y la validacion vuelve a contar del lado del
servidor. Que el proveedor diga que respeto un maximo no es haberlo respetado.

    REAL_PROVIDER_CALLS = 0
"""

from __future__ import annotations

import hashlib

import pytest

from src.api.objective_understanding.contracts import (
    ProviderInvalidOutputError,
    ProviderObservation,
)
from src.api.objective_understanding.prompt import (
    INSTRUCTIONS,
    OU_A2_INSTRUCTIONS_SHA256,
    build_objective_understanding_prompt,
)
from src.api.objective_understanding.schema import (
    OBJECTIVE_UNDERSTANDING_OUTPUT_SCHEMA,
    objective_understanding_output_schema,
)
from src.api.objective_understanding.service import run_objective_understanding
from src.api.objective_understanding.validation import validate_provider_output

PUBLIC_MAXIMUM = 12


# ---------------------------------------------------------------------------
# Fixture de cobertura material: aviso de empleo largo, sintetico.
#
# Contiene a proposito TODOS los fenomenos que el recorte arbitrario destruye:
# excluyente, titulo requerido, anos de experiencia, listas de tecnologias
# agrupadas por la propia fuente, idioma, y una seccion de responsabilidades
# larga que no debe convertirse en un Requirement por oracion.
# ---------------------------------------------------------------------------

AVISO_LARGO = """**Sobre nosotros**

Somos una cooperativa de software fundada en 2004, con oficinas en tres ciudades y
mas de 180 personas. Trabajamos para clientes del sector salud y educacion.

**Responsabilidades**

- Participaras del ciclo completo de desarrollo de nuestros servicios.
- Colaboraras con los equipos de producto, infraestructura y seguridad.
- Escribiras documentacion tecnica de las decisiones que tomes.
- Revisaras el codigo de tus companeros y recibiras revisiones del tuyo.
- Acompanaras a las personas mas nuevas del equipo en su incorporacion.
- Participaras de las ceremonias del equipo y de las retrospectivas quincenales.
- Reportaras el avance de tus tareas en el tablero compartido.
- Te involucraras en la mejora continua de nuestras practicas de trabajo.

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

- Autonomia, comunicacion clara y trabajo en equipo.
- Experiencia previa en sistemas de alta disponibilidad.

**Que ofrecemos**

Modalidad hibrida, tres semanas de vacaciones adicionales y presupuesto anual de
formacion. Contacto: empleos@ejemplo.invalid
"""


class StubProvider:
    def __init__(self, output: dict) -> None:
        self.output = output
        self.calls: list[dict] = []

    def complete(self, **kwargs: object) -> ProviderObservation:
        self.calls.append(dict(kwargs))
        return ProviderObservation(output=self.output, reported_model="modelo-de-prueba")


def _proposal(text: str, primary: str) -> dict:
    return {
        "proposedRequirementText": text,
        "primarySourceQuote": primary,
        "auxiliarySourceQuotes": [],
        "sourceSectionLabel": "",
    }


def _output(proposals: list[dict]) -> dict:
    return {"proposedRequirements": proposals, "unresolvedPassages": []}


def _run(
    monkeypatch: pytest.MonkeyPatch,
    raw: str,
    output: dict,
    maximum: int | None,
) -> tuple[dict, StubProvider]:
    monkeypatch.setenv("OBJECTIVE_UNDERSTANDING_OPENAI_MODEL", "modelo-de-prueba")
    provider = StubProvider(output)
    result = run_objective_understanding(
        objective_type="EMPLOYMENT",
        title="Desarrollador backend",
        raw_objective_text=raw,
        max_proposed_requirements=maximum,
        provider=provider,
    )
    return result, provider


# ---------------------------------------------------------------------------
# El camino del holder no se mueve
# ---------------------------------------------------------------------------


def test_el_cuerpo_congelado_no_cambio() -> None:
    assert hashlib.sha256(INSTRUCTIONS.encode("utf-8")).hexdigest() == OU_A2_INSTRUCTIONS_SHA256


def test_sin_presupuesto_el_prompt_es_el_mismo_de_siempre() -> None:
    """El bloque de seleccion es ADITIVO: sin presupuesto no existe."""
    prompt = build_objective_understanding_prompt(
        objective_type="EMPLOYMENT", title="t", raw_objective_text=AVISO_LARGO
    )
    assert prompt.startswith(INSTRUCTIONS)
    assert prompt.endswith("--- fin del texto crudo ---\n")
    assert "PRESUPUESTO DE SELECCION" not in prompt


def test_sin_presupuesto_el_schema_es_el_objeto_congelado() -> None:
    # Identidad, no equivalencia: es literalmente el mismo objeto que se evaluo.
    assert objective_understanding_output_schema(None) is OBJECTIVE_UNDERSTANDING_OUTPUT_SCHEMA


def test_sin_presupuesto_no_hay_tope_de_cantidad() -> None:
    proposals = [_proposal(f"Requisito {i}", "Programacion en Python.") for i in range(40)]
    validated, _ = validate_provider_output(_output(proposals))
    assert len(validated) == 40


# ---------------------------------------------------------------------------
# Con presupuesto: contrato de seleccion, no recorte
# ---------------------------------------------------------------------------


def test_el_prompt_acotado_extiende_al_prompt_sin_acotar() -> None:
    base = build_objective_understanding_prompt(
        objective_type="EMPLOYMENT", title="t", raw_objective_text=AVISO_LARGO
    )
    acotado = build_objective_understanding_prompt(
        objective_type="EMPLOYMENT",
        title="t",
        raw_objective_text=AVISO_LARGO,
        max_proposed_requirements=PUBLIC_MAXIMUM,
    )
    # Mismas reglas, mismo sobre, misma fuente verbatim; se AGREGA la seleccion.
    assert acotado.startswith(base)
    assert AVISO_LARGO in acotado


def test_el_prompt_acotado_pide_elegir_y_dice_que_priorizar() -> None:
    prompt = build_objective_understanding_prompt(
        objective_type="EMPLOYMENT",
        title="t",
        raw_objective_text=AVISO_LARGO,
        max_proposed_requirements=PUBLIC_MAXIMUM,
    )
    texto = prompt.lower()

    # El tope es explicito y no es una sugerencia.
    assert "maximo de 12" in texto
    assert "emitir mas invalida la respuesta entera" in texto

    # Prioriza secciones de criterios por encima de responsabilidades.
    assert "requisitos" in texto and "responsabilidades" in texto
    assert "no se convierte en un requirement por cada oracion" in texto

    # Lo que nunca puede quedar afuera.
    for imprescindible in ("excluyente", "titulo", "anos de experiencia", "idioma", "tecnologias"):
        assert imprescindible in texto


def test_el_prompt_acotado_prohibe_la_sobre_composicion() -> None:
    """La cota no se satisface fusionando condiciones independientes."""
    prompt = build_objective_understanding_prompt(
        objective_type="EMPLOYMENT",
        title="t",
        raw_objective_text=AVISO_LARGO,
        max_proposed_requirements=PUBLIC_MAXIMUM,
    )
    texto = prompt.lower()

    # Agrupar lo que la fuente agrupa: si.
    assert "mariadb, mongodb y keydb" in texto
    assert "kafka y rabbitmq" in texto
    # Empaquetar lo independiente para que entre: no.
    assert "no fusiones condiciones independientes" in texto
    assert "no pueden empaquetarse en" in texto
    assert "no cajones" in texto or "no 12 cajones" in texto or "cajones" in texto
    # Un excluyente queda pegado a SU requisito.
    assert "queda pegado al requisito exacto que califica" in texto


def test_el_prompt_acotado_no_introduce_puntaje_ni_ranking() -> None:
    prompt = build_objective_understanding_prompt(
        objective_type="EMPLOYMENT",
        title="t",
        raw_objective_text="Requisitos: Python.",
        max_proposed_requirements=PUBLIC_MAXIMUM,
    )
    texto = prompt.lower()
    assert "no ordenes por importancia, no puntues, no midas ajuste" in texto
    for prohibido in ("score", "puntaje de", "ranking", "porcentaje de ajuste", "match"):
        assert prohibido not in texto


def test_el_schema_acotado_declara_el_tope() -> None:
    schema = objective_understanding_output_schema(PUBLIC_MAXIMUM)
    assert schema["properties"]["proposedRequirements"]["maxItems"] == PUBLIC_MAXIMUM
    # Y no muta el congelado: el holder sigue mandando el schema evaluado.
    assert "maxItems" not in OBJECTIVE_UNDERSTANDING_OUTPUT_SCHEMA["properties"][
        "proposedRequirements"
    ]


def test_exactamente_el_maximo_es_valido() -> None:
    proposals = [_proposal(f"Requisito {i}", "Programacion en Python.") for i in range(PUBLIC_MAXIMUM)]
    validated, _ = validate_provider_output(_output(proposals), PUBLIC_MAXIMUM)
    assert len(validated) == PUBLIC_MAXIMUM


def test_una_propuesta_excedida_se_descarta_entera_y_no_se_recorta() -> None:
    proposals = [_proposal(f"Requisito {i}", "Programacion en Python.") for i in range(13)]
    with pytest.raises(ProviderInvalidOutputError) as error:
        validate_provider_output(_output(proposals), PUBLIC_MAXIMUM)
    assert "exceeds_requested_maximum" in str(error.value)


def test_el_servicio_acotado_manda_las_tres_capas(monkeypatch: pytest.MonkeyPatch) -> None:
    proposals = [
        _proposal(
            "Titulo universitario en Ingenieria en Sistemas, Ciencias de la Computacion o carrera afin (excluyente)",
            "- Titulo universitario en Ingenieria en Sistemas, Ciencias de la Computacion o carrera afin (excluyente).",
        ),
        _proposal("Programacion en Python", "- Programacion en Python."),
    ]
    result, provider = _run(monkeypatch, AVISO_LARGO, _output(proposals), PUBLIC_MAXIMUM)

    assert len(provider.calls) == 1
    call = provider.calls[0]
    assert "PRESUPUESTO DE SELECCION" in call["prompt"]
    assert call["schema"]["properties"]["proposedRequirements"]["maxItems"] == PUBLIC_MAXIMUM
    # Se declara el tope acotado para que el consumidor pueda verificarlo.
    assert result["execution"]["requestedMaxProposedRequirements"] == PUBLIC_MAXIMUM
    assert len(result["artifact"]["candidates"]) == 2


def test_el_servicio_sin_presupuesto_no_declara_tope(monkeypatch: pytest.MonkeyPatch) -> None:
    result, provider = _run(
        monkeypatch,
        AVISO_LARGO,
        _output([_proposal("Programacion en Python", "- Programacion en Python.")]),
        None,
    )
    assert "requestedMaxProposedRequirements" not in result["execution"]
    assert "PRESUPUESTO DE SELECCION" not in provider.calls[0]["prompt"]


def test_una_respuesta_excedida_no_llega_a_construir_artefacto(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """34 candidatos con tope 12: no hay artefacto, no hay propuesta, no hay recorte."""
    proposals = [_proposal(f"Requisito {i}", "- Programacion en Python.") for i in range(34)]
    with pytest.raises(ProviderInvalidOutputError):
        _run(monkeypatch, AVISO_LARGO, _output(proposals), PUBLIC_MAXIMUM)


# ---------------------------------------------------------------------------
# Cobertura material: que la cota no destruya lo que importa
#
# NO se afirma una redaccion ni un orden exacto: eso seria sobreajustar al
# lenguaje del proveedor. Se afirma el CONTRATO y la cobertura.
# ---------------------------------------------------------------------------


def test_una_seleccion_fiel_del_aviso_largo_cabe_en_doce(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seleccion = [
        _proposal(
            "Titulo universitario en Ingenieria en Sistemas, Ciencias de la Computacion o carrera afin (excluyente)",
            "- Titulo universitario en Ingenieria en Sistemas, Ciencias de la Computacion o carrera afin (excluyente).",
        ),
        _proposal(
            "Experiencia minima de 4 anos en desarrollo backend",
            "- Experiencia minima de 4 anos en desarrollo backend.",
        ),
        _proposal("Programacion en Python", "- Programacion en Python."),
        _proposal(
            "Conocimiento de bases de datos como MariaDB, MongoDB y KeyDB",
            "- Conocimiento de bases de datos como MariaDB, MongoDB y KeyDB.",
        ),
        _proposal(
            "Conocimiento de mensajeria y event streaming como Kafka y RabbitMQ",
            "- Conocimiento de mensajeria y event streaming como Kafka y RabbitMQ.",
        ),
        _proposal(
            "Experiencia con Docker y Kubernetes",
            "- Experiencia con Docker y Kubernetes.",
        ),
        _proposal("Diseno y consumo de APIs REST", "- Diseno y consumo de APIs REST."),
        _proposal(
            "Manejo de Git como sistema de control de versiones",
            "- Manejo de Git como sistema de control de versiones.",
        ),
        _proposal(
            "Ingles tecnico para lectura de documentacion",
            "- Ingles tecnico para lectura de documentacion.",
        ),
        _proposal(
            "Valorado: autonomia, comunicacion clara y trabajo en equipo",
            "- Autonomia, comunicacion clara y trabajo en equipo.",
        ),
        _proposal(
            "Valorado: experiencia previa en sistemas de alta disponibilidad",
            "- Experiencia previa en sistemas de alta disponibilidad.",
        ),
        _proposal(
            "Revisar codigo de otras personas del equipo",
            "- Revisaras el codigo de tus companeros y recibiras revisiones del tuyo.",
        ),
    ]
    assert len(seleccion) == PUBLIC_MAXIMUM

    result, _ = _run(monkeypatch, AVISO_LARGO, _output(seleccion), PUBLIC_MAXIMUM)
    candidatos = result["artifact"]["candidates"]
    textos = " | ".join(c["proposedRequirementText"] for c in candidatos).lower()

    assert 1 <= len(candidatos) <= PUBLIC_MAXIMUM

    # Lo material sobrevive a la cota.
    assert "excluyente" in textos
    assert "titulo universitario" in textos
    assert "4 anos" in textos
    assert "ingles" in textos
    assert "python" in textos

    # Las listas que la fuente agrupa NO se explotan en un claim por tecnologia.
    agrupados = [c for c in candidatos if "mariadb, mongodb y keydb" in c["proposedRequirementText"].lower()]
    assert len(agrupados) == 1
    assert sum(1 for c in candidatos if "keydb" in c["proposedRequirementText"].lower()) == 1
    assert sum(1 for c in candidatos if "rabbitmq" in c["proposedRequirementText"].lower()) == 1

    # La seccion de responsabilidades no se convirtio en ocho Requirements.
    responsabilidades = sum(
        1
        for c in candidatos
        if c["primarySourceReference"] is not None
        and c["primarySourceReference"]["exactExcerpt"].startswith("- Participaras")
    )
    assert responsabilidades == 0

    # Anclaje real: cada cita sigue siendo verificable contra la fuente.
    for candidato in candidatos:
        reference = candidato["primarySourceReference"]
        assert reference is not None
        assert AVISO_LARGO[reference["charStart"] : reference["charEnd"]] == reference["exactExcerpt"]

    # Y nada de esto introdujo puntaje, ranking ni ajuste.
    for prohibido in ("score", "ranking", "confidence", "fit"):
        assert prohibido not in str(result).lower()


def test_una_explosion_de_tecnologias_no_desplaza_lo_obligatorio(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """El fenomeno exacto que motivo la cota: 34 claims, uno por linea.

    No se acepta parcialmente y no se recorta a los 12 primeros --que en este
    aviso serian ocho responsabilidades y el titulo-- porque eso dejaria afuera
    el idioma y las tecnologias sin que nadie se entere.
    """
    explosion = [
        _proposal(f"Claim fragmentado {i}", "- Programacion en Python.") for i in range(34)
    ]
    with pytest.raises(ProviderInvalidOutputError):
        _run(monkeypatch, AVISO_LARGO, _output(explosion), PUBLIC_MAXIMUM)
