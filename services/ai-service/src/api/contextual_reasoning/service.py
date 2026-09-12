"""Orquestación del razonamiento contextual — slice F3.5.

UNA llamada por Requirement. Este servicio ejecuta EXACTAMENTE UNA: recibe un
Requirement confirmado con su análisis y el catálogo COMPLETO de EvidenceUnits,
y devuelve el razonamiento contextual de ese Requirement.

    NestJS recorre los Requirements en orden del snapshot y llama N veces,
    cortando en el primero que falla. El agregado lo arma código confiable de
    NestJS, no el proveedor.

Por eso acá no hay bucle ni array global: el proveedor nunca produce
directamente el conjunto de todos los Requirements.

Orden causal, y el orden ES la regla:

    guard del plan de ejecución    ANTES de tocar al proveedor
        v
    verificación del material      ANTES de tocar al proveedor
        v
    una llamada, un Requirement, catálogo completo
        v
    validación estructural y de referencias
        v
    guard del modelo efectivo
        v
    envelope

CATÁLOGO COMPLETO, SIN RECUPERACIÓN. Todas las EvidenceUnits aceptadas viajan en
cada llamada, como en el candidato aceptado. Sin embeddings, sin top-k, sin
filtro por relevancia: omitir una unidad porque parece irrelevante cambiaría el
universo observado, y eso es otra evaluación, no la misma más barata.
"""

from __future__ import annotations

from typing import Any

from src.api.contextual_reasoning.contracts import (
    CONTEXTUAL_RESULT_SCHEMA_VERSION,
    PRODUCT_ADAPTER_VERSION,
    PRODUCT_PROMPT_VERSION,
    RESPONSE_SCHEMA_VERSION,
    STAGE_ARTIFACT_SCHEMA_VERSION,
    SUPPORTED_PROVIDER,
    SUPPORTED_REASONING_EFFORT,
    ExecutionPlanMismatchError,
    ProviderInvalidOutputError,
    ReasoningInputError,
    StageExecutionPlan,
)
from src.api.contextual_reasoning.prompt import build_contextual_reasoning_prompt
from src.api.contextual_reasoning.requirement_anchoring import (
    indexed_requirement_view,
    tokenize_requirement,
)
from src.api.contextual_reasoning.provider import (
    OpenAIContextualReasoningProvider,
    configured_model,
)
from src.api.contextual_reasoning.schema import (
    CONTEXTUAL_REASONING_OUTPUT_SCHEMA,
    CONTEXTUAL_REASONING_SCHEMA_NAME,
)
from src.api.contextual_reasoning.validation import validate_contextual_result

EFFECTIVE_MODEL_MATCH = "MATCH"
EFFECTIVE_MODEL_UNAVAILABLE = "UNAVAILABLE"

#: El orden de resolución que el prompt impone. Se materializa acá SOLO como dato
#: del contexto, para que el modelo lo tenga delante junto al material.
AUTHORITY_ORDER = (
    "requirementText",
    "explicitQualifiers",
    "objectiveContext",
    "normalizedRequirement",
)


def assert_plan_matches_local_configuration(plan: StageExecutionPlan) -> None:
    """Falla cerrado si el plan congelado no describe lo que esta etapa hará.

    `artifactSchemaVersion` se compara contra `reasoning_run_result_v1` porque eso
    es lo que el plan congelado dice para `contextualReasoning`: el artifact de
    ESTA etapa, contando su mitad determinista de F3.6. El contrato transitorio
    tiene su propia versión y no reemplaza esa identidad.

    El error NUNCA lleva valores de configuración.
    """
    if plan.artifactSchemaVersion != STAGE_ARTIFACT_SCHEMA_VERSION:
        raise ExecutionPlanMismatchError("artifact_schema_version_mismatch")
    if plan.promptVersion != PRODUCT_PROMPT_VERSION:
        raise ExecutionPlanMismatchError("prompt_version_mismatch")
    if plan.adapterVersion != PRODUCT_ADAPTER_VERSION:
        raise ExecutionPlanMismatchError("adapter_version_mismatch")
    if plan.provider != SUPPORTED_PROVIDER:
        raise ExecutionPlanMismatchError("provider_mismatch")
    if plan.reasoningEffort != SUPPORTED_REASONING_EFFORT:
        raise ExecutionPlanMismatchError("reasoning_effort_mismatch")
    if plan.model != configured_model():
        raise ExecutionPlanMismatchError("model_mismatch")


def _verify_reported_model(plan: StageExecutionPlan, reported: str | None) -> str:
    """Igualdad EXACTA. Sin alias, sin recorte de sufijo, sin familia."""
    if reported is None:
        return EFFECTIVE_MODEL_UNAVAILABLE
    if reported != plan.model:
        raise ExecutionPlanMismatchError("effective_model_mismatch")
    return EFFECTIVE_MODEL_MATCH


_REQUIREMENT_KEYS = {
    "requirementId",
    "requirementText",
    "epistemicTarget",
    "atomicity",
    "evaluability",
    "qualifiers",
    "normalizedRequirement",
}


