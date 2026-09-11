from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class FormativeProfileBuildRequest(BaseModel):
    """Request envelope for the versioned profile builder."""

    model_config = ConfigDict(extra="forbid")

    artifacts: list[dict[str, Any]] = Field(min_length=1)


# C2b.1: limite conservador para el contenido textual analizable. No hay un
# precedente equivalente al limite de bytes de PDF (AI_SERVICE_MAX_PDF_BYTES)
# porque el texto nunca pasa por storage/streaming — es un campo JSON en
# memoria — pero un tope evita que un payload enorme se cuele como "texto de
# curso" y degrade el pipeline de deteccion de secciones.
MAX_TEXT_CONTENT_LENGTH = 30_000


class SemanticAnalysisTextMetadata(BaseModel):
    """Metadata declarada por el emisor, separada deliberadamente de `content`.

    Nunca se mezcla con el texto analizable — evita que "Online" o el nombre
    de una plataforma contaminen la deteccion de skills/areas. `externalUrl`
    no es un campo valido aca a proposito: un enlace no es evidencia
    formativa y este servicio no hace fetch de URLs.
    """

    model_config = ConfigDict(extra="forbid")

    platformName: str | None = None
    hours: float | None = Field(default=None, ge=0)
    modality: str | None = None
    credentialType: str | None = None
    languageHint: str | None = None


class SemanticAnalysisTextSourceRefs(BaseModel):
    """Referencias opacas a la fuente en el backend. Nunca contenido."""

    model_config = ConfigDict(extra="forbid")

    textEvidenceId: str | None = None
    credentialId: str | None = None


class SemanticAnalysisTextRequest(BaseModel):
    """Request envelope for `/v1/semantic-analysis/text` (C2b.1)."""

    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1, max_length=MAX_TEXT_CONTENT_LENGTH)
    metadata: SemanticAnalysisTextMetadata | None = None
    sourceRefs: SemanticAnalysisTextSourceRefs | None = None
    requestedPipelineVersion: str | None = None
    requestedTaxonomyVersion: str | None = None

    @field_validator("content")
    @classmethod
    def _content_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("content must not be blank")
        return value



# F1.3: request de la ruta de source extraction para TEXT. Deliberadamente
# separado de SemanticAnalysisTextRequest: aquel lleva metadata declarada por el
# emisor y versiones de pipeline, que no tienen ningun papel en F0. Aca solo
# viaja lo que `extract_text_source` necesita.
#
# El contenido NO se normaliza ni se valida contra la forma product-normalized en
# este modelo: esa precondicion la verifica F0.3, y comprobarla dos veces con dos
# implementaciones distintas es justo la divergencia que F0 elimino. El tope de
# tamaño vive en source_extraction_transport, alineado con TextEvidence.
class SourceExtractionTextRequest(BaseModel):
    """Contenido persistido de un TextEvidence, para extraccion source-addressable."""

    model_config = ConfigDict(extra="forbid")

    content: str
    textEvidenceId: str = Field(min_length=1)
    sourceSha256: str = Field(min_length=64, max_length=64)


# F3.3B: Objective Analysis productivo.
#
# El request lleva SOLO los Requirements ya confirmados y el contexto del
# Objective. NO lleva `source.originalText`, ni el titulo del Objective, ni
# credenciales, ni inventario, ni EvidenceUnits, ni excerpts, ni provenance: la
# etapa es evidence-blind y el texto crudo del Objective solo servia para
# DESCUBRIR Requirements, que es el trabajo que produccion retiro.
#
# `extra="forbid"` en los dos modelos: un campo de mas en el transporte seria
# exactamente el camino por el que se colaria evidencia.
class ObjectiveAnalysisStagePlan(BaseModel):
    """El StageExecutionPlan congelado, tal como NestJS lo persistio en el run.

    Viaja en el request porque NestJS es dueno del plan y este servicio es dueno
    de la implementacion. Se comparan antes de invocar al proveedor: sin esto, el
    acuerdo seria por convencion.
    """

    model_config = ConfigDict(extra="forbid")

    artifactSchemaVersion: str = Field(min_length=1)
    promptVersion: str = Field(min_length=1)
    adapterVersion: str = Field(min_length=1)
    provider: str = Field(min_length=1)
    model: str = Field(min_length=1)
    reasoningEffort: str = Field(min_length=1)


class ObjectiveAnalysisRequirement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requirementId: str = Field(min_length=1)
    requirementText: str = Field(min_length=1)


class ObjectiveAnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schemaVersion: str = Field(min_length=1)
    executionPlan: ObjectiveAnalysisStagePlan
    objectiveType: str = Field(min_length=1)
    # Puede ser vacio: la ausencia de contexto es informacion, no un hueco.
    objectiveContext: str
    requirements: list[ObjectiveAnalysisRequirement] = Field(min_length=1)


# ---------------------------------------------------------------------------
# P2.2 — transporte de la propuesta de Requirements de un Objective
# ---------------------------------------------------------------------------


class ObjectiveRequirementProposalRequest(BaseModel):
    """Entrada de Objective Understanding productivo.

    SIN `executionPlan`: esta etapa no pertenece a ningun ReasoningRun y no hay un
    plan congelado de un tercero contra el cual compararse.

    EVIDENCE-BLIND POR CONSTRUCCION. `extra="forbid"` hace ESTRUCTURALMENTE
    imposible mandar credenciales, perfil, skills, EvidenceUnits, ReasoningRuns,
    conclusiones previas o identificadores del holder: no es una promesa de prosa,
    es el validador rechazando el request.

    `title` viaja SOLO como contexto de interpretacion. La autoridad sobre que
    Requirements existen es unicamente `rawObjectiveText`.
    """

    model_config = ConfigDict(extra="forbid")

    schemaVersion: str = Field(min_length=1)
    objectiveType: str = Field(min_length=1)
    # Puede ser vacio: un Objective sin titulo es un caso valido y el titulo no
    # crea Requirements de todos modos.
    title: str
    rawObjectiveText: str = Field(min_length=1)


# ---------------------------------------------------------------------------
# F3.4 — transporte del catalogo de EvidenceUnits
# ---------------------------------------------------------------------------


class EvidenceUnitsStagePlan(BaseModel):
    """El StageExecutionPlan congelado de la etapa 2, tal como lo persistio NestJS."""

    model_config = ConfigDict(extra="forbid")

    artifactSchemaVersion: str = Field(min_length=1)
    promptVersion: str = Field(min_length=1)
    adapterVersion: str = Field(min_length=1)
    provider: str = Field(min_length=1)
    model: str = Field(min_length=1)
    reasoningEffort: str = Field(min_length=1)


class EvidenceUnitsSegment(BaseModel):
    """Segmento del artifact `source_extraction_v1` verificado."""

    model_config = ConfigDict(extra="forbid")

    segmentId: str = Field(min_length=1)
    charStart: int = Field(ge=0)
    charEnd: int = Field(ge=0)
    exactExcerpt: str


class EvidenceUnitsPage(BaseModel):
    """Pagina del artifact verificado. Solo lo que hace falta para anclar."""

    model_config = ConfigDict(extra="forbid")

    pageNumber: int = Field(ge=1)
    pageOffsetStart: int = Field(ge=0)
    pageOffsetEnd: int = Field(ge=0)


class EvidenceUnitsSource(BaseModel):
    """Una fuente INCLUIDA del grounding set congelado.

    `sourceId` es el `runLocalSourceId` del run. NO viaja `credentialId`, ni
    `documentEvidenceId`, ni `textEvidenceId`, ni el id del `AnalysisRunSource`:
    esa es topologia de la base de NestJS y el proveedor no la necesita para
    trabajar sobre las fuentes locales del run.
    """

    model_config = ConfigDict(extra="forbid")

    sourceId: str = Field(min_length=1)
    sourceSha256: str = Field(min_length=1)
    coverageStatus: str = Field(min_length=1)
    # Puede ser vacio: `coverage FAILED` con texto vacio es input epistemologico
    # valido, no ausencia de fuente.
    canonicalText: str
    segments: list[EvidenceUnitsSegment]
    pages: list[EvidenceUnitsPage]
    diagnostics: list[str]


class EvidenceUnitsRequest(BaseModel):
    """Evidence-only por construccion.

    No hay campo para el Objective, ni para Requirements, ni para
    SemanticAnalysis, ni para perfiles: la etapa es objective-independent y
    `extra="forbid"` lo hace estructural en vez de una promesa del prompt.

    `sources` puede venir VACIA: un run sin fuentes incluidas produce un catalogo
    vacio valido, sin llamada al proveedor.
    """

    model_config = ConfigDict(extra="forbid")

    schemaVersion: str = Field(min_length=1)
    executionPlan: EvidenceUnitsStagePlan
    sources: list[EvidenceUnitsSource]


