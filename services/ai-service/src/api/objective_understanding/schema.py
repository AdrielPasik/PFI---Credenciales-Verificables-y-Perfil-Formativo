"""Schema de salida estructurada del proveedor — slice P2.2.

FORMA IDENTICA A LA DEL CANDIDATO `OU_A2`. Mismos campos, mismo orden, mismos
`required`, mismo `additionalProperties: false`, mismo `strict: true` y mismo
nombre de schema enviado al proveedor. Cambiar cualquiera de esas cosas cambia la
peticion que se evaluo.

EL PROVEEDOR PROPONE TEXTO; EL CODIGO CONFIABLE CONSTRUYE HECHOS. Por eso el
schema NO admite —y `additionalProperties: false` lo hace estructuralmente
imposible, no una promesa de prosa—:

    candidateId · charStart · charEnd · requirementId · finalState
    confidence · fit · owner · epistemicTarget · evaluability
    formativeEvidenceCapable · cualquier dato del holder

Un proveedor que intente emitir cualquiera de esos campos produce una respuesta
que falla la validacion estructural del schema antes de llegar al builder.

NOTA SOBRE EL NOMBRE. `PROVIDER_SCHEMA_NAME` coincide en string con
`ARTIFACT_SCHEMA_VERSION` porque asi lo mandaba el candidato evaluado y P2.0 §22.2
eligio el mismo nombre para el artefacto transitorio. Son dos cosas distintas: uno
es la etiqueta del `json_schema` que viaja al proveedor, el otro es la version del
artefacto productivo que construye el codigo confiable.
"""

from __future__ import annotations

from typing import Any

#: Etiqueta del `json_schema` enviada al proveedor. IDENTICA a la de OU_A2.
PROVIDER_SCHEMA_NAME = "objective_requirement_proposal_v1"

OBJECTIVE_UNDERSTANDING_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["proposedRequirements", "unresolvedPassages"],
    "properties": {
        "proposedRequirements": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "proposedRequirementText",
                    "primarySourceQuote",
                    "auxiliarySourceQuotes",
                    "sourceSectionLabel",
                ],
                "properties": {
                    "proposedRequirementText": {
                        "type": "string",
                        "description": (
                            "El claim evaluativo normalizado y legible, en el idioma del Objective."
                        ),
                    },
                    "primarySourceQuote": {
                        "type": "string",
                        "description": (
                            "Substring LITERAL y CONTIGUA del texto crudo que establece "
                            "principalmente este claim."
                        ),
                    },
                    "auxiliarySourceQuotes": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": (
                            "Otras substrings literales del texto crudo donde el mismo claim "
                            "reaparece."
                        ),
                    },
                    "sourceSectionLabel": {
                        "type": "string",
                        "description": (
                            "Encabezado literal de la seccion de la que proviene, o cadena vacia."
                        ),
                    },
                },
            },
        },
        "unresolvedPassages": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["quote", "reason"],
                "properties": {
                    "quote": {"type": "string"},
                    "reason": {"type": "string"},
                },
            },
            "description": (
                "Pasajes genuinamente ambiguos que no se resolvieron en un claim."
            ),
        },
    },
}

#: Campos que el proveedor NUNCA puede aportar con autoridad. Se declara explicito
#: para que el test estructural no dependa de leer el schema a mano.
PROVIDER_FORBIDDEN_FIELDS = (
    "candidateId",
    "charStart",
    "charEnd",
    "offsetUnit",
    "requirementId",
    "finalState",
    "confidence",
    "fit",
    "owner",
    "provenance",
    "epistemicTarget",
    "evaluability",
    "formativeEvidenceCapable",
)
