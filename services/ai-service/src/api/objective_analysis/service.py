"""Orquestacion del Objective Analysis productivo — slice F3.3B.

Orden causal, y el orden ES la regla:

    guard del plan de ejecucion   (ANTES de tocar al proveedor)
        v
    una sola llamada logica al proveedor, con todos los Requirements
        v
    validacion estructural y de anclaje
        v
    guard del modelo efectivo informado
        v
    envelope de respuesta

Si el guard del plan falla, `provider calls = 0`. NestJS es dueno del plan
congelado del ReasoningRun; este servicio es dueno de la implementacion. Ninguno
confia en el otro por convencion: los dos comparan.
"""

from __future__ import annotations

from typing import Any

from src.api.objective_analysis.contracts import (
    ARTIFACT_SCHEMA_VERSION,
    PRODUCT_ADAPTER_VERSION,
    PRODUCT_PROMPT_VERSION,
    RESPONSE_SCHEMA_VERSION,
    SUPPORTED_PROVIDER,
    SUPPORTED_REASONING_EFFORT,
    ExecutionPlanMismatchError,
    StageExecutionPlan,
)
from src.api.objective_analysis.prompt import build_objective_analysis_prompt
from src.api.objective_analysis.provider import (
    OpenAIObjectiveAnalysisProvider,
    configured_model,
)
from src.api.objective_analysis.schema import (
    OBJECTIVE_ANALYSIS_OUTPUT_SCHEMA,
    OBJECTIVE_ANALYSIS_SCHEMA_NAME,
)
from src.api.objective_analysis.validation import build_objective_analysis_artifact

EFFECTIVE_MODEL_MATCH = "MATCH"
EFFECTIVE_MODEL_UNAVAILABLE = "UNAVAILABLE"


def assert_plan_matches_local_configuration(plan: StageExecutionPlan) -> None:
    """Falla cerrado si el plan congelado no describe lo que este servicio hara.

    Se comprueba TODA la configuracion semantica, no solo el modelo: un plan que
    prometa otro prompt o otro adapter describe una ejecucion distinta aunque el
    modelo coincida.

    El error NUNCA lleva valores. Decir "esperaba X, encontre Y" meteria
    configuracion de despliegue en un log.
    """
    if plan.artifactSchemaVersion != ARTIFACT_SCHEMA_VERSION:
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
    """Igualdad EXACTA de string, sin alias ni canonicalizacion.

    No se implementa `startsWith`, ni recorte de sufijo de fecha, ni comparacion
    por familia: ninguna de esas heuristicas esta respaldada por un contrato, y
    los artifacts congelados de la campana no conservaron el modelo efectivo, asi
    que no hay evidencia historica que las justifique.

    Consecuencia operativa, deliberada: si el despliegue configura un ALIAS y el
    proveedor responde con el snapshot concreto, el guard falla cerrado. Eso no es
    un bug — es el guard pidiendo que el plan fije un modelo concreto.
    """
    if reported is None:
        return EFFECTIVE_MODEL_UNAVAILABLE
    if reported != plan.model:
        raise ExecutionPlanMismatchError("effective_model_mismatch")
    return EFFECTIVE_MODEL_MATCH


def run_objective_analysis(
    *,
    plan: StageExecutionPlan,
    objective_type: str,
    objective_context: str,
    requirements: list[dict[str, Any]],
    provider: Any | None = None,
) -> dict[str, Any]:
    """Ejecuta la etapa completa y devuelve el envelope productivo.

    `provider` se inyecta en tests. En produccion se construye aca, despues del
    guard: construirlo antes leeria configuracion que quiza no vamos a usar.
    """
    assert_plan_matches_local_configuration(plan)

    client = provider if provider is not None else OpenAIObjectiveAnalysisProvider()

    prompt = build_objective_analysis_prompt(
        objective_type=objective_type,
        objective_context=objective_context,
        requirements=requirements,
    )

    observation = client.complete(
        prompt=prompt,
        schema_name=OBJECTIVE_ANALYSIS_SCHEMA_NAME,
        schema=OBJECTIVE_ANALYSIS_OUTPUT_SCHEMA,
        plan=plan,
    )

    artifact = build_objective_analysis_artifact(
        observation.output,
        objective_context=objective_context,
        requirements=requirements,
    )

    verification = _verify_reported_model(plan, observation.reported_model)

    execution: dict[str, Any] = {
        "artifactSchemaVersion": ARTIFACT_SCHEMA_VERSION,
        "promptVersion": PRODUCT_PROMPT_VERSION,
        "adapterVersion": PRODUCT_ADAPTER_VERSION,
        "provider": SUPPORTED_PROVIDER,
        "requestedModel": plan.model,
        "reasoningEffort": SUPPORTED_REASONING_EFFORT,
        "effectiveModelVerification": verification,
    }
    if observation.reported_model is not None:
        execution["reportedEffectiveModel"] = observation.reported_model

    # Sin respuesta cruda, sin prompt, sin tokens, sin razonamiento interno. El
    # artifact estructurado validado ES la autoridad de la etapa.
    return {
        "schemaVersion": RESPONSE_SCHEMA_VERSION,
        "execution": execution,
        "artifact": artifact,
    }
