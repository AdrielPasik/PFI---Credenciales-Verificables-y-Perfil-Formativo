"""Etapa de SELECCION de Requirements — politica `product_requirement_selection_v1`.

POR QUE UNA ETAPA APARTE Y NO UN CUPO DENTRO DE LA EXTRACCION.

Pedirle al extractor "emiti como mucho N" mezcla dos decisiones distintas --que es
un requisito y cuales importan mas-- en la misma salida, y esconde lo que queda
afuera: el modelo descarta en silencio y nadie puede mostrarle al titular que
hubo una seleccion. Con dos pasos:

    extraccion   que es un requisito evaluable de esta oportunidad  (sin cupo)
    seleccion    cuales N conservar, por relevancia                 (solo si sobran)

QUE NO PUEDE HACER ESTA ETAPA, por construccion:

    escribir un requisito        su salida son NUMEROS de candidatos ya extraidos
    reformular uno               idem: el texto y la cita salen del extractor
    inventar una cita            idem: el anclaje lo hizo codigo confiable antes
    recortar por orden           el codigo nunca elige; si la salida no sirve, falla

Una sola llamada, sin reintentos. Si la respuesta no es una seleccion valida, la
propuesta falla de forma explicita -- nunca se "repara" quedandose con los
primeros N.
"""

from __future__ import annotations

from typing import Any

from src.api.objective_understanding.contracts import ProviderInvalidOutputError

#: Version de la politica de seleccion. Viaja en la respuesta y NestJS la verifica.
SELECTION_POLICY_VERSION = "product_requirement_selection_v1"

SELECTION_SCHEMA_NAME = "requirement_selection_v1"

#: Sin `minItems`/`maxItems` a proposito: la cantidad la verifica el servidor, asi
#: que esta etapa no depende de que el proveedor soporte esas palabras clave en
#: modo estricto.
SELECTION_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["selectedCandidateNumbers"],
    "properties": {
        "selectedCandidateNumbers": {
            "type": "array",
            "items": {"type": "integer"},
            "description": "Numeros de los requisitos que se conservan, sin repetir.",
        }
    },
}

SELECTION_INSTRUCTIONS = """Sos la etapa de SELECCION de requisitos de Scope.

Una etapa anterior extrajo de una oportunidad {count} requisitos, cada uno con su cita literal.
Este consumidor analiza como maximo {maximum}. Tu unica tarea es elegir cuales conservar.

NO escribas requisitos. NO reformules. NO agregues nada. Devolve SOLO los numeros de los que se
conservan, entre 1 y {maximum}, sin repetir.

COMO ELEGIR. Son criterios a ponderar en ESTA oportunidad, no una jerarquia fija:
- caracter explicito: lo marcado como obligatorio, excluyente o "se requiere" pesa mas que lo
  deseable, y lo deseable explicito pesa mas que lo que solo se infiere de una tarea;
- centralidad: lo que define el puesto o el proposito pesa mas que lo accesorio;
- especificidad: un conocimiento concreto ("APIs REST con FastAPI") pesa mas que uno generico
  del mismo tema;
- capacidad de diferenciar: lo que distingue a quien encaja de quien no;
- sin redundancia: si dos se solapan, conserva el mas especifico.
Un titulo generico no le gana automaticamente a una capacidad tecnica obligatoria y central, ni
al reves: compara su peso en esta oportunidad.
Si los requisitos obligatorios o excluyentes entran en el maximo, conservalos todos.
Una condicion que ninguna formacion acredita (disponibilidad, lugar, edad, documentacion) no le
quita el lugar a un requisito formativo.
El orden en que aparecen no es un criterio.

=== OPORTUNIDAD (solo contexto: no crea requisitos) ===
objectiveType: {objective_type}
title: {title}
--- texto de la oportunidad ---
{raw_objective_text}
--- fin del texto ---

=== REQUISITOS EXTRAIDOS ===
{candidates}
=== FIN DE LOS REQUISITOS ===
"""


def build_selection_prompt(
    *,
    objective_type: str,
    title: str,
    raw_objective_text: str,
    proposals: list[dict[str, Any]],
    maximum: int,
) -> str:
    """Arma el prompt de seleccion. Los candidatos se numeran desde 1."""
    lines = []
    for number, proposal in enumerate(proposals, start=1):
        section = (proposal.get("sourceSectionLabel") or "").strip()
        section_part = f" [seccion: {section}]" if section else ""
        quote = " ".join((proposal.get("primarySourceQuote") or "").split())
        lines.append(
            f"{number}.{section_part} {proposal['proposedRequirementText'].strip()}"
            f" -- cita: \"{quote}\""
        )
    return SELECTION_INSTRUCTIONS.format(
        count=len(proposals),
        maximum=maximum,
        objective_type=objective_type,
        title=title or "",
        raw_objective_text=raw_objective_text,
        candidates="\n".join(lines),
    )


def validate_selection_output(output: Any, candidate_count: int, maximum: int) -> list[int]:
    """Devuelve los INDICES (base 0) elegidos, en orden de fuente, o falla cerrado.

    Se rechaza todo lo que no sea una seleccion exacta: numeros fuera de rango,
    repetidos, una lista vacia o mas de `maximum`. No hay correccion: corregir
    seria elegir en nombre del modelo.
    """
    if not isinstance(output, dict) or set(output) != {"selectedCandidateNumbers"}:
        raise ProviderInvalidOutputError("selection_output_shape_invalid")
    numbers = output["selectedCandidateNumbers"]
    if not isinstance(numbers, list) or not numbers:
        raise ProviderInvalidOutputError("selection_output_empty")
    if any(isinstance(n, bool) or not isinstance(n, int) for n in numbers):
        raise ProviderInvalidOutputError("selection_output_not_integers")
    if len(set(numbers)) != len(numbers):
        raise ProviderInvalidOutputError("selection_output_repeated_number")
    if any(n < 1 or n > candidate_count for n in numbers):
        raise ProviderInvalidOutputError("selection_output_number_out_of_range")
    if len(numbers) > maximum:
        raise ProviderInvalidOutputError("selection_output_exceeds_maximum")
    # Orden de fuente, no orden de importancia.
    return sorted(n - 1 for n in numbers)
