"""B2.4 offline contract tests.

All fixtures are synthetic and domain-general. None reuses Seed Development
content, technologies or wording: the point is to exercise the contracts, not to
encode case-specific behavior.
"""
from __future__ import annotations

import json
from typing import Any

import pytest

from experiments.evidence_reasoning.b24_artifacts import build_b24_objective_analysis
from experiments.evidence_reasoning.b24_policy import b24_final_state
from experiments.evidence_reasoning.b24_runtime import (
    ABSOLUTE_HARD_CAP,
    PREFERRED_HARD_CAP,
    PROBE_CASE_IDS,
    provider_call_plan,
    run_b24_case,
)
from experiments.evidence_reasoning.b24_schemas import validate_b24_schema
from experiments.evidence_reasoning.b24_validation import validate_and_enrich_b24
from experiments.evidence_reasoning.models import FixtureCase, ProviderResult, SourceInput

OBJECTIVE = "Contexto del puesto: equipo de campo. Requisito formativo: cartografía hidrológica avanzada."
REQUIREMENT_QUOTE = "Requisito formativo: cartografía hidrológica avanzada."


def _requirement(
    *,
    epistemic_target: str = "FORMATIVE_EVIDENCE",
    formative_capable: bool = True,
) -> dict[str, Any]:
    start = OBJECTIVE.index(REQUIREMENT_QUOTE)
    return {
        "requirementId": "req_01",
        "requirementQuote": REQUIREMENT_QUOTE,
        "normalizedRequirement": "formación en cartografía hidrológica avanzada",
        "epistemicTarget": epistemic_target,
        "epistemicTargetRationale": "El Requirement pide formación, no desempeño evaluado.",
        "epistemicTargetFrozenBy": "OBJECTIVE_ANALYSIS_EVIDENCE_BLIND",
        "sourceSpan": {"charStart": start, "charEnd": start + len(REQUIREMENT_QUOTE), "exactText": REQUIREMENT_QUOTE},
        "traceValid": True,
        "atomicity": "ATOMIC",
        "evaluability": {
            "requiredEvidenceType": "FORMATIVE_EVIDENCE",
            "formativeEvidenceCapable": formative_capable,
            "rationale": "Evaluable con evidencia formativa.",
        },
        "qualifiers": [],
        "materialQualifiers": [],
        "contextAnnotations": [],
        "structuralWrappers": [],
    }


def _continuity(
    *,
    status: str = "YES",
    transformation: str = "CONSTITUTIVE_REDUCTION",
    phrases: list[str] | None = None,
    shift_reason: str | None = None,
) -> dict[str, Any]:
    return {
        "status": status,
        "transformation": transformation,
        "requirementBasisPhrases": ["cartografía hidrológica"] if phrases is None else phrases,
        "constitutiveProjection": "Menor profundidad sobre el mismo objeto.",
        "explicitlyRelaxed": ["avanzada"],
        "externalTargetIntroduced": "NO",
        "shiftReason": shift_reason,
        "rationale": "Sigue siendo el mismo objeto con alcance reducido.",
    }


def _candidate(*, continuity: dict[str, Any] | None = None, usefulness: str = "YES") -> dict[str, Any]:
    return {
        "text": "formación en cartografía hidrológica sin nivel avanzado",
        "supportingEvidenceUnitIds": ["eu_01"],
        "derivedFromJointClaimCeiling": "YES",
        "droppedQualifierIds": [],
        "droppedFacetLocalKeys": [],
        "continuityAssessment": _continuity() if continuity is None else continuity,
        "materialUsefulness": usefulness,
        "usefulnessRationale": "Sigue siendo informativo para el criterio.",
    }


