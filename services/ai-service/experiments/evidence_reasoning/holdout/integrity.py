from __future__ import annotations

"""HOLDOUT EXECUTION PROTOCOL FINGERPRINT, freeze manifest, gold isolation and
topology audits.

Three fingerprints now coexist and must never be conflated:

  B2.4.1 BEHAVIOR FINGERPRINT           what the model is asked  — UNCHANGED
  DEVELOPMENT EXECUTION FINGERPRINT     how the 55 dev runs were obtained — CLOSED
  HOLDOUT EXECUTION FINGERPRINT         how the 30 holdout runs will be obtained

The Holdout fingerprint pins the `campaign/` files it imports as well as its own,
so any edit to the Development harness invalidates the Holdout freeze instead of
silently changing the conditions of an unrun campaign.
"""

import ast
import hashlib
import json
import re
from pathlib import Path
from typing import Any

from ..b24_fingerprint import b24_behavior_fingerprint
from ..b241_fingerprint import b241_behavior_fingerprint
from ..campaign import integrity as dev_integrity
from ..campaign.store import sha256_text
from ..campaign.transport import ELIGIBLE_TRANSPORT_CATEGORIES, NON_RECOVERABLE_CATEGORIES
from ..fixtures import INPUT_PATH, assert_input_gold_isolation
from ..gold import GOLD_PATH
from . import config
from .adjudication import LEVEL2_TRIGGERS
from .evaluation import GENERALIZATION_CONTRACT

PACKAGE = Path(__file__).resolve().parent
EXPERIMENT = PACKAGE.parent

HOLDOUT_EXECUTION_FILES = (
    "holdout/__init__.py", "holdout/config.py", "holdout/store.py",
    "holdout/generation.py", "holdout/evaluation.py", "holdout/adjudication.py",
    "holdout/reporting.py", "holdout/integrity.py", "holdout/cli.py",
)

# Imported unchanged from the closed Development harness; pinned so that editing
# the Development campaign invalidates this freeze.
INHERITED_EXECUTION_FILES = (
    "campaign/__init__.py", "campaign/config.py", "campaign/transport.py",
    "campaign/store.py", "campaign/generation.py", "campaign/evaluation.py",
    "campaign/adjudication.py", "campaign/integrity.py",
)

BEHAVIOR_REFERENCE_FILES = dev_integrity.BEHAVIOR_REFERENCE_FILES

_REQUIREMENT_CLAUSE = re.compile(r"^Requisito\b", re.IGNORECASE)
_WORD = re.compile(r"[a-záéíóúñü]{4,}", re.IGNORECASE)

# The three effective prompt hashes recorded in the CLOSED Development freeze
# manifest, written before the first Development provider call and therefore long
# before any Holdout preparation existed. Pinning them here makes the isolation
# proof non-circular: if the prompt bytes are identical to what they were then,
# no Holdout vocabulary can have been inserted into them.
DEVELOPMENT_EFFECTIVE_PROMPT_HASHES = {
    "evidenceUnit": "8772c87cc95beb607c2466e73c4150ae0b15ff6832ae27eef449161637be3e40",
    "objective": "7ad7eafeb302a75b6580e6f9f214eab957737fc7a7814e80d7bd7c19a9b7245e",
    "unified": "6541c6449e6d6f3a9fa427b3d8dd0560b1778e8913ac3f2db551412d3dadb853",
}

# The pre-fix Holdout protocol fingerprint. It was frozen, never executed, and is
# retained as historical evidence: the protocol it describes treated a
# model-generated decomposition failure as ABORTED_INTEGRITY, which would have
# censored exactly the kind of generalization failure the Holdout must measure.
PREVIOUS_HOLDOUT_EXECUTION_FINGERPRINT = (
    "8809351eaaf8f1b0483016db348c2b87d8b620995f0c285644a0d0d5184b930d")

# Phrase length used for the content-leakage probe. Single tokens are useless
# here: framework vocabulary ("blockchain", "provenance", "redundancy") and
# ordinary Spanish ("mediante") legitimately occur in both the frozen prompts and
# the gold, and flagging them produces noise, not evidence. A verbatim four-word
# sequence lifted from Holdout gold would be genuine leakage.
_LEAK_PHRASE_LENGTH = 4


def _sha_file(relative: str) -> str:
    return hashlib.sha256((EXPERIMENT / relative).read_bytes()).hexdigest()


# --------------------------------------------------------------------------
# Gold isolation
# --------------------------------------------------------------------------

