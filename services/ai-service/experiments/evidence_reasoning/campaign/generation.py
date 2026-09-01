from __future__ import annotations

"""PHASE 1 — generation only. Gold is never imported here.

Every semantic function is imported unchanged from the frozen B2.4.1 modules,
including the private prompt-context and metadata helpers, so the rendered
prompts are byte-identical to `b241_runtime.run_b241_case`. This module only
adds stage-level checkpointing and transport recovery.
"""

import time
from pathlib import Path
from typing import Any, Callable

from ..b24_artifacts import (
    build_b24_objective_analysis,
    build_evidence_units,
    exact_redundancy_and_lineage,
    source_observability_facts,
)
from ..b24_policy import b24_final_state
from ..b24_renderer import render_b24_explanation
from ..b24_schemas import b24_schema_for_provider, validate_b24_schema
from ..b24_validation import validate_and_enrich_b24
from ..b241_prompts import (
    b241_evidence_unit_quote_first_prompt,
    objective_analysis_prompt,
    unified_reasoning_prompt,
)
from ..b241_runtime import _context, _metadata, _provider_meta
from ..extraction import materialize_sources
from ..fixtures import load_cases
from ..models import FixtureCase
from . import config
from .store import CampaignStore, ProviderAttemptLedger, sha256_text
from .transport import classify


class CampaignAbort(RuntimeError):
    def __init__(self, state: str, reason: str):
        super().__init__(f"{state}: {reason}")
        self.state = state
        self.reason = reason


class StageResult:
    __slots__ = ("output", "meta")

    def __init__(self, output: Any, meta: dict[str, Any]):
        self.output = output
        self.meta = meta


def _execute_logical_call(
    *, provider: Any, store: CampaignStore, ledger: ProviderAttemptLedger,
    run_id: str, stage: str, prompt: str, schema_name: str,
    sleep: Callable[[float], None] = time.sleep,
) -> StageResult:
    """One LogicalProviderCall: durable-response-first, at most one transport recovery."""
    prompt_hash = sha256_text(prompt)
    logical_call_id = f"{run_id}#{stage}"

    # 1. Never call the provider again if usable semantic bytes are already durable.
    durable = store.durable_response(run_id, stage, prompt_hash)
    if durable is not None:
        ledger.note_reused_from_durable(logical_call_id, stage)
        return StageResult(durable["output"], {
            "stage": stage, "provider": config.PROVIDER,
            "requestedModel": durable["requestedModel"], "effectiveModel": durable["effectiveModel"],
            "latencyMs": durable["latencyMs"], "usage": durable["usage"], "retries": 0,
            "reusedFromDurableResponse": True,
        })

    attempt_index = 0
    while True:
        attempt_index += 1
        is_recovery = attempt_index > 1
        allowed, reason = ledger.may_attempt(logical_call_id, is_recovery=is_recovery)
        if not allowed:
            raise CampaignAbort(config.ABORTED_INFRASTRUCTURE, f"{reason} at {logical_call_id}")

        started = time.time()
        try:
            result = provider.complete(
                prompt=prompt, schema_name=schema_name,
                schema=b24_schema_for_provider(schema_name),
            )
        except BaseException as error:  # noqa: BLE001 - classification decides
            verdict = classify(error, semantic_response_available=False)
            ledger.record(logical_call_id, stage=stage, attempt_index=attempt_index,
                          state=config.FAILED_TRANSPORT if verdict.eligible else config.FAILED_NONRECOVERABLE,
                          is_recovery=is_recovery, prompt_hash=prompt_hash, detail=verdict.as_dict())
            if not verdict.eligible:
                raise CampaignAbort(config.ABORTED_INFRASTRUCTURE,
                                    f"non-recoverable {verdict.category} at {logical_call_id}") from error
            if attempt_index >= config.MAX_ATTEMPTS_PER_LOGICAL_CALL:
                raise CampaignAbort(config.ABORTED_INFRASTRUCTURE,
                                    f"second transport failure on {logical_call_id}") from error
            sleep(config.TRANSPORT_RETRY_BACKOFF_SECONDS)
            continue

        # 2. Persist the raw semantic response BEFORE deriving anything from it.
        if result.effective_model != config.MODEL:
            ledger.record(logical_call_id, stage=stage, attempt_index=attempt_index,
                          state=config.FAILED_NONRECOVERABLE, is_recovery=is_recovery,
                          prompt_hash=prompt_hash, detail={"category": "EFFECTIVE_MODEL_MISMATCH"})
            raise CampaignAbort(config.ABORTED_INTEGRITY, f"effective model {result.effective_model}")

        attempt_id = f"{logical_call_id}#a{attempt_index}"
        store.persist_response(
            run_id, stage, prompt_hash=prompt_hash, output=result.output,
            logical_call_id=logical_call_id, attempt_id=attempt_id,
            requested_model=result.requested_model, effective_model=result.effective_model,
            usage=result.usage or {}, latency_ms=int(result.latency_ms or (time.time() - started) * 1000),
        )
        ledger.record(logical_call_id, stage=stage, attempt_index=attempt_index,
                      state=config.SUCCESS, is_recovery=is_recovery, prompt_hash=prompt_hash,
                      detail={"category": "SEMANTIC_RESPONSE_RECEIVED"})
        return StageResult(result.output, _provider_meta(stage, result))


