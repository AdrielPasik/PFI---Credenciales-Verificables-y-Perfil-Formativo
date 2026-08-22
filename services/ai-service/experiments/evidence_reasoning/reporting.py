from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .evaluation import compare_files, evaluate_file

SECTIONS = [
    "Executive result", "What was implemented", "Experimental repository structure",
    "B0 implementation / capability baseline", "B1a architecture", "B1b architecture",
    "Source-addressable extraction implementation", "EvidenceUnit implementation",
    "Objective/Requirement/Qualifier implementation", "Facet and composition implementation",
    "Claim ceiling and epistemic policy", "Deterministic guards", "Provider/model abstraction",
    "Seed fixture construction", "Dev/holdout isolation verification", "Offline tests",
    "Live models actually executed", "Per-case experimental results", "B1a vs B1b comparison",
    "Grounding and hallucination results", "Qualifier results", "Composition results",
    "NOT_ASSESSABLE / ABSTAIN results", "Stability results", "Guard intervention analysis",
    "Latency/token/cost observations", "Errors and failure taxonomy", "Manual adjudication required",
    "Regression test results", "Files changed", "Known limitations", "Architecture verdict",
]


def build_report(*, b0_path: Path | None, b1a_path: Path | None, b1b_path: Path | None) -> str:
    b0 = _load(b0_path)
    b1a = evaluate_file(b1a_path) if b1a_path else None
    b1b = evaluate_file(b1b_path) if b1b_path else None
    comparison = compare_files(b1a_path, b1b_path) if b1a_path and b1b_path else None
    contents: dict[str, str] = {
        "Executive result": "Slice 0 harness implemented. Live architecture verdict requires B1a/B1b provider runs.",
        "What was implemented": "Isolated B0/B1a/B1b harness, source trace, staged artifacts, guards, policy, fixtures, evaluator and report generator.",
        "Experimental repository structure": "`services/ai-service/experiments/evidence_reasoning/`; no production runtime module is imported by B1.",
        "B0 implementation / capability baseline": _b0_summary(b0),
        "B1a architecture": "One provider call with a strict structured schema; output is preserved without applying B1b policy corrections.",
        "B1b architecture": "Five semantic stages plus deterministic validation, epistemic policy and renderer.",
        "Source-addressable extraction implementation": "Text SHA/offset/excerpt and PDF page-aware extraction with FULL/PARTIAL/FAILED coverage.",
        "EvidenceUnit implementation": "Objective-independent proposition proposals survive only after exact source alignment; authoritative provenance is injected by code.",
        "Objective/Requirement/Qualifier implementation": "Objective-only stage with exact spans, atomicity, evidence type and qualifiers.",
        "Facet and composition implementation": "Facet planning occurs before evidence is shown; composition records coverage, redundancy and bridge evidence.",
        "Claim ceiling and epistemic policy": "Semantic ceiling decisions are separate from deterministic final-state policy; relation is never mapped directly to state.",
        "Deterministic guards": "Observable PASS/FAIL records cover identity, offsets, provenance, evidence IDs, facets, qualifiers, integration, lineage, blockchain and extraction quality.",
        "Provider/model abstraction": "Raw HTTPS adapters for OpenAI Responses and Anthropic Messages; model IDs and credentials come from environment variables.",
        "Seed fixture construction": "17 synthetic Spanish cases transcribed from the FROZEN seed semantics.",
        "Dev/holdout isolation verification": "Inputs and gold annotations are separate files; inference loaders never load gold.",
        "Offline tests": "Populate from the final Codex regression report.",
        "Live models actually executed": _live_models(b1a_path, b1b_path),
        "Per-case experimental results": _per_case(b1a, b1b),
        "B1a vs B1b comparison": _summary(comparison, "Pending live B1a and B1b runs."),
        "Grounding and hallucination results": _metric_pair(b1a, b1b, "hallucinatedEvidenceSignals"),
        "Qualifier results": "Structured qualifier preservation is captured; semantic correctness requires gold expansion/manual adjudication.",
        "Composition results": "Reported per case; cases 08, 09, 10 and 11 are the critical pilot observations.",
        "NOT_ASSESSABLE / ABSTAIN results": "Reported for cases 13–15 when live outputs exist.",
        "Stability results": _stability(b1a, b1b),
        "Guard intervention analysis": _metric_pair(b1a, b1b, "guardFailures"),
        "Latency/token/cost observations": "Provider-reported usage and measured stage latency are stored. Prices are not hardcoded.",
        "Errors and failure taxonomy": "No live error taxonomy until model runs are available.",
        "Manual adjudication required": "Claim-ceiling faithfulness, weaker-claim usefulness and same-Requirement continuity.",
        "Regression test results": "Populate from the final Codex regression report.",
        "Files changed": "See git diff in the final Codex report.",
        "Known limitations": "Small engineering seed; no OCR, vector DB, contextual EU recovery or scientific validation.",
        "Architecture verdict": "PENDING LIVE EVALUATION — no PASS/FAIL claim is made without B1a/B1b observations.",
    }
    lines: list[str] = []
    for index, title in enumerate(SECTIONS, start=1):
        lines.extend([f"## {index}. {title}", "", contents[title], ""])
    lines.extend(["TARGET AI ARCHITECTURE v1:", "PENDING LIVE EVALUATION", "", "RECOMMENDED NEXT STEP:", "Run the frozen B1a/B1b comparison with configured provider credentials; do not execute a B2 change before reviewing its report."])
    return "\n".join(lines) + "\n"


def _load(path: Path | None) -> dict[str, Any] | None:
    return json.loads(path.read_text(encoding="utf-8")) if path else None


def _summary(value: Any, fallback: str) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2) if value is not None else fallback


def _b0_summary(payload: dict[str, Any] | None) -> str:
    if not payload:
        return "B0 not supplied."
    runs = payload.get("runs", [])
    artifacts = [artifact for run in runs for artifact in run.get("artifacts", [])]
    observed_fields = sorted({key for artifact in artifacts for key in artifact})
    return json.dumps(
        {
            "cases": len(runs),
            "artifacts": len(artifacts),
            "schemaVersions": sorted({item.get("schemaVersion") for item in artifacts}),
            "observedFields": observed_fields,
            "evidenceReasoningFinalStateMetricApplied": False,
        },
        ensure_ascii=False,
        indent=2,
    )


def _live_models(*paths: Path | None) -> str:
    models: list[str] = []
    for path in paths:
        if not path:
            continue
        payload = _load(path) or {}
        for run in payload.get("runs", []):
            for stage in run["metadata"].get("providerStages", []):
                models.append(f"{stage['provider']}:{stage['effectiveModel']}")
    return ", ".join(sorted(set(models))) if models else "None; live execution pending."


def _per_case(a: dict[str, Any] | None, b: dict[str, Any] | None) -> str:
    items = []
    for label, payload in (("B1a", a), ("B1b", b)):
        if payload:
            for row in payload["perRun"]:
                items.append(f"- {label} {row['caseId']} run {row['repetition']}: {row['actualState']} (expected {row['expectedState']})")
    return "\n".join(items) if items else "Pending live results."


def _metric_pair(a: dict[str, Any] | None, b: dict[str, Any] | None, key: str) -> str:
    return f"B1a={a.get(key) if a else 'pending'}; B1b={b.get(key) if b else 'pending'}."


def _stability(a: dict[str, Any] | None, b: dict[str, Any] | None) -> str:
    return _summary({"b1a": a.get("stability") if a else None, "b1b": b.get("stability") if b else None}, "Pending.")
