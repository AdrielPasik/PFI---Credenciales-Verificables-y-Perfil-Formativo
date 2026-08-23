from __future__ import annotations

from copy import deepcopy
from typing import Any

from jsonschema import Draft202012Validator

from .schemas import RELATIONS


SEMANTIC_QUALIFIER = {
    "type": "object",
    "properties": {
        "kind": {"type": "string"},
        "value": {"type": "string"},
    },
    "required": ["kind", "value"],
    "additionalProperties": False,
}

EVIDENCE_UNIT_PROPOSAL = {
    "type": "object",
    "properties": {
        "sourceId": {"type": "string"},
        "segmentId": {"type": "string"},
        "quoteText": {"type": "string"},
        "normalizedProposition": {"type": "string"},
        "claimType": {
            "type": "string",
            "enum": [
                "DECLARED_CONTENT",
                "DECLARED_LEARNING_OUTCOME",
                "ASSESSED_OUTCOME",
                "CREDENTIAL_LEVEL_CLAIM",
            ],
        },
        "semanticQualifiers": {"type": "array", "items": SEMANTIC_QUALIFIER},
    },
    "required": [
        "sourceId",
        "segmentId",
        "quoteText",
        "normalizedProposition",
        "claimType",
        "semanticQualifiers",
    ],
    "additionalProperties": False,
}

EVIDENCE_UNIT_CATALOG_PROPOSAL_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "evidenceUnits": {"type": "array", "items": EVIDENCE_UNIT_PROPOSAL},
    },
    "required": ["evidenceUnits"],
    "additionalProperties": False,
}

MATERIAL_QUALIFIER = {
    "type": "object",
    "properties": {
        "kind": {"type": "string"},
        "value": {"type": "string"},
        "sourcePhrase": {"type": "string"},
        "materiality": {"type": "string", "enum": ["MATERIAL", "NON_MATERIAL"]},
        "rationale": {"type": "string"},
    },
    "required": ["kind", "value", "sourcePhrase", "materiality", "rationale"],
    "additionalProperties": False,
}

OBJECTIVE_ANALYSIS_PROPOSAL_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "objectiveContext": {"type": "string"},
        "requirements": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "properties": {
                    "requirementQuote": {"type": "string"},
                    "normalizedRequirement": {"type": "string"},
                    "evaluationRole": {"type": "string", "enum": ["PRIMARY", "ADDITIONAL"]},
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
                    "materialQualifiers": {"type": "array", "items": MATERIAL_QUALIFIER},
                },
                "required": [
                    "requirementQuote",
                    "normalizedRequirement",
                    "evaluationRole",
                    "atomicity",
                    "evaluability",
                    "materialQualifiers",
                ],
                "additionalProperties": False,
            },
        },
    },
    "required": ["objectiveContext", "requirements"],
    "additionalProperties": False,
}

EVALUATED_EVIDENCE = {
    "type": "object",
    "properties": {
        "evidenceUnitId": {"type": "string"},
        "relation": {"type": "string", "enum": RELATIONS},
        "supportedQualifierIds": {"type": "array", "items": {"type": "string"}},
        "missingQualifierIds": {"type": "array", "items": {"type": "string"}},
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
        "facetText": {"type": "string"},
        "requirementBasis": {"type": "string"},
        "whyNecessary": {"type": "string"},
        "essential": {"type": "boolean"},
        "coverage": {"type": "string", "enum": ["FULL", "PARTIAL", "NONE"]},
        "evidenceUnitIds": {"type": "array", "items": {"type": "string"}},
        "rationale": {"type": "string"},
    },
    "required": [
        "facetText",
        "requirementBasis",
        "whyNecessary",
        "essential",
        "coverage",
        "evidenceUnitIds",
        "rationale",
    ],
    "additionalProperties": False,
}

