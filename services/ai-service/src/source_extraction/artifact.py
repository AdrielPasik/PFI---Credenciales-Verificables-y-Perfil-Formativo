"""Ensamblado del artifact, derivacion de coverage y validacion local.

Ningun artifact sale de este modulo sin haber pasado por
`assert_local_invariants`. La regla es que no exista un artifact "casi valido":
un objeto que valida contra JSON Schema pero cuyos campos derivados contradicen
su propia material projection es peor que un fallo, porque parece verificado.

F0.5 vuelve a comprobar todo esto de forma independiente en NestJS. Esta
verificacion local no reemplaza aquella; existe para que un bug del extractor se
detecte en el productor y no aguas abajo.
"""

from __future__ import annotations

from typing import Any

from .canonical import fingerprint
from .diagnostics import EMPTY_SOURCE_TEXT
from .errors import ArtifactInvariantViolation
from .identity import SCHEMA_VERSION
from .segmentation import PAGE_JOIN, code_point_length, join_pages

SOURCE_TYPE_PDF = "PDF_DOCUMENT"
SOURCE_TYPE_TEXT = "TEXT"

OFFSET_UNIT = "UNICODE_CODE_POINT"
NORMALIZATION_NONE = "NONE"
NORMALIZATION_PRODUCT = "PRODUCT_NFC_LINEENDINGS_TRIM"

STATUS_EXTRACTED = "EXTRACTED"
STATUS_OBSERVED_EMPTY = "OBSERVED_EMPTY"
STATUS_UNOBSERVED_OR_UNEXTRACTABLE = "UNOBSERVED_OR_UNEXTRACTABLE"
STATUS_FAILED = "FAILED"

COVERAGE_FULL = "FULL"
COVERAGE_PARTIAL = "PARTIAL"
COVERAGE_FAILED = "FAILED"

_OBSERVED = frozenset({STATUS_EXTRACTED, STATUS_OBSERVED_EMPTY})
_DEGRADED = frozenset({STATUS_UNOBSERVED_OR_UNEXTRACTABLE, STATUS_FAILED})


def derive_pdf_coverage(statuses: list[str]) -> str:
    """`coverageStatus` de una fuente PDF, a partir de sus `pageObservationStatus`.

    Mide COMPLETITUD DE OBSERVACION, no cuanto texto salio (diseño §8.1). Una
    fuente `FAILED` sigue representada en observability: significa "identidad de
    la fuente observada, contenido inobservable bajo esta extraction identity",
    no "no existe evidencia".

    Un PDF sin paginas — cifrado, malformado — es `FAILED`: no se observo
    contenido sustantivo y queda material sin observar.

    ESTA REGLA ES SOLO PARA PDF. Aplicarla a una fuente `TEXT`, que siempre
    tiene `pages: []`, daria `FAILED` para todo `TEXT` — exactamente al reves de
    lo que dice el contrato. Por eso son dos funciones separadas y no una con un
    parametro: el nombre de la funcion tiene que hacer imposible el error.
    """
    if not statuses:
        return COVERAGE_FAILED
    if all(status in _OBSERVED for status in statuses):
        return COVERAGE_FULL
    has_substantive = any(status == STATUS_EXTRACTED for status in statuses)
    any_degraded = any(status in _DEGRADED for status in statuses)
    if has_substantive and any_degraded:
        return COVERAGE_PARTIAL
    return COVERAGE_FAILED


def derive_text_coverage(canonical_text_value: str) -> str:
    """`coverageStatus` de una fuente `TEXT`. Siempre `FULL`.

    Una fuente `TEXT` leida por completo esta completamente observada, y eso no
    depende de cuanto texto haya: coverage mide completitud de OBSERVACION, no
    volumen. Una fuente vacia totalmente observada es `FULL` con cero evidencia
    sustantiva, nunca `FAILED` (diseño §8.2 y §10.1).

    `FAILED` para `TEXT` significaria "no pudimos leer el contenido", y eso ya no
    es un artifact: es la ausencia de artifact. El parametro se recibe para que
    la firma diga sobre que se afirma, aunque el resultado no dependa de el.
    """
    del canonical_text_value  # el contrato no lo hace depender del contenido
    return COVERAGE_FULL


