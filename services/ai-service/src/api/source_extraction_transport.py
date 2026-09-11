"""Transporte HTTP de source extraction — slice F1.3.

Este modulo responde UNA sola pregunta:

    "¿puede NestJS enviar material de fuente autoritativo al productor de
     extraccion existente y recibir su artifact?"

NO responde si el artifact es confiable. Eso sigue siendo F0.4 + F0.5, del lado
de NestJS. Aca no hay verificacion, no hay reparacion y no hay un segundo
productor: F0.2 y F0.3 siguen siendo los unicos.

TRES REGLAS DURAS DE ESTE BORDE

1. NUNCA TRUNCAR. Si un limite de tamaño se excede, se RECHAZA explicitamente.
   Jamas se recorta la entrada y se llama al productor igual: eso devolveria un
   artifact que parece valido y cuyo `coverageStatus` describiria una perdida
   introducida por el transporte en vez de la observabilidad real de la fuente.
   La perdida silenciosa de texto es exactamente el defecto historico que F0
   existe para eliminar; reintroducirlo por HTTP seria peor que no tener la ruta.

2. `storageKey` ES METADATA OPACA. Llega porque forma parte de la identidad que
   F0.2 conserva, y se propaga tal cual. NUNCA se interpreta como ruta de
   filesystem, URL, instruccion de object storage ni ubicacion alternativa de la
   fuente. El productor opera EXCLUSIVAMENTE sobre los bytes recibidos en el
   request. Abrir un archivo con un valor suministrado por el request romperia la
   cadena causal que F1.4 tiene que cerrar.

3. NO SE NORMALIZA LA ENTRADA. Para TEXT, F0.3 exige que el contenido ya sea
   punto fijo de `PRODUCT_NFC_LINEENDINGS_TRIM` y verifica esa precondicion. Si
   el transporte "arreglara" el contenido —trim, NFC, fines de linea— esconderia
   un bug aguas arriba y el artifact declararia una normalizacion que nadie
   aplico donde correspondia.
"""

from __future__ import annotations

from typing import Any, BinaryIO

from src.api.service import InvalidPdfUploadError, max_pdf_bytes
from src.source_extraction import extract_pdf_source, extract_text_source
from src.source_extraction.errors import (
    ArtifactInvariantViolation,
    DependencyFingerprintUnavailable,
    LocalSourceShaMismatch,
    ProductNormalizationPreconditionViolated,
)

#: Tope de contenido para la ruta TEXT, en CODE POINTS.
#:
#: Se alinea con `MAX_TEXT_EVIDENCE_CHARACTERS` de
#: `services/api/src/text-evidence/text-evidence.validator.ts`, que cuenta
#: `Array.from(content).length`, o sea code points — igual que `len()` de Python.
#:
#: NO se reutiliza `MAX_TEXT_CONTENT_LENGTH` (30.000) del endpoint semantico:
#: ese limite protege al pipeline de deteccion de secciones, mientras que la
#: entrada de esta ruta es POR DEFINICION un `TextEvidence` ya persistido. Con
#: 30.000 el transporte rechazaria contenido de producto perfectamente valido de
#: entre 30.000 y 50.000 caracteres, que es un defecto y no una proteccion.
MAX_TEXT_CONTENT_CODE_POINTS = 50_000


class SourceExtractionInputError(Exception):
    """La entrada no permite producir un artifact. Error del cliente."""


class SourceExtractionDependencyError(Exception):
    """Falta una dependencia del stack de extraccion. Error de servicio."""


