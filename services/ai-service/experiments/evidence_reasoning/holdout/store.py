from __future__ import annotations

"""Holdout durable store and attempt ledger.

Both classes SUBCLASS the Development-validated implementations. Only three
things are overridden: campaign identity, the frozen budgets, and the execution
order the index is rebuilt over. Atomic writes, hash validation, the
durable-artifact-outranks-bookkeeping authority rule and the whole accounting
path are the same code that ran the 165-call Development campaign.
"""

from pathlib import Path
from typing import Any

from ..campaign.store import (  # noqa: F401  (re-exported helpers, config-independent)
    CampaignStore,
    ProviderAttemptLedger,
    atomic_write_json,
    read_json,
    sha256_json,
    sha256_text,
)
from . import config


class HoldoutAttemptLedger(ProviderAttemptLedger):
    """Same ledger, Holdout budgets."""

    def __init__(self, path: Path):
        self.path = path
        if path.exists():
            self.payload = read_json(path)
        else:
            self.payload = {
                "ledgerSchemaVersion": "b241_holdout_attempt_ledger_v1",
                "campaignId": config.CAMPAIGN_ID,
                "logicalProviderCallsPlanned": config.LOGICAL_PROVIDER_CALLS,
                "transportRecoveryReserve": config.TRANSPORT_RECOVERY_RESERVE,
                "absoluteProviderAttemptCap": config.ABSOLUTE_PROVIDER_ATTEMPT_CAP,
                "maxAttemptsPerLogicalCall": config.MAX_ATTEMPTS_PER_LOGICAL_CALL,
                "providerAttempts": 0,
                "successfulSemanticOutputs": 0,
                "failedTransportAttempts": 0,
                "recoveredTransportCalls": 0,
                "recoveryReserveUsed": 0,
                "attemptsByStage": {},
                "logicalCalls": {},
                "status": "READY",
            }
            self._save()

    def may_attempt(self, logical_call_id: str, *, is_recovery: bool) -> tuple[bool, str]:
        # Re-declared against Holdout budgets: the base implementation reads the
        # Development module-level constants, which must not govern this campaign.
        if self.attempts_for(logical_call_id) >= config.MAX_ATTEMPTS_PER_LOGICAL_CALL:
            return False, "PER_LOGICAL_CALL_ATTEMPT_CAP"
        if self.payload["providerAttempts"] + 1 > config.ABSOLUTE_PROVIDER_ATTEMPT_CAP:
            return False, "ABSOLUTE_PROVIDER_ATTEMPT_CAP"
        if is_recovery and self.payload["recoveryReserveUsed"] + 1 > config.TRANSPORT_RECOVERY_RESERVE:
            return False, "TRANSPORT_RECOVERY_RESERVE_EXHAUSTED"
        return True, "OK"


class HoldoutStore(CampaignStore):
    """Same durable store, Holdout execution order and campaign identity."""

    def persist_run(self, run_id: str, run: dict[str, Any]) -> str:
        """Re-stamp campaign identity, then persist through the inherited path.

        The semantic body of a run is produced by the unmodified Development
        generation function, which stamps the Development campaign id. Identity
        is an execution concern, so it is corrected here rather than by forking
        that function and risking semantic drift.

        The same applies to the unmappable marking of a `DECOMPOSITION_AMBIGUOUS`
        run: `campaign.generation.run_case` already persists that run correctly —
        no Unified call, no invented final state — so the Holdout layer only adds
        its own orchestration metadata on top. No semantic schema is touched.
        """
        body = dict(run)
        metadata = dict(body.get("metadata") or {})
        metadata["campaignId"] = config.CAMPAIGN_ID
        metadata["executionProtocol"] = "HOLDOUT"
        if (metadata.get("runStatus") == "DECOMPOSITION_AMBIGUOUS"
                and not metadata.get("unmappableRun")):
            metadata["unmappableRun"] = True
            metadata["unmappableReason"] = config.UNMAPPABLE_AMBIGUOUS
            metadata["unmappableClassification"] = "MODEL_GENERATED_TOPOLOGY_DEVIATION"
            metadata["unifiedCallIssued"] = False
            metadata["unusedLogicalCallSlot"] = "DISCARDED_NOT_REASSIGNED"
        body["metadata"] = metadata
        return super().persist_run(run_id, body)

    def rebuild_index(self) -> dict[str, Any]:
        order = config.execution_order()
        runs: dict[str, Any] = {}
        for entry in order:
            run_id = str(entry["runId"])
            durable = self.durable_run(run_id)
            if durable is not None:
                runs[run_id] = {"state": config.COMPLETE,
                                "stages": {s: config.COMPLETE for s in config.STAGES}}
                continue
            stages = {}
            for stage in config.STAGES:
                path = self.response_path(run_id, stage)
                stages[stage] = config.COMPLETE if path.exists() else config.NOT_STARTED
            any_stage = any(v == config.COMPLETE for v in stages.values())
            runs[run_id] = {"state": config.INCOMPLETE if any_stage else config.NOT_STARTED,
                            "stages": stages}
        index = {
            "indexSchemaVersion": "b241_holdout_checkpoint_state_v1",
            "campaignId": config.CAMPAIGN_ID,
            "authority": "DURABLE_ARTIFACTS_OUTRANK_BOOKKEEPING",
            "completedRuns": sum(v["state"] == config.COMPLETE for v in runs.values()),
            "plannedRuns": config.RUNS,
            "runs": runs,
        }
        atomic_write_json(self.index_path, index)
        return index

    def next_run(self) -> dict[str, object] | None:
        index = self.rebuild_index()
        for entry in config.execution_order():
            if index["runs"][str(entry["runId"])]["state"] != config.COMPLETE:
                return entry
        return None
