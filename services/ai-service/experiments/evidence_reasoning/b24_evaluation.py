from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from .gold import load_gold

MANUAL_DIMENSIONS = (
    "epistemic_target_classification",
    "qualifier_roles",
    "facet_necessity",
    "facet_evidence_fitting",
    "relation_semantic_equivalence",
    "joint_claim_ceiling_faithfulness",
    "weaker_search_outcome",
    "constitutive_reduction_continuity",
    "material_usefulness",
    "observability_judgment",
)


def _usage(stages: list[dict[str, Any]]) -> dict[str, int]:
    total = {
        "requests": len(stages),
        "retries": sum(int(item.get("retries") or 0) for item in stages),
        "latencyMs": sum(int(item.get("latencyMs") or 0) for item in stages),
        "inputTokens": 0,
        "outputTokens": 0,
    }
    for item in stages:
        usage = item.get("usage") or {}
        total["inputTokens"] += int(usage.get("input_tokens") or 0)
        total["outputTokens"] += int(usage.get("output_tokens") or 0)
    return total


def _majority(values: list[str]) -> str | None:
    count = Counter(values)
    top = count.most_common()
    return top[0][0] if top and (len(top) == 1 or top[0][1] > top[1][1]) else None


def evaluate_b24_payload(payload: dict[str, Any]) -> dict[str, Any]:
    gold = load_gold()
    per: list[dict[str, Any]] = []
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    confusion: Counter[tuple[str, str]] = Counter()
    ops: Counter[str] = Counter()
    search_status: Counter[str] = Counter()
    continuity_status: Counter[str] = Counter()
    target_status: Counter[str] = Counter()
    correct = false_supported = fabricated = wrong_source = hard_failures = 0

    for run in payload["runs"]:
        cid = run["metadata"]["caseId"]
        ops.update(_usage(run["metadata"]["providerStages"]))
        if run["metadata"]["runStatus"] != "RESOLVED":
            per.append(
                {
                    "caseId": cid,
                    "stateEvaluable": False,
                    "decompositionStatus": run["metadata"]["runStatus"],
                    "manualAdjudicationRequired": ["objective_decomposition"],
                }
            )
            continue

        requirement = run["03_objective_analysis"]["analysis"]["requirements"][0]
        reasoning = run["05_unified_contextual_reasoning"][0]
        policy = run["07_epistemic_policy"][0]
        final = run["08_final_result"][0]
        expected = gold[cid]["expectedState"]
        actual = final["finalState"]
        hard = [
            item
            for item in run["06_validation_repair"]
            if item["taxonomy"] == "HARD_FACTUAL_INVARIANT"
            and item["status"] in {"FAIL", "REJECTED"}
            and item["affectsEpistemicState"]
        ]
        hard_failures += len(hard)
        state_correct = actual == expected
        correct += state_correct
        false_supported += actual == "SUPPORTED" and expected != "SUPPORTED"
        confusion[(expected, actual)] += 1
        fabricated += any(item["code"] == "FABRICATED_EVIDENCE" for item in run["06_validation_repair"])
        wrong_source += any(item["code"] == "WRONG_SOURCE_ATTRIBUTION" for item in run["06_validation_repair"])

        search = reasoning["weakerClaimSearch"]
        candidate = search["candidate"]
        continuity = candidate["continuityAssessment"] if candidate else None
        search_status[search["status"]] += 1
        continuity_status[continuity["status"] if continuity else "NO_CANDIDATE"] += 1
        target_status[requirement["epistemicTarget"]] += 1

        row = {
            "caseId": cid,
            "stateEvaluable": True,
            "expectedState": expected,
            "actualState": actual,
            "preGuardState": policy["preGuardState"],
            "stateCorrect": state_correct,
            # --- Requirement authority (DELTA_C) ---
            "requirementQuote": requirement["requirementQuote"],
            "normalizedRequirement": requirement["normalizedRequirement"],
            "epistemicTarget": requirement["epistemicTarget"],
            "epistemicTargetRationale": requirement["epistemicTargetRationale"],
            "epistemicTargetAudit": reasoning.get("epistemicTargetAudit"),
            # --- reasoning chain in logical order ---
            "relations": [
                {"evidenceUnitId": item["evidenceUnitId"], "relation": item["relation"]}
                for item in reasoning["evaluatedEvidence"]
            ],
            "facets": [
                {
                    "facetId": item.get("facetId"),
                    "facetText": item["facetText"],
                    "essential": item["essential"],
                    "coverage": item["coverage"],
                }
                for item in reasoning["facets"]
            ],
            "compositionAssessment": {
                "mode": reasoning["compositionAssessment"]["mode"],
                "jointlySupportsFullRequirement": reasoning["compositionAssessment"]["jointlySupportsFullRequirement"],
                "integrationRequired": reasoning["compositionAssessment"]["integrationRequired"],
                "unresolved": reasoning["compositionAssessment"]["unresolved"],
            },
            "fullClaimAssessment": reasoning["fullClaimAssessment"]["status"],
            "jointClaimCeiling": reasoning["jointClaimCeiling"],
            "observabilityStatus": reasoning["observabilityAssessment"]["observabilityStatus"],
            # --- DELTA_A / DELTA_B ---
            "weakerSearchStatus": search["status"],
            "weakerSearchRequired": search.get("searchRequired"),
            "weakerSearchRationale": search["rationale"],
            "weakerCandidate": {"text": candidate["text"], "derivedFromJointClaimCeiling": candidate["derivedFromJointClaimCeiling"]} if candidate else None,
            "continuityAssessment": continuity,
            "materialUsefulness": candidate["materialUsefulness"] if candidate else None,
            "hardFactualFailureCodes": [item["code"] for item in hard],
            "manualAdjudicationRequired": list(MANUAL_DIMENSIONS),
        }
        per.append(row)
        grouped[cid].append(row)

    cases: dict[str, Any] = {}
    majority_correct = 0
    for cid, rows in sorted(grouped.items()):
        states = [item["actualState"] for item in rows]
        majority = _majority(states)
        ok = majority == gold[cid]["expectedState"] if majority else False
        majority_correct += ok
        cases[cid] = {
            "expectedState": gold[cid]["expectedState"],
            "runCount": len(rows),
            "stateDistribution": dict(Counter(states)),
            "majorityState": majority,
            "majorityCorrect": ok,
            "stability": len(set(states)) == 1,
        }

    return {
        "measurementKind": "development_early_rejection_gate_not_benchmark_accuracy_stability_or_generalization",
        "system": "b24",
        "runLevel": {
            "correct": correct,
            "correctOverRuns": f"{correct}/{len(per)}",
            "falseSupported": false_supported,
            "fabricatedEvidence": fabricated,
            "wrongSourceAttribution": wrong_source,
            "hardFactualFailures": hard_failures,
            "confusionMatrix": [{"expected": e, "actual": a, "count": c} for (e, a), c in sorted(confusion.items())],
        },
        "deltaSignals": {
            "weakerSearchStatusDistribution": dict(search_status),
            "continuityStatusDistribution": dict(continuity_status),
            "epistemicTargetDistribution": dict(target_status),
        },
        "caseLevel": {"majorityCorrectCases": f"{majority_correct}/{len(cases)}", "cases": cases},
        "operation": dict(ops),
        "perRun": per,
    }


def evaluate_b24_file(path: Path) -> dict[str, Any]:
    return evaluate_b24_payload(json.loads(path.read_text(encoding="utf-8")))


def manual_adjudication(payload: dict[str, Any]) -> dict[str, Any]:
    """Human handoff. No fourth provider call, no automatic semantic certification."""
    rows = []
    for run in payload["runs"]:
        if run["metadata"]["runStatus"] != "RESOLVED":
            continue
        rows.append(
            {
                "caseId": run["metadata"]["caseId"],
                "requirement": run["03_objective_analysis"]["analysis"]["requirements"][0],
                "evidenceUnits": run["02_evidence_units"]["catalog"],
                "reasoning": run["05_unified_contextual_reasoning"][0],
                "policy": run["07_epistemic_policy"][0],
                "dimensions": {key: "MANUAL_ADJUDICATION_REQUIRED" for key in MANUAL_DIMENSIONS},
            }
        )
    return {
        "artifact": "B24_MANUAL_ADJUDICATION",
        "providerCalls": 0,
        "note": "Automatic cues are structural/descriptive only. Semantic equivalence, facet necessity, facet evidence fitting, ceiling faithfulness, continuity and usefulness are not auto-certified.",
        "rows": rows,
    }
