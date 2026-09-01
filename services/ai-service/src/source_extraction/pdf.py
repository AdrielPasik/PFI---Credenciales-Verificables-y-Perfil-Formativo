"""Extractor source-addressable de PDF — slice F0.2.

Camino PARALELO (decision F0-D1). No envuelve, no refactoriza y no toca
`io_utils.py::extract_text_from_pdf`, que sigue sirviendo al pipeline
`semantic_analysis_v1` sin cambio de comportamiento.

    PDF bytes -> ExtractionArtifact conforme a source_extraction_v1

POLITICA DE PARSER (Q3, no negociable)::

    UN ARTIFACT = UN parserProfile = UNA extractionIdentity
                = UN espacio de direcciones canonico

Prohibido mezclar: la pagina 1 de pdfplumber junto a la pagina 2 de pypdf dentro
del mismo artifact. Los dos parsers producen texto distinto para los mismos
bytes, asi que `(pageIndex, charStart, charEnd)` significaria cosas distintas
segun la pagina y el artifact no tendria un unico espacio de direcciones en el
cual verificar sus citas.

De ahi las dos degradaciones, deliberadamente asimetricas:

* **Pagina**: si pdfplumber abrio la fuente pero una pagina no se deja extraer,
  esa pagina queda `FAILED` y el `parserProfile` NO cambia. No se rellena con
  pypdf. La observacion imperfecta es un resultado.
* **Fuente**: pypdf solo entra cuando pdfplumber no logro producir artifact a
  nivel de fuente, y entonces se reintenta la fuente ENTERA. Todo el texto,
  paginas y segmentos del artifact provienen de pypdf.

La seleccion de parser depende unicamente de condiciones tecnicas. Nunca se
elige mirando que extraccion produjo texto mas favorable: eso seria seleccion de
evidencia por resultado.

`OBSERVED_EMPTY` es INALCANZABLE desde este modulo::

    INITIAL_OBSERVED_EMPTY_SIGNAL: DEFERRED

Toda pagina sin texto sustantivo cae en `UNOBSERVED_OR_UNEXTRACTABLE`. Un PDF
con una pagina en blanco reporta entonces `PARTIAL` y no `FULL`. Es el
comportamiento conservador correcto — sub-afirma observacion en vez de
sobre-afirmarla — y la asimetria es lo que lo hace seguro: que una pagina en
blanco caiga en `UNOBSERVED_OR_UNEXTRACTABLE` es aceptable; que una escaneada
caiga en `OBSERVED_EMPTY` no lo es nunca.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any, Callable

from . import diagnostics as diag
from .artifact import (
    COVERAGE_FAILED,
    NORMALIZATION_NONE,
    OFFSET_UNIT,
    SOURCE_TYPE_PDF,
    STATUS_EXTRACTED,
    STATUS_FAILED,
    STATUS_UNOBSERVED_OR_UNEXTRACTABLE,
    assert_local_invariants,
    build_pages,
    compute_artifact_fingerprint,
    derive_pdf_coverage,
)
from .errors import LocalSourceShaMismatch
from .identity import SCHEMA_VERSION, dependency_fingerprint, pdf_extraction_identity
from .parsers import PARSER_CHAIN, classify_source_failure, exception_chain
from .segmentation import canonical_text, has_substantive_text, join_pages, page_segments

_SHA256_HEX = re.compile(r"^[a-f0-9]{64}$")

#: Orden congelado de los diagnosticos de fuente. Los diagnosticos entran en la
#: material projection, asi que su orden es parte del fingerprint y no puede
#: depender del orden en que se descubrieron.
_SOURCE_DIAGNOSTIC_ORDER = (
    diag.PRIMARY_PARSER_FAILED_FELL_BACK,
    diag.SOURCE_NO_EXTRACTABLE_TEXT,
    diag.ENCRYPTED_PDF,
    diag.UNSUPPORTED_SOURCE,
    diag.SOURCE_UNREADABLE,
)


class SourceRead:
    """Resultado de aplicar la cadena de parsers a una fuente."""

    def __init__(
        self,
        *,
        parser_profile: str,
        pages: list[str | None] | None,
        fell_back: bool,
        failure_code: str | None,
        failure_chain: list[str] | None,
    ) -> None:
        self.parser_profile = parser_profile
        self.pages = pages
        self.fell_back = fell_back
        self.failure_code = failure_code
        self.failure_chain = failure_chain or []


def _read_source(
    pdf_bytes: bytes,
    chain: tuple[tuple[str, Callable[[bytes], list[str | None]]], ...],
) -> SourceRead:
    primary_error: BaseException | None = None

    for position, (profile, reader) in enumerate(chain):
        try:
            pages = reader(pdf_bytes)
        except Exception as error:
            if position == 0:
                primary_error = error
            continue
        return SourceRead(
            parser_profile=profile,
            pages=pages,
            # Solo se declara fallback cuando el fallback REALMENTE produjo el
            # espacio de direcciones del artifact. Si tambien fallo, la identidad
            # no cambio y decir que caimos al fallback seria enganoso.
            fell_back=position > 0,
            failure_code=None,
            failure_chain=exception_chain(primary_error) if primary_error else None,
        )

    # Ningun parser produjo espacio de direcciones. El artifact igual existe
    # (diseño §15): observamos la identidad de la fuente, no su contenido.
    return SourceRead(
        parser_profile=chain[0][0],
        pages=None,
        fell_back=False,
        failure_code=classify_source_failure(primary_error) if primary_error else diag.SOURCE_UNREADABLE,
        failure_chain=exception_chain(primary_error) if primary_error else None,
    )


def _page_status(raw: str | None) -> str:
    if raw is None:
        return STATUS_FAILED
    if has_substantive_text(raw):
        return STATUS_EXTRACTED
    # Default conservador. NUNCA OBSERVED_EMPTY: `extract_text() == ""` no es
    # justificacion deterministica positiva de ausencia (§6.2).
    return STATUS_UNOBSERVED_OR_UNEXTRACTABLE


def _safe_detail(chain: list[str]) -> str | None:
    """Detail acotado a partir de NOMBRES DE CLASE de excepcion.

    Nunca `str(error)`: los mensajes de los parsers citan bytes de la fuente
    — `invalid pdf header: b'esto '` es un mensaje real de pdfminer — y el
    contrato prohibe que `detail` contenga contenido del documento.
    """
    if not chain:
        return None
    return "/".join(chain)


def extract_pdf_source(
    *,
    pdf_bytes: bytes,
    document_evidence_id: str,
    source_sha256: str,
    storage_key: str,
    parser_chain: tuple[tuple[str, Callable[[bytes], list[str | None]]], ...] = PARSER_CHAIN,
) -> dict[str, Any]:
    """Produce un `source_extraction_v1` a partir de los bytes de un PDF.

    Levanta `LocalSourceShaMismatch` si los bytes no son los declarados, y
    `DependencyFingerprintUnavailable` si falta una dependencia del stack de
    parseo. En cualquier otro caso devuelve un artifact — incluso con coverage
    `FAILED`: un artifact `FAILED` y la ausencia de artifact son cosas
    distintas, y solo la segunda significa que no podemos dar fe de haber
    mirado.

    `parser_chain` es un punto de inyeccion para tests. Produccion usa el orden
    congelado `PARSER_CHAIN`.
    """
    if not document_evidence_id:
        raise ValueError("document_evidence_id no puede ser vacio")
    if not storage_key:
        raise ValueError("storage_key no puede ser vacio")
    if not _SHA256_HEX.match(source_sha256):
        raise ValueError("source_sha256 debe ser sha256 hex en minuscula")

    # Binding local de SHA. Va PRIMERO, antes de tocar ningun parser: si los
    # bytes no son los declarados no hay nada que valga la pena parsear, y el
    # artifact no debe poder existir. No reemplaza la autoridad de dominio de
    # NestJS (F0.5), que repetira la verificacion contra la fuente autoritativa.
    computed_sha256 = hashlib.sha256(pdf_bytes).hexdigest()
    if computed_sha256 != source_sha256:
        raise LocalSourceShaMismatch(declared=source_sha256, computed=computed_sha256)

    # Antes de parsear: sin versiones exactas resueltas, la extraction identity
    # no es atribuible y el artifact no debe producirse. Se resuelve aca, y no
    # despues, para que la falta de una dependencia aborte antes de gastar el
    # parseo y no a mitad de camino.
    dependency_fingerprint()

    read = _read_source(pdf_bytes, parser_chain)
    extraction_identity = pdf_extraction_identity(read.parser_profile)

    raw_pages = read.pages if read.pages is not None else []
    statuses = [_page_status(raw) for raw in raw_pages]
    page_texts = [canonical_text(raw) if raw is not None else "" for raw in raw_pages]

    pages = build_pages(page_texts, statuses)
    segments: list[dict[str, Any]] = []
    for page in pages:
        segments.extend(page_segments(page["pageIndex"], page["canonicalText"]))

    coverage = derive_pdf_coverage(statuses)
    entries = _build_diagnostics(read, statuses, coverage)

    artifact: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "sourceType": SOURCE_TYPE_PDF,
        "source": {
            "documentEvidenceId": document_evidence_id,
            "sourceSha256": source_sha256,
            "storageKey": storage_key,
        },
        "extractionIdentity": extraction_identity,
        "sourceNormalizationApplied": NORMALIZATION_NONE,
        "offsetUnit": OFFSET_UNIT,
        "coverageStatus": coverage,
        "pages": pages,
        "documentCanonicalText": join_pages(page_texts),
        "segments": segments,
        "diagnostics": entries,
    }
    artifact["artifactContentFingerprint"] = compute_artifact_fingerprint(artifact)

    assert_local_invariants(artifact)
    return artifact


def _build_diagnostics(read: SourceRead, statuses: list[str], coverage: str) -> list[dict[str, Any]]:
    """Diagnosticos en orden congelado: primero pagina, despues fuente."""
    entries: list[dict[str, Any]] = []

    for index, status in enumerate(statuses):
        if status == STATUS_UNOBSERVED_OR_UNEXTRACTABLE:
            entries.append(diag.diagnostic(diag.PAGE_UNOBSERVED_OR_UNEXTRACTABLE, page_index=index))
        elif status == STATUS_FAILED:
            entries.append(diag.diagnostic(diag.PAGE_EXTRACTION_FAILED, page_index=index))

    source_codes: dict[str, str | None] = {}
    if read.fell_back:
        source_codes[diag.PRIMARY_PARSER_FAILED_FELL_BACK] = _safe_detail(read.failure_chain)
    if read.failure_code is not None:
        source_codes[read.failure_code] = _safe_detail(read.failure_chain)
    elif statuses and coverage == COVERAGE_FAILED:
        # El parser abrio la fuente y ninguna pagina rindio texto sustantivo:
        # el caso del PDF escaneado sin OCR.
        source_codes[diag.SOURCE_NO_EXTRACTABLE_TEXT] = None

    for code in _SOURCE_DIAGNOSTIC_ORDER:
        if code in source_codes:
            entries.append(diag.diagnostic(code, detail=source_codes[code]))
    return entries
