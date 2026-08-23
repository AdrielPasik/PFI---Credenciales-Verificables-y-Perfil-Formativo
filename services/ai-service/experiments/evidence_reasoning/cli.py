from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .fixtures import assert_input_gold_isolation, load_cases
from .local_env import load_local_env
from .providers import ProviderUnavailable, provider_from_name
from .runtime import run_cases
from .schemas import SCHEMAS

SERVICE_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = SERVICE_ROOT / "config" / "settings.json"


def _write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _case_ids(raw: str | None) -> set[str] | None:
    return {item.strip() for item in raw.split(",") if item.strip()} if raw else None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Isolated Evidence Reasoning Slice 0 harness")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("b0", "b1a", "b1b"):
        item = sub.add_parser(name)
        item.add_argument("--output", type=Path, required=True)
        item.add_argument("--split", choices=["all", "dev", "holdout"], default="all")
        item.add_argument("--cases", help="Comma-separated case IDs")
        if name != "b0":
            item.add_argument("--provider", choices=["openai", "anthropic"], required=True)
            item.add_argument("--repeats", type=int, default=5)
    compare = sub.add_parser("compare")
    compare.add_argument("--provider", choices=["openai", "anthropic"], required=True)
    compare.add_argument("--output-dir", type=Path, required=True)
    compare.add_argument("--split", choices=["all", "dev", "holdout"], default="all")
    compare.add_argument("--cases")
    compare.add_argument("--repeats", type=int, default=5)
    evaluate = sub.add_parser("evaluate")
    evaluate.add_argument("--runs", type=Path, required=True)
    evaluate.add_argument("--output", type=Path, required=True)
    report = sub.add_parser("report")
    report.add_argument("--b0", type=Path)
    report.add_argument("--b1a", type=Path)
    report.add_argument("--b1b", type=Path)
    report.add_argument("--output", type=Path, required=True)
    schemas = sub.add_parser("schemas")
    schemas.add_argument("--output", type=Path, required=True)
    b2 = sub.add_parser("b2")
    b2.add_argument("--provider", choices=["openai", "anthropic"], required=True)
    b2.add_argument("--output", type=Path, required=True)
    b2.add_argument("--cases", required=True, help="Comma-separated Development case IDs")
    b2.add_argument("--repeats", type=int, default=5)
    evaluate_b2 = sub.add_parser("evaluate-b2")
    evaluate_b2.add_argument("--runs", type=Path, required=True)
    evaluate_b2.add_argument("--output", type=Path, required=True)
    compare_b2 = sub.add_parser("compare-b2")
    compare_b2.add_argument("--b1a", type=Path, required=True)
    compare_b2.add_argument("--b1b", type=Path, required=True)
    compare_b2.add_argument("--b2", type=Path, required=True)
    compare_b2.add_argument("--output", type=Path, required=True)
    b2_schemas = sub.add_parser("b2-schemas")
    b2_schemas.add_argument("--output", type=Path, required=True)
    b2_fingerprint = sub.add_parser("b2-fingerprint")
    b2_fingerprint.add_argument("--output", type=Path, required=True)
    sub.add_parser("inventory")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    assert_input_gold_isolation()
    try:
        if args.command in {"b1a", "b1b", "compare", "b2"}:
            load_local_env()
        if args.command in {"b0", "b1a", "b1b"}:
            provider = provider_from_name(args.provider) if args.command != "b0" else None
            payload = run_cases(
                args.command,
                split=args.split,
                case_ids=_case_ids(args.cases),
                repeats=getattr(args, "repeats", 1),
                provider=provider,
                config_path=DEFAULT_CONFIG,
            )
            _write(args.output, payload)
        elif args.command == "compare":
            from .evaluation import compare_files

            provider = provider_from_name(args.provider)
            ids = _case_ids(args.cases)
            b1a_path = args.output_dir / "b1a_runs.json"
            b1b_path = args.output_dir / "b1b_runs.json"
            _write(b1a_path, run_cases("b1a", split=args.split, case_ids=ids, repeats=args.repeats, provider=provider, config_path=DEFAULT_CONFIG))
            _write(b1b_path, run_cases("b1b", split=args.split, case_ids=ids, repeats=args.repeats, provider=provider, config_path=DEFAULT_CONFIG))
            _write(args.output_dir / "comparison.json", compare_files(b1a_path, b1b_path))
        elif args.command == "evaluate":
            from .evaluation import evaluate_file

            _write(args.output, evaluate_file(args.runs))
        elif args.command == "report":
            from .reporting import build_report

            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(build_report(b0_path=args.b0, b1a_path=args.b1a, b1b_path=args.b1b), encoding="utf-8")
        elif args.command == "schemas":
            _write(args.output, SCHEMAS)
        elif args.command == "b2":
            from .b2_runtime import run_b2_cases

            ids = _case_ids(args.cases) or set()
            development_ids = {case.case_id for case in load_cases(split="dev")}
            invalid = ids - development_ids
            if invalid:
                raise ValueError(f"b2_non_development_cases_forbidden:{sorted(invalid)}")
            provider = provider_from_name(args.provider)
            _write(args.output, run_b2_cases(split="dev", case_ids=ids, repeats=args.repeats, provider=provider))
        elif args.command == "evaluate-b2":
            from .b2_evaluation import evaluate_b2_file

            _write(args.output, evaluate_b2_file(args.runs))
        elif args.command == "compare-b2":
            from .b2_evaluation import compare_b1_b2

            _write(args.output, compare_b1_b2(args.b1a, args.b1b, args.b2))
        elif args.command == "b2-schemas":
            from .b2_schemas import B2_SCHEMAS

            _write(args.output, B2_SCHEMAS)
        elif args.command == "b2-fingerprint":
            from .b2_fingerprint import b2_behavior_fingerprint

            _write(args.output, b2_behavior_fingerprint())
        elif args.command == "inventory":
            from .gold import load_gold

            gold = load_gold()
            rows = [
                {
                    "case": case.case_id,
                    "domain": case.domain,
                    "split": case.split,
                    "inputFile": "fixtures/inputs/seed_v0_inputs.json",
                    "goldFile": "fixtures/gold/seed_v0_gold.json",
                    "phenomenon": gold[case.case_id]["phenomenon"],
                }
                for case in load_cases()
            ]
            print(json.dumps(rows, ensure_ascii=False, indent=2))
        return 0
    except ProviderUnavailable as exc:
        print(f"STOP E: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