def run_case(
    case: FixtureCase, repetition: int, *, provider: Any, store: CampaignStore,
    ledger: ProviderAttemptLedger, sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    """Stage-checkpointed equivalent of b241_runtime.run_b241_case."""
    run_id = f"{case.case_id}_r{repetition}"
    existing = store.durable_run(run_id)
    if existing is not None:
        return existing

    snapshots = materialize_sources(case.sources)
    originals = {item.source_id: item.content for item in case.sources}
    stages: list[dict[str, Any]] = []

    eu = _execute_logical_call(provider=provider, store=store, ledger=ledger, run_id=run_id,
                               stage="evidence_unit", prompt=b241_evidence_unit_quote_first_prompt(snapshots),
                               schema_name="b24_evidence_unit_catalog", sleep=sleep)
    stages.append({**eu.meta, "stage": "b241_evidence_unit_quote_first"})
    validate_b24_schema("b24_evidence_unit_catalog", eu.output)
    evidence, eu_validations = build_evidence_units(eu.output["evidenceUnits"], snapshots, originals)

    objective_stage = _execute_logical_call(provider=provider, store=store, ledger=ledger, run_id=run_id,
                                            stage="objective_analysis", prompt=objective_analysis_prompt(case.objective),
                                            schema_name="b24_objective_analysis", sleep=sleep)
    stages.append({**objective_stage.meta, "stage": "b241_objective_analysis"})
    validate_b24_schema("b24_objective_analysis", objective_stage.output)
    objective, objective_validations = build_b24_objective_analysis(objective_stage.output, case.objective)

    redundancy = exact_redundancy_and_lineage(evidence)
    source_facts = source_observability_facts(snapshots, evidence)
    preparation = {
        "mode": "FULL_SCAN",
        "evidenceUnitIds": [item["evidenceUnitId"] for item in evidence],
        "exactRedundancyAndLineageGroups": redundancy,
        "sourceObservabilityFacts": source_facts,
        "discardedEvidenceProposalCount": len(eu.output["evidenceUnits"]) - len(evidence),
    }
    base = {
        "01_source_extraction": snapshots,
        "02_evidence_units": {"proposal": eu.output, "catalog": evidence},
        "03_objective_analysis": {"proposal": objective_stage.output, "analysis": objective},
        "04_evidence_preparation": preparation,
    }

    if objective["decompositionStatus"] == "AMBIGUOUS":
        run = {"metadata": {**_metadata(case, provider, stages, "DECOMPOSITION_AMBIGUOUS"), "repetition": repetition,
                            "runId": run_id, "campaignId": config.CAMPAIGN_ID},
               **base, "05_unified_contextual_reasoning": [],
               "06_validation_repair": [*eu_validations, *objective_validations],
               "07_epistemic_policy": [], "08_final_result": []}
        store.persist_run(run_id, run)
        return run

    if len(objective["requirements"]) != 1:
        raise CampaignAbort(config.ABORTED_INTEGRITY,
                            f"topology deviation: {len(objective['requirements'])} requirements in {run_id}")

    requirement = objective["requirements"][0]
    unified = _execute_logical_call(provider=provider, store=store, ledger=ledger, run_id=run_id,
                                    stage="unified_reasoning",
                                    prompt=unified_reasoning_prompt(_context(case, requirement, evidence, preparation, snapshots)),
                                    schema_name="b24_unified_reasoning", sleep=sleep)
    stages.append({**unified.meta, "stage": f"b241_unified_contextual_reasoning:{requirement['requirementId']}"})
    validate_b24_schema("b24_unified_reasoning", unified.output)

    enriched, validations, hard = validate_and_enrich_b24(
        unified.output, requirement, evidence, redundancy, source_facts,
        [*eu_validations, *objective_validations])
    pre_state, pre_inputs = b24_final_state(requirement, enriched, hard_factual_failure=False)
    final, inputs = b24_final_state(requirement, enriched, hard_factual_failure=hard)
    evidence_by_id = {item["evidenceUnitId"]: item for item in evidence}

    run = {
        "metadata": {**_metadata(case, provider, stages, "RESOLVED"), "repetition": repetition,
                     "runId": run_id, "campaignId": config.CAMPAIGN_ID},
        **base,
        "05_unified_contextual_reasoning": [enriched],
        "06_validation_repair": [*eu_validations, *objective_validations, *validations],
        "07_epistemic_policy": [{"requirementId": requirement["requirementId"], "preGuardState": pre_state,
                                 "preGuardInputs": pre_inputs, "finalState": final, "inputs": inputs}],
        "08_final_result": [{"requirementId": requirement["requirementId"], "finalState": final,
                             "claimCeiling": enriched["jointClaimCeiling"],
                             "weakerClaimSearch": enriched["weakerClaimSearch"],
                             "explanation": render_b24_explanation(requirement, enriched, final, evidence_by_id)}],
    }
    store.persist_run(run_id, run)
    return run


def run_campaign(*, provider: Any, store: CampaignStore, ledger: ProviderAttemptLedger,
                 sleep: Callable[[float], None] = time.sleep,
                 progress: Callable[[dict[str, Any]], None] | None = None) -> dict[str, Any]:
    started = time.time()
    completed = 0
    aborted: CampaignAbort | None = None

    for entry in config.execution_order():
        case_id = str(entry["caseId"])
        if case_id in config.HOLDOUT_CASES:
            raise CampaignAbort(config.ABORTED_INTEGRITY, f"holdout leakage: {case_id}")
        loaded = load_cases(split="dev", case_ids={case_id})
        if len(loaded) != 1:
            raise CampaignAbort(config.ABORTED_INTEGRITY, f"case selection failed: {case_id}")
        try:
            run_case(loaded[0], int(entry["repetition"]), provider=provider, store=store,
                     ledger=ledger, sleep=sleep)
        except CampaignAbort as error:
            aborted = error
            break
        completed += 1
        if progress:
            progress({"completedRuns": completed, "plannedRuns": config.RUNS,
                      "lastRunId": entry["runId"], "providerAttempts": ledger.payload["providerAttempts"],
                      "elapsedSeconds": int(time.time() - started)})

    index = store.rebuild_index()
    status = aborted.state if aborted else (config.COMPLETE if index["completedRuns"] == config.RUNS else config.INCOMPLETE)
    ledger.finish("PASS" if status == config.COMPLETE else status)
    return {"status": status, "abortReason": aborted.reason if aborted else None,
            "completedRuns": index["completedRuns"], "plannedRuns": config.RUNS,
            "elapsedSeconds": int(time.time() - started)}
