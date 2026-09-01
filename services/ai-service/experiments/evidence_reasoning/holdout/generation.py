from __future__ import annotations

"""PHASE 1 — Holdout generation only. Gold is never imported or read here.

The per-run semantic body is NOT re-implemented: `campaign.generation.run_case`
is called unchanged. That function is the one that produced the 55 Development
runs, so the three rendered prompts, the stage order and the durable-response-first
recovery path are identical by construction rather than by inspection.

This module adds only execution concerns:
  * Holdout case selection, with Development membership asserted out;
  * the Holdout execution order;
  * Holdout-scoped progress and status accounting;
  * the model-generated topology-deviation policy (protocol fix v2).

## The topology-deviation policy

`campaign.generation.run_case` raises ABORTED_INTEGRITY when a run resolves to a
number of Requirements other than one. For the Development campaign that was
adequate — it never fired. For a generalization campaign it is wrong: a valid,
complete, schema-valid Objective Analysis that decomposes badly is precisely the
kind of failure the Holdout exists to reveal, and aborting would censor it.

So this layer intercepts that single abort and classifies it, WITHOUT modifying
`campaign/` and without ever consulting gold:

  every one of these true          -> MODEL_GENERATED_TOPOLOGY_DEVIATION
    both stage responses durable, hash-valid, prompt-matched, correctly attributed
    the Objective payload is schema-valid
    re-deriving it deterministically still yields cardinality != 1
    no Unified response exists for the run
                                   -> record unmappable, continue

  anything else                    -> ABORTED_INTEGRITY, stop the campaign

The classification never inspects the abort message. It re-establishes the facts
from the durable artifacts, so a message change, a different abort reason or any
form of harness corruption cannot be mistaken for a model failure.
"""

import time
from typing import Any, Callable

from ..b24_artifacts import (
    build_b24_objective_analysis,
    build_evidence_units,
    exact_redundancy_and_lineage,
    source_observability_facts,
)
from ..b24_schemas import validate_b24_schema
from ..b241_prompts import b241_evidence_unit_quote_first_prompt, objective_analysis_prompt
from ..b241_runtime import _metadata
from ..campaign.generation import CampaignAbort, run_case
from ..extraction import materialize_sources
from ..fixtures import load_cases
from ..models import FixtureCase
from . import config
from .store import HoldoutAttemptLedger, HoldoutStore, sha256_text

HoldoutAbort = CampaignAbort


class TopologyVerdict:
    __slots__ = ("model_generated", "detail")

    def __init__(self, model_generated: bool, detail: str):
        self.model_generated = model_generated
        self.detail = detail


def _load_holdout_case(case_id: str) -> FixtureCase:
    config.assert_development_excluded(case_id)
    if case_id not in config.HOLDOUT_CASES:
        raise CampaignAbort(config.ABORTED_INTEGRITY, f"case outside frozen holdout set: {case_id}")
    loaded = load_cases(split="holdout", case_ids={case_id})
    if len(loaded) != 1:
        raise CampaignAbort(config.ABORTED_INTEGRITY, f"case selection failed: {case_id}")
    case = loaded[0]
    if case.split != "holdout":
        raise CampaignAbort(config.ABORTED_INTEGRITY, f"split mismatch for {case_id}: {case.split}")
    return case


def _durable_stage(store: HoldoutStore, run_id: str, stage: str, prompt: str) -> dict[str, Any] | None:
    """Durable response for this exact logical call, with attribution checked."""
    payload = store.durable_response(run_id, stage, sha256_text(prompt))
    if payload is None:
        return None
    if payload.get("runId") != run_id or payload.get("stage") != stage:
        return None
    return payload


