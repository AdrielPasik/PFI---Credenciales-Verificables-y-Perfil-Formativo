"""Referencia SOLO PARA TESTS del contrato `source_extraction_v1`.

NO ES CODIGO PRODUCTIVO Y NO DEBE SER IMPORTADO POR CODIGO PRODUCTIVO.

Existe para congelar los golden fingerprints de F0.1 y para hacer cumplir en
tests los invariantes derivados que JSON Schema no puede expresar. Las
implementaciones productivas independientes en Python y en TypeScript son
entregable de F0.4, y su criterio de aceptacion es producir exactamente los
mismos bytes de preimage que este modulo.

Serializacion canonica congelada (`MINIMAL_DETERMINISTIC_JSON_V1`).

La especificacion define los BYTES primero. Python es la implementacion de
referencia, no la definicion: "json.dumps hace esto" no es normativo.

Estructura::

  claves de objeto   ordenadas ascendente por code point Unicode
  whitespace         ninguno (sin espacio tras ':' ni tras ',')
  enteros            decimal, sin ceros a la izquierda, sin signo, sin exponente
  booleanos          true / false
  null               null
  arrays             orden preservado (es semanticamente significativo)
  encoding final     UTF-8
  hash               SHA-256, hex minuscula

Escaping de strings, congelado caracter por caracter::

  U+0022 QUOTATION MARK        ->  \\"
  U+005C REVERSE SOLIDUS       ->  \\\\
  U+0008 BACKSPACE             ->  \\b
  U+0009 TAB                   ->  \\t
  U+000A LINE FEED             ->  \\n
  U+000C FORM FEED             ->  \\f
  U+000D CARRIAGE RETURN       ->  \\r
  todo otro U+0000..U+001F     ->  \\u00xx

Los digitos hexadecimales de la forma larga DEBEN ir en MINUSCULA::

  U+0000  ->  \\u0000
  U+0001  ->  \\u0001
  U+000B  ->  \\u000b
  U+001E  ->  \\u001e
  U+001F  ->  \\u001f          (nunca \\u001F)

`\\u001f` y `\\u001F` representan el mismo JSON semanticamente, pero producen
preimages distintos y por lo tanto fingerprints distintos. Solo la forma en
minuscula es valida.

Fuera del rango de control::

  U+007F DELETE                ->  caracter literal, NO escapado
  cualquier no-ASCII           ->  literal, serializado como UTF-8 al final,
                                   NUNCA escapado como \\uXXXX
  surrogates UTF-16 sueltos    ->  ENTRADA INVALIDA (ver assert_well_formed_unicode)

Estas reglas resultan implementadas por::

    json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))

pero esa llamada es la implementacion de referencia, no la especificacion. La
contraparte TypeScript de F0.4 debe implementar las reglas de arriba de forma
independiente y demostrar igualdad byte a byte contra el golden vector de
`fixtures/source_extraction_v1/canonical-json-golden-vector.json`.

Se eligieron estas reglas en vez de RFC 8785 porque la material projection
contiene solo strings, enteros no negativos, booleanos, nulls, arrays y objetos
— nunca floats — asi que la parte dificil de JCS (serializacion de numeros ES6)
no llega a aplicarse, y un serializador recursivo chico basta en ambos runtimes
sin agregar una dependencia.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

FINGERPRINT_HASH = "SHA-256"
FINGERPRINT_PREIMAGE_ENCODING = "UTF-8"
FINGERPRINT_CANONICALIZATION = "MINIMAL_DETERMINISTIC_JSON_V1"

PAGE_JOIN = "\n\n"


class ArtifactInvariantError(AssertionError):
    """Un invariante derivado del contrato no se cumple."""


# ---------------------------------------------------------------------------
# Serializacion canonica
# ---------------------------------------------------------------------------

def canonical_json(payload: Any) -> str:
    return json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def canonical_preimage(payload: Any) -> bytes:
    return canonical_json(payload).encode("utf-8")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def code_point_length(text: str) -> int:
    """Largo en code points Unicode. En Python 3 `len(str)` ya lo es; la funcion
    existe para que el contrato quede explicito y para que la contraparte
    TypeScript de F0.4 no caiga en `String.prototype.length` (UTF-16)."""
    return len(text)


# ---------------------------------------------------------------------------
# Material projection
# ---------------------------------------------------------------------------

def material_projection(artifact: dict[str, Any]) -> dict[str, Any]:
    """Proyeccion material congelada sobre la que se calcula el fingerprint.

    Excluye por construccion: ids de fila, timestamps, UUIDs, diagnostic.detail
    y el propio `artifactContentFingerprint`. Incluye deliberadamente los
    diagnosticos: una fuente que fallo una pagina no es materialmente la misma
    extraccion que una que no.

    Excluye tambien los campos derivados (`documentCanonicalText`,
    `pageOffsetStart`, `pageOffsetEnd`) porque su consistencia se valida
    deterministicamente en `assert_derived_invariants`.
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
                "code": diagnostic["code"],
                "severity": diagnostic["severity"],
                "scope": diagnostic["scope"],
                "pageIndex": diagnostic["pageIndex"],
                "affectsCoverage": diagnostic["affectsCoverage"],
            }
            for diagnostic in artifact["diagnostics"]
        ],
    }


def compute_fingerprint(artifact: dict[str, Any]) -> str:
    return sha256_hex(canonical_preimage(material_projection(artifact)))


# ---------------------------------------------------------------------------
# Invariantes derivados
# ---------------------------------------------------------------------------

