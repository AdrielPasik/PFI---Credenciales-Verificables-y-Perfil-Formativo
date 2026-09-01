"""Offline failure-injection and isolation tests for the B2.4.1 Holdout protocol.

Every test uses a stub provider. Zero live provider calls, zero Holdout runs.
"""
from __future__ import annotations

import http.client
import json
import socket
from pathlib import Path
from typing import Any

import pytest

from experiments.evidence_reasoning.campaign import config as dev_config
from experiments.evidence_reasoning.campaign import integrity as dev_integrity
from experiments.evidence_reasoning.campaign.generation import CampaignAbort, run_case
from experiments.evidence_reasoning.campaign.transport import classify
from experiments.evidence_reasoning.fixtures import load_cases
from experiments.evidence_reasoning.holdout import adjudication, config, evaluation, integrity
from experiments.evidence_reasoning.holdout.generation import _load_holdout_case, run_campaign
from experiments.evidence_reasoning.holdout.store import HoldoutAttemptLedger, HoldoutStore
from experiments.evidence_reasoning.models import FixtureCase, ProviderResult

CASE = load_cases(split="holdout", case_ids={"case_02"})[0]
RUN_ID = "case_02_r1"
SLEEPS: list[float] = []


def _sleep(seconds: float) -> None:
    SLEEPS.append(seconds)


def _payloads(objective: str) -> dict[str, Any]:
    return {
        "b24_evidence_unit_catalog": {"evidenceUnits": []},
        "b24_objective_analysis": {
            "decompositionStatus": "AMBIGUOUS", "objectiveContext": objective[:20],
            "candidateSegments": [], "ambiguityRationale": "stub", "requirements": []},
        "b24_unified_reasoning": {},
    }


class StubProvider:
    provider = "stub"
    model = config.MODEL
    reasoning_effort = config.REASONING_EFFORT
    timeout = config.PROVIDER_TIMEOUT_SECONDS

    def __init__(self, script: dict[str, list[Any]] | None = None, effective_model: str | None = None):
        self.script = script or {}
        self.calls: list[str] = []
        self.prompts: list[str] = []
        self.effective_model = effective_model or config.MODEL

    def complete(self, *, prompt: str, schema_name: str, schema: dict[str, Any]) -> ProviderResult:
        self.calls.append(schema_name)
        self.prompts.append(prompt)
        queue = self.script.get(schema_name)
        outcome = queue.pop(0) if queue else _payloads(CASE.objective)[schema_name]
        if isinstance(outcome, BaseException):
            raise outcome
        return ProviderResult(output=outcome, provider="stub", requested_model=config.MODEL,
                              effective_model=self.effective_model, latency_ms=1,
                              usage={"input_tokens": 1, "output_tokens": 1})


def _harness(tmp_path: Path):
    return HoldoutStore(tmp_path), HoldoutAttemptLedger(tmp_path / "holdout-attempt-ledger.json")


# --------------------------------------------------------------------------
# Candidate and split preconditions
# --------------------------------------------------------------------------

def test_behavior_fingerprint_is_unchanged():
    from experiments.evidence_reasoning.b241_fingerprint import b241_behavior_fingerprint
    assert (b241_behavior_fingerprint()["combinedSha256"]
            == "55f37a8529c046e750f4e0351f544dabca1fb7bb9796b05fc1c860b5c979d6fc"
            == config.B241_BEHAVIOR_FINGERPRINT)


def test_holdout_split_is_exactly_the_six_frozen_cases():
    audit = integrity.holdout_split_audit()
    assert audit["SPLIT_CONFIRMED"] == "PASS"
    assert audit["declared"] == audit["fixtureHoldoutSplit"] == [
        "case_02", "case_04", "case_10", "case_14", "case_16", "case_17"]
    assert audit["developmentOverlap"] == []


def test_development_cases_are_complete_and_disjoint():
    assert len(config.DEVELOPMENT_CASES) == 11
    assert "case_13" in config.DEVELOPMENT_CASES
    assert not set(config.DEVELOPMENT_CASES) & set(config.HOLDOUT_CASES)


def test_development_case_is_refused_by_holdout_selection():
    with pytest.raises(AssertionError):
        _load_holdout_case("case_03")


def test_unknown_case_is_refused():
    with pytest.raises(CampaignAbort):
        _load_holdout_case("case_99")


# --------------------------------------------------------------------------
# Topology and budget
# --------------------------------------------------------------------------

def test_topology_expects_one_unified_call_per_run():
    audit = integrity.topology_audit()
    assert audit["TOPOLOGY"] == "SINGLE_REQUIREMENT_EXPECTED"
    assert audit["deviations"] == []
    assert audit["expectedLogicalCalls"] == 90
    assert all(row["requirementClauses"] == 1 for row in audit["perCase"].values())


def test_budget_numbers_are_frozen():
    assert config.RUNS == 30
    assert config.LOGICAL_PROVIDER_CALLS == 90
    assert config.TRANSPORT_RECOVERY_RESERVE == 3
    assert config.ABSOLUTE_PROVIDER_ATTEMPT_CAP == 93
    assert config.MAX_ATTEMPTS_PER_LOGICAL_CALL == 2