def classify_topology_deviation(case: FixtureCase, repetition: int, *,
                                store: HoldoutStore) -> TopologyVerdict:
    """Decide whether an integrity abort was really a model decomposition failure.

    Reads only durable artifacts and frozen fixtures. No provider call, no gold.
    """
    run_id = f"{case.case_id}_r{repetition}"
    snapshots = materialize_sources(case.sources)

    eu_payload = _durable_stage(store, run_id, "evidence_unit",
                                b241_evidence_unit_quote_first_prompt(snapshots))
    if eu_payload is None:
        return TopologyVerdict(False, "evidence_unit response missing, corrupt or misattributed")

    objective_payload = _durable_stage(store, run_id, "objective_analysis",
                                       objective_analysis_prompt(case.objective))
    if objective_payload is None:
        return TopologyVerdict(False, "objective_analysis response missing, corrupt or misattributed")

    if store.response_path(run_id, "unified_reasoning").exists():
        return TopologyVerdict(False, "unified_reasoning response present on an unmappable run")

    try:
        validate_b24_schema("b24_objective_analysis", objective_payload["output"])
        objective, _ = build_b24_objective_analysis(objective_payload["output"], case.objective)
    except Exception as error:  # noqa: BLE001 - any failure here is harness/data, not the model
        return TopologyVerdict(False, f"objective artifact could not be rebuilt: {type(error).__name__}")

    if objective["decompositionStatus"] != "AMBIGUOUS" and len(objective["requirements"]) == 1:
        return TopologyVerdict(False, "cardinality is 1 on replay; the abort was not a decomposition failure")

    return TopologyVerdict(True, f"{len(objective['requirements'])} requirements returned by the model")


def build_unmappable_run(case: FixtureCase, repetition: int, *, provider: Any,
                         store: HoldoutStore) -> dict[str, Any]:
    """Reconstruct a terminal unmappable run from durable responses. Zero calls.

    The structure mirrors the DECOMPOSITION_AMBIGUOUS run that
    `campaign.generation.run_case` already persists: the same stage artifacts,
    an empty `05`, an empty `07` and an empty `08`. No final state is invented and
    no frozen semantic schema is altered — `unmappableRun` and `unmappableReason`
    live in the harness metadata block, which is orchestration data.
    """
    run_id = f"{case.case_id}_r{repetition}"
    snapshots = materialize_sources(case.sources)
    originals = {item.source_id: item.content for item in case.sources}

    eu_payload = _durable_stage(store, run_id, "evidence_unit",
                                b241_evidence_unit_quote_first_prompt(snapshots))
    objective_payload = _durable_stage(store, run_id, "objective_analysis",
                                       objective_analysis_prompt(case.objective))
    if eu_payload is None or objective_payload is None:  # pragma: no cover - classifier guards this
        raise CampaignAbort(config.ABORTED_INTEGRITY, f"unmappable reconstruction lost artifacts in {run_id}")

    stages = [
        {"stage": "b241_evidence_unit_quote_first", "provider": config.PROVIDER,
         "requestedModel": eu_payload["requestedModel"], "effectiveModel": eu_payload["effectiveModel"],
         "latencyMs": eu_payload["latencyMs"], "usage": eu_payload["usage"], "retries": 0},
        {"stage": "b241_objective_analysis", "provider": config.PROVIDER,
         "requestedModel": objective_payload["requestedModel"],
         "effectiveModel": objective_payload["effectiveModel"],
         "latencyMs": objective_payload["latencyMs"], "usage": objective_payload["usage"], "retries": 0},
    ]

    validate_b24_schema("b24_evidence_unit_catalog", eu_payload["output"])
    evidence, eu_validations = build_evidence_units(eu_payload["output"]["evidenceUnits"], snapshots, originals)
    objective, objective_validations = build_b24_objective_analysis(objective_payload["output"], case.objective)

    redundancy = exact_redundancy_and_lineage(evidence)
    source_facts = source_observability_facts(snapshots, evidence)
    reason = (config.UNMAPPABLE_AMBIGUOUS if objective["decompositionStatus"] == "AMBIGUOUS"
              else config.UNMAPPABLE_CARDINALITY)

    run = {
        "metadata": {
            **_metadata(case, provider, stages, "OBJECTIVE_TOPOLOGY_UNMAPPABLE"),
            "repetition": repetition, "runId": run_id, "campaignId": config.CAMPAIGN_ID,
            "unmappableRun": True, "unmappableReason": reason,
            "unmappableClassification": "MODEL_GENERATED_TOPOLOGY_DEVIATION",
            "requirementsReturned": len(objective["requirements"]),
            "unifiedCallIssued": False,
            "unusedLogicalCallSlot": "DISCARDED_NOT_REASSIGNED",
        },
        "01_source_extraction": snapshots,
        "02_evidence_units": {"proposal": eu_payload["output"], "catalog": evidence},
        "03_objective_analysis": {"proposal": objective_payload["output"], "analysis": objective},
        "04_evidence_preparation": {
            "mode": "FULL_SCAN",
            "evidenceUnitIds": [item["evidenceUnitId"] for item in evidence],
            "exactRedundancyAndLineageGroups": redundancy,
            "sourceObservabilityFacts": source_facts,
            "discardedEvidenceProposalCount": len(eu_payload["output"]["evidenceUnits"]) - len(evidence),
        },
        "05_unified_contextual_reasoning": [],
        "06_validation_repair": [*eu_validations, *objective_validations],
        "07_epistemic_policy": [],
        "08_final_result": [],
    }
    store.persist_run(run_id, run)
    return run