def assert_well_formed_unicode(artifact: dict[str, Any]) -> None:
    """Sin surrogates sueltos en ningun texto del artifact.

    Un surrogate suelto haria divergir el preimage entre Python y TypeScript,
    asi que un artifact que lo contenga es invalido por contrato en vez de
    ambiguo.
    """
    texts = [artifact["documentCanonicalText"]]
    texts += [page["canonicalText"] for page in artifact["pages"]]
    texts += [segment["exactExcerpt"] for segment in artifact["segments"]]
    for text in texts:
        try:
            text.encode("utf-8")
        except UnicodeEncodeError as error:
            raise ArtifactInvariantError(f"lone_surrogate_in_artifact_text: {error}") from error


def assert_derived_invariants(artifact: dict[str, Any]) -> None:
    """Hace cumplir los invariantes que JSON Schema no puede expresar.

    Un artifact cuya material projection es valida pero cuyos campos derivados
    la contradicen debe ser rechazado (§11B del diseño).
    """
    assert_well_formed_unicode(artifact)
    source_type = artifact["sourceType"]

    if source_type == "TEXT":
        if artifact["pages"]:
            raise ArtifactInvariantError("text_source_must_have_no_pages")
    else:
        _assert_pdf_page_invariants(artifact)

    _assert_segment_invariants(artifact)
    _assert_coverage_invariant(artifact)

    expected = compute_fingerprint(artifact)
    if artifact["artifactContentFingerprint"] != expected:
        raise ArtifactInvariantError(
            f"fingerprint_mismatch: declared={artifact['artifactContentFingerprint']} expected={expected}"
        )


def _assert_pdf_page_invariants(artifact: dict[str, Any]) -> None:
    pages = artifact["pages"]
    offset = 0
    for position, page in enumerate(pages):
        if page["pageIndex"] != position:
            raise ArtifactInvariantError(
                f"page_index_not_sequential: position={position} pageIndex={page['pageIndex']}"
            )
        if page["pageNumber"] != page["pageIndex"] + 1:
            raise ArtifactInvariantError(
                f"page_number_relation: pageIndex={page['pageIndex']} pageNumber={page['pageNumber']}"
            )
        if page["pageOffsetStart"] != offset:
            raise ArtifactInvariantError(
                f"page_offset_start: pageIndex={page['pageIndex']} "
                f"declared={page['pageOffsetStart']} expected={offset}"
            )
        expected_end = offset + code_point_length(page["canonicalText"])
        if page["pageOffsetEnd"] != expected_end:
            raise ArtifactInvariantError(
                f"page_offset_end: pageIndex={page['pageIndex']} "
                f"declared={page['pageOffsetEnd']} expected={expected_end}"
            )
        offset = expected_end + code_point_length(PAGE_JOIN)

    expected_document = PAGE_JOIN.join(page["canonicalText"] for page in pages)
    if artifact["documentCanonicalText"] != expected_document:
        raise ArtifactInvariantError("document_canonical_text_does_not_match_pages")


def _assert_segment_invariants(artifact: dict[str, Any]) -> None:
    source_type = artifact["sourceType"]
    pages = {page["pageIndex"]: page for page in artifact["pages"]}

    for segment in artifact["segments"]:
        start, end = segment["charStart"], segment["charEnd"]
        if end < start:
            raise ArtifactInvariantError(f"reversed_span: {segment['segmentId']}")

        if source_type == "TEXT":
            if segment["pageIndex"] is not None:
                raise ArtifactInvariantError("text_segment_must_have_null_page_index")
            container = artifact["documentCanonicalText"]
            expected_id = f"d:{start}-{end}"
        else:
            page_index = segment["pageIndex"]
            if page_index not in pages:
                raise ArtifactInvariantError(f"segment_references_unknown_page: {page_index}")
            container = pages[page_index]["canonicalText"]
            expected_id = f"p{page_index}:{start}-{end}"

        if segment["segmentId"] != expected_id:
            raise ArtifactInvariantError(
                f"segment_id_not_address_derived: declared={segment['segmentId']} expected={expected_id}"
            )
        if end > code_point_length(container):
            raise ArtifactInvariantError(f"span_out_of_container: {segment['segmentId']}")
        if container[start:end] != segment["exactExcerpt"]:
            raise ArtifactInvariantError(
                f"exact_alignment_invariant_violated: {segment['segmentId']}"
            )


def _assert_coverage_invariant(artifact: dict[str, Any]) -> None:
    """coverage mide completitud de observacion, no cuanto texto salio."""
    if artifact["sourceType"] == "TEXT":
        # Una fuente TEXT completamente leida esta completamente observada,
        # incluso vacia. Nunca FAILED por estar vacia (§10.1 del diseño).
        return

    statuses = [page["pageObservationStatus"] for page in artifact["pages"]]
    if not statuses:
        return

    observed = {"EXTRACTED", "OBSERVED_EMPTY"}
    degraded = {"UNOBSERVED_OR_UNEXTRACTABLE", "FAILED"}
    has_substantive = any(status == "EXTRACTED" for status in statuses)
    all_observed = all(status in observed for status in statuses)
    any_degraded = any(status in degraded for status in statuses)

    if all_observed:
        expected = "FULL"
    elif has_substantive and any_degraded:
        expected = "PARTIAL"
    else:
        expected = "FAILED"

    if artifact["coverageStatus"] != expected:
        raise ArtifactInvariantError(
            f"coverage_status_inconsistent: declared={artifact['coverageStatus']} expected={expected}"
        )


def finalize(artifact: dict[str, Any]) -> dict[str, Any]:
    """Rellena `artifactContentFingerprint` y valida los invariantes derivados.

    Usado solo por fixtures y tests para congelar goldens.
    """
    completed = {**artifact, "artifactContentFingerprint": compute_fingerprint(artifact)}
    assert_derived_invariants(completed)
    return completed
