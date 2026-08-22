from __future__ import annotations

import pytest

from experiments.evidence_reasoning.extraction import extract_text_source
from experiments.evidence_reasoning.guards import (
    exact_redundancy_groups,
    validate_and_enrich_evidence_units,
    validate_requirement_result,
)
from experiments.evidence_reasoning.models import SourceInput
from experiments.evidence_reasoning.schemas import validate_schema


def _snapshot(lineage: str | None = None) -> dict:
    return extract_text_source(
        SourceInput(
            "source-1", "credential-1", "TEXT_EVIDENCE", "Introducción a Kubernetes.", "FULL",
            "INSTITUTIONALLY_DECLARED", lineage_id=lineage,
        )
    )


def _proposal(source_id: str = "source-1", excerpt: str = "Introducción a Kubernetes.") -> dict:
    return {
        "evidenceUnitId": "eu-1",
        "sourceId": source_id,
        "charStart": 0,
        "charEnd": len(excerpt),
        "exactExcerpt": excerpt,
        "normalizedProposition": "La formación introduce Kubernetes.",
        "claimType": "DECLARED_CONTENT",
        "qualifiersPresent": ["introductorio"],
    }


def test_eu_survives_only_with_exact_alignment_and_authoritative_provenance() -> None:
    accepted, guards = validate_and_enrich_evidence_units([_proposal()], [_snapshot()])
    assert len(accepted) == 1
    assert accepted[0]["sourceProvenance"] == "INSTITUTIONALLY_DECLARED"
    assert accepted[0]["interpretationProvenance"] == "AI_INFERRED"
    assert all(item["status"] == "PASS" for item in guards)


def test_invalid_source_or_excerpt_is_rejected() -> None:
    invalid_source, source_guards = validate_and_enrich_evidence_units([_proposal(source_id="invented")], [_snapshot()])
    invalid_excerpt, excerpt_guards = validate_and_enrich_evidence_units([_proposal(excerpt="texto inventado")], [_snapshot()])
    assert invalid_source == []
    assert invalid_excerpt == []
    assert any(item["guard"] == "eu_source_exists" and item["status"] == "FAIL" for item in source_guards)
    assert any(item["guard"] == "excerpt_offsets_align" and item["status"] == "FAIL" for item in excerpt_guards)


def test_known_lineage_creates_exact_redundancy_group() -> None:
    first, _ = validate_and_enrich_evidence_units([_proposal()], [_snapshot("same-template")])
    second_proposal = {**_proposal(), "evidenceUnitId": "eu-2"}
    second, _ = validate_and_enrich_evidence_units([second_proposal], [_snapshot("same-template")])
    assert exact_redundancy_groups([*first, *second]) == [["eu-1", "eu-2"]]


def test_schema_rejects_unknown_relation() -> None:
    payload = {
        "relations": [{
            "requirementId": "r1", "evidenceUnitId": "eu1", "facetIds": [], "relation": "SIMILAR",
            "supportedQualifiers": [], "unsupportedOrMissingQualifiers": [], "individualClaimCeiling": "",
            "rationale": "", "unresolved": False,
        }]
    }
    with pytest.raises(ValueError, match="invalid_relations_schema"):
        validate_schema("relations", payload)


def test_known_lineage_must_be_declared_by_composition() -> None:
    evidence_units = {
        "eu-1": {"sourceTrace": {"sourceId": "source-1"}, "technicallyVerified": False},
        "eu-2": {"sourceTrace": {"sourceId": "source-2"}, "technicallyVerified": False},
    }
    ceiling = {
        "supportingEvidenceUnitIds": ["eu-1", "eu-2"], "reachesFullRequirement": False,
        "hasMateriallyUsefulWeakerClaim": True, "coveredFacetIds": [], "supportedQualifiers": [],
        "bridgeEvidenceUnitIds": [], "redundancyGroups": [], "claimCeiling": "Formación introductoria.",
        "semanticRationale": "La evidencia conserva alcance introductorio.",
    }
    guards = validate_requirement_result(
        {"requirementId": "r1"}, ceiling, [], [], evidence_units,
        [{"source": {"sourceId": "source-1"}, "coverageStatus": "FULL"}, {"source": {"sourceId": "source-2"}, "coverageStatus": "FULL"}],
        [["eu-1", "eu-2"]],
    )
    assert any(
        item["guard"] == "known_lineage_not_counted_independently" and item["status"] == "FAIL"
        for item in guards
    )
