"""Offline failure-injection tests for the B2.4.1 Full Development execution protocol.

Every test uses a stub provider. Zero live provider calls.
"""
from __future__ import annotations

import http.client
import json
import socket
from pathlib import Path
from typing import Any

import pytest

from experiments.evidence_reasoning.campaign import config, integrity
from experiments.evidence_reasoning.campaign.generation import CampaignAbort, run_case
from experiments.evidence_reasoning.campaign.store import CampaignStore, ProviderAttemptLedger
from experiments.evidence_reasoning.campaign.transport import classify
from experiments.evidence_reasoning.fixtures import load_cases
from experiments.evidence_reasoning.models import ProviderResult

CASE = load_cases(split="dev", case_ids={"case_01"})[0]
SLEEPS: list[float] = []


def _sleep(seconds: float) -> None:
    SLEEPS.append(seconds)


def _payloads(objective: str) -> dict[str, Any]:
    quote = "Requisito formativo: cartografía."
    return {
        "b24_evidence_unit_catalog": {"evidenceUnits": []},
        "b24_objective_analysis": {
            "decompositionStatus": "AMBIGUOUS", "objectiveContext": objective[:20],
            "candidateSegments": [], "ambiguityRationale": "stub", "requirements": []},
        "b24_unified_reasoning": {},
    }


class StubProvider:
    """Deterministic stub. `script` maps schema_name -> list of outcomes."""

    provider = "stub"
    model = config.MODEL
    reasoning_effort = config.REASONING_EFFORT
    timeout = config.PROVIDER_TIMEOUT_SECONDS

    def __init__(self, script: dict[str, list[Any]] | None = None, effective_model: str | None = None):
        self.script = script or {}
        self.calls: list[str] = []
        self.effective_model = effective_model or config.MODEL

    def complete(self, *, prompt: str, schema_name: str, schema: dict[str, Any]) -> ProviderResult:
        self.calls.append(schema_name)
        queue = self.script.get(schema_name)
        outcome = queue.pop(0) if queue else _payloads(CASE.objective)[schema_name]
        if isinstance(outcome, BaseException):
            raise outcome
        return ProviderResult(output=outcome, provider="stub", requested_model=config.MODEL,
                              effective_model=self.effective_model, latency_ms=1,
                              usage={"input_tokens": 1, "output_tokens": 1})


def _harness(tmp_path: Path):
    return CampaignStore(tmp_path), ProviderAttemptLedger(tmp_path / "attempt-ledger.json")


# --------------------------------------------------------------------------
# Transport taxonomy
# --------------------------------------------------------------------------

@pytest.mark.parametrize("error,expected", [
    (TimeoutError("The read operation timed out"), "READ_TIMEOUT"),
    (socket.timeout("timed out"), "READ_TIMEOUT"),
    (ConnectionResetError("connection reset by peer"), "CONNECTION_RESET"),
    (http.client.IncompleteRead(b""), "PREMATURE_EOF"),
    (RuntimeError("provider_http_502:bad gateway"), "HTTP_502_NO_SEMANTIC_RESPONSE"),
    (RuntimeError("provider_http_503:unavailable"), "HTTP_503_NO_SEMANTIC_RESPONSE"),
    (RuntimeError("provider_http_504:gateway timeout"), "HTTP_504_NO_SEMANTIC_RESPONSE"),
])
def test_eligible_transport_categories(error, expected):
    verdict = classify(error, semantic_response_available=False)
    assert verdict.category == expected and verdict.eligible is True


@pytest.mark.parametrize("error,expected", [
    (RuntimeError("provider_http_401:unauthorized"), "AUTHENTICATION_OR_QUOTA"),
    (RuntimeError("provider_http_429:rate limited"), "AUTHENTICATION_OR_QUOTA"),
    (RuntimeError("provider_http_400:bad request"), "HTTP_4XX_NO_RETRY"),
    (RuntimeError("openai_output_not_json"), "MODEL_MALFORMED_OUTPUT"),
    (ValueError("invalid_b24_unified_reasoning_schema: ..."), "SCHEMA_INVALID_OUTPUT"),
])
def test_non_eligible_categories(error, expected):
    verdict = classify(error, semantic_response_available=False)
    assert verdict.category == expected and verdict.eligible is False


def test_durable_response_makes_every_failure_non_eligible():
    verdict = classify(TimeoutError("timed out"), semantic_response_available=True)
    assert verdict.category == "SEMANTIC_RESPONSE_RECEIVED" and verdict.eligible is False


# --------------------------------------------------------------------------
# Recovery on each stage
# --------------------------------------------------------------------------

