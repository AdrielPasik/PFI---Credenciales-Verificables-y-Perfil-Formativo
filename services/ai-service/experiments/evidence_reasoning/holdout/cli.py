from __future__ import annotations

"""Frozen Holdout entrypoints. All of them exist before the first provider call.

`freeze` and `plan` perform zero provider calls. `generate` refuses to start
unless the whole freeze verifies. `evaluate` refuses to run on a partial campaign.
"""

import argparse
import os
import sys
from pathlib import Path

from ..fixtures import assert_input_gold_isolation
from ..local_env import load_local_env
from ..providers import provider_from_name
from . import adjudication, config, evaluation, integrity, reporting
from .generation import run_campaign
from .store import HoldoutAttemptLedger, HoldoutStore, atomic_write_json, read_json


# Protocol revision v2. Planning artifacts are written under a -v2 suffix so the
# historical pre-fix protocol artifacts are preserved, never overwritten.
ARTIFACT_SUFFIX = "-v2"


def _freeze_path(root: Path) -> Path:
    return root / f"holdout-freeze-manifest{ARTIFACT_SUFFIX}.json"


def cmd_plan(root: Path, out: Path) -> int:
    """Zero-call planning artifacts: split, topology, gold isolation, call plan."""
    split = integrity.holdout_split_audit()
    topology = integrity.topology_audit()
    isolation = integrity.gold_isolation_audit()
    execution = integrity.execution_protocol_fingerprint()

    call_plan = {
        "artifact": "HOLDOUT_CALL_PLAN", "campaignId": config.CAMPAIGN_ID,
        "providerCallsMadeByThisArtifact": 0,
        "cases": list(config.HOLDOUT_CASES), "repetitions": config.REPETITIONS,
        "runs": config.RUNS, "stagesPerRun": config.STAGES_PER_RUN,
        "stages": list(config.STAGES),
        "unifiedCallsPerRun": config.UNIFIED_CALLS_PER_RUN,
        "logicalProviderCallsPlanned": config.LOGICAL_PROVIDER_CALLS,
        "transportRecoveryReserve": config.TRANSPORT_RECOVERY_RESERVE,
        "absoluteProviderAttemptCap": config.ABSOLUTE_PROVIDER_ATTEMPT_CAP,
        "maxAttemptsPerLogicalCall": config.MAX_ATTEMPTS_PER_LOGICAL_CALL,
        "reserveDerivation": {
            "developmentLogicalCalls": 165, "developmentReserve": 5,
            "developmentRate": "3.030%",
            "proportionalForNinetyCalls": 2.727,
            "roundedUpTo": config.TRANSPORT_RECOVERY_RESERVE,
            "holdoutRate": "3.333%",
            "rationale": ("Rounded up, never down, so the Holdout is never less tolerant "
                          "per call than the approved Development campaign. Frozen now; "
                          "it may not be widened during execution."),
        },
        "provider": config.PROVIDER, "model": config.MODEL,
        "reasoningEffort": config.REASONING_EFFORT,
        "providerTimeoutSeconds": config.PROVIDER_TIMEOUT_SECONDS,
        "transportRetryBackoffSeconds": config.TRANSPORT_RETRY_BACKOFF_SECONDS,
        "maxConcurrentLogicalCalls": config.MAX_CONCURRENT_LOGICAL_CALLS,
        "executionOrder": config.execution_order(),
        "developmentCasesExcluded": list(config.DEVELOPMENT_CASES),
        "topology": topology, "split": split,
        "logicalCallBudgetSemantics": config.LOGICAL_CALL_BUDGET_SEMANTICS,
        "budgetNote": ("90 is the MAXIMUM expected logical call count, reached only if all 30 "
                       "runs are mappable. An unmappable run never issues its Unified call and "
                       "the unused slot is discarded, never reassigned."),
        "modelGeneratedTopologyDeviation": "RECORD_UNMAPPABLE_AND_CONTINUE",
        "harnessTopologyCorruption": "ABORTED_INTEGRITY",
        "protocolRevision": "v2_topology_semantic_failure_correction",
        "previousHoldoutExecutionProtocolFingerprint":
            integrity.PREVIOUS_HOLDOUT_EXECUTION_FINGERPRINT,
        "holdoutExecutionProtocolFingerprint": execution["combinedSha256"],
    }
    atomic_write_json(out / f"holdout-call-plan{ARTIFACT_SUFFIX}.json", call_plan)
    atomic_write_json(out / f"holdout-gold-isolation-audit{ARTIFACT_SUFFIX}.json", isolation)
    atomic_write_json(out / f"holdout-execution-fingerprint{ARTIFACT_SUFFIX}.json", execution)
    atomic_write_json(out / f"holdout-manual-adjudication-rubric{ARTIFACT_SUFFIX}.json", {
        "artifact": "HOLDOUT_MANUAL_ADJUDICATION_RUBRIC", "campaignId": config.CAMPAIGN_ID,
        "providerCalls": 0,
        "level1": {"coverage": "ALL_30_HOLDOUT_RUNS",
                   "questions": list(adjudication.LEVEL1_QUESTIONS)},
        "level2": {"selection": config.LEVEL2_SELECTION,
                   "triggers": adjudication.LEVEL2_TRIGGERS,
                   "dimensions": list(adjudication.LEVEL2_DIMENSIONS)},
        "generalizationContract": evaluation.GENERALIZATION_CONTRACT,
        "unmappableRunHandling": {
            "trigger": "unmappable_run",
            "phase2": "COUNTED_IN_DENOMINATOR_AS_INCORRECT",
            "finalState": None,
            "note": "Thresholds unchanged; this only clarifies what an incorrect run is.",
        },
        "note": "Frozen before the first provider call; no verdict is auto-certified.",
    })

    print("HOLDOUT SPLIT   :", split["SPLIT_CONFIRMED"], split["fixtureHoldoutSplit"])
    print("TOPOLOGY        :", topology["TOPOLOGY"])
    print("GOLD ISOLATION  :", isolation["GOLD_ISOLATION"])
    print("LOGICAL CALLS   :", config.LOGICAL_PROVIDER_CALLS,
          "| reserve", config.TRANSPORT_RECOVERY_RESERVE,
          "| cap", config.ABSOLUTE_PROVIDER_ATTEMPT_CAP)
    if topology["TOPOLOGY"] != "SINGLE_REQUIREMENT_EXPECTED":
        print("HOLDOUT_TOPOLOGY_REVIEW_REQUIRED — stop before any live execution")
        return 1
    return 0 if split["SPLIT_CONFIRMED"] == "PASS" and isolation["GOLD_ISOLATION"] == "PASS" else 1


