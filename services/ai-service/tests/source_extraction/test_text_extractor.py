"""Comportamiento del extractor de TextEvidence — slice F0.3."""

from __future__ import annotations

import hashlib
import json
from typing import Any

import pytest
from jsonschema import Draft202012Validator

from src.source_extraction import (
    COVERAGE_FULL,
    IMPLEMENTATION_VERSION,
    NORMALIZATION_PRODUCT,
    PARSER_TEXT_DIRECT,
    SCHEMA_VERSION,
    SOURCE_TYPE_TEXT,
    assert_local_invariants,
    extract_text_source,
)
from src.source_extraction.errors import (
    ArtifactInvariantViolation,
    LocalSourceShaMismatch,
    ProductNormalizationPreconditionViolated,
)
from tests.source_extraction.conftest import CONTRACT_FIXTURES, SOURCES

NBSP = chr(0x00A0)
ZWSP = chr(0x200B)
TEST_TUBE = chr(0x1F9EA)
N_TILDE = chr(0x00F1)
O_ACUTE = chr(0x00F3)


def sha_of(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def extract(content: str, *, text_evidence_id: str = "text-001", **overrides: Any) -> dict[str, Any]:
    arguments: dict[str, Any] = {
        "content": content,
        "text_evidence_id": text_evidence_id,
        "source_sha256": sha_of(content),
    }
    arguments.update(overrides)
    return extract_text_source(**arguments)


def codes(artifact: dict[str, Any]) -> list[str]:
    return [entry["code"] for entry in artifact["diagnostics"]]


SIMPLE = "Curso de introduccion a Kubernetes."
PARAGRAPHS = "Primer bloque del temario.\n\nSegundo bloque del temario."


# ---------------------------------------------------------------------------
# Forma del artifact
# ---------------------------------------------------------------------------

def test_simple_text_is_full() -> None:
    artifact = extract(SIMPLE)
    assert artifact["sourceType"] == SOURCE_TYPE_TEXT
    assert artifact["coverageStatus"] == COVERAGE_FULL
    assert artifact["diagnostics"] == []
    assert artifact["documentCanonicalText"] == SIMPLE


def test_text_source_never_has_pages() -> None:
    """Ni siquiera una página sintética: un TextEvidence no tiene páginas que
    numerar, y fabricar una volvería direccionable algo que no existe."""
    for content in (SIMPLE, PARAGRAPHS, ""):
        assert extract(content)["pages"] == []


def test_extraction_identity_is_text_direct_with_three_fields() -> None:
    identity = extract(SIMPLE)["extractionIdentity"]
    assert identity == {
        "schemaVersion": SCHEMA_VERSION,
        "implementationVersion": IMPLEMENTATION_VERSION,
        "parserProfile": PARSER_TEXT_DIRECT,
    }


def test_dependency_fingerprint_is_structurally_absent() -> None:
    """No `null`, no reutilizado del PDF: ausente.

    Un campo nullable no distinguiría "no aplica" de "me olvidé de calcularlo", y
    reutilizar el fingerprint de PDF haría que la identidad de un TextEvidence
    cambiara al actualizar pdfminer, que no interviene en nada.
    """
    assert "dependencyFingerprint" not in extract(SIMPLE)["extractionIdentity"]


def test_source_ref_carries_text_evidence_id_not_document_evidence_id() -> None:
    artifact = extract(SIMPLE, text_evidence_id="text-abc-123")
    assert artifact["source"] == {
        "textEvidenceId": "text-abc-123",
        "sourceSha256": sha_of(SIMPLE),
    }
    assert "documentEvidenceId" not in artifact["source"]
    assert "storageKey" not in artifact["source"]


def test_source_normalization_is_declared_as_product_normalized() -> None:
    assert extract(SIMPLE)["sourceNormalizationApplied"] == NORMALIZATION_PRODUCT


def test_offset_unit_is_code_points() -> None:
    assert extract(SIMPLE)["offsetUnit"] == "UNICODE_CODE_POINT"


# ---------------------------------------------------------------------------
# TEXT vacío — caso contractual
# ---------------------------------------------------------------------------

def test_empty_text_is_full_with_zero_evidence() -> None:
    """Completamente observada y genuinamente sin nada. Nunca `FAILED`.

    `FAILED` significaría "no pudimos leer el contenido", y eso ya no es un
    artifact degradado sino la ausencia de artifact.
    """
    artifact = extract("")
    assert artifact["coverageStatus"] == COVERAGE_FULL
    assert artifact["pages"] == []
    assert artifact["segments"] == []
    assert artifact["documentCanonicalText"] == ""


def test_empty_text_emits_empty_source_text_as_info() -> None:
    entries = extract("")["diagnostics"]
    assert len(entries) == 1
    assert entries[0] == {
        "code": "EMPTY_SOURCE_TEXT",
        "severity": "INFO",
        "scope": "SOURCE",
        "pageIndex": None,
        "affectsCoverage": False,
    }


def test_empty_text_validates_against_schema_and_invariants(
    schema_validator: Draft202012Validator,
) -> None:
    artifact = extract("")
    assert list(schema_validator.iter_errors(artifact)) == []
    assert_local_invariants(artifact)


def test_empty_source_text_is_not_emitted_for_non_empty_content() -> None:
    assert "EMPTY_SOURCE_TEXT" not in codes(extract(SIMPLE))


def test_the_pdf_empty_rule_is_not_applied_to_text() -> None:
    """La regla de PDF daría `FAILED` para todo TEXT, que siempre tiene pages: []."""
    from src.source_extraction import derive_pdf_coverage, derive_text_coverage

    assert derive_pdf_coverage([]) == "FAILED"
    assert derive_text_coverage("") == "FULL"
    assert extract("")["coverageStatus"] == "FULL"


# ---------------------------------------------------------------------------
# Texto canónico — preservación exacta
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    ("label", "content"),
    [
        ("simple", SIMPLE),
        ("parrafos", PARAGRAPHS),
        ("bloques repetidos", "repetido\n\nrepetido\n\nrepetido"),
        ("nbsp interno", "Carga horaria: 40" + NBSP + "horas de practica"),
        ("zwsp en el borde", ZWSP + "Contenido con ancho cero" + ZWSP),
        ("astral", "Ensayo " + TEST_TUBE + " de laboratorio"),
        ("acentos NFC", "Programaci" + O_ACUTE + "n avanzada en dise" + N_TILDE + "o"),
        ("tabs internos", "Uno\t\tdos   tres"),
        ("multiples lineas en blanco", "Uno\n\n\n\nDos"),
    ],
)
def test_content_is_preserved_exactly(label: str, content: str) -> None:
    assert extract(content)["documentCanonicalText"] == content, label


