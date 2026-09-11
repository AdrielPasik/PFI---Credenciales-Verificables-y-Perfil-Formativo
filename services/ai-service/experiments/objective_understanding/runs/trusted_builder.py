# -*- coding: utf-8 -*-
"""P2.1 - Codigo confiable (P2.0 §15, §16, §20).

Deriva y verifica de forma determinista:
  - existencia literal de cada cita en el texto crudo
  - estado de anclaje UNIQUE / AMBIGUOUS / NOT_FOUND
  - offsets en code points Unicode
  - candidateId estable y orden determinista
  - duplicados exactos

NO prueba fidelidad semantica, qualifiers, modalidad, granularidad ni completitud.
El proveedor nunca aporta offsets ni candidateId.
"""
from __future__ import annotations

TRUSTED_BUILDER_VERSION = "P2_1_TRUSTED_BUILDER_V1"


def _occurrences(raw: str, quote: str) -> list[tuple[int, int]]:
    if not quote:
        return []
    out, i = [], 0
    while True:
        j = raw.find(quote, i)
        if j < 0:
            return out
        out.append((j, j + len(quote)))
        i = j + 1


def anchor(raw: str, quote: str) -> dict:
    occ = _occurrences(raw, quote)
    if not occ:
        return {"status": "NOT_FOUND", "occurrences": 0, "charStart": None, "charEnd": None}
    if len(occ) > 1:
        # P2.0 §15: nunca se elige "la primera ocurrencia" en silencio.
        return {"status": "AMBIGUOUS", "occurrences": len(occ),
                "charStart": None, "charEnd": None, "allOccurrences": occ}
    return {"status": "UNIQUE", "occurrences": 1, "charStart": occ[0][0], "charEnd": occ[0][1]}


def build(raw: str, proposals: list[dict], prefix: str = "cand") -> dict:
    """proposals: [{proposedRequirementText, primarySourceQuote, auxiliarySourceQuotes,
    sourceSectionLabel}] en el orden emitido por el proveedor."""
    candidates, seen_exact = [], {}
    exact_duplicates = 0
    for i, p in enumerate(proposals, start=1):
        text = (p.get("proposedRequirementText") or "").strip()
        pq = p.get("primarySourceQuote") or ""
        primary = anchor(raw, pq)
        aux = []
        for q in (p.get("auxiliarySourceQuotes") or []):
            a = anchor(raw, q)
            a["quote"] = q
            aux.append(a)
        key = (text, pq)
        is_dup = key in seen_exact
        if is_dup:
            exact_duplicates += 1
        else:
            seen_exact[key] = True
        candidates.append({
            "candidateId": "%s_%02d" % (prefix, i),
            "order": i,
            "proposedRequirementText": text,
            "primarySourceQuote": pq,
            "primaryAnchor": primary,
            "auxiliaryAnchors": aux,
            "sourceSectionLabel": p.get("sourceSectionLabel") or "",
            "exactDuplicateOfEarlier": is_dup,
            # P2.0 §15: sin referencia primaria valida solo podria persistirse como
            # DIRECT_STRUCTURED_INPUT al confirmar.
            "persistableAsDerived": primary["status"] == "UNIQUE",
        })
    total_quotes = len(candidates) + sum(len(c["auxiliaryAnchors"]) for c in candidates)
    found = sum(1 for c in candidates if c["primaryAnchor"]["status"] != "NOT_FOUND")
    found += sum(1 for c in candidates for a in c["auxiliaryAnchors"] if a["status"] != "NOT_FOUND")
    unique_primary = sum(1 for c in candidates if c["primaryAnchor"]["status"] == "UNIQUE")
    return {
        "trustedBuilderVersion": TRUSTED_BUILDER_VERSION,
        "candidates": candidates,
        "counts": {
            "candidates": len(candidates),
            "quotesTotal": total_quotes,
            "quotesFoundLiterally": found,
            "primaryUnique": unique_primary,
            "primaryAmbiguous": sum(1 for c in candidates if c["primaryAnchor"]["status"] == "AMBIGUOUS"),
            "primaryNotFound": sum(1 for c in candidates if c["primaryAnchor"]["status"] == "NOT_FOUND"),
            "exactDuplicates": exact_duplicates,
        },
    }
