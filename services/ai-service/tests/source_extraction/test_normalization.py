"""Paridad cross-runtime de `PRODUCT_NFC_LINEENDINGS_TRIM`.

El parity vector NO lo escribí a mano: lo genera la ejecución del normalizador
productivo REAL en Node, contrastando caso por caso contra
`validateTextEvidenceBody`. Estos tests comprueban que la implementación Python
del predicado de punto fijo coincide con él exactamente.

La comparación se hace sobre arrays de code points, no sobre strings, para que
ningún paso de encoding entre runtimes pueda alterar un caso en silencio.
"""

from __future__ import annotations

import json
import unicodedata

import pytest

from src.source_extraction.normalization import (
    ECMASCRIPT_TRIM_CODE_POINTS,
    PRODUCT_NFC_LINEENDINGS_TRIM,
    describe_violation,
    ecmascript_trim,
    is_product_normalized,
    product_normalize,
)
from tests.source_extraction.conftest import CONTRACT_FIXTURES

VECTOR = json.loads(
    (CONTRACT_FIXTURES / "text-evidence-normalization-parity-vector.json").read_text(
        encoding="utf-8"
    )
)
CASES = VECTOR["cases"]
CASE_IDS = [case["name"] for case in CASES]


def text_of(code_points: list[int]) -> str:
    return "".join(chr(point) for point in code_points)


# ---------------------------------------------------------------------------
# Paridad con el normalizador productivo real
# ---------------------------------------------------------------------------

def test_vector_declares_the_frozen_semantics() -> None:
    assert VECTOR["token"] == PRODUCT_NFC_LINEENDINGS_TRIM
    assert VECTOR["frozenSemantics"] == [
        "Unicode NFC",
        "CRLF / CR -> LF",
        "ECMAScript String.prototype.trim",
    ]
    assert VECTOR["order"] == "NFC -> lineEndings -> trim"


def test_vector_covers_the_required_boundary_cases() -> None:
    """Si un caso desaparece del vector, el test lo delata."""
    required = {
        "decomposed-nfc",
        "crlf",
        "lone-cr",
        "ascii-leading-trailing",
        "tab-boundary",
        "lf-boundary",
        "nbsp-boundary",
        "nbsp-internal",
        "bom-boundary",
        "zwsp-boundary",
        "line-separator-boundary",
        "paragraph-separator-boundary",
        "ideographic-space-boundary",
        "internal-whitespace",
        "astral",
        "empty",
    }
    assert required <= set(CASE_IDS)


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
def test_python_reproduces_the_productive_normalized_form(case: dict) -> None:
    produced = product_normalize(text_of(case["rawCodePoints"]))
    assert [ord(character) for character in produced] == case["expectedCodePoints"]


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
def test_python_fixed_point_check_matches_the_product(case: dict) -> None:
    assert is_product_normalized(text_of(case["rawCodePoints"])) is case["isNormalizedFixedPoint"]


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
def test_the_normalized_form_is_always_a_fixed_point(case: dict) -> None:
    """Idempotencia: normalizar dos veces no puede diferir de normalizar una."""
    assert is_product_normalized(text_of(case["expectedCodePoints"]))


# ---------------------------------------------------------------------------
# Por qué no alcanza `str.strip()`
# ---------------------------------------------------------------------------

def test_python_strip_is_not_ecmascript_trim() -> None:
    """Los dos conjuntos difieren EN AMBAS DIRECCIONES.

    Usar `strip()` aceptaría contenido con BOM en el borde como si fuera punto
    fijo —no lo es— y rechazaría contenido con NEL en el borde que sí lo es.
    """
    bom = chr(0xFEFF)
    nel = chr(0x0085)
    file_separator = chr(0x001C)

    # ECMAScript sí lo recorta, Python no.
    assert ecmascript_trim(bom + "Uno" + bom) == "Uno"
    assert (bom + "Uno" + bom).strip() != "Uno"

    # Python sí los recorta, ECMAScript no.
    for character in (nel, file_separator):
        assert ecmascript_trim(character + "Uno" + character) == character + "Uno" + character
        assert (character + "Uno" + character).strip() == "Uno"


def test_zero_width_space_is_not_trimmed() -> None:
    """U+200B es categoría Cf, no Zs. Un contenido que empieza con él es punto
    fijo válido y no debe rechazarse."""
    zwsp = chr(0x200B)
    assert unicodedata.category(zwsp) == "Cf"
    assert is_product_normalized(zwsp + "Uno" + zwsp)


def test_no_break_space_is_trimmed_at_the_boundary_but_kept_inside() -> None:
    nbsp = chr(0x00A0)
    assert unicodedata.category(nbsp) == "Zs"
    assert not is_product_normalized(nbsp + "Uno")
    assert is_product_normalized("Carga: 40" + nbsp + "horas")


def test_trim_set_covers_every_current_space_separator() -> None:
    """Cruce contra la categoría Zs vigente.

    El conjunto se declara explícito y no derivado, porque es un contrato
    congelado. Este test existe para que una actualización de Unicode que agregue
    un `Zs` se manifieste como una falla y no como una divergencia silenciosa
    entre Python y Node.
    """
    space_separators = {
        point for point in range(0x110000) if unicodedata.category(chr(point)) == "Zs"
    }
    assert space_separators <= ECMASCRIPT_TRIM_CODE_POINTS


def test_line_terminators_are_in_the_trim_set() -> None:
    for point in (0x000A, 0x000D, 0x2028, 0x2029):
        assert point in ECMASCRIPT_TRIM_CODE_POINTS


def test_nel_and_c1_separators_are_not_in_the_trim_set() -> None:
    for point in (0x0085, 0x001C, 0x001D, 0x001E, 0x001F):
        assert point not in ECMASCRIPT_TRIM_CODE_POINTS


# ---------------------------------------------------------------------------
# Orden de las etapas
# ---------------------------------------------------------------------------

def test_line_endings_are_normalized_before_trimming() -> None:
    """`"Uno\\r"` -> el CR pasa a LF y recién ahí el trim lo saca.

    Si el orden fuera al revés el resultado sería el mismo acá, pero el vector
    congela el orden productivo y este test lo deja explícito.
    """
    assert product_normalize("Uno\r") == "Uno"
    assert product_normalize("Uno\r\n") == "Uno"


def test_nfc_runs_before_trimming() -> None:
    decomposed = "Programacio" + chr(0x0301) + "n"
    assert product_normalize("  " + decomposed + "  ") == unicodedata.normalize("NFC", decomposed)


# ---------------------------------------------------------------------------
# Diagnóstico de la violación
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    ("raw", "expected_stage"),
    [
        ("Programacio" + chr(0x0301) + "n", "not_nfc"),
        ("Uno\r\nDos", "line_endings_not_normalized"),
        ("Uno\rDos", "line_endings_not_normalized"),
        ("  Uno  ", "not_trimmed"),
        (chr(0xFEFF) + "Uno", "not_trimmed"),
        ("Uno", "already_normalized"),
    ],
)
def test_violation_names_the_stage(raw: str, expected_stage: str) -> None:
    assert describe_violation(raw) == expected_stage


def test_violation_description_never_quotes_the_content() -> None:
    """El contenido de un TextEvidence es dato del holder: nunca sale en un error."""
    secret = "  Diagnostico medico confidencial del titular  "
    stage = describe_violation(secret)
    for word in secret.split():
        assert word not in stage
    assert stage == "not_trimmed"