def _reasoning(
    *,
    search_status: str = "FOUND",
    candidate: dict[str, Any] | None = "default",  # type: ignore[assignment]
    search_rationale: str = "Se buscó una proyección más débil sobre el mismo Requirement.",
    full_status: str = "NOT_REACHED",
    observability: str = "SUFFICIENT",
    facets: list[dict[str, Any]] | None = None,
    composition_unresolved: bool = False,
    semantic_unresolved: bool = False,
) -> dict[str, Any]:
    if candidate == "default":
        candidate = _candidate() if search_status == "FOUND" else None
    return {
        "requirementId": "req_01",
        "evaluatedEvidence": [
            {
                "evidenceUnitId": "eu_01",
                "relation": "LIMITED_SCOPE",
                "supportedQualifierIds": [],
                "missingQualifierIds": [],
                "evidenceContribution": "Cobertura del objeto sin el nivel pedido.",
                "rationale": "Mismo objeto, menor alcance.",
            }
        ],
        "facets": [] if facets is None else facets,
        "compositionAssessment": {
            "mode": "NONE",
            "nonRedundantEvidenceUnitIds": ["eu_01"],
            "jointlySupportsFullRequirement": False,
            "integrationRequired": False,
            "integrationDemonstrated": False,
            "integrationEvidenceIds": [],
            "missingFacetLocalKeys": [],
            "unresolved": composition_unresolved,
            "rationale": "Una sola unidad material.",
        },
        "fullClaimAssessment": {
            "status": full_status,
            "supportedQualifierIds": [],
            "missingQualifierIds": [],
            "coveredFacetLocalKeys": [],
            "missingFacetLocalKeys": [],
            "rationale": "No alcanza el nivel pedido.",
        },
        "jointClaimCeiling": {"text": "formación en cartografía hidrológica", "supportingEvidenceUnitIds": ["eu_01"]},
        "observabilityAssessment": {
            "incompleteSourceAssessments": [],
            "independentObservableSupport": "WEAKER_CLAIM",
            "observabilityStatus": observability,
            "rationale": "Fuente completa.",
        },
        "weakerClaimSearch": {"status": search_status, "rationale": search_rationale, "candidate": candidate},
        "semanticUnresolved": semantic_unresolved,
        "unresolvedReason": "",
    }


def _evidence_units() -> list[dict[str, Any]]:
    return [
        {
            "evidenceUnitId": "eu_01",
            "normalizedProposition": "Contenido declarado de cartografía hidrológica.",
            "sourceTrace": {
                "sourceId": "src_01",
                "credentialId": "cred_01",
                "sourceSha256": "a" * 64,
                "charStart": 0,
                "charEnd": 10,
                "exactExcerpt": "cartograf",
            },
        }
    ]


def _source_facts(coverage: str = "FULL") -> list[dict[str, Any]]:
    return [{"sourceId": "src_01", "coverageStatus": coverage, "observedEvidenceUnitIds": ["eu_01"], "extractionDiagnostics": []}]


def _validate(reasoning: dict[str, Any], requirement: dict[str, Any] | None = None, coverage: str = "FULL"):
    return validate_and_enrich_b24(
        reasoning,
        requirement or _requirement(),
        _evidence_units(),
        [],
        _source_facts(coverage),
        [],
    )


def _codes(results: list[dict[str, Any]], code: str) -> list[dict[str, Any]]:
    return [item for item in results if item["code"] == code]


# --------------------------------------------------------------------------
# DELTA_A -- explicit weaker-claim search
# --------------------------------------------------------------------------

def test_found_status_requires_candidate():
    _, results, hard = _validate(_reasoning(search_status="FOUND", candidate=None))
    assert _codes(results, "WEAKER_SEARCH_CANDIDATE_CONSISTENT")[0]["status"] == "FAIL"
    assert hard is True


def test_none_status_forbids_candidate():
    _, results, hard = _validate(_reasoning(search_status="NONE", candidate=_candidate()))
    assert _codes(results, "WEAKER_SEARCH_CANDIDATE_CONSISTENT")[0]["status"] == "FAIL"
    assert hard is True


def test_none_status_without_candidate_is_valid():
    _, results, hard = _validate(_reasoning(search_status="NONE", candidate=None))
    assert _codes(results, "WEAKER_SEARCH_CANDIDATE_CONSISTENT")[0]["status"] == "PASS"
    assert hard is False


def test_unresolved_status_without_candidate_is_valid():
    _, results, hard = _validate(_reasoning(search_status="UNRESOLVED", candidate=None))
    assert _codes(results, "WEAKER_SEARCH_CANDIDATE_CONSISTENT")[0]["status"] == "PASS"
    assert hard is False


def test_search_must_be_documented_when_required():
    _, results, hard = _validate(_reasoning(search_status="NONE", candidate=None, search_rationale="   "))
    assert _codes(results, "WEAKER_SEARCH_DOCUMENTED_WHEN_REQUIRED")[0]["status"] == "FAIL"
    assert hard is True


