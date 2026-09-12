"""Schema de salida del razonamiento contextual — slice F3.5.

Promocion de `b24_unified_reasoning` SIN cambios de campo. Describe el
razonamiento de UN Requirement: `requirementId` es un string en el tope, no un
array, y `additionalProperties: false` hace que el schema NO PUEDA representar
varios Requirements. Ese es el mecanismo estructural que sostiene
`ONE_CALL_PER_REQUIREMENT`.

LO QUE EL SCHEMA NO TIENE, A PROPOSITO:

    finalState · policyTrace · explanation
    globalScore · fitPercentage · rank
    chainOfThought · scratchpad

Los tres primeros son de F3.6 y deterministas. Los del medio no existen en el
contrato congelado —no hay estado final del Objective, ni score, ni porcentaje—.
Los ultimos estan prohibidos. `additionalProperties: false` los vuelve
irrepresentables en vez de dejarlos a criterio del modelo.
"""

from __future__ import annotations

from typing import Any

from src.api.contextual_reasoning.contracts import (
    COMPOSITION_MODES,
    CONTINUITY_TRANSFORMATION_TOKENS,
    FACET_COVERAGE_TOKENS,
    FULL_CLAIM_STATUS_TOKENS,
    INDEPENDENT_OBSERVABLE_SUPPORT_TOKENS,
    MATERIAL_USEFULNESS_TOKENS,
    MISSING_MATERIAL_RELEVANCE_TOKENS,
    OBSERVABILITY_STATUS_TOKENS,
    RELATION_TOKENS,
    SHIFT_REASON_TOKENS,
    WEAKER_SEARCH_STATUS_TOKENS,
    YES_NO_UNRESOLVED_TOKENS,
)

_STRING_ARRAY: dict[str, Any] = {"type": "array", "items": {"type": "string"}}

_EVALUATED_EVIDENCE: dict[str, Any] = {
    "type": "object",
    "properties": {
        "evidenceUnitId": {"type": "string"},
        "relation": {"type": "string", "enum": list(RELATION_TOKENS)},
        # Referencias a qualifiers MATERIALES del Requirement en curso. La
        # identidad real es (requirementId, qualifierId): el requirementId lo
        # aporta la llamada, no el modelo.
        "supportedQualifierIds": _STRING_ARRAY,
        "missingQualifierIds": _STRING_ARRAY,
        "evidenceContribution": {"type": "string"},
        "rationale": {"type": "string"},
    },
    "required": [
        "evidenceUnitId",
        "relation",
        "supportedQualifierIds",
        "missingQualifierIds",
        "evidenceContribution",
        "rationale",
    ],
    "additionalProperties": False,
}

_REQUIREMENT_BASIS_RANGE: dict[str, Any] = {
    "type": "object",
    "properties": {
        "startTokenIndex": {"type": "integer"},
        "endTokenIndexExclusive": {"type": "integer"},
    },
    "required": ["startTokenIndex", "endTokenIndexExclusive"],
    "additionalProperties": False,
}

#: Rango SEMIABIERTO sobre la vista indexada. El schema solo puede exigir la
#: forma; que el rango exista dentro del Requirement lo comprueba el servidor.
_REQUIREMENT_BASIS_RANGES: dict[str, Any] = {
    "type": "array",
    "items": _REQUIREMENT_BASIS_RANGE,
}

_FACET: dict[str, Any] = {
    "type": "object",
    "properties": {
        # LOCAL al Requirement. No hay id global de facet en el contrato
        # productivo: con granularidad por Requirement no hace falta uno.
        "localFacetKey": {"type": "string"},
        "facetText": {"type": "string"},
        # P2.4: el modelo YA NO escribe la cita. Elige posiciones sobre la
        # vista indexada del Requirement y el servidor recorta el texto. La
        # literalidad pasa a ser estructural en vez de instruida.
        "requirementBasisRanges": _REQUIREMENT_BASIS_RANGES,
        "whyNecessary": {"type": "string"},
        "essential": {"type": "boolean"},
        "coverage": {"type": "string", "enum": list(FACET_COVERAGE_TOKENS)},
        "evidenceUnitIds": _STRING_ARRAY,
        "rationale": {"type": "string"},
    },
    "required": [
        "localFacetKey",
        "facetText",
        "requirementBasisRanges",
        "whyNecessary",
        "essential",
        "coverage",
        "evidenceUnitIds",
        "rationale",
    ],
    "additionalProperties": False,
}

_COMPOSITION: dict[str, Any] = {
    "type": "object",
    "properties": {
        "mode": {"type": "string", "enum": list(COMPOSITION_MODES)},
        "nonRedundantEvidenceUnitIds": _STRING_ARRAY,
        "jointlySupportsFullRequirement": {"type": "boolean"},
        "integrationRequired": {"type": "boolean"},
        "integrationDemonstrated": {"type": "boolean"},
        "integrationEvidenceIds": _STRING_ARRAY,
        "missingFacetLocalKeys": _STRING_ARRAY,
        "unresolved": {"type": "boolean"},
        "rationale": {"type": "string"},
    },
    "required": [
        "mode",
        "nonRedundantEvidenceUnitIds",
        "jointlySupportsFullRequirement",
        "integrationRequired",
        "integrationDemonstrated",
        "integrationEvidenceIds",
        "missingFacetLocalKeys",
        "unresolved",
        "rationale",
    ],
    "additionalProperties": False,
}

_FULL_CLAIM: dict[str, Any] = {
    "type": "object",
    "properties": {
        "status": {"type": "string", "enum": list(FULL_CLAIM_STATUS_TOKENS)},
        "supportedQualifierIds": _STRING_ARRAY,
        "missingQualifierIds": _STRING_ARRAY,
        "coveredFacetLocalKeys": _STRING_ARRAY,
        "missingFacetLocalKeys": _STRING_ARRAY,
        "rationale": {"type": "string"},
    },
    "required": [
        "status",
        "supportedQualifierIds",
        "missingQualifierIds",
        "coveredFacetLocalKeys",
        "missingFacetLocalKeys",
        "rationale",
    ],
    "additionalProperties": False,
}

