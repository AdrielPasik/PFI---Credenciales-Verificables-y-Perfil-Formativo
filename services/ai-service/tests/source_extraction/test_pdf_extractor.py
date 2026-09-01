"""Comportamiento del extractor de PDF — slice F0.2.

Las fuentes son PDFs deterministicos escritos a mano en
`tests/contracts/fixtures/source_extraction_v1/sources/`. Los fallos de parser
se inyectan con dobles en la frontera de parseo, no fabricando bytes corruptos:
el comportamiento de un PDF corrupto depende de la version del parser, y un test
que dependa de eso es un test que va a mentir en algun momento.
"""

from __future__ import annotations

import hashlib
from typing import Any

import pytest
from jsonschema import Draft202012Validator

from src.source_extraction import (
    COVERAGE_FAILED,
    COVERAGE_FULL,
    COVERAGE_PARTIAL,
    PARSER_PDFPLUMBER,
    PARSER_PYPDF,
    STATUS_EXTRACTED,
    STATUS_FAILED,
    STATUS_OBSERVED_EMPTY,
    STATUS_UNOBSERVED_OR_UNEXTRACTABLE,
    assert_local_invariants,
    extract_pdf_source,
)
from src.source_extraction import parsers as parser_module
from tests.source_extraction.conftest import SOURCES, extract, sha256_of, source_bytes

NBSP = chr(0x00A0)
TEST_TUBE = chr(0x1F9EA)

ALL_SOURCES = sorted(path.name for path in SOURCES.glob("*.pdf"))


def codes(artifact: dict[str, Any]) -> list[str]:
    return [entry["code"] for entry in artifact["diagnostics"]]


def statuses(artifact: dict[str, Any]) -> list[str]:
    return [page["pageObservationStatus"] for page in artifact["pages"]]


# ---------------------------------------------------------------------------
# Casos de coverage
# ---------------------------------------------------------------------------

def test_normal_multipage_pdf_is_full() -> None:
    artifact = extract("normal-multipage.pdf")
    assert artifact["coverageStatus"] == COVERAGE_FULL
    assert statuses(artifact) == [STATUS_EXTRACTED, STATUS_EXTRACTED]
    assert artifact["diagnostics"] == []
    assert artifact["segments"]


def test_blank_page_resolves_conservatively_to_partial() -> None:
    """Bajo `INITIAL_OBSERVED_EMPTY_SIGNAL: DEFERRED` una pagina en blanco
    degrada coverage. Es sub-afirmar observacion, no sobre-afirmarla."""
    artifact = extract("blank-page.pdf")
    assert statuses(artifact) == [STATUS_EXTRACTED, STATUS_UNOBSERVED_OR_UNEXTRACTABLE]
    assert artifact["coverageStatus"] == COVERAGE_PARTIAL
    assert codes(artifact) == ["PAGE_UNOBSERVED_OR_UNEXTRACTABLE"]


def test_scanned_page_is_never_observed_empty() -> None:
    """La asimetria que hace segura la rama conservadora (§6.3)."""
    artifact = extract("scanned-image-only-page.pdf")
    assert statuses(artifact) == [STATUS_EXTRACTED, STATUS_UNOBSERVED_OR_UNEXTRACTABLE]
    assert artifact["coverageStatus"] == COVERAGE_PARTIAL
    assert STATUS_OBSERVED_EMPTY not in statuses(artifact)


def test_fully_scanned_pdf_produces_a_failed_artifact() -> None:
    """`FAILED` significa OBSERVED_BUT_UNOBSERVABLE, no 'no existe evidencia'.

    El artifact existe para que Evidence Reasoning pueda llegar a ABSTAIN
    honestamente en vez de concluir que la fuente esta vacia.
    """
    artifact = extract("fully-scanned.pdf")
    assert artifact["coverageStatus"] == COVERAGE_FAILED
    assert statuses(artifact) == [STATUS_UNOBSERVED_OR_UNEXTRACTABLE] * 2
    assert codes(artifact) == [
        "PAGE_UNOBSERVED_OR_UNEXTRACTABLE",
        "PAGE_UNOBSERVED_OR_UNEXTRACTABLE",
        "SOURCE_NO_EXTRACTABLE_TEXT",
    ]
    assert artifact["segments"] == []


