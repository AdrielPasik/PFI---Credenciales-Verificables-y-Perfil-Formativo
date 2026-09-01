from __future__ import annotations

import re
from copy import deepcopy
from typing import Any

from .b2_aligner import align_quote
from .b2_artifacts import validation

# Descriptive cue only. Never a hard override: a lexical pattern must not decide a
# semantic question. It is attached to the manual-adjudication payload so a human
# can check whether an unrequested possession/mastery condition leaked downstream.
_ACHIEVEMENT_CUE = re.compile(
    r"(domin\w+|acredit\w+|posee|posesión|posesion|cuente con|cuenta con|demuestr\w+ que la persona|competencia individual|desempeño profesional|desempeno profesional)",
    re.IGNORECASE,
)


def _valid(ids: list[str], allowed: set[str]) -> bool:
    return len(ids) == len(set(ids)) and set(ids) <= allowed


def _hard(results: list[dict[str, Any]], inherited: list[dict[str, Any]]) -> bool:
    return any(
        item["taxonomy"] == "HARD_FACTUAL_INVARIANT"
        and item["status"] in {"FAIL", "REJECTED"}
        and item["affectsEpistemicState"]
        for item in [*inherited, *results]
    )


def _basis(requirement: dict[str, Any], phrases: list[str]) -> tuple[list[dict[str, Any]], list[str]]:
    """DELTA_D: align literal phrases inside the Requirement quote only.

    The model supplies phrases; the deterministic aligner -- never the model --
    produces authoritative offsets. A paraphrase can never become a span.
    """
    source = requirement.get("sourceSpan")
    spans: list[dict[str, Any]] = []
    bad: list[str] = []
    if not source:
        return spans, list(phrases)
    for phrase in phrases:
        found = align_quote(requirement["requirementQuote"], phrase)
        if found.status not in {"EXACT", "REPAIRED"}:
            bad.append(f"{phrase}:{found.status}")
        else:
            spans.append(
                {
                    "charStart": source["charStart"] + found.char_start,
                    "charEnd": source["charStart"] + found.char_end,
                    "exactText": found.exact_text,
                }
            )
    return spans, bad