WEAKER_CLAIM = {
    "type": "object",
    "properties": {
        "text": {"type": "string"},
        "supportingEvidenceUnitIds": {"type": "array", "items": {"type": "string"}},
        "preservedRequirementCore": {"type": "string"},
        "droppedQualifierIds": {"type": "array", "items": {"type": "string"}},
        "droppedFacetTexts": {"type": "array", "items": {"type": "string"}},
        "sameRequirementContinuity": {"type": "string", "enum": ["YES", "NO", "UNRESOLVED"]},
        "continuityRationale": {"type": "string"},
        "materialUsefulness": {"type": "string", "enum": ["YES", "NO", "UNRESOLVED"]},
        "usefulnessRationale": {"type": "string"},
    },
    "required": [
        "text",
        "supportingEvidenceUnitIds",
        "preservedRequirementCore",
        "droppedQualifierIds",
        "droppedFacetTexts",
        "sameRequirementContinuity",
        "continuityRationale",
        "materialUsefulness",
        "usefulnessRationale",
    ],
    "additionalProperties": False,
}

UNIFIED_CONTEXTUAL_REASONING_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "requirementId": {"type": "string"},
        "evaluatedEvidence": {"type": "array", "items": EVALUATED_EVIDENCE},
        "facets": {"type": "array", "items": FACET},
        "compositionAssessment": {
            "type": "object",
            "properties": {
                "mode": {
                    "type": "string",
                    "enum": ["NONE", "COMPLEMENTARY_COVERAGE", "INTEGRATED_CAPABILITY"],
                },
                "nonRedundantEvidenceUnitIds": {"type": "array", "items": {"type": "string"}},
                "jointlySupportsFullRequirement": {"type": "boolean"},
                "integrationRequired": {"type": "boolean"},
                "integrationDemonstrated": {"type": "boolean"},
                "integrationEvidenceIds": {"type": "array", "items": {"type": "string"}},
                "missingFacetTexts": {"type": "array", "items": {"type": "string"}},
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
                "missingFacetTexts",
                "unresolved",
                "rationale",
            ],
            "additionalProperties": False,
        },
        "fullClaimAssessment": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["REACHED", "NOT_REACHED", "UNRESOLVED"]},
                "supportedQualifierIds": {"type": "array", "items": {"type": "string"}},
                "missingQualifierIds": {"type": "array", "items": {"type": "string"}},
                "coveredFacetTexts": {"type": "array", "items": {"type": "string"}},
                "missingFacetTexts": {"type": "array", "items": {"type": "string"}},
                "rationale": {"type": "string"},
            },
            "required": [
                "status",
                "supportedQualifierIds",
                "missingQualifierIds",
                "coveredFacetTexts",
                "missingFacetTexts",
                "rationale",
            ],
            "additionalProperties": False,
        },
        "jointClaimCeiling": {
            "type": "object",
            "properties": {
                "text": {"type": "string"},
                "supportingEvidenceUnitIds": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["text", "supportingEvidenceUnitIds"],
            "additionalProperties": False,
        },
        "weakerClaimCandidate": {"anyOf": [WEAKER_CLAIM, {"type": "null"}]},
        "observabilityAssessment": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["SUFFICIENT", "MATERIAL_GAP", "UNRESOLVED"]},
                "rationale": {"type": "string"},
            },
            "required": ["status", "rationale"],
            "additionalProperties": False,
        },
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
        "weakerClaimCandidate",
        "observabilityAssessment",
        "semanticUnresolved",
        "unresolvedReason",
    ],
    "additionalProperties": False,
}

B2_SCHEMAS = {
    "b2_evidence_unit_catalog": EVIDENCE_UNIT_CATALOG_PROPOSAL_SCHEMA,
    "b2_objective_analysis": OBJECTIVE_ANALYSIS_PROPOSAL_SCHEMA,
    "b2_unified_reasoning": UNIFIED_CONTEXTUAL_REASONING_SCHEMA,
}


def validate_b2_schema(name: str, payload: dict[str, Any]) -> None:
    validator = Draft202012Validator(B2_SCHEMAS[name])
    errors = sorted(validator.iter_errors(payload), key=lambda error: list(error.path))
    if errors:
        rendered = "; ".join(f"{list(error.path)}: {error.message}" for error in errors[:8])
        raise ValueError(f"invalid_{name}_schema: {rendered}")


def b2_schema_for_provider(name: str) -> dict[str, Any]:
    return deepcopy(B2_SCHEMAS[name])