def test_encrypted_pdf_produces_a_failed_artifact_with_its_own_code() -> None:
    artifact = extract("encrypted.pdf")
    assert artifact["coverageStatus"] == COVERAGE_FAILED
    assert codes(artifact) == ["ENCRYPTED_PDF"]
    assert artifact["pages"] == []
    assert artifact["documentCanonicalText"] == ""


def test_malformed_source_produces_a_failed_artifact() -> None:
    artifact = extract("malformed.pdf")
    assert artifact["coverageStatus"] == COVERAGE_FAILED
    assert codes(artifact) == ["UNSUPPORTED_SOURCE"]


def test_encrypted_is_not_reported_as_merely_unsupported() -> None:
    """Un PDF cifrado tambien falla al parsearse; decirle `UNSUPPORTED_SOURCE`
    ocultaria la propiedad de la fuente que explica el fallo."""
    assert "UNSUPPORTED_SOURCE" not in codes(extract("encrypted.pdf"))
    assert "ENCRYPTED_PDF" not in codes(extract("malformed.pdf"))


# ---------------------------------------------------------------------------
# Politica de parser
# ---------------------------------------------------------------------------

def test_page_scoped_failure_degrades_the_page_without_switching_parser() -> None:
    """Degradacion por pagina: la pagina queda FAILED y el parserProfile NO cambia.

    Rellenarla con pypdf mezclaria dos espacios de direcciones dentro de un
    mismo artifact.
    """

    def failing_second_page(pdf_bytes: bytes) -> list[str | None]:
        pages = parser_module.read_with_pdfplumber(pdf_bytes)
        pages[1] = None
        return pages

    def never_called(pdf_bytes: bytes) -> list[str | None]:
        raise AssertionError("pypdf no debe invocarse ante un fallo con alcance de pagina")

    artifact = extract(
        "normal-multipage.pdf",
        parser_chain=((PARSER_PDFPLUMBER, failing_second_page), (PARSER_PYPDF, never_called)),
    )
    assert artifact["extractionIdentity"]["parserProfile"] == PARSER_PDFPLUMBER
    assert statuses(artifact) == [STATUS_EXTRACTED, STATUS_FAILED]
    assert artifact["coverageStatus"] == COVERAGE_PARTIAL
    assert codes(artifact) == ["PAGE_EXTRACTION_FAILED"]
    assert artifact["pages"][1]["canonicalText"] == ""
    assert all(segment["pageIndex"] == 0 for segment in artifact["segments"])


def test_source_level_failure_falls_back_to_pypdf_for_the_whole_source() -> None:
    def broken(pdf_bytes: bytes) -> list[str | None]:
        raise RuntimeError("fallo a nivel de fuente simulado")

    artifact = extract(
        "normal-multipage.pdf",
        parser_chain=((PARSER_PDFPLUMBER, broken), (PARSER_PYPDF, parser_module.read_with_pypdf)),
    )
    assert artifact["extractionIdentity"]["parserProfile"] == PARSER_PYPDF
    assert "PRIMARY_PARSER_FAILED_FELL_BACK" in codes(artifact)

    # Todo el texto del artifact proviene de pypdf, no solo las paginas que
    # pdfplumber no pudo dar.
    only_pypdf = extract(
        "normal-multipage.pdf",
        parser_chain=((PARSER_PYPDF, parser_module.read_with_pypdf),),
    )
    assert artifact["documentCanonicalText"] == only_pypdf["documentCanonicalText"]
    assert [page["canonicalText"] for page in artifact["pages"]] == [
        page["canonicalText"] for page in only_pypdf["pages"]
    ]


