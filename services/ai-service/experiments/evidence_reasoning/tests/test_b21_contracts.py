from __future__ import annotations

from pathlib import Path

from experiments.evidence_reasoning.b21_artifacts import build_objective_analysis
from experiments.evidence_reasoning.b21_policy import b21_states, derive_resolution_closure
from experiments.evidence_reasoning.b21_validation import validate_and_enrich_reasoning
from experiments.evidence_reasoning.b21_cli import _ids


def _requirement() -> dict:
    return {
        "requirementId": "req_01", "requirementQuote": "análisis avanzado de señales", "normalizedRequirement": "Análisis avanzado de señales.", "traceValid": True,
        "evaluability": {"formativeEvidenceCapable": True}, "continuityCore": {"statement": "análisis de señales", "requirementBasisPhrases": ["análisis", "señales"], "traceValid": True},
        "materialQualifiers": [{"qualifierId": "q_01", "role": "MATERIAL_QUALIFIER"}], "contextAnnotations": [{"role": "CONTEXTUAL"}], "structuralWrappers": [{"role": "STRUCTURAL_WRAPPER"}],
    }


def _raw(*, refs: list[str] | None = None, facets: list[dict] | None = None) -> dict:
    facet_items = facets if facets is not None else [{"localFacetKey": "core", "facetText": "análisis de señales", "requirementBasisRefs": ["continuityCore"], "requirementBasis": "core", "whyNecessary": "core", "essential": True, "coverage": "PARTIAL", "evidenceUnitIds": ["eu_01"], "rationale": "base"}]
    return {"requirementId": "req_01", "evaluatedEvidence": [{"evidenceUnitId": "eu_01", "relation": "LIMITED_SCOPE", "supportedQualifierIds": [], "missingQualifierIds": ["q_01"], "evidenceContribution": "base", "rationale": "base"}], "facets": facet_items, "compositionAssessment": {"mode": "NONE", "nonRedundantEvidenceUnitIds": ["eu_01"], "jointlySupportsFullRequirement": False, "integrationRequired": False, "integrationDemonstrated": False, "integrationEvidenceIds": [], "missingFacetKeys": refs or [], "unresolved": False, "rationale": "base"}, "fullClaimAssessment": {"status": "NOT_REACHED", "supportedQualifierIds": [], "missingQualifierIds": ["q_01"], "coveredFacetKeys": ["core"] if facet_items else [], "missingFacetKeys": refs or [], "rationale": "base"}, "jointClaimCeiling": {"text": "base", "supportingEvidenceUnitIds": ["eu_01"]}, "weakerClaimCandidate": {"text": "análisis de señales", "supportingEvidenceUnitIds": ["eu_01"], "preservedRequirementCore": "análisis de señales", "corePreservation": "YES", "corePreservationRationale": "same", "changedCoreElements": [], "droppedQualifierIds": ["q_01"], "droppedFacetKeys": refs or [], "materialUsefulness": "YES", "usefulnessRationale": "useful"}, "incompleteSourceAssessments": [], "observableSupport": {"fullRequirementIndependentlyEstablished": "NO", "weakerClaimIndependentlyEstablished": "YES", "supportingEvidenceUnitIds": ["eu_01"], "missingMaterialCouldChangeFinalState": "NO"}, "semanticUnresolved": False, "unresolvedReason": ""}


def test_closure_truth_table() -> None:
    assert derive_resolution_closure({"fullRequirementIndependentlyEstablished": "YES", "weakerClaimIndependentlyEstablished": "NO", "missingMaterialCouldChangeFinalState": "YES"}) == "CLOSED"
    assert derive_resolution_closure({"fullRequirementIndependentlyEstablished": "NO", "weakerClaimIndependentlyEstablished": "YES", "missingMaterialCouldChangeFinalState": "NO"}) == "CLOSED"
    assert derive_resolution_closure({"fullRequirementIndependentlyEstablished": "NO", "weakerClaimIndependentlyEstablished": "YES", "missingMaterialCouldChangeFinalState": "YES"}) == "OPEN"
    assert derive_resolution_closure({"fullRequirementIndependentlyEstablished": "NO", "weakerClaimIndependentlyEstablished": "NO", "missingMaterialCouldChangeFinalState": "UNRESOLVED"}) == "UNRESOLVED"


def test_core_is_requirement_grounded_and_roles_are_partitioned() -> None:
    proposal = {"objectiveContext": "x", "requirements": [{"requirementQuote": "análisis avanzado de señales", "normalizedRequirement": "Análisis avanzado de señales.", "evaluationRole": "PRIMARY", "atomicity": "ATOMIC", "evaluability": {"requiredEvidenceType": "FORMATIVE_EVIDENCE", "formativeEvidenceCapable": True, "rationale": "x"}, "continuityCore": {"statement": "análisis de señales", "requirementBasisPhrases": ["análisis", "señales"], "rationale": "x"}, "qualifiers": [{"kind": "level", "value": "avanzado", "sourcePhrase": "avanzado", "role": "MATERIAL_QUALIFIER", "rationale": "x"}, {"kind": "label", "value": "requisito", "sourcePhrase": "análisis", "role": "STRUCTURAL_WRAPPER", "rationale": "x"}]}]}
    analysis, validations = build_objective_analysis(proposal, "análisis avanzado de señales")
    req = analysis["requirements"][0]
    assert req["continuityCore"]["traceValid"] is True
    assert len(req["materialQualifiers"]) == 1 and len(req["structuralWrappers"]) == 1
    assert all(item["status"] != "FAIL" for item in validations)


def test_local_facet_keys_map_to_authoritative_ids_and_invalid_refs_fail() -> None:
    enriched, validations, hard = validate_and_enrich_reasoning(_raw(), _requirement(), [{"evidenceUnitId": "eu_01"}], [], [])
    assert enriched["facets"][0]["facetId"] == "req_01_facet_01"
    assert enriched["fullClaimAssessment"]["coveredFacetIds"] == ["req_01_facet_01"]
    assert hard is False
    _, bad, hard_bad = validate_and_enrich_reasoning(_raw(refs=["free_text"]), _requirement(), [{"evidenceUnitId": "eu_01"}], [], [])
    assert hard_bad and any(item["code"] == "FACET_REFERENCES_EXIST" and item["status"] == "FAIL" for item in bad)


def test_pre_guard_state_is_unambiguously_pre_override() -> None:
    reasoning = {"resolutionClosure": "CLOSED", "semanticUnresolved": False, "compositionAssessment": {"unresolved": False}, "fullClaimAssessment": {"status": "NOT_REACHED"}, "weakerClaimCandidate": {"corePreservation": "YES", "materialUsefulness": "YES"}}
    pre, final, _ = b21_states(_requirement(), reasoning, hard_factual_failure=True)
    assert pre == "PARTIALLY_SUPPORTED" and final == "ABSTAIN"


def test_no_seed_specific_branches_or_gold_runtime_imports() -> None:
    root = Path(__file__).resolve().parents[1]
    text = "\n".join((root / name).read_text(encoding="utf-8") for name in ("b21_prompts.py", "b21_runtime.py", "b21_validation.py", "b21_policy.py"))
    for forbidden in ("case_09", "PCB", "Kubernetes", "ARM", "fixtures/gold", "from .gold import"):
        assert forbidden.casefold() not in text.casefold()


def test_cli_normalizes_protocol_case_notation_without_case_rules() -> None:
    assert _ids("01,case_03") == {"case_01", "case_03"}