_JOINT_CEILING: dict[str, Any] = {
    "type": "object",
    "properties": {
        "text": {"type": "string"},
        "supportingEvidenceUnitIds": _STRING_ARRAY,
    },
    "required": ["text", "supportingEvidenceUnitIds"],
    "additionalProperties": False,
}

_OBSERVABILITY: dict[str, Any] = {
    "type": "object",
    "properties": {
        "incompleteSourceAssessments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "sourceId": {"type": "string"},
                    "affectedRequirementElements": _STRING_ARRAY,
                    "missingMaterialRelevance": {
                        "type": "string",
                        "enum": list(MISSING_MATERIAL_RELEVANCE_TOKENS),
                    },
                    "rationale": {"type": "string"},
                },
                "required": [
                    "sourceId",
                    "affectedRequirementElements",
                    "missingMaterialRelevance",
                    "rationale",
                ],
                "additionalProperties": False,
            },
        },
        "independentObservableSupport": {
            "type": "string",
            "enum": list(INDEPENDENT_OBSERVABLE_SUPPORT_TOKENS),
        },
        "observabilityStatus": {
            "type": "string",
            "enum": list(OBSERVABILITY_STATUS_TOKENS),
        },
        "rationale": {"type": "string"},
    },
    "required": [
        "incompleteSourceAssessments",
        "independentObservableSupport",
        "observabilityStatus",
        "rationale",
    ],
    "additionalProperties": False,
}

_CONTINUITY: dict[str, Any] = {
    "type": "object",
    "properties": {
        "status": {"type": "string", "enum": list(YES_NO_UNRESOLVED_TOKENS)},
        "transformation": {
            "type": "string",
            "enum": list(CONTINUITY_TRANSFORMATION_TOKENS),
        },
        # P2.4: mismo anclaje determinista que en las facets. Es la MISMA
        # invariante —cita literal del Requirement— y tenia el mismo modo de
        # fallo (`contextual_continuity_basis_not_literal`).
        "requirementBasisRanges": _REQUIREMENT_BASIS_RANGES,
        "constitutiveProjection": {"type": "string"},
        "explicitlyRelaxed": _STRING_ARRAY,
        "externalTargetIntroduced": {
            "type": "string",
            "enum": list(YES_NO_UNRESOLVED_TOKENS),
        },
        "shiftReason": {
            "type": ["string", "null"],
            "enum": [*SHIFT_REASON_TOKENS, None],
        },
        "rationale": {"type": "string"},
    },
    "required": [
        "status",
        "transformation",
        "requirementBasisRanges",
        "constitutiveProjection",
        "explicitlyRelaxed",
        "externalTargetIntroduced",
        "shiftReason",
        "rationale",
    ],
    "additionalProperties": False,
}

_WEAKER_CANDIDATE: dict[str, Any] = {
    "type": "object",
    "properties": {
        "text": {"type": "string"},
        "supportingEvidenceUnitIds": _STRING_ARRAY,
        "derivedFromJointClaimCeiling": {
            "type": "string",
            "enum": list(YES_NO_UNRESOLVED_TOKENS),
        },
        "droppedQualifierIds": _STRING_ARRAY,
        "droppedFacetLocalKeys": _STRING_ARRAY,
        "continuityAssessment": _CONTINUITY,
        "materialUsefulness": {
            "type": "string",
            "enum": list(MATERIAL_USEFULNESS_TOKENS),
        },
        "usefulnessRationale": {"type": "string"},
    },
    "required": [
        "text",
        "supportingEvidenceUnitIds",
        "derivedFromJointClaimCeiling",
        "droppedQualifierIds",
        "droppedFacetLocalKeys",
        "continuityAssessment",
        "materialUsefulness",
        "usefulnessRationale",
    ],
    "additionalProperties": False,
}

_WEAKER_SEARCH: dict[str, Any] = {
    "type": "object",
    "properties": {
        "status": {"type": "string", "enum": list(WEAKER_SEARCH_STATUS_TOKENS)},
        "rationale": {"type": "string"},
        # DELTA_A: `candidate` obligatorio si y solo si el status es FOUND. La
        # consistencia se verifica en el validador, no en el schema.
        "candidate": {"anyOf": [_WEAKER_CANDIDATE, {"type": "null"}]},
    },
    "required": ["status", "rationale", "candidate"],
    "additionalProperties": False,
}

CONTEXTUAL_REASONING_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "requirementId": {"type": "string"},
        "evaluatedEvidence": {"type": "array", "items": _EVALUATED_EVIDENCE},
        "facets": {"type": "array", "items": _FACET},
        "compositionAssessment": _COMPOSITION,
        "fullClaimAssessment": _FULL_CLAIM,
        "jointClaimCeiling": _JOINT_CEILING,
        "observabilityAssessment": _OBSERVABILITY,
        "weakerClaimSearch": _WEAKER_SEARCH,
        "semanticUnresolved": {"type": "boolean"},
        "unresolvedReason": {"type": "string"},
    },
    "required": [
        "requirementId",
        "evaluatedEvidence",
        "facets",
        "compositionAssessment",
        "fullClaimAssessment",
        "jointClaimCeiling",
        "observabilityAssessment",
        "weakerClaimSearch",
        "semanticUnresolved",
        "unresolvedReason",
    ],
    "additionalProperties": False,
}

CONTEXTUAL_REASONING_SCHEMA_NAME = "product_contextual_reasoning"
