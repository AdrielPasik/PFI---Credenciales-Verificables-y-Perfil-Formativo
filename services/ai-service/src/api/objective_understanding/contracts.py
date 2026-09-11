"""Contratos productivos de Objective Understanding — slice P2.2.

QUE PRODUCTIVIZA ESTE PAQUETE. El candidato `OU_A2` que paso el Holdout congelado
de P2.1, sin ningun cambio semantico posterior:

    material hallucinations   0
    negation inversions       0
    material recall         100%
    qualifier preservation  100%
    mis-granularity           0%
    trusted grounding       100%
    schema validity         100%

DIFERENCIA DE AUTORIDAD CON LAS ETAPAS DE F3. Objective Analysis, EvidenceUnits y
Contextual Reasoning son etapas de un ReasoningRun: NestJS congela un
`StageExecutionPlan` por run y el servicio lo compara antes de llamar. Aca NO hay
run y NO hay plan congelado, porque la propuesta es TRANSITORIA y no se persiste.

Por eso esta etapa NO recibe `executionPlan` y NO puede emitir
`EXECUTION_PLAN_MISMATCH`: no existe un plan de un tercero contra el cual
divergir. La identidad de etapa la declara ESTE servicio y viaja en la respuesta
para que NestJS la verifique contra sus propias constantes congeladas. Fabricar un
plan para que se parezca a F3 seria inventar una promesa que nadie hizo.

FRONTERA. Esta etapa PROPONE. No crea el Objective, no confirma Requirements, no
ejecuta Evidence Reasoning, no mira credenciales del holder y no persiste nada.

NADA DE ESTE MODULO IMPORTA `experiments/objective_understanding/`. La logica se
promovio; el arbol experimental sigue siendo investigacion congelada.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# --------------------------------------------------------------------------
# Identidad de etapa productiva
# --------------------------------------------------------------------------

REQUEST_SCHEMA_VERSION = "product_objective_requirement_proposal_request_v1"
RESPONSE_SCHEMA_VERSION = "product_objective_requirement_proposal_response_v1"

#: Nombre congelado en P2.0 §22.2 para el artefacto transitorio.
ARTIFACT_SCHEMA_VERSION = "objective_requirement_proposal_v1"

PRODUCT_PROMPT_VERSION = "product_objective_understanding_v1"
PRODUCT_ADAPTER_VERSION = "product_objective_understanding_adapter_v1"
PROVIDER_PROPOSAL_SCHEMA_VERSION = "product_objective_understanding_proposal_v1"

SUPPORTED_PROVIDER = "openai"
SUPPORTED_REASONING_EFFORT = "medium"

#: El ancestro de investigacion. Se cita para trazabilidad; NUNCA se usa como
#: version productiva. `OU_A2` identifica al candidato que paso el Holdout de
#: P2.1; el prompt y el adapter productivos tienen identidad propia.
RESEARCH_ANCESTOR = "OU_A2"

#: Idioma con el que el contrato fue efectivamente validado (P2.1). El servicio
#: puede recibir texto en otro idioma, pero NO se afirma soporte evaluado en
#: ingles y NO se traduce la entrada.
VALIDATED_PRIMARY_LANGUAGE = "es"

#: Unidad de offset congelada. El texto crudo enviado es la UNICA autoridad
#: textual: no se construye una segunda representacion canonica.
OFFSET_UNIT = "UNICODE_CODE_POINT"
SOURCE_NORMALIZATION = "NONE"

#: Estados de anclaje de una cita propuesta (P2.0 §15).
ANCHOR_UNIQUE = "UNIQUE"
ANCHOR_AMBIGUOUS = "AMBIGUOUS"
ANCHOR_NOT_FOUND = "NOT_FOUND"
ANCHOR_STATUSES = (ANCHOR_UNIQUE, ANCHOR_AMBIGUOUS, ANCHOR_NOT_FOUND)

#: Tope duro de entrada. Se comprueba ANTES de construir la peticion: P2.1
#: congelo `ONE_CALL_PER_OBJECTIVE`, asi que segmentar un Objective demasiado
#: grande produciria una topologia que la evaluacion nunca midio.
MAX_OBJECTIVE_CHARACTERS = 60_000


# --------------------------------------------------------------------------
# Errores tipados. La clasificacion NUNCA se hace parseando texto de mensaje.
# --------------------------------------------------------------------------


class ObjectiveUnderstandingError(RuntimeError):
    """Base de los fallos tipados de esta etapa."""


class ObjectiveTooLargeError(ObjectiveUnderstandingError):
    """El Objective excede lo que esta etapa puede procesar en UNA llamada.

    No se trunca en silencio y no se segmenta: truncar cambiaria el Objective sin
    que nadie lo sepa, y segmentar romperia `ONE_CALL_PER_OBJECTIVE`, que es parte
    de la topologia evaluada.
    """


class ProviderTransportError(ObjectiveUnderstandingError):
    """No se obtuvo ninguna respuesta semantica utilizable.

    Como la propuesta es transitoria y no hay fila que quede a medias, el llamante
    puede simplemente volver a pedirla. Eso produce una observacion NUEVA del
    proveedor, no la continuacion de la anterior.
    """


class ProviderInvalidOutputError(ObjectiveUnderstandingError):
    """El proveedor respondio ENTERO y su salida no cumple el contrato.

    NO se vuelve a preguntar dentro de la misma peticion. Reintentar hasta que una
    salida pase los guards no es robustez: es muestrear hasta que algo entre.
    """


class ProviderConfigurationError(ObjectiveUnderstandingError):
    """El proveedor RECHAZO la peticion de forma determinista.

    Modelo inexistente, credencial invalida, peticion estructuralmente rechazada.
    Repetir la misma peticion no puede tener otro resultado.
    """


class ProviderUnavailableError(ObjectiveUnderstandingError):
    """Falta configuracion productiva del proveedor.

    El servicio ni siquiera puede construir la peticion, asi que el proveedor
    nunca vio nada y no hay ningun hecho sobre la propuesta que afirmar.
    """


class ObjectiveInputError(ObjectiveUnderstandingError):
    """La entrada no satisface el contrato de esta etapa."""


# --------------------------------------------------------------------------
# Observacion del proveedor
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class ProviderObservation:
    """Lo que el proveedor efectivamente informo.

    `reported_model` es `None` cuando la respuesta NO trae identidad de modelo.
    Es un hecho distinto de "informo el mismo que pedimos", y el wrapper NO puede
    colapsarlos: hacerlo fabricaria observabilidad que el proveedor no dio.
    """

    output: dict
    reported_model: str | None


@dataclass(frozen=True)
class StageIdentity:
    """Identidad productiva de la etapa, tal como viaja en la respuesta."""

    artifactSchemaVersion: str = ARTIFACT_SCHEMA_VERSION
    promptVersion: str = PRODUCT_PROMPT_VERSION
    adapterVersion: str = PRODUCT_ADAPTER_VERSION
    providerProposalSchemaVersion: str = PROVIDER_PROPOSAL_SCHEMA_VERSION
    provider: str = SUPPORTED_PROVIDER
    reasoningEffort: str = SUPPORTED_REASONING_EFFORT
    researchAncestor: str = RESEARCH_ANCESTOR
    validatedPrimaryLanguage: str = VALIDATED_PRIMARY_LANGUAGE
    forbidden: tuple[str, ...] = field(
        default_factory=lambda: (
            "candidateId",
            "charStart",
            "charEnd",
            "requirementId",
            "finalState",
            "confidence",
            "fit",
            "owner",
        )
    )
