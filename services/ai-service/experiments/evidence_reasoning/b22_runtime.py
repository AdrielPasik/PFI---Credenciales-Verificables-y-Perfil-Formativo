from __future__ import annotations

import hashlib
import json
import subprocess
import time
from pathlib import Path
from typing import Any

from .b22_artifacts import build_b22_objective_analysis, build_evidence_units, exact_redundancy_and_lineage, source_observability_facts
from .b22_policy import b22_final_state
from .b22_prompts import b22_evidence_unit_quote_first_prompt, objective_analysis_prompt, unified_reasoning_prompt
from .b22_renderer import render_b22_explanation
from .b22_schemas import b22_schema_for_provider, validate_b22_schema
from .b22_validation import validate_and_enrich_b22
from .b22_versions import B22_PROMPT_VERSIONS, B22_VERSIONS
from .extraction import materialize_sources
from .fixtures import load_cases
from .models import FixtureCase
from .providers import StructuredProvider
from .versions import VERSIONS

MAX_REQUIREMENTS_PER_RUN = 8


def provider_call_plan(*, cases: int, repeats: int, max_requirements_per_run: int = MAX_REQUIREMENTS_PER_RUN) -> dict[str, Any]:
    runs = cases * repeats
    return {"plannedCases": cases, "repetitions": repeats, "runs": runs, "semanticStagesPerResolvedSingleRequirementRun": 3, "expectedProviderCallsSingleRequirementTopology": runs * 3, "maximumRequirementsPerRun": max_requirements_per_run, "maximumExpectedProviderCalls": runs * (2 + max_requirements_per_run), "topology": "EvidenceUnit + ObjectiveAnalysis + one UnifiedContextualReasoning per resolved Requirement; AMBIGUOUS decomposition stops after ObjectiveAnalysis."}


