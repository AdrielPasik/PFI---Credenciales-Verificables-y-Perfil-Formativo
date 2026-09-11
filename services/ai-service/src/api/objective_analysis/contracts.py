"""Contratos productivos del Objective Analysis — slice F3.3B.

IDENTIDAD DE EJECUCION CONGELADA. Estas constantes son las que F3.3A congelo en
su plan de ejecucion, y NestJS manda su copia en cada request. Las dos tienen que
coincidir exactamente antes de invocar al proveedor: NestJS es dueno del plan
congelado del ReasoningRun, el AI service es dueno de la implementacion de
prompt/adapter/proveedor, y ninguno confia en el otro por convencion.

LINAJE. Esto es la productizacion del candidato aceptado B2.4.1 / Target v1.5.1,
NO una copia byte a byte: cambia la autoridad del stage.

    experimental   texto crudo del Objective -> descubrir Requirements + clasificar
    productivo     Requirements confirmados  -> clasificar unicamente

Por eso la version productiva del prompt es propia y no reutiliza
`b24_objective_epistemic_target_es_v1.0.0`, que identifica al ancestro.

NADA DE ESTE MODULO IMPORTA `experiments/evidence_reasoning/`. La logica se
promovio; el arbol experimental sigue siendo investigacion congelada, no una
dependencia de runtime.
"""

from __future__ import annotations

from dataclasses import dataclass

# --------------------------------------------------------------------------
# Identidades congeladas por F3.3A
# --------------------------------------------------------------------------

REQUEST_SCHEMA_VERSION = "product_objective_analysis_request_v1"
RESPONSE_SCHEMA_VERSION = "product_objective_analysis_response_v1"

ARTIFACT_SCHEMA_VERSION = "objective_analysis_v1"
PRODUCT_PROMPT_VERSION = "product_objective_analysis_v1"
PRODUCT_ADAPTER_VERSION = "product_objective_analysis_adapter_v1"

SUPPORTED_PROVIDER = "openai"
SUPPORTED_REASONING_EFFORT = "medium"

#: El ancestro de investigacion. Se cita para trazabilidad; NUNCA se usa como
#: version productiva.
RESEARCH_ANCESTOR = "b24_objective_epistemic_target_es_v1.0.0"

# --------------------------------------------------------------------------
# Vocabularios promovidos de B2.4.1
# --------------------------------------------------------------------------

EPISTEMIC_TARGETS = ("FORMATIVE_EVIDENCE", "INDIVIDUAL_ACHIEVEMENT", "UNRESOLVED")

ATOMICITY_TOKENS = ("ATOMIC", "NEEDS_SPLIT", "UNRESOLVED")

REQUIRED_EVIDENCE_TYPES = (
    "FORMATIVE_EVIDENCE",
    "PROFESSIONAL_HISTORY",
    "PERSONAL_OR_ADMINISTRATIVE_FACT",
    "BEHAVIORAL_PERFORMANCE",
    "UNRESOLVED",
)

QUALIFIER_ROLES = ("MATERIAL_QUALIFIER", "CONTEXTUAL", "STRUCTURAL_WRAPPER")

VALIDATION_TAXONOMIES = (
    "HARD_FACTUAL_INVARIANT",
    "DETERMINISTIC_REPAIRABLE",
    "SEMANTIC_CONSISTENCY",
)

VALIDATION_STATUSES = (
    "PASS",
    "FAIL",
    "REPAIRED",
    "REJECTED",
    "MANUAL_ADJUDICATION_REQUIRED",
)


# --------------------------------------------------------------------------
# Errores tipados. La clasificacion NUNCA se hace parseando texto de mensaje.
# --------------------------------------------------------------------------


class ObjectiveAnalysisError(RuntimeError):
    """Base de los fallos tipados de esta etapa."""


class ExecutionPlanMismatchError(ObjectiveAnalysisError):
    """La configuracion productiva local no coincide con el plan congelado.

    Se levanta ANTES de invocar al proveedor. El detalle nunca lleva valores de
    configuracion: decir "esperaba X, encontre Y" meteria configuracion de
    despliegue en un log.
    """


class ProviderTransportError(ObjectiveAnalysisError):
    """No se obtuvo ninguna respuesta semantica utilizable.

    Timeout, conexion caida, proveedor no disponible. El run puede reintentar en
    la misma fila mientras el plan siga coincidiendo.
    """


class ProviderInvalidOutputError(ObjectiveAnalysisError):
    """El proveedor respondio ENTERO y su salida no cumple el contrato.

    NO se vuelve a preguntar. Reintentar hasta que una salida pase los guards no
    es robustez: es muestrear hasta que algo entre.
    """


class ProviderConfigurationError(ObjectiveAnalysisError):
    """El proveedor RECHAZO la peticion de forma determinista — slice F3.3B.2.

    Modelo inexistente, credencial invalida, peticion estructuralmente rechazada.
    Repetir el MISMO plan no puede tener otro resultado: el plan es insatisfacible
    tal como esta congelado.

    Se distingue de `ProviderTransportError` porque la consecuencia es la opuesta.
    Un timeout deja el run reintentable; esto lo mata, y tiene que matarlo: dejar
    un run reintentando indefinidamente una configuracion deterministicamente
    invalida no es resiliencia, es un bucle.
    """


class ProviderUnavailableError(ObjectiveAnalysisError):
    """Falta configuracion productiva del proveedor. No es un fallo del run.

    Distinto de `ProviderConfigurationError`: aca el AI service ni siquiera puede
    construir la peticion —le falta una variable—, asi que el proveedor nunca vio
    nada y no hay ningun hecho sobre el run que afirmar.
    """


# --------------------------------------------------------------------------
# Plan de etapa
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class StageExecutionPlan:
    """El plan de la etapa, tal como NestJS lo congelo en el ReasoningRun."""

    artifactSchemaVersion: str
    promptVersion: str
    adapterVersion: str
    provider: str
    model: str
    reasoningEffort: str


@dataclass(frozen=True)
class ProviderObservation:
    """Lo que el proveedor efectivamente informo.

    `reported_model` es `None` cuando la respuesta NO trae identidad de modelo.
    Es un hecho distinto de "informo el mismo que pedimos", y el wrapper NO puede
    colapsarlos: hacerlo fabricaria observabilidad que el proveedor no dio.
    """

    output: dict
    reported_model: str | None
