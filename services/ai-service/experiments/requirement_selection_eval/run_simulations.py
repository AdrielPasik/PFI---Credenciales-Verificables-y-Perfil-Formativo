"""Corre las SIMULACIONES del eval de seleccion. Cero llamadas al proveedor.

    python experiments/requirement_selection_eval/run_simulations.py

Tres escenarios por aviso, todos etiquetados como simulacion:

    ORACLE_PIPELINE   lo que la politica pide, pasado por el pipeline PRODUCTIVO
                      (extraccion -> seleccion -> builder) con un proveedor stub.
                      Prueba que el pipeline no pierde, no inventa ni recorta.
    OBSERVED_FAILURE  la falla reportada (cada linea es un requisito, con
                      inflaciones), SIN tope: el comportamiento previo del titular.
    NAIVE_SLICE       la falla anterior cortada con slice(0, 15).

Escribe `results/simulations_v1.json`.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
AI_SERVICE_ROOT = HERE.parents[1]
sys.path.insert(0, str(AI_SERVICE_ROOT))
sys.path.insert(0, str(HERE))

import eval_lib  # noqa: E402
from src.api.objective_understanding.contracts import ProviderObservation  # noqa: E402
from src.api.objective_understanding.service import run_objective_understanding  # noqa: E402

MAXIMUM = 15


class StubProvider:
    def __init__(self, *outputs: dict) -> None:
        self.outputs = list(outputs)
        self.calls = 0

    def complete(self, **_: object) -> ProviderObservation:
        self.calls += 1
        return ProviderObservation(output=self.outputs.pop(0), reported_model="stub")


def oracle_pipeline(posting: eval_lib.Posting, text: str) -> tuple[dict, int]:
    shown = eval_lib.Posting(posting.posting_id, posting.title, posting.objective_type, text, posting.gold)
    extracted = eval_lib.oracle_extraction(shown)
    outputs = [eval_lib.as_provider_proposals(extracted, eval_lib.oracle_unresolved(shown))]
    if len(extracted) > MAXIMUM:
        outputs.append({"selectedCandidateNumbers": eval_lib.oracle_selection(shown, extracted, MAXIMUM)})
    provider = StubProvider(*outputs)
    result = run_objective_understanding(
        objective_type=posting.objective_type,
        title=posting.title,
        raw_objective_text=text,
        max_proposed_requirements=MAXIMUM,
        provider=provider,
    )
    artifact = result["artifact"]
    scored = eval_lib.score(
        shown,
        eval_lib.artifact_candidates(artifact),
        MAXIMUM,
        unresolved=eval_lib.artifact_unresolved(artifact),
    )
    return scored, provider.calls


def main() -> int:
    import os

    os.environ.setdefault("OBJECTIVE_UNDERSTANDING_OPENAI_MODEL", "stub")
    report: dict = {
        "schemaVersion": "requirement_selection_simulations_v1",
        "kind": "SIMULATION",
        "providerCalls": 0,
        "maximum": MAXIMUM,
        "warning": (
            "Simulaciones: miden la metrica y el pipeline, NO la calidad del modelo. "
            "El gold esta pendiente de adjudicacion humana."
        ),
        "postings": [],
    }
    for posting in eval_lib.load_postings():
        oracle, calls = oracle_pipeline(posting, posting.text)
        permuted_text = eval_lib.permute_paragraphs(posting.text, seed=7)
        oracle_permuted, _ = oracle_pipeline(posting, permuted_text)
        failure = eval_lib.score(posting, eval_lib.observed_failure_extraction(posting), MAXIMUM)
        sliced = eval_lib.score(
            posting,
            eval_lib.naive_slice(eval_lib.observed_failure_extraction(posting), MAXIMUM),
            MAXIMUM,
        )
        entry = {
            "postingId": posting.posting_id,
            "goldItems": len(posting.items),
            "keepGroups": len(eval_lib.keep_groups(posting)),
            "scenarios": {
                "ORACLE_PIPELINE": {
                    **oracle,
                    "stubProviderLogicalCalls": calls,
                    "stabilityUnderPermutation": eval_lib.stability(oracle, oracle_permuted),
                    "acceptance": eval_lib.acceptance(oracle, MAXIMUM),
                },
                "OBSERVED_FAILURE": {**failure, "acceptance": eval_lib.acceptance(failure, MAXIMUM)},
                "NAIVE_SLICE": {**sliced, "acceptance": eval_lib.acceptance(sliced, MAXIMUM)},
            },
        }
        report["postings"].append(entry)

    out = HERE / "results" / "simulations_v1.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    header = f"{'aviso':8} {'escenario':17} {'n':>3} {'prec':>5} {'FP':>3} {'infl':>4} {'dup':>3} {'excl':>5} {'req':>5} {'recall':>6} {'NF':>3} {'acepta':>6}"
    print("SIMULACION (no es el modelo)\n" + header)
    for entry in report["postings"]:
        for name, result in entry["scenarios"].items():
            ok = all(result["acceptance"].values())
            print(
                f"{entry['postingId']:8} {name:17} {result['count']:>3} "
                f"{_fmt(result['precision']):>5} {result['falsePositives']:>3} "
                f"{len(result['inflations']):>4} {result['duplicates']:>3} "
                f"{_fmt(result['mandatoryCoverage']):>5} {_fmt(result['requiredCoverage']):>5} "
                f"{_fmt(result['keepRecall']):>6} {result['nonFormativeAsRequirement']:>3} "
                f"{'si' if ok else 'NO':>6}"
            )
    print(f"\nescrito: {out.relative_to(AI_SERVICE_ROOT)}")
    return 0


def _fmt(value: float | None) -> str:
    return "-" if value is None else f"{value:.2f}"


if __name__ == "__main__":
    raise SystemExit(main())
