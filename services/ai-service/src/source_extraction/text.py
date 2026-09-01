"""Extractor source-addressable de TextEvidence — slice F0.3.

    persisted TextEvidence content -> ExtractionArtifact (source_extraction_v1)

Comparte el contrato de nivel superior con el extractor de PDF, discriminado por
`sourceType`. Comparte tambien la canonicalizacion, la politica de bloques, el
fingerprint y la validacion local. Lo que NO comparte, deliberadamente, es la
regla de coverage: aplicar la regla de PDF a una fuente `TEXT` —que siempre tiene
`pages: []`— daria `FAILED` para todo TextEvidence, exactamente al reves de lo
que dice el contrato. Por eso `derive_text_coverage` es una funcion aparte.

TRES DIFERENCIAS ESTRUCTURALES CON PDF

**No hay parser.** El contenido llega ya persistido y decodificado, asi que no
existe la clase de fallo que en PDF justifica el fallback, ni la degradacion por
pagina, ni `dependencyFingerprint`: ninguna dependencia de terceros interviene
entre los bytes y el texto. `parserProfile = TEXT_DIRECT` y la identidad tiene
tres campos, no cuatro.

**No hay paginas.** `pages: []`, sin pagina sintetica. Un TextEvidence no tiene
paginas que numerar, y fabricar una volveria direccionable algo que no existe.
El contenedor de las direcciones es el documento entero, con ids `d:{start}-{end}`.

**El vacio es `FULL`.** Una fuente `TEXT` leida por completo esta completamente
observada, incluso vacia: coverage mide completitud de observacion, no volumen.
El caso emite `EMPTY_SOURCE_TEXT` (INFO, no degrada coverage). Hoy es
inalcanzable desde la creacion productiva —`normalizeContent` rechaza el
contenido vacio— pero el contrato lo permite representar y esta funcion lo
soporta.

LA PRECONDICION QUE ESTE MODULO NO PUEDE VIOLAR

El artifact declara `sourceNormalizationApplied = PRODUCT_NFC_LINEENDINGS_TRIM`.
F0.3 VERIFICA esa afirmacion contra el contenido recibido; no la produce
normalizando. Ver `normalization.py` para por que `str.strip()` no sirve para
comprobarlo.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any

from . import diagnostics as diag
from .artifact import (
    NORMALIZATION_PRODUCT,
    OFFSET_UNIT,
    SOURCE_TYPE_TEXT,
    assert_local_invariants,
    compute_artifact_fingerprint,
    derive_text_coverage,
)
from .errors import LocalSourceShaMismatch, ProductNormalizationPreconditionViolated
from .identity import SCHEMA_VERSION, text_extraction_identity
from .normalization import describe_violation, is_product_normalized
from .segmentation import canonical_text, document_segments

_SHA256_HEX = re.compile(r"^[a-f0-9]{64}$")


def extract_text_source(
    *,
    content: str,
    text_evidence_id: str,
    source_sha256: str,
) -> dict[str, Any]:
    """Produce un `source_extraction_v1` a partir de un TextEvidence persistido.

    `content` debe ser el contenido YA persistido, no la entrada cruda del
    usuario: la normalizacion productiva ocurre en NestJS antes de guardar, y el
    `sourceSha256` almacenado cubre esa forma normalizada.

    Levanta:

        ProductNormalizationPreconditionViolated
            el contenido no es punto fijo de PRODUCT_NFC_LINEENDINGS_TRIM, asi
            que no puede declararse como tal

        LocalSourceShaMismatch
            el contenido no es el declarado

    En ambos casos NO se produce artifact. Es la misma linea de fallo que en PDF:
    la observacion imperfecta es un resultado, la observacion ausente es un
    fallo, y aca ni siquiera podemos establecer que estamos mirando la fuente que
    el run congelo.
    """
    if not isinstance(content, str):
        raise TypeError("content debe ser str, no bytes: el contenido persistido ya esta decodificado")
    if not text_evidence_id:
        raise ValueError("text_evidence_id no puede ser vacio")
    if not _SHA256_HEX.match(source_sha256):
        raise ValueError("source_sha256 debe ser sha256 hex en minuscula")

    # 1. Precondicion de forma. Va primero porque de ella depende que el artifact
    #    pueda declarar `PRODUCT_NFC_LINEENDINGS_TRIM` sin mentir.
    if not is_product_normalized(content):
        raise ProductNormalizationPreconditionViolated(describe_violation(content))

    # 2. Binding local de SHA sobre los bytes UTF-8 del contenido persistido,
    #    espejando `createHash('sha256').update(Buffer.from(content, 'utf8'))`
    #    de text-evidence.validator.ts. No reemplaza la autoridad de dominio de
    #    NestJS (F0.5), que repite la verificacion contra la fuente autoritativa.
    computed_sha256 = hashlib.sha256(content.encode("utf-8")).hexdigest()
    if computed_sha256 != source_sha256:
        raise LocalSourceShaMismatch(declared=source_sha256, computed=computed_sha256)

    # 3. Texto canonico. Para un contenido product-normalized la canonicalizacion
    #    de F0 es un no-op —los fines de linea ya son LF— pero se aplica igual,
    #    en vez de asumirlo: una sola definicion de texto canonico para las dos
    #    clases de fuente es lo que hace comparables sus direcciones.
    document = canonical_text(content)

    segments = document_segments(document)
    coverage = derive_text_coverage(document)

    entries: list[dict[str, Any]] = []
    if document == "":
        entries.append(diag.diagnostic(diag.EMPTY_SOURCE_TEXT))

    artifact: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "sourceType": SOURCE_TYPE_TEXT,
        "source": {
            "textEvidenceId": text_evidence_id,
            "sourceSha256": source_sha256,
        },
        "extractionIdentity": text_extraction_identity(),
        "sourceNormalizationApplied": NORMALIZATION_PRODUCT,
        "offsetUnit": OFFSET_UNIT,
        "coverageStatus": coverage,
        "pages": [],
        "documentCanonicalText": document,
        "segments": segments,
        "diagnostics": entries,
    }
    artifact["artifactContentFingerprint"] = compute_artifact_fingerprint(artifact)

    assert_local_invariants(artifact)
    return artifact
