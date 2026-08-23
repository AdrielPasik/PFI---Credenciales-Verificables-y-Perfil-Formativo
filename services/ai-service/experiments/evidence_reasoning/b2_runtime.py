from __future__ import annotations

import hashlib
import json
import subprocess
import time
from pathlib import Path
from typing import Any

from .b2_artifacts import build_evidence_units, build_objective_analysis, exact_redundancy_and_lineage
from .b2_policy import b2_final_state
from .b2_prompts import evidence_unit_quote_first_prompt, objective_quote_first_prompt, unified_contextual_reasoning_prompt
from .b2_renderer import render_b2_explanation
from .b2_schemas import b2_schema_for_provider, validate_b2_schema
from .b2_validation import validate_and_enrich_reasoning
from .b2_versions import B2_PROMPT_VERSIONS, B2_VERSIONS
from .extraction import materialize_sources
from .fixtures import load_cases
from .models import FixtureCase
from .providers import StructuredProvider
from .versions import VERSIONS


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
    }


def _metadata(case: FixtureCase, provider: StructuredProvider, stages: list[dict[str, Any]]) -> dict[str, Any]:
    fingerprint_payload = {
        "caseId": case.case_id,
        "objective": case.objective,
        "sourceHashes": sorted(hashlib.sha256(item.content.encode("utf-8")).hexdigest() for item in case.sources),
        "versions": B2_VERSIONS,
        "prompts": B2_PROMPT_VERSIONS,
        "providerStages": stages,
    }
    return {
        "system": "B2_TARGET_V1_1",
        "caseId": case.case_id,
        "split": case.split,
        "datasetVersion": VERSIONS["seedDataset"],
        "splitVersion": VERSIONS["split"],
        "b2Versions": B2_VERSIONS,
        "promptVersions": B2_PROMPT_VERSIONS,
        "repoCommitSha": _repo_sha(),
        "reasoningEffort": getattr(provider, "reasoning_effort", None),
        "runFingerprint": hashlib.sha256(json.dumps(fingerprint_payload, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest(),
        "providerStages": stages,
    }


def _unified_context(
    case: FixtureCase,
    requirement: dict[str, Any],
    evidence_units: list[dict[str, Any]],
    preparation: dict[str, Any],
    snapshots: list[dict[str, Any]],
) -> dict[str, Any]:
    source_context = [
        {
            "sourceId": item["source"]["sourceId"],
            "credentialId": item["source"]["credentialId"],
            "evidenceType": item["source"]["evidenceType"],
            "sourceProvenance": item["source"]["sourceProvenance"],
            "coverageStatus": item["coverageStatus"],
            "technicallyVerified": item["source"].get("technicallyVerified", False),
        }
        for item in snapshots
    ]
    return {
        "originalObjective": case.objective,
        "requirement": requirement,
        "evidenceUnits": evidence_units,
        "sourceContext": source_context,
        "evidencePreparation": preparation,
    }


def run_b2_case(case: FixtureCase, provider: StructuredProvider) -> dict[str, Any]:
    snapshots = materialize_sources(case.sources)
    originals = {item.source_id: item.content for item in case.sources}
    stages: list[dict[str, Any]] = []

    eu_response = provider.complete(
        prompt=evidence_unit_quote_first_prompt(snapshots),
        schema_name="b2_evidence_unit_catalog",
        schema=b2_schema_for_provider("b2_evidence_unit_catalog"),
    )
    stages.append(_provider_meta("b2_evidence_unit_quote_first", eu_response))
    validate_b2_schema("b2_evidence_unit_catalog", eu_response.output)
    evidence_units, eu_validations = build_evidence_units(eu_response.output["evidenceUnits"], snapshots, originals)

    objective_response = provider.complete(
        prompt=objective_quote_first_prompt(case.objective),
        schema_name="b2_objective_analysis",
        schema=b2_schema_for_provider("b2_objective_analysis"),
    )
    stages.append(_provider_meta("b2_objective_quote_first", objective_response))
    validate_b2_schema("b2_objective_analysis", objective_response.output)
    objective_analysis, objective_validations = build_objective_analysis(objective_response.output, case.objective)

    redundancy_groups = exact_redundancy_and_lineage(evidence_units)
    preparation = {
        "mode": "FULL_SCAN",
        "evidenceUnitIds": [item["evidenceUnitId"] for item in evidence_units],
        "exactRedundancyAndLineageGroups": redundancy_groups,
        "incompleteSourceIds": [item["source"]["sourceId"] for item in snapshots if item["coverageStatus"] != "FULL"],
        "discardedEvidenceProposalCount": len(eu_response.output["evidenceUnits"]) - len(evidence_units),
    }

    unified_outputs: list[dict[str, Any]] = []
    all_validations = [*eu_validations, *objective_validations]
    policy_results: list[dict[str, Any]] = []
    final_results: list[dict[str, Any]] = []
    eu_by_id = {item["evidenceUnitId"]: item for item in evidence_units}
    for requirement in objective_analysis["requirements"]:
        response = provider.complete(
            prompt=unified_contextual_reasoning_prompt(_unified_context(case, requirement, evidence_units, preparation, snapshots)),
            schema_name="b2_unified_reasoning",
            schema=b2_schema_for_provider("b2_unified_reasoning"),
        )
        stages.append(_provider_meta(f"b2_unified_contextual_reasoning:{requirement['requirementId']}", response))
        validate_b2_schema("b2_unified_reasoning", response.output)
        qualifier_ids = {item["qualifierId"] for item in requirement["materialQualifiers"]}
        inherited = [
            item for item in all_validations
            if item["artifactRef"] == requirement["requirementId"]
            or item["artifactRef"] in qualifier_ids
        ]
        enriched, validations, hard_failure = validate_and_enrich_reasoning(
            response.output,
            requirement,
            evidence_units,
            redundancy_groups,
            inherited,
        )
        all_validations.extend(validations)
        state, policy_inputs = b2_final_state(requirement, enriched, hard_factual_failure=hard_failure)
        unified_outputs.append(enriched)
        policy_results.append({"requirementId": requirement["requirementId"], "inputs": policy_inputs, "finalState": state})
        final_results.append(
            {
                "requirementId": requirement["requirementId"],
                "evaluationRole": requirement["evaluationRole"],
                "finalState": state,
                "claimCeiling": enriched["jointClaimCeiling"],
                "weakerClaimCandidate": enriched["weakerClaimCandidate"],
                "explanation": render_b2_explanation(requirement, enriched, state, eu_by_id),
            }
        )

    return {
        "metadata": _metadata(case, provider, stages),
        "01_source_extraction": snapshots,
        "02_evidence_units": {
            "proposal": eu_response.output,
            "catalog": evidence_units,
        },
        "03_objective_analysis": {
            "proposal": objective_response.output,
            "analysis": objective_analysis,
        },
        "04_evidence_preparation": preparation,
        "05_unified_contextual_reasoning": unified_outputs,
        "06_validation_repair": all_validations,
        "07_epistemic_policy": policy_results,
        "08_final_result": final_results,
    }


def run_b2_cases(
    *,
    split: str,
    case_ids: set[str] | None,
    repeats: int,
    provider: StructuredProvider,
) -> dict[str, Any]:
    runs: list[dict[str, Any]] = []
    started = time.time()
    for case in load_cases(split=split, case_ids=case_ids):
        for repetition in range(1, repeats + 1):
            result = run_b2_case(case, provider)
            result["metadata"]["repetition"] = repetition
            runs.append(result)
    return {
        "experimentSchemaVersion": B2_VERSIONS["artifact"],
        "system": "b2",
        "split": split,
        "createdAtEpoch": int(started),
        "runs": runs,
    }
