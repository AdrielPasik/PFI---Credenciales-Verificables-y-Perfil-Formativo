from __future__ import annotations

"""Frozen campaign entrypoints. All of them exist before the first provider call."""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from ..fixtures import assert_input_gold_isolation
from ..local_env import load_local_env
from ..providers import provider_from_name
from . import adjudication, config, evaluation, integrity, reporting
from .generation import run_campaign
from .store import CampaignStore, ProviderAttemptLedger, atomic_write_json, read_json


def _freeze_path(root: Path) -> Path:
    return root / "freeze-manifest.json"


def cmd_freeze(root: Path) -> int:
    manifest = integrity.freeze_manifest()
    if manifest["b241BehaviorFingerprint"] != config.B241_BEHAVIOR_FINGERPRINT:
        print("FINAL_EXECUTION_FREEZE: FAIL — behavior fingerprint mismatch")
        return 1
    if manifest["b24HistoricalFingerprint"] != config.B24_HISTORICAL_FINGERPRINT:
        print("FINAL_EXECUTION_FREEZE: FAIL — B2.4 historical fingerprint mutated")
        return 1
    if manifest["semanticClauseLineage"] != "PASS":
        print("FINAL_EXECUTION_FREEZE: FAIL — semantic clause lineage")
        return 1
    atomic_write_json(_freeze_path(root), manifest)
    print("FINAL_EXECUTION_FREEZE: PASS")
    print("  behavior fingerprint :", manifest["b241BehaviorFingerprint"])
    print("  execution protocol   :", manifest["executionProtocolFingerprint"])
    return 0


def cmd_verify(root: Path) -> int:
    manifest = read_json(_freeze_path(root))
    status, drift = integrity.verify(manifest)
    print("FREEZE VERIFICATION:", status)
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

    store = CampaignStore(root)
    ledger = ProviderAttemptLedger(root / "attempt-ledger.json")
    progress_path = root / "progress.json"

    print("API key available =", "YES")
    print("effective provider/model/effort =", config.PROVIDER, "/", provider.model, "/", provider.reasoning_effort)
    print("transport timeout =", provider.timeout, "| concurrency =", config.MAX_CONCURRENT_LOGICAL_CALLS)
    print("logical calls planned =", config.LOGICAL_PROVIDER_CALLS,
          "| reserve =", config.TRANSPORT_RECOVERY_RESERVE,
          "| absolute cap =", config.ABSOLUTE_PROVIDER_ATTEMPT_CAP)
    print("previous aborted runs reused = NO | holdout included = NO")

    result = run_campaign(provider=provider, store=store, ledger=ledger,
                          progress=lambda payload: atomic_write_json(progress_path, payload))
    atomic_write_json(root / "generation-result.json",
                      {**result, "phase": "PHASE_1_GENERATION", "goldUsedDuringGeneration": False})
    post, drift = integrity.verify(manifest)
    print(f"PHASE1 {result['status']} | runs={result['completedRuns']}/{config.RUNS} "
          f"| attempts={ledger.payload['providerAttempts']}/{config.ABSOLUTE_PROVIDER_ATTEMPT_CAP} "
          f"| freeze={post}")
    if result.get("abortReason"):
        print("ABORT REASON:", result["abortReason"])
    return 0


def cmd_evaluate(root: Path, out: Path) -> int:
    manifest = read_json(_freeze_path(root))
    status, drift = integrity.verify(manifest)
    generation = read_json(root / "generation-result.json")
    store = CampaignStore(root)
    index = store.rebuild_index()

    if generation["status"] != config.COMPLETE or index["completedRuns"] != config.RUNS:
        print("PHASE2 refused: partial evaluation is forbidden "
              f"({index['completedRuns']}/{config.RUNS} runs complete)")
        report = reporting.build(generation=generation, ledger=read_json(root / "attempt-ledger.json"),
                                 evaluation=None, grounding=None, classification=None, holdout=None,
                                 freeze_status=status, lineage=manifest["semanticClauseLineage"],
                                 behavior_fingerprint=manifest["b241BehaviorFingerprint"],
                                 execution_fingerprint=manifest["executionProtocolFingerprint"])
        atomic_write_json(out / "b241-full-dev-reexecution-report-data.json", report)
        return 1

    runs = [store.durable_run(str(e["runId"])) for e in config.execution_order()]
    payload = {"experimentSchemaVersion": "b241_full_dev_reexecution_runs_v1",
               "campaignId": config.CAMPAIGN_ID, "phase": "PHASE_1_GENERATION_OUTPUT",
               "goldUsedDuringGeneration": False, "runs": runs}
    atomic_write_json(out / "b241-full-dev-reexecution-runs.json", payload)

    result = evaluation.evaluate(runs)
    grounding = evaluation.grounding_safety(result["perRun"])
    baseline = read_json(out / "b241-full-development-b2-baseline.json")
    mechanism = evaluation.mechanism_comparison(result, baseline)
    upstream = evaluation.upstream_variability(result["perRun"])
    classification = evaluation.classify_vs_b2(result, grounding, baseline)
    holdout = evaluation.holdout_blockers(result, grounding, classification,
                                          manifest["semanticClauseLineage"], status)

    atomic_write_json(out / "b241-full-dev-reexecution-evaluation.json", result)
    atomic_write_json(out / "b241-full-dev-reexecution-grounding-safety.json", grounding)
    atomic_write_json(out / "b241-full-dev-reexecution-mechanism-comparison.json", mechanism)
    atomic_write_json(out / "b241-full-dev-reexecution-upstream-variability.json", upstream)
    atomic_write_json(out / "b241-full-dev-reexecution-manual-adjudication-level1.json",
                      adjudication.level1(result["perRun"]))
    atomic_write_json(out / "b241-full-dev-reexecution-manual-adjudication-level2.json",
                      adjudication.level2(result["perRun"]))
    report = reporting.build(generation=generation, ledger=read_json(root / "attempt-ledger.json"),
                             evaluation=result, grounding=grounding, classification=classification,
                             holdout=holdout, freeze_status=status,
                             lineage=manifest["semanticClauseLineage"],
                             behavior_fingerprint=manifest["b241BehaviorFingerprint"],
                             execution_fingerprint=manifest["executionProtocolFingerprint"])
    atomic_write_json(out / "b241-full-dev-reexecution-report-data.json", report)

    print("PHASE2 COMPLETE |", result["outcomeLayer"]["finalStateCorrect"],
          "| majority", result["outcomeLayer"]["majorityCorrect"])
    print(" grounding:", {k: grounding[k] for k in
                          ("falseSupported", "fabricatedEvidence", "wrongSourceAttribution",
                           "traceAlignmentFailures", "hardFactualFailures", "guardFalsePositives")})
    print(" classification:", classification["PROVISIONAL_CLASSIFICATION_VS_B2"],
          "| holdout:", holdout["HOLDOUT_READY"], holdout["blockers"])
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="B2.4.1 Full Development re-execution campaign")
    parser.add_argument("command", choices=["freeze", "verify", "generate", "evaluate"])
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args(argv)
    args.root.mkdir(parents=True, exist_ok=True)
    if args.command == "freeze":
        return cmd_freeze(args.root)
    if args.command == "verify":
        return cmd_verify(args.root)
    if args.command == "generate":
        return cmd_generate(args.root)
    return cmd_evaluate(args.root, args.out or args.root)


if __name__ == "__main__":
    raise SystemExit(main())