def test_internal_non_breaking_space_survives() -> None:
    """Acá no hay parser de PDF que pueda plegarlo.

    En PDF, pdfminer pliega U+00A0 a espacio; para TEXT el contenido llega ya
    decodificado y nada puede tocarlo.
    """
    content = "Carga horaria: 40" + NBSP + "horas"
    artifact = extract(content)
    assert NBSP in artifact["documentCanonicalText"]
    assert artifact["documentCanonicalText"] == content


def test_no_normalization_is_applied_by_the_extractor() -> None:
    """Contenido con NBSP y ZWSP internos: ni colapso, ni strip, ni NFKC."""
    content = "Uno" + NBSP + ZWSP + "   dos\t\ttres"
    assert extract(content)["documentCanonicalText"] == content


# ---------------------------------------------------------------------------
# Segmentación relativa al documento
# ---------------------------------------------------------------------------

def test_segment_ids_use_the_document_prefix() -> None:
    ids = [segment["segmentId"] for segment in extract(PARAGRAPHS)["segments"]]
    assert ids == ["d:0-26", "d:28-55"]
    assert all(identifier.startswith("d:") for identifier in ids)
    assert not any("seg-" in identifier for identifier in ids)


def test_every_segment_has_null_page_index() -> None:
    for segment in extract(PARAGRAPHS)["segments"]:
        assert segment["pageIndex"] is None


