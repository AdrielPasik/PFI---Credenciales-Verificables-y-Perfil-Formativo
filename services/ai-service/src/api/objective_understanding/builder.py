"""Constructor confiable de la propuesta — slice P2.2.

LO QUE ESTE CODIGO SI PUEDE PROBAR, y por eso es suyo:

    que una cita existe LITERALMENTE en el texto crudo enviado
    si ancla de forma UNICA, AMBIGUA o NO SE ENCUENTRA
    en que offsets, en code points Unicode
    que identidad de candidato le toca y en que orden
    que dos candidatos son duplicados EXACTOS

LO QUE NO PUEDE PROBAR, y por eso NO afirma:

    fidelidad semantica del claim
    deteccion de duplicados SEMANTICOS
    granularidad correcta
    completitud
    interpretacion de required/preferred

P2.1 midio esas cuatro ultimas con adjudicacion humana y el resultado esta en el
registro. Aca no se re-afirman.

FIDELIDAD AL BUILDER EVALUADO. Este modulo reproduce el comportamiento de
`experiments/objective_understanding/runs/trusted_builder.py` tal como se ejecuto
en Development, Holdout y cross-domain. Dos decisiones merecen justificarse porque
P2.0 §22.3 esboza algo distinto:

    ORDEN. El builder evaluado NO reordena por posicion en la fuente: conserva el
    orden de emision del proveedor, que el prompt obliga a que sea el de la
    fuente. Reordenar aca produciria una salida que la evaluacion nunca observo,
    y el orden ya es determinista porque es una funcion pura de la respuesta.

    DUPLICADOS EXACTOS. El builder evaluado los MARCA, no los elimina. Eliminarlos
    cambiaria el conjunto de candidatos que el humano revisa respecto de lo
    medido. La marca viaja y la UI decide.

SIN LLAMADA DE REPARACION. Un fallo de anclaje se le muestra al humano; no se le
vuelve a preguntar al proveedor (P2.0 §15).
"""

from __future__ import annotations

from typing import Any

from src.api.objective_understanding.contracts import (
    ANCHOR_AMBIGUOUS,
    ANCHOR_NOT_FOUND,
    ANCHOR_UNIQUE,
    ARTIFACT_SCHEMA_VERSION,
    OFFSET_UNIT,
    SOURCE_NORMALIZATION,
)

#: Tope de ubicaciones que se conservan para una cita ambigua. Existe para acotar
#: el tamano de la respuesta, no para elegir: una cita ambigua NUNCA puede ser
#: primaria, cuantas ubicaciones se muestren.
MAX_AMBIGUOUS_LOCATIONS = 20


def _occurrences(raw: str, quote: str) -> list[tuple[int, int]]:
    """Todas las ubicaciones literales de `quote` en `raw`, en code points.

    Python indexa `str` por code point, asi que los offsets ya estan en la unidad
    congelada sin conversion. No se normaliza el texto: el texto enviado es la
    unica autoridad textual (P2.0 §14).
    """
    if not quote:
        return []
    found: list[tuple[int, int]] = []
    index = 0
    while True:
        position = raw.find(quote, index)
        if position < 0:
            return found
        found.append((position, position + len(quote)))
        index = position + 1


def anchor(raw: str, quote: str) -> dict[str, Any]:
    """Ancla una cita propuesta contra el texto crudo.

    NUNCA se elige "la primera ocurrencia" en silencio: una cita con varias
    ubicaciones queda `AMBIGUOUS` y se conservan las ubicaciones para revision
    humana. Elegir una seria producir un resaltado que apunta al lugar equivocado
    sin que nadie se entere.
    """
    occurrences = _occurrences(raw, quote)
    if not occurrences:
        return {"status": ANCHOR_NOT_FOUND, "occurrences": 0}
    if len(occurrences) > 1:
        return {
            "status": ANCHOR_AMBIGUOUS,
            "occurrences": len(occurrences),
            "locations": [
                {"charStart": start, "charEnd": end, "offsetUnit": OFFSET_UNIT}
                for start, end in occurrences[:MAX_AMBIGUOUS_LOCATIONS]
            ],
        }
    start, end = occurrences[0]
    return {
        "status": ANCHOR_UNIQUE,
        "occurrences": 1,
        "charStart": start,
        "charEnd": end,
    }


def _reference(quote: str, anchored: dict[str, Any]) -> dict[str, Any]:
    """Referencia confiable. El excerpt es el texto EXACTO del original."""
    return {
        "exactExcerpt": quote,
        "charStart": anchored["charStart"],
        "charEnd": anchored["charEnd"],
        "offsetUnit": OFFSET_UNIT,
    }


def _ambiguous(quote: str, anchored: dict[str, Any]) -> dict[str, Any]:
    return {
        "exactExcerpt": quote,
        "occurrences": anchored["occurrences"],
        "locations": anchored["locations"],
    }