def _resolve(source: Path, level: int, module: str | None) -> Path | None:
    base = source.parent
    for _ in range(level - 1):
        base = base.parent
    if not module:
        return base / "__init__.py"
    target = base.joinpath(*module.split("."))
    if target.with_suffix(".py").exists():
        return target.with_suffix(".py")
    if (target / "__init__.py").exists():
        return target / "__init__.py"
    return None


def import_closure(entry: Path) -> list[Path]:
    """Every experiment module transitively reachable from `entry`.

    `from . import config` and `from ..campaign import integrity` import
    SUBMODULES, not just the package, so every alias is resolved as a candidate
    submodule too. Missing that would make this audit silently incomplete.
    """
    seen: dict[Path, None] = {}
    stack = [entry.resolve()]
    while stack:
        current = stack.pop()
        if current in seen or not current.exists():
            continue
        seen[current] = None
        tree = ast.parse(current.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.ImportFrom) or not node.level:
                continue
            candidates = [node.module]
            for alias in node.names:
                candidates.append(f"{node.module}.{alias.name}" if node.module else alias.name)
            for candidate in candidates:
                resolved = _resolve(current, node.level, candidate)
                if resolved is not None:
                    stack.append(resolved.resolve())
    return sorted(seen)


def gold_isolation_audit() -> dict[str, Any]:
    """Prove, statically, that the generation path cannot see Holdout gold."""
    findings: list[str] = []

    # 1. No gold field ever leaked into the model-input fixture file.
    try:
        assert_input_gold_isolation()
        input_isolation = "PASS"
    except AssertionError as error:  # pragma: no cover - would be a hard stop
        input_isolation = f"FAIL:{error}"
        findings.append("gold_fields_present_in_model_input")

    # 2. The generation import closure must not reach the gold module or file.
    closure = import_closure(PACKAGE / "generation.py")
    relative = [str(p.relative_to(EXPERIMENT)).replace("\\", "/") for p in closure]
    if "gold.py" in relative:
        findings.append("generation_closure_imports_gold_module")
    gold_readers = []
    for path, rel in zip(closure, relative):
        text = path.read_text(encoding="utf-8")
        if "load_gold" in text or "seed_v0_gold" in text:
            gold_readers.append(rel)
    if gold_readers:
        findings.append(f"generation_closure_references_gold:{','.join(gold_readers)}")

    # 3. No case-specific rule anywhere in the generation path (contract item 12).
    #    Holdout ids may appear ONLY in the two frozen config modules: as the
    #    Holdout set here, and as the Development harness's exclusion set there.
    #    Both are declarations of membership, never a branch on a case.
    case_id_sites: dict[str, list[str]] = {}
    for path, rel in zip(closure, relative):
        text = path.read_text(encoding="utf-8")
        hits = [cid for cid in config.HOLDOUT_CASES if cid in text]
        if hits:
            case_id_sites[rel] = hits
    declaration_only = {"holdout/config.py", "campaign/config.py"}
    illegal = {k: v for k, v in case_id_sites.items() if k not in declaration_only}
    if illegal:
        findings.append(f"holdout_case_specific_logic:{sorted(illegal)}")

    # 4. The frozen prompts are byte-identical to the ones hashed in the CLOSED
    #    Development freeze manifest. This is the decisive, non-circular check:
    #    those hashes were written before the first Development provider call, so
    #    nothing derived from Holdout gold can have entered the prompts since.
    prompts = dev_integrity.effective_prompts()
    prompt_hashes = {stage: sha256_text(text) for stage, text in prompts.items()}
    prompt_drift = sorted(stage for stage, digest in DEVELOPMENT_EFFECTIVE_PROMPT_HASHES.items()
                          if prompt_hashes.get(stage) != digest)
    if prompt_drift:
        findings.append(f"effective_prompts_changed_since_development_freeze:{prompt_drift}")

    # 5. Content-leakage probe: no verbatim four-word sequence from Holdout gold
    #    appears in the rendered prompts.
    gold_payload = json.loads(GOLD_PATH.read_text(encoding="utf-8"))
    holdout_blobs = [json.dumps(entry, ensure_ascii=False) for entry in gold_payload["cases"]
                     if entry["caseId"] in config.HOLDOUT_CASES]
    prompt_words = [m.group(0).lower() for m in _WORD.finditer("\n".join(prompts.values()))]
    prompt_phrases = {tuple(prompt_words[i:i + _LEAK_PHRASE_LENGTH])
                      for i in range(max(0, len(prompt_words) - _LEAK_PHRASE_LENGTH + 1))}
    gold_words = [m.group(0).lower() for m in _WORD.finditer(" ".join(holdout_blobs))]
    gold_phrases = {tuple(gold_words[i:i + _LEAK_PHRASE_LENGTH])
                    for i in range(max(0, len(gold_words) - _LEAK_PHRASE_LENGTH + 1))}
    leaked_phrases = sorted(" ".join(p) for p in gold_phrases & prompt_phrases)
    if leaked_phrases:
        findings.append(f"holdout_gold_phrases_in_effective_prompts:{leaked_phrases}")

    return {
        "audit": "HOLDOUT_GOLD_ISOLATION", "campaignId": config.CAMPAIGN_ID, "providerCalls": 0,
        "inputGoldIsolation": input_isolation,
        "generationImportClosure": relative,
        "generationClosureImportsGold": "gold.py" in relative,
        "generationClosureGoldReferences": gold_readers,
        "holdoutCaseIdSites": case_id_sites,
        "caseSpecificLogicOutsideConfig": sorted(illegal),
        "effectivePromptHashes": prompt_hashes,
        "developmentFrozenPromptHashes": dict(DEVELOPMENT_EFFECTIVE_PROMPT_HASHES),
        "promptsUnchangedSinceDevelopmentFreeze": not prompt_drift,
        "promptDrift": prompt_drift,
        "goldPhraseProbe": {
            "phraseLength": _LEAK_PHRASE_LENGTH,
            "holdoutGoldPhraseCount": len(gold_phrases),
            "promptPhraseCount": len(prompt_phrases),
            "overlap": leaked_phrases,
            "note": ("Single-token overlap is deliberately NOT a finding: framework vocabulary "
                     "and ordinary Spanish legitimately occur on both sides. Only a verbatim "
                     "multi-word sequence would indicate leakage."),
        },
        "phaseSeparation": {"phase1": "GENERATION_NO_GOLD",
                            "phase2": "EVALUATION_ONLY_AFTER_30_RUNS_COMPLETE"},
        "goldTouchingModules": ["holdout/evaluation.py"],
        "findings": findings,
        "GOLD_ISOLATION": "PASS" if not findings else "FAIL",
    }


