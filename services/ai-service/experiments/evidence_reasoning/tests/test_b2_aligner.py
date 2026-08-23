from __future__ import annotations

from experiments.evidence_reasoning.b2_aligner import align_quote


def test_exact_quote_returns_authoritative_offsets() -> None:
    text = "Prefijo. Diseño de APIs REST. Sufijo."
    result = align_quote(text, "Diseño de APIs REST")
    assert result.status == "EXACT"
    assert text[result.char_start:result.char_end] == "Diseño de APIs REST"


def test_unicode_whitespace_and_line_endings_are_repaired_to_original() -> None:
    text = "Línea uno\r\nDiseño\u00a0de APIs — REST"
    result = align_quote(text, "Línea uno\nDiseño de APIs - REST")
    assert result.status == "REPAIRED"
    assert result.repair == "UNICODE_WHITESPACE_NORMALIZATION"
    assert text[result.char_start:result.char_end] == text


def test_ambiguous_quote_is_not_silently_resolved() -> None:
    result = align_quote("ARM y luego ARM", "ARM")
    assert result.status == "AMBIGUOUS"
    assert result.char_start is None
    assert result.occurrence_count == 2


def test_scope_disambiguates_repeated_quote() -> None:
    text = "ARM y luego ARM"
    result = align_quote(text, "ARM", scope_start=10)
    assert result.status == "EXACT"
    assert result.char_start == 12
