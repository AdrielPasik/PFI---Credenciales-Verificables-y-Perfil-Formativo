from __future__ import annotations

from copy import deepcopy
from typing import Any

from jsonschema import Draft202012Validator

from .b2_schemas import EVIDENCE_UNIT_CATALOG_PROPOSAL_SCHEMA
from .b24_versions import (
    CONTINUITY_TRANSFORMATIONS,
    EPISTEMIC_TARGETS,
    WEAKER_SEARCH_STATUSES,
)
from .schemas import RELATIONS

STRINGS = {"type": "array", "items": {"type": "string"}}

QUALIFIER = {
    "type": "object",
    "properties": {
        "kind": {"type": "string"},
        "value": {"type": "string"},
        "sourcePhrase": {"type": "string"},
        "role": {"type": "string", "enum": ["MATERIAL_QUALIFIER", "CONTEXTUAL", "STRUCTURAL_WRAPPER"]},
        "rationale": {"type": "string"},
    },
    "required": ["kind", "value", "sourcePhrase", "role", "rationale"],
    "additionalProperties": False,
}

# DELTA_C: epistemicTarget is produced here, by evidence-blind Objective Analysis,
# and frozen for the run. normalizedRequirement is auxiliary paraphrase only.
REQUIREMENT = {
    "type": "object",
    "properties": {
        "requirementQuote": {"type": "string"},
        "normalizedRequirement": {"type": "string"},
        "epistemicTarget": {"type": "string", "enum": EPISTEMIC_TARGETS},
        "epistemicTargetRationale": {"type": "string"},
        "atomicity": {"type": "string", "enum": ["ATOMIC", "NEEDS_SPLIT", "UNRESOLVED"]},
        "evaluability": {
            "type": "object",
            "properties": {
                "requiredEvidenceType": {
                    "type": "string",
                    "enum": [
                        "FORMATIVE_EVIDENCE",
                        "PROFESSIONAL_HISTORY",
                        "PERSONAL_OR_ADMINISTRATIVE_FACT",
                        "BEHAVIORAL_PERFORMANCE",
                        "UNRESOLVED",
                    ],
                },
                "formativeEvidenceCapable": {"type": "boolean"},
                "rationale": {"type": "string"},
            },
            "required": ["requiredEvidenceType", "formativeEvidenceCapable", "rationale"],
            "additionalProperties": False,
        },
        "qualifiers": {"type": "array", "items": QUALIFIER},
    },
    "required": [
        "requirementQuote",
        "normalizedRequirement",
        "epistemicTarget",
        "epistemicTargetRationale",
        "atomicity",
        "evaluability",
        "qualifiers",
    ],
    "additionalProperties": False,
}

OBJECTIVE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "decompositionStatus": {"type": "string", "enum": ["RESOLVED", "AMBIGUOUS"]},
        "objectiveContext": {"type": "string"},
        "candidateSegments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "segmentRole": {
                        "type": "string",
                        "enum": ["OBJECTIVE_CONTEXT", "EVALUABLE_REQUIREMENT", "STRUCTURAL_WRAPPER"],
                    },
                    "rationale": {"type": "string"},
                },
                "required": ["text", "segmentRole", "rationale"],
                "additionalProperties": False,
            },
        },
        "ambiguityRationale": {"type": "string"},
        "requirements": {"type": "array", "items": REQUIREMENT},
    },
    "required": [
        "decompositionStatus",
        "objectiveContext",
        "candidateSegments",
        "ambiguityRationale",
        "requirements",
    ],
    "additionalProperties": False,
}