def test_transport_conditions_are_identical_to_development():
    assert config.PROVIDER_TIMEOUT_SECONDS == dev_config.PROVIDER_TIMEOUT_SECONDS == 360
    assert config.TRANSPORT_RETRY_BACKOFF_SECONDS == dev_config.TRANSPORT_RETRY_BACKOFF_SECONDS == 15
    assert config.MAX_CONCURRENT_LOGICAL_CALLS == dev_config.MAX_CONCURRENT_LOGICAL_CALLS == 1
    assert (config.PROVIDER, config.MODEL, config.REASONING_EFFORT) == (
        dev_config.PROVIDER, dev_config.MODEL, dev_config.REASONING_EFFORT)


def test_execution_order_is_the_frozen_thirty():
    order = config.execution_order()
    assert len(order) == 30
    assert order[0]["runId"] == "case_02_r1" and order[-1]["runId"] == "case_17_r5"
    assert not {str(e["caseId"]) for e in order} & set(config.DEVELOPMENT_CASES)


# --------------------------------------------------------------------------
# Gold isolation
# --------------------------------------------------------------------------

def test_gold_isolation_audit_passes():
    audit = integrity.gold_isolation_audit()
    assert audit["GOLD_ISOLATION"] == "PASS", audit["findings"]
    assert audit["inputGoldIsolation"] == "PASS"


def test_generation_import_closure_never_reaches_gold():
    audit = integrity.gold_isolation_audit()
    assert audit["generationClosureImportsGold"] is False
    assert audit["generationClosureGoldReferences"] == []
    assert "gold.py" not in audit["generationImportClosure"]


def test_no_holdout_case_specific_logic_in_generation_path():
    audit = integrity.gold_isolation_audit()
    assert audit["caseSpecificLogicOutsideConfig"] == []
    # Both config modules must actually be in the closure, otherwise the check
    # above is vacuously true. `from . import config` imports a SUBMODULE; an
    # import walker that only resolves the package would miss it entirely.
    assert set(audit["holdoutCaseIdSites"]) == {"holdout/config.py", "campaign/config.py"}


def test_import_closure_resolves_submodule_imports():
    closure = integrity.gold_isolation_audit()["generationImportClosure"]
    for expected in ("holdout/config.py", "campaign/config.py", "campaign/transport.py",
                     "campaign/store.py", "holdout/store.py", "fixtures.py"):
        assert expected in closure, f"{expected} missing from generation import closure"


def test_prompts_are_byte_identical_to_the_closed_development_freeze():
    """The decisive, non-circular isolation proof.

    These hashes were written before the first Development provider call, so if
    the prompts still hash to them, nothing derived from Holdout gold can have
    entered them during this preparation.
    """
    audit = integrity.gold_isolation_audit()
    assert audit["promptsUnchangedSinceDevelopmentFreeze"] is True
    assert audit["promptDrift"] == []
    assert audit["effectivePromptHashes"] == audit["developmentFrozenPromptHashes"]


def test_no_holdout_gold_phrase_reaches_the_effective_prompts():
    audit = integrity.gold_isolation_audit()
    probe = audit["goldPhraseProbe"]
    assert probe["holdoutGoldPhraseCount"] > 0 and probe["promptPhraseCount"] > 0, "probe vacuous"
    assert probe["overlap"] == []


def test_evaluation_is_the_only_gold_touching_module():
    closure = integrity.import_closure(Path(integrity.PACKAGE) / "generation.py")
    names = {p.name for p in closure}
    assert "gold.py" not in names
    assert "evaluation.py" not in names


# --------------------------------------------------------------------------
# Transport taxonomy — unchanged, re-asserted for this campaign
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
# Recovery, durability and resume under Holdout budgets
# --------------------------------------------------------------------------

def test_read_timeout_on_evidence_unit_recovers(tmp_path):
    SLEEPS.clear()
    store, ledger = _harness(tmp_path)
    provider = StubProvider({"b24_evidence_unit_catalog": [TimeoutError("read timed out"),
                                                           {"evidenceUnits": []}]})
    run_case(CASE, 1, provider=provider, store=store, ledger=ledger, sleep=_sleep)
    assert ledger.payload["failedTransportAttempts"] == 1
    assert ledger.payload["recoveredTransportCalls"] == 1
    assert ledger.payload["recoveryReserveUsed"] == 1
    assert SLEEPS == [config.TRANSPORT_RETRY_BACKOFF_SECONDS]


def test_read_timeout_on_objective_reuses_frozen_evidence_unit(tmp_path):
    SLEEPS.clear()
    store, ledger = _harness(tmp_path)
    provider = StubProvider({"b24_objective_analysis": [
        TimeoutError("read timed out"), _payloads(CASE.objective)["b24_objective_analysis"]]})
    run_case(CASE, 1, provider=provider, store=store, ledger=ledger, sleep=_sleep)
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
    assert ledger.attempts_for(f"{RUN_ID}#evidence_unit") == config.MAX_ATTEMPTS_PER_LOGICAL_CALL


def test_non_eligible_failure_never_retries(tmp_path):
    store, ledger = _harness(tmp_path)
    provider = StubProvider({"b24_evidence_unit_catalog": [RuntimeError("provider_http_401:unauthorized")]})
    with pytest.raises(CampaignAbort):
        run_case(CASE, 1, provider=provider, store=store, ledger=ledger, sleep=_sleep)
    assert provider.calls.count("b24_evidence_unit_catalog") == 1
    assert ledger.payload["failedTransportAttempts"] == 0


def test_schema_invalid_fully_received_output_is_not_retried(tmp_path):
    store, ledger = _harness(tmp_path)
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


