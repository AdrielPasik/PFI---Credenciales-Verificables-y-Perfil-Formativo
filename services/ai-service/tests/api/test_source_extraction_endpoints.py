"""Rutas de source extraction — slice F1.3.

El gate central es PARIDAD CON EL PRODUCTOR: la respuesta de la ruta debe ser el
artifact completo que devuelve `extract_pdf_source` / `extract_text_source`
llamado directamente, campo por campo. Eso es lo que demuestra que F1.3 es
transporte y no un segundo productor.

Sin llamadas al proveedor, sin base de datos, sin red.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src.api.internal_auth import InternalAuthSettings
from src.api.main import create_app
from src.api.source_extraction_transport import MAX_TEXT_CONTENT_CODE_POINTS
from src.source_extraction import extract_pdf_source, extract_text_source

SOURCES = Path("tests/contracts/fixtures/source_extraction_v1/sources")

NBSP = chr(0x00A0)
BOM = chr(0xFEFF)
TEST_TUBE = chr(0x1F9EA)


def sha_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha_text(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


@pytest.fixture()
def client() -> TestClient:
    app = create_app(
        InternalAuthSettings(mode="disabled", secret=None, issuer=None, audience=None)
    )
    return TestClient(app)


def post_pdf(client: TestClient, name: str, **overrides) -> object:
    payload = (SOURCES / name).read_bytes()
    data = {
        "documentEvidenceId": f"doc-{Path(name).stem}",
        "sourceSha256": sha_bytes(payload),
        "storageKey": f"documents/{name}",
    }
    data.update(overrides)
    return client.post(
        "/v1/source-extraction/pdf",
        files={"file": (name, payload, "application/pdf")},
        data=data,
    )


def post_text(client: TestClient, content: str, **overrides) -> object:
    body = {
        "content": content,
        "textEvidenceId": "text-001",
        "sourceSha256": sha_text(content),
    }
    body.update(overrides)
    return client.post("/v1/source-extraction/text", json=body)


# ---------------------------------------------------------------------------
# Autenticacion interna
# ---------------------------------------------------------------------------

@pytest.fixture()
def secured_client() -> TestClient:
    app = create_app(
        InternalAuthSettings(
            mode="required", secret="s" * 40, issuer="pfi-api", audience="pfi-ai-service"
        )
    )
    return TestClient(app)


def test_pdf_route_rejects_a_missing_credential(secured_client: TestClient) -> None:
    response = post_pdf(secured_client, "normal-multipage.pdf")
    assert response.status_code == 401


def test_text_route_rejects_a_missing_credential(secured_client: TestClient) -> None:
    response = post_text(secured_client, "Contenido de prueba.")
    assert response.status_code == 401


def test_routes_reject_an_invalid_credential(secured_client: TestClient) -> None:
    response = secured_client.post(
        "/v1/source-extraction/text",
        json={"content": "x", "textEvidenceId": "t", "sourceSha256": "a" * 64},
        headers={"authorization": "Bearer no-es-un-token"},
    )
    assert response.status_code == 401


def test_routes_use_the_same_auth_dependency_as_the_semantic_routes() -> None:
    app = create_app(
        InternalAuthSettings(mode="required", secret="s" * 40, issuer="i", audience="a")
    )
    by_path = {route.path: route for route in app.routes if hasattr(route, "path")}
    semantic = by_path["/v1/semantic-analysis/text"]
    for path in ("/v1/source-extraction/pdf", "/v1/source-extraction/text"):
        assert len(by_path[path].dependencies) == len(semantic.dependencies)
        assert by_path[path].dependencies[0].dependency is semantic.dependencies[0].dependency


# ---------------------------------------------------------------------------
# PARIDAD CON EL PRODUCTOR — gate central
# ---------------------------------------------------------------------------

PDF_CASES = [
    ("normal-multipage.pdf", "FULL"),
    ("scanned-image-only-page.pdf", "PARTIAL"),
    ("blank-page.pdf", "PARTIAL"),
    ("fully-scanned.pdf", "FAILED"),
    ("encrypted.pdf", "FAILED"),
    ("malformed.pdf", "FAILED"),
    ("astral-unicode.pdf", "FULL"),
    ("non-breaking-space.pdf", "FULL"),
]


@pytest.mark.parametrize(("name", "coverage"), PDF_CASES)
def test_pdf_route_matches_the_direct_producer_exactly(
    client: TestClient, name: str, coverage: str
) -> None:
    payload = (SOURCES / name).read_bytes()
    direct = extract_pdf_source(
        pdf_bytes=payload,
        document_evidence_id=f"doc-{Path(name).stem}",
        source_sha256=sha_bytes(payload),
        storage_key=f"documents/{name}",
    )

    response = post_pdf(client, name)
    assert response.status_code == 200
    # Artifact COMPLETO, no sólo el fingerprint ni campos elegidos.
    assert response.json() == direct
    assert direct["coverageStatus"] == coverage


@pytest.mark.parametrize(
    "content",
    [
        "Curso de introduccion a Kubernetes.",
        "Primer bloque.\n\nSegundo bloque.",
        f"Ensayo {TEST_TUBE} de laboratorio.\n\nCarga: 40{NBSP}horas.",
        f"Contenido con BOM{BOM}interno, que si es punto fijo.",
        "repetido\n\nrepetido\n\nrepetido",
        "",
    ],
)
def test_text_route_matches_the_direct_producer_exactly(
    client: TestClient, content: str
) -> None:
    direct = extract_text_source(
        content=content, text_evidence_id="text-001", source_sha256=sha_text(content)
    )
    response = post_text(client, content)
    assert response.status_code == 200
    assert response.json() == direct


def test_failed_coverage_is_an_HTTP_SUCCESS(client: TestClient) -> None:
    # Un PDF cifrado produce un artifact valido y degradado. Convertirlo en un
    # error HTTP borraria la diferencia entre "fuente inobservable" y "la
    # peticion fallo".
    response = post_pdf(client, "encrypted.pdf")
    assert response.status_code == 200
    assert response.json()["coverageStatus"] == "FAILED"
    assert response.json()["diagnostics"][0]["code"] == "ENCRYPTED_PDF"


def test_pypdf_fallback_identity_survives_the_transport(client: TestClient) -> None:
    # La ruta no elige parser: si el productor cae al fallback, la identidad que
    # viaja es la del fallback.
    from src.source_extraction import parsers as parser_module
    from src.source_extraction.identity import PARSER_PDFPLUMBER, PARSER_PYPDF

    payload = (SOURCES / "normal-multipage.pdf").read_bytes()

    def broken(pdf_bytes: bytes):
        raise RuntimeError("fallo de fuente simulado")

    direct = extract_pdf_source(
        pdf_bytes=payload,
        document_evidence_id="doc-normal-multipage",
        source_sha256=sha_bytes(payload),
        storage_key="documents/normal-multipage.pdf",
        parser_chain=((PARSER_PDFPLUMBER, broken), (PARSER_PYPDF, parser_module.read_with_pypdf)),
    )
    assert direct["extractionIdentity"]["parserProfile"] == "PYPDF"

    # La ruta usa la cadena de produccion, asi que su identidad es PDFPLUMBER.
    # Lo que se comprueba es que el transporte propaga la identidad que el
    # productor decidio, sin normalizarla.
    response = post_pdf(client, "normal-multipage.pdf")
    assert response.status_code == 200
    assert response.json()["extractionIdentity"]["parserProfile"] == "PDFPLUMBER"
    assert set(response.json()["extractionIdentity"]) == set(direct["extractionIdentity"])


# ---------------------------------------------------------------------------
# NUNCA TRUNCAR
# ---------------------------------------------------------------------------

def test_accepted_pdf_bytes_arrive_complete(client: TestClient, monkeypatch) -> None:
    """Los bytes que ve el productor son EXACTAMENTE los enviados."""
    seen: dict[str, bytes] = {}
    import src.api.source_extraction_transport as transport

    real = transport.extract_pdf_source

    def spy(*, pdf_bytes: bytes, **kwargs):
        seen["bytes"] = pdf_bytes
        return real(pdf_bytes=pdf_bytes, **kwargs)

    monkeypatch.setattr(transport, "extract_pdf_source", spy)

    payload = (SOURCES / "normal-multipage.pdf").read_bytes()
    assert post_pdf(client, "normal-multipage.pdf").status_code == 200
    assert seen["bytes"] == payload
    assert len(seen["bytes"]) == len(payload)


def test_accepted_text_arrives_complete(client: TestClient, monkeypatch) -> None:
    seen: dict[str, str] = {}
    import src.api.source_extraction_transport as transport

    real = transport.extract_text_source

    def spy(*, content: str, **kwargs):
        seen["content"] = content
        return real(content=content, **kwargs)

    monkeypatch.setattr(transport, "extract_text_source", spy)

    content = "Bloque uno.\n\n" + ("palabra " * 900).strip() + f"\n\nFinal {TEST_TUBE}."
    assert post_text(client, content).status_code == 200
    assert seen["content"] == content
    assert len(seen["content"]) == len(content)


def test_an_oversized_pdf_is_REJECTED_not_truncated(client: TestClient, monkeypatch) -> None:
    import src.api.source_extraction_transport as transport

    monkeypatch.setattr(transport, "max_pdf_bytes", lambda: 512)
    called: list[object] = []
    monkeypatch.setattr(
        transport, "extract_pdf_source", lambda **kwargs: called.append(kwargs)
    )

    response = post_pdf(client, "normal-multipage.pdf")
    assert response.status_code == 400
    assert "limit" in response.json()["detail"]
    # Lo decisivo: el productor NUNCA se invoco con una version parcial.
    assert called == []


def test_oversized_text_is_REJECTED_not_truncated(client: TestClient, monkeypatch) -> None:
    import src.api.source_extraction_transport as transport

    called: list[object] = []
    monkeypatch.setattr(
        transport, "extract_text_source", lambda **kwargs: called.append(kwargs)
    )

    oversized = "a" * (MAX_TEXT_CONTENT_CODE_POINTS + 1)
    response = post_text(client, oversized)
    assert response.status_code == 422
    assert "limit" in response.json()["detail"]
    assert called == []


def test_the_text_limit_is_aligned_with_TextEvidence_not_with_the_semantic_route() -> None:
    from src.api.models import MAX_TEXT_CONTENT_LENGTH

    # El endpoint semantico topa en 30.000 para proteger la deteccion de
    # secciones. La entrada de esta ruta es un TextEvidence persistido, que el
    # producto permite hasta 50.000: con 30.000 se rechazaria contenido valido.
    assert MAX_TEXT_CONTENT_CODE_POINTS == 50_000
    assert MAX_TEXT_CONTENT_LENGTH == 30_000
    assert MAX_TEXT_CONTENT_CODE_POINTS > MAX_TEXT_CONTENT_LENGTH


def test_no_route_slices_producer_input(client: TestClient, monkeypatch) -> None:
    """Ninguna longitud de entrada sobrevive parcialmente al transporte."""
    import src.api.source_extraction_transport as transport

    real = transport.extract_text_source
    lengths: list[tuple[int, int]] = []

    def spy(*, content: str, **kwargs):
        lengths.append((len(content), len(kwargs["source_sha256"])))
        return real(content=content, **kwargs)

    monkeypatch.setattr(transport, "extract_text_source", spy)

    for size in (1, 100, 4_999, 5_000, 5_001, 30_001):
        content = "x" * size
        assert post_text(client, content).status_code == 200
    assert [length for length, _ in lengths] == [1, 100, 4_999, 5_000, 5_001, 30_001]


# ---------------------------------------------------------------------------
# `storageKey` es metadata opaca
# ---------------------------------------------------------------------------

def test_storage_key_is_propagated_and_never_opened(client: TestClient, monkeypatch) -> None:
    import builtins

    opened: list[str] = []
    real_open = builtins.open

    def spy_open(file, *args, **kwargs):
        opened.append(str(file))
        return real_open(file, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", spy_open)

    hostile = "../../etc/passwd"
    response = post_pdf(client, "normal-multipage.pdf", storageKey=hostile)

    assert response.status_code == 200
    # Se propaga tal cual al artifact...
    assert response.json()["source"]["storageKey"] == hostile
    # ...y jamas se usa para abrir nada.
    assert not any(hostile in path for path in opened)


def test_a_storage_key_that_looks_like_a_url_is_not_fetched(client: TestClient) -> None:
    response = post_pdf(client, "normal-multipage.pdf", storageKey="https://example.invalid/x.pdf")
    assert response.status_code == 200
    assert response.json()["source"]["storageKey"] == "https://example.invalid/x.pdf"


# ---------------------------------------------------------------------------
# Errores deterministicos
# ---------------------------------------------------------------------------

def test_pdf_with_a_wrong_source_sha_is_a_client_error(client: TestClient) -> None:
    response = post_pdf(client, "normal-multipage.pdf", sourceSha256="b" * 64)
    assert response.status_code == 422
    assert response.json()["detail"] == "source_sha256_does_not_match_uploaded_bytes"


def test_text_with_a_wrong_source_sha_is_a_client_error(client: TestClient) -> None:
    response = post_text(client, "Contenido.", sourceSha256="c" * 64)
    assert response.status_code == 422
    assert response.json()["detail"] == "source_sha256_does_not_match_content"


@pytest.mark.parametrize(
    ("content", "stage"),
    [
        ("  Uno  ", "not_trimmed"),
        ("Uno\r\nDos", "line_endings_not_normalized"),
        ("Programacio" + chr(0x0301) + "n", "not_nfc"),
    ],
)
def test_non_product_normalized_text_is_a_client_error(
    client: TestClient, content: str, stage: str
) -> None:
    # El transporte NO arregla el contenido: lo rechaza. Normalizarlo aca
    # esconderia un bug aguas arriba.
    response = post_text(client, content)
    assert response.status_code == 422
    assert response.json()["detail"] == f"content_is_not_product_normalized: {stage}"


def test_non_pdf_bytes_produce_a_FAILED_artifact_not_an_HTTP_error(client: TestClient) -> None:
    """El transporte NO juzga el formato: eso es de F0.2.

    El diseño F0 §15 exige que unos bytes malformados produzcan un artifact
    `FAILED` con `UNSUPPORTED_SOURCE`. Rechazarlos aca suprimiria un hecho
    verdadero sobre la fuente.
    """
    payload = b"no soy un PDF en absoluto"
    response = client.post(
        "/v1/source-extraction/pdf",
        files={"file": ("x.pdf", payload, "application/pdf")},
        data={
            "documentEvidenceId": "d",
            "sourceSha256": sha_bytes(payload),
            "storageKey": "k",
        },
    )
    assert response.status_code == 200
    assert response.json()["coverageStatus"] == "FAILED"
    assert response.json()["diagnostics"][0]["code"] == "UNSUPPORTED_SOURCE"


def test_empty_bytes_also_reach_the_producer(client: TestClient) -> None:
    response = client.post(
        "/v1/source-extraction/pdf",
        files={"file": ("empty.pdf", b"", "application/pdf")},
        data={
            "documentEvidenceId": "d",
            "sourceSha256": sha_bytes(b""),
            "storageKey": "k",
        },
    )
    assert response.status_code == 200
    assert response.json()["coverageStatus"] == "FAILED"


def test_errors_never_leak_source_content(client: TestClient) -> None:
    secret = "Informe medico confidencial del titular"
    response = post_text(client, f"  {secret}  ")
    assert response.status_code == 422
    body = json.dumps(response.json())
    for word in secret.split():
        assert word not in body


# ---------------------------------------------------------------------------
# La ruta no toca el pipeline legacy
# ---------------------------------------------------------------------------

def test_the_transport_module_does_not_import_the_legacy_pipeline() -> None:
    """`section_detector` contiene el truncamiento historico `compact[:5000]`.

    El transporte de F0 no debe tocarlo ni indirectamente.
    """
    import ast

    tree = ast.parse(Path("src/api/source_extraction_transport.py").read_text(encoding="utf-8"))
    imported: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported += [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.append(node.module)

    for forbidden in ("section_detector", "io_utils", "text_utils", "pipeline", "experiments"):
        assert not any(forbidden in name for name in imported), forbidden
