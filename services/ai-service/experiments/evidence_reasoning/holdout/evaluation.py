from __future__ import annotations

"""PHASE 2 — frozen Holdout evaluation. Runs only after 30/30 runs are COMPLETE.

The per-run measurement function is imported unchanged from the Development
campaign, so Development and Holdout rows are directly comparable field by
field. What is new here is the generalization adjudication and the
Development-vs-Holdout comparison — both frozen before the first provider call.

This module is the ONLY place in the Holdout package that touches gold, and it
is never imported by the generation path.
"""

from collections import Counter, defaultdict
from typing import Any

from ..campaign.evaluation import grounding_safety, snapshot, upstream_variability  # noqa: F401
from ..gold import load_gold
from . import config

CRITICAL_SAFETY_INVARIANTS = (
    "falseSupported", "fabricatedEvidence", "wrongSourceAttribution",
    "traceAlignmentFailures", "hardFactualFailures", "guardFalsePositives",
)

# Frozen BEFORE any Holdout observation exists. Deliberately not a single
# accuracy threshold: a safety gate first, then a multi-signal case-level
# profile, and human adjudication always required afterwards.
GENERALIZATION_CONTRACT = {
    "notAUtilityFunction": (
        "Aggregate correctness never offsets a critical grounding failure and never "
        "by itself decides the verdict. The automated label is provisional."),
    "gate1_criticalSafety": (
        "All of falseSupported, fabricatedEvidence, wrongSourceAttribution, "
        "traceAlignmentFailures, hardFactualFailures, guardFalsePositives and "
        "materialUsefulness contract violations must be 0. Any non-zero value forces "
        "GENERALIZATION_NOT_SUPPORTED regardless of accuracy."),
    "gate2_systematicCaseFailure": (
        "A case with 0/5 correct runs is a systematic case failure, not a boundary. "
        "One such case caps the verdict at GENERALIZATION_MIXED; two or more force "
        "GENERALIZATION_NOT_SUPPORTED."),
    "gate3_caseEnvelope": (
        "majority-correct >= 5/6 with gates 1 and 2 clean -> GENERALIZATION_SUPPORTED; "
        "3/6 or 4/6 -> GENERALIZATION_MIXED; <= 2/6 -> GENERALIZATION_NOT_SUPPORTED."),
    "unmappableRunTreatment": (
        "A model-generated valid Objective decomposition that does not resolve exactly one "
        "authoritative Requirement is an INCORRECT run for its case and stays inside the "
        "five-repetition denominator. It receives no invented final state. This is a "
        "clarification of what counts as an incorrect run; it moves NO threshold. Gate 2 "
        "therefore applies unchanged when a case reaches 0/5 through unmappable runs."),
    "recordedButNotAutoScored": [
        "aggregate final-state correctness", "per-case stability across 5 repetitions",
        "abstention behaviour (unnecessary and missed ABSTAIN)",
        "NOT_ASSESSABLE boundary behaviour", "qualifier handling",
        "weaker-claim search behaviour", "semantic mechanism quality",
    ],
    "claimScope": (
        "This campaign measures generalization of frozen B2.4.1 to unseen cases. "
        "B2 is NOT executed on Holdout, so no B2.4.1-vs-B2 Holdout comparison may be "
        "stated. Development remains the basis of the architectural comparison."),
}


def holdout_gold() -> dict[str, dict[str, Any]]:
    gold = load_gold()
    missing = [c for c in config.HOLDOUT_CASES if c not in gold]
    if missing:
        raise ValueError(f"holdout_gold_missing:{','.join(missing)}")
    return {cid: gold[cid] for cid in config.HOLDOUT_CASES}


