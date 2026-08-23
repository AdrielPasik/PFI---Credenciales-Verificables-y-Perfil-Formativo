from __future__ import annotations

import json

from experiments.evidence_reasoning.b2_evaluation import evaluate_b2_payload
from experiments.evidence_reasoning.b2_fingerprint import b2_behavior_fingerprint
from experiments.evidence_reasoning.b2_validation import validate_and_enrich_reasoning


def _requirement() -> dict:
    return {
        "requirementId": "req_01",
        "requirementQuote": "fundamentos de procesos térmicos",
        "normalizedRequirement": "Fundamentos de procesos térmicos",
        "evaluationRole": "PRIMARY",
        "traceValid": True,
        "evaluability": {"formativeEvidenceCapable": True},
        "materialQualifiers": [],
    }


def _evidence() -> list[dict]:
    return [
        {
            "evidenceUnitId": "eu_01",
            "normalizedProposition": "Balances de energía en operaciones.",
            "sourceTrace": {"sourceId": "src_08_a"},
        }
    ]


def _reasoning() -> dict:
    return {
        "requirementId": "req_01",
        "evaluatedEvidence": [
            {
                "evidenceUnitId": "eu_01",
                "relation": "CONTRIBUTORY_SUPPORT",
                "supportedQualifierIds": [],
                "missingQualifierIds": [],
                "evidenceContribution": "Balances de energía.",
                "rationale": "Contribución parcial.",
            }
        ],
        "facets": [
            {
                "facetText": "balances de energía",
                "requirementBasis": "parte de procesos térmicos",
                "whyNecessary": "componente fundamental",
                "essential": True,
                "coverage": "FULL",
                "evidenceUnitIds": ["eu_01"],
                "rationale": "cubierta",
            }
        ],
        "compositionAssessment": {
            "mode": "COMPLEMENTARY_COVERAGE",
            "nonRedundantEvidenceUnitIds": ["eu_01"],
            "jointlySupportsFullRequirement": False,
            "integrationRequired": False,
            "integrationDemonstrated": False,
            "integrationEvidenceIds": [],
            "missingFacetTexts": [],
            "unresolved": False,
            "rationale": "parcial",
        },
        "fullClaimAssessment": {
            "status": "NOT_REACHED",
            "supportedQualifierIds": [],
            "missingQualifierIds": [],
            "coveredFacetTexts": ["balances de energía"],
            "missingFacetTexts": [],
            "rationale": "no completo",
        },
        "jointClaimCeiling": {"text": "Balances de energía.", "supportingEvidenceUnitIds": ["eu_01"]},
        "weakerClaimCandidate": {
            "text": "Formación en balances de energía.",
            "supportingEvidenceUnitIds": ["eu_01"],
            "preservedRequirementCore": "procesos térmicos",
            "droppedQualifierIds": [],
            "droppedFacetTexts": [],
            "sameRequirementContinuity": "YES",
            "continuityRationale": "mismo núcleo",
            "materialUsefulness": "YES",
            "usefulnessRationale": "útil",
        },
        "observabilityAssessment": {"status": "SUFFICIENT", "rationale": "completa"},
        "semanticUnresolved": False,
        "unresolvedReason": "",
    }


def test_semantic_consistency_signal_never_becomes_hard_failure() -> None:
    enriched, validations, hard = validate_and_enrich_reasoning(_reasoning(), _requirement(), _evidence(), [], [])
    assert hard is False
    assert enriched["facetEvidenceFitting"] in {"PASS", "SUSPECT", "MANUAL_ADJUDICATION_REQUIRED"}
    assert all(item["affectsEpistemicState"] is False for item in validations if item["taxonomy"] == "SEMANTIC_CONSISTENCY")


def test_fingerprint_is_stable_and_covers_inference_contract() -> None:
    first = b2_behavior_fingerprint()
    second = b2_behavior_fingerprint()
    paths = {item["path"] for item in first["files"]}
    assert first == second
    assert {"b2_prompts.py", "b2_schemas.py", "b2_runtime.py", "providers.py", "fixtures/inputs/seed_v0_inputs.json"} <= paths


def test_evaluator_requires_explicit_primary_mapping() -> None:
    payload = {
        "runs": [
            {
                "metadata": {"caseId": "case_01", "repetition": 1, "providerStages": []},
                "03_objective_analysis": {
                    "analysis": {
                        "requirements": [
                            {"requirementId": "req_01", "evaluationRole": "ADDITIONAL"},
                            {"requirementId": "req_02", "evaluationRole": "ADDITIONAL"},
                        ]
                    }
                },
            }
        ]
    }
    result = evaluate_b2_payload(json.loads(json.dumps(payload)))
    assert result["mappedRuns"] == 0
    assert result["primaryRequirementMappingManual"] == 1
    assert result["perRun"][0]["requirementMapping"] == "MANUAL_ADJUDICATION_REQUIRED"
