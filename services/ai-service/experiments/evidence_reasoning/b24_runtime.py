from __future__ import annotations

import hashlib
import json
import subprocess
import time
from pathlib import Path
from typing import Any

from .b24_artifacts import (
    build_b24_objective_analysis,
    build_evidence_units,
    exact_redundancy_and_lineage,
    source_observability_facts,
)
from .b24_policy import b24_final_state
from .b24_prompts import (
    b24_evidence_unit_quote_first_prompt,
    objective_analysis_prompt,
    unified_reasoning_prompt,
)
from .b24_renderer import render_b24_explanation
from .b24_schemas import b24_schema_for_provider, validate_b24_schema
from .b24_validation import validate_and_enrich_b24
from .b24_versions import B24_PROMPT_VERSIONS, B24_VERSIONS
from .extraction import materialize_sources
from .fixtures import load_cases
from .models import FixtureCase
from .providers import StructuredProvider
from .versions import VERSIONS

# Topology is unchanged from B2: three semantic provider stages per run.
SINGLE_REQUIREMENT_STAGES = 3
PROBE_CASE_IDS = ["case_03", "case_11", "case_06", "case_08", "case_09"]

# Preferred cap when no live smoke is needed: 5 runs x 1 repetition x 3 calls.
PREFERRED_HARD_CAP = 15
# Only reachable if exactly one technical smoke is justified: 3 + 15.
ABSOLUTE_HARD_CAP = 18


def provider_call_plan(*, live_smoke_required: bool = False, smoke_reason: str = "") -> dict[str, Any]:
    smoke_calls = SINGLE_REQUIREMENT_STAGES if live_smoke_required else 0
    probe_calls = len(PROBE_CASE_IDS) * SINGLE_REQUIREMENT_STAGES
    combined = smoke_calls + probe_calls
    hard_cap = ABSOLUTE_HARD_CAP if live_smoke_required else PREFERRED_HARD_CAP
    return {
        "hardCap": hard_cap,
        "absoluteHardCap": ABSOLUTE_HARD_CAP,
        "liveSmokeRequired": live_smoke_required,
        "liveSmokeReason": smoke_reason
        or "Schemas, runtime wiring, artifact construction, persistence and serialization are fully verified offline by the structural dry-run; no live smoke is justified.",
        "smoke": {"caseIds": ["case_09"] if live_smoke_required else [], "repetitions": 1 if live_smoke_required else 0, "expectedCalls": smoke_calls},
        "developmentProbe": {
            "caseIds": PROBE_CASE_IDS,
            "repetitions": 1,
            "semanticStagesPerRun": SINGLE_REQUIREMENT_STAGES,
            "expectedCalls": probe_calls,
        },
        "combinedExpectedCalls": combined,
        "topology": "EvidenceUnit + ObjectiveAnalysis + exactly one UnifiedContextualReasoning for one resolved Requirement. AMBIGUOUS stops after ObjectiveAnalysis; more than one resolved Requirement stops before the second unified call.",
        "status": "PASS" if combined <= hard_cap <= ABSOLUTE_HARD_CAP else "STOP_BEFORE_PROVIDER_EXECUTION",
    }