def test_recovery_uses_identical_prompt_hash(tmp_path):
    SLEEPS.clear()
    store, ledger = _harness(tmp_path)
    provider = StubProvider({"b24_objective_analysis": [
        TimeoutError("t"), _payloads(CASE.objective)["b24_objective_analysis"]]})
    run_case(CASE, 1, provider=provider, store=store, ledger=ledger, sleep=_sleep)
    attempts = ledger.payload["logicalCalls"][f"{RUN_ID}#objective_analysis"]["attempts"]
    assert len({a["promptHash"] for a in attempts}) == 1


def test_durable_response_is_reused_without_any_provider_call(tmp_path):
    store, ledger = _harness(tmp_path)
    run_case(CASE, 1, provider=StubProvider(), store=store, ledger=ledger, sleep=_sleep)
    store.run_path(RUN_ID).unlink()
    second = StubProvider()
    ledger2 = HoldoutAttemptLedger(tmp_path / "ledger-2.json")
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
    store.index_path.unlink(missing_ok=True)
    index = store.rebuild_index()
    assert index["runs"][RUN_ID]["state"] == config.COMPLETE
    assert index["completedRuns"] == 1
    assert index["plannedRuns"] == 30


def test_corrupted_response_hash_is_not_trusted(tmp_path):
    store, ledger = _harness(tmp_path)
    run_case(CASE, 1, provider=StubProvider(), store=store, ledger=ledger, sleep=_sleep)
    path = store.response_path(RUN_ID, "evidence_unit")
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["responseHash"] = "0" * 64
    path.write_text(json.dumps(payload), encoding="utf-8")
    assert store.durable_response(RUN_ID, "evidence_unit", payload["promptHash"]) is None


def test_next_run_resumes_at_first_incomplete(tmp_path):
    store, _ = _harness(tmp_path)
    assert store.next_run()["runId"] == "case_02_r1"


def test_run_artifact_carries_holdout_identity(tmp_path):
    store, ledger = _harness(tmp_path)
    run_case(CASE, 1, provider=StubProvider(), store=store, ledger=ledger, sleep=_sleep)
    durable = store.durable_run(RUN_ID)
    assert durable["metadata"]["campaignId"] == config.CAMPAIGN_ID == "b241-holdout-v1"
    assert durable["metadata"]["executionProtocol"] == "HOLDOUT"


def test_crash_between_runs_resumes_without_regenerating(tmp_path):
    store, ledger = _harness(tmp_path)
    run_campaign(provider=StubProvider(), store=store,
                 ledger=HoldoutAttemptLedger(tmp_path / "l1.json"), sleep=_sleep,
                 progress=None)
    completed = store.rebuild_index()["completedRuns"]
    assert completed == 30
    resumed = StubProvider()
    result = run_campaign(provider=resumed, store=store,
                          ledger=HoldoutAttemptLedger(tmp_path / "l2.json"), sleep=_sleep)
    assert resumed.calls == []
    assert result["status"] == config.COMPLETE and result["completedRuns"] == 30


# --------------------------------------------------------------------------
# Holdout budget caps
# --------------------------------------------------------------------------

def test_recovery_reserve_exhaustion_blocks_further_recovery(tmp_path):
    _, ledger = _harness(tmp_path)
    for index in range(config.TRANSPORT_RECOVERY_RESERVE):
        ledger.record(f"call_{index}", stage="evidence_unit", attempt_index=2,
                      state=config.FAILED_TRANSPORT, is_recovery=True, prompt_hash="h")
    allowed, reason = ledger.may_attempt("call_new", is_recovery=True)
    assert allowed is False and reason == "TRANSPORT_RECOVERY_RESERVE_EXHAUSTED"


def test_attempt_94_is_prevented(tmp_path):
    _, ledger = _harness(tmp_path)
    ledger.payload["providerAttempts"] = config.ABSOLUTE_PROVIDER_ATTEMPT_CAP
    allowed, reason = ledger.may_attempt("call_x", is_recovery=False)
    assert allowed is False and reason == "ABSOLUTE_PROVIDER_ATTEMPT_CAP"


def test_holdout_ledger_does_not_inherit_development_budgets(tmp_path):
    _, ledger = _harness(tmp_path)
    ledger.payload["providerAttempts"] = 90
    allowed, _ = ledger.may_attempt("call_x", is_recovery=False)
    assert allowed is True          # 91 <= 93
    ledger.payload["providerAttempts"] = 93
    allowed, reason = ledger.may_attempt("call_y", is_recovery=False)
    assert allowed is False and reason == "ABSOLUTE_PROVIDER_ATTEMPT_CAP"
    assert ledger.payload["absoluteProviderAttemptCap"] == 93 != dev_config.ABSOLUTE_PROVIDER_ATTEMPT_CAP


def test_per_logical_call_cap_is_two(tmp_path):
    _, ledger = _harness(tmp_path)
    for attempt in (1, 2):
        ledger.record("call_y", stage="objective_analysis", attempt_index=attempt,
                      state=config.FAILED_TRANSPORT, is_recovery=attempt > 1, prompt_hash="h")
    allowed, reason = ledger.may_attempt("call_y", is_recovery=True)
    assert allowed is False and reason == "PER_LOGICAL_CALL_ATTEMPT_CAP"


# --------------------------------------------------------------------------
# Fingerprints and freeze
# --------------------------------------------------------------------------

