from __future__ import annotations

"""Holdout manual-adjudication handoffs. No provider call, no automatic verdict.

Level 2 cannot name cases in advance the way Development did, because which runs
deserve deep review depends on results that do not exist yet. So the SELECTION
CRITERIA are frozen instead, before the first provider call, and applied
mechanically afterwards.
"""

from typing import Any

from ..campaign.adjudication import LEVEL1_QUESTIONS, LEVEL2_DIMENSIONS
from . import config

# Frozen deep-review triggers. A run is selected if ANY of these holds.
LEVEL2_TRIGGERS = {
    "incorrect_final_state": "the run's final state differs from the frozen gold state",
    "case_unstable": "the run belongs to a case whose 5 repetitions are not unanimous",
    "abstain": "final state is ABSTAIN",
    "not_assessable": "final state is NOT_ASSESSABLE",
    "weaker_search_unresolved": "weakerClaimSearch status is UNRESOLVED",
    "continuity_not_yes": "a weaker-claim candidate exists with continuity != YES",
    "external_target_introduced": "the candidate introduces an external target",
    "integrated_composition": "composition mode requires or demonstrates integration",
    "observability_not_sufficient": "observability status is not SUFFICIENT",
    "non_formative_epistemic_target": "epistemicTarget is not FORMATIVE_EVIDENCE",
    "strengthening_cues": "strengthening-language cues were detected in the rationale text",
    "guard_induced_transition": "the guard layer changed the pre-guard state",
    "grounding_or_trace_failure": "any grounding failure or trace-alignment failure code",
    "hard_factual_failure": "any hard factual invariant failure",
    "unmappable_run": "the run did not resolve (objective decomposition ambiguous)",
}


def _triggers_for(row: dict[str, Any], unstable_cases: set[str]) -> list[str]:
    fired: list[str] = []
    if not row.get("stateEvaluable"):
        return ["unmappable_run"]
    if not row.get("stateCorrect"):
        fired.append("incorrect_final_state")
    if row["caseId"] in unstable_cases:
        fired.append("case_unstable")
    if row.get("finalState") == "ABSTAIN":
        fired.append("abstain")
    if row.get("finalState") == "NOT_ASSESSABLE":
        fired.append("not_assessable")
    if row.get("weakerSearchStatus") == "UNRESOLVED":
        fired.append("weaker_search_unresolved")
    if row.get("continuityStatus") not in (None, "YES"):
        fired.append("continuity_not_yes")
    if row.get("externalTargetIntroduced") == "YES":
        fired.append("external_target_introduced")
    if row.get("integrationRequired") or row.get("integrationDemonstrated"):
        fired.append("integrated_composition")
    if row.get("observabilityStatus") not in (None, "SUFFICIENT"):
        fired.append("observability_not_sufficient")
    if row.get("epistemicTarget") not in (None, "FORMATIVE_EVIDENCE"):
        fired.append("non_formative_epistemic_target")
    if row.get("strengtheningCues"):
        fired.append("strengthening_cues")
    if row.get("guardInducedTransition"):
        fired.append("guard_induced_transition")
    if row.get("groundingFailures") or row.get("traceAlignmentFailures"):
        fired.append("grounding_or_trace_failure")
    if row.get("hardFactualFailureCodes"):
        fired.append("hard_factual_failure")
    return fired


def level1(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "artifact": "HOLDOUT_LEVEL_1_MANUAL_ADJUDICATION", "campaignId": config.CAMPAIGN_ID,
        "providerCalls": 0, "runsCovered": len(rows), "coverage": "ALL_30_HOLDOUT_RUNS",
        "questions": list(LEVEL1_QUESTIONS),
        "rows": [{
            "runId": r.get("runId"), "caseId": r["caseId"], "repetition": r["repetition"],
            "expectedState": r["expectedState"], "finalState": r.get("finalState"),
            "stateCorrect": r.get("stateCorrect"), "requirementQuote": r.get("requirementQuote"),
            "normalizedRequirement": r.get("normalizedRequirement"),
            "epistemicTarget": r.get("epistemicTarget"), "jointClaimCeiling": r.get("jointClaimCeiling"),
            "strengtheningCues": r.get("strengtheningCues"),
            "groundingFailures": r.get("groundingFailures"),
            "traceAlignmentFailures": r.get("traceAlignmentFailures"),
            "verdict": {q: "MANUAL_ADJUDICATION_REQUIRED" for q in LEVEL1_QUESTIONS},
        } for r in rows],
    }


def level2(rows: list[dict[str, Any]], evaluation: dict[str, Any]) -> dict[str, Any]:
    per_case = evaluation["outcomeLayer"]["perCase"]
    unstable = {cid for cid, info in per_case.items() if not info["stable"]}
    selected = []
    for row in rows:
        fired = _triggers_for(row, unstable)
        if fired:
            selected.append({**row, "level2Triggers": fired,
                             "dimensions": {d: "MANUAL_ADJUDICATION_REQUIRED" for d in LEVEL2_DIMENSIONS}})
    return {
        "artifact": "HOLDOUT_LEVEL_2_DEEP_ADJUDICATION", "campaignId": config.CAMPAIGN_ID,
        "providerCalls": 0, "selection": config.LEVEL2_SELECTION,
        "triggersFrozenBeforeGeneration": LEVEL2_TRIGGERS,
        "dimensions": list(LEVEL2_DIMENSIONS),
        "runsCovered": len(selected),
        "note": ("Triggers were frozen before any Holdout observation existed. "
                 "EvidenceUnit granularity and facet variability are recorded, never "
                 "auto-labelled as error. Relation enum differences that may express an "
                 "equivalent evidential interpretation are MANUAL_ADJUDICATION_REQUIRED."),
        "rows": selected,
    }