def _repo_sha() -> str | None:
    try: return subprocess.run(["git", "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError): return None


def _provider_meta(stage: str, result: Any) -> dict[str, Any]:
    return {"stage": stage, "provider": result.provider, "requestedModel": result.requested_model, "effectiveModel": result.effective_model, "latencyMs": result.latency_ms, "usage": result.usage, "retries": 0}


def _metadata(case: FixtureCase, provider: StructuredProvider, stages: list[dict[str, Any]], status: str) -> dict[str, Any]:
    fingerprint = {"caseId": case.case_id, "objective": case.objective, "sourceHashes": sorted(hashlib.sha256(item.content.encode("utf-8")).hexdigest() for item in case.sources), "versions": B22_VERSIONS, "prompts": B22_PROMPT_VERSIONS, "stages": stages}
    return {"system": "B22_TARGET_V1_3", "caseId": case.case_id, "split": case.split, "datasetVersion": VERSIONS["seedDataset"], "splitVersion": VERSIONS["split"], "b22Versions": B22_VERSIONS, "promptVersions": B22_PROMPT_VERSIONS, "repoCommitSha": _repo_sha(), "reasoningEffort": getattr(provider, "reasoning_effort", None), "runStatus": status, "runFingerprint": hashlib.sha256(json.dumps(fingerprint, sort_keys=True, ensure_ascii=False).encode()).hexdigest(), "providerStages": stages}


def _context(case: FixtureCase, requirement: dict[str, Any], evidence: list[dict[str, Any]], preparation: dict[str, Any], snapshots: list[dict[str, Any]]) -> dict[str, Any]:
    return {"originalObjective": case.objective, "requirement": requirement, "evidenceUnits": evidence, "evidencePreparation": preparation, "sourceContext": [{"sourceId": item["source"]["sourceId"], "credentialId": item["source"]["credentialId"], "evidenceType": item["source"]["evidenceType"], "sourceProvenance": item["source"]["sourceProvenance"], "coverageStatus": item["coverageStatus"]} for item in snapshots]}


def run_b22_case(case: FixtureCase, provider: StructuredProvider) -> dict[str, Any]:
    snapshots = materialize_sources(case.sources); originals = {item.source_id: item.content for item in case.sources}; stages: list[dict[str, Any]] = []
    eu_response = provider.complete(prompt=b22_evidence_unit_quote_first_prompt(snapshots), schema_name="b22_evidence_unit_catalog", schema=b22_schema_for_provider("b22_evidence_unit_catalog"))
    stages.append(_provider_meta("b22_evidence_unit_quote_first", eu_response)); validate_b22_schema("b22_evidence_unit_catalog", eu_response.output)
    evidence, eu_validations = build_evidence_units(eu_response.output["evidenceUnits"], snapshots, originals)
    objective_response = provider.complete(prompt=objective_analysis_prompt(case.objective), schema_name="b22_objective_analysis", schema=b22_schema_for_provider("b22_objective_analysis"))
    stages.append(_provider_meta("b22_objective_analysis", objective_response)); validate_b22_schema("b22_objective_analysis", objective_response.output)
    objective, objective_validations = build_b22_objective_analysis(objective_response.output, case.objective)
    redundancy = exact_redundancy_and_lineage(evidence); source_facts = source_observability_facts(snapshots, evidence)
    preparation = {"mode": "FULL_SCAN", "evidenceUnitIds": [item["evidenceUnitId"] for item in evidence], "exactRedundancyAndLineageGroups": redundancy, "sourceObservabilityFacts": source_facts, "discardedEvidenceProposalCount": len(eu_response.output["evidenceUnits"]) - len(evidence)}
    if objective["decompositionStatus"] == "AMBIGUOUS":
        return {"metadata": _metadata(case, provider, stages, "DECOMPOSITION_AMBIGUOUS"), "01_source_extraction": snapshots, "02_evidence_units": {"proposal": eu_response.output, "catalog": evidence}, "03_objective_analysis": {"proposal": objective_response.output, "analysis": objective}, "04_evidence_preparation": preparation, "05_unified_contextual_reasoning": [], "06_validation_repair": [*eu_validations, *objective_validations], "07_epistemic_policy": [], "08_final_result": []}
    if len(objective["requirements"]) > MAX_REQUIREMENTS_PER_RUN:
        raise RuntimeError(f"PROVIDER_CALL_BUDGET_ANOMALY:requirements={len(objective['requirements'])};max={MAX_REQUIREMENTS_PER_RUN}")
    all_validations = [*eu_validations, *objective_validations]; unified: list[dict[str, Any]] = []; policies: list[dict[str, Any]] = []; finals: list[dict[str, Any]] = []; evidence_by_id = {item["evidenceUnitId"]: item for item in evidence}
    for requirement in objective["requirements"]:
        response = provider.complete(prompt=unified_reasoning_prompt(_context(case, requirement, evidence, preparation, snapshots)), schema_name="b22_unified_reasoning", schema=b22_schema_for_provider("b22_unified_reasoning"))
        stages.append(_provider_meta(f"b22_unified_contextual_reasoning:{requirement['requirementId']}", response)); validate_b22_schema("b22_unified_reasoning", response.output)
        qualifier_ids = {item["qualifierId"] for item in requirement["materialQualifiers"] if item["qualifierId"]}
        inherited = [item for item in all_validations if item["artifactRef"] == requirement["requirementId"] or item["artifactRef"] in qualifier_ids]
        enriched, validations, hard = validate_and_enrich_b22(response.output, requirement, evidence, redundancy, source_facts, inherited)
        all_validations.extend(validations)
        pre_guard, pre_inputs = b22_final_state(requirement, enriched, hard_factual_failure=False)
        state, inputs = b22_final_state(requirement, enriched, hard_factual_failure=hard)
        unified.append(enriched); policies.append({"requirementId": requirement["requirementId"], "preGuardState": pre_guard, "inputs": inputs, "finalState": state})
        finals.append({"requirementId": requirement["requirementId"], "finalState": state, "claimCeiling": enriched["jointClaimCeiling"], "weakerClaimCandidate": enriched["weakerClaimCandidate"], "explanation": render_b22_explanation(requirement, enriched, state, evidence_by_id)})
    return {"metadata": _metadata(case, provider, stages, "RESOLVED"), "01_source_extraction": snapshots, "02_evidence_units": {"proposal": eu_response.output, "catalog": evidence}, "03_objective_analysis": {"proposal": objective_response.output, "analysis": objective}, "04_evidence_preparation": preparation, "05_unified_contextual_reasoning": unified, "06_validation_repair": all_validations, "07_epistemic_policy": policies, "08_final_result": finals}


def run_b22_cases(*, split: str, case_ids: set[str] | None, repeats: int, provider: StructuredProvider) -> dict[str, Any]:
    runs: list[dict[str, Any]] = []; started = time.time(); planned = provider_call_plan(cases=len(load_cases(split=split, case_ids=case_ids)), repeats=repeats)
    for case in load_cases(split=split, case_ids=case_ids):
        for repetition in range(1, repeats + 1):
            result = run_b22_case(case, provider); result["metadata"]["repetition"] = repetition; runs.append(result)
            actual = sum(len(run["metadata"]["providerStages"]) for run in runs)
            if actual > planned["maximumExpectedProviderCalls"]: raise RuntimeError("PROVIDER_CALL_BUDGET_ANOMALY:actual_calls_exceed_maximum")
    return {"experimentSchemaVersion": B22_VERSIONS["artifact"], "system": "b22", "split": split, "createdAtEpoch": int(started), "providerCallPlan": planned, "runs": runs}
