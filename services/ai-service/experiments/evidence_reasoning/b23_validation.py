from __future__ import annotations

import re
from copy import deepcopy
from typing import Any

from .b2_aligner import align_quote
from .b2_artifacts import validation

def _valid(ids: list[str], allowed: set[str]) -> bool: return len(ids) == len(set(ids)) and set(ids) <= allowed
def _hard(results: list[dict[str, Any]], inherited: list[dict[str, Any]]) -> bool: return any(x["taxonomy"] == "HARD_FACTUAL_INVARIANT" and x["status"] in {"FAIL", "REJECTED"} and x["affectsEpistemicState"] for x in [*inherited, *results])
def _basis(requirement: dict[str, Any], phrases: list[str]) -> tuple[list[dict[str, Any]], list[str]]:
    source = requirement.get("sourceSpan"); spans: list[dict[str, Any]] = []; bad: list[str] = []
    if not source: return spans, list(phrases)
    for phrase in phrases:
        found = align_quote(requirement["requirementQuote"], phrase)
        if found.status not in {"EXACT", "REPAIRED"}: bad.append(f"{phrase}:{found.status}")
        else: spans.append({"charStart": source["charStart"] + found.char_start, "charEnd": source["charStart"] + found.char_end, "exactText": found.exact_text})
    return spans, bad

