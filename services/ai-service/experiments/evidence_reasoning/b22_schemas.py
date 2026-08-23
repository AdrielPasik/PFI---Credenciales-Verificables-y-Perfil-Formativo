from __future__ import annotations

from copy import deepcopy
from typing import Any

from jsonschema import Draft202012Validator

from .b2_schemas import EVIDENCE_UNIT_CATALOG_PROPOSAL_SCHEMA
from .schemas import RELATIONS


STRING_ARRAY = {"type": "array", "items": {"type": "string"}}

QUALIFIER = {
    "type": "object",
    "properties": {
        "kind": {"type": "string"}, "value": {"type": "string"}, "sourcePhrase": {"type": "string"},
        "role": {"type": "string", "enum": ["MATERIAL_QUALIFIER", "CONTEXTUAL", "STRUCTURAL_WRAPPER"]},
        "rationale": {"type": "string"},
    },
    "required": ["kind", "value", "sourcePhrase", "role", "rationale"], "additionalProperties": False,
}

IDENTITY_ELEMENT = {
    "type": "object",
    "properties": {
        "role": {"type": "string", "enum": ["ACTION_PREDICATE", "OBJECT", "DOMAIN", "REQUIRED_CONTEXT", "OTHER_IDENTITY"]},
        "basisPhrases": STRING_ARRAY, "normalizedMeaning": {"type": "string"}, "materialQualifierPhrases": STRING_ARRAY,
    },
    "required": ["role", "basisPhrases", "normalizedMeaning", "materialQualifierPhrases"], "additionalProperties": False,
}

IDENTITY_BINDING = {
    "type": "object",
    "properties": {"fromElementIndex": {"type": "integer", "minimum": 0}, "relation": {"type": "string"}, "toElementIndex": {"type": "integer", "minimum": 0}},
    "required": ["fromElementIndex", "relation", "toElementIndex"], "additionalProperties": False,
}

REQUIREMENT = {
    "type": "object",
    "properties": {
        "requirementQuote": {"type": "string"}, "normalizedRequirement": {"type": "string"},
        "atomicity": {"type": "string", "enum": ["ATOMIC", "NEEDS_SPLIT", "UNRESOLVED"]},
        "evaluability": {
            "type": "object", "properties": {
                "requiredEvidenceType": {"type": "string", "enum": ["FORMATIVE_EVIDENCE", "PROFESSIONAL_HISTORY", "PERSONAL_OR_ADMINISTRATIVE_FACT", "BEHAVIORAL_PERFORMANCE", "UNRESOLVED"]},
                "formativeEvidenceCapable": {"type": "boolean"}, "rationale": {"type": "string"},
            }, "required": ["requiredEvidenceType", "formativeEvidenceCapable", "rationale"], "additionalProperties": False,
        },
        "qualifiers": {"type": "array", "items": QUALIFIER},
        "identityFrame": {"type": "object", "properties": {"identityElements": {"type": "array", "items": IDENTITY_ELEMENT}, "bindings": {"type": "array", "items": IDENTITY_BINDING}}, "required": ["identityElements", "bindings"], "additionalProperties": False},
    },
    "required": ["requirementQuote", "normalizedRequirement", "atomicity", "evaluability", "qualifiers", "identityFrame"], "additionalProperties": False,
}

OBJECTIVE_SCHEMA: dict[str, Any] = {
    "type": "object", "properties": {
        "decompositionStatus": {"type": "string", "enum": ["RESOLVED", "AMBIGUOUS"]}, "objectiveContext": {"type": "string"},
        "candidateSegments": {"type": "array", "items": {"type": "object", "properties": {"text": {"type": "string"}, "segmentRole": {"type": "string", "enum": ["OBJECTIVE_CONTEXT", "EVALUABLE_REQUIREMENT", "STRUCTURAL_WRAPPER"]}, "rationale": {"type": "string"}}, "required": ["text", "segmentRole", "rationale"], "additionalProperties": False}},
        "ambiguityRationale": {"type": "string"}, "requirements": {"type": "array", "items": REQUIREMENT},
    },
    "required": ["decompositionStatus", "objectiveContext", "candidateSegments", "ambiguityRationale", "requirements"], "additionalProperties": False,
}

