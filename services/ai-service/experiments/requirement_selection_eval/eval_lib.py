"""Evaluacion de extraccion + seleccion de Requirements contra referencia humana.

QUE MIDE, por aviso:

    count                     candidatos propuestos (tope: `maximum`)
    unanchored                citas que no estan literalmente en el aviso (= inventadas)
    precision                 TP / (TP + FP); los BORDERLINE no suman ni restan
    falsePositives            candidatos que solo tocan items DISCARD
    inflations                candidatos que agregan un termino "fuerte" (liderazgo,
                              competencias avanzadas, ...) que su cita no dice
    duplicates                candidatos de mas sobre un mismo requisito (grupo)
    mergedIndependent         un candidato que cubre dos requisitos independientes
    keepRecall                grupos legitimos cubiertos / grupos legitimos
    mandatoryCoverage         grupos EXCLUYENTES cubiertos / grupos excluyentes
    requiredCoverage          grupos excluyentes + requeridos cubiertos; solo es
                              exigible si entran en el tope
    humanSelectionAgreement   acuerdo con la seleccion humana (informativo)
    missedKeepGroups          requisitos legitimos que quedaron afuera
    nonFormativeAsRequirement condiciones legitimas no formativas (disponibilidad,
                              edad, documentacion) emitidas como Requirement:
                              no son error, pero consumen un lugar del analisis
    nonFormativeVisible       condiciones no formativas visibles para la persona
                              (como Requirement o como pasaje con su cita) /
                              total. Deben ser 1.0: una condicion no desaparece

Y entre un aviso y su permutacion de parrafos: `stability` (Jaccard de los grupos
cubiertos).

EMPAREJAMIENTO. Un candidato se ancla por su cita primaria (busqueda literal,
como el builder productivo) y se empareja con los items del gold cuyo rango se
solapa con el suyo en al menos la mitad del mas corto. No hay similitud
semantica ni embeddings: el gold esta escrito por linea (o por sub-linea cuando
una linea trae condiciones independientes).

Este modulo NO llama a ningun proveedor. Las simulaciones de abajo son
SIMULACIONES: fijan la metrica y prueban el pipeline, no el modelo.
"""

from __future__ import annotations

import json
import random
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any

EVAL_ROOT = Path(__file__).resolve().parent
KEEP, DISCARD, BORDERLINE = "KEEP", "DISCARD", "BORDERLINE"
NON_FORMATIVE = "NON_FORMATIVE_CONDITION"
NON_FORMATIVE_REASON_PREFIX = "Condicion no formativa:"
MANDATORY, REQUIRED, DESIRABLE = "MANDATORY", "REQUIRED", "DESIRABLE"

#: Criterios de aceptacion del P0 (ver README).
MIN_PRECISION = 0.90


@dataclass(frozen=True)
class Posting:
    posting_id: str
    title: str
    objective_type: str
    text: str
    gold: dict[str, Any]

    @property
    def items(self) -> list[dict[str, Any]]:
        return self.gold["items"]


def load_postings(root: Path = EVAL_ROOT) -> list[Posting]:
    postings = []
    for gold_file in sorted((root / "gold").glob("*.gold.json")):
        gold = json.loads(gold_file.read_text(encoding="utf-8"))
        text = (root / gold["file"]).read_text(encoding="utf-8")
        postings.append(
            Posting(
                posting_id=gold["postingId"],
                title=gold["title"],
                objective_type=gold["objectiveType"],
                text=text,
                gold=gold,
            )
        )
    return postings


def fold(text: str) -> str:
    """Minusculas sin acentos, para comparar terminos."""
    decomposed = unicodedata.normalize("NFD", text.lower())
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")


def _span(text: str, quote: str) -> tuple[int, int] | None:
    if not quote:
        return None
    start = text.find(quote)
    return None if start < 0 else (start, start + len(quote))


def _target_span(text: str, quote: str) -> tuple[int, int] | None:
    """Rango de la linea que la cita SENALA.

    OU_A2 cita "desde el encabezado hasta la vineta que te interesa, incluyendo
    todo lo que hay en medio" para conservar qualifiers como "Excluyente". Esa
    cita es literal, pero se superpone con las vinetas intermedias; para
    emparejar con el gold cuenta la ULTIMA linea no vacia, que es la vineta
    citada. Una cita de una sola linea queda igual.
    """
    span = _span(text, quote)
    if span is None:
        return None
    lines = quote.rstrip().splitlines()
    last = next((line for line in reversed(lines) if line.strip()), "")
    if len(lines) == 1 or not last:
        return span
    offset = quote.rstrip().rfind(last)
    return (span[0] + offset, span[0] + offset + len(last))


