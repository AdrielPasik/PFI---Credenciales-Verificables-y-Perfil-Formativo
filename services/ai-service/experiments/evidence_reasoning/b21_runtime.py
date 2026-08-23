from __future__ import annotations

import hashlib, json, subprocess, time
from typing import Any

from .b21_artifacts import build_evidence_units, build_objective_analysis, exact_redundancy_and_lineage, source_observability_facts
from .b21_policy import b21_states
from .b21_prompts import evidence_unit_quote_first_prompt, objective_quote_first_prompt, unified_contextual_reasoning_prompt
from .b21_schemas import b21_schema_for_provider, validate_b21_schema
from .b21_validation import validate_and_enrich_reasoning
from .b21_versions import B21_PROMPT_VERSIONS, B21_VERSIONS
from .b21_renderer import render_b21_explanation
from .extraction import materialize_sources
from .fixtures import load_cases
from .models import FixtureCase
from .providers import StructuredProvider
from .versions import VERSIONS

def _sha() -> str | None:
    try: return subprocess.run(["git", "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError): return None
def _meta(stage: str, result: Any) -> dict[str, Any]: return {"stage": stage, "provider": result.provider, "requestedModel": result.requested_model, "effectiveModel": result.effective_model, "latencyMs": result.latency_ms, "usage": result.usage}
def _context(case: FixtureCase, requirement: dict[str, Any], eus: list[dict[str, Any]], prep: dict[str, Any], facts: list[dict[str, Any]]) -> dict[str, Any]: return {"originalObjective": case.objective, "requirement": requirement, "continuityCore": requirement["continuityCore"], "evidenceUnits": eus, "evidencePreparation": prep, "sourceObservabilityFacts": facts}

def run_b21_case(case: FixtureCase, provider: StructuredProvider) -> dict[str, Any]:
    snapshots, originals, stages = materialize_sources(case.sources), {s.source_id: s.content for s in case.sources}, []
    eu = provider.complete(prompt=evidence_unit_quote_first_prompt(snapshots), schema_name="b21_evidence_unit_catalog", schema=b21_schema_for_provider("b21_evidence_unit_catalog")); stages.append(_meta("b21_evidence_unit_quote_first", eu)); validate_b21_schema("b21_evidence_unit_catalog", eu.output)
    evidence_units, eu_validations = build_evidence_units(eu.output["evidenceUnits"], snapshots, originals)
    objective = provider.complete(prompt=objective_quote_first_prompt(case.objective), schema_name="b21_objective_analysis", schema=b21_schema_for_provider("b21_objective_analysis")); stages.append(_meta("b21_objective_quote_first", objective)); validate_b21_schema("b21_objective_analysis", objective.output)
    analysis, objective_validations = build_objective_analysis(objective.output, case.objective)
    groups, facts = exact_redundancy_and_lineage(evidence_units), source_observability_facts(snapshots, evidence_units)
    prep = {"mode": "FULL_SCAN", "evidenceUnitIds": [x["evidenceUnitId"] for x in evidence_units], "exactRedundancyAndLineageGroups": groups, "sourceObservabilityFacts": facts, "discardedEvidenceProposalCount": len(eu.output["evidenceUnits"]) - len(evidence_units)}
    unified, validation_results, policies, finals = [], [*eu_validations, *objective_validations], [], []
    eu_by_id = {item["evidenceUnitId"]: item for item in evidence_units}
    for req in analysis["requirements"]:
        response = provider.complete(prompt=unified_contextual_reasoning_prompt(_context(case, req, evidence_units, prep, facts)), schema_name="b21_unified_reasoning", schema=b21_schema_for_provider("b21_unified_reasoning")); stages.append(_meta(f"b21_unified_contextual_reasoning:{req['requirementId']}", response)); validate_b21_schema("b21_unified_reasoning", response.output)
        inherited = [item for item in validation_results if item["artifactRef"] == req["requirementId"] or item["artifactRef"] in {q["qualifierId"] for q in req["materialQualifiers"]}]
        enriched, new_validations, hard = validate_and_enrich_reasoning(response.output, req, evidence_units, groups, inherited); validation_results.extend(new_validations)
        pre, final, inputs = b21_states(req, enriched, hard_factual_failure=hard); unified.append(enriched); policies.append({"requirementId": req["requirementId"], "inputs": inputs, "preGuardState": pre, "finalState": final})
        finals.append({"requirementId": req["requirementId"], "evaluationRole": req["evaluationRole"], "preGuardState": pre, "finalState": final, "claimCeiling": enriched["jointClaimCeiling"], "weakerClaimCandidate": enriched["weakerClaimCandidate"], "explanation": render_b21_explanation(req, enriched, final, eu_by_id)})
    fp = hashlib.sha256(json.dumps({"caseId": case.case_id, "versions": B21_VERSIONS, "prompts": B21_PROMPT_VERSIONS, "stages": stages}, sort_keys=True).encode()).hexdigest()
    return {"metadata": {"system": "B21_TARGET_V1_2", "caseId": case.case_id, "split": case.split, "datasetVersion": VERSIONS["seedDataset"], "splitVersion": VERSIONS["split"], "b21Versions": B21_VERSIONS, "promptVersions": B21_PROMPT_VERSIONS, "repoCommitSha": _sha(), "reasoningEffort": getattr(provider, "reasoning_effort", None), "runFingerprint": fp, "providerStages": stages}, "01_source_extraction": snapshots, "02_evidence_units": {"proposal": eu.output, "catalog": evidence_units}, "03_objective_analysis": {"proposal": objective.output, "analysis": analysis}, "04_evidence_preparation": prep, "05_unified_contextual_reasoning": unified, "06_validation_repair": validation_results, "07_epistemic_policy": policies, "08_final_result": finals}

def run_b21_cases(*, split: str, case_ids: set[str] | None, repeats: int, provider: StructuredProvider) -> dict[str, Any]:
    runs, started = [], time.time()
    for case in load_cases(split=split, case_ids=case_ids):
        for repetition in range(1, repeats + 1):
            run = run_b21_case(case, provider); run["metadata"]["repetition"] = repetition; runs.append(run)
    return {"experimentSchemaVersion": B21_VERSIONS["artifact"], "system": "b21", "split": split, "createdAtEpoch": int(started), "runs": runs}
