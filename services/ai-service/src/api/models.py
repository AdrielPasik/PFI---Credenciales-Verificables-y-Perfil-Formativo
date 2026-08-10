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

