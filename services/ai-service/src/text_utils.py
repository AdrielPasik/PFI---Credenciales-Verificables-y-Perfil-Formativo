import re
import unicodedata
from typing import List


def remove_accents(text: str) -> str:
    normalized = unicodedata.normalize("NFD", text)
    return "".join(char for char in normalized if unicodedata.category(char) != "Mn")


def normalize_whitespace(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\t+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \u00A0]{2,}", " ", text)
    return text.strip()


def normalize_for_match(text: str) -> str:
    lowered = remove_accents(text.lower())
    lowered = re.sub(r"[^a-z0-9\s]", " ", lowered)
    return re.sub(r"\s+", " ", lowered).strip()


def split_sentences(text: str) -> List[str]:
    text = normalize_whitespace(text)
    if not text:
        return []
    pieces = re.split(r"(?<=[\.!?])\s+|\n+", text)
    return [p.strip(" -•\t") for p in pieces if p.strip(" -•\t")]


def split_bullets_or_lines(text: str) -> List[str]:
    if not text:
        return []

    separators = r"\n|;|•|-\s+|\*\s+|\u2022"
    pieces = re.split(separators, text)
    cleaned = [re.sub(r"\s+", " ", p).strip(" .,:;\t") for p in pieces]
    return [p for p in cleaned if p]