class CallBudget:
    """Shared cross-execution ledger. No hidden retries, no silent overspend."""

    def __init__(self, path: Path, execution: str):
        self.path = path
        self.execution = execution
        if not path.exists():
            raise RuntimeError("STOP BEFORE PROVIDER EXECUTION: missing shared B2.4 provider-call budget ledger")
        self.payload = json.loads(path.read_text(encoding="utf-8"))
        cap = self.payload.get("hardCap")
        if (
            self.payload.get("status") != "PASS"
            or not isinstance(cap, int)
            or cap > ABSOLUTE_HARD_CAP
            or self.payload.get("combinedExpectedCalls") != cap
        ):
            raise RuntimeError("STOP BEFORE PROVIDER EXECUTION: invalid B2.4 topology bound")
        self.cap = cap
        self.payload.setdefault("actualCalls", 0)
        self.payload.setdefault("callsByStage", {})
        self.payload.setdefault("retries", 0)
        self.payload.setdefault("executionHistory", [])

    def reserve(self, stage: str) -> None:
        if self.payload["actualCalls"] + 1 > self.cap:
            self.payload["status"] = "PROVIDER_CALL_BUDGET_ANOMALY"
            self._save()
            raise RuntimeError("PROVIDER_CALL_BUDGET_ANOMALY")
        self.payload["actualCalls"] += 1
        self.payload["callsByStage"][stage] = self.payload["callsByStage"].get(stage, 0) + 1
        self._save()

    def finish(self, summary: dict[str, Any]) -> None:
        self.payload["executionHistory"].append({"execution": self.execution, **summary})
        self._save()

    def _save(self) -> None:
        self.path.write_text(json.dumps(self.payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _repo_sha() -> str | None:
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def _provider_meta(stage: str, result: Any) -> dict[str, Any]:
    return {
        "stage": stage,
        "provider": result.provider,
        "requestedModel": result.requested_model,
        "effectiveModel": result.effective_model,
        "latencyMs": result.latency_ms,
        "usage": result.usage,
        "retries": 0,
    }


def _metadata(case: FixtureCase, provider: StructuredProvider, stages: list[dict[str, Any]], status: str) -> dict[str, Any]:
    fingerprint = {
        "caseId": case.case_id,
        "objective": case.objective,
        "sourceHashes": sorted(hashlib.sha256(item.content.encode("utf-8")).hexdigest() for item in case.sources),
        "versions": B24_VERSIONS,
        "prompts": B24_PROMPT_VERSIONS,
        "stages": stages,
    }
    return {
        "system": "B24_TARGET_V1_5",
        "caseId": case.case_id,
        "split": case.split,
        "datasetVersion": VERSIONS["seedDataset"],
        "splitVersion": VERSIONS["split"],
        "b24Versions": B24_VERSIONS,
        "promptVersions": B24_PROMPT_VERSIONS,
        "repoCommitSha": _repo_sha(),
        "reasoningEffort": getattr(provider, "reasoning_effort", None),
        "runStatus": status,
        "runFingerprint": hashlib.sha256(json.dumps(fingerprint, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest(),
        "providerStages": stages,
    }


def _context(
    case: FixtureCase,
    requirement: dict[str, Any],
    evidence: list[dict[str, Any]],
    preparation: dict[str, Any],
    snapshots: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "originalObjective": case.objective,
        # DELTA_C: quote is authoritative; normalization is auxiliary; the
        # epistemic target arrives frozen and read-only.
        "requirement": requirement,
        "authorityOrder": ["requirementQuote", "explicitQualifiers", "objectiveContext", "normalizedRequirement"],
        "epistemicTarget": requirement["epistemicTarget"],
        "epistemicTargetIsReadOnly": True,
        "evidenceUnits": evidence,
        "evidencePreparation": preparation,
        "sourceContext": [
            {
                "sourceId": item["source"]["sourceId"],
                "credentialId": item["source"]["credentialId"],
                "evidenceType": item["source"]["evidenceType"],
                "sourceProvenance": item["source"]["sourceProvenance"],
                "coverageStatus": item["coverageStatus"],
            }
            for item in snapshots
        ],
    }


def run_b24_case(case: FixtureCase, provider: StructuredProvider, budget: CallBudget | None) -> dict[str, Any]:
    snapshots = materialize_sources(case.sources)
    originals = {item.source_id: item.content for item in case.sources}
    stages: list[dict[str, Any]] = []

    if budget:
        budget.reserve("evidence_unit_quote_first")
    eu_response = provider.complete(
        prompt=b24_evidence_unit_quote_first_prompt(snapshots),
        schema_name="b24_evidence_unit_catalog",
        schema=b24_schema_for_provider("b24_evidence_unit_catalog"),
    )
    stages.append(_provider_meta("b24_evidence_unit_quote_first", eu_response))
    validate_b24_schema("b24_evidence_unit_catalog", eu_response.output)
    evidence, eu_validations = build_evidence_units(eu_response.output["evidenceUnits"], snapshots, originals)

    if budget:
        budget.reserve("objective_analysis")
    objective_response = provider.complete(
        prompt=objective_analysis_prompt(case.objective),
        schema_name="b24_objective_analysis",
        schema=b24_schema_for_provider("b24_objective_analysis"),
    )
    stages.append(_provider_meta("b24_objective_analysis", objective_response))
    validate_b24_schema("b24_objective_analysis", objective_response.output)
    objective, objective_validations = build_b24_objective_analysis(objective_response.output, case.objective)

    redundancy = exact_redundancy_and_lineage(evidence)
    source_facts = source_observability_facts(snapshots, evidence)
    preparation = {
        "mode": "FULL_SCAN",
        "evidenceUnitIds": [item["evidenceUnitId"] for item in evidence],
        "exactRedundancyAndLineageGroups": redundancy,
        "sourceObservabilityFacts": source_facts,
        "discardedEvidenceProposalCount": len(eu_response.output["evidenceUnits"]) - len(evidence),
    }
    base = {
        "01_source_extraction": snapshots,
        "02_evidence_units": {"proposal": eu_response.output, "catalog": evidence},
        "03_objective_analysis": {"proposal": objective_response.output, "analysis": objective},
        "04_evidence_preparation": preparation,
    }

    if objective["decompositionStatus"] == "AMBIGUOUS":
        return {
            "metadata": _metadata(case, provider, stages, "DECOMPOSITION_AMBIGUOUS"),
            **base,
            "05_unified_contextual_reasoning": [],
            "06_validation_repair": [*eu_validations, *objective_validations],
            "07_epistemic_policy": [],
            "08_final_result": [],
        }
    if len(objective["requirements"]) != 1:
        raise RuntimeError(f"PROVIDER_CALL_BUDGET_ANOMALY:resolved_requirements={len(objective['requirements'])};planned=1")

    requirement = objective["requirements"][0]
    if budget:
        budget.reserve("unified_contextual_reasoning")
    unified_response = provider.complete(
        prompt=unified_reasoning_prompt(_context(case, requirement, evidence, preparation, snapshots)),
        schema_name="b24_unified_reasoning",
        schema=b24_schema_for_provider("b24_unified_reasoning"),
    )
    stages.append(_provider_meta(f"b24_unified_contextual_reasoning:{requirement['requirementId']}", unified_response))
    validate_b24_schema("b24_unified_reasoning", unified_response.output)

    enriched, validations, hard = validate_and_enrich_b24(
        unified_response.output, requirement, evidence, redundancy, source_facts, [*eu_validations, *objective_validations]
    )
    # preGuardState means exactly: the state the epistemic policy would have
    # produced from the semantic artifact BEFORE any factual hard override.
    pre_state, pre_inputs = b24_final_state(requirement, enriched, hard_factual_failure=False)
    final, inputs = b24_final_state(requirement, enriched, hard_factual_failure=hard)
    evidence_by_id = {item["evidenceUnitId"]: item for item in evidence}

    return {
        "metadata": _metadata(case, provider, stages, "RESOLVED"),
        **base,
        "05_unified_contextual_reasoning": [enriched],
        "06_validation_repair": [*eu_validations, *objective_validations, *validations],
        "07_epistemic_policy": [
            {
                "requirementId": requirement["requirementId"],
                "preGuardState": pre_state,
                "preGuardInputs": pre_inputs,
                "finalState": final,
                "inputs": inputs,
            }
        ],
        "08_final_result": [
            {
                "requirementId": requirement["requirementId"],
                "finalState": final,
                "claimCeiling": enriched["jointClaimCeiling"],
                "weakerClaimSearch": enriched["weakerClaimSearch"],
                "explanation": render_b24_explanation(requirement, enriched, final, evidence_by_id),
            }
        ],
    }


def run_b24_cases(
    *,
    split: str,
    case_ids: set[str],
    provider: StructuredProvider,
    budget: CallBudget | None,
) -> dict[str, Any]:
    runs: list[dict[str, Any]] = []
    started = time.time()
    for case in load_cases(split=split, case_ids=case_ids):
        runs.append(run_b24_case(case, provider, budget))
    return {
        "experimentSchemaVersion": B24_VERSIONS["artifact"],
        "system": "b24",
        "split": split,
        "createdAtEpoch": int(started),
        "providerCallPlan": provider_call_plan(),
        "runs": runs,
    }
