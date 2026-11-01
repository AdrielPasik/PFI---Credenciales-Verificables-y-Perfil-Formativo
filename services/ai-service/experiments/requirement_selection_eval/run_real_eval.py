"""Eval ACOTADO contra el proveedor real. GENERA COSTO: no correr sin autorizacion.

    REQUIREMENT_SELECTION_EVAL_ALLOW_PROVIDER=1 \\
    python experiments/requirement_selection_eval/run_real_eval.py \\
        --allow-billable-provider-calls \\
        --max-calls 24 --max-cost-usd 5 \\
        --input-usd-per-mtok <precio> --output-usd-per-mtok <precio>

Por aviso hace la propuesta productiva completa (extraccion y, si sobran,
seleccion) con `max_proposed_requirements=15`, y lo mismo sobre una permutacion
de parrafos para medir estabilidad. Solo usa los avisos SINTETICOS de este
directorio: ningun dato personal, ningun trafico productivo, ninguna base.

BARRERAS antes de la primera llamada:

    1. la bandera `--allow-billable-provider-calls`
    2. `REQUIREMENT_SELECTION_EVAL_ALLOW_PROVIDER=1` en el entorno
    3. presupuesto de llamadas logicas (`--max-calls`, techo duro 24)
    4. presupuesto de costo (`--max-cost-usd`, techo duro 10) con los precios
       del modelo configurado pasados EXPLICITAMENTE (no hay precios por defecto:
       el runner no adivina cuanto cuesta un modelo)

EL COSTO ES UNA COTA SUPERIOR. El proveedor productivo no expone el uso de
tokens, asi que antes de CADA llamada se proyecta:

    entrada  = caracteres del prompt / 3        (cota alta para espanol)
    salida   = --assumed-max-output-tokens      (incluye razonamiento oculto)

y si el acumulado proyectado pasaria el presupuesto, la llamada NO se hace. El
costo real queda por debajo de lo reportado.

Escribe `results/real_eval_<timestamp>.json` con metricas, duracion por etapa
(extraccion / seleccion), textos propuestos (sinteticos), y la comparacion
contra el gold PROVISIONAL. No guarda prompt, respuesta cruda ni tokens.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
AI_SERVICE_ROOT = HERE.parents[1]
sys.path.insert(0, str(AI_SERVICE_ROOT))
sys.path.insert(0, str(HERE))

import eval_lib  # noqa: E402

MAXIMUM = 15
HARD_CALL_CEILING = 24
HARD_COST_CEILING_USD = 10.0
ENV_GATE = "REQUIREMENT_SELECTION_EVAL_ALLOW_PROVIDER"
CHARS_PER_TOKEN_LOWER_BOUND = 3.0
SELECTION_SCHEMA_NAME = "requirement_selection_v1"


class BudgetExceeded(RuntimeError):
    pass


class BudgetedProvider:
    """Envuelve al proveedor real: cuenta, proyecta costo y mide cada etapa."""

    def __init__(
        self,
        inner: object,
        budget: int,
        *,
        max_cost_usd: float = float("inf"),
        input_usd_per_mtok: float = 0.0,
        output_usd_per_mtok: float = 0.0,
        assumed_max_output_tokens: int = 0,
    ) -> None:
        self.inner = inner
        self.budget = budget
        self.max_cost_usd = max_cost_usd
        self.input_price = input_usd_per_mtok / 1_000_000
        self.output_price = output_usd_per_mtok / 1_000_000
        self.assumed_output = assumed_max_output_tokens
        self.calls = 0
        self.projected_cost_usd = 0.0
        self.stage_log: list[dict] = []

    def projected_call_cost(self, prompt: str) -> float:
        input_tokens = len(prompt) / CHARS_PER_TOKEN_LOWER_BOUND
        return input_tokens * self.input_price + self.assumed_output * self.output_price

    def complete(self, **kwargs: object):
        if self.calls >= self.budget:
            raise BudgetExceeded(f"presupuesto de {self.budget} llamadas agotado")
        cost = self.projected_call_cost(str(kwargs.get("prompt", "")))
        if self.projected_cost_usd + cost > self.max_cost_usd:
            raise BudgetExceeded(
                f"la proxima llamada llevaria el costo proyectado a "
                f"{self.projected_cost_usd + cost:.2f} USD (tope {self.max_cost_usd:.2f})"
            )
        self.calls += 1
        self.projected_cost_usd += cost
        stage = "selection" if kwargs.get("schema_name") == SELECTION_SCHEMA_NAME else "extraction"
        started = time.monotonic()
        try:
            return self.inner.complete(**kwargs)
        finally:
            self.stage_log.append(
                {"stage": stage, "durationMs": round((time.monotonic() - started) * 1000)}
            )


def capture_usage(provider: object, sink: list[dict]) -> None:
    """Registra SOLO los contadores numericos de `usage` de cada respuesta.

    El proveedor productivo descarta `usage`; esto lo observa sin cambiarlo,
    envolviendo `_post` de ESTA instancia. Nada de texto, prompt ni headers.
    """
    original = provider._post  # type: ignore[attr-defined]

    def observed(payload: dict) -> dict:
        body = original(payload)
        usage = body.get("usage") if isinstance(body, dict) else None
        usage = usage if isinstance(usage, dict) else {}
        details_out = usage.get("output_tokens_details") or {}
        details_in = usage.get("input_tokens_details") or {}
        sink.append(
            {
                "inputTokens": usage.get("input_tokens"),
                "cachedInputTokens": details_in.get("cached_tokens"),
                "outputTokens": usage.get("output_tokens"),
                "reasoningTokens": details_out.get("reasoning_tokens"),
            }
        )
        return body

    provider._post = observed  # type: ignore[attr-defined]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--allow-billable-provider-calls", action="store_true")
    parser.add_argument("--max-calls", type=int, default=24)
    parser.add_argument("--max-cost-usd", type=float, default=None)
    parser.add_argument("--input-usd-per-mtok", type=float, default=None)
    parser.add_argument("--output-usd-per-mtok", type=float, default=None)
    parser.add_argument("--assumed-max-output-tokens", type=int, default=12_000)
    parser.add_argument("--no-permutation", action="store_true")
    parser.add_argument("--postings", nargs="*", default=None, help="ids RSE_NN; por defecto todos")
    return parser.parse_args(argv)


def check_gates(args: argparse.Namespace) -> str | None:
    """Devuelve el motivo para NO correr, o None si todas las barreras pasan."""
    if not args.allow_billable_provider_calls:
        return "falta --allow-billable-provider-calls"
    if os.environ.get(ENV_GATE) != "1":
        return f"falta {ENV_GATE}=1"
    if not 1 <= args.max_calls <= HARD_CALL_CEILING:
        return f"--max-calls debe estar entre 1 y {HARD_CALL_CEILING}"
    if args.max_cost_usd is None or not 0 < args.max_cost_usd <= HARD_COST_CEILING_USD:
        return f"--max-cost-usd es obligatorio y debe estar entre 0 y {HARD_COST_CEILING_USD}"
    if args.input_usd_per_mtok is None or args.output_usd_per_mtok is None:
        return "faltan --input-usd-per-mtok y --output-usd-per-mtok (precios del modelo configurado)"
    if args.input_usd_per_mtok <= 0 or args.output_usd_per_mtok <= 0:
        return "los precios deben ser positivos"
    if args.assumed_max_output_tokens < 1:
        return "--assumed-max-output-tokens debe ser positivo"
    return None


def comparison_summary(postings: list[dict]) -> dict:
    """Comparacion agregada contra el gold PROVISIONAL."""
    bases = [p["base"] for p in postings if "base" in p]
    if not bases:
        return {}
    checks = [all(b["acceptance"].values()) for b in bases]
    precisions = [b["precision"] for b in bases if b["precision"] is not None]
    return {
        "goldStatus": "PROVISIONAL: pendiente de adjudicacion humana",
        "postingsEvaluated": len(bases),
        "postingsAccepted": sum(checks),
        "minPrecision": min(precisions) if precisions else None,
        "totalFalsePositives": sum(b["falsePositives"] for b in bases),
        "totalUnanchored": sum(b["unanchored"] for b in bases),
        "totalInflations": sum(len(b["inflations"]) for b in bases),
        "totalDuplicates": sum(b["duplicates"] for b in bases),
        "totalNonFormativeAsRequirement": sum(b["nonFormativeAsRequirement"] for b in bases),
        "stability": [p.get("stabilityUnderPermutation") for p in postings],
    }


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    reason = check_gates(args)
    if reason is not None:
        print(f"NO SE EJECUTA: {reason}. Este eval llama al proveedor real y genera costo.")
        return 2

    from src.api.objective_understanding.provider import OpenAIObjectiveUnderstandingProvider
    from src.api.objective_understanding.service import run_objective_understanding

    real_provider = OpenAIObjectiveUnderstandingProvider()
    usage_log: list[dict] = []
    capture_usage(real_provider, usage_log)
    provider = BudgetedProvider(
        real_provider,
        args.max_calls,
        max_cost_usd=args.max_cost_usd,
        input_usd_per_mtok=args.input_usd_per_mtok,
        output_usd_per_mtok=args.output_usd_per_mtok,
        assumed_max_output_tokens=args.assumed_max_output_tokens,
    )
    postings = [
        p for p in eval_lib.load_postings() if args.postings is None or p.posting_id in args.postings
    ]
    report: dict = {
        "schemaVersion": "requirement_selection_real_eval_v2",
        "kind": "REAL_PROVIDER",
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "maximum": MAXIMUM,
        "model": os.environ.get("OBJECTIVE_UNDERSTANDING_OPENAI_MODEL"),
        "budget": {
            "maxCalls": args.max_calls,
            "maxCostUsd": args.max_cost_usd,
            "inputUsdPerMtok": args.input_usd_per_mtok,
            "outputUsdPerMtok": args.output_usd_per_mtok,
            "assumedMaxOutputTokens": args.assumed_max_output_tokens,
            "costIsUpperBound": True,
        },
        "postings": [],
    }

    def propose(posting: eval_lib.Posting, text: str) -> dict:
        first_log = len(provider.stage_log)
        started = time.monotonic()
        result = run_objective_understanding(
            objective_type=posting.objective_type,
            title=posting.title,
            raw_objective_text=text,
            max_proposed_requirements=MAXIMUM,
            provider=provider,
        )
        shown = eval_lib.Posting(posting.posting_id, posting.title, posting.objective_type, text, posting.gold)
        artifact = result["artifact"]
        scored = eval_lib.score(
            shown,
            eval_lib.artifact_candidates(artifact),
            MAXIMUM,
            unresolved=eval_lib.artifact_unresolved(artifact),
        )
        scored["selection"] = result["execution"]["selection"]
        scored["stageDurationsMs"] = provider.stage_log[first_log:]
        scored["totalDurationMs"] = round((time.monotonic() - started) * 1000)
        scored["proposedTexts"] = [c["proposedRequirementText"] for c in artifact["candidates"]]
        # Citas primarias (sinteticas): permiten re-medir sin volver a llamar.
        scored["proposedQuotes"] = [c["quote"] for c in eval_lib.artifact_candidates(artifact)]
        scored["omittedTexts"] = [c["proposedRequirementText"] for c in artifact["omittedCandidates"]]
        scored["unresolvedExcerpts"] = eval_lib.artifact_unresolved(artifact)
        scored["acceptance"] = eval_lib.acceptance(scored, MAXIMUM)
        return scored

    try:
        for posting in postings:
            entry: dict = {"postingId": posting.posting_id}
            try:
                entry["base"] = propose(posting, posting.text)
                if not args.no_permutation:
                    entry["permuted"] = propose(posting, eval_lib.permute_paragraphs(posting.text, seed=7))
                    entry["stabilityUnderPermutation"] = eval_lib.stability(entry["base"], entry["permuted"])
            except BudgetExceeded:
                raise
            except Exception as error:  # el fallo de UN aviso es un resultado, no un crash
                entry["error"] = type(error).__name__ + ":" + str(error)[:200]
            report["postings"].append(entry)
    except BudgetExceeded as error:
        report["stoppedBy"] = str(error)
    finally:
        report["providerLogicalCalls"] = provider.calls
        report["projectedCostUpperBoundUsd"] = round(provider.projected_cost_usd, 4)
        actual = 0.0
        for index, usage in enumerate(usage_log):
            input_tokens = usage.get("inputTokens") or 0
            cached = usage.get("cachedInputTokens") or 0
            output_tokens = usage.get("outputTokens") or 0
            usage["costUsd"] = round(
                (input_tokens - cached) * provider.input_price
                + cached * provider.input_price / 10
                + output_tokens * provider.output_price,
                6,
            )
            if index < len(provider.stage_log):
                usage["stage"] = provider.stage_log[index]["stage"]
                usage["durationMs"] = provider.stage_log[index]["durationMs"]
            actual += usage["costUsd"]
        report["usagePerCall"] = usage_log
        report["actualCostUsd"] = round(actual, 6)
        report["comparisonAgainstProvisionalGold"] = comparison_summary(report["postings"])
        out = HERE / "results" / f"real_eval_{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.json"
        out.parent.mkdir(exist_ok=True)
        out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(
            f"llamadas logicas: {provider.calls}; costo proyectado (cota) "
            f"{provider.projected_cost_usd:.2f} USD; escrito {out.name}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
