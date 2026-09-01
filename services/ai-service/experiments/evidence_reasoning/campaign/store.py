from __future__ import annotations

"""Crash-safe durable store, attempt ledger and checkpoint index.

Authority rule: the durable artifact on disk outranks any bookkeeping flag. On
resume the index is rebuilt from artifacts, never the other way round.
"""

import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any

from . import config


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_json(payload: Any) -> str:
    return sha256_text(json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")))


def atomic_write_json(path: Path, payload: Any) -> str:
    """temp file -> flush -> fsync -> atomic replace. Returns the content hash."""
    path.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    handle = tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=str(path.parent), delete=False, suffix=".tmp")
    try:
        handle.write(body)
        handle.flush()
        os.fsync(handle.fileno())
    finally:
        handle.close()
    os.replace(handle.name, path)
    return sha256_text(body)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


class ProviderAttemptLedger:
    """Separates LogicalProviderCall from ProviderAttempt and enforces every cap."""

    def __init__(self, path: Path):
        self.path = path
        if path.exists():
            self.payload = read_json(path)
        else:
            self.payload = {
                "ledgerSchemaVersion": "b241_provider_attempt_ledger_v1",
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

    # -- accounting -------------------------------------------------------
    def _call(self, logical_call_id: str) -> dict[str, Any]:
        return self.payload["logicalCalls"].setdefault(
            logical_call_id, {"attempts": [], "state": "PENDING"})

    def attempts_for(self, logical_call_id: str) -> int:
        return len(self._call(logical_call_id)["attempts"])

    def may_attempt(self, logical_call_id: str, *, is_recovery: bool) -> tuple[bool, str]:
        if self.attempts_for(logical_call_id) >= config.MAX_ATTEMPTS_PER_LOGICAL_CALL:
            return False, "PER_LOGICAL_CALL_ATTEMPT_CAP"
        if self.payload["providerAttempts"] + 1 > config.ABSOLUTE_PROVIDER_ATTEMPT_CAP:
            return False, "ABSOLUTE_PROVIDER_ATTEMPT_CAP"
        if is_recovery and self.payload["recoveryReserveUsed"] + 1 > config.TRANSPORT_RECOVERY_RESERVE:
            return False, "TRANSPORT_RECOVERY_RESERVE_EXHAUSTED"
        return True, "OK"

    def record(self, logical_call_id: str, *, stage: str, attempt_index: int, state: str,
               is_recovery: bool, prompt_hash: str, detail: dict[str, Any] | None = None) -> None:
        call = self._call(logical_call_id)
        call["attempts"].append({
            "attemptId": f"{logical_call_id}#a{attempt_index}",
            "attemptIndex": attempt_index, "state": state, "isRecovery": is_recovery,
            "stage": stage, "promptHash": prompt_hash, "detail": detail or {},
        })
        self.payload["providerAttempts"] += 1
        self.payload["attemptsByStage"][stage] = self.payload["attemptsByStage"].get(stage, 0) + 1
        if is_recovery:
            self.payload["recoveryReserveUsed"] += 1
        if state == config.SUCCESS:
            call["state"] = config.SUCCESS
            self.payload["successfulSemanticOutputs"] += 1
            if is_recovery:
                self.payload["recoveredTransportCalls"] += 1
        elif state == config.FAILED_TRANSPORT:
            call["state"] = config.FAILED_TRANSPORT
            self.payload["failedTransportAttempts"] += 1
        else:
            call["state"] = config.FAILED_NONRECOVERABLE
        self._save()

    def note_reused_from_durable(self, logical_call_id: str, stage: str) -> None:
        """A durable semantic response already exists: no provider attempt is spent."""
        call = self._call(logical_call_id)
        call["state"] = config.SUCCESS
        call["reusedFromDurableResponse"] = True
        self._save()

    def finish(self, status: str) -> None:
        self.payload["status"] = status
        self._save()

    def _save(self) -> None:
        atomic_write_json(self.path, self.payload)


class CampaignStore:
    """Durable per-stage raw responses, per-run artifacts and a rebuilt index."""

    def __init__(self, root: Path):
        self.root = root
        self.responses = root / "responses"
        self.runs = root / "runs"
        self.index_path = root / "checkpoint-state.json"
        for directory in (self.responses, self.runs):
            directory.mkdir(parents=True, exist_ok=True)

    # -- durable raw semantic responses -----------------------------------
    def response_path(self, run_id: str, stage: str) -> Path:
        return self.responses / run_id / f"{stage}.json"

    def durable_response(self, run_id: str, stage: str, prompt_hash: str) -> dict[str, Any] | None:
        """Return the stored response only if it matches this exact logical call."""
        path = self.response_path(run_id, stage)
        if not path.exists():
            return None
        try:
            payload = read_json(path)
        except (OSError, ValueError):
            return None
        if payload.get("promptHash") != prompt_hash:
            return None
        if sha256_json(payload.get("output")) != payload.get("responseHash"):
            return None
        return payload

    def persist_response(self, run_id: str, stage: str, *, prompt_hash: str, output: Any,
                         logical_call_id: str, attempt_id: str, requested_model: str,
                         effective_model: str, usage: dict[str, Any], latency_ms: int) -> str:
        payload = {
            "logicalCallId": logical_call_id, "attemptId": attempt_id,
            "runId": run_id, "stage": stage, "promptHash": prompt_hash,
            "requestedModel": requested_model, "effectiveModel": effective_model,
            "reasoningEffort": config.REASONING_EFFORT,
            "timeoutSeconds": config.PROVIDER_TIMEOUT_SECONDS,
            "usage": usage, "latencyMs": latency_ms,
            "responseHash": sha256_json(output), "output": output,
        }
        atomic_write_json(self.response_path(run_id, stage), payload)
        return payload["responseHash"]

    # -- per-run artifacts -------------------------------------------------
    def run_path(self, run_id: str) -> Path:
        return self.runs / f"{run_id}.json"

    def durable_run(self, run_id: str) -> dict[str, Any] | None:
        path = self.run_path(run_id)
        if not path.exists():
            return None
        try:
            payload = read_json(path)
        except (OSError, ValueError):
            return None
        stored = payload.get("runArtifactHash")
        body = {k: v for k, v in payload.items() if k != "runArtifactHash"}
        return payload if stored == sha256_json(body) else None

    def persist_run(self, run_id: str, run: dict[str, Any]) -> str:
        body = dict(run)
        body.pop("runArtifactHash", None)
        digest = sha256_json(body)
        atomic_write_json(self.run_path(run_id), {**body, "runArtifactHash": digest})
        return digest

    # -- index, rebuilt from artifacts ------------------------------------
    def rebuild_index(self) -> dict[str, Any]:
        """Durable artifacts are authority; the index is derived, never trusted."""
        order = config.execution_order()
        runs: dict[str, Any] = {}
        for entry in order:
            run_id = str(entry["runId"])
            durable = self.durable_run(run_id)
            if durable is not None:
                runs[run_id] = {"state": config.COMPLETE, "stages": {s: config.COMPLETE for s in config.STAGES}}
                continue
            stages = {}
            for stage in config.STAGES:
                path = self.response_path(run_id, stage)
                stages[stage] = config.COMPLETE if path.exists() else config.NOT_STARTED
            any_stage = any(v == config.COMPLETE for v in stages.values())
            runs[run_id] = {"state": config.INCOMPLETE if any_stage else config.NOT_STARTED, "stages": stages}
        index = {
            "indexSchemaVersion": "b241_checkpoint_state_v1",
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