EVALUATED_EVIDENCE = {
    "type": "object", "properties": {"evidenceUnitId": {"type": "string"}, "relation": {"type": "string", "enum": RELATIONS}, "supportedQualifierIds": STRING_ARRAY, "missingQualifierIds": STRING_ARRAY, "evidenceContribution": {"type": "string"}, "rationale": {"type": "string"}},
    "required": ["evidenceUnitId", "relation", "supportedQualifierIds", "missingQualifierIds", "evidenceContribution", "rationale"], "additionalProperties": False,
}
FACET = {
    "type": "object", "properties": {"localFacetKey": {"type": "string"}, "facetText": {"type": "string"}, "requirementBasisPhrases": STRING_ARRAY, "whyNecessary": {"type": "string"}, "essential": {"type": "boolean"}, "coverage": {"type": "string", "enum": ["FULL", "PARTIAL", "NONE"]}, "evidenceUnitIds": STRING_ARRAY, "rationale": {"type": "string"}},
    "required": ["localFacetKey", "facetText", "requirementBasisPhrases", "whyNecessary", "essential", "coverage", "evidenceUnitIds", "rationale"], "additionalProperties": False,
}
WEAKER = {
    "type": "object", "properties": {
        "text": {"type": "string"}, "supportingEvidenceUnitIds": STRING_ARRAY,
        "derivedFromJointClaimCeiling": {"type": "string", "enum": ["YES", "NO", "UNRESOLVED"]},
        "preservedIdentityElementIds": STRING_ARRAY, "relaxedIdentityElementIds": STRING_ARRAY, "changedIdentityElementIds": STRING_ARRAY,
        "droppedQualifierIds": STRING_ARRAY, "droppedFacetLocalKeys": STRING_ARRAY,
        "sameRequirementContinuity": {"type": "string", "enum": ["YES", "NO", "UNRESOLVED"]}, "continuityRationale": {"type": "string"},
        "materialUsefulness": {"type": "string", "enum": ["YES", "NO", "UNRESOLVED"]}, "usefulnessRationale": {"type": "string"},
    },
    "required": ["text", "supportingEvidenceUnitIds", "derivedFromJointClaimCeiling", "preservedIdentityElementIds", "relaxedIdentityElementIds", "changedIdentityElementIds", "droppedQualifierIds", "droppedFacetLocalKeys", "sameRequirementContinuity", "continuityRationale", "materialUsefulness", "usefulnessRationale"], "additionalProperties": False,
}
INCOMPLETE = {
    "type": "object", "properties": {"sourceId": {"type": "string"}, "affectedRequirementElementIds": STRING_ARRAY, "missingMaterialRelevance": {"type": "string", "enum": ["RELEVANT", "NOT_RELEVANT", "UNRESOLVED"]}, "rationale": {"type": "string"}},
    "required": ["sourceId", "affectedRequirementElementIds", "missingMaterialRelevance", "rationale"], "additionalProperties": False,
}
UNIFIED_SCHEMA: dict[str, Any] = {
    "type": "object", "properties": {
        "requirementId": {"type": "string"}, "evaluatedEvidence": {"type": "array", "items": EVALUATED_EVIDENCE}, "facets": {"type": "array", "items": FACET},
        "compositionAssessment": {"type": "object", "properties": {"mode": {"type": "string", "enum": ["NONE", "COMPLEMENTARY_COVERAGE", "INTEGRATED_CAPABILITY"]}, "nonRedundantEvidenceUnitIds": STRING_ARRAY, "jointlySupportsFullRequirement": {"type": "boolean"}, "integrationRequired": {"type": "boolean"}, "integrationDemonstrated": {"type": "boolean"}, "integrationEvidenceIds": STRING_ARRAY, "missingFacetLocalKeys": STRING_ARRAY, "unresolved": {"type": "boolean"}, "rationale": {"type": "string"}}, "required": ["mode", "nonRedundantEvidenceUnitIds", "jointlySupportsFullRequirement", "integrationRequired", "integrationDemonstrated", "integrationEvidenceIds", "missingFacetLocalKeys", "unresolved", "rationale"], "additionalProperties": False},
        "fullClaimAssessment": {"type": "object", "properties": {"status": {"type": "string", "enum": ["REACHED", "NOT_REACHED", "UNRESOLVED"]}, "supportedQualifierIds": STRING_ARRAY, "missingQualifierIds": STRING_ARRAY, "coveredFacetLocalKeys": STRING_ARRAY, "missingFacetLocalKeys": STRING_ARRAY, "rationale": {"type": "string"}}, "required": ["status", "supportedQualifierIds", "missingQualifierIds", "coveredFacetLocalKeys", "missingFacetLocalKeys", "rationale"], "additionalProperties": False},
        "jointClaimCeiling": {"type": "object", "properties": {"text": {"type": "string"}, "supportingEvidenceUnitIds": STRING_ARRAY}, "required": ["text", "supportingEvidenceUnitIds"], "additionalProperties": False},
        "weakerClaimCandidate": {"anyOf": [WEAKER, {"type": "null"}]},
        "observabilityAssessment": {"type": "object", "properties": {"incompleteSourceAssessments": {"type": "array", "items": INCOMPLETE}, "independentObservableSupport": {"type": "string", "enum": ["FULL_CLAIM", "WEAKER_CLAIM", "NONE", "UNRESOLVED"]}, "observabilityStatus": {"type": "string", "enum": ["SUFFICIENT", "MATERIAL_GAP", "UNRESOLVED"]}, "rationale": {"type": "string"}}, "required": ["incompleteSourceAssessments", "independentObservableSupport", "observabilityStatus", "rationale"], "additionalProperties": False},
        "semanticUnresolved": {"type": "boolean"}, "unresolvedReason": {"type": "string"},
    },
    "required": ["requirementId", "evaluatedEvidence", "facets", "compositionAssessment", "fullClaimAssessment", "jointClaimCeiling", "weakerClaimCandidate", "observabilityAssessment", "semanticUnresolved", "unresolvedReason"], "additionalProperties": False,
}

B22_SCHEMAS = {"b22_evidence_unit_catalog": EVIDENCE_UNIT_CATALOG_PROPOSAL_SCHEMA, "b22_objective_analysis": OBJECTIVE_SCHEMA, "b22_unified_reasoning": UNIFIED_SCHEMA}

def validate_b22_schema(name: str, payload: dict[str, Any]) -> None:
    errors = sorted(Draft202012Validator(B22_SCHEMAS[name]).iter_errors(payload), key=lambda error: list(error.path))
    if errors:
        raise ValueError("invalid_" + name + "_schema: " + "; ".join(f"{list(error.path)}: {error.message}" for error in errors[:8]))

def b22_schema_for_provider(name: str) -> dict[str, Any]:
    return deepcopy(B22_SCHEMAS[name])
