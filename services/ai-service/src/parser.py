import re
from pathlib import Path
from typing import Dict, Optional

from .models import CourseCandidate
from .text_utils import normalize_for_match, normalize_whitespace


INSTITUTIONAL_TITLE_PATTERNS = [
    "dpto",
    "departamento",
    "tecnologia informatica",
    "tecnología informática",
    "presencial",
    "universidad",
    "facultad",
    "secretaria academica",
    "secretaría académica",
    "plan de estudio",
]


def extract_course_code(text: str) -> Optional[str]:
    patterns = [
        r"(?:codigo|c[oó]digo|cod\.)\s*(?:de\s+materia|materia|asignatura)?\s*[:\-]?\s*([A-Za-z0-9\.\-]{3,20})",
        r"\b(\d+(?:\.\d+){1,4})\b",
    ]

    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return None


def extract_course_code_from_source_name(source_name: str) -> Optional[str]:
    stem = Path(source_name).stem.strip()
    if not stem:
        return None

    # Expected format: <course_code>_<rest>. Also supports simple codes like "PPS06".
    first_token = stem.split("_", 1)[0].strip()
    if re.fullmatch(r"[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*", first_token):
        return first_token

    # Fallback when separators vary.
    match = re.match(r"^([A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)", stem)
    if match:
        return match.group(1)

    return None


def extract_hours_total(text: str) -> Optional[int]:
    patterns = [
        r"(?:carga\s+horaria\s+total|carga\s+horaria|horas\s+totales)\s*[:\-]?\s*(\d{1,4})",
        r"(\d{1,4})\s*horas\b",
        r"(\d{1,4})\s*hs\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return int(match.group(1))
    return None


def extract_course_name(text: str) -> Optional[str]:
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]

    labeled_patterns = [
        r"(?:nombre\s+de\s+la\s+materia|materia|asignatura|espacio\s+curricular|unidad\s+curricular)\s*[:\-]\s*(.+)",
    ]

    for line in lines[:30]:
        for pattern in labeled_patterns:
            match = re.search(pattern, line, flags=re.IGNORECASE)
            if match:
                candidate = clean_name(match.group(1))
                if is_reasonable_name(candidate):
                    return candidate

    for line in lines[:25]:
        candidate = clean_name(line)
        if is_reasonable_name(candidate):
            return candidate

    return None


def extract_course_name_from_source_name(source_name: str) -> Optional[str]:
    stem = Path(source_name).stem.strip()
    if not stem:
        return None

    cleaned = stem.replace("_", " ")
    cleaned = re.sub(r"^\s*[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*\s*", "", cleaned)
    cleaned = re.sub(r"\(\s*PRESENCIAL\s*\)", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b\d{1,2}-\d{1,2}-\d{2,4}\b", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -_\t")
    return clean_name(cleaned) if cleaned else None


def extract_course_name_from_header(text: str) -> Optional[str]:
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    for line in lines[:40]:
        candidate = clean_name(line)
        if not is_reasonable_name(candidate):
            continue
        if is_institutional_title(candidate):
            continue
        return candidate
    return None


def is_institutional_title(title: str) -> bool:
    normalized = normalize_for_match(title)
    return any(normalize_for_match(pattern) in normalized for pattern in INSTITUTIONAL_TITLE_PATTERNS)


def normalize_course_title(extracted_title: Optional[str], source_name: str, text: str) -> tuple[Optional[str], str]:
    extracted = clean_name(extracted_title or "") if extracted_title else None
    if extracted and is_reasonable_name(extracted) and not is_institutional_title(extracted):
        return extracted, "as_extracted"

    recovered_from_source = extract_course_name_from_source_name(source_name)
    if recovered_from_source and is_reasonable_name(recovered_from_source) and not is_institutional_title(recovered_from_source):
        return recovered_from_source, "recovered_from_filename"

    recovered_from_header = extract_course_name_from_header(text)
    if recovered_from_header:
        return recovered_from_header, "recovered_from_header"

    if extracted and is_reasonable_name(extracted):
        return extracted, "institutional_title_unresolved"

    return extracted or recovered_from_source or recovered_from_header, "missing"


def clean_name(name: str) -> str:
    name = normalize_whitespace(name)
    name = re.sub(r"^(programa\s+de\s+)?", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\s*\|.*$", "", name)
    name = re.sub(r"\s+[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)+$", "", name)
    return name.strip(" -:\t")


def is_reasonable_name(candidate: str) -> bool:
    if not candidate or len(candidate) < 4 or len(candidate) > 110:
        return False

    normalized = normalize_for_match(candidate)
    blocked = {
        "universidad",
        "facultad",
        "departamento",
        "bibliografia",
        "evaluacion",
        "cronograma",
        "contenidos",
        "objetivos",
        "fain",
        "resolucion",
        "resolución",
        "acta",
    }

    if any(re.search(r"(?<![a-z0-9])" + re.escape(token) + r"(?![a-z0-9])", normalized) for token in blocked):
        return False

    if re.search(r"\b\d{1,4}\s*(hs|hora|horas)\b", normalized):
        return False

    digit_chars = sum(1 for c in candidate if c.isdigit())
    if digit_chars >= 4:
        return False

    alpha_chars = sum(1 for c in candidate if c.isalpha())
    return alpha_chars >= 4


def build_course_candidate(text: str, source_file: str, raw_sections: Dict[str, str]) -> CourseCandidate:
    code_from_source = extract_course_code_from_source_name(source_file)
    code_from_text = extract_course_code(text)
    extracted_name = extract_course_name(text)
    normalized_name, title_quality_status = normalize_course_title(
        extracted_title=extracted_name,
        source_name=source_file,
        text=text,
    )

    return CourseCandidate(
        course_code=code_from_source or code_from_text,
        name=normalized_name,
        title_extracted=extracted_name,
        title_normalized=normalized_name,
        title_quality_status=title_quality_status,
        hours_total=extract_hours_total(text),
        source_file=source_file,
        raw_sections=raw_sections,
    )
