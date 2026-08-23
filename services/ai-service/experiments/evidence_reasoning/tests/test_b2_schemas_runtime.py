from __future__ import annotations

from typing import Any

from experiments.evidence_reasoning.b2_runtime import run_b2_case
from experiments.evidence_reasoning.b2_evaluation import evaluate_b2_payload
from experiments.evidence_reasoning.b2_schemas import B2_SCHEMAS, validate_b2_schema
from experiments.evidence_reasoning.fixtures import load_cases
from experiments.evidence_reasoning.models import ProviderResult
from experiments.evidence_reasoning.providers import StructuredProvider


class FakeB2Provider(StructuredProvider):
    reasoning_effort = "medium"

    def __init__(self, objective: str, source_text: str, source_id: str, segment_id: str) -> None:
        self.objective = objective
        self.source_text = source_text
        self.source_id = source_id
        self.segment_id = segment_id
        self.calls: list[str] = []

    def complete(self, *, prompt: str, schema_name: str, schema: dict[str, Any]) -> ProviderResult:
        del prompt, schema
        self.calls.append(schema_name)
        if schema_name == "b2_evidence_unit_catalog":
            output = {
                "evidenceUnits": [
                    {
                        "sourceId": self.source_id,
                        "segmentId": self.segment_id,
                        "quoteText": self.source_text,
                        "normalizedProposition": "Contenido formativo declarado.",
                        "claimType": "DECLARED_CONTENT",
                        "semanticQualifiers": [],
                    }
                ]
            }
        elif schema_name == "b2_objective_analysis":
            output = {
                "objectiveContext": "",
                "requirements": [
                    {
                        "requirementQuote": self.objective,
                        "normalizedRequirement": self.objective,
                        "evaluationRole": "PRIMARY",
                        "atomicity": "ATOMIC",
                        "evaluability": {
                            "requiredEvidenceType": "FORMATIVE_EVIDENCE",
                            "formativeEvidenceCapable": True,
                            "rationale": "formativo",
                        },
                        "materialQualifiers": [],
                    }
                ],
            }
        else:
            output = {
                "requirementId": "req_01",
                "evaluatedEvidence": [
                    {
                        "evidenceUnitId": "eu_01",
                        "relation": "DIRECT_SUPPORT",
                        "supportedQualifierIds": [],
                        "missingQualifierIds": [],
                        "evidenceContribution": "Cobertura declarada.",
                        "rationale": "Cita directa.",
                    }
                ],
                "facets": [],
                "compositionAssessment": {
                    "mode": "NONE",
                    "nonRedundantEvidenceUnitIds": ["eu_01"],
                    "jointlySupportsFullRequirement": True,
                    "integrationRequired": False,
                    "integrationDemonstrated": False,
                    "integrationEvidenceIds": [],
                    "missingFacetTexts": [],
                    "unresolved": False,
                    "rationale": "No requiere composición.",
                },
                "fullClaimAssessment": {
                    "status": "REACHED",
                    "supportedQualifierIds": [],
                    "missingQualifierIds": [],
                    "coveredFacetTexts": [],
                    "missingFacetTexts": [],
                    "rationale": "Cobertura completa.",
                },
                "jointClaimCeiling": {"text": "Contenido formativo declarado.", "supportingEvidenceUnitIds": ["eu_01"]},
                "weakerClaimCandidate": None,
                "observabilityAssessment": {"status": "SUFFICIENT", "rationale": "Fuente completa."},
                "semanticUnresolved": False,
                "unresolvedReason": "",
            }
        return ProviderResult(output, "fake", "fake-model", "fake-model", 1, {"input_tokens": 1, "output_tokens": 1})


class InvalidAndValidEvidenceProvider(FakeB2Provider):
    def complete(self, *, prompt: str, schema_name: str, schema: dict[str, Any]) -> ProviderResult:
        result = super().complete(prompt=prompt, schema_name=schema_name, schema=schema)
        if schema_name == "b2_evidence_unit_catalog":
            result.output["evidenceUnits"].insert(
                0,
                {
                    "sourceId": self.source_id,
                    "segmentId": self.segment_id,
                    "quoteText": "quote definitivamente inexistente",
                    "normalizedProposition": "Proposición inválida.",
                    "claimType": "DECLARED_CONTENT",
                    "semanticQualifiers": [],
                },
            )
        return result


def test_b2_schemas_exclude_authoritative_model_fields() -> None:
    eu_properties = B2_SCHEMAS["b2_evidence_unit_catalog"]["properties"]["evidenceUnits"]["items"]["properties"]
    for forbidden in {"evidenceUnitId", "credentialId", "sourceSha256", "charStart", "charEnd", "sourceProvenance"}:
        assert forbidden not in eu_properties
    requirement_properties = B2_SCHEMAS["b2_objective_analysis"]["properties"]["requirements"]["items"]["properties"]
    assert "requirementId" not in requirement_properties
    assert "sourceSpan" not in requirement_properties


def test_b2_runtime_executes_three_semantic_calls_and_serializes_artifacts() -> None:
    case = load_cases(case_ids={"case_01"})[0]
    provider = FakeB2Provider(case.objective, case.sources[0].content, "src_01_a", "src_01_a-seg-1")
    run = run_b2_case(case, provider)
    assert provider.calls == ["b2_evidence_unit_catalog", "b2_objective_analysis", "b2_unified_reasoning"]
    assert run["08_final_result"][0]["finalState"] == "SUPPORTED"
    assert run["02_evidence_units"]["catalog"][0]["sourceTrace"]["sourceId"] == "src_01_a"
    assert len(run["metadata"]["providerStages"]) == 3
    assert run["metadata"]["reasoningEffort"] == "medium"


def test_unified_schema_accepts_null_weaker_claim() -> None:
    case = load_cases(case_ids={"case_01"})[0]
    provider = FakeB2Provider(case.objective, case.sources[0].content, "src_01_a", "src_01_a-seg-1")
    output = provider.complete(prompt="", schema_name="b2_unified_reasoning", schema={}).output
    validate_b2_schema("b2_unified_reasoning", output)


def test_invalid_eu_is_discarded_without_global_abstention_when_valid_evidence_remains() -> None:
    case = load_cases(case_ids={"case_01"})[0]
    provider = InvalidAndValidEvidenceProvider(case.objective, case.sources[0].content, "src_01_a", "src_01_a-seg-1")
    run = run_b2_case(case, provider)
    assert len(run["02_evidence_units"]["catalog"]) == 1
    assert any(item["code"] == "FABRICATED_EVIDENCE" for item in run["06_validation_repair"])
    assert run["08_final_result"][0]["finalState"] == "SUPPORTED"


def test_complete_b2_run_is_evaluator_serializable() -> None:
    case = load_cases(case_ids={"case_01"})[0]
    provider = FakeB2Provider(case.objective, case.sources[0].content, "src_01_a", "src_01_a-seg-1")
    run = run_b2_case(case, provider)
    run["metadata"]["repetition"] = 1
    evaluated = evaluate_b2_payload({"runs": [run]})
    assert evaluated["mappedRuns"] == 1
    assert evaluated["runLevel"]["finalStateCorrect"] == 1