def test_alignment_invariant_holds_against_the_document() -> None:
    content = "Primer bloque.\n\nSegundo con espacio duro:" + NBSP + "40h.\n\n" + TEST_TUBE + " tercero."
    artifact = extract(content)
    document = artifact["documentCanonicalText"]
    assert artifact["segments"]
    for segment in artifact["segments"]:
        assert document[segment["charStart"] : segment["charEnd"]] == segment["exactExcerpt"]


def test_repeated_identical_blocks_get_distinct_addresses() -> None:
    """Con `str.find` los tres bloques colapsarían a la misma dirección."""
    artifact = extract("repetido\n\nrepetido\n\nrepetido")
    ids = [segment["segmentId"] for segment in artifact["segments"]]
    assert ids == ["d:0-8", "d:10-18", "d:20-28"]
    assert len(set(ids)) == 3
    for segment in artifact["segments"]:
        assert segment["exactExcerpt"] == "repetido"


def test_astral_offsets_are_code_points_not_utf16_units() -> None:
    content = "A" + TEST_TUBE + "B\n\nsegundo bloque"
    artifact = extract(content)
    first, second = artifact["segments"]
    assert first["segmentId"] == "d:0-3"
    assert first["exactExcerpt"] == "A" + TEST_TUBE + "B"
    assert second["segmentId"] == "d:5-19"
    # Leído como code units UTF-16 la misma dirección daría otro excerpt.
    assert len(content.encode("utf-16-le")) // 2 > len(content)


def test_segment_ids_are_verifiable_against_their_own_coordinates() -> None:
    for segment in extract(PARAGRAPHS)["segments"]:
        assert segment["segmentId"] == f"d:{segment['charStart']}-{segment['charEnd']}"


# ---------------------------------------------------------------------------
# Binding local de SHA
# ---------------------------------------------------------------------------

def test_sha_matches_the_productive_hashing_rule() -> None:
    """SHA-256 sobre los bytes UTF-8 del contenido persistido, espejando
    `createHash('sha256').update(Buffer.from(content, 'utf8'))`."""
    content = "Contenido con " + N_TILDE + " y " + TEST_TUBE
    artifact = extract(content)
    assert artifact["source"]["sourceSha256"] == hashlib.sha256(content.encode("utf-8")).hexdigest()


def test_sha_mismatch_produces_no_artifact() -> None:
    with pytest.raises(LocalSourceShaMismatch) as error:
        extract(SIMPLE, source_sha256=sha_of("otro contenido distinto"))
    assert error.value.computed == sha_of(SIMPLE)


def test_malformed_sha_argument_is_rejected() -> None:
    with pytest.raises(ValueError, match="sha256"):
        extract(SIMPLE, source_sha256="NO-ES-UN-SHA")


def test_empty_text_evidence_id_is_rejected() -> None:
    with pytest.raises(ValueError, match="text_evidence_id"):
        extract(SIMPLE, text_evidence_id="")


def test_bytes_input_is_rejected() -> None:
    """El contenido persistido ya está decodificado; recibir bytes sería una
    confusión de capa que terminaría en un sha calculado sobre otra cosa."""
    with pytest.raises(TypeError, match="str"):
        extract_text_source(
            content=b"bytes",  # type: ignore[arg-type]
            text_evidence_id="text-001",
            source_sha256="0" * 64,
        )


