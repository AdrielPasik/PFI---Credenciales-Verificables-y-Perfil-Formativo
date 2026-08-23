from __future__ import annotations

from copy import deepcopy
from typing import Any

from .b21_artifacts import validation
from .b21_policy import derive_resolution_closure

def _valid(ids: list[str], allowed: set[str]) -> bool:
    return len(ids) == len(set(ids)) and set(ids) <= allowed

def validate_and_enrich_reasoning(raw: dict[str, Any], requirement: dict[str, Any], evidence_units: list[dict[str, Any]], redundancy_groups: list[list[str]], inherited: list[dict[str, Any]]) -> tuple[dict[str, Any], list[dict[str, Any]], bool]:
    artifact, results = deepcopy(raw), []
    requirement_id, eu_ids = requirement["requirementId"], {item["evidenceUnitId"] for item in evidence_units}
    qualifier_ids = {item["qualifierId"] for item in requirement["materialQualifiers"]}
    results.append(validation("HARD_FACTUAL_INVARIANT", "REQUIREMENT_ID_EXISTS", "PASS" if artifact["requirementId"] == requirement_id else "FAIL", requirement_id, artifact["requirementId"], affects_epistemic_state=artifact["requirementId"] != requirement_id))
    evaluated_ids = [item["evidenceUnitId"] for item in artifact["evaluatedEvidence"]]
    results.append(validation("HARD_FACTUAL_INVARIANT", "EVALUATED_EVIDENCE_IDS_EXIST", "PASS" if _valid(evaluated_ids, eu_ids) else "FAIL", requirement_id, str(evaluated_ids), affects_epistemic_state=not _valid(evaluated_ids, eu_ids)))
    artifact["evaluatedEvidence"] = [item for item in artifact["evaluatedEvidence"] if item["evidenceUnitId"] in eu_ids]
    qualifier_fields = []
    for item in artifact["evaluatedEvidence"]:
        qualifier_fields.extend([item["supportedQualifierIds"], item["missingQualifierIds"]])
    qualifier_fields.extend([artifact["fullClaimAssessment"]["supportedQualifierIds"], artifact["fullClaimAssessment"]["missingQualifierIds"]])
    if artifact["weakerClaimCandidate"]:
        qualifier_fields.append(artifact["weakerClaimCandidate"]["droppedQualifierIds"])
    qualifier_valid = all(_valid(field, qualifier_ids) for field in qualifier_fields)
    results.append(validation("HARD_FACTUAL_INVARIANT", "QUALIFIER_ROLES_SEMANTIC_REFS", "PASS" if qualifier_valid else "FAIL", requirement_id, str(qualifier_fields), affects_epistemic_state=not qualifier_valid))
    facets, keys = artifact["facets"], [item["localFacetKey"] for item in artifact["facets"]]
    allowed_basis = {"continuityCore", *qualifier_ids}
    for index, facet in enumerate(facets, 1):
        facet["facetId"] = f"{requirement_id}_facet_{index:02d}"
        good_basis = _valid(facet["requirementBasisRefs"], allowed_basis) and not any(ref.startswith("eu_") for ref in facet["requirementBasisRefs"])
        good_eu = _valid(facet["evidenceUnitIds"], eu_ids)
        results.append(validation("HARD_FACTUAL_INVARIANT", "FACET_BASIS_REQUIREMENT_ONLY", "PASS" if good_basis else "FAIL", facet["facetId"], str(facet["requirementBasisRefs"]), affects_epistemic_state=not good_basis))
        results.append(validation("HARD_FACTUAL_INVARIANT", "FACET_EVIDENCE_IDS_EXIST", "PASS" if good_eu else "FAIL", facet["facetId"], str(facet["evidenceUnitIds"]), affects_epistemic_state=not good_eu))
    refs = artifact["compositionAssessment"]["missingFacetKeys"] + artifact["fullClaimAssessment"]["coveredFacetKeys"] + artifact["fullClaimAssessment"]["missingFacetKeys"] + ((artifact["weakerClaimCandidate"] or {}).get("droppedFacetKeys", []))
    facets_valid = len(keys) == len(set(keys)) and _valid(refs, set(keys)) and (bool(facets) or not refs)
    results.append(validation("HARD_FACTUAL_INVARIANT", "FACET_REFERENCES_EXIST", "PASS" if facets_valid else "FAIL", requirement_id, str(refs), affects_epistemic_state=not facets_valid))
    local_to_id = {item["localFacetKey"]: item["facetId"] for item in facets}
    for field in (artifact["compositionAssessment"], artifact["fullClaimAssessment"]):
        for key in ("missingFacetKeys", "coveredFacetKeys"):
            if key in field:
                field[key.replace("Keys", "Ids")] = [local_to_id[item] for item in field.pop(key)] if facets_valid else []
    weaker = artifact["weakerClaimCandidate"]
    if weaker:
        weaker["droppedFacetIds"] = [local_to_id[item] for item in weaker.pop("droppedFacetKeys")] if facets_valid else []
    semantic_eu_fields = [artifact["compositionAssessment"]["nonRedundantEvidenceUnitIds"], artifact["compositionAssessment"]["integrationEvidenceIds"], artifact["jointClaimCeiling"]["supportingEvidenceUnitIds"], artifact["observableSupport"]["supportingEvidenceUnitIds"]] + ([weaker["supportingEvidenceUnitIds"]] if weaker else [])
    semantic_eu_valid = all(_valid(field, eu_ids) for field in semantic_eu_fields)
    results.append(validation("HARD_FACTUAL_INVARIANT", "SEMANTIC_EVIDENCE_IDS_EXIST", "PASS" if semantic_eu_valid else "FAIL", requirement_id, "semantic refs", affects_epistemic_state=not semantic_eu_valid))
    closure = derive_resolution_closure(artifact["observableSupport"])
    artifact["resolutionClosure"] = closure
    closure_valid = not (artifact["observableSupport"]["missingMaterialCouldChangeFinalState"] == "YES" and closure == "CLOSED")
    results.append(validation("HARD_FACTUAL_INVARIANT", "RESOLUTION_CLOSURE_COHERENT", "PASS" if closure_valid else "FAIL", requirement_id, closure, affects_epistemic_state=not closure_valid))
    for facet in facets:
        results.append(validation("SEMANTIC_CONSISTENCY", "FACET_EVIDENCE_FITTING", "MANUAL_ADJUDICATION_REQUIRED", facet["facetId"], facet["requirementBasis"], affects_epistemic_state=False))
    results.append(validation("SEMANTIC_CONSISTENCY", "REQUIREMENT_SEMANTIC_PRESERVATION", "MANUAL_ADJUDICATION_REQUIRED", requirement_id, requirement["continuityCore"]["statement"], affects_epistemic_state=False))
    hard = any(item["taxonomy"] == "HARD_FACTUAL_INVARIANT" and item["status"] in {"FAIL", "REJECTED"} and item["affectsEpistemicState"] for item in [*inherited, *results])
    artifact["exactRedundancyGroups"] = redundancy_groups
    artifact["facetEvidenceFitting"] = "MANUAL_ADJUDICATION_REQUIRED"
    return artifact, results, hard