# ---------------------------------------------------------------------------
# F3.5 — transporte del razonamiento contextual (UN Requirement por request)
# ---------------------------------------------------------------------------


class ContextualReasoningStagePlan(BaseModel):
    """El StageExecutionPlan congelado de la etapa 3."""

    model_config = ConfigDict(extra="forbid")

    artifactSchemaVersion: str = Field(min_length=1)
    promptVersion: str = Field(min_length=1)
    adapterVersion: str = Field(min_length=1)
    provider: str = Field(min_length=1)
    model: str = Field(min_length=1)
    reasoningEffort: str = Field(min_length=1)


class ContextualQualifier(BaseModel):
    """Qualifier del Requirement, tal como lo produjo Objective Analysis.

    `qualifierId` es LOCAL al Requirement: la identidad real es
    (requirementId, qualifierId). Como cada request lleva UN Requirement, el
    proveedor no tiene forma de alcanzar el `q_01` de otro.
    """

    model_config = ConfigDict(extra="forbid")

    qualifierId: str | None = None
    kind: str
    value: str
    sourcePhrase: str
    role: str
    rationale: str


class ContextualEvaluability(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requiredEvidenceType: str = Field(min_length=1)
    formativeEvidenceCapable: bool
    rationale: str


class ContextualRequirement(BaseModel):
    """El Requirement confirmado + su análisis, ambos read-only para el modelo."""

    model_config = ConfigDict(extra="forbid")

    requirementId: str = Field(min_length=1)
    requirementText: str = Field(min_length=1)
    epistemicTarget: str = Field(min_length=1)
    atomicity: str = Field(min_length=1)
    evaluability: ContextualEvaluability
    qualifiers: list[ContextualQualifier]
    normalizedRequirement: str


class ContextualEvidenceUnit(BaseModel):
    """Una EvidenceUnit del catálogo verificado.

    Lleva la cita exacta y su contexto —el reasoner los necesita— pero NO el
    texto canónico completo de la fuente, ni el artifact de extracción, ni
    identidad de base de datos. `sourceId` es el `runLocalSourceId`.
    """

    model_config = ConfigDict(extra="forbid")

    evidenceUnitId: str = Field(min_length=1)
    sourceId: str = Field(min_length=1)
    normalizedProposition: str
    claimType: str = Field(min_length=1)
    semanticQualifiers: list[dict[str, str]]
    exactQuote: str
    contextBefore: str
    contextAfter: str
    sectionLabel: str | None = None
    interpretationProvenance: str = Field(min_length=1)
    extractionQuality: str = Field(min_length=1)


class ContextualSource(BaseModel):
    """Fuente del run con su provenance PROYECTADA y su cobertura observada."""

    model_config = ConfigDict(extra="forbid")

    sourceId: str = Field(min_length=1)
    sourceProvenance: str = Field(min_length=1)
    coverageStatus: str = Field(min_length=1)


class ContextualObservabilityFact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sourceId: str = Field(min_length=1)
    coverageStatus: str = Field(min_length=1)
    observedEvidenceUnitIds: list[str]
    extractionDiagnostics: list[str]


class ContextualPreparation(BaseModel):
    """La capa determinista de F3.4. Hechos, no juicios."""

    model_config = ConfigDict(extra="forbid")

    mode: str = Field(min_length=1)
    evidenceUnitIds: list[str]
    exactRedundancyGroups: list[list[str]]
    sourceObservabilityFacts: list[ContextualObservabilityFact]
    discardedEvidenceProposalCount: int = Field(ge=0)


class ContextualReasoningRequest(BaseModel):
    """UN Requirement, el catálogo COMPLETO de EvidenceUnits.

    No hay campo para texto canónico de fuente, artifact de extracción,
    SemanticAnalysis, FormativeProfile, taxonomía ni estado de blockchain:
    `extra="forbid"` lo hace estructural.
    """

    model_config = ConfigDict(extra="forbid")

    schemaVersion: str = Field(min_length=1)
    executionPlan: ContextualReasoningStagePlan
    # Puede ser vacío: la ausencia de contexto es información.
    objectiveContext: str
    requirement: ContextualRequirement
    # Puede ser vacía: un run sin evidencia igual necesita razonamiento contextual.
    evidenceUnits: list[ContextualEvidenceUnit]
    sources: list[ContextualSource]
    preparation: ContextualPreparation