def run_campaign(*, provider: Any, store: HoldoutStore, ledger: HoldoutAttemptLedger,
                 sleep: Callable[[float], None] = time.sleep,
                 progress: Callable[[dict[str, Any]], None] | None = None) -> dict[str, Any]:
    started = time.time()
    completed = 0
    unmappable: list[str] = []
    aborted: CampaignAbort | None = None

    for entry in config.execution_order():
        case_id = str(entry["caseId"])
        repetition = int(entry["repetition"])
        run_id = str(entry["runId"])
        case: FixtureCase | None = None
        try:
            case = _load_holdout_case(case_id)
            run_case(case, repetition, provider=provider, store=store, ledger=ledger, sleep=sleep)
        except CampaignAbort as error:
            # Case selection failing is never a decomposition failure — there is
            # no model response to classify.
            if error.state != config.ABORTED_INTEGRITY or case is None:
                aborted = error
                break
            verdict = classify_topology_deviation(case, repetition, store=store)
            if not verdict.model_generated:
                aborted = CampaignAbort(config.ABORTED_INTEGRITY,
                                        f"{error.reason} | harness topology corruption: {verdict.detail}")
                break
            build_unmappable_run(case, repetition, provider=provider, store=store)
        # The durable artifact is the authority, never the in-memory return value:
        # `run_case` hands back the dict it built BEFORE the store stamped the
        # unmappable marking onto a DECOMPOSITION_AMBIGUOUS run, so reading the
        # return value here would undercount unmappable runs.
        persisted = store.durable_run(run_id)
        if persisted is None:
            aborted = CampaignAbort(config.ABORTED_INTEGRITY,
                                    f"run artifact missing or invalid after completion: {run_id}")
            break
        if persisted["metadata"].get("unmappableRun"):
            unmappable.append(run_id)
        completed += 1
        if progress:
            progress({"completedRuns": completed, "plannedRuns": config.RUNS,
                      "lastRunId": run_id, "unmappableRuns": len(unmappable),
                      "providerAttempts": ledger.payload["providerAttempts"],
                      "elapsedSeconds": int(time.time() - started)})

    index = store.rebuild_index()
    status = aborted.state if aborted else (
        config.COMPLETE if index["completedRuns"] == config.RUNS else config.INCOMPLETE)
    ledger.finish("PASS" if status == config.COMPLETE else status)
    attempts = ledger.payload["providerAttempts"]
    return {"status": status, "abortReason": aborted.reason if aborted else None,
            "completedRuns": index["completedRuns"], "plannedRuns": config.RUNS,
            "unmappableRuns": unmappable,
            "unmappableRunCount": len(unmappable),
            "logicalCallBudgetSemantics": config.LOGICAL_CALL_BUDGET_SEMANTICS,
            "maximumExpectedLogicalCalls": config.LOGICAL_PROVIDER_CALLS,
            "unusedLogicalCallSlots": len(unmappable),
            "unusedSlotDisposition": "DISCARDED_NOT_REASSIGNED",
            "providerAttempts": attempts,
            "absoluteProviderAttemptCap": config.ABSOLUTE_PROVIDER_ATTEMPT_CAP,
            "elapsedSeconds": int(time.time() - started)}