def test_read_timeout_on_evidence_unit_recovers(tmp_path):
    SLEEPS.clear()
    store, ledger = _harness(tmp_path)
    provider = StubProvider({"b24_evidence_unit_catalog": [TimeoutError("read timed out"), {"evidenceUnits": []}]})
    run_case(CASE, 1, provider=provider, store=store, ledger=ledger, sleep=_sleep)
    assert ledger.payload["failedTransportAttempts"] == 1
    assert ledger.payload["recoveredTransportCalls"] == 1
    assert ledger.payload["recoveryReserveUsed"] == 1
    assert SLEEPS == [config.TRANSPORT_RETRY_BACKOFF_SECONDS]


def test_read_timeout_on_objective_reuses_frozen_evidence_unit(tmp_path):
    SLEEPS.clear()
    store, ledger = _harness(tmp_path)
    provider = StubProvider({"b24_objective_analysis": [TimeoutError("read timed out"),
                                                        _payloads(CASE.objective)["b24_objective_analysis"]]})
    run_case(CASE, 1, provider=provider, store=store, ledger=ledger, sleep=_sleep)
    # Exactly one EvidenceUnit call: the recovery never regenerates a completed stage.
    assert provider.calls.count("b24_evidence_unit_catalog") == 1
    assert provider.calls.count("b24_objective_analysis") == 2
    assert ledger.payload["recoveredTransportCalls"] == 1


def test_second_transport_failure_on_same_logical_call_aborts(tmp_path):
    SLEEPS.clear()
    store, ledger = _harness(tmp_path)
    provider = StubProvider({"b24_evidence_unit_catalog": [TimeoutError("t1"), TimeoutError("t2")]})
    with pytest.raises(CampaignAbort) as excinfo:
        run_case(CASE, 1, provider=provider, store=store, ledger=ledger, sleep=_sleep)
    assert excinfo.value.state == config.ABORTED_INFRASTRUCTURE
    assert ledger.attempts_for("case_01_r1#evidence_unit") == config.MAX_ATTEMPTS_PER_LOGICAL_CALL


def test_non_eligible_failure_never_retries(tmp_path):
    store, ledger = _harness(tmp_path)
    provider = StubProvider({"b24_evidence_unit_catalog": [RuntimeError("provider_http_401:unauthorized")]})
    with pytest.raises(CampaignAbort):
        run_case(CASE, 1, provider=provider, store=store, ledger=ledger, sleep=_sleep)
    assert provider.calls.count("b24_evidence_unit_catalog") == 1
    assert ledger.payload["failedTransportAttempts"] == 0


def test_schema_invalid_fully_received_output_is_not_retried(tmp_path):
    store, ledger = _harness(tmp_path)
    # A received-but-invalid payload raises during validation, outside the attempt loop.
    provider = StubProvider({"b24_evidence_unit_catalog": [{"evidenceUnits": [{"bogus": True}]}]})
    with pytest.raises(ValueError):
        run_case(CASE, 1, provider=provider, store=store, ledger=ledger, sleep=_sleep)
    assert provider.calls.count("b24_evidence_unit_catalog") == 1
    assert ledger.payload["providerAttempts"] == 1


def test_effective_model_mismatch_aborts_integrity(tmp_path):
    store, ledger = _harness(tmp_path)
    provider = StubProvider(effective_model="some-other-model")
    with pytest.raises(CampaignAbort) as excinfo:
        run_case(CASE, 1, provider=provider, store=store, ledger=ledger, sleep=_sleep)
    assert excinfo.value.state == config.ABORTED_INTEGRITY


# --------------------------------------------------------------------------
# Durability, crash recovery, resume
# --------------------------------------------------------------------------

def test_durable_response_is_reused_without_any_provider_call(tmp_path):
    store, ledger = _harness(tmp_path)
    run_case(CASE, 1, provider=StubProvider(), store=store, ledger=ledger, sleep=_sleep)
    # Simulate a crash after the response was persisted but before the run artifact.
    store.run_path("case_01_r1").unlink()
    second = StubProvider()
    ledger2 = ProviderAttemptLedger(tmp_path / "attempt-ledger-2.json")
    run_case(CASE, 1, provider=second, store=store, ledger=ledger2, sleep=_sleep)
    assert second.calls == []
    assert ledger2.payload["providerAttempts"] == 0


def test_completed_run_is_never_rerun(tmp_path):
    store, ledger = _harness(tmp_path)
    run_case(CASE, 1, provider=StubProvider(), store=store, ledger=ledger, sleep=_sleep)
    second = StubProvider()
    run_case(CASE, 1, provider=second, store=store, ledger=ledger, sleep=_sleep)
    assert second.calls == []


