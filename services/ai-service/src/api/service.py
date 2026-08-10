from __future__ import annotations

import os
from pathlib import Path
from typing import Any, BinaryIO, Mapping, Optional


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SETTINGS_PATH = PROJECT_ROOT / "config" / "settings.json"
DEFAULT_MAX_PDF_BYTES = 25 * 1024 * 1024

# C2b.1: por debajo de este largo (caracteres, tras trim) el texto se trata
# como "corto/no estructurado" — status nunca "completed", confidence
# topeada. 400 caracteres es aproximadamente un titulo + 2-3 oraciones de
# descripcion (el caso real de un course sin PDF), deliberadamente bajo
# para no exigir un ensayo para calificar como "con estructura".
TEXT_SHORT_LENGTH_THRESHOLD = 400

# Usado como sourceRefs.documentId (requerido y no vacio por el JSON Schema
# compartido) unicamente cuando el caller no provee ni textEvidenceId ni
# credentialId. No es un ID persistente ni estable entre llamadas.
DEFAULT_TEXT_FALLBACK_DOCUMENT_ID = "text-input"


class InvalidPdfUploadError(ValueError):
    """The uploaded body is not a usable PDF."""


class UnsupportedVersionError(ValueError):
    """The caller requested a pipeline or taxonomy version not served here."""


def _clean_optional_str(value: Any) -> Optional[str]:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def max_pdf_bytes() -> int:
    raw_value = os.getenv("AI_SERVICE_MAX_PDF_BYTES")
    if raw_value is None:
        return DEFAULT_MAX_PDF_BYTES
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise RuntimeError("AI_SERVICE_MAX_PDF_BYTES must be an integer") from exc
    if value <= 0:
        raise RuntimeError("AI_SERVICE_MAX_PDF_BYTES must be greater than zero")
    return value


def save_pdf_upload(source: BinaryIO, destination: Path) -> None:
    """Stream one uploaded PDF to a bounded temporary file."""
    total_bytes = 0
    header = b""
    limit = max_pdf_bytes()

    with destination.open("wb") as target:
        while chunk := source.read(1024 * 1024):
            if not header:
                header = chunk[:1024]
            total_bytes += len(chunk)
            if total_bytes > limit:
                raise InvalidPdfUploadError(f"PDF exceeds the {limit}-byte upload limit")
            target.write(chunk)

    if total_bytes == 0:
        raise InvalidPdfUploadError("Uploaded PDF is empty")
    if b"%PDF-" not in header:
        raise InvalidPdfUploadError("Uploaded file does not contain a PDF header")


def _assert_requested_versions(
    pipeline_version: str | None,
    taxonomy_version: str | None,
) -> None:
    from src.exporters.backend_contract import PIPELINE_VERSION, TAXONOMY_VERSION

    requested = (
        ("pipelineVersion", pipeline_version, PIPELINE_VERSION),
        ("taxonomyVersion", taxonomy_version, TAXONOMY_VERSION),
    )
    for field_name, requested_value, actual_value in requested:
        if requested_value and requested_value != actual_value:
            raise UnsupportedVersionError(
                f"{field_name}={requested_value!r} is not available; this service exposes {actual_value!r}"
            )


def analyze_academic_pdf(
    pdf_path: Path,
    *,
    document_id: str | None,
    file_name: str,
    pipeline_version: str | None,
    taxonomy_version: str | None,
) -> dict[str, Any]:
    """Run the existing single-file pipeline and contractual exporter."""
    _assert_requested_versions(pipeline_version, taxonomy_version)

    from src.config_loader import load_config
    from src.exporters.backend_contract import SOURCE_TYPE_ACADEMIC_PDF
    from src.exporters.backend_contract.semantic_analysis_exporter import export_semantic_analysis
    from src.pipeline import process_single_input

    result = process_single_input(
        config=load_config(SETTINGS_PATH),
        source_name=file_name,
        input_path=pdf_path,
    )
    record = {
        "raw_normalized": result.raw_normalized,
        "semantic_final": result.semantic_final,
    }
    fallback_document_id = document_id or Path(file_name).stem or pdf_path.stem
    artifact = export_semantic_analysis(
        record=record,
        source_type=SOURCE_TYPE_ACADEMIC_PDF,
        fallback_document_id=fallback_document_id,
        fallback_file_name=file_name,
    ).to_dict()

    # In HTTP mode an explicit backend document ID is the correlation key.
    if document_id:
        artifact["sourceRefs"]["documentId"] = document_id
    return artifact


def build_formative_profile(artifacts: list[dict[str, Any]]) -> dict[str, Any]:
    """Delegate unchanged artifacts to the existing contractual builder."""
    from src.profile_builder.formative_profile_result import build_formative_profile_result

    return build_formative_profile_result(artifacts)


def analyze_text(
    content: str,
    *,
    metadata: Mapping[str, Any] | None,
    source_refs: Mapping[str, Any] | None,
    pipeline_version: str | None,
    taxonomy_version: str | None,
) -> dict[str, Any]:
    """Run the existing pipeline against declared course text (no PDF).

    Reuses `process_single_input(manual_text=...)`, already able to accept
    raw text (used today only by the offline batch/CLI path). `metadata`
    (platformName/hours/modality/credentialType/languageHint) is accepted
    for the request contract but is intentionally never mixed into the
    text handed to the pipeline, and is not used to fabricate an
    `hoursDistribution` — only `content` is analyzable text. `externalUrl`
    is not part of this contract at all and is never fetched.
    """
    _assert_requested_versions(pipeline_version, taxonomy_version)

    from src.config_loader import load_config
    from src.exporters.backend_contract import SOURCE_TYPE_TEXT
    from src.exporters.backend_contract.semantic_analysis_exporter import export_semantic_analysis
    from src.pipeline import process_single_input

    result = process_single_input(
        config=load_config(SETTINGS_PATH),
        source_name=DEFAULT_TEXT_FALLBACK_DOCUMENT_ID,
        manual_text=content,
    )
    record = {
        "raw_normalized": result.raw_normalized,
        "semantic_final": result.semantic_final,
    }

    raw_sections = result.raw_normalized.get("raw_sections")
    no_curricular_sections_detected = not isinstance(raw_sections, dict) or set(raw_sections.keys()) <= {
        "contents_raw"
    }
    is_short_unstructured_text = len(content.strip()) < TEXT_SHORT_LENGTH_THRESHOLD

    resolved_source_refs = dict(source_refs or {})
    fallback_document_id = (
        _clean_optional_str(resolved_source_refs.get("textEvidenceId"))
        or _clean_optional_str(resolved_source_refs.get("credentialId"))
        or DEFAULT_TEXT_FALLBACK_DOCUMENT_ID
    )

    return export_semantic_analysis(
        record=record,
        source_type=SOURCE_TYPE_TEXT,
        fallback_document_id=fallback_document_id,
        source_refs=resolved_source_refs,
        text_quality={
            "short_unstructured_text": is_short_unstructured_text,
            "no_curricular_sections_detected": no_curricular_sections_detected,
        },
    ).to_dict()