def validate_and_enrich_b23(raw: dict[str, Any], requirement: dict[str, Any], evidence_units: list[dict[str, Any]], redundancy_groups: list[list[str]], source_facts: list[dict[str, Any]], inherited: list[dict[str, Any]]) -> tuple[dict[str, Any], list[dict[str, Any]], bool]:
    artifact = deepcopy(raw); results: list[dict[str, Any]] = []; req_id = requirement["requirementId"]
    evidence_ids = {x["evidenceUnitId"] for x in evidence_units}; qualifier_ids = {x["qualifierId"] for x in requirement["materialQualifiers"] if x["qualifierId"]}; source_by_id = {x["sourceId"]: x for x in source_facts}
    same = artifact["requirementId"] == req_id
    results.append(validation("HARD_FACTUAL_INVARIANT", "REQUIREMENT_ID_EXISTS", "PASS" if same else "FAIL", req_id, artifact["requirementId"], affects_epistemic_state=not same))
    evaluated = [x["evidenceUnitId"] for x in artifact["evaluatedEvidence"]]; ok = _valid(evaluated, evidence_ids)
    results.append(validation("HARD_FACTUAL_INVARIANT", "EVALUATED_EVIDENCE_IDS_EXIST", "PASS" if ok else "FAIL", req_id, str(sorted(set(evaluated) - evidence_ids)), affects_epistemic_state=not ok)); artifact["evaluatedEvidence"] = [x for x in artifact["evaluatedEvidence"] if x["evidenceUnitId"] in evidence_ids]
    qfields = [*[x["supportedQualifierIds"] + x["missingQualifierIds"] for x in artifact["evaluatedEvidence"]], artifact["fullClaimAssessment"]["supportedQualifierIds"] + artifact["fullClaimAssessment"]["missingQualifierIds"]]
    weak = artifact["weakerClaimCandidate"]
    if weak: qfields.append(weak["droppedQualifierIds"])
    qok = all(_valid(x, qualifier_ids) for x in qfields)
    results.append(validation("HARD_FACTUAL_INVARIANT", "MATERIAL_QUALIFIER_IDS_EXIST", "PASS" if qok else "FAIL", req_id, "contextual_or_unknown_qualifier_reference", affects_epistemic_state=not qok))
    facets = artifact["facets"]; keys = [x["localFacetKey"] for x in facets]; unique = len(keys) == len(set(keys))
    results.append(validation("HARD_FACTUAL_INVARIANT", "FACET_LOCAL_KEY_DEFINITIONS_UNIQUE", "PASS" if unique else "FAIL", req_id, str(keys), affects_epistemic_state=not unique))
    refs = artifact["compositionAssessment"]["missingFacetLocalKeys"] + artifact["fullClaimAssessment"]["coveredFacetLocalKeys"] + artifact["fullClaimAssessment"]["missingFacetLocalKeys"] + (weak["droppedFacetLocalKeys"] if weak else [])
    refs_ok = (not facets and not refs) or set(refs) <= set(keys)
    results.append(validation("HARD_FACTUAL_INVARIANT", "FACET_LOCAL_REFERENCES_EXIST", "PASS" if refs_ok else "FAIL", req_id, str(sorted(set(refs) - set(keys))), affects_epistemic_state=not refs_ok))
    fmap: dict[str, str] = {}
    for i, facet in enumerate(facets, 1):
        fid = f"{req_id}_facet_{i:02d}"; fmap[facet["localFacetKey"]] = fid; facet["facetId"] = fid
        eu_ok = _valid(facet["evidenceUnitIds"], evidence_ids); spans, failed = _basis(requirement, facet["requirementBasisPhrases"]); basis_ok = bool(spans) and not failed; facet["requirementBasisSpans"] = spans
        results.append(validation("HARD_FACTUAL_INVARIANT", "FACET_EVIDENCE_IDS_EXIST", "PASS" if eu_ok else "FAIL", fid, str(sorted(set(facet["evidenceUnitIds"]) - evidence_ids)), affects_epistemic_state=not eu_ok))
        results.append(validation("HARD_FACTUAL_INVARIANT", "FACET_BASIS_WITHIN_REQUIREMENT", "PASS" if basis_ok else "FAIL", fid, str(failed), affects_epistemic_state=not basis_ok))
        facet["facetEvidenceFitting"] = {"status": "MANUAL_ADJUDICATION_REQUIRED", "automaticCues": ["TRACE_VALID" if basis_ok else "TRACE_INVALID"], "question": "Would this facet remain defensible if EvidenceUnits were hidden?"}
    if unique and refs_ok:
        comp = artifact["compositionAssessment"]; full = artifact["fullClaimAssessment"]
        comp["missingFacetIds"] = [fmap[x] for x in comp.pop("missingFacetLocalKeys")]; full["coveredFacetIds"] = [fmap[x] for x in full.pop("coveredFacetLocalKeys")]; full["missingFacetIds"] = [fmap[x] for x in full.pop("missingFacetLocalKeys")]
        if weak: weak["droppedFacetIds"] = [fmap[x] for x in weak.pop("droppedFacetLocalKeys")]
        final_refs = comp["missingFacetIds"] + full["coveredFacetIds"] + full["missingFacetIds"] + (weak.get("droppedFacetIds", []) if weak else [])
        results.append(validation("HARD_FACTUAL_INVARIANT", "FACET_AUTHORITATIVE_REFERENCES_EXIST", "PASS" if set(final_refs) <= set(fmap.values()) else "FAIL", req_id, str(final_refs), affects_epistemic_state=not set(final_refs) <= set(fmap.values())))
    else: results.append(validation("HARD_FACTUAL_INVARIANT", "FACET_AUTHORITATIVE_REFERENCES_EXIST", "FAIL", req_id, "rewrite_not_permitted_after_local_failure", affects_epistemic_state=True))
    ref_fields = [artifact["compositionAssessment"]["nonRedundantEvidenceUnitIds"], artifact["compositionAssessment"]["integrationEvidenceIds"], artifact["jointClaimCeiling"]["supportingEvidenceUnitIds"]] + ([weak["supportingEvidenceUnitIds"]] if weak else [])
    ref_ok = all(_valid(x, evidence_ids) for x in ref_fields)
    results.append(validation("HARD_FACTUAL_INVARIANT", "SEMANTIC_EVIDENCE_IDS_EXIST", "PASS" if ref_ok else "FAIL", req_id, "unknown_evidence_reference", affects_epistemic_state=not ref_ok))
    if weak:
        # Both properties are semantic assertions, deliberately never hard factual overrides.
        results.extend([validation("SEMANTIC_CONSISTENCY", "WEAKER_DERIVATION_FROM_CEILING", "MANUAL_ADJUDICATION_REQUIRED", req_id, weak["derivedFromJointClaimCeiling"], affects_epistemic_state=False), validation("SEMANTIC_CONSISTENCY", "POST_CEILING_CONTINUITY", "MANUAL_ADJUDICATION_REQUIRED", req_id, weak["continuityAssessment"]["status"], affects_epistemic_state=False)])
        spans, bad = _basis(requirement, weak["continuityAssessment"]["requirementBasis"]); weak["continuityAssessment"]["requirementBasisSpans"] = spans
        results.append(validation("HARD_FACTUAL_INVARIANT", "CONTINUITY_REQUIREMENT_BASIS_TRACE_VALID", "PASS" if not bad else "FAIL", req_id, str(bad), affects_epistemic_state=bool(bad)))
    obs = artifact["observabilityAssessment"]; incomplete = {sid for sid, fact in source_by_id.items() if fact["coverageStatus"] in {"PARTIAL", "FAILED"}}; supplied = [x["sourceId"] for x in obs["incompleteSourceAssessments"]]
    obs_ok = _valid(supplied, incomplete)
    results.append(validation("HARD_FACTUAL_INVARIANT", "INCOMPLETE_SOURCE_ASSESSMENTS_ELIGIBLE", "PASS" if obs_ok else "FAIL", req_id, str(sorted(set(supplied) - incomplete)), affects_epistemic_state=not obs_ok))
    all_full = bool(source_facts) and not incomplete; full_ok = not all_full or (not obs["incompleteSourceAssessments"] and obs["observabilityStatus"] != "MATERIAL_GAP")
    results.append(validation("HARD_FACTUAL_INVARIANT", "FULL_SOURCES_NO_MISSING_MATERIAL", "PASS" if full_ok else "FAIL", req_id, obs["observabilityStatus"], affects_epistemic_state=not full_ok))
    positive = artifact["fullClaimAssessment"]["status"] == "REACHED" or bool(weak and weak["continuityAssessment"]["status"] == "YES" and weak["materialUsefulness"] == "YES"); supports = set(artifact["jointClaimCeiling"]["supportingEvidenceUnitIds"]) | set(weak["supportingEvidenceUnitIds"] if weak else [])
    results.append(validation("HARD_FACTUAL_INVARIANT", "POSITIVE_SEMANTICS_HAVE_EVIDENCE", "PASS" if not positive or bool(supports & evidence_ids) else "FAIL", req_id, str(sorted(supports)), affects_epistemic_state=positive and not bool(supports & evidence_ids)))
    text = " ".join([artifact["jointClaimCeiling"]["text"], artifact["fullClaimAssessment"]["rationale"], artifact["compositionAssessment"]["rationale"], *(x["rationale"] for x in artifact["evaluatedEvidence"])])
    inflation = bool(re.search(r"(blockchain|on-chain|issuer_reviewed|verificad[oa]).{0,100}(aument|fortale|mayor soporte|más soporte)", text, re.I))
    results.append(validation("HARD_FACTUAL_INVARIANT", "PROVENANCE_BLOCKCHAIN_NOT_SEMANTIC_SUPPORT", "PASS" if not inflation else "FAIL", req_id, "trace_context_only", affects_epistemic_state=inflation))
    artifact["exactRedundancyGroups"] = redundancy_groups; artifact["facetEvidenceFitting"] = "MANUAL_ADJUDICATION_REQUIRED"
    return artifact, results, _hard(results, inherited)
