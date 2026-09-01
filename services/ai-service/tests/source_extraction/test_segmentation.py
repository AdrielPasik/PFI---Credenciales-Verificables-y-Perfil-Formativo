r"""Texto canonico y segmentacion deterministica.

Lo que estos tests protegen es un invariante, no una preferencia de estilo: los
offsets deben referirse a UNA representacion canonica inmutable. Cualquier
normalizacion que se cuele despues de fijar los offsets los invalida en
silencio, y el pipeline productivo viejo hace exactamente eso — por eso F0 es un
camino paralelo y no un refactor.
"""

from __future__ import annotations

import unicodedata

import pytest

from src.source_extraction.segmentation import (
    canonical_text,
    code_point_length,
    has_substantive_text,
    join_pages,
    page_segments,
    segment_blocks,
)

NBSP = chr(0x00A0)
TEST_TUBE = chr(0x1F9EA)


# ---------------------------------------------------------------------------
# Texto canonico
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("a\r\nb", "a\nb"),
        ("a\rb", "a\nb"),
        ("a\r\n\r\nb", "a\n\nb"),
        ("a\nb", "a\nb"),
    ],
)
def test_line_endings_are_the_only_transformation(raw: str, expected: str) -> None:
    assert canonical_text(raw) == expected


def test_whitespace_is_not_collapsed() -> None:
    raw = "  Programa\t\tde   la  materia  \n\n\n\nContenidos  \n"
    assert canonical_text(raw) == raw


def test_leading_and_trailing_whitespace_is_preserved() -> None:
    assert canonical_text("   texto   ") == "   texto   "


def test_non_breaking_space_is_preserved() -> None:
    raw = f"Carga horaria: 40{NBSP}horas"
    assert canonical_text(raw) == raw
    assert NBSP in canonical_text(raw)


def test_no_unicode_normalization_is_applied() -> None:
    """NFC/NFD/NFKC destruirian la distincion que el estado REPAIRED del aligner
    existe para registrar."""
    decomposed = "e" + chr(0x0301)  # e + acento combinante
    composed = unicodedata.normalize("NFC", decomposed)
    assert composed != decomposed

    assert canonical_text(decomposed) == decomposed
    assert canonical_text(decomposed) != composed

    ligature = chr(0xFB01)  # fi
    assert canonical_text(ligature) == ligature
    assert canonical_text(ligature) != unicodedata.normalize("NFKC", ligature)


def test_code_point_length_counts_code_points_not_utf16_units() -> None:
    assert code_point_length(TEST_TUBE) == 1
    assert len(TEST_TUBE.encode("utf-16-le")) // 2 == 2


# ---------------------------------------------------------------------------
# Clasificacion de contenido sustantivo
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text", ["", "   ", "\n\n", "\t", f"{NBSP}"])
def test_whitespace_only_text_is_not_substantive(text: str) -> None:
    assert has_substantive_text(text) is False


@pytest.mark.parametrize("text", ["a", "  a  ", "0"])
def test_text_with_content_is_substantive(text: str) -> None:
    assert has_substantive_text(text) is True


# ---------------------------------------------------------------------------
# Segmentacion
# ---------------------------------------------------------------------------

def test_blocks_are_separated_by_blank_lines() -> None:
    text = "Primer bloque.\n\nSegundo bloque."
    assert segment_blocks(text) == [(0, 14), (16, 31)]


def test_single_newlines_do_not_split_blocks() -> None:
    text = "Linea uno\nLinea dos"
    assert segment_blocks(text) == [(0, len(text))]


def test_empty_and_whitespace_only_blocks_are_dropped() -> None:
    """Cuatro saltos son DOS separadores, asi que el bloque del medio queda vacio."""
    text = "A\n\n\n\nB\n\n   \n\nC"
    spans = segment_blocks(text)
    assert all(text[start:end].strip() != "" for start, end in spans)
    assert [text[start:end] for start, end in spans] == ["A", "B", "C"]


def test_an_odd_run_of_newlines_leaves_the_leading_newline_inside_the_block() -> None:
    """Tres saltos son un separador mas un salto suelto.

    El salto sobrante queda DENTRO del bloque siguiente y el excerpt lo incluye.
    Recortarlo sin corregir los offsets rompe el invariante de alineamiento, y
    corregirlos agregaria una regla de segmentacion que el contrato no tiene.
    """
    text = "A\n\n\nB"
    spans = segment_blocks(text)
    assert [text[start:end] for start, end in spans] == ["A", "\nB"]
    for start, end in spans:
        assert text[start:end].strip() != ""


def test_offsets_are_arithmetic_not_search_based() -> None:
    """Un bloque repetido no debe re-encontrarse en la posicion equivocada.

    El experimento congelado usa `text.find(block, cursor)`; aca la direccion ES
    la identidad, asi que se calcula por aritmetica sobre el cursor.
    """
    text = "repetido\n\nrepetido\n\nrepetido"
    assert segment_blocks(text) == [(0, 8), (10, 18), (20, 28)]


def test_page_segments_satisfy_the_alignment_invariant() -> None:
    text = "Primer bloque.\n\nSegundo bloque con espacio duro:" + NBSP + "40h."
    for segment in page_segments(3, text):
        start, end = segment["charStart"], segment["charEnd"]
        assert text[start:end] == segment["exactExcerpt"]


def test_segment_ids_are_address_derived_never_ordinal() -> None:
    text = "Uno.\n\nDos.\n\nTres."
    ids = [segment["segmentId"] for segment in page_segments(2, text)]
    assert ids == ["p2:0-4", "p2:6-10", "p2:12-17"]
    assert not any("seg-" in identifier for identifier in ids)


def test_segment_ids_are_verifiable_against_their_own_coordinates() -> None:
    for segment in page_segments(0, "Alfa.\n\nBeta."):
        expected = f"p{segment['pageIndex']}:{segment['charStart']}-{segment['charEnd']}"
        assert segment["segmentId"] == expected


def test_no_empty_segment_is_emitted() -> None:
    for text in ["", "\n\n", "   ", "A\n\n\n\n\n\nB"]:
        assert all(end > start for start, end in segment_blocks(text))


def test_astral_offsets_are_code_point_based() -> None:
    text = f"A{TEST_TUBE}B\n\nsegundo"
    segments = page_segments(0, text)
    assert segments[0]["segmentId"] == "p0:0-3"
    assert segments[0]["exactExcerpt"] == f"A{TEST_TUBE}B"
    assert segments[1]["segmentId"] == "p0:5-12"
    assert text[5:12] == "segundo"


def test_page_join_convention_is_two_newlines() -> None:
    assert join_pages(["a", "b"]) == "a\n\nb"
    assert join_pages(["", ""]) == "\n\n"
    assert join_pages([]) == ""