def cmd_freeze(root: Path) -> int:
    manifest = integrity.freeze_manifest()
    checks = (
        ("behavior fingerprint mismatch",
         manifest["b241BehaviorFingerprint"] == config.B241_BEHAVIOR_FINGERPRINT),
        ("B2.4 historical fingerprint mutated",
         manifest["b24HistoricalFingerprint"] == config.B24_HISTORICAL_FINGERPRINT),
        ("semantic clause lineage", manifest["semanticClauseLineage"] == "PASS"),
        ("gold isolation", manifest["goldIsolation"] == "PASS"),
        ("holdout split", manifest["splitConfirmed"] == "PASS"),
        ("holdout topology", manifest["topology"] == "SINGLE_REQUIREMENT_EXPECTED"),
    )
    for label, ok in checks:
        if not ok:
            print(f"FINAL_HOLDOUT_FREEZE: FAIL — {label}")
            return 1
    atomic_write_json(_freeze_path(root), manifest)
    print("FINAL_HOLDOUT_FREEZE: PASS")
    print("  behavior fingerprint        :", manifest["b241BehaviorFingerprint"])
    print("  development execution (ref) :", manifest["developmentExecutionProtocolFingerprint"])
    print("  holdout execution protocol  :", manifest["holdoutExecutionProtocolFingerprint"])
    return 0


def cmd_verify(root: Path) -> int:
    manifest = read_json(_freeze_path(root))
    status, drift = integrity.verify(manifest)
    print("HOLDOUT FREEZE VERIFICATION:", status)
    if drift:
        print("  drift:", drift)
    return 0 if status == "PASS" else 1


def cmd_generate(root: Path) -> int:
    assert_input_gold_isolation()
    manifest = read_json(_freeze_path(root))
    status, drift = integrity.verify(manifest)
    if status != "PASS":
        print("ABORTED_INTEGRITY before any provider call:", drift)
        return 1

    os.environ["ER_PROVIDER_TIMEOUT_SECONDS"] = str(config.PROVIDER_TIMEOUT_SECONDS)
    load_local_env()
    provider = provider_from_name(config.PROVIDER)
    if provider.model != config.MODEL or provider.reasoning_effort != config.REASONING_EFFORT:
        print("ABORTED_INTEGRITY: model/effort mismatch")
        return 1
    if getattr(provider, "timeout", None) != config.PROVIDER_TIMEOUT_SECONDS:
        print(f"ABORTED_INTEGRITY: transport timeout {getattr(provider, 'timeout', None)}")
        return 1

    store = HoldoutStore(root)
    ledger = HoldoutAttemptLedger(root / "holdout-attempt-ledger.json")
    progress_path = root / "progress.json"

    print("API key available =", "YES")
    print("effective provider/model/effort =", config.PROVIDER, "/", provider.model, "/",
          provider.reasoning_effort)
    print("transport timeout =", provider.timeout, "| concurrency =", config.MAX_CONCURRENT_LOGICAL_CALLS)
    print("max expected logical calls =", config.LOGICAL_PROVIDER_CALLS,
          "| reserve =", config.TRANSPORT_RECOVERY_RESERVE,
          "| absolute cap =", config.ABSOLUTE_PROVIDER_ATTEMPT_CAP)
    print("holdout cases =", ", ".join(config.HOLDOUT_CASES))
    print("development cases included = NO | gold used in phase 1 = NO")

    result = run_campaign(provider=provider, store=store, ledger=ledger,
                          progress=lambda payload: atomic_write_json(progress_path, payload))
    atomic_write_json(root / "holdout-generation-result.json",
                      {**result, "phase": "PHASE_1_HOLDOUT_GENERATION", "goldUsedDuringGeneration": False})
    post, _ = integrity.verify(manifest)
    print(f"PHASE1 {result['status']} | runs={result['completedRuns']}/{config.RUNS} "
          f"| unmappable={result['unmappableRunCount']} "
          f"| attempts={ledger.payload['providerAttempts']}/{config.ABSOLUTE_PROVIDER_ATTEMPT_CAP} "
          f"| freeze={post}")
    if result.get("abortReason"):
        print("ABORT REASON:", result["abortReason"])
    return 0