def test_index_is_rebuilt_from_artifacts_not_bookkeeping(tmp_path):
    store, ledger = _harness(tmp_path)
    run_case(CASE, 1, provider=StubProvider(), store=store, ledger=ledger, sleep=_sleep)
    # No bookkeeping index exists yet: only the durable artifact does.
    store.index_path.unlink(missing_ok=True)
    index = store.rebuild_index()
    assert index["runs"]["case_01_r1"]["state"] == config.COMPLETE
    assert index["completedRuns"] == 1
    # Deleting the index again must still yield the same derived state.
    store.index_path.unlink()
    assert store.rebuild_index()["runs"]["case_01_r1"]["state"] == config.COMPLETE


def test_corrupted_response_hash_is_not_trusted(tmp_path):
    store, ledger = _harness(tmp_path)
    run_case(CASE, 1, provider=StubProvider(), store=store, ledger=ledger, sleep=_sleep)
    path = store.response_path("case_01_r1", "evidence_unit")
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["responseHash"] = "0" * 64
    path.write_text(json.dumps(payload), encoding="utf-8")
    assert store.durable_response("case_01_r1", "evidence_unit", payload["promptHash"]) is None


def test_next_run_resumes_at_first_incomplete(tmp_path):
    store, _ = _harness(tmp_path)
    assert store.next_run()["runId"] == "case_01_r1"


# --------------------------------------------------------------------------
# Budget caps
# --------------------------------------------------------------------------

def test_recovery_reserve_exhaustion_blocks_further_recovery(tmp_path):
    _, ledger = _harness(tmp_path)
    for index in range(config.TRANSPORT_RECOVERY_RESERVE):
        ledger.record(f"call_{index}", stage="evidence_unit", attempt_index=2,
                      state=config.FAILED_TRANSPORT, is_recovery=True, prompt_hash="h")
    allowed, reason = ledger.may_attempt("call_new", is_recovery=True)
    assert allowed is False and reason == "TRANSPORT_RECOVERY_RESERVE_EXHAUSTED"


def test_attempt_171_is_prevented(tmp_path):
    _, ledger = _harness(tmp_path)
    ledger.payload["providerAttempts"] = config.ABSOLUTE_PROVIDER_ATTEMPT_CAP
    allowed, reason = ledger.may_attempt("call_x", is_recovery=False)
    assert allowed is False and reason == "ABSOLUTE_PROVIDER_ATTEMPT_CAP"


def test_per_logical_call_cap_is_two(tmp_path):
    _, ledger = _harness(tmp_path)
    for attempt in (1, 2):
        ledger.record("call_y", stage="objective_analysis", attempt_index=attempt,
                      state=config.FAILED_TRANSPORT, is_recovery=attempt > 1, prompt_hash="h")
    allowed, reason = ledger.may_attempt("call_y", is_recovery=True)
    assert allowed is False and reason == "PER_LOGICAL_CALL_ATTEMPT_CAP"


def test_budget_numbers_are_frozen():
    assert config.LOGICAL_PROVIDER_CALLS == 165
    assert config.TRANSPORT_RECOVERY_RESERVE == 5
    assert config.ABSOLUTE_PROVIDER_ATTEMPT_CAP == 170
    assert config.MAX_ATTEMPTS_PER_LOGICAL_CALL == 2
    assert config.PROVIDER_TIMEOUT_SECONDS == 360
    assert config.TRANSPORT_RETRY_BACKOFF_SECONDS == 15
    assert config.MAX_CONCURRENT_LOGICAL_CALLS == 1


# --------------------------------------------------------------------------
# Order, holdout, fingerprints
# --------------------------------------------------------------------------

def test_execution_order_is_the_frozen_55():
    order = config.execution_order()
    assert len(order) == 55
    assert order[0]["runId"] == "case_01_r1" and order[-1]["runId"] == "case_15_r5"
    assert not {str(e["caseId"]) for e in order} & config.HOLDOUT_CASES


def test_recovery_uses_identical_prompt_hash(tmp_path):
    SLEEPS.clear()
    store, ledger = _harness(tmp_path)
    provider = StubProvider({"b24_objective_analysis": [TimeoutError("t"),
                                                        _payloads(CASE.objective)["b24_objective_analysis"]]})
    run_case(CASE, 1, provider=provider, store=store, ledger=ledger, sleep=_sleep)
    attempts = ledger.payload["logicalCalls"]["case_01_r1#objective_analysis"]["attempts"]
    assert len({a["promptHash"] for a in attempts}) == 1


def test_execution_protocol_fingerprint_is_distinct_from_behavior():
    execution = integrity.execution_protocol_fingerprint()["combinedSha256"]
    assert execution != config.B241_BEHAVIOR_FINGERPRINT
    assert len(execution) == 64


def test_freeze_manifest_verifies_against_itself():
    manifest = integrity.freeze_manifest()
    status, drift = integrity.verify(manifest)
    assert status == "PASS" and drift == []


def test_semantic_clause_lineage_passes():
    status, presence = integrity.semantic_clause_lineage()
    assert status == "PASS"
    assert all(presence.values())


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__]))
