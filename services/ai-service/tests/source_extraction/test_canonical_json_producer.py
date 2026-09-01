r"""El productor Python de `MINIMAL_DETERMINISTIC_JSON_V1`.

El criterio de aceptacion es byte a byte contra el golden vector congelado en
F0.1, no "parsea al mismo objeto". La forma larga en minuscula y la misma en
mayuscula son el mismo JSON semanticamente y producen fingerprints distintos,
asi que una comparacion a nivel de objeto no probaria nada.
"""

from __future__ import annotations

import json

import pytest

from src.source_extraction.canonical import (
    CANONICALIZATION,
    canonical_json,
    canonical_preimage,
    fingerprint,
)
from src.source_extraction.errors import CanonicalJsonError
from tests.source_extraction.conftest import CONTRACT_FIXTURES

BACKSLASH = chr(0x5C)
QUOTE = chr(0x22)
GOLDEN = json.loads((CONTRACT_FIXTURES / "canonical-json-golden-vector.json").read_text(encoding="utf-8"))


def test_canonicalization_token_matches_the_frozen_contract() -> None:
    assert CANONICALIZATION == GOLDEN["canonicalization"] == "MINIMAL_DETERMINISTIC_JSON_V1"


def test_golden_vector_serializes_to_the_frozen_string() -> None:
    assert canonical_json(GOLDEN["payload"]) == GOLDEN["canonicalJson"]


def test_golden_vector_preimage_byte_length_is_frozen() -> None:
    assert len(canonical_preimage(GOLDEN["payload"])) == GOLDEN["preimageByteLength"]


def test_golden_vector_hashes_to_the_frozen_sha256() -> None:
    assert fingerprint(GOLDEN["payload"]) == GOLDEN["sha256"]


def test_uppercase_hex_variant_is_not_produced() -> None:
    """La variante en mayuscula es un fingerprint DISTINTO, no una equivalencia."""
    produced = canonical_json(GOLDEN["payload"])
    assert produced != GOLDEN["rejectedUppercaseVariant"]["canonicalJson"]
    assert fingerprint(GOLDEN["payload"]) != GOLDEN["rejectedUppercaseVariant"]["sha256"]


@pytest.mark.parametrize(
    ("code_point", "expected"),
    [
        (0x22, BACKSLASH + '"'),
        (0x5C, BACKSLASH + BACKSLASH),
        (0x08, BACKSLASH + "b"),
        (0x09, BACKSLASH + "t"),
        (0x0A, BACKSLASH + "n"),
        (0x0C, BACKSLASH + "f"),
        (0x0D, BACKSLASH + "r"),
        (0x00, BACKSLASH + "u0000"),
        (0x01, BACKSLASH + "u0001"),
        (0x0B, BACKSLASH + "u000b"),
        (0x1E, BACKSLASH + "u001e"),
        (0x1F, BACKSLASH + "u001f"),
    ],
)
def test_escape_table_is_exactly_as_frozen(code_point: int, expected: str) -> None:
    assert canonical_json(chr(code_point)) == '"' + expected + '"'


def test_long_form_hex_digits_are_lowercase() -> None:
    for code_point in range(0x00, 0x20):
        produced = canonical_json(chr(code_point))
        if BACKSLASH + "u" in produced:
            assert produced == '"' + BACKSLASH + "u%04x" % code_point + '"'
            assert produced.lower() == produced


def test_delete_and_non_ascii_are_literal() -> None:
    """U+007F literal, no-ASCII literal, nunca en forma de escape largo."""
    delete_char = chr(0x7F)
    n_tilde = chr(0xF1)
    test_tube = chr(0x1F9EA)
    assert canonical_json(delete_char) == QUOTE + delete_char + QUOTE
    assert canonical_json(n_tilde) == QUOTE + n_tilde + QUOTE
    assert canonical_json(test_tube) == QUOTE + test_tube + QUOTE
    assert BACKSLASH + "u" not in canonical_json(n_tilde + test_tube + delete_char)


def test_lone_surrogates_are_invalid_input() -> None:
    with pytest.raises(CanonicalJsonError, match="lone_surrogate"):
        canonical_json("\ud800")


def test_object_keys_are_sorted_by_code_point() -> None:
    assert canonical_json({"b": 1, "a": 2, "A": 3, "ñ": 4}) == '{"A":3,"a":2,"b":1,"ñ":4}'


def test_array_order_is_preserved() -> None:
    assert canonical_json([3, 1, 2]) == "[3,1,2]"


def test_no_whitespace_is_emitted() -> None:
    assert canonical_json({"a": [1, 2], "b": {"c": True}}) == '{"a":[1,2],"b":{"c":true}}'


def test_booleans_are_not_serialized_as_integers() -> None:
    """`bool` es subclase de `int`; el orden de los casos del encoder importa."""
    assert canonical_json({"t": True, "f": False, "n": None, "i": 1, "z": 0}) == (
        '{"f":false,"i":1,"n":null,"t":true,"z":0}'
    )


def test_floats_are_rejected() -> None:
    with pytest.raises(CanonicalJsonError, match="unsupported_type"):
        canonical_json({"value": 1.5})


def test_non_string_object_keys_are_rejected() -> None:
    with pytest.raises(CanonicalJsonError, match="non_string_object_key"):
        canonical_json({1: "a"})


def test_producer_is_independent_of_the_f01_test_reference() -> None:
    """No importa el modulo de referencia solo-tests.

    Si la implementacion productiva derivara de la referencia, la igualdad byte
    a byte entre ambas no probaria nada.
    """
    import ast
    from pathlib import Path

    import src.source_extraction as package

    root = Path(package.__file__).resolve().parent
    for module in sorted(root.glob("*.py")):
        tree = ast.parse(module.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                assert "source_extraction_reference" not in node.module, module.name
                assert not node.module.startswith("tests"), module.name
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    assert not alias.name.startswith("tests"), module.name


def test_producer_matches_the_reference_on_every_frozen_valid_fixture() -> None:
    """Igualdad byte a byte con la referencia F0.1 sobre las 9 fixtures validas."""
    from tests.contracts.source_extraction_reference import canonical_json as reference_json
    from tests.contracts.source_extraction_reference import material_projection

    names = sorted((CONTRACT_FIXTURES / "valid").glob("*.json"))
    assert names, "el corpus valido de F0.1 no puede estar vacio"
    for path in names:
        artifact = json.loads(path.read_text(encoding="utf-8"))
        projection = material_projection(artifact)
        assert canonical_json(projection) == reference_json(projection), path.name
        assert fingerprint(projection) == artifact["artifactContentFingerprint"], path.name