def test_holdout_fingerprint_is_distinct_from_behavior_and_development():
    holdout_fp = integrity.execution_protocol_fingerprint()["combinedSha256"]
    assert holdout_fp != config.B241_BEHAVIOR_FINGERPRINT
    assert holdout_fp != dev_integrity.execution_protocol_fingerprint()["combinedSha256"]
    assert len(holdout_fp) == 64


def test_holdout_fingerprint_pins_the_development_harness():
    files = {item["path"] for item in integrity.execution_protocol_fingerprint()["files"]}
    assert "campaign/generation.py" in files
    assert "campaign/transport.py" in files
    assert "holdout/generation.py" in files


def test_development_execution_fingerprint_is_untouched():
    assert (dev_integrity.execution_protocol_fingerprint()["combinedSha256"]
            == "b0f5e01e443ba589490d573fbe728af05e7acd59899a1a7ce261535df0e6568e")


def test_freeze_manifest_verifies_against_itself():
    manifest = integrity.freeze_manifest()
    status, drift = integrity.verify(manifest)
    assert status == "PASS" and drift == []


def test_freeze_manifest_detects_behavior_drift():
    manifest = integrity.freeze_manifest()
    manifest["b241BehaviorFingerprint"] = "0" * 64
    status, drift = integrity.verify(manifest)
    assert status == "FAIL" and "b241BehaviorFingerprint" in drift


def test_semantic_clause_lineage_passes():
    status, presence = dev_integrity.semantic_clause_lineage()
    assert status == "PASS" and all(presence.values())


# --------------------------------------------------------------------------
# Frozen evaluation contract
# --------------------------------------------------------------------------

def _synthetic(majority: int, systematic: list[str] | None = None) -> dict[str, Any]:
    systematic = systematic or []
    per_case = {}
    for index, cid in enumerate(config.HOLDOUT_CASES):
        correct_case = index < majority
        per_case[cid] = {"expectedState": "SUPPORTED", "runs": 5,
                         "stateDistribution": {"SUPPORTED": 5}, "majorityState": "SUPPORTED",
                         "majorityCorrect": correct_case, "stable": True,
                         "correctRuns": 0 if cid in systematic else (5 if correct_case else 2)}
    return {"outcomeLayer": {"finalStateCorrect": "24/30",
                             "majorityCorrect": f"{majority}/6",
                             "unmappableRuns": 0, "perCase": per_case}}


def _clean_grounding(**overrides: int) -> dict[str, Any]:
    base = {k: 0 for k in evaluation.CRITICAL_SAFETY_INVARIANTS}
    base.update(overrides)
    base["materialUsefulnessContract"] = {"violations": []}
    return base


def test_generalization_supported_requires_clean_safety_and_envelope():
    verdict = evaluation.adjudicate_generalization(_synthetic(6), _clean_grounding())
    assert verdict["PROVISIONAL_GENERALIZATION_VERDICT"] == "GENERALIZATION_SUPPORTED"
    assert verdict["FINAL_GENERALIZATION_REQUIRES_HUMAN_REVIEW"] == "YES"


def test_a_single_false_supported_forces_not_supported():
    verdict = evaluation.adjudicate_generalization(_synthetic(6), _clean_grounding(falseSupported=1))
    assert verdict["PROVISIONAL_GENERALIZATION_VERDICT"] == "GENERALIZATION_NOT_SUPPORTED"
    assert verdict["criticalSafetyBreaches"] == ["falseSupported"]


def test_one_systematic_case_failure_caps_at_mixed():
    verdict = evaluation.adjudicate_generalization(_synthetic(6, ["case_04"]), _clean_grounding())
    assert verdict["PROVISIONAL_GENERALIZATION_VERDICT"] == "GENERALIZATION_MIXED"
    assert verdict["systematicCaseFailures"] == ["case_04"]


def test_two_systematic_case_failures_force_not_supported():
    verdict = evaluation.adjudicate_generalization(
        _synthetic(6, ["case_04", "case_10"]), _clean_grounding())
    assert verdict["PROVISIONAL_GENERALIZATION_VERDICT"] == "GENERALIZATION_NOT_SUPPORTED"


@pytest.mark.parametrize("majority,expected", [
    (6, "GENERALIZATION_SUPPORTED"), (5, "GENERALIZATION_SUPPORTED"),
    (4, "GENERALIZATION_MIXED"), (3, "GENERALIZATION_MIXED"),
    (2, "GENERALIZATION_NOT_SUPPORTED"), (0, "GENERALIZATION_NOT_SUPPORTED"),
])
def test_case_envelope_bands_are_frozen(majority, expected):
    verdict = evaluation.adjudicate_generalization(_synthetic(majority), _clean_grounding())
    assert verdict["PROVISIONAL_GENERALIZATION_VERDICT"] == expected


def test_generalization_verdict_is_never_a_single_accuracy_threshold():
    contract = evaluation.GENERALIZATION_CONTRACT
    assert "notAUtilityFunction" in contract
    assert "B2 is NOT executed on Holdout" in contract["claimScope"]


def test_level2_selection_is_criteria_based_and_frozen():
    assert config.LEVEL2_SELECTION == "CRITERIA_BASED_NOT_CASE_BASED"
    assert "abstain" in adjudication.LEVEL2_TRIGGERS
    assert "not_assessable" in adjudication.LEVEL2_TRIGGERS
    assert "incorrect_final_state" in adjudication.LEVEL2_TRIGGERS
    assert "case_unstable" in adjudication.LEVEL2_TRIGGERS


