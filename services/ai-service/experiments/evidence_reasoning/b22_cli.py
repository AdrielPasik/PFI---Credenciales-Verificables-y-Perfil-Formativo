from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .b22_evaluation import evaluate_b22_file, holdout_readiness, manual_adjudication
from .b22_fingerprint import b22_behavior_fingerprint
from .b22_runtime import provider_call_plan, run_b22_cases
from .fixtures import assert_input_gold_isolation, load_cases
from .local_env import load_local_env
from .providers import ProviderUnavailable, provider_from_name


def _write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True); path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _ids(value: str) -> set[str]:
    result: set[str] = set()
    for item in value.split(","):
        normalized = item.strip()
        if not normalized:
            continue
        result.add(f"case_{normalized}" if normalized.isdigit() and len(normalized) == 2 else normalized)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Isolated B2.2 Evidence Reasoning harness"); sub = parser.add_subparsers(dest="command", required=True)
    plan = sub.add_parser("call-plan"); plan.add_argument("--cases", type=int, required=True); plan.add_argument("--repeats", type=int, required=True); plan.add_argument("--output", type=Path, required=True)
    fp = sub.add_parser("fingerprint"); fp.add_argument("--output", type=Path, required=True)
    run = sub.add_parser("run"); run.add_argument("--provider", choices=["openai"], required=True); run.add_argument("--cases", required=True); run.add_argument("--repeats", type=int, required=True); run.add_argument("--output", type=Path, required=True)
    evaluate = sub.add_parser("evaluate"); evaluate.add_argument("--runs", type=Path, required=True); evaluate.add_argument("--output", type=Path, required=True); evaluate.add_argument("--manual-output", type=Path)
    try:
        args = parser.parse_args(argv); assert_input_gold_isolation()
        if args.command == "call-plan": _write(args.output, provider_call_plan(cases=args.cases, repeats=args.repeats)); return 0
        if args.command == "fingerprint": _write(args.output, b22_behavior_fingerprint()); return 0
        if args.command == "run":
            ids = _ids(args.cases); dev = {item.case_id for item in load_cases(split="dev")}; invalid = ids - dev
            if invalid: raise ValueError(f"b22_non_development_cases_forbidden:{sorted(invalid)}")
            load_local_env(); provider = provider_from_name(args.provider)
            if getattr(provider, "model", None) != "gpt-5.6-terra" or getattr(provider, "reasoning_effort", None) != "medium": raise RuntimeError("STOP: B2.2 requires OpenAI gpt-5.6-terra reasoning_effort=medium")
            payload = run_b22_cases(split="dev", case_ids=ids, repeats=args.repeats, provider=provider); _write(args.output, payload); return 0
        if args.command == "evaluate":
            payload = json.loads(args.runs.read_text(encoding="utf-8")); evaluation = evaluate_b22_file(args.runs); _write(args.output, evaluation)
            if args.manual_output: _write(args.manual_output, manual_adjudication(payload))
            return 0
    except ProviderUnavailable as exc:
        print(f"STOP PROVIDER: {exc}"); return 2
    return 0


if __name__ == "__main__": raise SystemExit(main())