EVALUATED = {
    "type": "object",
    "properties": {
        "evidenceUnitId": {"type": "string"},
        "relation": {"type": "string", "enum": RELATIONS},
        "supportedQualifierIds": STRINGS,
        "missingQualifierIds": STRINGS,
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

FACET = {
    "type": "object",
    "properties": {
        "localFacetKey": {"type": "string"},
        "facetText": {"type": "string"},
        "requirementBasisPhrases": STRINGS,
        "whyNecessary": {"type": "string"},
        "essential": {"type": "boolean"},
        "coverage": {"type": "string", "enum": ["FULL", "PARTIAL", "NONE"]},
        "evidenceUnitIds": STRINGS,
        "rationale": {"type": "string"},
    },
    "required": [
        "localFacetKey",
        "facetText",
        "requirementBasisPhrases",
        "whyNecessary",
        "essential",
        "coverage",
        "evidenceUnitIds",
        "rationale",
    ],
    "additionalProperties": False,
}

# DELTA_B: transformation vocabulary is CONSTITUTIVE_REDUCTION vs SEMANTIC_SHIFT.
# DELTA_D: requirementBasisPhrases must be literal phrases of requirementQuote;
# the deterministic aligner — never the model — produces authoritative spans.
CONTINUITY = {
    "type": "object",
    "properties": {
        "status": {"type": "string", "enum": ["YES", "NO", "UNRESOLVED"]},
        "transformation": {"type": "string", "enum": CONTINUITY_TRANSFORMATIONS},
        "requirementBasisPhrases": STRINGS,
        "constitutiveProjection": {"type": "string"},
        "explicitlyRelaxed": STRINGS,
        "externalTargetIntroduced": {"type": "string", "enum": ["YES", "NO", "UNRESOLVED"]},
        "shiftReason": {
            "type": ["string", "null"],
            "enum": ["PREREQUISITE_OR_FOUNDATION", "NEIGHBOR_OR_SUBSTITUTION", "OTHER", None],
        },
        "rationale": {"type": "string"},
    },
    "required": [
        "status",
        "transformation",
        "requirementBasisPhrases",
        "constitutiveProjection",
        "explicitlyRelaxed",
        "externalTargetIntroduced",
        "shiftReason",
        "rationale",
    ],
    "additionalProperties": False,
}

CANDIDATE = {
    "type": "object",
    "properties": {
        "text": {"type": "string"},
        "supportingEvidenceUnitIds": STRINGS,
        "derivedFromJointClaimCeiling": {"type": "string", "enum": ["YES", "NO", "UNRESOLVED"]},
        "droppedQualifierIds": STRINGS,
        "droppedFacetLocalKeys": STRINGS,
        "continuityAssessment": CONTINUITY,
        "materialUsefulness": {"type": "string", "enum": ["YES", "NO", "UNRESOLVED", "NOT_EVALUATED"]},
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

# DELTA_A: the search itself becomes observable. `null` is no longer an opaque
# early exit that conflates "searched and found none" with "never considered".
WEAKER_SEARCH = {
    "type": "object",
    "properties": {
        "status": {"type": "string", "enum": WEAKER_SEARCH_STATUSES},
        "rationale": {"type": "string"},
        "candidate": {"anyOf": [CANDIDATE, {"type": "null"}]},
    },
    "required": ["status", "rationale", "candidate"],
    "additionalProperties": False,
}

INCOMPLETE = {
    "type": "object",
    "properties": {
        "sourceId": {"type": "string"},
        "affectedRequirementElements": STRINGS,
        "missingMaterialRelevance": {"type": "string", "enum": ["RELEVANT", "NOT_RELEVANT", "UNRESOLVED"]},
        "rationale": {"type": "string"},
    },
    "required": ["sourceId", "affectedRequirementElements", "missingMaterialRelevance", "rationale"],
    "additionalProperties": False,
}

UNIFIED_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "requirementId": {"type": "string"},
        "evaluatedEvidence": {"type": "array", "items": EVALUATED},
        "facets": {"type": "array", "items": FACET},
        "compositionAssessment": {
            "type": "object",
            "properties": {
                "mode": {"type": "string", "enum": ["NONE", "COMPLEMENTARY_COVERAGE", "INTEGRATED_CAPABILITY"]},
                "nonRedundantEvidenceUnitIds": STRINGS,
                "jointlySupportsFullRequirement": {"type": "boolean"},
                "integrationRequired": {"type": "boolean"},
                "integrationDemonstrated": {"type": "boolean"},
                "integrationEvidenceIds": STRINGS,
                "missingFacetLocalKeys": STRINGS,
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
        },
        "fullClaimAssessment": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["REACHED", "NOT_REACHED", "UNRESOLVED"]},
                "supportedQualifierIds": STRINGS,
                "missingQualifierIds": STRINGS,
                "coveredFacetLocalKeys": STRINGS,
                "missingFacetLocalKeys": STRINGS,
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
        },
        "jointClaimCeiling": {
            "type": "object",
            "properties": {"text": {"type": "string"}, "supportingEvidenceUnitIds": STRINGS},
            "required": ["text", "supportingEvidenceUnitIds"],
            "additionalProperties": False,
        },
        "observabilityAssessment": {
            "type": "object",
            "properties": {
                "incompleteSourceAssessments": {"type": "array", "items": INCOMPLETE},
                "independentObservableSupport": {
                    "type": "string",
                    "enum": ["FULL_CLAIM", "WEAKER_CLAIM", "NONE", "UNRESOLVED"],
                },
                "observabilityStatus": {"type": "string", "enum": ["SUFFICIENT", "MATERIAL_GAP", "UNRESOLVED"]},
                "rationale": {"type": "string"},
            },
            "required": [
                "incompleteSourceAssessments",
                "independentObservableSupport",
                "observabilityStatus",
                "rationale",
            ],
            "additionalProperties": False,
        },
        "weakerClaimSearch": WEAKER_SEARCH,
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

B24_SCHEMAS = {
    "b24_evidence_unit_catalog": EVIDENCE_UNIT_CATALOG_PROPOSAL_SCHEMA,
    "b24_objective_analysis": OBJECTIVE_SCHEMA,
    "b24_unified_reasoning": UNIFIED_SCHEMA,
}


def validate_b24_schema(name: str, payload: dict[str, Any]) -> None:
    errors = sorted(Draft202012Validator(B24_SCHEMAS[name]).iter_errors(payload), key=lambda error: list(error.path))
    if errors:
        raise ValueError(
            "invalid_" + name + "_schema: " + "; ".join(f"{list(e.path)}: {e.message}" for e in errors[:8])
        )


def b24_schema_for_provider(name: str) -> dict[str, Any]:
    return deepcopy(B24_SCHEMAS[name])
