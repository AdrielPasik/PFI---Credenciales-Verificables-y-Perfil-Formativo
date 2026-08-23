from __future__ import annotations

from experiments.evidence_reasoning.b2_artifacts import (
    build_evidence_units,
    build_objective_analysis,
    exact_redundancy_and_lineage,
)
from experiments.evidence_reasoning.b2_policy import b2_final_state
from experiments.evidence_reasoning.extraction import materialize_sources
from experiments.evidence_reasoning.models import FixtureCase, SourceInput


def _case() -> FixtureCase:
    return FixtureCase(
        "case_test",
        "dev",
        "test",
        "Requisito formativo: desarrollo con microcontroladores ARM.",
        (
            SourceInput("src_a", "cred_a", "TEXT", "Contenido con arquitectura AVR.", "FULL", "ISSUER_REVIEWED", lineage_id="lineage-x"),
            SourceInput("src_b", "cred_b", "TEXT", "Otra fuente con arquitectura ARM.", "FULL", "ISSUER_REVIEWED", lineage_id="lineage-x"),
        ),
    )


def test_wrong_source_and_fabricated_quotes_are_rejected() -> None:
    case = _case()
    snapshots = materialize_sources(case.sources)
    proposals = [
        {
            "sourceId": "src_a",
            "segmentId": "src_a-seg-1",
            "quoteText": "arquitectura ARM",
            "normalizedProposition": "ARM",
            "claimType": "DECLARED_CONTENT",
            "semanticQualifiers": [],
        },
        {
            "sourceId": "src_a",
            "segmentId": "src_a-seg-1",
            "quoteText": "evidencia inexistente",
            "normalizedProposition": "inventada",
            "claimType": "DECLARED_CONTENT",
            "semanticQualifiers": [],
        },
    ]
    accepted, validations = build_evidence_units(proposals, snapshots, {s.source_id: s.content for s in case.sources})
    assert accepted == []
    codes = {item["code"] for item in validations}
    assert "WRONG_SOURCE_ATTRIBUTION" in codes
    assert "FABRICATED_EVIDENCE" in codes


def test_quote_first_builder_assigns_authoritative_trace_and_id() -> None:
    case = _case()
    snapshots = materialize_sources(case.sources)
    proposal = {
        "sourceId": "src_a",
        "segmentId": "not-authoritative",
        "quoteText": "Contenido con arquitectura AVR.",
        "normalizedProposition": "Contenido declarado sobre AVR.",
        "claimType": "DECLARED_CONTENT",
        "semanticQualifiers": [{"kind": "TECHNOLOGY", "value": "AVR"}],
    }
    accepted, validations = build_evidence_units([proposal], snapshots, {s.source_id: s.content for s in case.sources})
    assert accepted[0]["evidenceUnitId"] == "eu_01"
    assert accepted[0]["sourceTrace"]["credentialId"] == "cred_a"
    assert accepted[0]["sourceTrace"]["exactExcerpt"] == case.sources[0].content
    assert accepted[0]["interpretationProvenance"] == "AI_INFERRED"
    assert any(item["code"] == "SEGMENT_DERIVED" for item in validations)


def test_requirement_and_qualifier_quotes_are_aligned_by_code() -> None:
    objective = "Requisito formativo: desarrollo con microcontroladores ARM."
    proposal = {
        "objectiveContext": "",
        "requirements": [
            {
                "requirementQuote": "desarrollo con microcontroladores ARM",
                "normalizedRequirement": "Desarrollo con microcontroladores ARM",
                "evaluationRole": "PRIMARY",
                "atomicity": "ATOMIC",
                "evaluability": {
                    "requiredEvidenceType": "FORMATIVE_EVIDENCE",
                    "formativeEvidenceCapable": True,
                    "rationale": "formativo",
                },
                "materialQualifiers": [
                    {
                        "kind": "TECHNOLOGY",
                        "value": "ARM",
                        "sourcePhrase": "ARM",
                        "materiality": "MATERIAL",
                        "rationale": "limita tecnología",
                    }
                ],
            }
        ],
    }
    analysis, validations = build_objective_analysis(proposal, objective)
    requirement = analysis["requirements"][0]
    assert requirement["traceValid"] is True
    assert requirement["materialQualifiers"][0]["traceValid"] is True
    assert all(item["affectsEpistemicState"] is False for item in validations)


def test_material_observability_gap_deterministically_abstains() -> None:
    requirement = {"evaluability": {"formativeEvidenceCapable": True}}
    reasoning = {
        "semanticUnresolved": False,
        "compositionAssessment": {"unresolved": False},
        "fullClaimAssessment": {"status": "NOT_REACHED"},
        "weakerClaimCandidate": None,
        "observabilityAssessment": {"status": "MATERIAL_GAP"},
    }
    state, inputs = b2_final_state(requirement, reasoning, hard_factual_failure=False)
    assert state == "ABSTAIN"
    assert inputs["unresolved"] is True


def test_repairable_trace_does_not_change_epistemic_state() -> None:
    requirement = {"evaluability": {"formativeEvidenceCapable": True}}
    reasoning = {
        "semanticUnresolved": False,
        "compositionAssessment": {"unresolved": False},
        "fullClaimAssessment": {"status": "NOT_REACHED"},
        "weakerClaimCandidate": {
            "sameRequirementContinuity": "YES",
            "materialUsefulness": "YES",
        },
        "observabilityAssessment": {"status": "SUFFICIENT"},
    }
    state, _ = b2_final_state(requirement, reasoning, hard_factual_failure=False)
    assert state == "PARTIALLY_SUPPORTED"


def test_known_lineage_groups_are_deterministic() -> None:
    evidence = [
        {"evidenceUnitId": "eu_01", "lineageId": "same", "sourceTrace": {"sourceSha256": "a", "charStart": 0, "charEnd": 1}},
        {"evidenceUnitId": "eu_02", "lineageId": "same", "sourceTrace": {"sourceSha256": "b", "charStart": 0, "charEnd": 1}},
    ]
    assert exact_redundancy_and_lineage(evidence) == [["eu_01", "eu_02"]]
