from __future__ import annotations

"""Execution-protocol fingerprint, freeze manifest and resume verification.

The EXECUTION PROTOCOL FINGERPRINT is deliberately distinct from the B2.4.1
BEHAVIOR FINGERPRINT: it covers how observations are obtained, never what the
model is asked or how its answer is interpreted.
"""

import hashlib
import json
from pathlib import Path
from typing import Any

from ..b24_fingerprint import b24_behavior_fingerprint
from ..b241_fingerprint import b241_behavior_fingerprint
from ..b241_prompts import (
    b241_evidence_unit_quote_first_prompt,
    objective_analysis_prompt,
    unified_reasoning_prompt,
)
from . import config
from .store import sha256_text
from .transport import ELIGIBLE_TRANSPORT_CATEGORIES, NON_RECOVERABLE_CATEGORIES

PACKAGE = Path(__file__).resolve().parent
EXPERIMENT = PACKAGE.parent

EXECUTION_FILES = (
    "campaign/__init__.py", "campaign/config.py", "campaign/transport.py",
    "campaign/store.py", "campaign/generation.py", "campaign/evaluation.py",
    "campaign/adjudication.py", "campaign/reporting.py", "campaign/integrity.py",
    "campaign/cli.py",
)

BEHAVIOR_REFERENCE_FILES = (
    "b241_versions.py", "b241_prompts.py", "b241_runtime.py", "b241_fingerprint.py",
    "b24_versions.py", "b24_schemas.py", "b24_artifacts.py", "b24_prompts.py",
    "b24_validation.py", "b24_policy.py", "b24_renderer.py", "b24_evaluation.py",
    "b2_aligner.py", "b2_artifacts.py", "b2_prompts.py", "b2_schemas.py",
    "extraction.py", "providers.py", "fixtures.py", "gold.py", "policy.py",
    "models.py", "schemas.py",
    "fixtures/inputs/seed_v0_inputs.json", "fixtures/gold/seed_v0_gold.json",
)

BASELINE_ANCHORS = {
    "B2_NO_SEMANTIC_STRENGTHENING": "NO SEMANTIC STRENGTHENING",
    "B2_NO_FORCED_CONTINUITY_USEFULNESS": "no fuerces esos valores",
    "B2_NO_ARBITRARY_CONSERVATIVE_UNCERTAINTY": "conservadurismo arbitrario",
    "B2_NO_PLURALITY_IMPLIES_INTEGRATION_BRIDGE": "bridge por la mera pluralidad",
}

_PROBE_OBJECTIVE = "Contexto: equipo. Requisito formativo: cartografía hidrológica avanzada."
_PROBE_CONTEXT = {
    "originalObjective": _PROBE_OBJECTIVE,
    "requirement": {"requirementId": "req_01",
                    "requirementQuote": "Requisito formativo: cartografía hidrológica avanzada.",
                    "normalizedRequirement": "n", "epistemicTarget": "FORMATIVE_EVIDENCE",
                    "materialQualifiers": []},
    "authorityOrder": [], "epistemicTarget": "FORMATIVE_EVIDENCE",
    "epistemicTargetIsReadOnly": True, "evidenceUnits": [],
    "evidencePreparation": {}, "sourceContext": [],
}


def _sha_file(relative: str) -> str:
    return hashlib.sha256((EXPERIMENT / relative).read_bytes()).hexdigest()


def effective_prompts() -> dict[str, str]:
    return {
        "evidenceUnit": b241_evidence_unit_quote_first_prompt([]),
        "objective": objective_analysis_prompt(_PROBE_OBJECTIVE),
        "unified": unified_reasoning_prompt(_PROBE_CONTEXT),
    }


def semantic_clause_lineage() -> tuple[str, dict[str, bool]]:
    union = "\n".join(effective_prompts().values())
    present = {name: anchor in union for name, anchor in BASELINE_ANCHORS.items()}
    return ("PASS" if all(present.values()) else "FAIL"), present


