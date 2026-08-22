from __future__ import annotations

from pathlib import Path

from experiments.evidence_reasoning.extraction import extract_pdf, extract_text_source, verify_excerpt
from experiments.evidence_reasoning.models import SourceInput


def _write_minimal_text_pdf(path: Path, pages: list[str]) -> None:
    objects: list[bytes] = []
    page_ids = [3 + index * 2 for index in range(len(pages))]
    font_id = 3 + len(pages) * 2
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    kids = " ".join(f"{item} 0 R" for item in page_ids)
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>".encode())
    for index, text in enumerate(pages):
        page_id = page_ids[index]
        content_id = page_id + 1
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content_id} 0 R >>".encode()
        )
        escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        stream = f"BT /F1 12 Tf 72 720 Td ({escaped}) Tj ET".encode("latin-1")
        objects.append(f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    payload = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for object_id, body in enumerate(objects, start=1):
        offsets.append(len(payload))
        payload.extend(f"{object_id} 0 obj\n".encode() + body + b"\nendobj\n")
    xref = len(payload)
    payload.extend(f"xref\n0 {len(objects) + 1}\n".encode())
    payload.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        payload.extend(f"{offset:010d} 00000 n \n".encode())
    payload.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    path.write_bytes(payload)


def test_text_extraction_preserves_sha_offsets_and_coverage() -> None:
    source = SourceInput(
        "source-1", "credential-1", "TEXT_EVIDENCE", "Línea uno.\n\nLínea dos.", "FULL", "INSTITUTIONALLY_DECLARED"
    )
    snapshot = extract_text_source(source)
    assert snapshot["coverageStatus"] == "FULL"
    assert len(snapshot["source"]["sourceSha256"]) == 64
    for segment in snapshot["segments"]:
        assert verify_excerpt(snapshot, segment["charStart"], segment["charEnd"], segment["exactExcerpt"])


def test_text_extraction_never_hides_partial_fixture() -> None:
    source = SourceInput(
        "source-2", "credential-2", "TEXT_EVIDENCE", "texto incompleto", "PARTIAL", "INSTITUTIONALLY_DECLARED"
    )
    snapshot = extract_text_source(source)
    assert snapshot["coverageStatus"] == "PARTIAL"
    assert snapshot["diagnostics"] == ["fixture_declares_incomplete_source"]


def test_real_pdf_extraction_is_page_aware(tmp_path: Path) -> None:
    pdf_path = tmp_path / "synthetic.pdf"
    _write_minimal_text_pdf(pdf_path, ["Pagina uno REST", "Pagina dos SQL"])
    snapshot = extract_pdf(
        pdf_path,
        source_id="pdf-source",
        credential_id="pdf-credential",
        source_provenance="INSTITUTIONALLY_DECLARED",
    )
    assert snapshot["coverageStatus"] == "FULL"
    assert [page["pageNumber"] for page in snapshot["pages"]] == [1, 2]
    assert {segment["pageNumber"] for segment in snapshot["segments"]} == {1, 2}
    assert "Pagina uno REST" in snapshot["canonicalText"]
    assert "Pagina dos SQL" in snapshot["canonicalText"]

