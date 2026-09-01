from __future__ import annotations
import argparse, json
from pathlib import Path
from typing import Any
from .b23_evaluation import evaluate_b23_file, manual_adjudication
from .b23_fingerprint import b23_behavior_fingerprint
from .b23_runtime import CallBudget, provider_call_plan, run_b23_cases
from .fixtures import assert_input_gold_isolation, load_cases
from .local_env import load_local_env
from .providers import ProviderUnavailable, provider_from_name
def _write(path: Path, payload: Any) -> None: path.parent.mkdir(parents=True, exist_ok=True); path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
def _ids(value: str) -> set[str]: return {f"case_{x.strip()}" if x.strip().isdigit() and len(x.strip()) == 2 else x.strip() for x in value.split(",") if x.strip()}
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="B2.3 cost-controlled continuity ablation"); sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("call-plan"); p.add_argument("--output", type=Path, required=True)
    p = sub.add_parser("fingerprint"); p.add_argument("--output", type=Path, required=True)
    p = sub.add_parser("run"); p.add_argument("--provider", choices=["openai"], required=True); p.add_argument("--cases", required=True); p.add_argument("--output", type=Path, required=True); p.add_argument("--budget-ledger", type=Path, required=True); p.add_argument("--execution", choices=["smoke", "probe"], required=True)
    p = sub.add_parser("evaluate"); p.add_argument("--runs", type=Path, required=True); p.add_argument("--output", type=Path, required=True); p.add_argument("--manual-output", type=Path)
    try:
        args = parser.parse_args(argv); assert_input_gold_isolation()
        if args.command == "call-plan": _write(args.output, provider_call_plan()); return 0
        if args.command == "fingerprint": _write(args.output, b23_behavior_fingerprint()); return 0
        if args.command == "run":
            ids = _ids(args.cases); expected = {"smoke": {"case_09"}, "probe": {f"case_{x}" for x in ("03", "05", "06", "07", "08", "09", "11", "12", "15")}}[args.execution]
            if ids != expected: raise RuntimeError(f"STOP BEFORE PROVIDER EXECUTION: {args.execution} cases must be exactly {sorted(expected)}")
            dev = {x.case_id for x in load_cases(split="dev")}
            if ids - dev: raise ValueError(f"b23_non_development_cases_forbidden:{sorted(ids-dev)}")
            load_local_env(); provider = provider_from_name(args.provider)
            if getattr(provider, "model", None) != "gpt-5.6-terra" or getattr(provider, "reasoning_effort", None) != "medium": raise RuntimeError("STOP: B2.3 requires OpenAI gpt-5.6-terra reasoning_effort=medium")
            budget = CallBudget(args.budget_ledger, args.execution); payload = run_b23_cases(split="dev", case_ids=ids, provider=provider, budget=budget); budget.finish({"runs": len(payload["runs"]), "actualCallsThisExecution": sum(len(x["metadata"]["providerStages"]) for x in payload["runs"])}); _write(args.output, payload); return 0
        if args.command == "evaluate":
            payload = json.loads(args.runs.read_text(encoding="utf-8")); _write(args.output, evaluate_b23_file(args.runs))
            if args.manual_output: _write(args.manual_output, manual_adjudication(payload))
            return 0
    except ProviderUnavailable as exc: print(f"STOP PROVIDER: {exc}"); return 2
    return 0
if __name__ == "__main__": raise SystemExit(main())
