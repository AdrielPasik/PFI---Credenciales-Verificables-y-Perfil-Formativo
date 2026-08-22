from __future__ import annotations

import hashlib
import json
import subprocess
import time
from pathlib import Path
from typing import Any

from .extraction import materialize_sources
from .fixtures import load_cases
from .guards import (
    exact_redundancy_groups,
    validate_and_enrich_evidence_units,
    validate_relation_ids,
    validate_requirement_result,
)
from .models import FixtureCase
from .policy import final_state
from .prompts import b1a_prompt, ceiling_prompt, evidence_unit_prompt, facet_prompt, objective_prompt, relation_prompt
from .providers import StructuredProvider
from .renderer import render_explanation
from .schemas import schema_for_provider, validate_schema
from .versions import PROMPT_VERSIONS, VERSIONS


def repo_commit_sha() -> str | None:
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"], check=True, capture_output=True, text=True
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def _run_metadata(system: str, case: FixtureCase, provider_meta: list[dict[str, Any]]) -> dict[str, Any]:
    source_hashes = [hashlib.sha256(item.content.encode("utf-8")).hexdigest() for item in case.sources]
    fingerprint_payload = {
        "caseId": case.case_id,
        "objective": case.objective,
        "system": system,
        "versions": VERSIONS,
        "prompts": PROMPT_VERSIONS,
        "providers": provider_meta,
        "sourceHashes": sorted(source_hashes),
    }
    fingerprint = hashlib.sha256(
        json.dumps(fingerprint_payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    return {
        "system": system,
        "caseId": case.case_id,
        "split": case.split,
        "datasetVersion": VERSIONS["seedDataset"],
        "splitVersion": VERSIONS["split"],
        "versions": VERSIONS,
        "promptVersions": PROMPT_VERSIONS,
        "repoCommitSha": repo_commit_sha(),
        "runFingerprint": fingerprint,
        "providerStages": provider_meta,
    }


def _provider_meta(stage: str, result: Any) -> dict[str, Any]:
    return {
        "stage": stage,
        "provider": result.provider,
        "requestedModel": result.requested_model,
        "effectiveModel": result.effective_model,
        "latencyMs": result.latency_ms,
        "usage": result.usage,
        "responseId": result.response_id,
    }


def _model_input(case: FixtureCase, snapshots: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "caseId": case.case_id,
        "objective": case.objective,
        "sources": [
            {
                "sourceId": item["source"]["sourceId"],
                "credentialId": item["source"]["credentialId"],
                "sourceSha256": item["source"]["sourceSha256"],
                "coverageStatus": item["coverageStatus"],
                "canonicalText": item["canonicalText"],
                "segments": item["segments"],
                "sourceProvenance": item["source"]["sourceProvenance"],
                "technicallyVerified": item["source"].get("technicallyVerified", False),
            }
            for item in snapshots
        ],
    }


def run_b0_case(case: FixtureCase, config_path: Path) -> dict[str, Any]:
    from src.config_loader import load_config
    from src.exporters.backend_contract import SOURCE_TYPE_TEXT
    from src.exporters.backend_contract.semantic_analysis_exporter import export_semantic_analysis
    from src.pipeline import process_single_input

    config = load_config(config_path)
    artifacts: list[dict[str, Any]] = []
    for source in case.sources:
        result = process_single_input(config, source.source_id, manual_text=source.content)
        record = {"raw_normalized": result.raw_normalized, "semantic_final": result.semantic_final}
        artifact = export_semantic_analysis(
            record,
            SOURCE_TYPE_TEXT,
            source.source_id,
            source_refs={"textEvidenceId": source.source_id, "credentialId": source.credential_id},
        )
        artifacts.append(artifact.to_dict())
    return {
        "metadata": _run_metadata("B0_CURRENT", case, []),
        "capabilityBoundary": {
            "producesEvidenceReasoningFinalState": False,
            "reason": "CURRENT produces semantic_analysis_v1 fields, not Objective/Requirement reasoning.",
        },
        "artifacts": artifacts,
    }


def run_b1a_case(case: FixtureCase, provider: StructuredProvider) -> dict[str, Any]:
    snapshots = materialize_sources(case.sources)
    result = provider.complete(
        prompt=b1a_prompt(_model_input(case, snapshots)),
        schema_name="b1a_result",
        schema=schema_for_provider("b1a"),
    )
    validate_schema("b1a", result.output)
    accepted, guards = validate_and_enrich_evidence_units(result.output["evidenceUnits"], snapshots)
    accepted_ids = {item["evidenceUnitId"] for item in accepted}
    model_ids = {item["evidenceUnitId"] for item in result.output["evidenceUnits"]}
    guards.append(
        {
            "guard": "b1a_citations_source_aligned",
            "status": "PASS" if accepted_ids == model_ids else "FAIL",
            "reason": f"aligned={len(accepted_ids)}/{len(model_ids)}",
            "critical": accepted_ids != model_ids,
        }
    )
    guards.extend(_validate_objective(case, result.output["objectiveAnalysis"]))
    ceilings = {item["requirementId"]: item for item in result.output["claimCeilings"]["requirements"]}
    for final in result.output["finalStates"]:
        ceiling = ceilings.get(final["requirementId"], {})
        refs = set(ceiling.get("supportingEvidenceUnitIds", []))
        positive = final["finalState"] in {"SUPPORTED", "PARTIALLY_SUPPORTED"}
        passed = (not positive) or (bool(refs) and refs <= accepted_ids)
        guards.append(
            {
                "guard": "b1a_positive_has_aligned_evidence",
                "status": "PASS" if passed else "FAIL",
                "reason": final["requirementId"],
                "critical": not passed,
            }
        )
    return {
        "metadata": _run_metadata("B1A_SINGLE_SHOT", case, [_provider_meta("single_shot", result)]),
        "01_source_extraction": snapshots,
        "singleShotOutput": result.output,
        "guardResults": guards,
    }


def _validate_objective(case: FixtureCase, analysis: dict[str, Any]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    same = analysis["originalObjective"] == case.objective
    results.append({"guard": "objective_original_preserved", "status": "PASS" if same else "FAIL", "reason": case.case_id, "critical": not same})
    for requirement in analysis["requirements"]:
        span = requirement["sourceSpan"]
        aligned = 0 <= span["charStart"] <= span["charEnd"] <= len(case.objective) and case.objective[span["charStart"]:span["charEnd"]] == span["exactText"]
        results.append({"guard": "requirement_source_span_aligns", "status": "PASS" if aligned else "FAIL", "reason": requirement["requirementId"], "critical": not aligned})
        for qualifier in requirement["qualifiers"]:
            qspan = qualifier["sourceSpan"]
            qaligned = 0 <= qspan["charStart"] <= qspan["charEnd"] <= len(case.objective) and case.objective[qspan["charStart"]:qspan["charEnd"]] == qspan["exactText"]
            results.append({"guard": "qualifier_source_span_aligns", "status": "PASS" if qaligned else "FAIL", "reason": qualifier["value"], "critical": not qaligned})
    return results


def _validate_facets(analysis: dict[str, Any], facet_plan: dict[str, Any]) -> list[dict[str, Any]]:
    requirement_ids = {item["requirementId"] for item in analysis["requirements"]}
    planned_ids = {item["requirementId"] for item in facet_plan["requirements"]}
    valid = planned_ids == requirement_ids
    return [{"guard": "facet_requirements_match_objective_analysis", "status": "PASS" if valid else "FAIL", "reason": str(sorted(planned_ids ^ requirement_ids)), "critical": not valid}]


def run_b1b_case(case: FixtureCase, provider: StructuredProvider) -> dict[str, Any]:
    snapshots = materialize_sources(case.sources)
    stage_meta: list[dict[str, Any]] = []

    eu_result = provider.complete(
        prompt=evidence_unit_prompt(snapshots),
        schema_name="evidence_unit_catalog",
        schema=schema_for_provider("evidence_unit_catalog"),
    )
    stage_meta.append(_provider_meta("evidence_unit_extraction", eu_result))
    validate_schema("evidence_unit_catalog", eu_result.output)
    evidence_units, guard_results = validate_and_enrich_evidence_units(eu_result.output["evidenceUnits"], snapshots)

    objective_result = provider.complete(
        prompt=objective_prompt(case.objective),
        schema_name="objective_analysis",
        schema=schema_for_provider("objective_analysis"),
    )
    stage_meta.append(_provider_meta("objective_analysis", objective_result))
    validate_schema("objective_analysis", objective_result.output)
    guard_results.extend(_validate_objective(case, objective_result.output))

    facet_result = provider.complete(
        prompt=facet_prompt(objective_result.output),
        schema_name="facet_plan",
        schema=schema_for_provider("facet_plan"),
    )
    stage_meta.append(_provider_meta("facet_planning", facet_result))
    validate_schema("facet_plan", facet_result.output)
    guard_results.extend(_validate_facets(objective_result.output, facet_result.output))

    relation_result = provider.complete(
        prompt=relation_prompt(objective_result.output, facet_result.output, evidence_units),
        schema_name="evidence_relations",
        schema=schema_for_provider("relations"),
    )
    stage_meta.append(_provider_meta("relation_reasoning", relation_result))
    validate_schema("relations", relation_result.output)
    requirement_ids = {item["requirementId"] for item in objective_result.output["requirements"]}
    facet_ids = {
        facet["facetId"]
        for planned in facet_result.output["requirements"]
        for facet in planned["facets"]
    }
    accepted_relations, relation_guards = validate_relation_ids(
        relation_result.output["relations"],
        requirement_ids,
        {item["evidenceUnitId"] for item in evidence_units},
        facet_ids,
    )
    relation_result.output["relations"] = accepted_relations
    guard_results.extend(relation_guards)

    redundancy = exact_redundancy_groups(evidence_units)
    ceiling_result = provider.complete(
        prompt=ceiling_prompt(objective_result.output, facet_result.output, evidence_units, relation_result.output, redundancy),
        schema_name="claim_ceiling",
        schema=schema_for_provider("claim_ceiling"),
    )
    stage_meta.append(_provider_meta("composition_claim_ceiling", ceiling_result))
    validate_schema("claim_ceiling", ceiling_result.output)
    ceiling_requirement_ids = {item["requirementId"] for item in ceiling_result.output["requirements"]}
    if ceiling_requirement_ids != requirement_ids:
        raise ValueError(
            f"claim_ceiling_requirement_ids_mismatch:{sorted(ceiling_requirement_ids ^ requirement_ids)}"
        )

    eu_by_id = {item["evidenceUnitId"]: item for item in evidence_units}
    facet_by_requirement = {item["requirementId"]: item["facets"] for item in facet_result.output["requirements"]}
    relations_by_requirement: dict[str, list[dict[str, Any]]] = {}
    for item in relation_result.output["relations"]:
        relations_by_requirement.setdefault(item["requirementId"], []).append(item)
    ceiling_by_requirement = {item["requirementId"]: item for item in ceiling_result.output["requirements"]}

    final_results: list[dict[str, Any]] = []
    pre_requirement_critical = any(
        item["status"] == "FAIL" and item.get("critical") for item in guard_results
    )
    for requirement in objective_result.output["requirements"]:
        requirement_id = requirement["requirementId"]
        ceiling = ceiling_by_requirement[requirement_id]
        requirement_guards = validate_requirement_result(
            requirement,
            ceiling,
            relations_by_requirement.get(requirement_id, []),
            facet_by_requirement.get(requirement_id, []),
            eu_by_id,
            snapshots,
            redundancy,
        )
        guard_results.extend(requirement_guards)
        critical = pre_requirement_critical or any(
            item["status"] == "FAIL" and item.get("critical") for item in requirement_guards
        )
        state = final_state(
            formative_evidence_capable=requirement["evaluability"]["formativeEvidenceCapable"],
            unresolved=ceiling["unresolved"],
            critical_guard_failure=critical,
            reaches_full_requirement=ceiling["reachesFullRequirement"],
            has_materially_useful_weaker_claim=ceiling["hasMateriallyUsefulWeakerClaim"],
            weaker_claim_still_belongs_to_requirement=ceiling["weakerClaimStillBelongsToRequirement"],
        )
        final_results.append(
            {
                "requirementId": requirement_id,
                "finalState": state,
                "claimCeiling": ceiling,
                "explanation": render_explanation(requirement, ceiling, state, eu_by_id),
            }
        )

    return {
        "metadata": _run_metadata("B1B_HYBRID", case, stage_meta),
        "01_source_extraction": snapshots,
        "02_evidence_units": evidence_units,
        "03_objective_analysis": objective_result.output,
        "04_relations": relation_result.output,
        "05_facets_composition": {"facetPlan": facet_result.output, "exactRedundancyGroups": redundancy},
        "06_claim_ceiling": ceiling_result.output,
        "07_guard_results": guard_results,
        "08_final_result": final_results,
    }


def run_cases(system: str, *, split: str, case_ids: set[str] | None, repeats: int,
              provider: StructuredProvider | None, config_path: Path) -> dict[str, Any]:
    cases = load_cases(split=split, case_ids=case_ids)
    runs: list[dict[str, Any]] = []
    started = time.time()
    for case in cases:
        count = 1 if system == "b0" else repeats
        for repetition in range(1, count + 1):
            if system == "b0":
                result = run_b0_case(case, config_path)
            elif system == "b1a":
                if provider is None:
                    raise ValueError("provider_required_for_b1a")
                result = run_b1a_case(case, provider)
            elif system == "b1b":
                if provider is None:
                    raise ValueError("provider_required_for_b1b")
                result = run_b1b_case(case, provider)
            else:
                raise ValueError(f"unknown_system:{system}")
            result["metadata"]["repetition"] = repetition
            runs.append(result)
    return {
        "experimentSchemaVersion": "evidence_reasoning_experiment_runs_v1",
        "system": system,
        "split": split,
        "createdAtEpoch": int(started),
        "runs": runs,
    }
