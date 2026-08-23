from __future__ import annotations

import unicodedata
from dataclasses import asdict, dataclass


_TRANSLATION = str.maketrans(
    {
        "\u00a0": " ",
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2013": "-",
        "\u2014": "-",
    }
)


@dataclass(frozen=True)
class AlignmentResult:
    status: str
    char_start: int | None
    char_end: int | None
    exact_text: str | None
    occurrence_count: int
    repair: str | None = None

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def _occurrences(text: str, needle: str, start: int, end: int) -> list[int]:
    if not needle:
        return []
    found: list[int] = []
    cursor = start
    while cursor <= end - len(needle):
        index = text.find(needle, cursor, end)
        if index < 0:
            break
        found.append(index)
        cursor = index + 1
    return found


def _controlled_text_with_map(text: str) -> tuple[str, list[tuple[int, int]]]:
    normalized: list[str] = []
    spans: list[tuple[int, int]] = []
    in_whitespace = False
    index = 0
    while index < len(text):
        char = text[index]
        if char == "\r" and index + 1 < len(text) and text[index + 1] == "\n":
            char = "\n"
            original_end = index + 2
        else:
            original_end = index + 1
        transformed = unicodedata.normalize("NFKC", char.translate(_TRANSLATION))
        for piece in transformed:
            if piece.isspace():
                if in_whitespace:
                    spans[-1] = (spans[-1][0], original_end)
                else:
                    normalized.append(" ")
                    spans.append((index, original_end))
                    in_whitespace = True
            else:
                normalized.append(piece)
                spans.append((index, original_end))
                in_whitespace = False
        index = original_end
    return "".join(normalized), spans


def _controlled_quote(quote: str) -> str:
    normalized, _ = _controlled_text_with_map(quote)
    return normalized


def align_quote(
    text: str,
    quote: str,
    *,
    scope_start: int = 0,
    scope_end: int | None = None,
) -> AlignmentResult:
    end = len(text) if scope_end is None else scope_end
    if not (0 <= scope_start <= end <= len(text)) or not quote:
        return AlignmentResult("NOT_FOUND", None, None, None, 0)

    exact = _occurrences(text, quote, scope_start, end)
    if len(exact) == 1:
        start = exact[0]
        return AlignmentResult("EXACT", start, start + len(quote), text[start : start + len(quote)], 1)
    if len(exact) > 1:
        return AlignmentResult("AMBIGUOUS", None, None, None, len(exact))

    controlled_text, spans = _controlled_text_with_map(text)
    controlled_quote = _controlled_quote(quote)
    if not controlled_quote:
        return AlignmentResult("NOT_FOUND", None, None, None, 0)

    allowed_positions = [
        index
        for index, (original_start, original_end) in enumerate(spans)
        if original_start >= scope_start and original_end <= end
    ]
    if not allowed_positions:
        return AlignmentResult("NOT_FOUND", None, None, None, 0)
    normalized_start = min(allowed_positions)
    normalized_end = max(allowed_positions) + 1
    repaired = _occurrences(controlled_text, controlled_quote, normalized_start, normalized_end)
    if len(repaired) == 1:
        position = repaired[0]
        original_start = spans[position][0]
        original_end = spans[position + len(controlled_quote) - 1][1]
        return AlignmentResult(
            "REPAIRED",
            original_start,
            original_end,
            text[original_start:original_end],
            1,
            "UNICODE_WHITESPACE_NORMALIZATION",
        )
    if len(repaired) > 1:
        return AlignmentResult("AMBIGUOUS", None, None, None, len(repaired))
    return AlignmentResult("NOT_FOUND", None, None, None, 0)