def execution_protocol_fingerprint() -> dict[str, Any]:
    files = [{"path": name, "sha256": _sha_file(name)} for name in EXECUTION_FILES]
    parameters = {
        "campaignId": config.CAMPAIGN_ID,
        "provider": config.PROVIDER, "model": config.MODEL,
        "reasoningEffort": config.REASONING_EFFORT,
        "providerTimeoutSeconds": config.PROVIDER_TIMEOUT_SECONDS,
        "transportRetryBackoffSeconds": config.TRANSPORT_RETRY_BACKOFF_SECONDS,
        "maxConcurrentLogicalCalls": config.MAX_CONCURRENT_LOGICAL_CALLS,
        "logicalProviderCalls": config.LOGICAL_PROVIDER_CALLS,
        "transportRecoveryReserve": config.TRANSPORT_RECOVERY_RESERVE,
        "absoluteProviderAttemptCap": config.ABSOLUTE_PROVIDER_ATTEMPT_CAP,
        "maxAttemptsPerLogicalCall": config.MAX_ATTEMPTS_PER_LOGICAL_CALL,
        "eligibleTransportCategories": list(ELIGIBLE_TRANSPORT_CATEGORIES),
        "nonRecoverableCategories": list(NON_RECOVERABLE_CATEGORIES),
        "executionOrder": config.execution_order(),
        "runStates": [config.NOT_STARTED, config.INCOMPLETE, config.COMPLETE,
                      config.ABORTED_INFRASTRUCTURE, config.ABORTED_INTEGRITY],
        "attemptStates": [config.SUCCESS, config.FAILED_TRANSPORT, config.FAILED_NONRECOVERABLE],
        "checkpointAuthority": "DURABLE_ARTIFACTS_OUTRANK_BOOKKEEPING",
        "durableRawResponseFirst": True,
        "phaseSeparation": {"phase1": "GENERATION_NO_GOLD", "phase2": "EVALUATION_AFTER_ALL_55_RUNS"},
        "stopConditions": ["fingerprint_mismatch", "execution_protocol_mismatch", "prompt_lineage_fail",
                           "effective_model_mismatch", "model_fallback", "fixture_or_gold_mutation",
                           "holdout_leakage", "behavior_modification", "checkpoint_corruption",
                           "recovery_budget_exhausted", "second_transport_failure_same_logical_call",
                           "unapproved_4xx_or_config_intervention"],
        "semanticRerun": "FORBIDDEN", "selectiveRerun": "FORBIDDEN",
        "completedStageRerun": "FORBIDDEN", "completedRunRerun": "FORBIDDEN",
        "partialEvaluation": "FORBIDDEN", "holdout": "FORBIDDEN",
        "previousAbortedRunsReused": False,
    }
    combined = hashlib.sha256(json.dumps(
        {"files": files, "parameters": parameters}, sort_keys=True, ensure_ascii=False,
        separators=(",", ":")).encode("utf-8")).hexdigest()
    return {"fingerprintSchemaVersion": "b241_execution_protocol_fingerprint_v1",
            "combinedSha256": combined, "files": files, "parameters": parameters}


def freeze_manifest() -> dict[str, Any]:
    behavior = b241_behavior_fingerprint()
    lineage, presence = semantic_clause_lineage()
    prompts = effective_prompts()
    execution = execution_protocol_fingerprint()
    return {
        "manifestSchemaVersion": "b241_full_dev_reexecution_freeze_manifest_v1",
        "campaignId": config.CAMPAIGN_ID,
        "candidate": "B2.4.1 / Target v1.5.1",
        "b241BehaviorFingerprint": behavior["combinedSha256"],
        "b24HistoricalFingerprint": b24_behavior_fingerprint()["combinedSha256"],
        "executionProtocolFingerprint": execution["combinedSha256"],
        "behaviorFiles": {name: _sha_file(name) for name in BEHAVIOR_REFERENCE_FILES},
        "executionFiles": {item["path"]: item["sha256"] for item in execution["files"]},
        "effectivePromptHashes": {k: sha256_text(v) for k, v in prompts.items()},
        "semanticClauseLineage": lineage,
        "semanticClausePresence": presence,
        "executionParameters": execution["parameters"],
        "metricDefinitions": ["final_state_correctness", "majority_correct_cases",
                              "per_case_state_distribution", "state_stability_across_5_repetitions"],
        "failureTaxonomy": ["false_SUPPORTED", "FABRICATED_EVIDENCE", "WRONG_SOURCE_ATTRIBUTION",
                            "TRACE_ALIGNMENT_FAILURE", "hard_factual_failures",
                            "guard_induced_state_transitions", "guard_false_positives"],
        "manualAdjudicationRubric": {"level1AllRuns": True, "level2Cases": list(config.LEVEL2_CASES)},
        "b2BaselineArtifacts": [
            "services/ai-service/output/evidence_reasoning/b2-target-v1.1/development/runs.json",
            "services/ai-service/output/evidence_reasoning/b2-target-v1.1/development/evaluation.json"],
        "previousAbortedCampaign": "HISTORICAL_ABORTED_EVIDENCE_ONLY_NOT_REUSED",
    }


def verify(manifest: dict[str, Any]) -> tuple[str, list[str]]:
    """Resume/completion verification against a frozen manifest."""
    drift: list[str] = []
    if b241_behavior_fingerprint()["combinedSha256"] != manifest["b241BehaviorFingerprint"]:
        drift.append("b241BehaviorFingerprint")
    if b24_behavior_fingerprint()["combinedSha256"] != manifest["b24HistoricalFingerprint"]:
        drift.append("b24HistoricalFingerprint")
    if execution_protocol_fingerprint()["combinedSha256"] != manifest["executionProtocolFingerprint"]:
        drift.append("executionProtocolFingerprint")
    for name, digest in manifest["behaviorFiles"].items():
        if _sha_file(name) != digest:
            drift.append(f"behaviorFile:{name}")
    for name, digest in manifest["executionFiles"].items():
        if _sha_file(name) != digest:
            drift.append(f"executionFile:{name}")
    prompts = effective_prompts()
    for stage, digest in manifest["effectivePromptHashes"].items():
        if sha256_text(prompts[stage]) != digest:
            drift.append(f"effectivePrompt:{stage}")
    lineage, _ = semantic_clause_lineage()
    if lineage != "PASS":
        drift.append("semanticClauseLineage")
    return ("PASS" if not drift else "FAIL"), drift
