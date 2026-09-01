from __future__ import annotations

"""PHASE 2 — frozen evaluation. Only runs after all 55 runs are COMPLETE."""

import re
from collections import Counter, defaultdict
from typing import Any

from ..gold import load_gold
from . import config

TRACE_CODES = frozenset({
    "OBJECTIVE_SEGMENT_TRACE_VALID", "REQUIREMENT_QUOTE_INVALID",
    "QUALIFIER_SCOPED_TRACE_VALID", "FACET_BASIS_WITHIN_REQUIREMENT",
    "CONTINUITY_REQUIREMENT_BASIS_TRACE_VALID",
})
GROUNDING_CODES = frozenset({"FABRICATED_EVIDENCE", "WRONG_SOURCE_ATTRIBUTION"})
STRENGTHENING = re.compile(
    r"(domin\w+|maestr\w+|acredit\w+|posee|posesi[oó]n|cuenta con|cuente con|"
    r"competencia individual|desempe[nñ]o profesional|logro demostrado)", re.IGNORECASE)


def _failed(run: dict[str, Any], codes: frozenset[str]) -> list[str]:
    return [v["code"] for v in run["06_validation_repair"]
            if v["code"] in codes and v["status"] in {"FAIL", "REJECTED"}]


def snapshot(run: dict[str, Any], gold: dict[str, Any]) -> dict[str, Any]:
    cid = run["metadata"]["caseId"]
    expected = gold[cid]["expectedState"]
    row = {"runId": run["metadata"].get("runId"), "caseId": cid,
           "repetition": run["metadata"]["repetition"], "expectedState": expected}
    if run["metadata"]["runStatus"] != "RESOLVED":
        row.update({"stateEvaluable": False, "runStatus": run["metadata"]["runStatus"],
                    "manualAdjudicationRequired": ["objective_decomposition"]})
        return row

    req = run["03_objective_analysis"]["analysis"]["requirements"][0]
    rs = run["05_unified_contextual_reasoning"][0]
    pol = run["07_epistemic_policy"][0]
    search = rs["weakerClaimSearch"]
    cand = search["candidate"]
    cont = cand["continuityAssessment"] if cand else None
    hard = [v for v in run["06_validation_repair"]
            if v["taxonomy"] == "HARD_FACTUAL_INVARIANT" and v["status"] in {"FAIL", "REJECTED"}
            and v["affectsEpistemicState"]]
    text = " ".join([rs["jointClaimCeiling"]["text"], rs["fullClaimAssessment"]["rationale"],
                     rs["compositionAssessment"]["rationale"],
                     *(e["rationale"] for e in rs["evaluatedEvidence"])])
    row.update({
        "stateEvaluable": True, "preGuardState": pol["preGuardState"], "finalState": pol["finalState"],
        "stateCorrect": pol["finalState"] == expected,
        "guardInducedTransition": pol["preGuardState"] != pol["finalState"],
        "guardFalsePositive": pol["preGuardState"] == expected and pol["finalState"] != expected,
        "requirementQuote": req["requirementQuote"], "normalizedRequirement": req["normalizedRequirement"],
        "epistemicTarget": req["epistemicTarget"], "epistemicTargetRationale": req["epistemicTargetRationale"],
        "epistemicTargetAudit": rs.get("epistemicTargetAudit"),
        "strengtheningCues": sorted({m.group(0).lower() for m in STRENGTHENING.finditer(text)}),
        "qualifiers": [{"value": q["value"], "role": q["role"], "traceValid": q["traceValid"]}
                       for q in req["qualifiers"]],
        "materialQualifierCount": len(req["materialQualifiers"]),
        "relations": [{"evidenceUnitId": e["evidenceUnitId"], "relation": e["relation"]}
                      for e in rs["evaluatedEvidence"]],
        "relationDistribution": dict(Counter(e["relation"] for e in rs["evaluatedEvidence"])),
        "evidenceUnitCount": len(run["02_evidence_units"]["catalog"]),
        "facetCount": len(rs["facets"]),
        "facets": [{"facetId": f.get("facetId"), "facetText": f["facetText"], "essential": f["essential"],
                    "coverage": f["coverage"], "evidenceUnitIds": f["evidenceUnitIds"],
                    "facetEvidenceFitting": f.get("facetEvidenceFitting")} for f in rs["facets"]],
        "compositionMode": rs["compositionAssessment"]["mode"],
        "nonRedundantEvidenceUnitIds": rs["compositionAssessment"]["nonRedundantEvidenceUnitIds"],
        "jointlySupportsFullRequirement": rs["compositionAssessment"]["jointlySupportsFullRequirement"],
        "integrationRequired": rs["compositionAssessment"]["integrationRequired"],
        "integrationDemonstrated": rs["compositionAssessment"]["integrationDemonstrated"],
        "fullClaimAssessment": rs["fullClaimAssessment"]["status"],
        "coveredFacetIds": rs["fullClaimAssessment"].get("coveredFacetIds"),
        "missingFacetIds": rs["fullClaimAssessment"].get("missingFacetIds"),
        "jointClaimCeiling": rs["jointClaimCeiling"],
        "weakerSearchRequired": search.get("searchRequired"), "weakerSearchStatus": search["status"],
        "weakerSearchRationale": search["rationale"],
        "candidateText": cand["text"] if cand else None,
        "derivedFromJointClaimCeiling": cand["derivedFromJointClaimCeiling"] if cand else None,
        "droppedQualifierIds": cand["droppedQualifierIds"] if cand else None,
        "droppedFacetIds": cand.get("droppedFacetIds") if cand else None,
        "continuityStatus": cont["status"] if cont else None,
        "transformation": cont["transformation"] if cont else None,
        "externalTargetIntroduced": cont["externalTargetIntroduced"] if cont else None,
        "shiftReason": cont["shiftReason"] if cont else None,
        "explicitlyRelaxed": cont["explicitlyRelaxed"] if cont else None,
        "constitutiveProjection": cont["constitutiveProjection"] if cont else None,
        "continuityRationale": cont["rationale"] if cont else None,
        "materialUsefulness": cand["materialUsefulness"] if cand else None,
        "sourceCoverage": [f["coverageStatus"] for f in run["04_evidence_preparation"]["sourceObservabilityFacts"]],
        "incompleteSourceAssessments": rs["observabilityAssessment"]["incompleteSourceAssessments"],
        "independentObservableSupport": rs["observabilityAssessment"]["independentObservableSupport"],
        "observabilityStatus": rs["observabilityAssessment"]["observabilityStatus"],
        "hardFactualFailureCodes": [v["code"] for v in hard],
        "traceAlignmentFailures": _failed(run, TRACE_CODES),
        "groundingFailures": _failed(run, GROUNDING_CODES),
        "policyInputs": pol["inputs"],
        "manualAdjudicationRequired": ["relation_semantic_equivalence", "facet_necessity",
                                       "facet_evidence_fitting", "joint_claim_ceiling_faithfulness",
                                       "continuity", "material_usefulness", "observability_judgment"],
    })
    return row


