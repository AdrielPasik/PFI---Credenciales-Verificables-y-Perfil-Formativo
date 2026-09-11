"""Contratos productivos del razonamiento contextual — slice F3.5.

LINAJE. Productizacion del stage `b241_unified_contextual_reasoning` del candidato
aceptado B2.4.1 / Target v1.5.1.

GRANULARIDAD, AUDITADA Y ADJUDICADA:

    ONE_CALL_PER_REQUIREMENT

y no una llamada por run. Evidencia en el runtime congelado: `_context(case,
requirement, ...)` recibe UN requirement singular; el prompt dice "para un
Requirement ya resuelto"; el schema tiene `requirementId: string` en el tope con
`additionalProperties: false` —no puede representar N Requirements—; el validador
`validate_and_enrich_b24(raw, requirement, ...)` es singular; y el runtime aborta
con `PROVIDER_CALL_BUDGET_ANOMALY:...;planned=1` si hay mas de uno, que es un
guard de PRESUPUESTO DE LLAMADAS.

"UNIFICADO" se refiere a las DIMENSIONES DE JUICIO dentro de un Requirement
—relations, facets, composicion, ceiling, weaker claim, continuidad, utilidad,
observabilidad se resuelven en UNA decision conjunta—, no a agrupar Requirements.

ESTE STAGE NO EMITE ESTADO FINAL.

    PROVIDER_FINAL_STATE_AUTHORITY: NO

`finalState`, `policyTrace` y `explanation` son de F3.6, determinista. Este
contrato es exactamente `RequirementResult` MENOS esos tres campos: un prefijo
estricto, no una segunda definicion de los mismos hechos.

NADA DE ESTE MODULO IMPORTA `experiments/evidence_reasoning/`.
"""

from __future__ import annotations

from dataclasses import dataclass

# --------------------------------------------------------------------------
# Identidades congeladas
# --------------------------------------------------------------------------

REQUEST_SCHEMA_VERSION = "product_contextual_reasoning_request_v1"
RESPONSE_SCHEMA_VERSION = "product_contextual_reasoning_response_v1"

#: El artifact que esta ETAPA produce, contando su mitad determinista. F3.5 no lo
#: persiste: entrega el contrato transitorio y F3.6 lo completa. Se nombra aca
#: porque el plan de ejecucion congelado dice esto para `contextualReasoning`, y
#: el guard lo compara literal.
STAGE_ARTIFACT_SCHEMA_VERSION = "reasoning_run_result_v1"

#: El contrato TRANSITORIO por Requirement. No es un artifact persistido y no
#: reemplaza a `artifactSchemaVersion`: identifica el transporte, igual que
#: `product_objective_analysis_response_v1` en F3.3B.
CONTEXTUAL_RESULT_SCHEMA_VERSION = "contextual_reasoning_v1"

PRODUCT_PROMPT_VERSION = "product_contextual_reasoning_v1"
PRODUCT_ADAPTER_VERSION = "product_contextual_reasoning_adapter_v1"

SUPPORTED_PROVIDER = "openai"
SUPPORTED_REASONING_EFFORT = "medium"

RESEARCH_ANCESTOR = "b241_unified_contextual_reasoning"

# --------------------------------------------------------------------------
# Vocabularios promovidos — identicos a los productivos de F3.1
# --------------------------------------------------------------------------

RELATION_TOKENS = (
    "DIRECT_SUPPORT",
    "SPECIFIC_SUPPORT",
    "CONTRIBUTORY_SUPPORT",
    "RELATED_NON_ENTAILING",
    "LIMITED_SCOPE",
    "CONFLICTING",
)

FACET_COVERAGE_TOKENS = ("FULL", "PARTIAL", "NONE")

COMPOSITION_MODES = ("NONE", "COMPLEMENTARY_COVERAGE", "INTEGRATED_CAPABILITY")

FULL_CLAIM_STATUS_TOKENS = ("REACHED", "NOT_REACHED", "UNRESOLVED")

