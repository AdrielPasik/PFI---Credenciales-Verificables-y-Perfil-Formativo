from __future__ import annotations

import hashlib
import json
import subprocess
import time
from pathlib import Path
from typing import Any

# Everything semantic is imported unchanged from B2.4. Only the prompt module
# and the version/budget metadata differ.
from .b24_artifacts import (
    build_b24_objective_analysis,
    build_evidence_units,
    exact_redundancy_and_lineage,
    source_observability_facts,
)
from .b24_policy import b24_final_state
from .b24_renderer import render_b24_explanation
from .b24_runtime import ABSOLUTE_HARD_CAP as B24_ABSOLUTE_HARD_CAP  # noqa: F401
from .b24_schemas import b24_schema_for_provider, validate_b24_schema
from .b24_validation import validate_and_enrich_b24
from .b241_prompts import (
    b241_evidence_unit_quote_first_prompt,
    objective_analysis_prompt,
    unified_reasoning_prompt,
)
from .b241_versions import B241_PROMPT_VERSIONS, B241_VERSIONS
from .extraction import materialize_sources
from .fixtures import load_cases
from .models import FixtureCase
from .providers import StructuredProvider
from .versions import VERSIONS

SINGLE_REQUIREMENT_STAGES = 3
# case_06 x2 (positive boundary) + case_05 x1 (neighbour negative) + case_09 x1
# (prerequisite/foundation negative).
PROBE_PLAN = (("case_06", 2), ("case_05", 1), ("case_09", 1))
HARD_CALL_CAP = 12


def provider_call_plan() -> dict[str, Any]:
    runs = sum(repetitions for _, repetitions in PROBE_PLAN)
    expected = runs * SINGLE_REQUIREMENT_STAGES
    return {
        "planSchemaVersion": "b241_baseline_repair_call_plan_v1",
        "changeClass": "BASELINE_CONFORMANCE_REPAIR",
        "liveSmoke": {"executions": 0, "expectedCalls": 0},
        "liveSmokeReason": "Topology, schemas, runtime, policy and serialization are byte-identical to the frozen B2.4; the only change is one restored prompt clause, verified offline by the effective-prompt lineage and delta audits.",
        "developmentProbe": {
            "plan": [{"caseId": case_id, "repetitions": repetitions} for case_id, repetitions in PROBE_PLAN],
            "runs": runs,
            "semanticStagesPerRun": SINGLE_REQUIREMENT_STAGES,
            "expectedCalls": expected,
        },
        "combinedExpectedCalls": expected,
        "hardCap": HARD_CALL_CAP,
        "retryPolicy": "NO_RETRY_STOP_IMMEDIATELY",
        "modelFallback": "FORBIDDEN",
        "holdout": "FORBIDDEN",
        "topology": "EvidenceUnit + ObjectiveAnalysis + exactly one UnifiedContextualReasoning per resolved Requirement.",
        "status": "PASS" if expected <= HARD_CALL_CAP else "STOP_BEFORE_PROVIDER_EXECUTION",
    }


class CallBudget:
    def __init__(self, path: Path, execution: str):
        self.path = path
        self.execution = execution
        if not path.exists():
            raise RuntimeError("STOP BEFORE PROVIDER EXECUTION: missing B2.4.1 provider-call budget ledger")
        self.payload = json.loads(path.read_text(encoding="utf-8"))
        cap = self.payload.get("hardCap")
        if (
            self.payload.get("status") != "PASS"
            or not isinstance(cap, int)
            or cap > HARD_CALL_CAP
            or self.payload.get("combinedExpectedCalls") != cap
        ):
            raise RuntimeError("STOP BEFORE PROVIDER EXECUTION: invalid B2.4.1 topology bound")
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
        "versions": B241_VERSIONS,
        "prompts": B241_PROMPT_VERSIONS,
        "stages": stages,
    }
    return {
        "system": "B241_TARGET_V1_5_1",
        "changeClass": "BASELINE_CONFORMANCE_REPAIR",
        "caseId": case.case_id,
        "split": case.split,
        "datasetVersion": VERSIONS["seedDataset"],
        "splitVersion": VERSIONS["split"],
        "b241Versions": B241_VERSIONS,
        "promptVersions": B241_PROMPT_VERSIONS,
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


def run_b241_case(case: FixtureCase, provider: StructuredProvider, budget: CallBudget | None) -> dict[str, Any]:
    snapshots = materialize_sources(case.sources)
    originals = {item.source_id: item.content for item in case.sources}
    stages: list[dict[str, Any]] = []

    if budget:
        budget.reserve("evidence_unit_quote_first")
    eu_response = provider.complete(
        prompt=b241_evidence_unit_quote_first_prompt(snapshots),
        schema_name="b24_evidence_unit_catalog",
        schema=b24_schema_for_provider("b24_evidence_unit_catalog"),
    )
    stages.append(_provider_meta("b241_evidence_unit_quote_first", eu_response))
    validate_b24_schema("b24_evidence_unit_catalog", eu_response.output)
    evidence, eu_validations = build_evidence_units(eu_response.output["evidenceUnits"], snapshots, originals)

    if budget:
        budget.reserve("objective_analysis")
    objective_response = provider.complete(
        prompt=objective_analysis_prompt(case.objective),
        schema_name="b24_objective_analysis",
        schema=b24_schema_for_provider("b24_objective_analysis"),
    )
    stages.append(_provider_meta("b241_objective_analysis", objective_response))
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
    stages.append(_provider_meta(f"b241_unified_contextual_reasoning:{requirement['requirementId']}", unified_response))
    validate_b24_schema("b24_unified_reasoning", unified_response.output)

    enriched, validations, hard = validate_and_enrich_b24(
        unified_response.output, requirement, evidence, redundancy, source_facts, [*eu_validations, *objective_validations]
    )
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


def run_b241_probe(*, provider: StructuredProvider, budget: CallBudget | None) -> dict[str, Any]:
    runs: list[dict[str, Any]] = []
    started = time.time()
    for case_id, repetitions in PROBE_PLAN:
        cases = load_cases(split="dev", case_ids={case_id})
        if len(cases) != 1:
            raise RuntimeError(f"STOP: case selection failed for {case_id}")
        for repetition in range(1, repetitions + 1):
            run = run_b241_case(cases[0], provider, budget)
            run["metadata"]["repetition"] = repetition
            runs.append(run)
    return {
        "experimentSchemaVersion": B241_VERSIONS["artifact"],
        "system": "b241",
        "changeClass": "BASELINE_CONFORMANCE_REPAIR",
        "split": "dev",
        "createdAtEpoch": int(started),
        "providerCallPlan": provider_call_plan(),
        "runs": runs,
    }
