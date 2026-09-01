from __future__ import annotations

"""Manual-adjudication handoffs. No provider call, no automatic semantic verdict."""

from typing import Any

from . import config

LEVEL1_QUESTIONS = ("requirement_preserved", "final_state_defensible", "claim_ceiling_grounded",
                    "epistemic_target_preserved", "fabricated_evidence", "wrong_source_attribution")

LEVEL2_DIMENSIONS = ("evidence_units", "qualifiers", "relations", "facets", "facet_necessity",
                     "facet_evidence_fitting", "composition", "joint_claim_ceiling",
                     "weaker_claim_search", "candidate", "continuity", "external_target_introduced",
                     "material_usefulness", "observability", "final_policy_inputs", "final_state")


def level1(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "artifact": "LEVEL_1_MANUAL_ADJUDICATION", "campaignId": config.CAMPAIGN_ID,
        "providerCalls": 0, "runsCovered": len(rows), "questions": list(LEVEL1_QUESTIONS),
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


def level2(rows: list[dict[str, Any]]) -> dict[str, Any]:
    deep = [r for r in rows if r["caseId"] in config.LEVEL2_CASES]
    flagged = [r for r in rows if r["caseId"] in ("case_01", "case_13")
               and (not r.get("stateCorrect", True) or r.get("finalState") == "ABSTAIN"
                    or r.get("hardFactualFailureCodes"))]
    return {
        "artifact": "LEVEL_2_DEEP_ADJUDICATION", "campaignId": config.CAMPAIGN_ID,
        "providerCalls": 0, "cases": list(config.LEVEL2_CASES),
        "runsCovered": len(deep),
        "additionalFlaggedRuns": [r.get("runId") for r in flagged],
        "dimensions": list(LEVEL2_DIMENSIONS),
        "note": ("EvidenceUnit granularity and facet variability are recorded, never auto-labelled as error. "
                 "Relation enum differences that may express an equivalent evidential interpretation are "
                 "MANUAL_ADJUDICATION_REQUIRED."),
        "rows": [{**r, "dimensions": {d: "MANUAL_ADJUDICATION_REQUIRED" for d in LEVEL2_DIMENSIONS}}
                 for r in deep + flagged],
    }