def evaluate(runs: list[dict[str, Any]]) -> dict[str, Any]:
    gold = load_gold()
    rows = [snapshot(run, gold) for run in runs]
    evaluable = [r for r in rows if r.get("stateEvaluable")]
    by_case: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in evaluable:
        by_case[row["caseId"]].append(row)

    correct = sum(r["stateCorrect"] for r in evaluable)
    cases: dict[str, Any] = {}
    majority_correct = 0
    for cid, group in sorted(by_case.items()):
        states = [r["finalState"] for r in group]
        counts = Counter(states).most_common()
        majority = counts[0][0] if len(counts) == 1 or counts[0][1] > counts[1][1] else None
        ok = majority == gold[cid]["expectedState"]
        majority_correct += ok
        cases[cid] = {"expectedState": gold[cid]["expectedState"], "runs": len(group),
                      "stateDistribution": dict(Counter(states)), "majorityState": majority,
                      "majorityCorrect": ok, "stable": len(set(states)) == 1,
                      "correctRuns": sum(r["stateCorrect"] for r in group)}

    operation: Counter[str] = Counter()
    for run in runs:
        for stage in run["metadata"]["providerStages"]:
            operation["semanticStageOutputs"] += 1
            operation["latencyMs"] += int(stage.get("latencyMs") or 0)
            usage = stage.get("usage") or {}
            operation["inputTokens"] += int(usage.get("input_tokens") or 0)
            operation["outputTokens"] += int(usage.get("output_tokens") or 0)
            operation["cachedInputTokens"] += int((usage.get("input_tokens_details") or {}).get("cached_tokens") or 0)
            operation["reasoningTokens"] += int((usage.get("output_tokens_details") or {}).get("reasoning_tokens") or 0)

    return {"phase": "PHASE_2_EVALUATION", "system": "b241", "campaignId": config.CAMPAIGN_ID,
            "providerCalls": 0,
            "measurementKind": "frozen_full_development_vs_frozen_b2_baseline",
            "outcomeLayer": {"finalStateCorrect": f"{correct}/{len(evaluable)}",
                             "majorityCorrect": f"{majority_correct}/{len(cases)}",
                             "unmappableRuns": len(rows) - len(evaluable), "perCase": cases},
            "operation": dict(operation), "perRun": rows}


