from __future__ import annotations

from experiments.evidence_reasoning.evaluation import evaluate_payload


def test_evaluator_labels_measurements_as_engineering_pilot() -> None:
    payload = {
        "system": "b1b",
        "runs": [{
            "metadata": {"system": "B1B_HYBRID", "caseId": "case_17", "split": "holdout", "repetition": 1, "providerStages": []},
            "02_evidence_units": [{"evidenceUnitId": "eu-17", "sourceTrace": {"sourceId": "src_17_a"}}],
            "03_objective_analysis": {"requirements": [{"requirementId": "r-17", "qualifiers": [{"value": "avanzada"}]}]},
            "04_relations": {"relations": [{"requirementId": "r-17", "evidenceUnitId": "eu-17", "relation": "LIMITED_SCOPE"}]},
            "07_guard_results": [{"guard": "excerpt_offsets_align", "status": "PASS", "reason": "eu-17", "critical": False}],
            "08_final_result": [{
                "requirementId": "r-17",
                "finalState": "PARTIALLY_SUPPORTED",
                "claimCeiling": {
                    "claimCeiling": "Formación introductoria en Kubernetes.",
                    "supportingEvidenceUnitIds": ["eu-17"],
                    "supportedQualifiers": [],
                    "missingQualifiers": ["avanzada"],
                },
            }],
        }],
    }
    result = evaluate_payload(payload)
    assert result["measurementKind"] == "engineering_pilot_not_validated_scientific_performance"
    assert result["finalStateAccuracy"] == 1.0
    assert result["relationsExactRate"] == 1.0
    assert result["qualifierAccountingRate"] == 1.0
    assert result["depthOrMultiplicityInflationCount"] == 0