def cmd_evaluate(root: Path, out: Path) -> int:
    manifest = read_json(_freeze_path(root))
    status, _ = integrity.verify(manifest)
    generation = read_json(root / "holdout-generation-result.json")
    store = HoldoutStore(root)
    index = store.rebuild_index()

    if generation["status"] != config.COMPLETE or index["completedRuns"] != config.RUNS:
        print("PHASE2 refused: partial evaluation is forbidden "
              f"({index['completedRuns']}/{config.RUNS} runs terminal). "
              "A COMPLETE unmappable run counts as terminal; non-null final states are not required.")
        return 1

    runs = [store.durable_run(str(e["runId"])) for e in config.execution_order()]
    atomic_write_json(out / "holdout-runs.json",
                      {"experimentSchemaVersion": "b241_holdout_runs_v1",
                       "campaignId": config.CAMPAIGN_ID, "phase": "PHASE_1_GENERATION_OUTPUT",
                       "goldUsedDuringGeneration": False, "runs": runs})

    result = evaluation.evaluate(runs)
    grounding = evaluation.grounding_safety(result["perRun"])
    abstention = evaluation.abstention_profile(result["perRun"])
    generalization = evaluation.adjudicate_generalization(result, grounding)
    upstream = evaluation.upstream_variability(result["perRun"])

    dev_eval = read_json(out / "b241-full-dev-reexecution-evaluation.json")
    dev_grounding = read_json(out / "b241-full-dev-reexecution-grounding-safety.json")
    comparison = evaluation.development_vs_holdout(dev_eval, dev_grounding, result,
                                                   grounding, abstention)

    atomic_write_json(out / "holdout-evaluation.json", result)
    atomic_write_json(out / "holdout-grounding-safety.json", grounding)
    atomic_write_json(out / "holdout-abstention-profile.json", abstention)
    atomic_write_json(out / "holdout-generalization-adjudication.json", generalization)
    atomic_write_json(out / "holdout-upstream-variability.json", upstream)
    atomic_write_json(out / "holdout-development-vs-holdout.json", comparison)
    atomic_write_json(out / "holdout-manual-adjudication-level1.json",
                      adjudication.level1(result["perRun"]))
    atomic_write_json(out / "holdout-manual-adjudication-level2.json",
                      adjudication.level2(result["perRun"], result))
    atomic_write_json(out / "holdout-report-data.json", reporting.build(
        generation=generation, ledger=read_json(root / "holdout-attempt-ledger.json"),
        evaluation=result, grounding=grounding, generalization=generalization,
        comparison=comparison, freeze_status=status,
        lineage=manifest["semanticClauseLineage"], gold_isolation=manifest["goldIsolation"],
        behavior_fingerprint=manifest["b241BehaviorFingerprint"],
        execution_fingerprint=manifest["holdoutExecutionProtocolFingerprint"]))

    print("PHASE2 COMPLETE |", result["outcomeLayer"]["finalStateCorrect"],
          "| majority", result["outcomeLayer"]["majorityCorrect"],
          "| unmappable", result["outcomeLayer"]["unmappableRuns"])
    print(" generalization:", generalization["PROVISIONAL_GENERALIZATION_VERDICT"],
          "| driver:", generalization["verdictDriver"])
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="B2.4.1 Holdout generalization campaign")
    parser.add_argument("command", choices=["plan", "freeze", "verify", "generate", "evaluate"])
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args(argv)
    args.root.mkdir(parents=True, exist_ok=True)
    out = args.out or args.root
    out.mkdir(parents=True, exist_ok=True)
    if args.command == "plan":
        return cmd_plan(args.root, out)
    if args.command == "freeze":
        return cmd_freeze(args.root)
    if args.command == "verify":
        return cmd_verify(args.root)
    if args.command == "generate":
        return cmd_generate(args.root)
    return cmd_evaluate(args.root, out)


if __name__ == "__main__":
    sys.exit(main())