def _overlaps(a: tuple[int, int], b: tuple[int, int]) -> bool:
    overlap = min(a[1], b[1]) - max(a[0], b[0])
    if overlap <= 0:
        return False
    return overlap * 2 >= min(a[1] - a[0], b[1] - b[0])


def keep_groups(posting: Posting) -> set[str]:
    return {item["group"] for item in posting.items if item["label"] == KEEP}


def _group_priority(posting: Posting) -> dict[str, str]:
    """Prioridad de un grupo = la mas fuerte de sus items."""
    rank = {MANDATORY: 0, REQUIRED: 1, DESIRABLE: 2}
    best: dict[str, str] = {}
    for item in posting.items:
        if item["label"] != KEEP:
            continue
        current = best.get(item["group"])
        if current is None or rank[item["priority"]] < rank[current]:
            best[item["group"]] = item["priority"]
    return best


def score(
    posting: Posting,
    candidates: list[dict[str, str]],
    maximum: int,
    unresolved: list[str] | None = None,
) -> dict[str, Any]:
    """Metricas de UNA propuesta.

    `candidates`: [{"text", "quote"}]. `unresolved`: citas literales de los
    pasajes no convertidos en Requirement (donde la politica manda las
    condiciones no formativas). `None` = no se observaron.
    """
    legit = keep_groups(posting)
    priority = _group_priority(posting)
    gold_spans = [(item, _span(posting.text, item["quote"])) for item in posting.items]
    forbidden = [fold(term) for term in posting.gold.get("forbiddenInflations", [])]

    tp = fp = neutral = unanchored = non_formative = 0
    visible_ids: set[str] = set()
    false_positives: list[str] = []
    inflations: list[str] = []
    merged: list[str] = []
    group_hits: dict[str, int] = {}

    for candidate in candidates:
        span = _target_span(posting.text, candidate["quote"])
        if span is None:
            unanchored += 1
            continue
        matched = [item for item, gold_span in gold_spans if gold_span and _overlaps(span, gold_span)]
        visible_ids.update(item["id"] for item in matched)
        groups = {item["group"] for item in matched if item["group"] in legit}
        for group in groups:
            group_hits[group] = group_hits.get(group, 0) + 1
        if len(groups) >= 2:
            merged.append(candidate["text"])
        if groups:
            tp += 1
        elif any(item["label"] == BORDERLINE for item in matched):
            neutral += 1
        elif matched and all(item["category"] == NON_FORMATIVE for item in matched):
            # Legitima pero no formativa: no es un falso positivo, pero ocupa
            # un lugar del analisis. Se cuenta aparte.
            non_formative += 1
        else:
            fp += 1
            false_positives.append(",".join(item["id"] for item in matched) or "(sin item)")

        source = fold(" ".join(item["quote"] for item in matched) or candidate["quote"])
        text = fold(candidate["text"])
        if any(term in text and term not in source for term in forbidden):
            inflations.append(candidate["text"])

    for quote in unresolved or []:
        span = _span(posting.text, quote)
        if span is None:
            continue
        visible_ids.update(
            item["id"] for item, gold_span in gold_spans if gold_span and _overlaps(span, gold_span)
        )
    conditions = {item["id"] for item in posting.items if item["category"] == NON_FORMATIVE}

    covered = set(group_hits)
    mandatory = {g for g, p in priority.items() if p == MANDATORY}
    required = {g for g, p in priority.items() if p in (MANDATORY, REQUIRED)}
    judged = tp + fp
    human = posting.gold.get("humanSelection")

    return {
        "count": len(candidates),
        "withinMaximum": len(candidates) <= maximum,
        "unanchored": unanchored,
        "precision": None if judged == 0 else round(tp / judged, 4),
        "truePositives": tp,
        "falsePositives": fp,
        "falsePositiveItems": false_positives,
        "neutral": neutral,
        "inflations": inflations,
        "duplicates": sum(hits - 1 for hits in group_hits.values()),
        "mergedIndependent": merged,
        "keepRecall": round(len(covered & legit) / len(legit), 4) if legit else None,
        "mandatoryCoverage": _coverage(covered, mandatory),
        "mandatoryApplicable": len(mandatory) <= maximum,
        "requiredCoverage": _coverage(covered, required),
        "requiredApplicable": len(required) <= maximum,
        "missedKeepGroups": sorted(legit - covered),
        "coveredGroups": sorted(covered),
        "nonFormativeAsRequirement": non_formative,
        "nonFormativeVisible": (
            None if not conditions else round(len(conditions & visible_ids) / len(conditions), 4)
        ),
        "humanSelectionAgreement": (
            None
            if human is None
            else round(len(covered & set(human["groups"])) / len(human["groups"]), 4)
        ),
    }


def _coverage(covered: set[str], expected: set[str]) -> float | None:
    if not expected:
        return None
    return round(len(covered & expected) / len(expected), 4)


