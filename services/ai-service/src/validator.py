from typing import Dict, List, Tuple


def validate_semantic_record(record: Dict[str, object], min_chars: int) -> Tuple[str, List[str]]:
    errors: List[str] = []

    name = str(record.get("name") or "").strip()
    if not name:
        errors.append("No se detecto el nombre de la materia")

    objectives = record.get("objectives") or []
    contents = record.get("contents") or []
    summary = str(record.get("summary") or "")

    semantic_text = " ".join([
        summary,
        " ".join(objectives) if isinstance(objectives, list) else "",
        " ".join(contents) if isinstance(contents, list) else "",
    ]).strip()

    if len(semantic_text) < min_chars:
        errors.append("Contenido semantico insuficiente")

    if errors:
        if len(errors) >= 2:
            return "error", errors
        return "partial", errors

    return "ok", []