def test_fallback_diagnostic_does_not_affect_coverage() -> None:
    def broken(pdf_bytes: bytes) -> list[str | None]:
        raise RuntimeError("fallo a nivel de fuente simulado")

    artifact = extract(
        "normal-multipage.pdf",
        parser_chain=((PARSER_PDFPLUMBER, broken), (PARSER_PYPDF, parser_module.read_with_pypdf)),
    )
    entry = next(e for e in artifact["diagnostics"] if e["code"] == "PRIMARY_PARSER_FAILED_FELL_BACK")
    assert entry["affectsCoverage"] is False
    assert entry["severity"] == "WARNING"
    assert artifact["coverageStatus"] == COVERAGE_FULL


def test_fallback_is_not_declared_when_the_fallback_also_failed() -> None:
    """Si el fallback tampoco produjo nada, la identidad no cambio: decir que
    caimos al fallback seria enganoso."""
    artifact = extract("encrypted.pdf")
    assert "PRIMARY_PARSER_FAILED_FELL_BACK" not in codes(artifact)
    assert artifact["extractionIdentity"]["parserProfile"] == PARSER_PDFPLUMBER


def test_both_parsers_failing_is_deterministic() -> None:
    def broken(pdf_bytes: bytes) -> list[str | None]:
        raise ValueError("sin parser disponible")

    first = extract(
        "normal-multipage.pdf",
        parser_chain=((PARSER_PDFPLUMBER, broken), (PARSER_PYPDF, broken)),
    )
    second = extract(
        "normal-multipage.pdf",
        parser_chain=((PARSER_PDFPLUMBER, broken), (PARSER_PYPDF, broken)),
    )
    assert first == second
    assert first["coverageStatus"] == COVERAGE_FAILED
    assert codes(first) == ["SOURCE_UNREADABLE"]
    assert first["pages"] == []


def test_one_artifact_declares_exactly_one_parser_profile() -> None:
    for name in ALL_SOURCES:
        artifact = extract(name)
        assert artifact["extractionIdentity"]["parserProfile"] in {PARSER_PDFPLUMBER, PARSER_PYPDF}


def test_parser_selection_never_depends_on_the_text_obtained() -> None:
    """La cadena se recorre por condicion tecnica: el primero que produce un
    espacio de direcciones gana, aunque no rinda texto alguno."""
    empty_but_successful = lambda pdf_bytes: ["", ""]  # noqa: E731
    richer = lambda pdf_bytes: ["mucho texto", "mas texto"]  # noqa: E731

    artifact = extract(
        "normal-multipage.pdf",
        parser_chain=((PARSER_PDFPLUMBER, empty_but_successful), (PARSER_PYPDF, richer)),
    )
    assert artifact["extractionIdentity"]["parserProfile"] == PARSER_PDFPLUMBER
    assert artifact["coverageStatus"] == COVERAGE_FAILED


# ---------------------------------------------------------------------------
# Binding local de SHA
# ---------------------------------------------------------------------------

def test_tampered_bytes_produce_no_artifact_and_touch_no_parser() -> None:
    from src.source_extraction.errors import LocalSourceShaMismatch

    original = source_bytes("normal-multipage.pdf")
    tampered = original.replace(b"Bases de Datos", b"Bases de Dat0s")
    assert tampered != original

    def must_not_run(pdf_bytes: bytes) -> list[str | None]:
        raise AssertionError("ningun parser debe invocarse ante un mismatch de sha")

    with pytest.raises(LocalSourceShaMismatch) as error:
        extract_pdf_source(
            pdf_bytes=tampered,
            document_evidence_id="doc-tampered",
            source_sha256=sha256_of(original),
            storage_key="documents/normal-multipage.pdf",
            parser_chain=((PARSER_PDFPLUMBER, must_not_run), (PARSER_PYPDF, must_not_run)),
        )
    assert error.value.declared == sha256_of(original)
    assert error.value.computed == sha256_of(tampered)