def test_level2_selects_abstain_and_incorrect_runs():
    rows = [
        {"runId": "case_02_r1", "caseId": "case_02", "repetition": 1, "stateEvaluable": True,
         "stateCorrect": True, "finalState": "SUPPORTED", "weakerSearchStatus": "NONE",
         "continuityStatus": None, "externalTargetIntroduced": None, "integrationRequired": False,
         "integrationDemonstrated": False, "observabilityStatus": "SUFFICIENT",
         "epistemicTarget": "FORMATIVE_EVIDENCE", "strengtheningCues": [],
         "guardInducedTransition": False, "groundingFailures": [], "traceAlignmentFailures": [],
         "hardFactualFailureCodes": []},
        {**{"runId": "case_04_r1", "caseId": "case_04", "repetition": 1, "stateEvaluable": True,
            "stateCorrect": False, "finalState": "ABSTAIN", "weakerSearchStatus": "UNRESOLVED",
            "continuityStatus": None, "externalTargetIntroduced": None, "integrationRequired": False,
            "integrationDemonstrated": False, "observabilityStatus": "MATERIAL_GAP",
            "epistemicTarget": "FORMATIVE_EVIDENCE", "strengtheningCues": [],
            "guardInducedTransition": False, "groundingFailures": [], "traceAlignmentFailures": [],
            "hardFactualFailureCodes": []}},
    ]
    per_case = {"case_02": {"stable": True}, "case_04": {"stable": True}}
    out = adjudication.level2(rows, {"outcomeLayer": {"perCase": per_case}})
    assert out["runsCovered"] == 1
    assert out["rows"][0]["runId"] == "case_04_r1"
    assert set(out["rows"][0]["level2Triggers"]) >= {
        "incorrect_final_state", "abstain", "weaker_search_unresolved", "observability_not_sufficient"}


def test_level1_covers_every_run():
    rows = [{"runId": f"case_02_r{i}", "caseId": "case_02", "repetition": i,
             "expectedState": "SUPPORTED"} for i in range(1, 31)]
    out = adjudication.level1(rows)
    assert out["runsCovered"] == 30 and out["coverage"] == "ALL_30_HOLDOUT_RUNS"
    assert all(v == "MANUAL_ADJUDICATION_REQUIRED"
               for row in out["rows"] for v in row["verdict"].values())


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__]))


# ==========================================================================
# Protocol fix v2 — model-generated topology deviation
# ==========================================================================

from experiments.evidence_reasoning.holdout.generation import (  # noqa: E402
    build_unmappable_run,
    classify_topology_deviation,
)


def _objective_with(requirement_count: int, status: str = "RESOLVED") -> dict[str, Any]:
    """A complete, schema-valid Objective Analysis carrying N Requirements."""
    quote = CASE.objective.split(".")[1].strip() + "."
    return {
        "decompositionStatus": status,
        "objectiveContext": CASE.objective[:20],
        "candidateSegments": [],
        "ambiguityRationale": "stub",
        "requirements": [{
            "requirementQuote": quote,
            "normalizedRequirement": f"stub requirement {index}",
            "epistemicTarget": "FORMATIVE_EVIDENCE",
            "epistemicTargetRationale": "stub",
            "atomicity": "ATOMIC",
            "evaluability": {"requiredEvidenceType": "FORMATIVE_EVIDENCE",
                             "formativeEvidenceCapable": True, "rationale": "stub"},
            "qualifiers": [],
        } for index in range(1, requirement_count + 1)],
    }


def _run_with_topology(tmp_path: Path, requirement_count: int, status: str = "RESOLVED"):
    """Drive the whole 30-run orchestration with one deviating first run."""
    store, ledger = _harness(tmp_path)
    provider = StubProvider({"b24_objective_analysis": [_objective_with(requirement_count, status)]})
    result = run_campaign(provider=provider, store=store, ledger=ledger, sleep=_sleep)
    return store, ledger, provider, result


def _abort_then_classify(tmp_path: Path, requirement_count: int = 0):
    """Reach the deviating state through the real run_case, then hand back the store."""
    store, ledger = _harness(tmp_path)
    provider = StubProvider({"b24_objective_analysis": [_objective_with(requirement_count)]})
    with pytest.raises(CampaignAbort):
        run_case(CASE, 1, provider=provider, store=store, ledger=ledger, sleep=_sleep)
    return store, ledger


# -- model-generated deviation is measured, not censored --------------------

def test_zero_requirements_is_unmappable_not_aborted(tmp_path):
    store, _, provider, result = _run_with_topology(tmp_path, 0)
    metadata = store.durable_run(RUN_ID)["metadata"]
    assert metadata["unmappableRun"] is True
    assert metadata["unmappableReason"] == config.UNMAPPABLE_CARDINALITY
    assert metadata["unmappableClassification"] == "MODEL_GENERATED_TOPOLOGY_DEVIATION"
    assert result["status"] == config.COMPLETE
    assert "b24_unified_reasoning" not in provider.calls


def test_two_requirements_is_unmappable_not_aborted(tmp_path):
    store, _, provider, result = _run_with_topology(tmp_path, 2)
    metadata = store.durable_run(RUN_ID)["metadata"]
    assert metadata["unmappableRun"] is True
    assert metadata["requirementsReturned"] == 2
    assert result["status"] == config.COMPLETE
    assert "b24_unified_reasoning" not in provider.calls