# ---------------------------------------------------------------------------
# Precondición de entrada product-normalized
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    ("label", "content", "stage"),
    [
        ("NFD sin componer", "Programacio" + chr(0x0301) + "n", "not_nfc"),
        ("CRLF", "Uno\r\nDos", "line_endings_not_normalized"),
        ("CR suelto", "Uno\rDos", "line_endings_not_normalized"),
        ("espacios ASCII en los bordes", "   Uno   ", "not_trimmed"),
        ("TAB en el borde", "\tUno", "not_trimmed"),
        ("LF en el borde", "Uno\n", "not_trimmed"),
        ("NBSP en el borde", NBSP + "Uno", "not_trimmed"),
        ("BOM en el borde", chr(0xFEFF) + "Uno", "not_trimmed"),
        ("U+2028 en el borde", chr(0x2028) + "Uno", "not_trimmed"),
        ("U+3000 en el borde", chr(0x3000) + "Uno", "not_trimmed"),
    ],
)
def test_non_product_normalized_input_produces_no_artifact(
    label: str, content: str, stage: str
) -> None:
    """Estos contenidos no representan un `TextEvidence.content` persistido.

    Si F0.3 los aceptara, el artifact declararía `PRODUCT_NFC_LINEENDINGS_TRIM`
    sobre algo que no lo es — una afirmación falsa sobre su propia fuente.
    """
    with pytest.raises(ProductNormalizationPreconditionViolated) as error:
        extract(content)
    assert error.value.stage == stage, label


def test_precondition_is_checked_before_the_sha() -> None:
    """El orden importa para el mensaje: un contenido no normalizado tampoco
    tendría un sha válido, y reportar el sha ocultaría la causa real."""
    with pytest.raises(ProductNormalizationPreconditionViolated):
        extract_text_source(
            content="  Uno  ",
            text_evidence_id="text-001",
            source_sha256=sha_of("  Uno  "),
        )


def test_the_extractor_never_substitutes_the_normalized_form() -> None:
    """No arregla la entrada: la rechaza.

    Normalizar acá desalinearía el binding, porque el `sourceSha256` cubre la
    forma persistida y no la que produciríamos nosotros.
    """
    from src.source_extraction import product_normalize

    raw = "   Uno   "
    assert product_normalize(raw) == "Uno"
    with pytest.raises(ProductNormalizationPreconditionViolated):
        extract(raw)


def test_zero_width_space_at_the_boundary_is_accepted() -> None:
    """U+200B es Cf, no Zs: ECMAScript no lo recorta, así que es punto fijo."""
    content = ZWSP + "Contenido valido" + ZWSP
    assert extract(content)["documentCanonicalText"] == content


def test_precondition_error_never_carries_the_content() -> None:
    secret = "  Informe medico confidencial del titular  "
    with pytest.raises(ProductNormalizationPreconditionViolated) as error:
        extract(secret)
    message = str(error.value)
    for word in secret.split():
        assert word not in message


def test_every_fixed_point_case_of_the_vector_is_accepted() -> None:
    """Cierra el ciclo: aceptado SI Y SOLO SI es punto fijo del normalizador real."""
    vector = json.loads(
        (CONTRACT_FIXTURES / "text-evidence-normalization-parity-vector.json").read_text(
            encoding="utf-8"
        )
    )
    accepted = rejected = 0
    for case in vector["cases"]:
        content = "".join(chr(point) for point in case["rawCodePoints"])
        if case["isNormalizedFixedPoint"]:
            artifact = extract(content)
            assert artifact["documentCanonicalText"] == content, case["name"]
            accepted += 1
        else:
            with pytest.raises(ProductNormalizationPreconditionViolated):
                extract(content)
            rejected += 1
    assert accepted and rejected


# ---------------------------------------------------------------------------
# Fingerprint y validación estructural
# ---------------------------------------------------------------------------

def test_fingerprint_is_deterministic() -> None:
    assert extract(PARAGRAPHS) == extract(PARAGRAPHS)


def test_fingerprint_uses_the_shared_producer() -> None:
    from src.source_extraction import compute_artifact_fingerprint

    artifact = extract(PARAGRAPHS)
    assert artifact["artifactContentFingerprint"] == compute_artifact_fingerprint(artifact)


def test_material_projection_shape_for_text() -> None:
    from src.source_extraction import material_projection

    projection = material_projection(extract(PARAGRAPHS))
    assert set(projection) == {
        "sourceSha256",
        "sourceNormalizationApplied",
        "extractionIdentity",
        "offsetUnit",
        "coverageStatus",
        "pages",
        "segments",
        "diagnostics",
    }
    assert projection["pages"] == []
    assert "dependencyFingerprint" not in projection["extractionIdentity"]