def test_matching_bytes_bind_the_artifact_to_what_was_processed() -> None:
    data = source_bytes("normal-multipage.pdf")
    artifact = extract("normal-multipage.pdf")
    assert artifact["source"]["sourceSha256"] == hashlib.sha256(data).hexdigest()


def test_malformed_sha_argument_is_rejected_before_parsing() -> None:
    with pytest.raises(ValueError, match="sha256"):
        extract("normal-multipage.pdf", source_sha256="NO-ES-UN-SHA")


# ---------------------------------------------------------------------------
# Texto, paginas, offsets, segmentos
# ---------------------------------------------------------------------------

def test_page_indexes_and_numbers_are_consistent() -> None:
    artifact = extract("normal-multipage.pdf")
    assert [page["pageIndex"] for page in artifact["pages"]] == [0, 1]
    assert [page["pageNumber"] for page in artifact["pages"]] == [1, 2]


def test_page_offsets_follow_the_frozen_join_convention() -> None:
    artifact = extract("normal-multipage.pdf")
    first, second = artifact["pages"]
    assert first["pageOffsetStart"] == 0
    assert first["pageOffsetEnd"] == len(first["canonicalText"])
    assert second["pageOffsetStart"] == first["pageOffsetEnd"] + 2
    assert artifact["documentCanonicalText"] == "\n\n".join(
        page["canonicalText"] for page in artifact["pages"]
    )


def test_every_segment_satisfies_the_alignment_invariant() -> None:
    for name in ALL_SOURCES:
        artifact = extract(name)
        pages = {page["pageIndex"]: page["canonicalText"] for page in artifact["pages"]}
        for segment in artifact["segments"]:
            container = pages[segment["pageIndex"]]
            assert container[segment["charStart"] : segment["charEnd"]] == segment["exactExcerpt"]


def test_segment_ids_are_address_derived() -> None:
    for name in ALL_SOURCES:
        for segment in extract(name)["segments"]:
            expected = f"p{segment['pageIndex']}:{segment['charStart']}-{segment['charEnd']}"
            assert segment["segmentId"] == expected


def test_astral_offsets_are_code_points_not_utf16_units() -> None:
    artifact = extract("astral-unicode.pdf")
    text = artifact["pages"][0]["canonicalText"]
    assert TEST_TUBE in text
    assert len(text) == 3
    segment = artifact["segments"][0]
    assert segment["segmentId"] == "p0:0-3"
    assert text[segment["charStart"] : segment["charEnd"]] == segment["exactExcerpt"]
    # La misma direccion leida como code units UTF-16 daria otro excerpt.
    assert len(text.encode("utf-16-le")) // 2 == 4


def test_non_breaking_space_survives_the_extractor_on_the_parser_that_yields_it() -> None:
    """pdfminer pliega U+00A0 a espacio; pypdf lo conserva.

    Es una divergencia REAL entre parsers para los mismos bytes, y es justamente
    por lo que `parserProfile` esta dentro de `extractionIdentity`. Lo que este
    test fija es que el extractor no colapsa nada por su cuenta: si el parser lo
    entrega, llega intacto al artifact.
    """
    artifact = extract(
        "non-breaking-space.pdf",
        parser_chain=((PARSER_PYPDF, parser_module.read_with_pypdf),),
    )
    assert NBSP in artifact["pages"][0]["canonicalText"]


def test_extractor_applies_no_whitespace_collapse_or_normalization() -> None:
    noisy = "  Uno\t\tdos   tres  " + NBSP + "\n\n\n\nCuatro  "
    artifact = extract(
        "normal-multipage.pdf",
        parser_chain=((PARSER_PDFPLUMBER, lambda pdf_bytes: [noisy]),),
    )
    assert artifact["pages"][0]["canonicalText"] == noisy


