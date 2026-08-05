from dataclasses import dataclass
from typing import Dict, List, Optional

from .text_utils import normalize_for_match, normalize_whitespace


@dataclass
class HeaderMatch:
    section_key: str
    line_index: int


def _line_matches_header(line: str, patterns: List[str]) -> bool:
    normalized_line = normalize_for_match(line)
    for pattern in patterns:
        normalized_pattern = normalize_for_match(pattern)
        if normalized_line == normalized_pattern:
            return True
        if normalized_line.startswith(normalized_pattern + " "):
            return True
        if normalized_line.endswith(" " + normalized_pattern):
            return True
        if normalized_pattern in normalized_line and len(normalized_pattern.split()) >= 2:
            return True
    return False


def _find_next_header_index(
    from_index: int,
    lines: List[str],
    relevant_patterns: Dict[str, List[str]],
    irrelevant_patterns: List[str],
) -> int:
    for idx in range(from_index + 1, len(lines)):
        candidate = lines[idx].strip()
        if not candidate:
            continue

        if any(_line_matches_header(candidate, [pattern]) for pattern in irrelevant_patterns):
            return idx

        for patterns in relevant_patterns.values():
            if _line_matches_header(candidate, patterns):
                return idx

    return len(lines)


def detect_relevant_sections(
    text: str,
    relevant_patterns: Dict[str, List[str]],
    irrelevant_patterns: List[str],
) -> Dict[str, str]:
    lines = [ln.strip() for ln in text.split("\n")]
    matches: List[HeaderMatch] = []

    for idx, line in enumerate(lines):
        if not line:
            continue
        for section_key, patterns in relevant_patterns.items():
            if _line_matches_header(line, patterns):
                matches.append(HeaderMatch(section_key=section_key, line_index=idx))
                break

    if not matches:
        return fallback_sections(text)

    extracted: Dict[str, str] = {}
    for match in matches:
        start_idx = match.line_index + 1
        end_idx = _find_next_header_index(
            from_index=match.line_index,
            lines=lines,
            relevant_patterns=relevant_patterns,
            irrelevant_patterns=irrelevant_patterns,
        )
        section_text = "\n".join(lines[start_idx:end_idx]).strip()
        if section_text:
            previous = extracted.get(match.section_key)
            if previous:
                extracted[match.section_key] = f"{previous}\n{section_text}".strip()
            else:
                extracted[match.section_key] = section_text

    if not extracted:
        return fallback_sections(text)

    return {k: normalize_whitespace(v) for k, v in extracted.items() if v.strip()}


def fallback_sections(text: str) -> Dict[str, str]:
    compact = normalize_whitespace(text)
    if not compact:
        return {}

    return {
        "contents_raw": compact[:5000],
    }


def build_raw_sections(
    detected_sections: Dict[str, str],
    allowed_keys: Optional[List[str]] = None,
) -> Dict[str, str]:
    allowed = set(allowed_keys or detected_sections.keys())
    return {k: v for k, v in detected_sections.items() if k in allowed and v.strip()}
