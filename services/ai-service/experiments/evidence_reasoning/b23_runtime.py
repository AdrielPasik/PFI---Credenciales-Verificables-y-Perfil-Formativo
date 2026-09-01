from __future__ import annotations

import hashlib
import json
import subprocess
import time
from pathlib import Path
from typing import Any

from .b23_artifacts import build_b23_objective_analysis, build_evidence_units, exact_redundancy_and_lineage, source_observability_facts
from .b23_policy import b23_final_state
from .b23_prompts import b23_evidence_unit_quote_first_prompt, objective_analysis_prompt, unified_reasoning_prompt
from .b23_renderer import render_b23_explanation
from .b23_schemas import b23_schema_for_provider, validate_b23_schema
from .b23_validation import validate_and_enrich_b23
from .b23_versions import B23_PROMPT_VERSIONS, B23_VERSIONS
from .extraction import materialize_sources
from .fixtures import load_cases
from .models import FixtureCase
from .providers import StructuredProvider
from .versions import VERSIONS

HARD_CALL_CAP = 30
SINGLE_REQUIREMENT_STAGES = 3

def provider_call_plan() -> dict[str, Any]:
    smoke = {"caseIds": ["case_09"], "repetitions": 1, "semanticStagesPerRun": SINGLE_REQUIREMENT_STAGES, "expectedCalls": 3}
    probe = {"caseIds": [f"case_{x}" for x in ("03", "05", "06", "07", "08", "09", "11", "12", "15")], "repetitions": 1, "semanticStagesPerRun": SINGLE_REQUIREMENT_STAGES, "expectedCalls": 27}
    return {"hardCap": HARD_CALL_CAP, "smoke": smoke, "developmentProbe": probe, "combinedExpectedCalls": smoke["expectedCalls"] + probe["expectedCalls"], "topology": "EvidenceUnit + ObjectiveAnalysis + exactly one UnifiedContextualReasoning for one resolved Requirement. Ambiguous stops after ObjectiveAnalysis; additional resolved Requirement stops before its Unified call.", "status": "PASS" if smoke["expectedCalls"] + probe["expectedCalls"] <= HARD_CALL_CAP else "STOP_BEFORE_PROVIDER_EXECUTION"}

