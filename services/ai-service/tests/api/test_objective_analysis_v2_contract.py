"""Conformance determinista del contrato semántico de Objective Analysis V2.

No prueba ni simula razonamiento del proveedor. Fija la instrucción que recibe y
demuestra que cada salida normativa ya cabe en el schema productivo sin ampliar
el request, artifact ni adapter. El proveedor es un doble local: cero red.
"""

from __future__ import annotations

from typing import Any

import pytest

from src.api.objective_analysis import contracts, provider as provider_module
from src.api.objective_analysis.contracts import (
    ExecutionPlanMismatchError,
    ProviderObservation,
    StageExecutionPlan,
)
from src.api.objective_analysis.prompt import build_objective_analysis_prompt
from src.api.objective_analysis.service import run_objective_analysis


MODEL = "gpt-5.6-terra"


class FakeProvider:
    """Doble inyectado; hace visible que esta suite no llama al proveedor real."""

    def __init__(self, output: dict[str, Any]) -> None:
        self.calls = 0
        self.output = output

    def complete(self, **_: Any) -> ProviderObservation:
        self.calls += 1
        return ProviderObservation(output=self.output, reported_model=MODEL)


def plan(**overrides: Any) -> StageExecutionPlan:
    values = {
        "artifactSchemaVersion": contracts.ARTIFACT_SCHEMA_VERSION,
        "promptVersion": contracts.PRODUCT_PROMPT_VERSION,
        "adapterVersion": contracts.PRODUCT_ADAPTER_VERSION,
        "provider": contracts.SUPPORTED_PROVIDER,
        "model": MODEL,
        "reasoningEffort": contracts.SUPPORTED_REASONING_EFFORT,
    }
    values.update(overrides)
    return StageExecutionPlan(**values)


def output_for(
    requirement_id: str,
    *,
    epistemic_target: str,
    required_evidence_type: str,
    formative_evidence_capable: bool,
) -> dict[str, Any]:
    return {
        "requirements": [
            {
                "requirementId": requirement_id,
                "epistemicTarget": epistemic_target,
                "epistemicTargetRationale": "Clasificación contractual V2.",
                "atomicity": "ATOMIC",
                "evaluability": {
                    "requiredEvidenceType": required_evidence_type,
                    "formativeEvidenceCapable": formative_evidence_capable,
                    "rationale": "Evaluabilidad contractual V2.",
                },
                "qualifiers": [],
                "normalizedRequirement": "Requirement confirmado.",
            }
        ]
    }


@pytest.fixture(autouse=True)
def configured_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(provider_module.ENV_MODEL, MODEL)


def test_v2_prompt_defines_capability_as_evaluability_not_sufficiency() -> None:
    prompt = build_objective_analysis_prompt(
        objective_type="EMPLOYMENT",
        objective_context="",
        requirements=[{"requirementId": "req_01", "requirementText": "Kubernetes"}],
    )

    for expected in (
        "GATE DE EVALUABILIDAD",
        "RELEVANCIA NO ES SUFICIENCIA",
        "Diseño e implementación de APIs REST",
        "Kubernetes",
        "historia profesional",
        "Certificación AWS Solutions Architect",
        "Nivel B2 de inglés",
    ):
        assert expected in prompt
    assert "PROMPT_VERSION=product_objective_analysis_v2" in prompt


@pytest.mark.parametrize(
    ("requirement_text", "epistemic_target", "required_evidence_type", "capable"),
    [
        ("Diseño e implementación de APIs REST", "FORMATIVE_EVIDENCE", "FORMATIVE_EVIDENCE", True),
        ("Conocimientos de Python", "FORMATIVE_EVIDENCE", "FORMATIVE_EVIDENCE", True),
        ("Programación en Java", "FORMATIVE_EVIDENCE", "FORMATIVE_EVIDENCE", True),
        ("Kubernetes", "UNRESOLVED", "UNRESOLVED", True),
        (
            "Contar con al menos 3 años de experiencia profesional en un rol equivalente.",
            "INDIVIDUAL_ACHIEVEMENT",
            "PROFESSIONAL_HISTORY",
            False,
        ),
        (
            "Autorización legal para trabajar en Estados Unidos",
            "UNRESOLVED",
            "PERSONAL_OR_ADMINISTRATIVE_FACT",
            False,
        ),
        ("Disponibilidad para viajar", "UNRESOLVED", "PERSONAL_OR_ADMINISTRATIVE_FACT", False),
        ("Licencia de conducir vigente", "UNRESOLVED", "PERSONAL_OR_ADMINISTRATIVE_FACT", False),
        (
            "Certificación AWS Solutions Architect",
            "INDIVIDUAL_ACHIEVEMENT",
            "FORMATIVE_EVIDENCE",
            True,
        ),
        (
            "Licenciatura en Ingeniería Informática",
            "INDIVIDUAL_ACHIEVEMENT",
            "FORMATIVE_EVIDENCE",
            True,
        ),
        ("Nivel B2 de inglés", "INDIVIDUAL_ACHIEVEMENT", "FORMATIVE_EVIDENCE", True),
        (
            "3 años de experiencia desarrollando APIs REST",
            "INDIVIDUAL_ACHIEVEMENT",
            "PROFESSIONAL_HISTORY",
            False,
        ),
    ],
)
def test_v2_contract_outputs_are_expressible_without_schema_expansion(
    requirement_text: str,
    epistemic_target: str,
    required_evidence_type: str,
    capable: bool,
) -> None:
    requirement = {"requirementId": "req_01", "requirementText": requirement_text}
    fake = FakeProvider(
        output_for(
            "req_01",
            epistemic_target=epistemic_target,
            required_evidence_type=required_evidence_type,
            formative_evidence_capable=capable,
        )
    )

    response = run_objective_analysis(
        plan=plan(),
        objective_type="EMPLOYMENT",
        objective_context="",
        requirements=[requirement],
        provider=fake,
    )

    actual = response["artifact"]["requirements"][0]
    assert fake.calls == 1
    assert actual["epistemicTarget"] == epistemic_target
    assert actual["evaluability"] == {
        "requiredEvidenceType": required_evidence_type,
        "formativeEvidenceCapable": capable,
        "rationale": "Evaluabilidad contractual V2.",
    }


def test_historical_v1_plan_fails_closed_without_provider_call() -> None:
    fake = FakeProvider(output_for(
        "req_01",
        epistemic_target="FORMATIVE_EVIDENCE",
        required_evidence_type="FORMATIVE_EVIDENCE",
        formative_evidence_capable=True,
    ))

    with pytest.raises(ExecutionPlanMismatchError) as exc:
        run_objective_analysis(
            plan=plan(promptVersion="product_objective_analysis_v1"),
            objective_type="EMPLOYMENT",
            objective_context="",
            requirements=[{"requirementId": "req_01", "requirementText": "APIs REST"}],
            provider=fake,
        )

    assert str(exc.value) == "prompt_version_mismatch"
    assert fake.calls == 0
    assert contracts.PRODUCT_ADAPTER_VERSION == "product_objective_analysis_adapter_v1"
