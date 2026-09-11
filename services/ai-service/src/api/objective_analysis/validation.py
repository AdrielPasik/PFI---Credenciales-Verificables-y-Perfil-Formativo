"""Validacion estructural y de anclaje del Objective Analysis productivo — F3.3B.

SIN REPARACION SEMANTICA. Se permite unicamente construccion determinista de lo
que codigo confiable siempre asigno —`qualifierId` y el registro de validaciones—,
igual que hacia `build_b24_objective_analysis`.

Nunca:

    epistemicTarget ausente     -> default
    token desconocido           -> el mas parecido
    qualifier malformado        -> descartarlo
    sourcePhrase no literal     -> normalizar hasta que entre

Cualquiera de esas cosas es `ProviderInvalidOutputError`: el proveedor respondio
entero y su salida no cumple el contrato. No se le vuelve a preguntar.

ANCLAJE DE QUALIFIERS, congelado por F3.3A:

    MATERIAL_QUALIFIER    subcadena exacta y contigua de requirementText
    STRUCTURAL_WRAPPER    subcadena exacta y contigua de requirementText
    CONTEXTUAL            subcadena exacta y contigua de requirementText
                          O de objectiveContext

Sin normalizar whitespace antes de comparar y sin matching difuso: normalizar
haria pasar frases que no estan.
"""

from __future__ import annotations

from typing import Any

from src.api.objective_analysis.contracts import (
    ARTIFACT_SCHEMA_VERSION,
    ATOMICITY_TOKENS,
    EPISTEMIC_TARGETS,
    QUALIFIER_ROLES,
    REQUIRED_EVIDENCE_TYPES,
    ProviderInvalidOutputError,
)

_MATERIAL = "MATERIAL_QUALIFIER"
_CONTEXTUAL = "CONTEXTUAL"


def _fail(code: str) -> None:
    """Falla con un codigo cerrado. NUNCA con contenido del Objective."""
    raise ProviderInvalidOutputError(code)