def test_different_content_gives_a_different_fingerprint() -> None:
    first = extract(SIMPLE)["artifactContentFingerprint"]
    second = extract(PARAGRAPHS)["artifactContentFingerprint"]
    assert first != second


@pytest.mark.parametrize(
    "content",
    ["", SIMPLE, PARAGRAPHS, "repetido\n\nrepetido", "Uno" + NBSP + "dos", TEST_TUBE + " emoji"],
)
def test_every_produced_artifact_validates_against_the_schema(
    content: str, schema_validator: Draft202012Validator
) -> None:
    errors = sorted(schema_validator.iter_errors(extract(content)), key=str)
    assert errors == [], [error.message for error in errors]


@pytest.mark.parametrize("content", ["", SIMPLE, PARAGRAPHS, "Uno" + NBSP + "dos"])
def test_every_produced_artifact_satisfies_the_f01_reference_invariants(content: str) -> None:
    from tests.contracts.source_extraction_reference import assert_derived_invariants

    assert_derived_invariants(extract(content))


def test_a_synthetic_page_is_rejected_by_the_invariants() -> None:
    artifact = extract(SIMPLE)
    artifact["pages"] = [
        {
            "pageIndex": 0,
            "pageNumber": 1,
            "canonicalText": SIMPLE,
            "pageOffsetStart": 0,
            "pageOffsetEnd": len(SIMPLE),
            "pageObservationStatus": "EXTRACTED",
        }
    ]
    with pytest.raises(ArtifactInvariantViolation, match="text_source_must_have_no_pages"):
        assert_local_invariants(artifact)


def test_a_pdf_style_segment_id_is_rejected_for_text() -> None:
    artifact = extract(PARAGRAPHS)
    artifact["segments"][0]["segmentId"] = "p0:0-25"
    with pytest.raises(ArtifactInvariantViolation, match="segment_id_not_address_derived"):
        assert_local_invariants(artifact)


def test_a_non_null_page_index_is_rejected_for_text() -> None:
    artifact = extract(PARAGRAPHS)
    artifact["segments"][0]["pageIndex"] = 0
    with pytest.raises(ArtifactInvariantViolation, match="text_segment_must_have_null_page_index"):
        assert_local_invariants(artifact)


def test_empty_source_text_missing_on_empty_content_is_rejected() -> None:
    artifact = extract("")
    artifact["diagnostics"] = []
    with pytest.raises(ArtifactInvariantViolation, match="must_declare_EMPTY_SOURCE_TEXT"):
        assert_local_invariants(artifact)


def test_empty_source_text_declared_on_non_empty_content_is_rejected() -> None:
    from src.source_extraction import diagnostics as diag

    artifact = extract(SIMPLE)
    artifact["diagnostics"] = [diag.diagnostic(diag.EMPTY_SOURCE_TEXT)]
    with pytest.raises(ArtifactInvariantViolation, match="declared_on_non_empty_source"):
        assert_local_invariants(artifact)


def test_tampered_fingerprint_is_rejected() -> None:
    artifact = extract(SIMPLE)
    artifact["artifactContentFingerprint"] = "0" * 64
    with pytest.raises(ArtifactInvariantViolation, match="fingerprint_mismatch"):
        assert_local_invariants(artifact)


# ---------------------------------------------------------------------------
# Las source fixtures de texto de F0.1
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "name", ["simple-text-evidence.txt", "normalized-text-evidence.txt"]
)
def test_frozen_text_source_fixtures_extract_cleanly(
    name: str, schema_validator: Draft202012Validator
) -> None:
    content = (SOURCES / name).read_text(encoding="utf-8")
    artifact = extract(content, text_evidence_id=f"text-{name}")
    assert artifact["coverageStatus"] == COVERAGE_FULL
    assert artifact["documentCanonicalText"] == content
    assert list(schema_validator.iter_errors(artifact)) == []


def test_the_normalized_fixture_keeps_its_internal_hard_space() -> None:
    content = (SOURCES / "normalized-text-evidence.txt").read_text(encoding="utf-8")
    assert NBSP in content
    assert NBSP in extract(content)["documentCanonicalText"]