# --------------------------------------------------------------------------
# Topology
# --------------------------------------------------------------------------

def topology_audit() -> dict[str, Any]:
    """Offline cardinality check. Budget is never widened by guesswork."""
    from ..fixtures import load_cases

    per_case = {}
    deviations = []
    for case in sorted(load_cases(split="holdout"), key=lambda c: c.case_id):
        clauses = [c.strip() for c in case.objective.split(".") if c.strip()]
        markers = [c for c in clauses if _REQUIREMENT_CLAUSE.match(c)]
        row = {"clauses": len(clauses), "requirementClauses": len(markers),
               "sources": len(case.sources), "split": case.split,
               "expectedRequirements": 1 if len(markers) == 1 else None,
               "expectedUnifiedCalls": config.UNIFIED_CALLS_PER_RUN if len(markers) == 1 else None}
        per_case[case.case_id] = row
        if len(markers) != 1:
            deviations.append(case.case_id)

    ok = not deviations and len(per_case) == len(config.HOLDOUT_CASES)
    return {
        "audit": "HOLDOUT_TOPOLOGY", "campaignId": config.CAMPAIGN_ID, "providerCalls": 0,
        "perCase": per_case,
        "deviations": deviations,
        "developmentPrecedent": ("All 55 Development runs resolved to exactly one Requirement "
                                 "and one Unified Contextual Reasoning call."),
        "limitation": ("Objective decomposition is decided by the model at runtime, so this is a "
                       "structural expectation, not a proof. campaign.generation.run_case still "
                       "raises ABORTED_INTEGRITY if a run yields a different cardinality."),
        "expectedLogicalCalls": config.LOGICAL_PROVIDER_CALLS if ok else None,
        "TOPOLOGY": "SINGLE_REQUIREMENT_EXPECTED" if ok else "HOLDOUT_TOPOLOGY_REVIEW_REQUIRED",
    }