def build_proposal_artifact(
    raw_objective_text: str,
    proposals: list[dict[str, Any]],
    unresolved: list[dict[str, Any]],
) -> dict[str, Any]:
    """Construye `objective_requirement_proposal_v1` a partir de la propuesta.

    `proposals` llega en el orden que emitio el proveedor y ese orden se conserva.
    """
    candidates: list[dict[str, Any]] = []
    seen_exact: set[tuple[str, str]] = set()

    for index, proposal in enumerate(proposals, start=1):
        text = (proposal.get("proposedRequirementText") or "").strip()
        primary_quote = proposal.get("primarySourceQuote") or ""
        primary = anchor(raw_objective_text, primary_quote)

        auxiliary: list[dict[str, Any]] = []
        ambiguous: list[dict[str, Any]] = []
        unmatched: list[str] = []

        if primary["status"] == ANCHOR_AMBIGUOUS:
            ambiguous.append(_ambiguous(primary_quote, primary))
        elif primary["status"] == ANCHOR_NOT_FOUND and primary_quote:
            unmatched.append(primary_quote)

        # Colapso determinista de citas auxiliares IDENTICAS (P2.0 §15). Es
        # igualdad de string, no juicio semantico.
        seen_auxiliary: set[str] = set()
        for quote in proposal.get("auxiliarySourceQuotes") or []:
            if not quote or quote in seen_auxiliary:
                continue
            seen_auxiliary.add(quote)
            anchored = anchor(raw_objective_text, quote)
            if anchored["status"] == ANCHOR_UNIQUE:
                auxiliary.append(_reference(quote, anchored))
            elif anchored["status"] == ANCHOR_AMBIGUOUS:
                ambiguous.append(_ambiguous(quote, anchored))
            else:
                unmatched.append(quote)

        key = (text, primary_quote)
        is_exact_duplicate = key in seen_exact
        seen_exact.add(key)

        candidate: dict[str, Any] = {
            "candidateId": "cand_%02d" % index,
            "order": index,
            "proposedRequirementText": text,
            # `None` cuando la cita primaria no ancla de forma unica. El candidato
            # SE MUESTRA igual: la persona puede confirmarlo, pero solo como
            # entrada estructurada directa (P2.0 §15).
            "primarySourceReference": (
                _reference(primary_quote, primary)
                if primary["status"] == ANCHOR_UNIQUE
                else None
            ),
            "primarySourceGrounding": primary["status"],
            "auxiliarySourceReferences": auxiliary,
            "ambiguousReferences": ambiguous,
            "unmatchedReferences": unmatched,
            "sourceSectionLabel": proposal.get("sourceSectionLabel") or "",
            "exactDuplicateOfEarlier": is_exact_duplicate,
            # Lo que decide el handoff a F2. Un candidato sin anclaje unico NO
            # puede confirmarse como derivado de la fuente.
            "confirmableAsSourceDerived": primary["status"] == ANCHOR_UNIQUE,
        }
        candidates.append(candidate)

    unresolved_passages: list[dict[str, Any]] = []
    for item in unresolved or []:
        quote = item.get("quote") or ""
        anchored = anchor(raw_objective_text, quote)
        entry: dict[str, Any] = {
            "exactExcerpt": quote,
            "reason": item.get("reason") or "",
            "grounding": anchored["status"],
        }
        if anchored["status"] == ANCHOR_UNIQUE:
            entry["charStart"] = anchored["charStart"]
            entry["charEnd"] = anchored["charEnd"]
            entry["offsetUnit"] = OFFSET_UNIT
        elif anchored["status"] == ANCHOR_AMBIGUOUS:
            entry["occurrences"] = anchored["occurrences"]
        unresolved_passages.append(entry)

    return {
        "schemaVersion": ARTIFACT_SCHEMA_VERSION,
        "sourceNormalization": SOURCE_NORMALIZATION,
        "offsetUnit": OFFSET_UNIT,
        "sourceCharacterCount": len(raw_objective_text),
        "candidates": candidates,
        "unresolvedPassages": unresolved_passages,
        "grounding": {
            "candidateCount": len(candidates),
            "primaryUnique": sum(
                1 for c in candidates if c["primarySourceGrounding"] == ANCHOR_UNIQUE
            ),
            "primaryAmbiguous": sum(
                1 for c in candidates if c["primarySourceGrounding"] == ANCHOR_AMBIGUOUS
            ),
            "primaryNotFound": sum(
                1 for c in candidates if c["primarySourceGrounding"] == ANCHOR_NOT_FOUND
            ),
            "exactDuplicates": sum(1 for c in candidates if c["exactDuplicateOfEarlier"]),
        },
    }