def grounding_safety(rows: list[dict[str, Any]]) -> dict[str, Any]:
    evaluable = [r for r in rows if r.get("stateEvaluable")]
    return {
        "note": "TRACE_ALIGNMENT_FAILURE is reported separately and never folded into a generic hallucination category.",
        "falseSupported": sum(r["finalState"] == "SUPPORTED" and r["expectedState"] != "SUPPORTED" for r in evaluable),
        "fabricatedEvidence": sum(c == "FABRICATED_EVIDENCE" for r in rows for c in r.get("groundingFailures", [])),
        "wrongSourceAttribution": sum(c == "WRONG_SOURCE_ATTRIBUTION" for r in rows for c in r.get("groundingFailures", [])),
        "traceAlignmentFailures": sum(len(r.get("traceAlignmentFailures", [])) for r in rows),
        "hardFactualFailures": sum(len(r.get("hardFactualFailureCodes", [])) for r in rows),
        "guardInducedStateTransitions": sum(r.get("guardInducedTransition", False) for r in evaluable),
        "guardFalsePositives": sum(r.get("guardFalsePositive", False) for r in evaluable),
        "materialUsefulnessContract": {
            "runsWithContinuityNotYes": sum(r["continuityStatus"] not in (None, "YES") for r in evaluable),
            "violations": [r["runId"] for r in evaluable
                           if r["continuityStatus"] not in (None, "YES") and r["finalState"] == "PARTIALLY_SUPPORTED"]},
        "epistemicTargetDistribution": dict(Counter(r["epistemicTarget"] for r in evaluable)),
        "runsWithStrengtheningCues": [r["runId"] for r in evaluable if r["strengtheningCues"]],
        "strengtheningCueInterpretation": "DESCRIPTIVE_MANUAL_REVIEW_SIGNAL_NOT_AN_AUTOMATIC_VERDICT",
        "relationDistribution": dict(Counter(rel["relation"] for r in evaluable for rel in r["relations"])),
        "relationEnumNote": "Exact enum agreement is not used as a correctness metric; differing labels that may be semantically equivalent are MANUAL_ADJUDICATION_REQUIRED.",
    }


MECHANISM_QUESTIONS = {
    "case_03": "explicit weaker search / premature NONE",
    "case_11": "explicit weaker search / premature NONE",
    "case_06": "constitutive reduction", "case_07": "constitutive reduction",
    "case_08": "composition + no mastery strengthening",
    "case_05": "neighbour boundary", "case_09": "prerequisite boundary",
    "case_15": "observability -> ABSTAIN", "case_13": "NOT_ASSESSABLE",
    "case_12": "technology-specific qualifier relaxation", "case_01": "baseline control",
}


def mechanism_comparison(evaluation: dict[str, Any], baseline: dict[str, Any]) -> dict[str, Any]:
    by_case: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in evaluation["perRun"]:
        if row.get("stateEvaluable"):
            by_case[row["caseId"]].append(row)
    per_case = {}
    for cid, info in evaluation["outcomeLayer"]["perCase"].items():
        group = by_case[cid]
        per_case[cid] = {
            "question": MECHANISM_QUESTIONS.get(cid), "expectedState": info["expectedState"],
            "b2Distribution": baseline["perCase"][cid]["distribution"],
            "b2MajorityCorrect": baseline["perCase"][cid]["correct"],
            "b241Distribution": info["stateDistribution"],
            "b241MajorityCorrect": info["majorityCorrect"], "b241Stable": info["stable"],
            "weakerSearchStatuses": dict(Counter(r["weakerSearchStatus"] for r in group)),
            "continuityStatuses": dict(Counter(str(r["continuityStatus"]) for r in group)),
            "externalTargetIntroduced": dict(Counter(str(r["externalTargetIntroduced"]) for r in group)),
            "compositionModes": dict(Counter(r["compositionMode"] for r in group)),
            "observabilityStatuses": dict(Counter(r["observabilityStatus"] for r in group)),
            "epistemicTargets": dict(Counter(r["epistemicTarget"] for r in group)),
        }
    return {"baseline": "B2_FROZEN", "candidate": "B2.4.1",
            "b2": {"finalStateCorrect": baseline["finalStateCorrect"], "majorityCorrect": baseline["majorityCorrect"]},
            "b241": {"finalStateCorrect": evaluation["outcomeLayer"]["finalStateCorrect"],
                     "majorityCorrect": evaluation["outcomeLayer"]["majorityCorrect"]},
            "perCase": per_case}