def holdout_split_audit() -> dict[str, Any]:
    """Confirm the six frozen cases really are the fixture holdout split."""
    from ..fixtures import load_cases

    declared = sorted(config.HOLDOUT_CASES)
    from_fixtures = sorted(c.case_id for c in load_cases(split="holdout"))
    gold_payload = json.loads(GOLD_PATH.read_text(encoding="utf-8"))
    gold_ids = sorted(c["caseId"] for c in gold_payload["cases"] if c["caseId"] in declared)
    dev_overlap = sorted(set(declared) & set(config.DEVELOPMENT_CASES))
    return {
        "audit": "HOLDOUT_SPLIT", "campaignId": config.CAMPAIGN_ID, "providerCalls": 0,
        "declared": declared, "fixtureHoldoutSplit": from_fixtures,
        "goldEntriesPresent": gold_ids,
        "developmentOverlap": dev_overlap,
        "datasetVersion": gold_payload["datasetVersion"],
        "SPLIT_CONFIRMED": "PASS" if declared == from_fixtures and not dev_overlap else "FAIL",
    }


# --------------------------------------------------------------------------
# Fingerprint and freeze
# --------------------------------------------------------------------------

def execution_protocol_fingerprint() -> dict[str, Any]:
    files = [{"path": name, "sha256": _sha_file(name)}
             for name in HOLDOUT_EXECUTION_FILES + INHERITED_EXECUTION_FILES]
    parameters = {
        "campaignId": config.CAMPAIGN_ID,
        "provider": config.PROVIDER, "model": config.MODEL,
        "reasoningEffort": config.REASONING_EFFORT,
        "providerTimeoutSeconds": config.PROVIDER_TIMEOUT_SECONDS,
        "transportRetryBackoffSeconds": config.TRANSPORT_RETRY_BACKOFF_SECONDS,
        "maxConcurrentLogicalCalls": config.MAX_CONCURRENT_LOGICAL_CALLS,
        "holdoutCases": list(config.HOLDOUT_CASES),
        "developmentCasesExcluded": list(config.DEVELOPMENT_CASES),
        "repetitions": config.REPETITIONS,
        "runs": config.RUNS,
        "unifiedCallsPerRun": config.UNIFIED_CALLS_PER_RUN,
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
        "goldIsolationPolicy": {
            "phase1": "GENERATION_NO_GOLD_IMPORT_NO_GOLD_READ_NO_GOLD_BRANCHING",
            "phase2": "EVALUATION_ONLY_AFTER_30_RUNS_COMPLETE",
            "partialEvaluation": "FORBIDDEN",
            "caseSpecificRules": "FORBIDDEN",
        },
        "phaseSeparation": {"phase1": "HOLDOUT_GENERATION", "phase2": "HOLDOUT_EVALUATION"},
        # `topology_deviation` is deliberately NOT a stop condition any more. See
        # `modelGeneratedTopologyDeviation` below: a decomposition failure produced
        # by a valid model response is measured, not censored. Only the harness
        # variant of the same anomaly still aborts.
        "stopConditions": ["behavior_fingerprint_mismatch", "holdout_execution_protocol_mismatch",
                           "prompt_lineage_fail", "gold_isolation_fail", "holdout_split_mismatch",
                           "harness_topology_corruption", "effective_model_mismatch", "model_fallback",
                           "fixture_or_gold_mutation", "development_case_in_holdout_campaign",
                           "checkpoint_corruption", "wrong_run_artifact_attribution",
                           "unexpected_harness_unified_duplication", "recovery_budget_exhausted",
                           "second_transport_failure_same_logical_call",
                           "unapproved_4xx_or_config_intervention"],
        "modelGeneratedTopologyDeviation": {
            "policy": "RECORD_UNMAPPABLE_AND_CONTINUE",
            "appliesWhen": ("Objective Analysis returned a complete, durable, schema-valid, "
                            "correctly attributed response that resolves 0, >1 or no unique "
                            "authoritative Requirement."),
            "runState": config.COMPLETE,
            "unmappableReasons": list(config.UNMAPPABLE_REASONS),
            "finalState": None,
            "requirementSelection": "FORBIDDEN",
            "unifiedProviderCalls": 0,
            "unusedLogicalCallSlot": "DISCARDED_NOT_REASSIGNED",
            "retry": "FORBIDDEN",
            "phase2Treatment": "COUNTED_IN_DENOMINATOR_AS_INCORRECT",
            "level2Trigger": "unmappable_run",
            "semanticSchemaChange": "NONE — represented in harness metadata only",
        },
        "harnessTopologyCorruption": {
            "policy": "ABORTED_INTEGRITY",
            "appliesWhen": ("fixture mismatch or mutation, schema/harness mutation, corrupted "
                            "persisted response, response hash mismatch, wrong-run artifact "
                            "attribution, checkpoint corruption, execution-order corruption, "
                            "harness-issued duplicate Unified execution, or any fingerprint or "
                            "prompt-lineage drift."),
            "classificationSource": ("re-established from durable artifacts and frozen fixtures, "
                                     "never from the abort message"),
        },
        "logicalCallBudgetSemantics": config.LOGICAL_CALL_BUDGET_SEMANTICS,
        "terminalRunStates": ["COMPLETE_MAPPABLE", "COMPLETE_UNMAPPABLE"],
        "phase2Precondition": "ALL_30_PLANNED_RUNS_TERMINAL_NOT_30_NON_NULL_FINAL_STATES",
        "semanticRerun": "FORBIDDEN", "selectiveRerun": "FORBIDDEN",
        "completedStageRerun": "FORBIDDEN", "completedRunRerun": "FORBIDDEN",
        "partialEvaluation": "FORBIDDEN", "developmentReexecution": "FORBIDDEN",
        "sixthRepetition": "FORBIDDEN", "postHoldoutTuning": "FORBIDDEN",
        "b2OnHoldout": "NOT_AUTHORIZED",
        "generalizationContract": GENERALIZATION_CONTRACT,
        "level2Triggers": LEVEL2_TRIGGERS,
    }
    combined = hashlib.sha256(json.dumps(
        {"files": files, "parameters": parameters}, sort_keys=True, ensure_ascii=False,
        separators=(",", ":")).encode("utf-8")).hexdigest()
    return {"fingerprintSchemaVersion": "b241_holdout_execution_protocol_fingerprint_v2",
            "protocolRevision": "v2_topology_semantic_failure_correction",
            "previousHoldoutExecutionProtocolFingerprint": PREVIOUS_HOLDOUT_EXECUTION_FINGERPRINT,
            "previousProtocolStatus": "HISTORICAL_PRE_FIX_HOLDOUT_PROTOCOL_NEVER_EXECUTED",
            "combinedSha256": combined, "files": files, "parameters": parameters}