def validate_and_enrich_b24(
    raw: dict[str, Any],
    requirement: dict[str, Any],
    evidence_units: list[dict[str, Any]],
    redundancy_groups: list[list[str]],
    source_facts: list[dict[str, Any]],
    inherited: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[dict[str, Any]], bool]:
    artifact = deepcopy(raw)
    results: list[dict[str, Any]] = []
    req_id = requirement["requirementId"]
    evidence_ids = {item["evidenceUnitId"] for item in evidence_units}
    qualifier_ids = {item["qualifierId"] for item in requirement["materialQualifiers"] if item["qualifierId"]}
    source_by_id = {item["sourceId"]: item for item in source_facts}

    same = artifact["requirementId"] == req_id
    results.append(
        validation("HARD_FACTUAL_INVARIANT", "REQUIREMENT_ID_EXISTS", "PASS" if same else "FAIL", req_id, artifact["requirementId"], affects_epistemic_state=not same)
    )

    evaluated = [item["evidenceUnitId"] for item in artifact["evaluatedEvidence"]]
    ok = _valid(evaluated, evidence_ids)
    results.append(
        validation("HARD_FACTUAL_INVARIANT", "EVALUATED_EVIDENCE_IDS_EXIST", "PASS" if ok else "FAIL", req_id, str(sorted(set(evaluated) - evidence_ids)), affects_epistemic_state=not ok)
    )
    artifact["evaluatedEvidence"] = [item for item in artifact["evaluatedEvidence"] if item["evidenceUnitId"] in evidence_ids]

    search = artifact["weakerClaimSearch"]
    candidate = search["candidate"]

    # ---- DELTA_A structural contract -------------------------------------
    consistent = (search["status"] == "FOUND") == (candidate is not None)
    results.append(
        validation("HARD_FACTUAL_INVARIANT", "WEAKER_SEARCH_CANDIDATE_CONSISTENT", "PASS" if consistent else "FAIL", req_id, f"status={search['status']};candidate={'present' if candidate else 'absent'}", affects_epistemic_state=not consistent)
    )
    full_status = artifact["fullClaimAssessment"]["status"]
    observability_status = artifact["observabilityAssessment"]["observabilityStatus"]
    search_required = (
        bool(requirement["evaluability"]["formativeEvidenceCapable"])
        and full_status == "NOT_REACHED"
        and observability_status == "SUFFICIENT"
    )
    documented = bool(search["rationale"].strip())
    results.append(
        validation("HARD_FACTUAL_INVARIANT", "WEAKER_SEARCH_DOCUMENTED_WHEN_REQUIRED", "PASS" if (not search_required or documented) else "FAIL", req_id, f"required={search_required};rationale={'present' if documented else 'empty'}", affects_epistemic_state=search_required and not documented)
    )
    results.append(
        validation("SEMANTIC_CONSISTENCY", "WEAKER_SEARCH_OUTCOME", "MANUAL_ADJUDICATION_REQUIRED", req_id, search["status"], affects_epistemic_state=False)
    )
    artifact["weakerClaimSearch"]["searchRequired"] = search_required

    qfields = [
        *[item["supportedQualifierIds"] + item["missingQualifierIds"] for item in artifact["evaluatedEvidence"]],
        artifact["fullClaimAssessment"]["supportedQualifierIds"] + artifact["fullClaimAssessment"]["missingQualifierIds"],
    ]
    if candidate:
        qfields.append(candidate["droppedQualifierIds"])
    qok = all(_valid(item, qualifier_ids) for item in qfields)
    results.append(
        validation("HARD_FACTUAL_INVARIANT", "MATERIAL_QUALIFIER_IDS_EXIST", "PASS" if qok else "FAIL", req_id, "contextual_or_unknown_qualifier_reference", affects_epistemic_state=not qok)
    )

    facets = artifact["facets"]
    keys = [item["localFacetKey"] for item in facets]
    unique = len(keys) == len(set(keys))
    results.append(
        validation("HARD_FACTUAL_INVARIANT", "FACET_LOCAL_KEY_DEFINITIONS_UNIQUE", "PASS" if unique else "FAIL", req_id, str(keys), affects_epistemic_state=not unique)
    )
    refs = (
        artifact["compositionAssessment"]["missingFacetLocalKeys"]
        + artifact["fullClaimAssessment"]["coveredFacetLocalKeys"]
        + artifact["fullClaimAssessment"]["missingFacetLocalKeys"]
        + (candidate["droppedFacetLocalKeys"] if candidate else [])
    )
    refs_ok = (not facets and not refs) or set(refs) <= set(keys)
    results.append(
        validation("HARD_FACTUAL_INVARIANT", "FACET_LOCAL_REFERENCES_EXIST", "PASS" if refs_ok else "FAIL", req_id, str(sorted(set(refs) - set(keys))), affects_epistemic_state=not refs_ok)
    )

    fmap: dict[str, str] = {}
    for index, facet in enumerate(facets, 1):
        fid = f"{req_id}_facet_{index:02d}"
        fmap[facet["localFacetKey"]] = fid
        facet["facetId"] = fid
        eu_ok = _valid(facet["evidenceUnitIds"], evidence_ids)
        spans, failed = _basis(requirement, facet["requirementBasisPhrases"])
        basis_ok = bool(spans) and not failed
        facet["requirementBasisSpans"] = spans
        results.append(
            validation("HARD_FACTUAL_INVARIANT", "FACET_EVIDENCE_IDS_EXIST", "PASS" if eu_ok else "FAIL", fid, str(sorted(set(facet["evidenceUnitIds"]) - evidence_ids)), affects_epistemic_state=not eu_ok)
        )
        results.append(
            validation("HARD_FACTUAL_INVARIANT", "FACET_BASIS_WITHIN_REQUIREMENT", "PASS" if basis_ok else "FAIL", fid, str(failed), affects_epistemic_state=not basis_ok)
        )
        facet["facetEvidenceFitting"] = {
            "status": "MANUAL_ADJUDICATION_REQUIRED",
            "automaticCues": ["TRACE_VALID" if basis_ok else "TRACE_INVALID"],
            "question": "Would this facet remain defensible if EvidenceUnits were hidden?",
        }

    if unique and refs_ok:
        comp = artifact["compositionAssessment"]
        full = artifact["fullClaimAssessment"]
        comp["missingFacetIds"] = [fmap[item] for item in comp.pop("missingFacetLocalKeys")]
        full["coveredFacetIds"] = [fmap[item] for item in full.pop("coveredFacetLocalKeys")]
        full["missingFacetIds"] = [fmap[item] for item in full.pop("missingFacetLocalKeys")]
        if candidate:
            candidate["droppedFacetIds"] = [fmap[item] for item in candidate.pop("droppedFacetLocalKeys")]
        final_refs = comp["missingFacetIds"] + full["coveredFacetIds"] + full["missingFacetIds"] + (candidate.get("droppedFacetIds", []) if candidate else [])
        authoritative_ok = set(final_refs) <= set(fmap.values())
        results.append(
            validation("HARD_FACTUAL_INVARIANT", "FACET_AUTHORITATIVE_REFERENCES_EXIST", "PASS" if authoritative_ok else "FAIL", req_id, str(final_refs), affects_epistemic_state=not authoritative_ok)
        )
    else:
        results.append(
            validation("HARD_FACTUAL_INVARIANT", "FACET_AUTHORITATIVE_REFERENCES_EXIST", "FAIL", req_id, "rewrite_not_permitted_after_local_failure", affects_epistemic_state=True)
        )

    ref_fields = [
        artifact["compositionAssessment"]["nonRedundantEvidenceUnitIds"],
        artifact["compositionAssessment"]["integrationEvidenceIds"],
        artifact["jointClaimCeiling"]["supportingEvidenceUnitIds"],
    ] + ([candidate["supportingEvidenceUnitIds"]] if candidate else [])
    ref_ok = all(_valid(item, evidence_ids) for item in ref_fields)
    results.append(
        validation("HARD_FACTUAL_INVARIANT", "SEMANTIC_EVIDENCE_IDS_EXIST", "PASS" if ref_ok else "FAIL", req_id, "unknown_evidence_reference", affects_epistemic_state=not ref_ok)
    )

    if candidate:
        continuity = candidate["continuityAssessment"]
        # ---- DELTA_B structural consistency (never a semantic verdict) ----
        expected = {"YES": "CONSTITUTIVE_REDUCTION", "NO": "SEMANTIC_SHIFT", "UNRESOLVED": "UNRESOLVED"}
        transformation_ok = continuity["transformation"] == expected[continuity["status"]]
        results.append(
            validation("HARD_FACTUAL_INVARIANT", "CONTINUITY_TRANSFORMATION_CONSISTENT", "PASS" if transformation_ok else "FAIL", req_id, f"{continuity['status']}/{continuity['transformation']}", affects_epistemic_state=not transformation_ok)
        )
        shift_ok = continuity["status"] != "NO" or bool(continuity["shiftReason"])
        results.append(
            validation("HARD_FACTUAL_INVARIANT", "CONTINUITY_SHIFT_REASON_PRESENT", "PASS" if shift_ok else "FAIL", req_id, str(continuity["shiftReason"]), affects_epistemic_state=not shift_ok)
        )
        # ---- material usefulness ordering ---------------------------------
        order_ok = continuity["status"] == "YES" or candidate["materialUsefulness"] == "NOT_EVALUATED"
        results.append(
            validation("HARD_FACTUAL_INVARIANT", "MATERIAL_USEFULNESS_ORDER", "PASS" if order_ok else "FAIL", req_id, f"continuity={continuity['status']};usefulness={candidate['materialUsefulness']}", affects_epistemic_state=not order_ok)
        )
        # ---- DELTA_D quote-first continuity trace --------------------------
        spans, bad = _basis(requirement, continuity["requirementBasisPhrases"])
        continuity["requirementBasisSpans"] = spans
        results.append(
            validation("HARD_FACTUAL_INVARIANT", "CONTINUITY_REQUIREMENT_BASIS_TRACE_VALID", "PASS" if not bad else "FAIL", req_id, str(bad), affects_epistemic_state=bool(bad))
        )
        results.extend(
            [
                validation("SEMANTIC_CONSISTENCY", "WEAKER_DERIVATION_FROM_CEILING", "MANUAL_ADJUDICATION_REQUIRED", req_id, candidate["derivedFromJointClaimCeiling"], affects_epistemic_state=False),
                validation("SEMANTIC_CONSISTENCY", "CONSTITUTIVE_REDUCTION_CONTINUITY", "MANUAL_ADJUDICATION_REQUIRED", req_id, continuity["status"], affects_epistemic_state=False),
            ]
        )

    obs = artifact["observabilityAssessment"]
    incomplete = {sid for sid, fact in source_by_id.items() if fact["coverageStatus"] in {"PARTIAL", "FAILED"}}
    supplied = [item["sourceId"] for item in obs["incompleteSourceAssessments"]]
    obs_ok = _valid(supplied, incomplete)
    results.append(
        validation("HARD_FACTUAL_INVARIANT", "INCOMPLETE_SOURCE_ASSESSMENTS_ELIGIBLE", "PASS" if obs_ok else "FAIL", req_id, str(sorted(set(supplied) - incomplete)), affects_epistemic_state=not obs_ok)
    )
    all_full = bool(source_facts) and not incomplete
    full_ok = not all_full or (not obs["incompleteSourceAssessments"] and obs["observabilityStatus"] != "MATERIAL_GAP")
    results.append(
        validation("HARD_FACTUAL_INVARIANT", "FULL_SOURCES_NO_MISSING_MATERIAL", "PASS" if full_ok else "FAIL", req_id, obs["observabilityStatus"], affects_epistemic_state=not full_ok)
    )

    positive = artifact["fullClaimAssessment"]["status"] == "REACHED" or bool(
        candidate and candidate["continuityAssessment"]["status"] == "YES" and candidate["materialUsefulness"] == "YES"
    )
    supports = set(artifact["jointClaimCeiling"]["supportingEvidenceUnitIds"]) | set(
        candidate["supportingEvidenceUnitIds"] if candidate else []
    )
    results.append(
        validation("HARD_FACTUAL_INVARIANT", "POSITIVE_SEMANTICS_HAVE_EVIDENCE", "PASS" if not positive or bool(supports & evidence_ids) else "FAIL", req_id, str(sorted(supports)), affects_epistemic_state=positive and not bool(supports & evidence_ids))
    )

    reasoning_text = " ".join(
        [
            artifact["jointClaimCeiling"]["text"],
            artifact["fullClaimAssessment"]["rationale"],
            artifact["compositionAssessment"]["rationale"],
            *(item["rationale"] for item in artifact["evaluatedEvidence"]),
        ]
    )
    inflation = bool(
        re.search(r"(blockchain|on-chain|issuer_reviewed|verificad[oa]).{0,100}(aument|fortale|mayor soporte|más soporte)", reasoning_text, re.I)
    )
    results.append(
        validation("HARD_FACTUAL_INVARIANT", "PROVENANCE_BLOCKCHAIN_NOT_SEMANTIC_SUPPORT", "PASS" if not inflation else "FAIL", req_id, "trace_context_only", affects_epistemic_state=inflation)
    )

    # ---- DELTA_C descriptive cue, deliberately NOT a hard override --------
    cues = sorted({match.group(0).lower() for match in _ACHIEVEMENT_CUE.finditer(reasoning_text)})
    target_is_formative = requirement["epistemicTarget"] == "FORMATIVE_EVIDENCE"
    results.append(
        validation(
            "SEMANTIC_CONSISTENCY",
            "EPISTEMIC_TARGET_PRESERVATION",
            "MANUAL_ADJUDICATION_REQUIRED",
            req_id,
            f"target={requirement['epistemicTarget']};cues={cues}",
            affects_epistemic_state=False,
        )
    )
    artifact["epistemicTargetAudit"] = {
        "epistemicTarget": requirement["epistemicTarget"],
        "frozenBy": requirement.get("epistemicTargetFrozenBy"),
        "achievementLanguageCues": cues,
        "cueInterpretation": "DESCRIPTIVE_ONLY_NOT_A_VERDICT",
        "status": "MANUAL_ADJUDICATION_REQUIRED" if (target_is_formative and cues) else "NO_CUE_DETECTED",
    }

    artifact["exactRedundancyGroups"] = redundancy_groups
    artifact["facetEvidenceFitting"] = "MANUAL_ADJUDICATION_REQUIRED"
    return artifact, results, _hard(results, inherited)