def test_ambiguous_decomposition_is_unmappable(tmp_path):
    store, _, provider, result = _run_with_topology(tmp_path, 1, status="AMBIGUOUS")
    metadata = store.durable_run(RUN_ID)["metadata"]
    assert metadata["unmappableRun"] is True
    assert metadata["unmappableReason"] == config.UNMAPPABLE_AMBIGUOUS
    assert result["status"] == config.COMPLETE
    assert "b24_unified_reasoning" not in provider.calls


def test_unmappable_run_invents_no_final_state(tmp_path):
    store, _, _, _ = _run_with_topology(tmp_path, 0)
    durable = store.durable_run(RUN_ID)
    assert durable["05_unified_contextual_reasoning"] == []
    assert durable["07_epistemic_policy"] == []
    assert durable["08_final_result"] == []
    blob = json.dumps(durable, ensure_ascii=False)
    for invented in ("ABSTAIN", "NOT_ASSESSABLE", "INSUFFICIENT_EVIDENCE"):
        assert f'"finalState": "{invented}"' not in blob


def test_unmappable_run_preserves_both_stage_observations(tmp_path):
    store, ledger, _, _ = _run_with_topology(tmp_path, 0)
    durable = store.durable_run(RUN_ID)
    assert durable["02_evidence_units"]["proposal"] is not None
    assert durable["03_objective_analysis"]["proposal"] is not None
    assert store.response_path(RUN_ID, "evidence_unit").exists()
    assert store.response_path(RUN_ID, "objective_analysis").exists()
    assert not store.response_path(RUN_ID, "unified_reasoning").exists()
    assert len(durable["metadata"]["providerStages"]) == 2
    assert ledger.payload["failedTransportAttempts"] == 0


def test_campaign_continues_after_unmappable_run(tmp_path):
    store, _, _, result = _run_with_topology(tmp_path, 0)
    assert result["completedRuns"] == config.RUNS == 30
    assert result["status"] == config.COMPLETE
    assert store.rebuild_index()["completedRuns"] == 30
    # The stub's default Objective payload is AMBIGUOUS, so every run in this
    # campaign is unmappable. None of them aborted; all 30 are terminal.
    assert result["unmappableRunCount"] == 30
    assert RUN_ID in result["unmappableRuns"]


def test_unmappable_runs_reduce_logical_calls_without_reassigning(tmp_path):
    store, ledger, _, result = _run_with_topology(tmp_path, 0)
    # 30 runs x 3 stages = 90 only if every run is mappable. Here every run is
    # unmappable, so each one skips its Unified call: 30 x 2 = 60 attempts.
    assert result["maximumExpectedLogicalCalls"] == 90
    assert result["unmappableRunCount"] == 30
    assert result["unusedLogicalCallSlots"] == 30
    assert result["unusedSlotDisposition"] == "DISCARDED_NOT_REASSIGNED"
    assert ledger.payload["providerAttempts"] == 60
    assert ledger.payload["successfulSemanticOutputs"] == 60
    # The governing law, independent of how many runs are unmappable:
    # attempts == max expected logical calls - unused slots (no transport failures).
    assert (ledger.payload["providerAttempts"]
            == config.LOGICAL_PROVIDER_CALLS - result["unusedLogicalCallSlots"])
    # The unused slots never become extra reserve or a wider cap.
    assert ledger.payload["transportRecoveryReserve"] == config.TRANSPORT_RECOVERY_RESERVE == 3
    assert ledger.payload["absoluteProviderAttemptCap"] == config.ABSOLUTE_PROVIDER_ATTEMPT_CAP == 93
    assert ledger.payload["providerAttempts"] < config.ABSOLUTE_PROVIDER_ATTEMPT_CAP


def test_no_requirement_is_ever_selected_from_a_failed_decomposition(tmp_path):
    store, _, _, _ = _run_with_topology(tmp_path, 2)
    durable = store.durable_run(RUN_ID)
    # Both Requirements survive in the artifact; neither was promoted, ranked,
    # merged or turned into a Unified call.
    assert len(durable["03_objective_analysis"]["analysis"]["requirements"]) == 2
    assert durable["05_unified_contextual_reasoning"] == []
    assert durable["metadata"]["unifiedCallIssued"] is False
    assert durable["metadata"]["unusedLogicalCallSlot"] == "DISCARDED_NOT_REASSIGNED"


def test_classifier_accepts_a_genuine_model_deviation(tmp_path):
    store, _ = _abort_then_classify(tmp_path, 0)
    verdict = classify_topology_deviation(CASE, 1, store=store)
    assert verdict.model_generated is True


def test_unmappable_reconstruction_makes_no_provider_call(tmp_path):
    store, _ = _abort_then_classify(tmp_path, 0)
    silent = StubProvider()
    build_unmappable_run(CASE, 1, provider=silent, store=store)
    assert silent.calls == []


# -- the harness variant of the same anomaly still aborts -------------------

def test_corrupted_objective_response_is_integrity_failure(tmp_path):
    store, _ = _abort_then_classify(tmp_path, 0)
    path = store.response_path(RUN_ID, "objective_analysis")
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["responseHash"] = "0" * 64
    path.write_text(json.dumps(payload), encoding="utf-8")
    verdict = classify_topology_deviation(CASE, 1, store=store)
    assert verdict.model_generated is False
    assert "missing, corrupt or misattributed" in verdict.detail


