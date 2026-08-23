from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from .evaluation import evaluate_file
from .fixtures import load_cases
from .gold import load_gold
from .policy import final_state


def _primary_requirement(run: dict[str, Any]) -> tuple[str | None, str]:
    requirements = run["03_objective_analysis"]["analysis"]["requirements"]
    primary = [item["requirementId"] for item in requirements if item["evaluationRole"] == "PRIMARY"]
    if len(primary) == 1:
        return primary[0], "EXPLICIT_PRIMARY"
    return None, "MANUAL_ADJUDICATION_REQUIRED"


def _majority(states: list[str]) -> str | None:
    counts = Counter(states)
    if not counts:
        return None
    top = counts.most_common()
    return top[0][0] if len(top) == 1 or top[0][1] > top[1][1] else None


def _pre_guard_state(policy: dict[str, Any]) -> str:
    inputs = policy["inputs"]
    return final_state(
        formative_evidence_capable=inputs["formativeEvidenceCapable"],
        unresolved=inputs["unresolved"],
        critical_guard_failure=False,
        reaches_full_requirement=inputs["reachesFullRequirement"],
        has_materially_useful_weaker_claim=inputs["hasMateriallyUsefulWeakerClaim"],
        weaker_claim_still_belongs_to_requirement=inputs["weakerClaimStillBelongsToRequirement"],
    )


def _classification(expected: str, pre_guard: str, final: str) -> str:
    if pre_guard == expected and final == expected:
        return "CORRECT_BY_REASONER"
    if pre_guard == expected:
        return "GUARD_FALSE_POSITIVE"
    if final == expected:
        return "ERROR_CAUGHT_BY_GUARD"
    return "ERROR_PASSED_GUARDS"