def _expect_object(value: Any, code: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        _fail(code)
    return value


def _expect_text(value: Any, code: str) -> str:
    if not isinstance(value, str) or not value.strip():
        _fail(code)
    return value


def _expect_enum(value: Any, allowed: tuple[str, ...], code: str) -> str:
    if not isinstance(value, str) or value not in allowed:
        _fail(code)
    return value


def _expect_exact_keys(value: dict[str, Any], allowed: set[str], code: str) -> None:
    if set(value.keys()) != allowed:
        _fail(code)


_QUALIFIER_KEYS = {"kind", "value", "sourcePhrase", "role", "rationale"}
_EVALUABILITY_KEYS = {"requiredEvidenceType", "formativeEvidenceCapable", "rationale"}
_REQUIREMENT_KEYS = {
    "requirementId",
    "epistemicTarget",
    "epistemicTargetRationale",
    "atomicity",
    "evaluability",
    "qualifiers",
    "normalizedRequirement",
}


def _build_qualifier(
    raw: Any,
    *,
    requirement_text: str,
    objective_context: str,
    counter: list[int],
) -> dict[str, Any]:
    value = _expect_object(raw, "qualifier_not_an_object")
    _expect_exact_keys(value, _QUALIFIER_KEYS, "qualifier_unexpected_keys")

    role = _expect_enum(value["role"], QUALIFIER_ROLES, "qualifier_role_invalid")
    source_phrase = _expect_text(value["sourcePhrase"], "qualifier_source_phrase_empty")

    # Contencion LITERAL, sin normalizar. Un `sourcePhrase` inventado no debe ser
    # persistible, y esa garantia no puede depender de que el prompt lo pida.
    in_requirement = source_phrase in requirement_text
    in_context = bool(objective_context) and source_phrase in objective_context

    if role == _CONTEXTUAL:
        if not in_requirement and not in_context:
            _fail("qualifier_anchor_not_literal")
    else:
        if not in_requirement:
            # Incluye el caso que F3.3A congelo explicitamente: una frase que solo
            # aparece en objectiveContext NO puede ser MATERIAL_QUALIFIER.
            _fail("qualifier_anchor_not_in_requirement_text")

    # `qualifierId` lo asigna codigo confiable, no el modelo, y solo para los
    # materiales: es lo que hace que `supportedQualifierIds` del resultado siempre
    # referencie algo material.
    qualifier_id: str | None = None
    if role == _MATERIAL:
        counter[0] += 1
        qualifier_id = f"q_{counter[0]:02d}"

    return {
        "qualifierId": qualifier_id,
        "kind": _expect_text(value["kind"], "qualifier_kind_empty"),
        "value": _expect_text(value["value"], "qualifier_value_empty"),
        "sourcePhrase": source_phrase,
        "role": role,
        "rationale": _expect_text(value["rationale"], "qualifier_rationale_empty"),
    }


def _build_requirement(
    raw: Any,
    *,
    requirement_text: str,
    objective_context: str,
) -> dict[str, Any]:
    value = _expect_object(raw, "requirement_not_an_object")
    _expect_exact_keys(value, _REQUIREMENT_KEYS, "requirement_unexpected_keys")

    evaluability = _expect_object(value["evaluability"], "evaluability_not_an_object")
    _expect_exact_keys(evaluability, _EVALUABILITY_KEYS, "evaluability_unexpected_keys")
    if not isinstance(evaluability["formativeEvidenceCapable"], bool):
        _fail("evaluability_capability_not_boolean")

    qualifiers_raw = value["qualifiers"]
    if not isinstance(qualifiers_raw, list):
        _fail("qualifiers_not_a_list")

    counter = [0]
    qualifiers = [
        _build_qualifier(
            item,
            requirement_text=requirement_text,
            objective_context=objective_context,
            counter=counter,
        )
        for item in qualifiers_raw
    ]

    return {
        "requirementId": value["requirementId"],
        "epistemicTarget": _expect_enum(
            value["epistemicTarget"], EPISTEMIC_TARGETS, "epistemic_target_invalid"
        ),
        "epistemicTargetRationale": _expect_text(
            value["epistemicTargetRationale"], "epistemic_target_rationale_empty"
        ),
        "atomicity": _expect_enum(
            value["atomicity"], ATOMICITY_TOKENS, "atomicity_invalid"
        ),
        "evaluability": {
            "requiredEvidenceType": _expect_enum(
                evaluability["requiredEvidenceType"],
                REQUIRED_EVIDENCE_TYPES,
                "required_evidence_type_invalid",
            ),
            "formativeEvidenceCapable": evaluability["formativeEvidenceCapable"],
            "rationale": _expect_text(
                evaluability["rationale"], "evaluability_rationale_empty"
            ),
        },
        "qualifiers": qualifiers,
        "normalizedRequirement": _expect_text(
            value["normalizedRequirement"], "normalized_requirement_empty"
        ),
        # El registro de validaciones de ESTA etapa. Misma forma que `validation()`
        # del codigo congelado. `detail` lleva el id, nunca texto del Objective.
        "validations": [
            {
                "taxonomy": "SEMANTIC_CONSISTENCY",
                "code": "EPISTEMIC_TARGET_CLASSIFICATION",
                "status": "MANUAL_ADJUDICATION_REQUIRED",
                "artifactRef": value["requirementId"],
                "detail": value["epistemicTarget"],
                "affectsEpistemicState": False,
            }
        ],
    }


def build_objective_analysis_artifact(
    provider_output: Any,
    *,
    objective_context: str,
    requirements: list[dict[str, Any]],
) -> dict[str, Any]:
    """Valida la salida del proveedor y construye `objective_analysis_v1`.

    EL CONJUNTO DE REQUIREMENTS ES AUTORIDAD DEL SNAPSHOT. Se exige igualdad
    exacta de conjunto Y de orden contra los Requirements confirmados: ni falta
    ninguno, ni sobra ninguno, ni se repite, ni se reordena. Si el modelo obedeciera
    una instruccion inyectada y agregara uno, muere aca — y si igual pasara,
    TypeScript lo vuelve a comprobar contra el snapshot persistido.
    """
    root = _expect_object(provider_output, "provider_output_not_an_object")
    _expect_exact_keys(root, {"requirements"}, "provider_output_unexpected_keys")

    analysed = root["requirements"]
    if not isinstance(analysed, list):
        _fail("provider_requirements_not_a_list")

    expected_ids = [item["requirementId"] for item in requirements]
    text_by_id = {item["requirementId"]: item["requirementText"] for item in requirements}

    if len(analysed) != len(expected_ids):
        _fail("requirement_count_mismatch")

    built: list[dict[str, Any]] = []
    for index, item in enumerate(analysed):
        value = _expect_object(item, "requirement_not_an_object")
        requirement_id = value.get("requirementId")
        # Igualdad POSICIONAL: cubre de una sola vez faltante, sobrante,
        # duplicado y reordenado.
        if requirement_id != expected_ids[index]:
            _fail("requirement_identity_or_order_mismatch")
        built.append(
            _build_requirement(
                value,
                requirement_text=text_by_id[requirement_id],
                objective_context=objective_context,
            )
        )

    return {"schemaVersion": ARTIFACT_SCHEMA_VERSION, "requirements": built}
