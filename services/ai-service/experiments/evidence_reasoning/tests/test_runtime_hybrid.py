from __future__ import annotations

from typing import Any

from experiments.evidence_reasoning.fixtures import load_cases
from experiments.evidence_reasoning.models import ProviderResult
from experiments.evidence_reasoning.providers import StructuredProvider
from experiments.evidence_reasoning.runtime import run_b1b_case


class QueueProvider(StructuredProvider):
    def __init__(self, outputs: list[dict[str, Any]]) -> None:
        self.outputs = iter(outputs)

    def complete(self, *, prompt: str, schema_name: str, schema: dict[str, Any]) -> ProviderResult:
        del prompt, schema_name, schema
        return ProviderResult(next(self.outputs), "test", "test-model", "test-model", 1, {})


def test_hybrid_keeps_limited_scope_separate_and_returns_partial() -> None:
    case = next(item for item in load_cases(case_ids={"case_17"}))
    source_text = case.sources[0].content
    requirement_text = "administración avanzada de clusters Kubernetes"
    requirement_start = case.objective.index(requirement_text)
    qualifier_text = "avanzada"
    qualifier_start = case.objective.index(qualifier_text)
    provider = QueueProvider([
        {"evidenceUnits": [{
            "evidenceUnitId": "eu-17", "sourceId": "src_17_a", "charStart": 0,
            "charEnd": len(source_text), "exactExcerpt": source_text,
            "normalizedProposition": "La credencial introduce pods, deployments y services de Kubernetes.",
            "claimType": "DECLARED_CONTENT", "qualifiersPresent": ["introductorio"],
        }]},
        {"originalObjective": case.objective, "requirements": [{
            "requirementId": "r-17",
            "sourceSpan": {"charStart": requirement_start, "charEnd": requirement_start + len(requirement_text), "exactText": requirement_text},
            "normalizedRequirement": "Administración avanzada de clusters Kubernetes",
            "atomicity": "ATOMIC",
            "evaluability": {"requiredEvidenceType": "FORMATIVE_EVIDENCE", "formativeEvidenceCapable": True, "rationale": "Es un criterio formativo."},
            "qualifiers": [{"kind": "DEPTH", "value": "avanzada", "sourceSpan": {"charStart": qualifier_start, "charEnd": qualifier_start + len(qualifier_text), "exactText": qualifier_text}}],
            "compositionRequired": False,
        }]},
        {"requirements": [{"requirementId": "r-17", "facets": []}]},
        {"relations": [{
            "requirementId": "r-17", "evidenceUnitId": "eu-17", "facetIds": [], "relation": "LIMITED_SCOPE",
            "supportedQualifiers": [], "unsupportedOrMissingQualifiers": ["avanzada"],
            "individualClaimCeiling": "Formación introductoria en Kubernetes.",
            "rationale": "Mismo objeto con profundidad inferior.", "unresolved": False,
        }]},
        {"requirements": [{
            "requirementId": "r-17", "claimCeiling": "Formación introductoria en Kubernetes.",
            "supportingEvidenceUnitIds": ["eu-17"], "supportedQualifiers": [], "missingQualifiers": ["avanzada"],
            "coveredFacetIds": [], "missingFacetIds": [], "redundancyGroups": [], "bridgeEvidenceUnitIds": [],
            "reachesFullRequirement": False, "hasMateriallyUsefulWeakerClaim": True,
            "weakerClaimStillBelongsToRequirement": True, "unresolved": False,
            "semanticRationale": "Existe un claim introductorio útil; la verificación técnica no cambia su alcance.",
        }]},
    ])
    result = run_b1b_case(case, provider)
    assert result["04_relations"]["relations"][0]["relation"] == "LIMITED_SCOPE"
    assert result["08_final_result"][0]["finalState"] == "PARTIALLY_SUPPORTED"
    assert len(result["metadata"]["providerStages"]) == 5
    assert all(item["status"] == "PASS" for item in result["07_guard_results"])