def test_search_not_required_when_full_claim_reached():
    artifact, results, hard = _validate(
        _reasoning(full_status="REACHED", search_status="NONE", candidate=None, search_rationale="")
    )
    assert artifact["weakerClaimSearch"]["searchRequired"] is False
    assert _codes(results, "WEAKER_SEARCH_DOCUMENTED_WHEN_REQUIRED")[0]["status"] == "PASS"
    assert hard is False


def test_search_not_required_when_observability_is_material_gap():
    artifact, _, _ = _validate(_reasoning(observability="MATERIAL_GAP", search_status="NONE", candidate=None, search_rationale=""))
    assert artifact["weakerClaimSearch"]["searchRequired"] is False


def test_search_is_not_gated_by_relation_label():
    """No deterministic rule may map a relation onto a search status."""
    reasoning = _reasoning(search_status="FOUND")
    reasoning["evaluatedEvidence"][0]["relation"] = "RELATED_NON_ENTAILING"
    _, results, hard = _validate(reasoning)
    assert hard is False
    assert _codes(results, "WEAKER_SEARCH_CANDIDATE_CONSISTENT")[0]["status"] == "PASS"


# --------------------------------------------------------------------------
# DELTA_B -- constitutive-reduction continuity
# --------------------------------------------------------------------------

def test_continuity_yes_requires_constitutive_reduction():
    candidate = _candidate(continuity=_continuity(status="YES", transformation="SEMANTIC_SHIFT"))
    _, results, hard = _validate(_reasoning(candidate=candidate))
    assert _codes(results, "CONTINUITY_TRANSFORMATION_CONSISTENT")[0]["status"] == "FAIL"
    assert hard is True


def test_continuity_no_requires_shift_reason():
    candidate = _candidate(
        continuity=_continuity(status="NO", transformation="SEMANTIC_SHIFT", shift_reason=None),
        usefulness="NOT_EVALUATED",
    )
    _, results, hard = _validate(_reasoning(candidate=candidate))
    assert _codes(results, "CONTINUITY_SHIFT_REASON_PRESENT")[0]["status"] == "FAIL"
    assert hard is True


def test_continuity_no_with_shift_reason_is_structurally_valid():
    candidate = _candidate(
        continuity=_continuity(status="NO", transformation="SEMANTIC_SHIFT", shift_reason="PREREQUISITE_OR_FOUNDATION"),
        usefulness="NOT_EVALUATED",
    )
    _, results, hard = _validate(_reasoning(candidate=candidate))
    assert _codes(results, "CONTINUITY_SHIFT_REASON_PRESENT")[0]["status"] == "PASS"
    assert hard is False


def test_material_usefulness_must_not_be_evaluated_before_continuity_yes():
    candidate = _candidate(
        continuity=_continuity(status="NO", transformation="SEMANTIC_SHIFT", shift_reason="NEIGHBOR_OR_SUBSTITUTION"),
        usefulness="YES",
    )
    _, results, hard = _validate(_reasoning(candidate=candidate))
    assert _codes(results, "MATERIAL_USEFULNESS_ORDER")[0]["status"] == "FAIL"
    assert hard is True


# --------------------------------------------------------------------------
# DELTA_D -- quote-first continuity trace
# --------------------------------------------------------------------------

def test_literal_continuity_basis_aligns():
    artifact, results, hard = _validate(_reasoning())
    assert _codes(results, "CONTINUITY_REQUIREMENT_BASIS_TRACE_VALID")[0]["status"] == "PASS"
    spans = artifact["weakerClaimSearch"]["candidate"]["continuityAssessment"]["requirementBasisSpans"]
    assert spans and spans[0]["exactText"] == "cartografía hidrológica"
    assert hard is False


def test_paraphrased_continuity_basis_is_rejected():
    """A paraphrase must never be accepted as a literal Requirement span."""
    candidate = _candidate(continuity=_continuity(phrases=["Formación en cartografía hidrológica"]))
    _, results, hard = _validate(_reasoning(candidate=candidate))
    assert _codes(results, "CONTINUITY_REQUIREMENT_BASIS_TRACE_VALID")[0]["status"] == "FAIL"
    assert hard is True


