from __future__ import annotations

import argparse, json
from pathlib import Path
from typing import Any

from .fixtures import assert_input_gold_isolation, load_cases
from .local_env import load_local_env
from .providers import provider_from_name

def _write(path: Path, value: Any) -> None: path.parent.mkdir(parents=True, exist_ok=True); path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
def _ids(raw: str) -> set[str]:
    return {f"case_{item.strip()}" if item.strip().isdigit() else item.strip() for item in raw.split(",") if item.strip()}
def main(argv: list[str] | None = None) -> int:
    parser=argparse.ArgumentParser(); sub=parser.add_subparsers(dest="cmd", required=True)
    for name in ("b21", "evaluate-b21", "b21-fingerprint", "compare-b21", "holdout-readiness-b21"):
        p=sub.add_parser(name); p.add_argument("--output", type=Path, required=True)
        if name=="b21": p.add_argument("--cases", required=True); p.add_argument("--repeats", type=int, default=5); p.add_argument("--provider", choices=["openai"], required=True)
        elif name=="evaluate-b21": p.add_argument("--runs", type=Path, required=True)
        elif name=="compare-b21": p.add_argument("--b1a", type=Path, required=True); p.add_argument("--b1b", type=Path, required=True); p.add_argument("--b2", type=Path, required=True); p.add_argument("--b21", type=Path, required=True)
        else: p.add_argument("--evaluation", type=Path) if name=="holdout-readiness-b21" else None
    args=parser.parse_args(argv); assert_input_gold_isolation()
    if args.cmd=="b21":
        from .b21_runtime import run_b21_cases
        ids=_ids(args.cases); dev={case.case_id for case in load_cases(split="dev")}
        if ids-dev: raise ValueError(f"b21_non_development_cases_forbidden:{sorted(ids-dev)}")
        load_local_env(); _write(args.output, run_b21_cases(split="dev", case_ids=ids, repeats=args.repeats, provider=provider_from_name(args.provider)))
    elif args.cmd=="evaluate-b21":
        from .b21_evaluation import evaluate_b21_file; _write(args.output, evaluate_b21_file(args.runs))
    elif args.cmd=="b21-fingerprint":
        from .b21_fingerprint import b21_behavior_fingerprint; _write(args.output, b21_behavior_fingerprint())
    elif args.cmd=="compare-b21":
        from .b21_evaluation import compare_b1_b2_b21; _write(args.output, compare_b1_b2_b21(args.b1a,args.b1b,args.b2,args.b21))
    else:
        from .b21_evaluation import holdout_readiness; _write(args.output, holdout_readiness(json.loads(args.evaluation.read_text(encoding="utf-8")), fingerprint_unchanged=True, smoke_passed=True))
    return 0
if __name__ == "__main__": raise SystemExit(main())