def acceptance(result: dict[str, Any], maximum: int) -> dict[str, bool]:
    """Los criterios del P0, uno por uno, sobre UN resultado."""
    precision = result["precision"]
    return {
        "zeroInvented": result["unanchored"] == 0,
        "zeroInflations": not result["inflations"],
        "precisionAtLeast90": precision is None or precision >= MIN_PRECISION,
        "mandatoryKeptWhenFits": (
            not result["mandatoryApplicable"] or result["mandatoryCoverage"] in (None, 1.0)
        ),
        "requiredKeptWhenFits": (
            not result["requiredApplicable"] or result["requiredCoverage"] in (None, 1.0)
        ),
        "noSubstantialDuplicates": result["duplicates"] == 0,
        "noMergedIndependent": not result["mergedIndependent"],
        "atMostMaximum": result["count"] <= maximum,
        "nonFormativeConditionsVisible": result["nonFormativeVisible"] in (None, 1.0),
    }


def stability(a: dict[str, Any], b: dict[str, Any]) -> float:
    left, right = set(a["coveredGroups"]), set(b["coveredGroups"])
    if not left and not right:
        return 1.0
    return round(len(left & right) / len(left | right), 4)


def permute_paragraphs(text: str, seed: int) -> str:
    """Permuta los bloques separados por linea en blanco, salvo el titulo."""
    blocks = text.strip("\n").split("\n\n")
    head, rest = blocks[0], blocks[1:]
    random.Random(seed).shuffle(rest)
    return "\n\n".join([head, *rest]) + "\n"


# ---------------------------------------------------------------------------
# Simulaciones (NO son el modelo)
# ---------------------------------------------------------------------------


def _strip(quote: str) -> str:
    return quote.rstrip(".").strip()


def oracle_extraction(posting: Posting) -> list[dict[str, str]]:
    """Lo que la politica pide extraer: un candidato por requisito legitimo."""
    seen: set[str] = set()
    out = []
    for item in posting.items:
        if item["label"] != KEEP or item["group"] in seen:
            continue
        seen.add(item["group"])
        out.append({"text": _strip(item["quote"]), "quote": item["quote"]})
    return out


def oracle_selection(posting: Posting, extracted: list[dict[str, str]], maximum: int) -> list[int]:
    """Numeros (base 1) que elige la referencia humana. Solo si hace falta."""
    if len(extracted) <= maximum:
        return list(range(1, len(extracted) + 1))
    human = posting.gold.get("humanSelection")
    if human is None:
        raise ValueError(f"{posting.posting_id}: hace falta seleccion humana")
    chosen = set(human["groups"])
    group_of = {item["quote"]: item["group"] for item in posting.items}
    return [n for n, c in enumerate(extracted, start=1) if group_of[c["quote"]] in chosen]


def observed_failure_extraction(posting: Posting) -> list[dict[str, str]]:
    """Simula la falla reportada: sin politica, cada linea es un Requirement y
    algunas tareas o actitudes salen "infladas" (`observedFailureText`)."""
    return [
        {"text": item.get("observedFailureText") or _strip(item["quote"]), "quote": item["quote"]}
        for item in posting.items
    ]


def naive_slice(candidates: list[dict[str, str]], maximum: int) -> list[dict[str, str]]:
    """Lo que NO se hace en producto: quedarse con los primeros N."""
    return candidates[:maximum]


def oracle_unresolved(posting: Posting) -> list[dict[str, str]]:
    """Lo que la politica pide con las condiciones no formativas: visibles,
    como pasaje con su cita, no como Requirement."""
    return [
        {"quote": item["quote"], "reason": f"{NON_FORMATIVE_REASON_PREFIX} {item['reason']}"}
        for item in posting.items
        if item["category"] == NON_FORMATIVE
    ]


def as_provider_proposals(
    candidates: list[dict[str, str]], unresolved: list[dict[str, str]] | None = None
) -> dict[str, Any]:
    return {
        "proposedRequirements": [
            {
                "proposedRequirementText": c["text"],
                "primarySourceQuote": c["quote"],
                "auxiliarySourceQuotes": [],
                "sourceSectionLabel": "",
            }
            for c in candidates
        ],
        "unresolvedPassages": list(unresolved or []),
    }


def artifact_unresolved(artifact: dict[str, Any]) -> list[str]:
    return [passage["exactExcerpt"] for passage in artifact["unresolvedPassages"]]


def artifact_candidates(artifact: dict[str, Any]) -> list[dict[str, str]]:
    """Del artefacto productivo a la forma que puntua `score`."""
    out = []
    for candidate in artifact["candidates"]:
        reference = candidate["primarySourceReference"]
        out.append(
            {
                "text": candidate["proposedRequirementText"],
                "quote": "" if reference is None else reference["exactExcerpt"],
            }
        )
    return out