def evaluate(runs: list[dict[str, Any]]) -> dict[str, Any]:
    """Every terminal run counts, mappable or not.

    An unmappable run — the model returned a valid Objective Analysis that did
    not resolve one authoritative Requirement — is an INCORRECT run for its case,
    inside the five-repetition denominator. It is never dropped (that would hide
    a generalization failure) and never given an invented final state (that would
    falsify what was observed). Its distribution label is deliberately not a
    FinalState enum value.
    """
    gold = holdout_gold()
    rows = [snapshot(run, gold) for run in runs]
    for row, run in zip(rows, runs):
        metadata = run["metadata"]
        row["unmappableRun"] = bool(metadata.get("unmappableRun"))
        row["unmappableReason"] = metadata.get("unmappableReason")
        if not row.get("stateEvaluable"):
            row["stateCorrect"] = False
            row["finalState"] = None

    by_case: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_case[row["caseId"]].append(row)
    evaluable = [r for r in rows if r.get("stateEvaluable")]
    unmappable = [r for r in rows if not r.get("stateEvaluable")]

    correct = sum(r["stateCorrect"] for r in rows)
    cases: dict[str, Any] = {}
    majority_correct = 0
    for cid, group in sorted(by_case.items()):
        labels = [r["finalState"] if r.get("stateEvaluable") else config.UNMAPPABLE_DISTRIBUTION_LABEL
                  for r in group]
        counts = Counter(labels).most_common()
        majority = counts[0][0] if len(counts) == 1 or counts[0][1] > counts[1][1] else None
        ok = majority == gold[cid]["expectedState"]
        majority_correct += ok
        cases[cid] = {"expectedState": gold[cid]["expectedState"], "runs": len(group),
                      "stateDistribution": dict(Counter(labels)), "majorityState": majority,
                      "majorityCorrect": ok, "stable": len(set(labels)) == 1,
                      "correctRuns": sum(r["stateCorrect"] for r in group),
                      "unmappableRuns": sum(not r.get("stateEvaluable") for r in group)}

    operation: Counter[str] = Counter()
    for run in runs:
        for stage in run["metadata"]["providerStages"]:
            operation["semanticStageOutputs"] += 1
            operation["latencyMs"] += int(stage.get("latencyMs") or 0)
            usage = stage.get("usage") or {}
            operation["inputTokens"] += int(usage.get("input_tokens") or 0)
            operation["outputTokens"] += int(usage.get("output_tokens") or 0)
            operation["cachedInputTokens"] += int(
                (usage.get("input_tokens_details") or {}).get("cached_tokens") or 0)
            operation["reasoningTokens"] += int(
                (usage.get("output_tokens_details") or {}).get("reasoning_tokens") or 0)

    return {"phase": "PHASE_2_EVALUATION", "system": "b241", "campaignId": config.CAMPAIGN_ID,
            "providerCalls": 0,
            "measurementKind": "frozen_b241_generalization_to_unseen_cases",
            "claimScope": GENERALIZATION_CONTRACT["claimScope"],
            "outcomeLayer": {"finalStateCorrect": f"{correct}/{len(rows)}",
                             "majorityCorrect": f"{majority_correct}/{len(cases)}",
                             "mappableRuns": len(evaluable),
                             "unmappableRuns": len(unmappable),
                             "unmappableRunIds": [r["runId"] for r in unmappable],
                             "unmappableTreatment": "COUNTED_IN_DENOMINATOR_AS_INCORRECT",
                             "perCase": cases},
            "operation": dict(operation), "perRun": rows}


def abstention_profile(rows: list[dict[str, Any]]) -> dict[str, Any]:
    evaluable = [r for r in rows if r.get("stateEvaluable")]
    return {
        "unnecessaryAbstain": [r["runId"] for r in evaluable
                               if r["finalState"] == "ABSTAIN" and r["expectedState"] != "ABSTAIN"],
        "missedAbstain": [r["runId"] for r in evaluable
                          if r["expectedState"] == "ABSTAIN" and r["finalState"] != "ABSTAIN"],
        "unnecessaryNotAssessable": [r["runId"] for r in evaluable
                                     if r["finalState"] == "NOT_ASSESSABLE"
                                     and r["expectedState"] != "NOT_ASSESSABLE"],
        "missedNotAssessable": [r["runId"] for r in evaluable
                                if r["expectedState"] == "NOT_ASSESSABLE"
                                and r["finalState"] != "NOT_ASSESSABLE"],
        "observabilityStatuses": dict(Counter(r["observabilityStatus"] for r in evaluable)),
        "weakerSearchStatuses": dict(Counter(r["weakerSearchStatus"] for r in evaluable)),
        "continuityStatuses": dict(Counter(str(r["continuityStatus"]) for r in evaluable)),
        "note": "Descriptive. ABSTAIN is a first-class state; its presence is never itself an error.",
    }


