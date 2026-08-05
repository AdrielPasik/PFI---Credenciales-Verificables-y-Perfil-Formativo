from __future__ import annotations

from fastapi.testclient import TestClient

from src.api.main import app


client = TestClient(app)


def _small_text_pdf(text: str) -> bytes:
    escaped_text = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream = f"BT /F1 11 Tf 72 720 Td ({escaped_text}) Tj ET".encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]

    payload = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(payload))
        payload.extend(f"{index} 0 obj\n".encode("ascii"))
        payload.extend(obj)
        payload.extend(b"\nendobj\n")

    xref_offset = len(payload)
    payload.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    payload.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        payload.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    payload.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("ascii")
    )
    return bytes(payload)


def test_pdf_endpoint_processes_one_small_pdf_without_persisting_outputs() -> None:
    pdf = _small_text_pdf(
        "PROGRAMACION I OBJETIVOS desarrollar algoritmos CONTENIDOS variables estructuras de control funciones"
    )
    response = client.post(
        "/v1/semantic-analysis/pdf",
        files={"file": ("programacion.pdf", pdf, "application/pdf")},
        data={"documentId": "backend-doc-123", "fileName": "programacion.pdf"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["schemaVersion"] == "semantic_analysis_v1"
    assert body["sourceType"] == "academic_pdf"
    assert body["sourceRefs"] == {
        "documentId": "backend-doc-123",
        "fileName": "programacion.pdf",
    }


def test_pdf_endpoint_reports_missing_file() -> None:
    response = client.post("/v1/semantic-analysis/pdf")

    assert response.status_code == 422
    assert response.json()["detail"]


def test_pdf_endpoint_rejects_non_pdf_bytes() -> None:
    response = client.post(
        "/v1/semantic-analysis/pdf",
        files={"file": ("not-a-pdf.pdf", b"plain text", "application/pdf")},
    )

    assert response.status_code == 400
    assert "PDF header" in response.json()["detail"]


def test_pdf_endpoint_rejects_unsupported_requested_version() -> None:
    pdf = _small_text_pdf("PROGRAMACION CONTENIDOS algoritmos variables funciones")
    response = client.post(
        "/v1/semantic-analysis/pdf",
        files={"file": ("programacion.pdf", pdf, "application/pdf")},
        data={"pipelineVersion": "future-version"},
    )

    assert response.status_code == 409
    assert "unversioned_current" in response.json()["detail"]