def test_carriage_returns_are_normalized_and_nothing_else_is() -> None:
    raw = "Uno\r\nDos\rTres\t\tCuatro"
    artifact = extract(
        "normal-multipage.pdf",
        parser_chain=((PARSER_PDFPLUMBER, lambda pdf_bytes: [raw]),),
    )
    assert artifact["pages"][0]["canonicalText"] == "Uno\nDos\nTres\t\tCuatro"


# ---------------------------------------------------------------------------
# Identidad y fingerprint del artifact
# ---------------------------------------------------------------------------

def test_same_source_and_identity_give_the_same_artifact_fingerprint() -> None:
    first = extract("normal-multipage.pdf")
    second = extract("normal-multipage.pdf")
    assert first["artifactContentFingerprint"] == second["artifactContentFingerprint"]
    assert first == second


def test_dependency_drift_changes_the_artifact_fingerprint(monkeypatch: pytest.MonkeyPatch) -> None:
    """Mismo sourceSha256, misma implementationVersion, fingerprint distinto.

    Es la propiedad que vuelve la deriva de dependencias visible y atribuible en
    vez de silenciosa.
    """
    from src.source_extraction import identity as identity_module

    baseline = extract("normal-multipage.pdf")
    real = identity_module.metadata.version

    def drifted(package: str) -> str:
        return "20991231" if package == "pdfminer.six" else real(package)

    monkeypatch.setattr(identity_module.metadata, "version", drifted)
    drifted_artifact = extract("normal-multipage.pdf")

    assert drifted_artifact["source"]["sourceSha256"] == baseline["source"]["sourceSha256"]
    assert (
        drifted_artifact["extractionIdentity"]["implementationVersion"]
        == baseline["extractionIdentity"]["implementationVersion"]
    )
    assert (
        drifted_artifact["extractionIdentity"]["dependencyFingerprint"]
        != baseline["extractionIdentity"]["dependencyFingerprint"]
    )
    assert drifted_artifact["artifactContentFingerprint"] != baseline["artifactContentFingerprint"]


def test_parser_profile_change_changes_the_artifact_fingerprint() -> None:
    def broken(pdf_bytes: bytes) -> list[str | None]:
        raise RuntimeError("fallo a nivel de fuente simulado")

    primary = extract("normal-multipage.pdf")
    fallback = extract(
        "normal-multipage.pdf",
        parser_chain=((PARSER_PDFPLUMBER, broken), (PARSER_PYPDF, parser_module.read_with_pypdf)),
    )
    assert primary["artifactContentFingerprint"] != fallback["artifactContentFingerprint"]


def test_diagnostics_are_part_of_the_material_identity() -> None:
    """Una fuente que fallo una pagina no es materialmente la misma extraccion
    que una que no."""
    clean = extract(
        "normal-multipage.pdf",
        parser_chain=((PARSER_PDFPLUMBER, lambda pdf_bytes: ["Uno", "Dos"]),),
    )
    degraded = extract(
        "normal-multipage.pdf",
        parser_chain=((PARSER_PDFPLUMBER, lambda pdf_bytes: ["Uno", None]),),
    )
    assert clean["artifactContentFingerprint"] != degraded["artifactContentFingerprint"]


def test_detail_is_excluded_from_the_fingerprint_preimage() -> None:
    from src.source_extraction.artifact import material_projection

    artifact = extract("encrypted.pdf")
    projection = material_projection(artifact)
    assert all("detail" not in entry for entry in projection["diagnostics"])


# ---------------------------------------------------------------------------
# Validacion estructural
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("name", ALL_SOURCES)
def test_every_produced_artifact_validates_against_the_frozen_schema(
    name: str, schema_validator: Draft202012Validator
) -> None:
    errors = sorted(schema_validator.iter_errors(extract(name)), key=str)
    assert errors == [], [error.message for error in errors]


