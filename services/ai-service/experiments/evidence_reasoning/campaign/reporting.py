from __future__ import annotations

"""Final report data assembly. Separates automated facts from manual adjudication."""

from typing import Any

from . import config


def build(*, generation: dict[str, Any], ledger: dict[str, Any], evaluation: dict[str, Any] | None,
          grounding: dict[str, Any] | None, classification: dict[str, Any] | None,
          holdout: dict[str, Any] | None, freeze_status: str, lineage: str,
          behavior_fingerprint: str, execution_fingerprint: str) -> dict[str, Any]:
    complete = generation["status"] == config.COMPLETE
    transport = {
        "logicalProviderCallsPlanned": ledger["logicalProviderCallsPlanned"],
        "successfulSemanticOutputs": ledger["successfulSemanticOutputs"],
        "providerAttempts": ledger["providerAttempts"],
        "failedTransportAttempts": ledger["failedTransportAttempts"],
        "recoveredTransportCalls": ledger["recoveredTransportCalls"],
        "transportRecoveryReserveUsed": ledger["recoveryReserveUsed"],
        "transportRecoveryReserve": ledger["transportRecoveryReserve"],
        "absoluteProviderAttemptCap": ledger["absoluteProviderAttemptCap"],
        "attemptsByStage": ledger["attemptsByStage"],
        "note": ("Provider attempts and semantic observations are distinct. "
                 "N attempts must never be described as N semantic calls."),
    }
    notComputed = "NOT_COMPUTED"
    return {
        "campaignId": config.CAMPAIGN_ID,
        "automatedFactualMeasurements": {
            "fullDevelopmentStatus": generation["status"],
            "abortReason": generation.get("abortReason"),
            "runs": f"{generation['completedRuns']}/{config.RUNS}",
            "behaviorFingerprint": behavior_fingerprint,
            "executionProtocolFingerprint": execution_fingerprint,
            "finalExecutionFreeze": freeze_status,
            "promptSemanticLineage": lineage,
            "transport": transport,
            "outcome": evaluation["outcomeLayer"] if complete and evaluation else notComputed,
            "grounding": grounding if complete and grounding else notComputed,
            "operation": evaluation["operation"] if complete and evaluation else notComputed,
        },
        "manualSemanticAdjudicationRequired": {
            "level1": "all 55 runs" if complete else notComputed,
            "level2": list(config.LEVEL2_CASES) if complete else notComputed,
            "dimensions": ["relation_semantic_equivalence", "facet_necessity", "facet_evidence_fitting",
                           "joint_claim_ceiling_faithfulness", "continuity", "material_usefulness",
                           "observability_judgment", "epistemic_target_preservation"],
            "note": "Semantic correctness is not asserted automatically where the evaluator cannot establish it.",
        },
        "classification": classification if complete and classification else notComputed,
        "holdout": holdout if complete and holdout else {"HOLDOUT_READY": "NO", "blockers": ["campaign_not_complete"]},
    }
