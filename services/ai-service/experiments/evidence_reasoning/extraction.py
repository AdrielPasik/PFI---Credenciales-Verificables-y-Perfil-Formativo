from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from .models import CoverageStatus, SourceInput
from .versions import VERSIONS


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonicalize_text(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _segments_for_text(text: str, *, page_number: int | None, prefix: str) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    cursor = 0
    for index, block in enumerate(text.split("\n\n"), start=1):
        if not block:
            cursor += 2
            continue
        start = text.find(block, cursor)
        end = start + len(block)
        segments.append(
            {
                "segmentId": f"{prefix}-seg-{index}",
                "pageNumber": page_number,
                "charStart": start,
                "charEnd": end,
                "exactExcerpt": text[start:end],
                "sectionLabel": None,
            }
        )
        cursor = end
    if text and not segments:
        segments.append(
            {
                "segmentId": f"{prefix}-seg-1",
                "pageNumber": page_number,
                "charStart": 0,
                "charEnd": len(text),
                "exactExcerpt": text,
                "sectionLabel": None,
            }
        )
    return segments


def extract_text_source(source: SourceInput) -> dict[str, Any]:
    original = source.content.encode("utf-8")
    canonical = canonicalize_text(source.content)
    coverage = CoverageStatus(source.coverage_status)
    diagnostics = list(source.diagnostics)
    if coverage != CoverageStatus.FULL and not diagnostics:
        diagnostics.append("fixture_declares_incomplete_source")
    return {
        "schemaVersion": VERSIONS["extractionSchema"],
        "extractionVersion": VERSIONS["extractionImplementation"],
        "source": {
            "sourceId": source.source_id,
            "credentialId": source.credential_id,
            "evidenceType": source.evidence_type,
            "sourceSha256": sha256_bytes(original),
            "sourceProvenance": source.source_provenance,
            "lineageId": source.lineage_id,
            "technicallyVerified": source.technically_verified,
        },
        "coverageStatus": coverage.value,
        "canonicalText": canonical,
        "pages": [],
        "segments": _segments_for_text(canonical, page_number=None, prefix=source.source_id),
        "diagnostics": diagnostics,
    }


def extract_pdf(path: Path, *, source_id: str, credential_id: str, source_provenance: str) -> dict[str, Any]:
    payload = path.read_bytes()
    pages: list[dict[str, Any]] = []
    diagnostics: list[str] = []
    parser = "pdfplumber"
    try:
        import pdfplumber

        with pdfplumber.open(path) as pdf:
            extracted = [(page.extract_text() or "") for page in pdf.pages]
    except Exception as first_error:
        parser = "pypdf"
        diagnostics.append(f"pdfplumber_failed:{type(first_error).__name__}")
        from pypdf import PdfReader

        extracted = [(page.extract_text() or "") for page in PdfReader(str(path)).pages]

    nonempty = 0
    global_offset = 0
    all_segments: list[dict[str, Any]] = []
    for number, raw_text in enumerate(extracted, start=1):
        canonical = canonicalize_text(raw_text)
        if canonical.strip():
            nonempty += 1
        else:
            diagnostics.append(f"page_without_extractable_text:{number}")
        page_segments = _segments_for_text(canonical, page_number=number, prefix=f"{source_id}-p{number}")
        for segment in page_segments:
            segment["pageCharStart"] = segment["charStart"]
            segment["pageCharEnd"] = segment["charEnd"]
            segment["charStart"] += global_offset
            segment["charEnd"] += global_offset
        pages.append(
            {
                "pageNumber": number,
                "canonicalText": canonical,
                "pageOffsetStart": global_offset,
                "pageOffsetEnd": global_offset + len(canonical),
            }
        )
        all_segments.extend(page_segments)
        global_offset += len(canonical) + 2

    if not extracted or nonempty == 0:
        coverage = CoverageStatus.FAILED
    elif nonempty != len(extracted):
        coverage = CoverageStatus.PARTIAL
    else:
        coverage = CoverageStatus.FULL
    return {
        "schemaVersion": VERSIONS["extractionSchema"],
        "extractionVersion": VERSIONS["extractionImplementation"],
        "source": {
            "sourceId": source_id,
            "credentialId": credential_id,
            "evidenceType": "DOCUMENT_PDF",
            "sourceSha256": sha256_bytes(payload),
            "sourceProvenance": source_provenance,
            "lineageId": None,
            "technicallyVerified": False,
        },
        "coverageStatus": coverage.value,
        "canonicalText": "\n\n".join(page["canonicalText"] for page in pages),
        "pages": pages,
        "segments": all_segments,
        "diagnostics": [f"parser:{parser}", *diagnostics],
    }


def materialize_sources(sources: tuple[SourceInput, ...]) -> list[dict[str, Any]]:
    return [extract_text_source(source) for source in sources]


def verify_excerpt(snapshot: dict[str, Any], start: int, end: int, excerpt: str) -> bool:
    text = snapshot["canonicalText"]
    return 0 <= start <= end <= len(text) and text[start:end] == excerpt