def freeze_manifest() -> dict[str, Any]:
    behavior = b241_behavior_fingerprint()
    lineage, presence = dev_integrity.semantic_clause_lineage()
    prompts = dev_integrity.effective_prompts()
    execution = execution_protocol_fingerprint()
    isolation = gold_isolation_audit()
    topology = topology_audit()
    split = holdout_split_audit()
    return {
        "manifestSchemaVersion": "b241_holdout_freeze_manifest_v2",
        "campaignId": config.CAMPAIGN_ID,
        "candidate": "B2.4.1 / Target v1.5.1",
        "protocolRevision": {
            "revision": "v2_topology_semantic_failure_correction",
            "previousHoldoutExecutionProtocolFingerprint": PREVIOUS_HOLDOUT_EXECUTION_FINGERPRINT,
            "newHoldoutExecutionProtocolFingerprint": execution["combinedSha256"],
            "previousProtocolStatus": "HISTORICAL_PRE_FIX_NEVER_EXECUTED",
            "onlyProtocolDelta": ("MODEL-GENERATED VALID OBJECTIVE DECOMPOSITION -> "
                                  "UNMAPPABLE SEMANTIC RESULT (record and continue), instead of "
                                  "ABORTED_INTEGRITY. Harness topology corruption still aborts."),
            "unchanged": {
                "b241BehaviorFingerprint": behavior["combinedSha256"],
                "b241SemanticSchemas": "BYTE_IDENTICAL",
                "effectivePrompts": "BYTE_IDENTICAL",
                "generalizationContract": "UNCHANGED",
                "gold": "UNCHANGED",
                "holdoutCases": list(config.HOLDOUT_CASES),
                "repetitions": config.REPETITIONS,
                "executionOrder": "UNCHANGED",
                "provider": config.PROVIDER, "model": config.MODEL,
                "reasoningEffort": config.REASONING_EFFORT,
                "providerTimeoutSeconds": config.PROVIDER_TIMEOUT_SECONDS,
                "transportRecoveryReserve": config.TRANSPORT_RECOVERY_RESERVE,
                "absoluteProviderAttemptCap": config.ABSOLUTE_PROVIDER_ATTEMPT_CAP,
                "postHoldoutTerminalRule": "UNCHANGED",
                "campaignPackage": "UNMODIFIED",
            },
        },
        "developmentStatus": "CLOSED",
        "developmentFinalClassification": "COMPARABLE_TO_B2",
        "b241BehaviorFingerprint": behavior["combinedSha256"],
        "b24HistoricalFingerprint": b24_behavior_fingerprint()["combinedSha256"],
        "developmentExecutionProtocolFingerprint":
            dev_integrity.execution_protocol_fingerprint()["combinedSha256"],
        "holdoutExecutionProtocolFingerprint": execution["combinedSha256"],
        "behaviorFiles": {name: _sha_file(name) for name in BEHAVIOR_REFERENCE_FILES},
        "executionFiles": {item["path"]: item["sha256"] for item in execution["files"]},
        "holdoutFixtures": {"path": "fixtures/inputs/seed_v0_inputs.json",
                            "sha256": _sha_file("fixtures/inputs/seed_v0_inputs.json"),
                            "cases": list(config.HOLDOUT_CASES)},
        "holdoutGold": {"path": "fixtures/gold/seed_v0_gold.json",
                        "sha256": _sha_file("fixtures/gold/seed_v0_gold.json"),
                        "usedInPhase1": False, "usedInPhase2": True},
        "effectivePromptHashes": {k: sha256_text(v) for k, v in prompts.items()},
        "semanticClauseLineage": lineage,
        "semanticClausePresence": presence,
        "executionParameters": execution["parameters"],
        "goldIsolation": isolation["GOLD_ISOLATION"],
        "topology": topology["TOPOLOGY"],
        "splitConfirmed": split["SPLIT_CONFIRMED"],
        "metricDefinitions": ["final_state_correctness", "per_case_state_distribution",
                              "majority_correct_cases", "state_stability_across_5_repetitions",
                              "abstention_profile", "development_vs_holdout_comparison"],
        "failureTaxonomy": ["false_SUPPORTED", "FABRICATED_EVIDENCE", "WRONG_SOURCE_ATTRIBUTION",
                            "TRACE_ALIGNMENT_FAILURE", "hard_factual_failures",
                            "guard_induced_transitions", "guard_false_positives"],
        "manualAdjudicationRubric": {"level1AllRuns": True,
                                     "level2Selection": config.LEVEL2_SELECTION,
                                     "level2Triggers": sorted(LEVEL2_TRIGGERS)},
        "developmentArtifactsNotOverwritten": [
            "b241-full-dev-reexecution-*", "b241-full-development-*",
            "b24-*", "b2-*"],
    }


