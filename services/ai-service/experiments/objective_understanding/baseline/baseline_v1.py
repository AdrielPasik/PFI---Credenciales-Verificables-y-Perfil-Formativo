# -*- coding: utf-8 -*-
"""P2.1 BASELINE v1 - splitter determinista por secciones y vinetas.

BASELINE_VERSION: P2_1_BASELINE_V1
FROZEN_BEFORE_PROVIDER_CALLS: YES

Preserva texto de la fuente, encabezados, vinetas y orden.
NO hace ninguna inferencia semantica: no agrupa, no normaliza claims, no decide modalidad,
no deduplica por significado y no distingue contexto de requisito.

Es el punto de comparacion obligatorio de P2.0 §25.5: sin el, "el LLM parece mejor" no es
un resultado.
"""
from __future__ import annotations
import re

# Una linea es encabezado si esta marcada como tal por la fuente y es corta.
HEADING = re.compile(r"^(#{1,6}\s+.*|\*\*[^*].*\*\*:?|[A-Za-zÁÉÍÓÚÑáéíóúñ¿¡][^.]{0,60}:)\s*$")
BULLET = re.compile(r"^\s*(?:[-*•]|\d{1,2}[.)])\s*(.+)$")
MIN_CHARS = 25          # descarta fragmentos sin contenido proposicional
MAX_CHARS = 600         # corte duro por unidad, sin reinterpretar


def _is_heading(line: str) -> bool:
    s = line.strip()
    if not s or BULLET.match(s):
        return False
    return bool(HEADING.match(s))


def split_objective(raw: str) -> list[dict]:
    """Devuelve unidades {text, sourceSectionLabel, order} en orden de la fuente."""
    units: list[dict] = []
    section = ""
    order = 0
    for block in raw.split("\n"):
        line = block.rstrip()
        if not line.strip():
            continue
        if _is_heading(line):
            section = line.strip().strip("#* ").rstrip(":")
            continue
        m = BULLET.match(line)
        if m:
            text = m.group(1).strip()
        else:
            text = line.strip()
        # Parrafo largo sin vinetas: se corta por oracion, sin reinterpretar.
        chunks = [text] if len(text) <= MAX_CHARS else re.split(r"(?<=[.;])\s+", text)
        for c in chunks:
            c = c.strip()
            if len(c) < MIN_CHARS:
                continue
            order += 1
            units.append({"order": order, "text": c[:MAX_CHARS], "sourceSectionLabel": section})
    return units


def to_candidates(raw: str) -> list[dict]:
    """Forma de candidato comparable con la del proveedor. El texto propuesto ES la cita:
    el baseline no normaliza claims."""
    out = []
    for u in split_objective(raw):
        out.append({
            "candidateId": "base_%02d" % u["order"],
            "proposedRequirementText": u["text"],
            "primarySourceQuote": u["text"],
            "auxiliarySourceQuotes": [],
            "sourceSectionLabel": u["sourceSectionLabel"],
        })
    return out