@pytest.mark.parametrize("name", ALL_SOURCES)
def test_every_produced_artifact_satisfies_the_local_invariants(name: str) -> None:
    assert_local_invariants(extract(name))


@pytest.mark.parametrize("name", ALL_SOURCES)
def test_produced_artifacts_also_satisfy_the_f01_reference_invariants(name: str) -> None:
    """Contraste contra la referencia solo-tests de F0.1, implementada aparte."""
    from tests.contracts.source_extraction_reference import assert_derived_invariants

    assert_derived_invariants(extract(name))


def test_no_almost_valid_artifact_can_escape() -> None:
    from src.source_extraction.errors import ArtifactInvariantViolation

    artifact = extract("normal-multipage.pdf")
    artifact["pages"][1]["pageNumber"] = 99
    with pytest.raises(ArtifactInvariantViolation, match="page_number_relation"):
        assert_local_invariants(artifact)


def test_tampered_fingerprint_is_rejected_locally() -> None:
    from src.source_extraction.errors import ArtifactInvariantViolation

    artifact = extract("normal-multipage.pdf")
    artifact["artifactContentFingerprint"] = "0" * 64
    with pytest.raises(ArtifactInvariantViolation, match="fingerprint_mismatch"):
        assert_local_invariants(artifact)


# ---------------------------------------------------------------------------
# Postura conservadora de OBSERVED_EMPTY
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("name", ALL_SOURCES)
def test_observed_empty_is_unreachable_from_f0_2(name: str) -> None:
    artifact = extract(name)
    assert STATUS_OBSERVED_EMPTY not in statuses(artifact)
    assert "PAGE_OBSERVED_EMPTY" not in codes(artifact)


def test_page_observed_empty_cannot_even_be_constructed() -> None:
    from src.source_extraction import diagnostics as diag

    with pytest.raises(ValueError, match="DEFERRED"):
        diag.diagnostic(diag.PAGE_OBSERVED_EMPTY, page_index=0)


def test_observed_empty_remains_representable_in_the_schema(
    schema_validator: Draft202012Validator,
) -> None:
    """Inalcanzable desde F0.2, pero valido en el contrato desde v1: la señal
    positiva puede aterrizar despues sin cambiar el schema."""
    import json

    from tests.source_extraction.conftest import CONTRACT_FIXTURES

    frozen = json.loads(
        (CONTRACT_FIXTURES / "valid" / "pdf-observed-empty-full.json").read_text(encoding="utf-8")
    )
    assert list(schema_validator.iter_errors(frozen)) == []
    assert STATUS_OBSERVED_EMPTY in [page["pageObservationStatus"] for page in frozen["pages"]]


# ---------------------------------------------------------------------------
# Privacidad de los diagnosticos
# ---------------------------------------------------------------------------

def test_diagnostic_detail_never_carries_document_content() -> None:
    """pdfminer emite mensajes como `invalid pdf header: b'Este '`, que citan
    bytes de la fuente. `detail` se construye con nombres de clase, nunca con
    `str(error)`."""
    artifact = extract("malformed.pdf")
    raw = source_bytes("malformed.pdf").decode("utf-8")
    for entry in artifact["diagnostics"]:
        detail = entry.get("detail")
        if detail is None:
            continue
        assert len(detail) <= 200
        for word in raw.split():
            if len(word) >= 4:
                assert word not in detail


def test_diagnostic_detail_respects_the_schema_bound() -> None:
    from src.source_extraction import diagnostics as diag

    entry = diag.diagnostic(diag.SOURCE_UNREADABLE, detail="x" * 500)
    assert len(entry["detail"]) == diag.DETAIL_MAX_LENGTH


def test_source_scoped_diagnostics_carry_null_page_index() -> None:
    for name in ALL_SOURCES:
        for entry in extract(name)["diagnostics"]:
            if entry["scope"] == "SOURCE":
                assert entry["pageIndex"] is None
            else:
                assert isinstance(entry["pageIndex"], int)