def evaluate_b2_payload(payload: dict[str, Any]) -> dict[str, Any]:
    gold = load_gold()
    per_run: list[dict[str, Any]] = []
    confusion: Counter[tuple[str, str]] = Counter()
    relation_correct = 0
    mapped_runs = 0
    correct = 0
    false_supported = 0
    positive_claims = 0
    primary_mapping_manual = 0
    classifications: Counter[str] = Counter()
    taxonomy: Counter[str] = Counter()
    validation_status: Counter[tuple[str, str]] = Counter()
    semantic_grounding_failures = 0
    positive_with_fabricated = 0
    positive_with_wrong_source = 0
    semantic_unresolved_runs = 0
    requirement_trace_aligned = 0
    requirement_total = 0
    qualifier_identified = 0
    qualifier_trace_aligned = 0
    qualifier_lost_downstream = 0
    facet_fitting: Counter[str] = Counter()
    provider_requests = 0
    latency_ms = 0
    input_tokens = 0
    cached_tokens = 0
    output_tokens = 0
    by_case: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for run in payload.get("runs", []):
        case_id = run["metadata"]["caseId"]
        expected = gold[case_id]
        for stage in run["metadata"].get("providerStages", []):
            provider_requests += 1
            latency_ms += int(stage.get("latencyMs") or 0)
            usage = stage.get("usage") or {}
            input_tokens += int(usage.get("input_tokens") or 0)
            output_tokens += int(usage.get("output_tokens") or 0)
            cached_tokens += int((usage.get("input_tokens_details") or {}).get("cached_tokens") or 0)
        requirement_id, mapping = _primary_requirement(run)
        if requirement_id is None:
            primary_mapping_manual += 1
            per_run.append(
                {
                    "caseId": case_id,
                    "repetition": run["metadata"].get("repetition"),
                    "expectedState": expected["expectedState"],
                    "actualState": None,
                    "stateCorrect": None,
                    "requirementMapping": mapping,
                    "manualAdjudicationRequired": ["primary_requirement_mapping"],
                }
            )
            continue

        requirements = {item["requirementId"]: item for item in run["03_objective_analysis"]["analysis"]["requirements"]}
        reasoning = {item["requirementId"]: item for item in run["05_unified_contextual_reasoning"]}[requirement_id]
        policy = {item["requirementId"]: item for item in run["07_epistemic_policy"]}[requirement_id]
        final = {item["requirementId"]: item for item in run["08_final_result"]}[requirement_id]
        requirement = requirements[requirement_id]
        state = final["finalState"]
        expected_state = expected["expectedState"]
        state_correct = state == expected_state
        mapped_runs += 1
        correct += int(state_correct)
        false_supported += int(state == "SUPPORTED" and expected_state != "SUPPORTED")
        positive_claims += int(state in {"SUPPORTED", "PARTIALLY_SUPPORTED"})
        confusion[(expected_state, state)] += 1

        pre_guard = _pre_guard_state(policy)
        classification = _classification(expected_state, pre_guard, state)
        classifications[classification] += 1

        evidence = {item["evidenceUnitId"]: item for item in run["02_evidence_units"]["catalog"]}
        actual_relations = {
            (evidence[item["evidenceUnitId"]]["sourceTrace"]["sourceId"], item["relation"])
            for item in reasoning["evaluatedEvidence"]
            if item["evidenceUnitId"] in evidence
        }
        expected_relations = {(item["sourceId"], item["relation"]) for item in expected["expectedRelations"]}
        relations_exact = actual_relations == expected_relations
        relation_correct += int(relations_exact)
        semantic_grounding_failures += int(not relations_exact)
        semantic_unresolved_runs += int(reasoning["semanticUnresolved"])

        requirement_total += 1
        requirement_trace_aligned += int(requirement["traceValid"])
        material_qualifiers = [item for item in requirement["materialQualifiers"] if item["materiality"] == "MATERIAL"]
        qualifier_identified += len(material_qualifiers)
        qualifier_trace_aligned += sum(item["traceValid"] for item in material_qualifiers)
        accounted = set(reasoning["fullClaimAssessment"]["supportedQualifierIds"]) | set(reasoning["fullClaimAssessment"]["missingQualifierIds"])
        if reasoning["weakerClaimCandidate"]:
            accounted |= set(reasoning["weakerClaimCandidate"]["droppedQualifierIds"])
        qualifier_lost_downstream += sum(item["qualifierId"] not in accounted for item in material_qualifiers)
        facet_fitting[reasoning["facetEvidenceFitting"]] += 1

        for item in run["06_validation_repair"]:
            validation_status[(item["taxonomy"], item["status"])] += 1
            if item["code"] in {
                "FABRICATED_EVIDENCE",
                "WRONG_SOURCE_ATTRIBUTION",
                "AMBIGUOUS_QUOTE",
                "TRACE_ALIGNMENT_REPAIRED",
            }:
                taxonomy[item["code"]] += 1
        taxonomy["SEMANTIC_GROUNDING_FAILURE"] += int(not relations_exact)

        ceiling_ids = set(reasoning["jointClaimCeiling"]["supportingEvidenceUnitIds"])
        weaker = reasoning["weakerClaimCandidate"]
        if weaker:
            ceiling_ids |= set(weaker["supportingEvidenceUnitIds"])
        referenced_catalog_items = [evidence[item] for item in ceiling_ids if item in evidence]
        invalid_trace = len(referenced_catalog_items) != len(ceiling_ids)
        positive_with_fabricated += int(state in {"SUPPORTED", "PARTIALLY_SUPPORTED"} and invalid_trace)
        positive_with_wrong_source += int(
            state in {"SUPPORTED", "PARTIALLY_SUPPORTED"}
            and any(item["sourceTrace"]["sourceId"] not in {source.source_id for source in load_cases(case_ids={case_id})[0].sources} for item in referenced_catalog_items)
        )
        observation = {
            "state": state,
            "relations": sorted(actual_relations),
            "evidenceSet": sorted(ceiling_ids),
            "ceiling": reasoning["jointClaimCeiling"]["text"],
        }
        by_case[case_id].append(observation)
        per_run.append(
            {
                "caseId": case_id,
                "repetition": run["metadata"].get("repetition"),
                "phenomenon": expected["phenomenon"],
                "expectedState": expected_state,
                "actualState": state,
                "preGuardState": pre_guard,
                "stateCorrect": state_correct,
                "classification": classification,
                "requirementMapping": mapping,
                "relationsExact": relations_exact,
                "requirementTraceAligned": requirement["traceValid"],
                "facetEvidenceFitting": reasoning["facetEvidenceFitting"],
                "semanticUnresolved": reasoning["semanticUnresolved"],
                "observabilityStatus": reasoning["observabilityAssessment"]["status"],
                "manualAdjudicationRequired": [
                    "requirement_semantic_preservation",
                    "qualifier_semantic_preservation",
                    "facet_necessity_and_evidence_fitting",
                    "claim_ceiling_faithfulness",
                    "weaker_claim_continuity_and_usefulness",
                ],
            }
        )

    case_level: dict[str, Any] = {}
    majority_correct = 0
    for case_id, observations in sorted(by_case.items()):
        states = [item["state"] for item in observations]
        majority = _majority(states)
        majority_is_correct = majority == gold[case_id]["expectedState"] if majority else False
        majority_correct += int(majority_is_correct)
        evidence_sets = [set(item["evidenceSet"]) for item in observations]
        adjacent: list[float] = []
        for left, right in zip(evidence_sets, evidence_sets[1:]):
            union = left | right
            adjacent.append(len(left & right) / len(union) if union else 1.0)
        case_level[case_id] = {
            "expectedState": gold[case_id]["expectedState"],
            "runCount": len(observations),
            "stateDistribution": dict(Counter(states)),
            "majorityState": majority,
            "majorityCorrect": majority_is_correct,
            "finalStateAgreement": len(set(states)) == 1,
            "relationAgreement": len({tuple(item["relations"]) for item in observations}) == 1,
            "evidenceSetMeanAdjacentJaccard": sum(adjacent) / len(adjacent) if adjacent else None,
            "ceilingExactWordingAgreement": len({item["ceiling"] for item in observations}) == 1,
            "ceilingSemanticAgreement": "MANUAL_ADJUDICATION_REQUIRED",
        }

    return {
        "measurementKind": "architecture_iteration_development_evidence_not_generalization_validation",
        "system": "b2",
        "semanticCases": len(case_level),
        "runs": len(payload.get("runs", [])),
        "mappedRuns": mapped_runs,
        "primaryRequirementMappingManual": primary_mapping_manual,
        "runLevel": {
            "finalStateCorrect": correct,
            "finalStateAccuracy": correct / mapped_runs if mapped_runs else None,
            "falseSupported": false_supported,
            "positiveClaims": positive_claims,
            "positiveClaimsWithFabricatedEvidence": positive_with_fabricated,
            "positiveClaimsWithWrongSourceAttribution": positive_with_wrong_source,
            "relationsExactRate": relation_correct / mapped_runs if mapped_runs else None,
            "confusionMatrix": [
                {"expected": expected, "actual": actual, "count": count}
                for (expected, actual), count in sorted(confusion.items())
            ],
            "classifications": dict(classifications),
        },
        "caseLevel": {
            "majorityCorrectCases": majority_correct,
            "totalCases": len(case_level),
            "cases": case_level,
        },
        "groundingTaxonomy": {
            "FABRICATED_EVIDENCE": taxonomy["FABRICATED_EVIDENCE"],
            "WRONG_SOURCE_ATTRIBUTION": taxonomy["WRONG_SOURCE_ATTRIBUTION"],
            "TRACE_ALIGNMENT_FAILURE": taxonomy["AMBIGUOUS_QUOTE"],
            "TRACE_ALIGNMENT_REPAIRED": taxonomy["TRACE_ALIGNMENT_REPAIRED"],
            "SEMANTIC_GROUNDING_FAILURE": taxonomy["SEMANTIC_GROUNDING_FAILURE"],
        },
        "requirements": {
            "identified": requirement_total,
            "traceAligned": requirement_trace_aligned,
            "semanticPreservation": "MANUAL_ADJUDICATION_REQUIRED",
        },
        "qualifiers": {
            "materialIdentified": qualifier_identified,
            "traceAligned": qualifier_trace_aligned,
            "lostDownstream": qualifier_lost_downstream,
            "semanticPreservation": "MANUAL_ADJUDICATION_REQUIRED",
            "wronglyRejected": "MANUAL_ADJUDICATION_REQUIRED",
        },
        "validation": {
            "byTaxonomyAndStatus": [
                {"taxonomy": taxonomy_name, "status": status, "count": count}
                for (taxonomy_name, status), count in sorted(validation_status.items())
            ],
            "facetEvidenceFitting": dict(facet_fitting),
            "semanticUnresolvedRuns": semantic_unresolved_runs,
            "guardInducedStateChanges": classifications["ERROR_CAUGHT_BY_GUARD"] + classifications["GUARD_FALSE_POSITIVE"],
            "guardFalsePositives": classifications["GUARD_FALSE_POSITIVE"],
        },
        "operation": {
            "requests": provider_requests,
            "latencyMs": latency_ms,
            "inputTokens": input_tokens,
            "cachedInputTokens": cached_tokens,
            "outputTokens": output_tokens,
        },
        "perRun": per_run,
    }


def evaluate_b2_file(path: Path) -> dict[str, Any]:
    return evaluate_b2_payload(json.loads(path.read_text(encoding="utf-8")))


def compare_b1_b2(b1a_path: Path, b1b_path: Path, b2_path: Path) -> dict[str, Any]:
    return {
        "measurementKind": "architecture_iteration_development_evidence_not_generalization_validation",
        "b1a": evaluate_file(b1a_path),
        "b1b": evaluate_file(b1b_path),
        "b2": evaluate_b2_file(b2_path),
    }