def test_facet_basis_must_be_literal_requirement_phrase():
    facets = [
        {
            "localFacetKey": "f_a",
            "facetText": "lectura de cartas",
            "requirementBasisPhrases": ["algo que no está en el Requirement"],
            "whyNecessary": "componente",
            "essential": True,
            "coverage": "PARTIAL",
            "evidenceUnitIds": ["eu_01"],
            "rationale": "r",
        }
    ]
    _, results, hard = _validate(_reasoning(facets=facets))
    assert _codes(results, "FACET_BASIS_WITHIN_REQUIREMENT")[0]["status"] == "FAIL"
    assert hard is True


# --------------------------------------------------------------------------
# DELTA_C -- epistemic target preservation (case-08 family protection)
# --------------------------------------------------------------------------

def test_formative_requirement_is_not_strengthened_by_normalization():
    """A formative Requirement must not silently require individual possession."""
    reasoning = _reasoning(full_status="REACHED", search_status="NONE", candidate=None, search_rationale="")
    reasoning["fullClaimAssessment"]["rationale"] = "El contenido declarado cubre los componentes formativos pedidos."
    requirement = _requirement(epistemic_target="FORMATIVE_EVIDENCE")
    artifact, _, hard = _validate(reasoning, requirement)
    state, inputs = b24_final_state(requirement, artifact, hard_factual_failure=hard)
    assert artifact["epistemicTargetAudit"]["status"] == "NO_CUE_DETECTED"
    assert inputs["epistemicTarget"] == "FORMATIVE_EVIDENCE"
    assert state == "SUPPORTED"


def test_possession_language_is_a_descriptive_cue_never_a_hard_override():
    reasoning = _reasoning(full_status="REACHED", search_status="NONE", candidate=None, search_rationale="")
    reasoning["fullClaimAssessment"]["rationale"] = "El contenido declarado no acredita que la persona cuente con esos fundamentos."
    requirement = _requirement(epistemic_target="FORMATIVE_EVIDENCE")
    artifact, results, hard = _validate(reasoning, requirement)
    audit = artifact["epistemicTargetAudit"]
    assert audit["status"] == "MANUAL_ADJUDICATION_REQUIRED"
    assert audit["cueInterpretation"] == "DESCRIPTIVE_ONLY_NOT_A_VERDICT"
    assert audit["achievementLanguageCues"]
    # The cue is descriptive: it must not flip the epistemic state by itself.
    assert hard is False
    assert all(item["affectsEpistemicState"] is False for item in _codes(results, "EPISTEMIC_TARGET_PRESERVATION"))


def test_epistemic_target_is_frozen_by_objective_analysis():
    proposal = {
        "decompositionStatus": "RESOLVED",
        "objectiveContext": "Contexto del puesto: equipo de campo.",
        "candidateSegments": [
            {"text": "Contexto del puesto: equipo de campo.", "segmentRole": "OBJECTIVE_CONTEXT", "rationale": "contexto"},
            {"text": REQUIREMENT_QUOTE, "segmentRole": "EVALUABLE_REQUIREMENT", "rationale": "criterio"},
        ],
        "ambiguityRationale": "",
        "requirements": [
            {
                "requirementQuote": REQUIREMENT_QUOTE,
                "normalizedRequirement": "contar con cartografía hidrológica avanzada",
                "epistemicTarget": "FORMATIVE_EVIDENCE",
                "epistemicTargetRationale": "Pide formación, no desempeño acreditado.",
                "atomicity": "ATOMIC",
                "evaluability": {
                    "requiredEvidenceType": "FORMATIVE_EVIDENCE",
                    "formativeEvidenceCapable": True,
                    "rationale": "ok",
                },
                "qualifiers": [],
            }
        ],
    }
    validate_b24_schema("b24_objective_analysis", proposal)
    analysis, _ = build_b24_objective_analysis(proposal, OBJECTIVE)
    requirement = analysis["requirements"][0]
    assert requirement["epistemicTarget"] == "FORMATIVE_EVIDENCE"
    assert requirement["epistemicTargetFrozenBy"] == "OBJECTIVE_ANALYSIS_EVIDENCE_BLIND"
    # A stronger-sounding normalization does not change the frozen target.
    assert "contar con" in requirement["normalizedRequirement"]


