"""Extraccion source-addressable — fundacion F0.

Camino PARALELO al extractor productivo existente (decision F0-D1). No importa
ni modifica `io_utils.py`, `text_utils.py`, `section_detector.py` ni
`pipeline.py`, y no cambia el comportamiento de `semantic_analysis_v1`.

Tampoco importa nada de `experiments/evidence_reasoning/`: ese experimento esta
congelado y sirve solo como referencia historica.

Alcance actual — F0.2 + F0.3::

    PDF bytes                     -> ExtractionArtifact (source_extraction_v1)
    contenido TextEvidence        -> ExtractionArtifact (source_extraction_v1)

Las dos clases de fuente comparten contrato, canonicalizacion, politica de
bloques, fingerprint y validacion local. NO comparten la regla de coverage: ver
`derive_pdf_coverage` contra `derive_text_coverage`.

Fuera de alcance todavia: verificacion cross-runtime (F0.4), trust gate en
NestJS (F0.5), persistencia, endpoints y cualquier cosa semantica.
"""

from __future__ import annotations

from .artifact import (
    COVERAGE_FAILED,
    COVERAGE_FULL,
    COVERAGE_PARTIAL,
    NORMALIZATION_NONE,
    NORMALIZATION_PRODUCT,
    OFFSET_UNIT,
    SOURCE_TYPE_PDF,
    SOURCE_TYPE_TEXT,
    STATUS_EXTRACTED,
    STATUS_FAILED,
    STATUS_OBSERVED_EMPTY,
    STATUS_UNOBSERVED_OR_UNEXTRACTABLE,
    assert_local_invariants,
    compute_artifact_fingerprint,
    derive_pdf_coverage,
    derive_text_coverage,
    material_projection,
)
from .canonical import CANONICALIZATION, canonical_json, canonical_preimage, fingerprint
from .errors import (
    ArtifactInvariantViolation,
    CanonicalJsonError,
    DependencyFingerprintUnavailable,
    LocalSourceShaMismatch,
    ProductNormalizationPreconditionViolated,
    SourceExtractionError,
)
from .identity import (
    IMPLEMENTATION_VERSION,
    PARSER_PDFPLUMBER,
    PARSER_PYPDF,
    PARSER_TEXT_DIRECT,
    SCHEMA_VERSION,
    dependency_fingerprint,
    pdf_extraction_identity,
    resolved_dependency_versions,
    text_extraction_identity,
)
from .normalization import (
    PRODUCT_NFC_LINEENDINGS_TRIM,
    is_product_normalized,
    product_normalize,
)
from .pdf import extract_pdf_source
from .segmentation import canonical_text, code_point_length
from .text import extract_text_source

__all__ = [
    "ArtifactInvariantViolation",
    "assert_local_invariants",
    "canonical_json",
    "canonical_preimage",
    "canonical_text",
    "CANONICALIZATION",
    "CanonicalJsonError",
    "code_point_length",
    "compute_artifact_fingerprint",
    "COVERAGE_FAILED",
    "COVERAGE_FULL",
    "COVERAGE_PARTIAL",
    "dependency_fingerprint",
    "DependencyFingerprintUnavailable",
    "derive_pdf_coverage",
    "derive_text_coverage",
    "extract_pdf_source",
    "extract_text_source",
    "fingerprint",
    "IMPLEMENTATION_VERSION",
    "is_product_normalized",
    "LocalSourceShaMismatch",
    "material_projection",
    "NORMALIZATION_NONE",
    "NORMALIZATION_PRODUCT",
    "OFFSET_UNIT",
    "PARSER_PDFPLUMBER",
    "PARSER_PYPDF",
    "PARSER_TEXT_DIRECT",
    "pdf_extraction_identity",
    "PRODUCT_NFC_LINEENDINGS_TRIM",
    "product_normalize",
    "ProductNormalizationPreconditionViolated",
    "resolved_dependency_versions",
    "SCHEMA_VERSION",
    "SOURCE_TYPE_PDF",
    "SOURCE_TYPE_TEXT",
    "SourceExtractionError",
    "STATUS_EXTRACTED",
    "STATUS_FAILED",
    "STATUS_OBSERVED_EMPTY",
    "STATUS_UNOBSERVED_OR_UNEXTRACTABLE",
    "text_extraction_identity",
]