def build_pages(page_texts: list[str], statuses: list[str]) -> list[dict[str, Any]]:
    """Entradas de pagina con sus offsets globales derivados.

    Una pagina sin texto igual ocupa su indice, con `canonicalText: ""`: la
    numeracion que ve una persona en un visor de PDF tiene que seguir siendo la
    misma aunque no hayamos podido leer una pagina del medio.
    """
    if len(page_texts) != len(statuses):
        raise ArtifactInvariantViolation("page_texts y statuses tienen largos distintos")

    pages: list[dict[str, Any]] = []
    offset = 0
    for index, (text, status) in enumerate(zip(page_texts, statuses)):
        end = offset + code_point_length(text)
        pages.append(
            {
                "pageIndex": index,
                "pageNumber": index + 1,
                "canonicalText": text,
                "pageOffsetStart": offset,
                "pageOffsetEnd": end,
                "pageObservationStatus": status,
            }
        )
        offset = end + code_point_length(PAGE_JOIN)
    return pages


def material_projection(artifact: dict[str, Any]) -> dict[str, Any]:
    """Proyeccion material congelada sobre la que se calcula el fingerprint.

    Excluidos por construccion: ids de fila, timestamps, UUIDs,
    `diagnostic.detail` y el propio `artifactContentFingerprint`. Excluidos
    tambien los campos derivados (`documentCanonicalText`, `pageOffsetStart`,
    `pageOffsetEnd`), cuya consistencia se valida por invariante en vez de por
    hash.

    Incluidos deliberadamente los diagnosticos: una fuente que fallo una pagina
    no es materialmente la misma extraccion que una que no.
    """
    return {
        "sourceSha256": artifact["source"]["sourceSha256"],
        "sourceNormalizationApplied": artifact["sourceNormalizationApplied"],
        "extractionIdentity": dict(artifact["extractionIdentity"]),
        "offsetUnit": artifact["offsetUnit"],
        "coverageStatus": artifact["coverageStatus"],
        "pages": [
            {
                "pageIndex": page["pageIndex"],
                "pageNumber": page["pageNumber"],
                "canonicalText": page["canonicalText"],
                "pageObservationStatus": page["pageObservationStatus"],
            }
            for page in artifact["pages"]
        ],
        "segments": [
            {
                "segmentId": segment["segmentId"],
                "pageIndex": segment["pageIndex"],
                "charStart": segment["charStart"],
                "charEnd": segment["charEnd"],
            }
            for segment in artifact["segments"]
        ],
        "diagnostics": [
            {
                "code": entry["code"],
                "severity": entry["severity"],
                "scope": entry["scope"],
                "pageIndex": entry["pageIndex"],
                "affectsCoverage": entry["affectsCoverage"],
            }
            for entry in artifact["diagnostics"]
        ],
    }


def compute_artifact_fingerprint(artifact: dict[str, Any]) -> str:
    return fingerprint(material_projection(artifact))


# ---------------------------------------------------------------------------
# Invariantes locales
# ---------------------------------------------------------------------------

def _fail(message: str) -> None:
    raise ArtifactInvariantViolation(message)


def _assert_pages(artifact: dict[str, Any]) -> None:
    offset = 0
    for position, page in enumerate(artifact["pages"]):
        if page["pageIndex"] != position:
            _fail(f"page_index_not_sequential: position={position} pageIndex={page['pageIndex']}")
        if page["pageNumber"] != page["pageIndex"] + 1:
            _fail(f"page_number_relation: pageIndex={page['pageIndex']}")
        if page["pageOffsetStart"] != offset:
            _fail(
                f"page_offset_start: pageIndex={page['pageIndex']} "
                f"declared={page['pageOffsetStart']} expected={offset}"
            )
        expected_end = offset + code_point_length(page["canonicalText"])
        if page["pageOffsetEnd"] != expected_end:
            _fail(
                f"page_offset_end: pageIndex={page['pageIndex']} "
                f"declared={page['pageOffsetEnd']} expected={expected_end}"
            )
        offset = expected_end + code_point_length(PAGE_JOIN)

    expected_document = join_pages([page["canonicalText"] for page in artifact["pages"]])
    if artifact["documentCanonicalText"] != expected_document:
        _fail("document_canonical_text_does_not_match_pages")