def test_unresolved_epistemic_target_abstains_without_new_state():
    requirement = _requirement(epistemic_target="UNRESOLVED")
    artifact, _, hard = _validate(_reasoning(), requirement)
    state, inputs = b24_final_state(requirement, artifact, hard_factual_failure=hard)
    assert inputs["unresolvedContributors"]["epistemicTargetUnresolved"] is True
    assert state == "ABSTAIN"


# --------------------------------------------------------------------------
# Deterministic policy
# --------------------------------------------------------------------------

def test_constitutive_reduction_yields_partially_supported():
    requirement = _requirement()
    artifact, _, hard = _validate(_reasoning(), requirement)
    state, _ = b24_final_state(requirement, artifact, hard_factual_failure=hard)
    assert state == "PARTIALLY_SUPPORTED"


def test_usefulness_cannot_rescue_a_semantic_shift():
    requirement = _requirement()
    candidate = _candidate(
        continuity=_continuity(status="NO", transformation="SEMANTIC_SHIFT", shift_reason="PREREQUISITE_OR_FOUNDATION"),
        usefulness="NOT_EVALUATED",
    )
    artifact, _, hard = _validate(_reasoning(candidate=candidate), requirement)
    state, inputs = b24_final_state(requirement, artifact, hard_factual_failure=hard)
    assert inputs["hasMateriallyUsefulWeakerClaim"] is False
    assert state == "INSUFFICIENT_EVIDENCE"


def test_search_none_yields_insufficient_not_abstain():
    requirement = _requirement()
    artifact, _, hard = _validate(_reasoning(search_status="NONE", candidate=None), requirement)
    state, _ = b24_final_state(requirement, artifact, hard_factual_failure=hard)
    assert state == "INSUFFICIENT_EVIDENCE"


def test_search_unresolved_yields_abstain():
    requirement = _requirement()
    artifact, _, hard = _validate(_reasoning(search_status="UNRESOLVED", candidate=None), requirement)
    state, _ = b24_final_state(requirement, artifact, hard_factual_failure=hard)
    assert state == "ABSTAIN"


def test_continuity_unresolved_yields_abstain():
    requirement = _requirement()
    candidate = _candidate(
        continuity=_continuity(status="UNRESOLVED", transformation="UNRESOLVED"), usefulness="NOT_EVALUATED"
    )
    artifact, _, hard = _validate(_reasoning(candidate=candidate), requirement)
    state, _ = b24_final_state(requirement, artifact, hard_factual_failure=hard)
    assert state == "ABSTAIN"


def test_material_gap_observability_yields_abstain():
    requirement = _requirement()
    artifact, _, hard = _validate(
        _reasoning(observability="MATERIAL_GAP", search_status="NONE", candidate=None), requirement, coverage="PARTIAL"
    )
    state, _ = b24_final_state(requirement, artifact, hard_factual_failure=hard)
    assert state == "ABSTAIN"


def test_non_formative_requirement_is_not_assessable():
    requirement = _requirement(formative_capable=False)
    artifact, _, hard = _validate(_reasoning(search_status="NONE", candidate=None), requirement)
    state, _ = b24_final_state(requirement, artifact, hard_factual_failure=hard)
    assert state == "NOT_ASSESSABLE"


# --------------------------------------------------------------------------
# Preserved B2.2/B2.3 gains -- regression guards
# --------------------------------------------------------------------------

def test_full_sources_cannot_declare_missing_material():
    reasoning = _reasoning()
    reasoning["observabilityAssessment"]["observabilityStatus"] = "MATERIAL_GAP"
    _, results, hard = _validate(reasoning, coverage="FULL")
    assert _codes(results, "FULL_SOURCES_NO_MISSING_MATERIAL")[0]["status"] == "FAIL"
    assert hard is True


def test_facet_local_keys_are_rewritten_to_authoritative_ids():
    facets = [
        {
            "localFacetKey": "f_a",
            "facetText": "lectura de cartas",
            "requirementBasisPhrases": ["cartografía hidrológica"],
            "whyNecessary": "componente",
            "essential": True,
            "coverage": "FULL",
            "evidenceUnitIds": ["eu_01"],
            "rationale": "r",
        }
    ]
    reasoning = _reasoning(facets=facets)
    reasoning["fullClaimAssessment"]["coveredFacetLocalKeys"] = ["f_a"]
    artifact, results, hard = _validate(reasoning)
    assert artifact["facets"][0]["facetId"] == "req_01_facet_01"
    assert artifact["fullClaimAssessment"]["coveredFacetIds"] == ["req_01_facet_01"]
    assert _codes(results, "FACET_AUTHORITATIVE_REFERENCES_EXIST")[0]["status"] == "PASS"
    assert hard is False