def upstream_variability(rows: list[dict[str, Any]]) -> dict[str, Any]:
    by_case: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if row.get("stateEvaluable"):
            by_case[row["caseId"]].append(row)
    out = {}
    for cid, group in sorted(by_case.items()):
        out[cid] = {
            "note": "Descriptive only. Representational variability is never automatically labelled an error.",
            "perRepetition": [{"repetition": r["repetition"], "evidenceUnitCount": r["evidenceUnitCount"],
                               "materialQualifierCount": r["materialQualifierCount"],
                               "facetCount": r["facetCount"], "compositionMode": r["compositionMode"],
                               "finalState": r["finalState"], "continuityStatus": r["continuityStatus"]}
                              for r in group],
            "evidenceUnitCountRange": [min(r["evidenceUnitCount"] for r in group),
                                       max(r["evidenceUnitCount"] for r in group)],
            "facetCountRange": [min(r["facetCount"] for r in group), max(r["facetCount"] for r in group)],
            "stateVaried": len({r["finalState"] for r in group}) > 1,
            "representationVaried": len({(r["evidenceUnitCount"], r["facetCount"]) for r in group}) > 1,
        }
    return out


def classify_vs_b2(evaluation: dict[str, Any], grounding: dict[str, Any],
                   baseline: dict[str, Any]) -> dict[str, Any]:
    """Provisional classification. Never a pure scoring function."""
    critical = (grounding["falseSupported"] == 0 and grounding["fabricatedEvidence"] == 0
                and grounding["wrongSourceAttribution"] == 0)
    correct = int(evaluation["outcomeLayer"]["finalStateCorrect"].split("/")[0])
    majority = int(evaluation["outcomeLayer"]["majorityCorrect"].split("/")[0])
    b2_correct = int(baseline["finalStateCorrect"].split("/")[0])
    b2_majority = int(baseline["majorityCorrect"].split("/")[0])

    regressions = []
    for cid, info in evaluation["outcomeLayer"]["perCase"].items():
        if baseline["perCase"][cid]["correct"] and not info["majorityCorrect"]:
            regressions.append(cid)
    if not critical:
        verdict = "REGRESSION_FROM_B2"
    elif regressions:
        verdict = "REGRESSION_FROM_B2"
    elif majority > b2_majority or (majority == b2_majority and correct > b2_correct):
        verdict = "CLEAR_IMPROVEMENT_OVER_B2"
    elif majority == b2_majority:
        verdict = "COMPARABLE_TO_B2"
    else:
        verdict = "REGRESSION_FROM_B2"
    return {"criticalSafetyPreserved": critical, "caseLevelRegressions": regressions,
            "b241": {"correct": correct, "majority": majority},
            "b2": {"correct": b2_correct, "majority": b2_majority},
            "PROVISIONAL_CLASSIFICATION_VS_B2": verdict,
            "FINAL_CLASSIFICATION_REQUIRES_HUMAN_REVIEW": "YES",
            "note": "Aggregate counts are evidence, not a utility function able to offset a critical mechanism loss."}


def holdout_blockers(evaluation: dict[str, Any], grounding: dict[str, Any],
                     classification: dict[str, Any], lineage: str, integrity: str) -> dict[str, Any]:
    blockers = []
    if grounding["falseSupported"]: blockers.append("false_SUPPORTED")
    if grounding["fabricatedEvidence"]: blockers.append("fabricated_evidence")
    if grounding["wrongSourceAttribution"]: blockers.append("wrong_source_attribution")
    if grounding["traceAlignmentFailures"]: blockers.append("unresolved_trace_failures")
    if grounding["guardFalsePositives"]: blockers.append("guard_false_positive_class")
    if grounding["materialUsefulnessContract"]["violations"]: blockers.append("material_usefulness_contract_violation")
    if lineage != "PASS": blockers.append("prompt_lineage_failure")
    if integrity != "PASS": blockers.append("fingerprint_inconsistency")
    if evaluation["outcomeLayer"]["unmappableRuns"]: blockers.append("objective_decomposition_ambiguity")
    if classification["caseLevelRegressions"]: blockers.append("case_level_regression")
    return {"blockers": blockers, "HOLDOUT_READY": "NO" if blockers else "YES",
            "note": "Holdout also stays closed if any change to prompt/schema/policy is already desired."}