class CallBudget:
    def __init__(self, path: Path, execution: str):
        self.path = path; self.execution = execution
        if not path.exists(): raise RuntimeError("STOP BEFORE PROVIDER EXECUTION: missing shared B2.3 provider-call budget ledger")
        self.payload = json.loads(path.read_text(encoding="utf-8"))
        if self.payload.get("combinedExpectedCalls") != HARD_CALL_CAP or self.payload.get("hardCap") != HARD_CALL_CAP or self.payload.get("status") != "PASS": raise RuntimeError("STOP BEFORE PROVIDER EXECUTION: invalid B2.3 topology bound")
        self.payload.setdefault("actualCalls", 0); self.payload.setdefault("callsByStage", {}); self.payload.setdefault("retries", 0); self.payload.setdefault("executionHistory", [])
    def reserve(self, stage: str) -> None:
        if self.payload["actualCalls"] + 1 > HARD_CALL_CAP:
            self.payload["status"] = "PROVIDER_CALL_BUDGET_ANOMALY"; self._save(); raise RuntimeError("PROVIDER_CALL_BUDGET_ANOMALY")
        self.payload["actualCalls"] += 1; self.payload["callsByStage"][stage] = self.payload["callsByStage"].get(stage, 0) + 1; self._save()
    def finish(self, summary: dict[str, Any]) -> None:
        self.payload["executionHistory"].append({"execution": self.execution, **summary}); self._save()
    def _save(self) -> None: self.path.write_text(json.dumps(self.payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def _repo_sha() -> str | None:
    try: return subprocess.run(["git", "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError): return None
def _provider_meta(stage: str, result: Any) -> dict[str, Any]: return {"stage": stage, "provider": result.provider, "requestedModel": result.requested_model, "effectiveModel": result.effective_model, "latencyMs": result.latency_ms, "usage": result.usage, "retries": 0}
def _metadata(case: FixtureCase, provider: StructuredProvider, stages: list[dict[str, Any]], status: str) -> dict[str, Any]:
    fingerprint = {"caseId": case.case_id, "objective": case.objective, "sourceHashes": sorted(hashlib.sha256(x.content.encode()).hexdigest() for x in case.sources), "versions": B23_VERSIONS, "prompts": B23_PROMPT_VERSIONS, "stages": stages}
    return {"system": "B23_TARGET_V1_4", "caseId": case.case_id, "split": case.split, "datasetVersion": VERSIONS["seedDataset"], "splitVersion": VERSIONS["split"], "b23Versions": B23_VERSIONS, "promptVersions": B23_PROMPT_VERSIONS, "repoCommitSha": _repo_sha(), "reasoningEffort": getattr(provider, "reasoning_effort", None), "runStatus": status, "runFingerprint": hashlib.sha256(json.dumps(fingerprint, sort_keys=True, ensure_ascii=False).encode()).hexdigest(), "providerStages": stages}
def _context(case: FixtureCase, requirement: dict[str, Any], evidence: list[dict[str, Any]], prep: dict[str, Any], snapshots: list[dict[str, Any]]) -> dict[str, Any]: return {"originalObjective": case.objective, "requirement": requirement, "evidenceUnits": evidence, "evidencePreparation": prep, "sourceContext": [{"sourceId": x["source"]["sourceId"], "credentialId": x["source"]["credentialId"], "evidenceType": x["source"]["evidenceType"], "sourceProvenance": x["source"]["sourceProvenance"], "coverageStatus": x["coverageStatus"]} for x in snapshots]}

def run_b23_case(case: FixtureCase, provider: StructuredProvider, budget: CallBudget) -> dict[str, Any]:
    snapshots = materialize_sources(case.sources); originals = {x.source_id: x.content for x in case.sources}; stages: list[dict[str, Any]] = []
    budget.reserve("evidence_unit_quote_first"); eu = provider.complete(prompt=b23_evidence_unit_quote_first_prompt(snapshots), schema_name="b23_evidence_unit_catalog", schema=b23_schema_for_provider("b23_evidence_unit_catalog")); stages.append(_provider_meta("b23_evidence_unit_quote_first", eu)); validate_b23_schema("b23_evidence_unit_catalog", eu.output)
    evidence, eu_validations = build_evidence_units(eu.output["evidenceUnits"], snapshots, originals)
    budget.reserve("objective_analysis"); obj = provider.complete(prompt=objective_analysis_prompt(case.objective), schema_name="b23_objective_analysis", schema=b23_schema_for_provider("b23_objective_analysis")); stages.append(_provider_meta("b23_objective_analysis", obj)); validate_b23_schema("b23_objective_analysis", obj.output)
    objective, objective_validations = build_b23_objective_analysis(obj.output, case.objective); redundancy = exact_redundancy_and_lineage(evidence); source_facts = source_observability_facts(snapshots, evidence)
    prep = {"mode": "FULL_SCAN", "evidenceUnitIds": [x["evidenceUnitId"] for x in evidence], "exactRedundancyAndLineageGroups": redundancy, "sourceObservabilityFacts": source_facts, "discardedEvidenceProposalCount": len(eu.output["evidenceUnits"]) - len(evidence)}
    base = {"01_source_extraction": snapshots, "02_evidence_units": {"proposal": eu.output, "catalog": evidence}, "03_objective_analysis": {"proposal": obj.output, "analysis": objective}, "04_evidence_preparation": prep}
    if objective["decompositionStatus"] == "AMBIGUOUS": return {"metadata": _metadata(case, provider, stages, "DECOMPOSITION_AMBIGUOUS"), **base, "05_unified_contextual_reasoning": [], "06_validation_repair": [*eu_validations, *objective_validations], "07_epistemic_policy": [], "08_final_result": []}
    if len(objective["requirements"]) != 1: raise RuntimeError(f"PROVIDER_CALL_BUDGET_ANOMALY:resolved_requirements={len(objective['requirements'])};planned=1")
    req = objective["requirements"][0]; budget.reserve("unified_contextual_reasoning")
    unified_response = provider.complete(prompt=unified_reasoning_prompt(_context(case, req, evidence, prep, snapshots)), schema_name="b23_unified_reasoning", schema=b23_schema_for_provider("b23_unified_reasoning")); stages.append(_provider_meta(f"b23_unified_contextual_reasoning:{req['requirementId']}", unified_response)); validate_b23_schema("b23_unified_reasoning", unified_response.output)
    enriched, validations, hard = validate_and_enrich_b23(unified_response.output, req, evidence, redundancy, source_facts, [*eu_validations, *objective_validations]); pre, pre_inputs = b23_final_state(req, enriched, hard_factual_failure=False); final, inputs = b23_final_state(req, enriched, hard_factual_failure=hard); evidence_by_id = {x["evidenceUnitId"]: x for x in evidence}
    return {"metadata": _metadata(case, provider, stages, "RESOLVED"), **base, "05_unified_contextual_reasoning": [enriched], "06_validation_repair": [*eu_validations, *objective_validations, *validations], "07_epistemic_policy": [{"requirementId": req["requirementId"], "preGuardState": pre, "preGuardInputs": pre_inputs, "finalState": final, "inputs": inputs}], "08_final_result": [{"requirementId": req["requirementId"], "finalState": final, "claimCeiling": enriched["jointClaimCeiling"], "weakerClaimCandidate": enriched["weakerClaimCandidate"], "explanation": render_b23_explanation(req, enriched, final, evidence_by_id)}]}

def run_b23_cases(*, split: str, case_ids: set[str], provider: StructuredProvider, budget: CallBudget) -> dict[str, Any]:
    runs: list[dict[str, Any]] = []; started = time.time()
    for case in load_cases(split=split, case_ids=case_ids): runs.append(run_b23_case(case, provider, budget))
    return {"experimentSchemaVersion": B23_VERSIONS["artifact"], "system": "b23", "split": split, "createdAtEpoch": int(started), "providerCallPlan": provider_call_plan(), "runs": runs}