def verify(manifest: dict[str, Any]) -> tuple[str, list[str]]:
    """Resume/completion verification against the frozen Holdout manifest."""
    drift: list[str] = []
    if b241_behavior_fingerprint()["combinedSha256"] != manifest["b241BehaviorFingerprint"]:
        drift.append("b241BehaviorFingerprint")
    if b24_behavior_fingerprint()["combinedSha256"] != manifest["b24HistoricalFingerprint"]:
        drift.append("b24HistoricalFingerprint")
    if (dev_integrity.execution_protocol_fingerprint()["combinedSha256"]
            != manifest["developmentExecutionProtocolFingerprint"]):
        drift.append("developmentExecutionProtocolFingerprint")
    if execution_protocol_fingerprint()["combinedSha256"] != manifest["holdoutExecutionProtocolFingerprint"]:
        drift.append("holdoutExecutionProtocolFingerprint")
    for name, digest in manifest["behaviorFiles"].items():
        if _sha_file(name) != digest:
            drift.append(f"behaviorFile:{name}")
    for name, digest in manifest["executionFiles"].items():
        if _sha_file(name) != digest:
            drift.append(f"executionFile:{name}")
    if _sha_file("fixtures/inputs/seed_v0_inputs.json") != manifest["holdoutFixtures"]["sha256"]:
        drift.append("holdoutFixtures")
    if _sha_file("fixtures/gold/seed_v0_gold.json") != manifest["holdoutGold"]["sha256"]:
        drift.append("holdoutGold")
    prompts = dev_integrity.effective_prompts()
    for stage, digest in manifest["effectivePromptHashes"].items():
        if sha256_text(prompts[stage]) != digest:
            drift.append(f"effectivePrompt:{stage}")
    lineage, _ = dev_integrity.semantic_clause_lineage()
    if lineage != "PASS":
        drift.append("semanticClauseLineage")
    if gold_isolation_audit()["GOLD_ISOLATION"] != "PASS":
        drift.append("goldIsolation")
    if holdout_split_audit()["SPLIT_CONFIRMED"] != "PASS":
        drift.append("holdoutSplit")
    if topology_audit()["TOPOLOGY"] != "SINGLE_REQUIREMENT_EXPECTED":
        drift.append("holdoutTopology")
    return ("PASS" if not drift else "FAIL"), drift
