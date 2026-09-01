from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .b24_evaluation import evaluate_b24_file, manual_adjudication
from .b24_fingerprint import b24_behavior_fingerprint
from .b24_runtime import PROBE_CASE_IDS, CallBudget, provider_call_plan, run_b24_cases
from .fixtures import assert_input_gold_isolation, load_cases
from .local_env import load_local_env
from .providers import ProviderUnavailable, provider_from_name

# Holdout is never executable from this CLI, by construction.
HOLDOUT_CASE_IDS = {f"case_{item}" for item in ("02", "04", "10", "14", "16", "17")}


def _write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _ids(value: str) -> set[str]:
    return {
        f"case_{item.strip()}" if item.strip().isdigit() and len(item.strip()) == 2 else item.strip()
        for item in value.split(",")
        if item.strip()
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="B2.4 / Target v1.5 minimal semantic contract fix")
    sub = parser.add_subparsers(dest="command", required=True)

    plan = sub.add_parser("call-plan")
    plan.add_argument("--output", type=Path, required=True)
    plan.add_argument("--live-smoke", action="store_true")
    plan.add_argument("--smoke-reason", default="")

    fingerprint = sub.add_parser("fingerprint")
    fingerprint.add_argument("--output", type=Path, required=True)

    run = sub.add_parser("run")
    run.add_argument("--provider", choices=["openai"], required=True)
    run.add_argument("--cases", required=True)
    run.add_argument("--output", type=Path, required=True)
    run.add_argument("--budget-ledger", type=Path, required=True)
    run.add_argument("--execution", choices=["smoke", "probe"], required=True)

    evaluate = sub.add_parser("evaluate")
    evaluate.add_argument("--runs", type=Path, required=True)
    evaluate.add_argument("--output", type=Path, required=True)
    evaluate.add_argument("--manual-output", type=Path)

    try:
        args = parser.parse_args(argv)
        assert_input_gold_isolation()

        if args.command == "call-plan":
            _write(args.output, provider_call_plan(live_smoke_required=args.live_smoke, smoke_reason=args.smoke_reason))
            return 0

        if args.command == "fingerprint":
            _write(args.output, b24_behavior_fingerprint())
            return 0

        if args.command == "run":
            ids = _ids(args.cases)
            if ids & HOLDOUT_CASE_IDS:
                raise RuntimeError(f"STOP: holdout execution is forbidden: {sorted(ids & HOLDOUT_CASE_IDS)}")
            expected = {"smoke": {"case_09"}, "probe": set(PROBE_CASE_IDS)}[args.execution]
            if ids != expected:
                raise RuntimeError(f"STOP BEFORE PROVIDER EXECUTION: {args.execution} cases must be exactly {sorted(expected)}")
            development = {item.case_id for item in load_cases(split="dev")}
            if ids - development:
                raise ValueError(f"b24_non_development_cases_forbidden:{sorted(ids - development)}")

            load_local_env()
            provider = provider_from_name(args.provider)
            if getattr(provider, "model", None) != "gpt-5.6-terra" or getattr(provider, "reasoning_effort", None) != "medium":
                raise RuntimeError("STOP: B2.4 requires OpenAI gpt-5.6-terra reasoning_effort=medium")

            budget = CallBudget(args.budget_ledger, args.execution)
            payload = run_b24_cases(split="dev", case_ids=ids, provider=provider, budget=budget)
            budget.finish(
                {
                    "runs": len(payload["runs"]),
                    "actualCallsThisExecution": sum(len(item["metadata"]["providerStages"]) for item in payload["runs"]),
                }
            )
            _write(args.output, payload)
            return 0

        if args.command == "evaluate":
            payload = json.loads(args.runs.read_text(encoding="utf-8"))
            _write(args.output, evaluate_b24_file(args.runs))
            if args.manual_output:
                _write(args.manual_output, manual_adjudication(payload))
            return 0
    except ProviderUnavailable as exc:
        print(f"STOP PROVIDER: {exc}")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