def test_wrong_run_artifact_attribution_is_integrity_failure(tmp_path):
    store, _ = _abort_then_classify(tmp_path, 0)
    path = store.response_path(RUN_ID, "objective_analysis")
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["runId"] = "case_16_r3"
    path.write_text(json.dumps(payload), encoding="utf-8")
    assert classify_topology_deviation(CASE, 1, store=store).model_generated is False


def test_unexpected_harness_unified_response_is_integrity_failure(tmp_path):
    store, _ = _abort_then_classify(tmp_path, 0)
    store.persist_response(RUN_ID, "unified_reasoning", prompt_hash="h", output={},
                           logical_call_id="x", attempt_id="y", requested_model=config.MODEL,
                           effective_model=config.MODEL, usage={}, latency_ms=1)
    verdict = classify_topology_deviation(CASE, 1, store=store)
    assert verdict.model_generated is False
    assert "unified_reasoning response present" in verdict.detail


def test_fixture_mutation_breaks_the_prompt_hash_and_aborts(tmp_path):
    store, _ = _abort_then_classify(tmp_path, 0)
    mutated = FixtureCase(CASE.case_id, CASE.split, CASE.domain,
                          CASE.objective + " MUTATED", CASE.sources)
    assert classify_topology_deviation(mutated, 1, store=store).model_generated is False


def test_missing_objective_response_is_integrity_failure(tmp_path):
    store, _ = _abort_then_classify(tmp_path, 0)
    store.response_path(RUN_ID, "objective_analysis").unlink()
    assert classify_topology_deviation(CASE, 1, store=store).model_generated is False


def test_classifier_never_masks_an_unrelated_integrity_abort(tmp_path):
    """Effective-model mismatch must stay ABORTED_INTEGRITY, not become unmappable."""
    store, ledger = _harness(tmp_path)
    provider = StubProvider(effective_model="some-other-model")
    with pytest.raises(CampaignAbort):
        run_case(CASE, 1, provider=provider, store=store, ledger=ledger, sleep=_sleep)
    assert classify_topology_deviation(CASE, 1, store=store).model_generated is False


def test_harness_corruption_stops_the_whole_campaign(tmp_path):
    """A deviating run whose artifacts are corrupt aborts instead of continuing."""
    store, ledger = _harness(tmp_path)

    class CorruptingStore(type(store)):
        def persist_response(self, run_id, stage, **kwargs):
            digest = super().persist_response(run_id, stage, **kwargs)
            if stage == "objective_analysis":
                path = self.response_path(run_id, stage)
                payload = json.loads(path.read_text(encoding="utf-8"))
                payload["runId"] = "case_16_r3"
                path.write_text(json.dumps(payload), encoding="utf-8")
            return digest

    corrupting = CorruptingStore(store.root)
    provider = StubProvider({"b24_objective_analysis": [_objective_with(0)]})
    result = run_campaign(provider=provider, store=corrupting, ledger=ledger, sleep=_sleep)
    assert result["status"] == config.ABORTED_INTEGRITY
    assert "harness topology corruption" in result["abortReason"]
    assert result["completedRuns"] == 0


# -- Phase 2 treatment ------------------------------------------------------

def _unmappable_run_dict(case_id: str, repetition: int) -> dict[str, Any]:
    return {"metadata": {"caseId": case_id, "repetition": repetition,
                         "runId": f"{case_id}_r{repetition}",
                         "runStatus": "OBJECTIVE_TOPOLOGY_UNMAPPABLE",
                         "unmappableRun": True,
                         "unmappableReason": config.UNMAPPABLE_CARDINALITY,
                         "providerStages": []},
            "05_unified_contextual_reasoning": [], "06_validation_repair": [],
            "07_epistemic_policy": [], "08_final_result": []}


def _mappable_run_dict(case_id: str, repetition: int) -> dict[str, Any]:
    return {"metadata": {"caseId": case_id, "repetition": repetition,
                         "runId": f"{case_id}_r{repetition}", "providerStages": []}}


def _patch_snapshot(monkeypatch) -> None:
    gold = {cid: {"expectedState": "SUPPORTED"} for cid in config.HOLDOUT_CASES}
    monkeypatch.setattr(evaluation, "holdout_gold", lambda: gold)

    def fake_snapshot(run, _gold):
        meta = run["metadata"]
        base = {"runId": meta["runId"], "caseId": meta["caseId"],
                "repetition": meta["repetition"], "expectedState": "SUPPORTED"}
        if meta.get("unmappableRun"):
            return {**base, "stateEvaluable": False, "runStatus": meta["runStatus"],
                    "manualAdjudicationRequired": ["objective_decomposition"]}
        return {**base, "stateEvaluable": True, "finalState": "SUPPORTED", "stateCorrect": True}

    monkeypatch.setattr(evaluation, "snapshot", fake_snapshot)


def test_phase2_counts_unmappable_in_the_denominator_as_incorrect(monkeypatch):
    _patch_snapshot(monkeypatch)
    runs = [_unmappable_run_dict(cid, rep)
            for cid in config.HOLDOUT_CASES for rep in range(1, 6)]
    result = evaluation.evaluate(runs)
    assert result["outcomeLayer"]["finalStateCorrect"] == "0/30"
    assert result["outcomeLayer"]["unmappableRuns"] == 30
    assert result["outcomeLayer"]["unmappableTreatment"] == "COUNTED_IN_DENOMINATOR_AS_INCORRECT"
    for info in result["outcomeLayer"]["perCase"].values():
        assert info["runs"] == 5 and info["correctRuns"] == 0 and info["unmappableRuns"] == 5
        assert info["stateDistribution"] == {config.UNMAPPABLE_DISTRIBUTION_LABEL: 5}
        assert info["majorityCorrect"] is False


