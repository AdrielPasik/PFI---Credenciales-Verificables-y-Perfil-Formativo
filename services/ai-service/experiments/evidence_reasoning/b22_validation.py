from __future__ import annotations

import re
from copy import deepcopy
from typing import Any

from .b2_aligner import align_quote
from .b2_artifacts import validation


def _unique_existing(ids: list[str], allowed: set[str]) -> bool:
    return len(ids) == len(set(ids)) and set(ids) <= allowed


def _basis_spans(requirement: dict[str, Any], phrases: list[str]) -> tuple[list[dict[str, Any]], list[str]]:
    span = requirement.get("sourceSpan")
    if not span:
        return [], list(phrases)
    objective = requirement["requirementQuote"]
    spans: list[dict[str, Any]] = []; failures: list[str] = []
    for phrase in phrases:
        aligned = align_quote(objective, phrase)
        if aligned.status not in {"EXACT", "REPAIRED"}:
            failures.append(f"{phrase}:{aligned.status}")
        else:
            spans.append({"charStart": int(span["charStart"]) + int(aligned.char_start), "charEnd": int(span["charStart"]) + int(aligned.char_end), "exactText": aligned.exact_text})
    return spans, failures


def _hard(results: list[dict[str, Any]], inherited: list[dict[str, Any]]) -> bool:
    return any(item["taxonomy"] == "HARD_FACTUAL_INVARIANT" and item["status"] in {"FAIL", "REJECTED"} and item["affectsEpistemicState"] for item in [*inherited, *results])