OBSERVABILITY_STATUS_TOKENS = ("SUFFICIENT", "MATERIAL_GAP", "UNRESOLVED")

INDEPENDENT_OBSERVABLE_SUPPORT_TOKENS = (
    "FULL_CLAIM",
    "WEAKER_CLAIM",
    "NONE",
    "UNRESOLVED",
)

MISSING_MATERIAL_RELEVANCE_TOKENS = ("RELEVANT", "NOT_RELEVANT", "UNRESOLVED")

WEAKER_SEARCH_STATUS_TOKENS = ("FOUND", "NONE", "UNRESOLVED")

YES_NO_UNRESOLVED_TOKENS = ("YES", "NO", "UNRESOLVED")

CONTINUITY_TRANSFORMATION_TOKENS = (
    "CONSTITUTIVE_REDUCTION",
    "SEMANTIC_SHIFT",
    "UNRESOLVED",
)

SHIFT_REASON_TOKENS = ("PREREQUISITE_OR_FOUNDATION", "NEIGHBOR_OR_SUBSTITUTION", "OTHER")

MATERIAL_USEFULNESS_TOKENS = ("YES", "NO", "UNRESOLVED", "NOT_EVALUATED")

#: Correspondencia ESTRUCTURAL congelada entre continuidad y transformacion. No es
#: un veredicto semantico: es que decir `YES` y `SEMANTIC_SHIFT` a la vez es una
#: contradiccion, no una opinion.
CONTINUITY_TRANSFORMATION_BY_STATUS = {
    "YES": "CONSTITUTIVE_REDUCTION",
    "NO": "SEMANTIC_SHIFT",
    "UNRESOLVED": "UNRESOLVED",
}

#: Estados finales. Se listan SOLO para poder rechazarlos si el proveedor intenta
#: emitir uno: este stage no tiene autoridad sobre ellos.
FORBIDDEN_FINAL_STATE_TOKENS = (
    "SUPPORTED",
    "PARTIALLY_SUPPORTED",
    "INSUFFICIENT_EVIDENCE",
    "NOT_ASSESSABLE",
    "ABSTAIN",
)

#: Solo los qualifiers MATERIALES son referenciables. El validador congelado arma
#: su conjunto con `requirement["materialQualifiers"]`, asi que un CONTEXTUAL o un
#: STRUCTURAL_WRAPPER no puede convertirse en condicion de soporte faltante.
MATERIAL_QUALIFIER_ROLE = "MATERIAL_QUALIFIER"

# --------------------------------------------------------------------------
# Errores tipados
# --------------------------------------------------------------------------


class ContextualReasoningError(RuntimeError):
    """Base de los fallos tipados de esta etapa."""


class ExecutionPlanMismatchError(ContextualReasoningError):
    """El plan congelado no describe lo que este servicio ejecutaria."""


class ProviderTransportError(ContextualReasoningError):
    """No se obtuvo respuesta semantica utilizable. El run sigue vivo."""


class ProviderConfigurationError(ContextualReasoningError):
    """Rechazo DETERMINISTA del proveedor. El run muere."""


class ProviderInvalidOutputError(ContextualReasoningError):
    """Respuesta completa que no cumple el contrato. No se vuelve a preguntar."""


class ProviderUnavailableError(ContextualReasoningError):
    """Falta configuracion productiva. No es un fallo del run."""


class ReasoningInputError(ContextualReasoningError):
    """El material de razonamiento recibido no es utilizable.

    Se levanta ANTES de llamar: sin Requirement confirmado, sin analisis y sin
    catalogo verificable no hay nada sobre lo que razonar.
    """


# --------------------------------------------------------------------------
# Plan de etapa
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class StageExecutionPlan:
    """El plan de la etapa contextual, tal como NestJS lo congelo en el run."""

    artifactSchemaVersion: str
    promptVersion: str
    adapterVersion: str
    provider: str
    model: str
    reasoningEffort: str


@dataclass(frozen=True)
class ProviderObservation:
    """Lo que el proveedor efectivamente informo. `reported_model` puede faltar."""

    output: dict
    reported_model: str | None
