"""Schema de salida estructurada del Objective Analysis productivo — F3.3B.

Recorte de `OBJECTIVE_SCHEMA` de B2.4.1: se conserva la clasificacion y se
retiran las responsabilidades de descomposicion.

    RETIRADO   decompositionStatus · objectiveContext · candidateSegments ·
               ambiguityRationale · requirementQuote
    AGREGADO   requirementId  (referencia; lo define objective_definition_v1)
    INTACTO    epistemicTarget · atomicity · evaluability · qualifiers ·
               normalizedRequirement

`continuityCore` NO aparece: no existe en B2.4.1 —es un mecanismo de B2.1 que
B2.4 reemplazo por `weakerClaimSearch.candidate.continuityAssessment`— y ademas
pertenece a una etapa posterior, con la evidencia delante.
"""

from __future__ import annotations

from typing import Any

from src.api.objective_analysis.contracts import (
    ATOMICITY_TOKENS,
    EPISTEMIC_TARGETS,
    QUALIFIER_ROLES,
    REQUIRED_EVIDENCE_TYPES,
)

_QUALIFIER: dict[str, Any] = {
    "type": "object",
    "properties": {
        "kind": {"type": "string"},
        "value": {"type": "string"},
        "sourcePhrase": {"type": "string"},
        "role": {"type": "string", "enum": list(QUALIFIER_ROLES)},
        "rationale": {"type": "string"},
    },
    "required": ["kind", "value", "sourcePhrase", "role", "rationale"],
    "additionalProperties": False,
}

_REQUIREMENT: dict[str, Any] = {
    "type": "object",
    "properties": {
        "requirementId": {"type": "string"},
        "epistemicTarget": {"type": "string", "enum": list(EPISTEMIC_TARGETS)},
        "epistemicTargetRationale": {"type": "string"},
        "atomicity": {"type": "string", "enum": list(ATOMICITY_TOKENS)},
        "evaluability": {
            "type": "object",
            "properties": {
                "requiredEvidenceType": {
                    "type": "string",
                    "enum": list(REQUIRED_EVIDENCE_TYPES),
                },
                "formativeEvidenceCapable": {"type": "boolean"},
                "rationale": {"type": "string"},
            },
            "required": [
                "requiredEvidenceType",
                "formativeEvidenceCapable",
                "rationale",
            ],
            "additionalProperties": False,
        },
        "qualifiers": {"type": "array", "items": _QUALIFIER},
        "normalizedRequirement": {"type": "string"},
    },
    "required": [
        "requirementId",
        "epistemicTarget",
        "epistemicTargetRationale",
        "atomicity",
        "evaluability",
        "qualifiers",
        "normalizedRequirement",
    ],
    "additionalProperties": False,
}

#: Lo que el PROVEEDOR debe devolver. `qualifierId` y `validations` NO se le
#: piden al modelo: los asigna codigo confiable, igual que en el candidato
#: congelado.
OBJECTIVE_ANALYSIS_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"requirements": {"type": "array", "items": _REQUIREMENT}},
    "required": ["requirements"],
    "additionalProperties": False,
}

OBJECTIVE_ANALYSIS_SCHEMA_NAME = "product_objective_analysis"