def read_upload_bytes(source: BinaryIO) -> bytes:
    """Lee el PDF subido COMPLETO, con un unico guard: el tope de tamaño.

    El limite es un RECHAZO, nunca un recorte. No existe ningun camino por el que
    esta funcion devuelva una version parcial de la fuente.

    DIVERGENCIA DELIBERADA respecto de `service.save_pdf_upload`, que ademas exige
    la cabecera `%PDF-` y rechaza el archivo vacio. Aca esos dos chequeos NO se
    aplican, y el motivo es contractual: el diseño F0 §15 exige que unos bytes
    malformados y no parseables produzcan un artifact `FAILED` con
    `UNSUPPORTED_SOURCE`, no la ausencia de artifact. Verificado: el productor
    devuelve exactamente eso.

    Rechazarlos en el transporte suprimiria un hecho verdadero y reproducible
    sobre la fuente —"la identificamos y no pudimos parsearla"— y dejaria a
    Evidence Reasoning sin la base para `ABSTAIN` honesto. La entrada de esta ruta
    no es un upload de usuario a validar, sino bytes de `DocumentEvidence` ya
    persistidos y con su SHA congelado: la pregunta no es "¿es un upload valido?"
    sino "¿que se puede observar en estos bytes autoritativos?".

    El juicio de formato pertenece a F0.2, que es el unico productor.
    """
    limit = max_pdf_bytes()
    chunks: list[bytes] = []
    total = 0

    while chunk := source.read(1024 * 1024):
        total += len(chunk)
        if total > limit:
            raise InvalidPdfUploadError(f"PDF exceeds the {limit}-byte upload limit")
        chunks.append(chunk)

    return b"".join(chunks)


def extract_pdf_over_transport(
    *,
    pdf_bytes: bytes,
    document_evidence_id: str,
    source_sha256: str,
    storage_key: str,
) -> dict[str, Any]:
    """Delega en F0.2 y traduce sus excepciones. No agrega nada al artifact."""
    try:
        return extract_pdf_source(
            pdf_bytes=pdf_bytes,
            document_evidence_id=document_evidence_id,
            source_sha256=source_sha256,
            # Metadata opaca: se propaga al artifact, no se usa para abrir nada.
            storage_key=storage_key,
        )
    except LocalSourceShaMismatch as error:
        # Los bytes no son los declarados. Es un desajuste de la peticion.
        raise SourceExtractionInputError("source_sha256_does_not_match_uploaded_bytes") from error
    except DependencyFingerprintUnavailable as error:
        raise SourceExtractionDependencyError(f"extraction_dependency_unavailable: {error.package}") from error
    except ValueError as error:
        raise SourceExtractionInputError(f"invalid_pdf_extraction_request: {error}") from error


def extract_text_over_transport(
    *,
    content: str,
    text_evidence_id: str,
    source_sha256: str,
) -> dict[str, Any]:
    """Delega en F0.3 y traduce sus excepciones. NO normaliza el contenido."""
    if len(content) > MAX_TEXT_CONTENT_CODE_POINTS:
        # Rechazo explicito. Nunca un recorte al tope.
        raise SourceExtractionInputError(
            f"content exceeds the {MAX_TEXT_CONTENT_CODE_POINTS}-code-point limit"
        )

    try:
        return extract_text_source(
            content=content,
            text_evidence_id=text_evidence_id,
            source_sha256=source_sha256,
        )
    except ProductNormalizationPreconditionViolated as error:
        # El contenido no es punto fijo de PRODUCT_NFC_LINEENDINGS_TRIM. El
        # `stage` nombra la etapa que lo habria cambiado y nunca lleva contenido.
        raise SourceExtractionInputError(
            f"content_is_not_product_normalized: {error.stage}"
        ) from error
    except LocalSourceShaMismatch as error:
        raise SourceExtractionInputError("source_sha256_does_not_match_content") from error
    except (TypeError, ValueError) as error:
        raise SourceExtractionInputError(f"invalid_text_extraction_request: {error}") from error


__all__ = [
    "ArtifactInvariantViolation",
    "MAX_TEXT_CONTENT_CODE_POINTS",
    "SourceExtractionDependencyError",
    "SourceExtractionInputError",
    "extract_pdf_over_transport",
    "extract_text_over_transport",
    "read_upload_bytes",
]