def validate_and_enrich_b22(
    raw: dict[str, Any], requirement: dict[str, Any], evidence_units: list[dict[str, Any]],
    redundancy_groups: list[list[str]], source_facts: list[dict[str, Any]], inherited: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[dict[str, Any]], bool]:
    artifact = deepcopy(raw); results: list[dict[str, Any]] = []; req_id = requirement["requirementId"]
    evidence_ids = {item["evidenceUnitId"] for item in evidence_units}
    qualifier_ids = {item["qualifierId"] for item in requirement["materialQualifiers"] if item["qualifierId"]}
    identity_ids = {item["elementId"] for item in requirement["requirementIdentityFrame"]["identityElements"]}
    source_by_id = {item["sourceId"]: item for item in source_facts}

    matches = artifact["requirementId"] == req_id
    results.append(validation("HARD_FACTUAL_INVARIANT", "REQUIREMENT_ID_EXISTS", "PASS" if matches else "FAIL", req_id, artifact["requirementId"], affects_epistemic_state=not matches))
    evaluated_ids = [item["evidenceUnitId"] for item in artifact["evaluatedEvidence"]]
    valid = _unique_existing(evaluated_ids, evidence_ids)
    results.append(validation("HARD_FACTUAL_INVARIANT", "EVALUATED_EVIDENCE_IDS_EXIST", "PASS" if valid else "FAIL", req_id, str(sorted(set(evaluated_ids)-evidence_ids)), affects_epistemic_state=not valid))
    artifact["evaluatedEvidence"] = [item for item in artifact["evaluatedEvidence"] if item["evidenceUnitId"] in evidence_ids]

    qualifier_fields = [*[item["supportedQualifierIds"] + item["missingQualifierIds"] for item in artifact["evaluatedEvidence"]], artifact["fullClaimAssessment"]["supportedQualifierIds"] + artifact["fullClaimAssessment"]["missingQualifierIds"]]
    weak = artifact["weakerClaimCandidate"]
    if weak: qualifier_fields.append(weak["droppedQualifierIds"])
    qualifiers_valid = all(_unique_existing(ids, qualifier_ids) for ids in qualifier_fields)
    results.append(validation("HARD_FACTUAL_INVARIANT", "MATERIAL_QUALIFIER_IDS_EXIST", "PASS" if qualifiers_valid else "FAIL", req_id, "contextual_or_unknown_qualifier_reference", affects_epistemic_state=not qualifiers_valid))

    # Local contract: definitions must be unique, references may repeat freely.
    facets = artifact["facets"]; local_keys = [facet["localFacetKey"] for facet in facets]
    unique = len(local_keys) == len(set(local_keys))
    results.append(validation("HARD_FACTUAL_INVARIANT", "FACET_LOCAL_KEY_DEFINITIONS_UNIQUE", "PASS" if unique else "FAIL", req_id, str(local_keys), affects_epistemic_state=not unique))
    refs = artifact["compositionAssessment"]["missingFacetLocalKeys"] + artifact["fullClaimAssessment"]["coveredFacetLocalKeys"] + artifact["fullClaimAssessment"]["missingFacetLocalKeys"] + (weak["droppedFacetLocalKeys"] if weak else [])
    refs_valid = (not facets and not refs) or set(refs) <= set(local_keys)
    results.append(validation("HARD_FACTUAL_INVARIANT", "FACET_LOCAL_REFERENCES_EXIST", "PASS" if refs_valid else "FAIL", req_id, str(sorted(set(refs)-set(local_keys))), affects_epistemic_state=not refs_valid))
    facet_map: dict[str, str] = {}
    for index, facet in enumerate(facets, start=1):
        key = facet["localFacetKey"]; facet_id = f"{req_id}_facet_{index:02d}"; facet_map[key] = facet_id; facet["facetId"] = facet_id
        eu_valid = _unique_existing(facet["evidenceUnitIds"], evidence_ids)
        results.append(validation("HARD_FACTUAL_INVARIANT", "FACET_EVIDENCE_IDS_EXIST", "PASS" if eu_valid else "FAIL", facet_id, str(sorted(set(facet["evidenceUnitIds"])-evidence_ids)), affects_epistemic_state=not eu_valid))
        spans, failures = _basis_spans(requirement, facet["requirementBasisPhrases"])
        facet["requirementBasisSpans"] = spans
        basis_valid = bool(spans) and not failures
        results.append(validation("HARD_FACTUAL_INVARIANT", "FACET_BASIS_WITHIN_REQUIREMENT", "PASS" if basis_valid else "FAIL", facet_id, str(failures), affects_epistemic_state=not basis_valid))
        facet["facetEvidenceFitting"] = {"status": "MANUAL_ADJUDICATION_REQUIRED", "automaticCues": ["TRACE_VALID" if basis_valid else "TRACE_INVALID"], "question": "Would this facet remain defensible if EvidenceUnits were hidden?"}
    # Rewrite only after local validation; final artifact contains authoritative references only.
    if unique and refs_valid:
        artifact["compositionAssessment"]["missingFacetIds"] = [facet_map[key] for key in artifact["compositionAssessment"].pop("missingFacetLocalKeys")]
        full = artifact["fullClaimAssessment"]
        full["coveredFacetIds"] = [facet_map[key] for key in full.pop("coveredFacetLocalKeys")]
        full["missingFacetIds"] = [facet_map[key] for key in full.pop("missingFacetLocalKeys")]
        if weak: weak["droppedFacetIds"] = [facet_map[key] for key in weak.pop("droppedFacetLocalKeys")]
        final_refs = artifact["compositionAssessment"]["missingFacetIds"] + full["coveredFacetIds"] + full["missingFacetIds"] + (weak.get("droppedFacetIds", []) if weak else [])
        authoritative_valid = set(final_refs) <= set(facet_map.values())
        results.append(validation("HARD_FACTUAL_INVARIANT", "FACET_AUTHORITATIVE_REFERENCES_EXIST", "PASS" if authoritative_valid else "FAIL", req_id, str(final_refs), affects_epistemic_state=not authoritative_valid))
    else:
        results.append(validation("HARD_FACTUAL_INVARIANT", "FACET_AUTHORITATIVE_REFERENCES_EXIST", "FAIL", req_id, "rewrite_not_permitted_after_local_failure", affects_epistemic_state=True))

    reference_fields = [artifact["compositionAssessment"]["nonRedundantEvidenceUnitIds"], artifact["compositionAssessment"]["integrationEvidenceIds"], artifact["jointClaimCeiling"]["supportingEvidenceUnitIds"]]
    if weak: reference_fields.append(weak["supportingEvidenceUnitIds"])
    ref_valid = all(_unique_existing(ids, evidence_ids) for ids in reference_fields)
    results.append(validation("HARD_FACTUAL_INVARIANT", "SEMANTIC_EVIDENCE_IDS_EXIST", "PASS" if ref_valid else "FAIL", req_id, "unknown_evidence_reference", affects_epistemic_state=not ref_valid))
    if weak:
        identity_valid = all(_unique_existing(weak[field], identity_ids) for field in ("preservedIdentityElementIds", "relaxedIdentityElementIds", "changedIdentityElementIds"))
        results.append(validation("HARD_FACTUAL_INVARIANT", "WEAKER_IDENTITY_REFERENCES_EXIST", "PASS" if identity_valid else "FAIL", req_id, "unknown_identity_reference", affects_epistemic_state=not identity_valid))
        # `derivedFromJointClaimCeiling` is intentionally semantic. No factual guard is derived from its value.
        results.append(validation("SEMANTIC_CONSISTENCY", "WEAKER_DERIVATION_FROM_CEILING", "MANUAL_ADJUDICATION_REQUIRED", req_id, weak["derivedFromJointClaimCeiling"], affects_epistemic_state=False))

    assessment = artifact["observabilityAssessment"]; incomplete_ids = {source_id for source_id, fact in source_by_id.items() if fact["coverageStatus"] in {"PARTIAL", "FAILED"}}
    supplied_sources = [item["sourceId"] for item in assessment["incompleteSourceAssessments"]]
    incomplete_valid = _unique_existing(supplied_sources, incomplete_ids)
    results.append(validation("HARD_FACTUAL_INVARIANT", "INCOMPLETE_SOURCE_ASSESSMENTS_ELIGIBLE", "PASS" if incomplete_valid else "FAIL", req_id, str(sorted(set(supplied_sources)-incomplete_ids)), affects_epistemic_state=not incomplete_valid))
    assess_ids_valid = all(_unique_existing(item["affectedRequirementElementIds"], identity_ids) for item in assessment["incompleteSourceAssessments"])
    results.append(validation("HARD_FACTUAL_INVARIANT", "OBSERVABILITY_IDENTITY_REFERENCES_EXIST", "PASS" if assess_ids_valid else "FAIL", req_id, "unknown_identity_reference", affects_epistemic_state=not assess_ids_valid))
    all_full = bool(source_facts) and not incomplete_ids
    full_consistent = not all_full or (not assessment["incompleteSourceAssessments"] and assessment["observabilityStatus"] != "MATERIAL_GAP")
    results.append(validation("HARD_FACTUAL_INVARIANT", "FULL_SOURCES_NO_MISSING_MATERIAL", "PASS" if full_consistent else "FAIL", req_id, assessment["observabilityStatus"], affects_epistemic_state=not full_consistent))

    positive = artifact["fullClaimAssessment"]["status"] == "REACHED" or bool(weak and weak["sameRequirementContinuity"] == "YES" and weak["materialUsefulness"] == "YES")
    support_ids = set(artifact["jointClaimCeiling"]["supportingEvidenceUnitIds"]) | set(weak["supportingEvidenceUnitIds"] if weak else [])
    grounded = not positive or bool(support_ids & evidence_ids)
    results.append(validation("HARD_FACTUAL_INVARIANT", "POSITIVE_SEMANTICS_HAVE_EVIDENCE", "PASS" if grounded else "FAIL", req_id, str(sorted(support_ids)), affects_epistemic_state=not grounded))
    semantic_text = " ".join([artifact["jointClaimCeiling"]["text"], artifact["fullClaimAssessment"]["rationale"], artifact["compositionAssessment"]["rationale"], *(item["rationale"] for item in artifact["evaluatedEvidence"])])
    inflation = bool(re.search(r"(blockchain|on-chain|issuer_reviewed|verificad[oa]).{0,100}(aument|fortale|mayor soporte|más soporte)", semantic_text, re.I))
    results.append(validation("HARD_FACTUAL_INVARIANT", "PROVENANCE_BLOCKCHAIN_NOT_SEMANTIC_SUPPORT", "PASS" if not inflation else "FAIL", req_id, "trace_context_only", affects_epistemic_state=inflation))
    artifact["exactRedundancyGroups"] = redundancy_groups
    artifact["facetEvidenceFitting"] = "MANUAL_ADJUDICATION_REQUIRED"
    return artifact, results, _hard(results, inherited)