def test_same_facet_key_may_repeat_across_different_reference_fields():
    """The B2.1 ordering/multiplicity defect must not return."""
    facets = [
        {
            "localFacetKey": "f_a",
            "facetText": "lectura de cartas",
            "requirementBasisPhrases": ["cartografía hidrológica"],
            "whyNecessary": "componente",
            "essential": True,
            "coverage": "PARTIAL",
            "evidenceUnitIds": ["eu_01"],
            "rationale": "r",
        }
    ]
    reasoning = _reasoning(facets=facets)
    reasoning["fullClaimAssessment"]["missingFacetLocalKeys"] = ["f_a"]
    reasoning["compositionAssessment"]["missingFacetLocalKeys"] = ["f_a"]
    reasoning["weakerClaimSearch"]["candidate"]["droppedFacetLocalKeys"] = ["f_a"]
    _, results, hard = _validate(reasoning)
    assert _codes(results, "FACET_LOCAL_REFERENCES_EXIST")[0]["status"] == "PASS"
    assert _codes(results, "FACET_AUTHORITATIVE_REFERENCES_EXIST")[0]["status"] == "PASS"
    assert hard is False


def test_no_facets_means_no_facet_references():
    reasoning = _reasoning()
    reasoning["fullClaimAssessment"]["coveredFacetLocalKeys"] = ["ghost"]
    _, results, hard = _validate(reasoning)
    assert _codes(results, "FACET_LOCAL_REFERENCES_EXIST")[0]["status"] == "FAIL"
    assert hard is True


def test_positive_claim_requires_evidence():
    reasoning = _reasoning()
    reasoning["jointClaimCeiling"]["supportingEvidenceUnitIds"] = []
    reasoning["weakerClaimSearch"]["candidate"]["supportingEvidenceUnitIds"] = []
    _, results, hard = _validate(reasoning)
    assert _codes(results, "POSITIVE_SEMANTICS_HAVE_EVIDENCE")[0]["status"] == "FAIL"
    assert hard is True


# --------------------------------------------------------------------------
# Provider-call budget
# --------------------------------------------------------------------------

def test_probe_plan_fits_preferred_cap_without_smoke():
    plan = provider_call_plan()
    assert plan["liveSmokeRequired"] is False
    assert plan["combinedExpectedCalls"] == PREFERRED_HARD_CAP == 15
    assert plan["status"] == "PASS"
    assert plan["developmentProbe"]["caseIds"] == PROBE_CASE_IDS


def test_probe_plan_with_one_smoke_stays_under_absolute_cap():
    plan = provider_call_plan(live_smoke_required=True, smoke_reason="hypothetical")
    assert plan["combinedExpectedCalls"] == 18 == ABSOLUTE_HARD_CAP
    assert plan["status"] == "PASS"


def test_probe_never_targets_holdout():
    holdout = {f"case_{item}" for item in ("02", "04", "10", "14", "16", "17")}
    assert not set(PROBE_CASE_IDS) & holdout


# --------------------------------------------------------------------------
# End-to-end structural verification with a stub provider (0 provider calls).
# This is what replaces a live technical smoke.
# --------------------------------------------------------------------------

SOURCE_TEXT = "Programa de formación.\n\nUnidad 1: cartografía hidrológica introductoria y lectura de cartas."