def _assert_segments(artifact: dict[str, Any]) -> None:
    """Invariantes de segmento, con el contenedor que corresponde a la fuente.

    Lo normativo es relativo al contenedor (diseño §5.1): la pagina para PDF, el
    documento entero para TEXT. Una direccion relativa a la pagina sobrevive
    cualquier cambio en la convencion de union; una global no.
    """
    is_text = artifact["sourceType"] == SOURCE_TYPE_TEXT
    pages = {page["pageIndex"]: page for page in artifact["pages"]}

    for segment in artifact["segments"]:
        start, end = segment["charStart"], segment["charEnd"]
        if end < start:
            _fail(f"reversed_span: {segment['segmentId']}")
        if end == start:
            _fail(f"empty_segment: {segment['segmentId']}")

        if is_text:
            if segment["pageIndex"] is not None:
                _fail(f"text_segment_must_have_null_page_index: {segment['segmentId']}")
            container = artifact["documentCanonicalText"]
            expected_id = f"d:{start}-{end}"
        else:
            page_index = segment["pageIndex"]
            if page_index not in pages:
                _fail(f"segment_references_unknown_page: {page_index}")
            container = pages[page_index]["canonicalText"]
            expected_id = f"p{page_index}:{start}-{end}"

        if segment["segmentId"] != expected_id:
            _fail(
                f"segment_id_not_address_derived: declared={segment['segmentId']} "
                f"expected={expected_id}"
            )
        if end > code_point_length(container):
            _fail(f"span_out_of_container: {segment['segmentId']}")
        if container[start:end] != segment["exactExcerpt"]:
            _fail(f"exact_alignment_invariant_violated: {segment['segmentId']}")


def _assert_text_shape(artifact: dict[str, Any]) -> None:
    """Forma de una fuente `TEXT`.

    `pages: []` sin excepcion. Una pagina sintetica seria una afirmacion falsa
    sobre la fuente: un TextEvidence no tiene paginas que numerar, y fabricar
    una haria que una cita pudiera direccionarse contra algo que no existe.
    """
    if artifact["pages"]:
        _fail("text_source_must_have_no_pages")
    if artifact["sourceNormalizationApplied"] != NORMALIZATION_PRODUCT:
        _fail(
            f"text_source_normalization: declared="
            f"{artifact['sourceNormalizationApplied']} expected={NORMALIZATION_PRODUCT}"
        )

    empty = artifact["documentCanonicalText"] == ""
    declares_empty = any(
        entry["code"] == EMPTY_SOURCE_TEXT for entry in artifact["diagnostics"]
    )
    if empty and not declares_empty:
        _fail("empty_text_source_must_declare_EMPTY_SOURCE_TEXT")
    if declares_empty and not empty:
        _fail("EMPTY_SOURCE_TEXT_declared_on_non_empty_source")
    if empty and artifact["segments"]:
        _fail("empty_text_source_must_have_no_segments")


def _assert_diagnostics(artifact: dict[str, Any]) -> None:
    page_indexes = {page["pageIndex"] for page in artifact["pages"]}
    for entry in artifact["diagnostics"]:
        if entry["scope"] == "PAGE":
            if entry["pageIndex"] not in page_indexes:
                _fail(f"diagnostic_references_unknown_page: {entry['pageIndex']}")
        elif entry["pageIndex"] is not None:
            _fail(f"source_scoped_diagnostic_with_page_index: {entry['code']}")


def assert_local_invariants(artifact: dict[str, Any]) -> None:
    """Todo lo que JSON Schema no puede expresar, comprobado antes de devolver."""
    if artifact["schemaVersion"] != SCHEMA_VERSION:
        _fail(f"unexpected_schema_version: {artifact['schemaVersion']}")
    if artifact["offsetUnit"] != OFFSET_UNIT:
        _fail(f"unexpected_offset_unit: {artifact['offsetUnit']}")

    source_type = artifact["sourceType"]
    if source_type == SOURCE_TYPE_TEXT:
        _assert_text_shape(artifact)
        expected_coverage = derive_text_coverage(artifact["documentCanonicalText"])
    elif source_type == SOURCE_TYPE_PDF:
        _assert_pages(artifact)
        expected_coverage = derive_pdf_coverage(
            [page["pageObservationStatus"] for page in artifact["pages"]]
        )
    else:
        _fail(f"unknown_source_type: {source_type}")
        raise AssertionError  # inalcanzable; _fail siempre levanta

    _assert_segments(artifact)
    _assert_diagnostics(artifact)

    if artifact["coverageStatus"] != expected_coverage:
        _fail(
            f"coverage_status_inconsistent: declared={artifact['coverageStatus']} "
            f"expected={expected_coverage}"
        )

    expected_fingerprint = compute_artifact_fingerprint(artifact)
    if artifact["artifactContentFingerprint"] != expected_fingerprint:
        _fail(
            f"fingerprint_mismatch: declared={artifact['artifactContentFingerprint']} "
            f"expected={expected_fingerprint}"
        )
