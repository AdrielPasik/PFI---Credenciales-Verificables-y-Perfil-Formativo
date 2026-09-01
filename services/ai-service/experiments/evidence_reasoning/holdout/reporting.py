from __future__ import annotations

"""Holdout report data assembly. Automated facts stay separate from adjudication."""

from typing import Any

from . import config

NOT_COMPUTED = "NOT_COMPUTED"


def build(*, generation: dict[str, Any], ledger: dict[str, Any],
          evaluation: dict[str, Any] | None, grounding: dict[str, Any] | None,
          generalization: dict[str, Any] | None, comparison: dict[str, Any] | None,
          freeze_status: str, lineage: str, gold_isolation: str,
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
        "maximumExpectedLogicalCalls": config.LOGICAL_PROVIDER_CALLS,
        "logicalCallBudgetSemantics": config.LOGICAL_CALL_BUDGET_SEMANTICS,
        "unmappableRuns": generation.get("unmappableRunCount", 0),
        "unusedLogicalCallSlots": generation.get("unusedLogicalCallSlots", 0),
        "unusedSlotDisposition": "DISCARDED_NOT_REASSIGNED",
        "note": ("Provider attempts and semantic observations are distinct. "
                 "N attempts must never be described as N semantic calls. "
                 "90 is the maximum expected logical call count, reached only if all 30 runs "
                 "are mappable; an unused Unified slot is discarded, never reassigned and never "
                 "converted into extra reserve."),
    }
    return {
        "campaignId": config.CAMPAIGN_ID,
        "claimScope": {
            "measures": "generalization of frozen B2.4.1 to previously unseen cases",
            "doesNotMeasure": "B2.4.1 superiority over B2 on Holdout",
            "reason": "B2 is not executed on these cases in this campaign",
            "permittedStatement": "B2.4.1 generalized successfully / partially / poorly to unseen cases",
            "forbiddenStatement": "B2.4.1 outperformed B2 on Holdout",
        },
        "automatedFactualMeasurements": {
            "holdoutStatus": generation["status"],
            "abortReason": generation.get("abortReason"),
            "runs": f"{generation['completedRuns']}/{config.RUNS}",
            "behaviorFingerprint": behavior_fingerprint,
            "holdoutExecutionProtocolFingerprint": execution_fingerprint,
            "finalHoldoutFreeze": freeze_status,
            "promptSemanticLineage": lineage,
            "goldIsolation": gold_isolation,
            "transport": transport,
            "outcome": evaluation["outcomeLayer"] if complete and evaluation else NOT_COMPUTED,
            "grounding": grounding if complete and grounding else NOT_COMPUTED,
            "operation": evaluation["operation"] if complete and evaluation else NOT_COMPUTED,
        },
        "topologyDeviationPolicy": {
            "modelGenerated": "RECORD_UNMAPPABLE_AND_CONTINUE",
            "harnessCorruption": "ABORTED_INTEGRITY",
            "unmappableIsATerminalSemanticResult": True,
            "unmappableCountsAsIncorrectInPhase2": True,
            "finalStateInvented": False,
            "requirementSelection": "FORBIDDEN",
        },
        "manualSemanticAdjudicationRequired": {
            "level1": "all 30 holdout runs" if complete else NOT_COMPUTED,
            "level2": config.LEVEL2_SELECTION,
            "note": ("Semantic correctness is not asserted automatically where the evaluator "
                     "cannot establish it. Every unmappable run triggers Level 2."),
        },
        "generalization": generalization if complete and generalization else NOT_COMPUTED,
        "developmentVsHoldout": comparison if complete and comparison else NOT_COMPUTED,
        "postHoldoutRule": {
            "noPromptTuning": True, "noSchemaTuning": True, "noPolicyTuning": True,
            "noSixthRepetition": True, "noSelectiveRerun": True,
            "note": ("These six cases cannot become a new Development set. A successor "
                     "architecture needs a new, independent generalization protocol."),
        },
    }
