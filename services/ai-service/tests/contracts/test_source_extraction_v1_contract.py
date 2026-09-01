"""Tests de contrato de `source_extraction_v1` — slice F0.1.

Solo contrato y schema. Ningun test de comportamiento de extraccion: eso es F0.2.
No importa nada de `experiments/evidence_reasoning/` ni de codigo productivo de
extraccion.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator

from tests.contracts.source_extraction_reference import (
    ArtifactInvariantError,
    FINGERPRINT_CANONICALIZATION,
    FINGERPRINT_HASH,
    FINGERPRINT_PREIMAGE_ENCODING,
    assert_derived_invariants,
    canonical_json,
    canonical_preimage,
    code_point_length,
    compute_fingerprint,
    material_projection,
    sha256_hex,
)

SCHEMA_FILE = "source_extraction_v1.schema.json"
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "source_extraction_v1"


def _repository_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "packages" / "schemas").is_dir():
            return parent
    raise RuntimeError("Could not locate packages/schemas from AI Service tests")


def _schema() -> dict[str, Any]:
    return json.loads(
        (_repository_root() / "packages" / "schemas" / SCHEMA_FILE).read_text(encoding="utf-8")
    )


def _validator() -> Draft202012Validator:
    schema = _schema()
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def _load(folder: str, name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / folder / f"{name}.json").read_text(encoding="utf-8"))


def _names(folder: str) -> list[str]:
    return sorted(path.stem for path in (FIXTURES / folder).glob("*.json"))


VALID = _names("valid")
INVALID_SCHEMA = _names("invalid-schema")
INVALID_INVARIANT = _names("invalid-invariant")


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

def test_schema_is_valid_draft_2020_12() -> None:
    Draft202012Validator.check_schema(_schema())


def test_fixture_corpus_is_not_empty() -> None:
    assert VALID and INVALID_SCHEMA and INVALID_INVARIANT


@pytest.mark.parametrize("name", VALID)
def test_valid_fixtures_accepted_by_schema(name: str) -> None:
    _validator().validate(_load("valid", name))


@pytest.mark.parametrize("name", INVALID_SCHEMA)
def test_invalid_fixtures_rejected_by_schema(name: str) -> None:
    assert not _validator().is_valid(_load("invalid-schema", name))


@pytest.mark.parametrize("name", INVALID_INVARIANT)
def test_invariant_fixtures_are_schema_valid_but_rejected_by_invariants(name: str) -> None:
    """Estas fixtures pasan JSON Schema a proposito: prueban que el schema por si
    solo no alcanza y que los invariantes derivados hacen falta."""
    artifact = _load("invalid-invariant", name)
    _validator().validate(artifact)
    with pytest.raises(ArtifactInvariantError):
        assert_derived_invariants(artifact)


@pytest.mark.parametrize("name", VALID)
def test_valid_fixtures_satisfy_derived_invariants(name: str) -> None:
    assert_derived_invariants(_load("valid", name))


# ---------------------------------------------------------------------------
# Tokens congelados
# ---------------------------------------------------------------------------

def test_frozen_contract_tokens() -> None:
    schema = _schema()
    props = schema["properties"]
    defs = schema["$defs"]

    assert props["schemaVersion"]["const"] == "source_extraction_v1"
    assert props["offsetUnit"]["const"] == "UNICODE_CODE_POINT"
    assert props["sourceType"]["enum"] == ["PDF_DOCUMENT", "TEXT"]
    assert props["coverageStatus"]["enum"] == ["FULL", "PARTIAL", "FAILED"]
    assert props["sourceNormalizationApplied"]["enum"] == [
        "NONE",
        "PRODUCT_NFC_LINEENDINGS_TRIM",
    ]
    assert defs["page"]["properties"]["pageObservationStatus"]["enum"] == [
        "EXTRACTED",
        "OBSERVED_EMPTY",
        "UNOBSERVED_OR_UNEXTRACTABLE",
        "FAILED",
    ]
    assert defs["diagnostic"]["properties"]["code"]["enum"] == [
        "PAGE_OBSERVED_EMPTY",
        "PAGE_UNOBSERVED_OR_UNEXTRACTABLE",
        "PAGE_EXTRACTION_FAILED",
        "SOURCE_NO_EXTRACTABLE_TEXT",
        "ENCRYPTED_PDF",
        "UNSUPPORTED_SOURCE",
        "SOURCE_UNREADABLE",
        "PRIMARY_PARSER_FAILED_FELL_BACK",
        "EMPTY_SOURCE_TEXT",
    ]


def _declared_property_names(node: Any) -> set[str]:
    """Nombres de propiedad declarados en el schema, no texto de descripcion."""
    names: set[str] = set()
    if isinstance(node, dict):
        properties = node.get("properties")
        if isinstance(properties, dict):
            names |= set(properties)
        for key, value in node.items():
            if key != "description":
                names |= _declared_property_names(value)
    elif isinstance(node, list):
        for item in node:
            names |= _declared_property_names(item)
    return names


FORBIDDEN_SEMANTIC_FIELDS = {
    "evidenceUnit", "evidenceUnits", "evidenceMap",
    "requirement", "requirements", "requirementFacet",
    "area", "areas", "skill", "skills", "concept", "concepts",
    "confidence", "relation", "relations", "finalState", "reasoningState",
    "claimCeiling", "weakerClaimSearch", "continuity",
}


def test_contract_is_not_semantic() -> None:
    """F0 produce texto direccionable, nada interpretativo.

    Se comprueban NOMBRES DE PROPIEDAD declarados, no el texto de las
    descripciones: la propia descripcion del schema menciona esos terminos
    justamente para decir que no forman parte del contrato.
    """
    leaked = _declared_property_names(_schema()) & FORBIDDEN_SEMANTIC_FIELDS
    assert leaked == set(), f"campos semanticos filtrados al contrato: {sorted(leaked)}"

    for name in VALID:
        artifact = _load("valid", name)
        present = set(artifact) & FORBIDDEN_SEMANTIC_FIELDS
        assert present == set(), f"{name}: campos semanticos en la fixture: {sorted(present)}"


# ---------------------------------------------------------------------------
# Discriminadores PDF / TEXT
# ---------------------------------------------------------------------------

def test_text_extraction_identity_forbids_dependency_fingerprint() -> None:
    """Decision F0-D10/§7: formas discriminadas, no un campo nullable.

    Un `dependencyFingerprint: null` no distinguiria 'no aplica' de 'me olvide
    de calcularlo'. Aca la ausencia esta estructuralmente impuesta.
    """
    identity = _schema()["$defs"]["textExtractionIdentity"]
    assert identity["additionalProperties"] is False
    assert "dependencyFingerprint" not in identity["properties"]
    assert identity["properties"]["parserProfile"]["const"] == "TEXT_DIRECT"

    assert not _validator().is_valid(_load("invalid-schema", "text-identity-with-dependency-fingerprint"))


def test_pdf_extraction_identity_requires_dependency_fingerprint() -> None:
    identity = _schema()["$defs"]["pdfExtractionIdentity"]
    assert "dependencyFingerprint" in identity["required"]
    assert identity["properties"]["parserProfile"]["enum"] == ["PDFPLUMBER", "PYPDF"]


@pytest.mark.parametrize("name", VALID)
def test_parser_profile_matches_source_type(name: str) -> None:
    artifact = _load("valid", name)
    profile = artifact["extractionIdentity"]["parserProfile"]
    if artifact["sourceType"] == "TEXT":
        assert profile == "TEXT_DIRECT"
        assert "dependencyFingerprint" not in artifact["extractionIdentity"]
    else:
        assert profile in {"PDFPLUMBER", "PYPDF"}
        assert "dependencyFingerprint" in artifact["extractionIdentity"]


@pytest.mark.parametrize("name", VALID)
def test_source_normalization_applied_matches_source_type(name: str) -> None:
    artifact = _load("valid", name)
    expected = "PRODUCT_NFC_LINEENDINGS_TRIM" if artifact["sourceType"] == "TEXT" else "NONE"
    assert artifact["sourceNormalizationApplied"] == expected


@pytest.mark.parametrize("name", VALID)
def test_text_sources_have_no_pages(name: str) -> None:
    artifact = _load("valid", name)
    if artifact["sourceType"] == "TEXT":
        assert artifact["pages"] == []
        assert all(segment["pageIndex"] is None for segment in artifact["segments"])


# ---------------------------------------------------------------------------
# Posturas congeladas de coverage y OBSERVED_EMPTY
# ---------------------------------------------------------------------------

def test_text_empty_source_is_full_never_failed() -> None:
    artifact = _load("valid", "text-empty-full")
    assert artifact["documentCanonicalText"] == ""
    assert artifact["coverageStatus"] == "FULL"
    assert artifact["segments"] == []
    diagnostic = next(d for d in artifact["diagnostics"] if d["code"] == "EMPTY_SOURCE_TEXT")
    assert diagnostic["severity"] == "INFO"
    assert diagnostic["affectsCoverage"] is False


def test_observed_empty_full_is_representable() -> None:
    """Una fuente completamente observada y vacia es FULL con cero evidencia."""
    artifact = _load("valid", "pdf-observed-empty-full")
    statuses = [page["pageObservationStatus"] for page in artifact["pages"]]
    assert "OBSERVED_EMPTY" in statuses
    assert artifact["coverageStatus"] == "FULL"
    diagnostic = next(d for d in artifact["diagnostics"] if d["code"] == "PAGE_OBSERVED_EMPTY")
    assert diagnostic["affectsCoverage"] is False


def test_no_fixture_labels_a_scanned_page_observed_empty() -> None:
    """Invariante duro de §6.3, valido en ambas ramas de la condicionalidad.

    La fixture totalmente escaneada debe usar UNOBSERVED_OR_UNEXTRACTABLE.
    """
    scanned = _load("valid", "pdf-failed-fully-scanned")
    assert all(
        page["pageObservationStatus"] == "UNOBSERVED_OR_UNEXTRACTABLE"
        for page in scanned["pages"]
    )
    assert scanned["coverageStatus"] == "FAILED"

    manifest = json.loads((FIXTURES / "source-fixture-manifest.json").read_text(encoding="utf-8"))
    for entry in manifest["deferredSources"]:
        statuses = entry.get("expectedInitialPageStatuses", [])
        assert "OBSERVED_EMPTY" not in statuses, entry["file"]


def test_manifest_declares_conservative_initial_posture() -> None:
    manifest = json.loads((FIXTURES / "source-fixture-manifest.json").read_text(encoding="utf-8"))
    posture = manifest["initialObservedEmptyPosture"]
    assert posture["decision"] == "INITIAL_OBSERVED_EMPTY_SIGNAL: DEFERRED"

    blank = next(e for e in manifest["presentSources"] if e["file"].endswith("blank-page.pdf"))
    assert blank["expectedInitialPageStatuses"][1] == "UNOBSERVED_OR_UNEXTRACTABLE"
    assert blank["expectedInitialCoverage"] == "PARTIAL"


# ---------------------------------------------------------------------------
# Serializacion canonica y fingerprint (§11B)
# ---------------------------------------------------------------------------

def test_fingerprint_algorithm_tokens_are_frozen() -> None:
    assert FINGERPRINT_HASH == "SHA-256"
    assert FINGERPRINT_PREIMAGE_ENCODING == "UTF-8"
    assert FINGERPRINT_CANONICALIZATION == "MINIMAL_DETERMINISTIC_JSON_V1"


def test_canonical_json_rules() -> None:
    payload = {"b": 1, "a": {"z": True, "y": None}, "c": ["x", 2]}
    rendered = canonical_json(payload)
    assert rendered == '{"a":{"y":null,"z":true},"b":1,"c":["x",2]}'
    assert " " not in rendered
    # Sin escaping de no-ASCII: se emite literal en UTF-8.
    assert canonical_json({"k": "ñ\U0001F9EA"}) == '{"k":"ñ\U0001F9EA"}'


def _golden_vector() -> dict[str, Any]:
    return json.loads(
        (FIXTURES / "canonical-json-golden-vector.json").read_text(encoding="utf-8")
    )


def test_control_escape_golden_vector_is_byte_frozen() -> None:
    """Congela byte a byte el escaping de MINIMAL_DETERMINISTIC_JSON_V1.

    Es el vector contra el que la contraparte TypeScript de F0.4 debe
    demostrar igualdad, sin adivinar ninguna regla.
    """
    golden = _golden_vector()
    rendered = canonical_json(golden["payload"])

    assert rendered == golden["canonicalJson"]
    assert canonical_preimage(golden["payload"]) == rendered.encode("utf-8")
    assert len(rendered.encode("utf-8")) == golden["preimageByteLength"]
    assert sha256_hex(canonical_preimage(golden["payload"])) == golden["sha256"]


def test_control_escape_table_is_exactly_as_frozen() -> None:
    backslash = chr(92)
    quote = chr(34)
    expected = {
        0x00: backslash + "u0000",
        0x01: backslash + "u0001",
        0x08: backslash + "b",
        0x09: backslash + "t",
        0x0A: backslash + "n",
        0x0B: backslash + "u000b",
        0x0C: backslash + "f",
        0x0D: backslash + "r",
        0x1E: backslash + "u001e",
        0x1F: backslash + "u001f",
    }
    for code_point, escape in expected.items():
        rendered = canonical_json({"k": chr(code_point)})
        assert rendered == '{"k":"' + escape + '"}', hex(code_point)

    assert canonical_json({"k": quote}) == '{"k":"' + backslash + quote + '"}'
    assert canonical_json({"k": backslash}) == '{"k":"' + backslash + backslash + '"}'

    # Fuera del rango de control: literales, nunca escapados.
    assert canonical_json({"k": chr(0x7F)}) == '{"k":"' + chr(0x7F) + '"}'
    assert canonical_json({"k": "ñ"}) == '{"k":"ñ"}'
    assert canonical_json({"k": "\U0001F9EA"}) == '{"k":"\U0001F9EA"}'


def test_long_form_hex_digits_are_lowercase() -> None:
    """U+001F debe rendir \\u001f, nunca \\u001F."""
    backslash = chr(92)
    rendered = canonical_json({"k": chr(0x1F)})
    assert backslash + "u001f" in rendered
    assert backslash + "u001F" not in rendered

    for code_point in range(0x20):
        body = canonical_json({"k": chr(code_point)})
        assert body == body.lower() or code_point in (0x08, 0x09, 0x0A, 0x0C, 0x0D)


def test_uppercase_hex_variant_is_not_a_fingerprint_equivalence() -> None:
    """Mismo JSON semanticamente, preimage distinto: no vale como equivalencia."""
    golden = _golden_vector()
    backslash = chr(92)
    rejected = golden["rejectedUppercaseVariant"]

    upper = golden["canonicalJson"].replace(backslash + "u001f", backslash + "u001F")
    assert upper == rejected["canonicalJson"]
    assert sha256_hex(upper.encode("utf-8")) == rejected["sha256"]
    assert rejected["sha256"] != golden["sha256"]

    # Ambas variantes parsean al mismo objeto: la diferencia es de bytes, no de
    # semantica JSON, y es exactamente por eso que hay que congelarla.
    assert json.loads(upper) == json.loads(golden["canonicalJson"])


def test_lone_surrogates_are_invalid_input() -> None:
    artifact = _load("valid", "text-full")
    mutated = json.loads(json.dumps(artifact))
    mutated["documentCanonicalText"] = "roto " + chr(0xD800)
    with pytest.raises(ArtifactInvariantError, match="lone_surrogate"):
        assert_derived_invariants(mutated)


def test_same_projection_same_preimage_same_fingerprint() -> None:
    artifact = _load("valid", "pdf-full")
    first = canonical_preimage(material_projection(artifact))
    second = canonical_preimage(material_projection(json.loads(json.dumps(artifact))))
    assert first == second
    assert sha256_hex(first) == artifact["artifactContentFingerprint"]


def test_key_order_variation_yields_same_fingerprint() -> None:
    artifact = _load("valid", "pdf-full")
    shuffled = {key: artifact[key] for key in reversed(list(artifact.keys()))}
    shuffled["source"] = {k: artifact["source"][k] for k in reversed(list(artifact["source"]))}
    assert compute_fingerprint(shuffled) == artifact["artifactContentFingerprint"]


def test_unicode_content_yields_deterministic_fingerprint() -> None:
    artifact = _load("valid", "pdf-astral-unicode")
    assert compute_fingerprint(artifact) == artifact["artifactContentFingerprint"]
    assert compute_fingerprint(artifact) == compute_fingerprint(json.loads(json.dumps(artifact)))


def test_modified_canonical_text_changes_fingerprint() -> None:
    artifact = _load("valid", "pdf-full")
    mutated = json.loads(json.dumps(artifact))
    mutated["pages"][0]["canonicalText"] += " "
    assert compute_fingerprint(mutated) != artifact["artifactContentFingerprint"]


def test_fingerprint_excludes_itself_and_diagnostic_detail() -> None:
    artifact = _load("valid", "pdf-pypdf-fallback")
    projection = material_projection(artifact)
    assert "artifactContentFingerprint" not in projection
    assert all("detail" not in diagnostic for diagnostic in projection["diagnostics"])

    mutated = json.loads(json.dumps(artifact))
    mutated["diagnostics"][0]["detail"] = "otro detalle no sensible"
    assert compute_fingerprint(mutated) == artifact["artifactContentFingerprint"]


def test_fingerprint_excludes_derived_fields() -> None:
    projection = material_projection(_load("valid", "pdf-full"))
    assert "documentCanonicalText" not in projection
    assert all("pageOffsetStart" not in page for page in projection["pages"])
    assert all("exactExcerpt" not in segment for segment in projection["segments"])


def test_offsets_are_code_points_not_utf16_units() -> None:
    """El emoji ocupa 1 code point y 2 code units UTF-16.

    Si los offsets fueran UTF-16, el span del segmento no reconstruiria el
    excerpt en Python. Este test fija la unidad declarada.
    """
    artifact = _load("valid", "pdf-astral-unicode")
    page = artifact["pages"][0]
    text = page["canonicalText"]
    assert "\U0001F9EA" in text
    assert code_point_length(text) < len(text.encode("utf-16-le")) // 2

    for segment in artifact["segments"]:
        assert text[segment["charStart"]:segment["charEnd"]] == segment["exactExcerpt"]
    assert page["pageOffsetEnd"] - page["pageOffsetStart"] == code_point_length(text)


# ---------------------------------------------------------------------------
# Invariantes derivados (§11B)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("name", VALID)
def test_segment_ids_are_address_derived(name: str) -> None:
    artifact = _load("valid", name)
    for segment in artifact["segments"]:
        start, end = segment["charStart"], segment["charEnd"]
        if artifact["sourceType"] == "TEXT":
            expected = f"d:{start}-{end}"
        else:
            expected = f"p{segment['pageIndex']}:{start}-{end}"
        assert segment["segmentId"] == expected
        assert "seg-" not in segment["segmentId"]


@pytest.mark.parametrize("name", VALID)
def test_exact_alignment_invariant_holds(name: str) -> None:
    artifact = _load("valid", name)
    pages = {page["pageIndex"]: page["canonicalText"] for page in artifact["pages"]}
    for segment in artifact["segments"]:
        container = (
            artifact["documentCanonicalText"]
            if segment["pageIndex"] is None
            else pages[segment["pageIndex"]]
        )
        assert container[segment["charStart"]:segment["charEnd"]] == segment["exactExcerpt"]


@pytest.mark.parametrize("name", VALID)
def test_pdf_document_canonical_text_is_the_page_join(name: str) -> None:
    artifact = _load("valid", name)
    if artifact["sourceType"] != "PDF_DOCUMENT":
        pytest.skip("solo aplica a PDF_DOCUMENT")
    joined = "\n\n".join(page["canonicalText"] for page in artifact["pages"])
    assert artifact["documentCanonicalText"] == joined


@pytest.mark.parametrize("name", VALID)
def test_page_offsets_and_numbering(name: str) -> None:
    artifact = _load("valid", name)
    offset = 0
    for position, page in enumerate(artifact["pages"]):
        assert page["pageIndex"] == position
        assert page["pageNumber"] == page["pageIndex"] + 1
        assert page["pageOffsetStart"] == offset
        end = offset + code_point_length(page["canonicalText"])
        assert page["pageOffsetEnd"] == end
        offset = end + 2  # el join "\n\n"


# ---------------------------------------------------------------------------
# Aislamiento
# ---------------------------------------------------------------------------

def test_reference_helper_is_not_imported_by_production_code() -> None:
    """El helper de fingerprint de F0.1 es solo de test.

    La implementacion productiva independiente en Python y TypeScript es
    entregable de F0.4.
    """
    service_root = Path(__file__).resolve().parents[2]
    offenders = [
        path
        for path in (service_root / "src").rglob("*.py")
        if "source_extraction_reference" in path.read_text(encoding="utf-8")
    ]
    assert offenders == []


def test_contract_does_not_import_frozen_experiment() -> None:
    """Se comprueban IMPORTS reales, no menciones en prosa.

    Este archivo nombra el paquete experimental en su docstring precisamente
    para decir que no lo importa; buscar la palabra suelta se auto-detectaria.
    """
    import ast

    here = Path(__file__).resolve().parent
    for path in (Path(__file__), here / "source_extraction_reference.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        modules: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                modules += [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                modules.append(node.module)
        offenders = [m for m in modules if "evidence_reasoning" in m or "experiments" in m]
        assert offenders == [], f"{path.name} importa el experimento congelado: {offenders}"