class _StubProvider:
    """Deterministic offline stand-in. Never performs network I/O."""

    provider = "stub"
    model = "stub-model"
    reasoning_effort = "medium"

    def __init__(self) -> None:
        self.calls: list[str] = []

    def complete(self, *, prompt: str, schema_name: str, schema: dict[str, Any]) -> ProviderResult:
        self.calls.append(schema_name)
        payloads = {
            "b24_evidence_unit_catalog": {
                "evidenceUnits": [
                    {
                        "sourceId": "src_01",
                        "segmentId": "src_01-seg-2",
                        "quoteText": "cartografía hidrológica introductoria",
                        "normalizedProposition": "Contenido declarado de cartografía hidrológica introductoria.",
                        "claimType": "DECLARED_CONTENT",
                        "semanticQualifiers": [{"kind": "level", "value": "introductoria"}],
                    }
                ]
            },
            "b24_objective_analysis": {
                "decompositionStatus": "RESOLVED",
                "objectiveContext": "Contexto del puesto: equipo de campo.",
                "candidateSegments": [
                    {"text": "Contexto del puesto: equipo de campo.", "segmentRole": "OBJECTIVE_CONTEXT", "rationale": "contexto"},
                    {"text": REQUIREMENT_QUOTE, "segmentRole": "EVALUABLE_REQUIREMENT", "rationale": "criterio"},
                ],
                "ambiguityRationale": "",
                "requirements": [
                    {
                        "requirementQuote": REQUIREMENT_QUOTE,
                        "normalizedRequirement": "formación en cartografía hidrológica avanzada",
                        "epistemicTarget": "FORMATIVE_EVIDENCE",
                        "epistemicTargetRationale": "Pide formación.",
                        "atomicity": "ATOMIC",
                        "evaluability": {
                            "requiredEvidenceType": "FORMATIVE_EVIDENCE",
                            "formativeEvidenceCapable": True,
                            "rationale": "ok",
                        },
                        "qualifiers": [],
                    }
                ],
            },
            "b24_unified_reasoning": _reasoning(),
        }
        return ProviderResult(
            output=payloads[schema_name],
            provider="stub",
            requested_model="stub-model",
            effective_model="stub-model",
            latency_ms=1,
            usage={"input_tokens": 1, "output_tokens": 1},
        )


def test_structural_dry_run_end_to_end_without_provider_calls():
    case = FixtureCase(
        case_id="case_synthetic",
        split="dev",
        domain="Hidrología",
        objective=OBJECTIVE,
        sources=(
            SourceInput(
                source_id="src_01",
                credential_id="cred_01",
                evidence_type="TEXT_EVIDENCE",
                content=SOURCE_TEXT,
                coverage_status="FULL",
                source_provenance="ISSUER_DECLARED",
            ),
        ),
    )
    provider = _StubProvider()
    run = run_b24_case(case, provider, None)

    assert provider.calls == ["b24_evidence_unit_catalog", "b24_objective_analysis", "b24_unified_reasoning"]
    assert run["metadata"]["runStatus"] == "RESOLVED"
    for stage in (
        "01_source_extraction",
        "02_evidence_units",
        "03_objective_analysis",
        "04_evidence_preparation",
        "05_unified_contextual_reasoning",
        "06_validation_repair",
        "07_epistemic_policy",
        "08_final_result",
    ):
        assert stage in run

    policy = run["07_epistemic_policy"][0]
    assert policy["preGuardState"] in {"SUPPORTED", "PARTIALLY_SUPPORTED", "INSUFFICIENT_EVIDENCE", "NOT_ASSESSABLE", "ABSTAIN"}
    assert policy["inputs"]["epistemicTarget"] == "FORMATIVE_EVIDENCE"
    assert run["08_final_result"][0]["explanation"]
    assert run["08_final_result"][0]["weakerClaimSearch"]["status"] == "FOUND"

    # Persistence/serialization must round-trip exactly as the CLI writes it.
    serialized = json.dumps(run, ensure_ascii=False, indent=2)
    assert json.loads(serialized)["metadata"]["system"] == "B24_TARGET_V1_5"


def test_stub_dry_run_reaches_partial_through_constitutive_reduction():
    case = FixtureCase(
        case_id="case_synthetic",
        split="dev",
        domain="Hidrología",
        objective=OBJECTIVE,
        sources=(
            SourceInput(
                source_id="src_01",
                credential_id="cred_01",
                evidence_type="TEXT_EVIDENCE",
                content=SOURCE_TEXT,
                coverage_status="FULL",
                source_provenance="ISSUER_DECLARED",
            ),
        ),
    )
    run = run_b24_case(case, _StubProvider(), None)
    assert run["08_final_result"][0]["finalState"] == "PARTIALLY_SUPPORTED"


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__]))
