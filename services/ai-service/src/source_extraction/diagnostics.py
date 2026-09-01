"""Diagnosticos estructurados de extraccion — conjunto cerrado.

Nunca strings pelados: el experimento congelado usa `f"page_without_extractable
_text:{number}"`, y de un string libre no se puede decidir si degrada coverage.
Cada code trae su `severity` y su `affectsCoverage` fijados por el diseño §9,
para que esa decision no dependa de quien emita el diagnostico.

`detail` es opcional, acotado y NUNCA contenido del documento: ni excerpt, ni
linea, ni fragmento. El precedente productivo es
`analysis-run-execution.service.ts::sanitizeDiagnosticDetail`.
"""

from __future__ import annotations

from typing import Any

SEVERITY_INFO = "INFO"
SEVERITY_WARNING = "WARNING"
SEVERITY_ERROR = "ERROR"

SCOPE_SOURCE = "SOURCE"
SCOPE_PAGE = "PAGE"

PAGE_OBSERVED_EMPTY = "PAGE_OBSERVED_EMPTY"
PAGE_UNOBSERVED_OR_UNEXTRACTABLE = "PAGE_UNOBSERVED_OR_UNEXTRACTABLE"
PAGE_EXTRACTION_FAILED = "PAGE_EXTRACTION_FAILED"
SOURCE_NO_EXTRACTABLE_TEXT = "SOURCE_NO_EXTRACTABLE_TEXT"
ENCRYPTED_PDF = "ENCRYPTED_PDF"
UNSUPPORTED_SOURCE = "UNSUPPORTED_SOURCE"
SOURCE_UNREADABLE = "SOURCE_UNREADABLE"
PRIMARY_PARSER_FAILED_FELL_BACK = "PRIMARY_PARSER_FAILED_FELL_BACK"
EMPTY_SOURCE_TEXT = "EMPTY_SOURCE_TEXT"

#: code -> (severity, scope, affectsCoverage). Tabla congelada del diseño §9.
DIAGNOSTIC_TABLE: dict[str, tuple[str, str, bool]] = {
    PAGE_OBSERVED_EMPTY: (SEVERITY_INFO, SCOPE_PAGE, False),
    PAGE_UNOBSERVED_OR_UNEXTRACTABLE: (SEVERITY_WARNING, SCOPE_PAGE, True),
    PAGE_EXTRACTION_FAILED: (SEVERITY_ERROR, SCOPE_PAGE, True),
    SOURCE_NO_EXTRACTABLE_TEXT: (SEVERITY_ERROR, SCOPE_SOURCE, True),
    ENCRYPTED_PDF: (SEVERITY_ERROR, SCOPE_SOURCE, True),
    UNSUPPORTED_SOURCE: (SEVERITY_ERROR, SCOPE_SOURCE, True),
    SOURCE_UNREADABLE: (SEVERITY_ERROR, SCOPE_SOURCE, True),
    PRIMARY_PARSER_FAILED_FELL_BACK: (SEVERITY_WARNING, SCOPE_SOURCE, False),
    EMPTY_SOURCE_TEXT: (SEVERITY_INFO, SCOPE_SOURCE, False),
}

#: `PAGE_OBSERVED_EMPTY` existe en el schema desde v1 pero sigue siendo
#: INALCANZABLE: exige justificacion deterministica positiva (§6.2) y el
#: extractor opera bajo `INITIAL_OBSERVED_EMPTY_SIGNAL: DEFERRED`. Emitirlo
#: seria afirmar una ausencia que no se establecio.
#:
#: `EMPTY_SOURCE_TEXT` salio de este conjunto en F0.3: es el diagnostico de una
#: fuente `TEXT` vacia y totalmente observada, y ahora hay un extractor que
#: puede emitirlo legitimamente. Es INFO y no degrada coverage.
UNREACHABLE_CODES = frozenset({PAGE_OBSERVED_EMPTY})

DETAIL_MAX_LENGTH = 200


def _sanitize_detail(detail: str) -> str:
    """Acota el detail y colapsa saltos de linea.

    No intenta redactar contenido del documento — los llamadores dentro de este
    modulo nunca le pasan texto de la fuente, y esa disciplina se testea. Lo que
    hace es garantizar que ningun detail exceda el `maxLength` del schema.
    """
    collapsed = " ".join(detail.split())
    return collapsed[:DETAIL_MAX_LENGTH]


def diagnostic(code: str, *, page_index: int | None = None, detail: str | None = None) -> dict[str, Any]:
    if code not in DIAGNOSTIC_TABLE:
        raise ValueError(f"diagnostic code fuera del conjunto cerrado: {code!r}")
    if code in UNREACHABLE_CODES:
        raise ValueError(
            f"{code} no es emitible por el extractor "
            "(INITIAL_OBSERVED_EMPTY_SIGNAL: DEFERRED)"
        )
    severity, scope, affects_coverage = DIAGNOSTIC_TABLE[code]
    if scope == SCOPE_PAGE and page_index is None:
        raise ValueError(f"{code} tiene scope PAGE y requiere page_index")
    if scope == SCOPE_SOURCE and page_index is not None:
        raise ValueError(f"{code} tiene scope SOURCE y exige pageIndex null")

    entry: dict[str, Any] = {
        "code": code,
        "severity": severity,
        "scope": scope,
        "pageIndex": page_index,
        "affectsCoverage": affects_coverage,
    }
    if detail is not None:
        entry["detail"] = _sanitize_detail(detail)
    return entry