def test_four_correct_one_unmappable_keeps_majority_but_marks_unstable(monkeypatch):
    _patch_snapshot(monkeypatch)
    runs = []
    for cid in config.HOLDOUT_CASES:
        for rep in range(1, 6):
            runs.append(_unmappable_run_dict(cid, rep) if (cid == "case_02" and rep == 5)
                        else _mappable_run_dict(cid, rep))
    result = evaluation.evaluate(runs)
    case = result["outcomeLayer"]["perCase"]["case_02"]
    assert case["runs"] == 5 and case["correctRuns"] == 4
    assert case["majorityCorrect"] is True
    assert case["stable"] is False
    assert result["outcomeLayer"]["finalStateCorrect"] == "29/30"


def test_five_unmappable_runs_trigger_gate_2_systematic_failure(monkeypatch):
    _patch_snapshot(monkeypatch)
    runs = []
    for cid in config.HOLDOUT_CASES:
        for rep in range(1, 6):
            runs.append(_unmappable_run_dict(cid, rep) if cid == "case_10"
                        else _mappable_run_dict(cid, rep))
    result = evaluation.evaluate(runs)
    verdict = evaluation.adjudicate_generalization(result, _clean_grounding())
    assert result["outcomeLayer"]["perCase"]["case_10"]["correctRuns"] == 0
    assert verdict["systematicCaseFailures"] == ["case_10"]
    assert verdict["PROVISIONAL_GENERALIZATION_VERDICT"] == "GENERALIZATION_MIXED"


def test_unmappable_run_triggers_level2():
    rows = [{"runId": "case_10_r2", "caseId": "case_10", "repetition": 2,
             "stateEvaluable": False, "runStatus": "OBJECTIVE_TOPOLOGY_UNMAPPABLE"}]
    out = adjudication.level2(rows, {"outcomeLayer": {"perCase": {"case_10": {"stable": True}}}})
    assert out["runsCovered"] == 1
    assert out["rows"][0]["level2Triggers"] == ["unmappable_run"]


def test_phase2_precondition_accepts_terminal_unmappable_runs(tmp_path):
    store, _, _, _ = _run_with_topology(tmp_path, 0)
    # 30 terminal runs, one of them carrying no final state at all.
    assert store.rebuild_index()["completedRuns"] == config.RUNS
    assert store.durable_run(RUN_ID)["08_final_result"] == []


# -- protocol identity ------------------------------------------------------

def test_previous_holdout_fingerprint_is_retained_as_historical():
    assert (integrity.PREVIOUS_HOLDOUT_EXECUTION_FINGERPRINT
            == "8809351eaaf8f1b0483016db348c2b87d8b620995f0c285644a0d0d5184b930d")
    execution = integrity.execution_protocol_fingerprint()
    assert execution["combinedSha256"] != integrity.PREVIOUS_HOLDOUT_EXECUTION_FINGERPRINT
    assert (execution["previousHoldoutExecutionProtocolFingerprint"]
            == integrity.PREVIOUS_HOLDOUT_EXECUTION_FINGERPRINT)


def test_topology_deviation_is_no_longer_an_integrity_stop_condition():
    parameters = integrity.execution_protocol_fingerprint()["parameters"]
    assert "topology_deviation" not in parameters["stopConditions"]
    assert "harness_topology_corruption" in parameters["stopConditions"]
    assert (parameters["modelGeneratedTopologyDeviation"]["policy"]
            == "RECORD_UNMAPPABLE_AND_CONTINUE")
    assert parameters["harnessTopologyCorruption"]["policy"] == "ABORTED_INTEGRITY"
    assert parameters["modelGeneratedTopologyDeviation"]["requirementSelection"] == "FORBIDDEN"
    assert parameters["modelGeneratedTopologyDeviation"]["unifiedProviderCalls"] == 0


def test_generalization_bands_are_unchanged_by_the_fix():
    contract = evaluation.GENERALIZATION_CONTRACT
    assert "moves NO threshold" in contract["unmappableRunTreatment"]
    # The three bands are byte-identical to the pre-fix contract.
    assert "majority-correct >= 5/6 with gates 1 and 2 clean" in contract["gate3_caseEnvelope"]
    assert "3/6 or 4/6 -> GENERALIZATION_MIXED" in contract["gate3_caseEnvelope"]
    assert "<= 2/6 -> GENERALIZATION_NOT_SUPPORTED" in contract["gate3_caseEnvelope"]


def test_behavior_fingerprint_survives_the_protocol_fix():
    from experiments.evidence_reasoning.b241_fingerprint import b241_behavior_fingerprint
    assert (b241_behavior_fingerprint()["combinedSha256"]
            == "55f37a8529c046e750f4e0351f544dabca1fb7bb9796b05fc1c860b5c979d6fc"
            == config.B241_BEHAVIOR_FINGERPRINT)


def test_campaign_package_is_untouched_by_the_fix():
    assert (dev_integrity.execution_protocol_fingerprint()["combinedSha256"]
            == "b0f5e01e443ba589490d573fbe728af05e7acd59899a1a7ce261535df0e6568e")
