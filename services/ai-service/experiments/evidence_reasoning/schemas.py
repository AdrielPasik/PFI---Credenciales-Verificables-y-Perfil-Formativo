from __future__ import annotations

from copy import deepcopy
from typing import Any

from jsonschema import Draft202012Validator

FINAL_STATES = [
    "SUPPORTED",
    "PARTIALLY_SUPPORTED",
    "INSUFFICIENT_EVIDENCE",
    "NOT_ASSESSABLE",
    "ABSTAIN",
]
RELATIONS = [
    "DIRECT_SUPPORT",
    "SPECIFIC_SUPPORT",
    "CONTRIBUTORY_SUPPORT",
    "RELATED_NON_ENTAILING",
    "LIMITED_SCOPE",
    "CONFLICTING",
]

SPAN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "charStart": {"type": "integer", "minimum": 0},
        "charEnd": {"type": "integer", "minimum": 0},
        "exactText": {"type": "string"},
    },
    "required": ["charStart", "charEnd", "exactText"],
    "additionalProperties": False,
}

QUALIFIER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "kind": {"type": "string"},
        "value": {"type": "string"},
        "sourceSpan": SPAN_SCHEMA,
    },
    "required": ["kind", "value", "sourceSpan"],
    "additionalProperties": False,
}

EU_PROPOSAL_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "evidenceUnitId": {"type": "string"},
        "sourceId": {"type": "string"},
        "charStart": {"type": "integer", "minimum": 0},
        "charEnd": {"type": "integer", "minimum": 0},
        "exactExcerpt": {"type": "string"},
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
        "qualifiersPresent": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "evidenceUnitId",
        "sourceId",
        "charStart",
        "charEnd",
        "exactExcerpt",
        "normalizedProposition",
        "claimType",
        "qualifiersPresent",
    ],
    "additionalProperties": False,
}

OBJECTIVE_ANALYSIS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "originalObjective": {"type": "string"},
        "requirements": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "properties": {
                    "requirementId": {"type": "string"},
                    "sourceSpan": SPAN_SCHEMA,
                    "normalizedRequirement": {"type": "string"},
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
                    "qualifiers": {"type": "array", "items": QUALIFIER_SCHEMA},
                    "compositionRequired": {"type": "boolean"},
                },
                "required": [
                    "requirementId",
                    "sourceSpan",
                    "normalizedRequirement",
                    "atomicity",
                    "evaluability",
                    "qualifiers",
                    "compositionRequired",
                ],
                "additionalProperties": False,
            },
        },
    },
    "required": ["originalObjective", "requirements"],
    "additionalProperties": False,
}

FACET_PLAN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "requirements": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "requirementId": {"type": "string"},
                    "facets": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "facetId": {"type": "string"},
                                "text": {"type": "string"},
                                "essential": {"type": "boolean"},
                                "requiresIntegration": {"type": "boolean"},
                            },
                            "required": ["facetId", "text", "essential", "requiresIntegration"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["requirementId", "facets"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["requirements"],
    "additionalProperties": False,
}

RELATION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "relations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "requirementId": {"type": "string"},
                    "evidenceUnitId": {"type": "string"},
                    "facetIds": {"type": "array", "items": {"type": "string"}},
                    "relation": {"type": "string", "enum": RELATIONS},
                    "supportedQualifiers": {"type": "array", "items": {"type": "string"}},
                    "unsupportedOrMissingQualifiers": {"type": "array", "items": {"type": "string"}},
                    "individualClaimCeiling": {"type": "string"},
                    "rationale": {"type": "string"},
                    "unresolved": {"type": "boolean"},
                },
                "required": [
                    "requirementId",
                    "evidenceUnitId",
                    "facetIds",
                    "relation",
                    "supportedQualifiers",
                    "unsupportedOrMissingQualifiers",
                    "individualClaimCeiling",
                    "rationale",
                    "unresolved",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["relations"],
    "additionalProperties": False,
}

CEILING_ITEM_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "requirementId": {"type": "string"},
        "claimCeiling": {"type": "string"},
        "supportingEvidenceUnitIds": {"type": "array", "items": {"type": "string"}},
        "supportedQualifiers": {"type": "array", "items": {"type": "string"}},
        "missingQualifiers": {"type": "array", "items": {"type": "string"}},
        "coveredFacetIds": {"type": "array", "items": {"type": "string"}},
        "missingFacetIds": {"type": "array", "items": {"type": "string"}},
        "redundancyGroups": {
            "type": "array",
            "items": {"type": "array", "items": {"type": "string"}, "minItems": 2},
        },
        "bridgeEvidenceUnitIds": {"type": "array", "items": {"type": "string"}},
        "reachesFullRequirement": {"type": "boolean"},
        "hasMateriallyUsefulWeakerClaim": {"type": "boolean"},
        "weakerClaimStillBelongsToRequirement": {"type": "boolean"},
        "unresolved": {"type": "boolean"},
        "semanticRationale": {"type": "string"},
    },
    "required": [
        "requirementId",
        "claimCeiling",
        "supportingEvidenceUnitIds",
        "supportedQualifiers",
        "missingQualifiers",
        "coveredFacetIds",
        "missingFacetIds",
        "redundancyGroups",
        "bridgeEvidenceUnitIds",
        "reachesFullRequirement",
        "hasMateriallyUsefulWeakerClaim",
        "weakerClaimStillBelongsToRequirement",
        "unresolved",
        "semanticRationale",
    ],
    "additionalProperties": False,
}

CEILING_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"requirements": {"type": "array", "items": CEILING_ITEM_SCHEMA}},
    "required": ["requirements"],
    "additionalProperties": False,
}

EU_CATALOG_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"evidenceUnits": {"type": "array", "items": EU_PROPOSAL_SCHEMA}},
    "required": ["evidenceUnits"],
    "additionalProperties": False,
}

B1A_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "objectiveAnalysis": OBJECTIVE_ANALYSIS_SCHEMA,
        "evidenceUnits": {"type": "array", "items": EU_PROPOSAL_SCHEMA},
        "facetPlan": FACET_PLAN_SCHEMA,
        "relations": RELATION_SCHEMA,
        "claimCeilings": CEILING_SCHEMA,
        "finalStates": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "requirementId": {"type": "string"},
                    "finalState": {"type": "string", "enum": FINAL_STATES},
                    "explanation": {"type": "string"},
                },
                "required": ["requirementId", "finalState", "explanation"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["objectiveAnalysis", "evidenceUnits", "facetPlan", "relations", "claimCeilings", "finalStates"],
    "additionalProperties": False,
}

SCHEMAS = {
    "evidence_unit_catalog": EU_CATALOG_SCHEMA,
    "objective_analysis": OBJECTIVE_ANALYSIS_SCHEMA,
    "facet_plan": FACET_PLAN_SCHEMA,
    "relations": RELATION_SCHEMA,
    "claim_ceiling": CEILING_SCHEMA,
    "b1a": B1A_SCHEMA,
}


def validate_schema(name: str, payload: dict[str, Any]) -> None:
    validator = Draft202012Validator(SCHEMAS[name])
    errors = sorted(validator.iter_errors(payload), key=lambda error: list(error.path))
    if errors:
        rendered = "; ".join(f"{list(error.path)}: {error.message}" for error in errors[:8])
        raise ValueError(f"invalid_{name}_schema: {rendered}")


def schema_for_provider(name: str) -> dict[str, Any]:
    return deepcopy(SCHEMAS[name])