def adjudicate_generalization(evaluation: dict[str, Any], grounding: dict[str, Any]) -> dict[str, Any]:
    """Provisional generalization verdict under the pre-frozen contract."""
    breaches = [name for name in CRITICAL_SAFETY_INVARIANTS if grounding[name]]
    if grounding["materialUsefulnessContract"]["violations"]:
        breaches.append("materialUsefulnessContractViolation")

    per_case = evaluation["outcomeLayer"]["perCase"]
    systematic = sorted(cid for cid, info in per_case.items() if info["correctRuns"] == 0)
    majority = int(evaluation["outcomeLayer"]["majorityCorrect"].split("/")[0])
    total_cases = int(evaluation["outcomeLayer"]["majorityCorrect"].split("/")[1])
    correct = int(evaluation["outcomeLayer"]["finalStateCorrect"].split("/")[0])
    stable = sorted(cid for cid, info in per_case.items() if info["stable"])

    if breaches:
        verdict = "GENERALIZATION_NOT_SUPPORTED"
        driver = "critical_safety_invariant_breached"
    elif len(systematic) >= 2:
        verdict = "GENERALIZATION_NOT_SUPPORTED"
        driver = "two_or_more_systematic_case_failures"
    elif majority <= 2:
        verdict = "GENERALIZATION_NOT_SUPPORTED"
        driver = "case_envelope_below_threshold"
    elif systematic:
        verdict = "GENERALIZATION_MIXED"
        driver = "one_systematic_case_failure_caps_the_verdict"
    elif majority >= 5:
        verdict = "GENERALIZATION_SUPPORTED"
        driver = "case_envelope_clean_and_safety_preserved"
    else:
        verdict = "GENERALIZATION_MIXED"
        driver = "partial_case_envelope"

    return {
        "contract": GENERALIZATION_CONTRACT,
        "criticalSafetyBreaches": breaches,
        "systematicCaseFailures": systematic,
        "majorityCorrect": f"{majority}/{total_cases}",
        "finalStateCorrect": evaluation["outcomeLayer"]["finalStateCorrect"],
        "aggregateCorrectRuns": correct,
        "stableCases": stable,
        "PROVISIONAL_GENERALIZATION_VERDICT": verdict,
        "verdictDriver": driver,
        "FINAL_GENERALIZATION_REQUIRES_HUMAN_REVIEW": "YES",
        "note": ("Provisional and frozen before generation. If it disagrees with the "
                 "specialist's reading of the contract, it is recorded and NOT rewritten: "
                 "changing a metric after seeing which case moved is post-result tuning."),
    }


def development_vs_holdout(dev_evaluation: dict[str, Any], dev_grounding: dict[str, Any],
                           hold_evaluation: dict[str, Any], hold_grounding: dict[str, Any],
                           hold_abstention: dict[str, Any]) -> dict[str, Any]:
    """Comparison tables only. Holdout never modifies the candidate."""

    def profile(ev: dict[str, Any], gr: dict[str, Any]) -> dict[str, Any]:
        rows = [r for r in ev["perRun"] if r.get("stateEvaluable")]
        per_case = ev["outcomeLayer"]["perCase"]
        return {
            "finalStateCorrect": ev["outcomeLayer"]["finalStateCorrect"],
            "majorityCorrect": ev["outcomeLayer"]["majorityCorrect"],
            "unmappableRuns": ev["outcomeLayer"].get("unmappableRuns", 0),
            "stableCases": f"{sum(i['stable'] for i in per_case.values())}/{len(per_case)}",
            "finalStateDistribution": dict(Counter(r["finalState"] for r in rows)),
            "safety": {k: gr[k] for k in CRITICAL_SAFETY_INVARIANTS},
            "materialUsefulnessViolations": len(gr["materialUsefulnessContract"]["violations"]),
            "weakerSearchStatuses": dict(Counter(r["weakerSearchStatus"] for r in rows)),
            "continuityStatuses": dict(Counter(str(r["continuityStatus"]) for r in rows)),
            "externalTargetIntroduced": dict(Counter(str(r["externalTargetIntroduced"]) for r in rows)),
            "compositionModes": dict(Counter(r["compositionMode"] for r in rows)),
            "observabilityStatuses": dict(Counter(r["observabilityStatus"] for r in rows)),
            "epistemicTargets": dict(Counter(r["epistemicTarget"] for r in rows)),
            "materialQualifierCounts": dict(Counter(r["materialQualifierCount"] for r in rows)),
            "runsWithStrengtheningCues": len(gr["runsWithStrengtheningCues"]),
        }

    return {
        "comparisonKind": "DEVELOPMENT_BEHAVIOUR_VS_HOLDOUT_BEHAVIOUR",
        "purpose": ("Describe how the frozen candidate behaves on seen versus unseen cases. "
                    "It is NOT a basis for modifying the candidate."),
        "warning": ("Development and Holdout are different case sets with different primary "
                    "phenomena. Differences in distribution are not automatically degradation."),
        "development": profile(dev_evaluation, dev_grounding),
        "holdout": profile(hold_evaluation, hold_grounding),
        "holdoutAbstentionProfile": hold_abstention,
        "safetyPreservedAcrossBothSplits": all(
            dev_grounding[k] == 0 and hold_grounding[k] == 0 for k in CRITICAL_SAFETY_INVARIANTS),
    }
