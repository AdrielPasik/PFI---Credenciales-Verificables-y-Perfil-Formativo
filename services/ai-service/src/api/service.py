from __future__ import annotations

import os
from pathlib import Path
from typing import Any, BinaryIO


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SETTINGS_PATH = PROJECT_ROOT / "config" / "settings.json"
DEFAULT_MAX_PDF_BYTES = 25 * 1024 * 1024


class InvalidPdfUploadError(ValueError):
    """The uploaded body is not a usable PDF."""


class UnsupportedVersionError(ValueError):
    """The caller requested a pipeline or taxonomy version not served here."""


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

