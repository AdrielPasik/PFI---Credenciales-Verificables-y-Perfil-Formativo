"""Contratos productivos del catalogo de EvidenceUnits — slice F3.4.

LINAJE. Productizacion del stage `b241_evidence_unit_quote_first` del candidato
aceptado B2.4.1 / Target v1.5.1. Auditado sobre el runtime congelado:

    granularidad     UNA llamada por run, con TODAS las fuentes juntas
    input            solo las fuentes materializadas
    objective        NO participa — el stage es objective-independent, y de hecho
                     corre ANTES del Objective Analysis en `run_b241_case`
    el modelo propone   sourceId, segmentId, quoteText, normalizedProposition,
                        claimType, semanticQualifiers
    el codigo construye  evidenceUnitId, offsets, segmento autoritativo, pagina,
                         sourceTrace, provenance, extractionQuality

NADA DE ESTE MODULO IMPORTA `experiments/evidence_reasoning/`. La logica se
promovio; el arbol experimental sigue siendo investigacion congelada.

DELTAS DE PRODUCTIZACION, todos ya congelados por F3.0/F3.1:

    experimental                          productivo
    sourceId de fixture                   runLocalSourceId del inventario congelado
    canonicalText del snapshot propio     documentCanonicalText de source_extraction_v1
    sourceProvenance por unidad           sources[] por fuente (una autoridad por hecho)
    credentialId en sourceTrace           se llega por el item de inventario
    lineageId / technicallyVerified       PRODUCT_LINEAGE_ID_V1: NONE
"""

from __future__ import annotations

from dataclasses import dataclass

# --------------------------------------------------------------------------
# Identidades congeladas
# --------------------------------------------------------------------------

REQUEST_SCHEMA_VERSION = "product_evidence_units_request_v1"
RESPONSE_SCHEMA_VERSION = "product_evidence_units_response_v1"

ARTIFACT_SCHEMA_VERSION = "evidence_units_v1"
PRODUCT_PROMPT_VERSION = "product_evidence_units_v1"
PRODUCT_ADAPTER_VERSION = "product_evidence_units_adapter_v1"

SUPPORTED_PROVIDER = "openai"
SUPPORTED_REASONING_EFFORT = "medium"

#: Ancestro de investigacion. Se cita para trazabilidad; NUNCA se usa como
#: version productiva.
RESEARCH_ANCESTOR = "b2_evidence_unit_quote_first_v1.0.0"

# --------------------------------------------------------------------------
# Vocabularios promovidos
# --------------------------------------------------------------------------

CLAIM_TYPES = (
    "DECLARED_CONTENT",
    "DECLARED_LEARNING_OUTCOME",
    "ASSESSED_OUTCOME",
    "CREDENTIAL_LEVEL_CLAIM",
)

COVERAGE_STATUS_TOKENS = ("FULL", "PARTIAL", "FAILED")

#: Constante en el codigo congelado: el catalogo SIEMPRE escribe `AI_INFERRED`.
#: No se le pregunta al modelo — una interpretacion automatica nunca crea
#: evidencia primaria, y dejar que el modelo declarara su propia procedencia seria
#: dejarlo firmar su propia autoridad.
INTERPRETATION_PROVENANCE = "AI_INFERRED"

#: AUTORIDAD DE ASERCION de la fuente. Determinista y unica en V1: el proveedor no
#: la elige ni la modifica, y no se infiere de labels ni de quien subio el archivo.
SOURCE_PROVENANCE = "ISSUER_DECLARED"

#: Radio de contexto alrededor de la cita, en puntos de codigo. Valor del builder
#: congelado.
CONTEXT_RADIUS = 96

# --------------------------------------------------------------------------
# Errores tipados. La clasificacion NUNCA se hace parseando texto de mensaje.
# --------------------------------------------------------------------------


class EvidenceUnitsError(RuntimeError):
    """Base de los fallos tipados de esta etapa."""


class ExecutionPlanMismatchError(EvidenceUnitsError):
    """La configuracion productiva local no coincide con el plan congelado.

    Se levanta ANTES de invocar al proveedor. El detalle nunca lleva valores de
    configuracion.
    """


class ProviderTransportError(EvidenceUnitsError):
    """No se obtuvo ninguna respuesta semantica utilizable. El run sigue vivo."""


class ProviderConfigurationError(EvidenceUnitsError):
    """El proveedor rechazo la peticion de forma DETERMINISTA. El run muere."""


class ProviderInvalidOutputError(EvidenceUnitsError):
    """El proveedor respondio ENTERO y su salida no cumple el contrato.

    NO se vuelve a preguntar. Reintentar hasta que una salida pase los guards no
    es robustez: es muestrear hasta que algo entre.
    """


class ProviderUnavailableError(EvidenceUnitsError):
    """Falta configuracion productiva del proveedor. No es un fallo del run."""


class GroundingInputError(EvidenceUnitsError):
    """El material de grounding recibido no es utilizable.

    Se levanta ANTES de cualquier llamada: sin un input congelado verificable no
    hay nada contra que anclar, y llamar al proveedor produciria propuestas que
    ninguna verificacion podria aceptar.
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

    `reported_model` es `None` cuando la respuesta NO trae identidad de modelo. Es
    un hecho distinto de "informo el mismo que pedimos".
    """

    output: dict
    reported_model: str | None