def assert_reasoning_input_usable(
    requirement: dict[str, Any],
    evidence_units: list[dict[str, Any]],
    sources: list[dict[str, Any]],
) -> None:
    """Verifica el material ANTES de la llamada.

    Estructural, no semántica: NestJS ya verificó los dos artifacts previos contra
    sus autoridades persistidas. Acá se comprueba que lo que llegó tenga la forma
    que el razonamiento necesita, porque razonar sobre un Requirement sin
    `evaluability` o sobre unidades sin id produciría referencias irresolubles.
    """
    if not isinstance(requirement, dict) or not _REQUIREMENT_KEYS.issubset(requirement):
        raise ReasoningInputError("reasoning_requirement_shape_invalid")
    if not isinstance(requirement["requirementText"], str) or not requirement["requirementText"].strip():
        raise ReasoningInputError("reasoning_requirement_text_invalid")
    if "formativeEvidenceCapable" not in (requirement["evaluability"] or {}):
        raise ReasoningInputError("reasoning_requirement_evaluability_invalid")

    seen: set[str] = set()
    for unit in evidence_units:
        unit_id = unit.get("evidenceUnitId")
        if not isinstance(unit_id, str) or not unit_id:
            raise ReasoningInputError("reasoning_evidence_unit_id_invalid")
        if unit_id in seen:
            raise ReasoningInputError("reasoning_evidence_unit_id_duplicated")
        seen.add(unit_id)
        if unit.get("sourceId") not in {item["sourceId"] for item in sources}:
            raise ReasoningInputError("reasoning_evidence_unit_source_unknown")


def _build_context(
    requirement: dict[str, Any],
    objective_context: str,
    evidence_units: list[dict[str, Any]],
    preparation: dict[str, Any],
    sources: list[dict[str, Any]],
) -> dict[str, Any]:
    """Proyecta el material al contexto que el prompt congelado espera.

    `epistemicTargetIsReadOnly` viaja explícito: llega congelado desde Objective
    Analysis y el reasoner no puede reescribirlo.

    `sourceContext` lleva la PROVENANCE PROYECTADA por fuente. El producto la
    guarda una sola vez en `evidence_units_v1.sources[]`; acá se proyecta al
    material que el reasoner ve, exactamente como hacía el builder congelado. El
    proveedor no la elige ni la puede fortalecer: nunca aumenta soporte.
    """
    return {
        "objectiveContext": objective_context,
        "requirement": requirement,
        # P2.4: el Requirement segmentado y numerado. Es la MISMA tokenizacion
        # que usa el validador, asi que los indices que elija el modelo son los
        # que el servidor va a recortar.
        "requirementTokens": indexed_requirement_view(
            tokenize_requirement(requirement["requirementText"])
        ),
        "authorityOrder": list(AUTHORITY_ORDER),
        "epistemicTarget": requirement["epistemicTarget"],
        "epistemicTargetIsReadOnly": True,
        "evidenceUnits": evidence_units,
        "evidencePreparation": preparation,
        "sourceContext": sources,
    }


def run_contextual_reasoning(
    *,
    plan: StageExecutionPlan,
    requirement: dict[str, Any],
    objective_context: str,
    evidence_units: list[dict[str, Any]],
    preparation: dict[str, Any],
    sources: list[dict[str, Any]],
    provider: Any | None = None,
) -> dict[str, Any]:
    """Ejecuta el razonamiento contextual de UN Requirement."""
    assert_plan_matches_local_configuration(plan)
    assert_reasoning_input_usable(requirement, evidence_units, sources)

    client = provider if provider is not None else OpenAIContextualReasoningProvider()

    observation = client.complete(
        prompt=build_contextual_reasoning_prompt(
            _build_context(requirement, objective_context, evidence_units, preparation, sources)
        ),
        schema_name=CONTEXTUAL_REASONING_SCHEMA_NAME,
        schema=CONTEXTUAL_REASONING_OUTPUT_SCHEMA,
        plan=plan,
    )

    if not isinstance(observation.output, dict):
        raise ProviderInvalidOutputError("provider_output_not_an_object")
    if set(observation.output) != set(CONTEXTUAL_REASONING_OUTPUT_SCHEMA["required"]):
        raise ProviderInvalidOutputError("provider_output_unexpected_keys")

    result, validations = validate_contextual_result(
        observation.output,
        analysis_requirement=requirement,
        evidence_unit_ids={item["evidenceUnitId"] for item in evidence_units},
        source_ids={item["sourceId"] for item in sources},
    )

    verification = _verify_reported_model(plan, observation.reported_model)

    execution: dict[str, Any] = {
        "artifactSchemaVersion": STAGE_ARTIFACT_SCHEMA_VERSION,
        "contextualResultSchemaVersion": CONTEXTUAL_RESULT_SCHEMA_VERSION,
        "promptVersion": PRODUCT_PROMPT_VERSION,
        "adapterVersion": PRODUCT_ADAPTER_VERSION,
        "provider": SUPPORTED_PROVIDER,
        "requestedModel": plan.model,
        "reasoningEffort": SUPPORTED_REASONING_EFFORT,
        "effectiveModelVerification": verification,
    }
    if observation.reported_model is not None:
        execution["reportedEffectiveModel"] = observation.reported_model

    # Sin respuesta cruda, sin prompt, sin tokens, sin razonamiento interno.
    return {
        "schemaVersion": RESPONSE_SCHEMA_VERSION,
        "execution": execution,
        "contextualResult": result,
        "validations": validations,
    }
