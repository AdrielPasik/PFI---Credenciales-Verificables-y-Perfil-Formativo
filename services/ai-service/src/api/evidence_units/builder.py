"""Grounding determinista del catalogo de EvidenceUnits — slice F3.4.

Promocion de `b2_artifacts.build_evidence_units` + `source_observability_facts` +
`exact_redundancy_and_lineage`, atados al artifact productivo
`source_extraction_v1` en vez de al snapshot de fixture.

LA SEPARACION QUE SOSTIENE TODO EL STAGE:

    el modelo PROPONE      material semantico: que dice la fuente y como se lee
    el codigo ANCLA        donde esta exactamente eso, en que fuente, en que
                           segmento, en que pagina, con que SHA

Ninguna coordenada propuesta por el modelo se persiste. Se alinea la cita contra
el texto canonico VERIFICADO y las coordenadas salen de esa alineacion. Por eso
una cita inventada no puede convertirse en evidencia: no ancla, y punto.

QUE SE RECHAZA, Y CON QUE NOMBRE:

    SOURCE_OUTSIDE_FROZEN_SET   la fuente no es del grounding set congelado
    AMBIGUOUS_QUOTE             la cita aparece mas de una vez -> indecidible
    WRONG_SOURCE_ATTRIBUTION    la cita existe, pero en OTRA fuente
    FABRICATED_EVIDENCE         la cita no existe en ninguna fuente
    DUPLICATE_EVIDENCE_PROPOSAL misma fuente, mismo span, misma proposicion

`WRONG_SOURCE_ATTRIBUTION` merece su propio codigo y no colapsa en "no encontrada":
son dos hechos distintos —una atribucion equivocada y una fabricacion— y
confundirlos borraria justamente el que mas dice sobre el comportamiento del
modelo.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from src.api.evidence_units.aligner import align_quote
from src.api.evidence_units.contracts import (
    CONTEXT_RADIUS,
    INTERPRETATION_PROVENANCE,
    SOURCE_PROVENANCE,
)


def validation(
    taxonomy: str,
    code: str,
    status: str,
    artifact_ref: str,
    detail: str,
    *,
    affects_epistemic_state: bool,
) -> dict[str, Any]:
    """Registro de validacion, misma forma que el `validation()` congelado.

    `detail` lleva ids y tokens cerrados. NUNCA texto de la fuente ni la cita: un
    registro de validacion termina en un log.
    """
    return {
        "taxonomy": taxonomy,
        "code": code,
        "status": status,
        "artifactRef": artifact_ref,
        "detail": detail,
        "affectsEpistemicState": affects_epistemic_state,
    }


def _segment_for_offset(source: dict[str, Any], offset: int) -> dict[str, Any] | None:
    for segment in source.get("segments", []):
        if segment["charStart"] <= offset < segment["charEnd"]:
            return segment
    return None


def _page_number_for_offset(source: dict[str, Any], offset: int) -> int | None:
    for page in source.get("pages", []):
        if page["pageOffsetStart"] <= offset <= page["pageOffsetEnd"]:
            return page["pageNumber"]
    return None


def _segment_scope(source: dict[str, Any], segment_id: str) -> tuple[int, int] | None:
    """El rango del segmento propuesto, si existe.

    Se lee de las coordenadas del artifact —no se re-alinea el excerpt— porque el
    artifact de F0 ya es la autoridad de donde empieza y termina cada segmento.
    """
    segment = next(
        (item for item in source.get("segments", []) if item["segmentId"] == segment_id),
        None,
    )
    if segment is None:
        return None
    return int(segment["charStart"]), int(segment["charEnd"])


def _wrong_source_match(
    quote: str, claimed_source_id: str, canonical_by_source: dict[str, str]
) -> str | None:
    matches = [
        source_id
        for source_id, text in canonical_by_source.items()
        if source_id != claimed_source_id
        and align_quote(text, quote).status in {"EXACT", "REPAIRED"}
    ]
    return ",".join(sorted(matches)) if matches else None


def build_evidence_units(
    proposals: list[dict[str, Any]],
    sources: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Ancla las propuestas contra las fuentes verificadas del run.

    `sources` es la vista productiva de cada fuente INCLUIDA: `sourceId`
    (runLocalSourceId), `sourceSha256`, `coverageStatus`, `canonicalText`,
    `segments`, `pages`, `diagnostics`.
    """
    by_source = {item["sourceId"]: item for item in sources}
    canonical_by_source = {item["sourceId"]: item["canonicalText"] for item in sources}

    accepted: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []
    seen: set[tuple[str, int, int, str]] = set()

    for proposal_index, proposal in enumerate(proposals, start=1):
        ref = f"eu_proposal_{proposal_index:02d}"
        source_id = proposal["sourceId"]
        source = by_source.get(source_id)
        if source is None:
            results.append(
                validation(
                    "HARD_FACTUAL_INVARIANT",
                    "SOURCE_OUTSIDE_FROZEN_SET",
                    "REJECTED",
                    ref,
                    source_id,
                    affects_epistemic_state=False,
                )
            )
            continue

        canonical = source["canonicalText"]
        scope = _segment_scope(source, proposal["segmentId"])
        alignment = align_quote(
            canonical,
            proposal["quoteText"],
            scope_start=scope[0] if scope else 0,
            scope_end=scope[1] if scope else None,
        )
        segment_repaired = False
        if alignment.status == "NOT_FOUND" and scope is not None:
            # El segmento propuesto puede estar equivocado sin que la cita lo este.
            # Se reintenta contra la fuente entera; el segmento autoritativo lo
            # decide despues el offset, no el modelo.
            alignment = align_quote(canonical, proposal["quoteText"])
            segment_repaired = alignment.status in {"EXACT", "REPAIRED"}

        if alignment.status == "AMBIGUOUS":
            results.append(
                validation(
                    "HARD_FACTUAL_INVARIANT",
                    "AMBIGUOUS_QUOTE",
                    "REJECTED",
                    ref,
                    str(alignment.occurrence_count),
                    affects_epistemic_state=False,
                )
            )
            continue
        if alignment.status == "NOT_FOUND":
            actual_source = _wrong_source_match(
                proposal["quoteText"], source_id, canonical_by_source
            )
            if actual_source:
                results.append(
                    validation(
                        "HARD_FACTUAL_INVARIANT",
                        "WRONG_SOURCE_ATTRIBUTION",
                        "REJECTED",
                        ref,
                        f"claimed={source_id};found={actual_source}",
                        affects_epistemic_state=False,
                    )
                )
            else:
                results.append(
                    validation(
                        "HARD_FACTUAL_INVARIANT",
                        "FABRICATED_EVIDENCE",
                        "REJECTED",
                        ref,
                        source_id,
                        affects_epistemic_state=False,
                    )
                )
            continue

        start = int(alignment.char_start)
        end = int(alignment.char_end)
        key = (source_id, start, end, proposal["normalizedProposition"].casefold())
        if key in seen:
            results.append(
                validation(
                    "DETERMINISTIC_REPAIRABLE",
                    "DUPLICATE_EVIDENCE_PROPOSAL",
                    "REPAIRED",
                    ref,
                    source_id,
                    affects_epistemic_state=False,
                )
            )
            continue
        seen.add(key)

        # Id determinista por ORDEN DE ACEPTACION. No lo elige el modelo y no se
        # deriva de un hash del texto: dos catalogos con las mismas propuestas
        # aceptadas producen los mismos ids.
        evidence_unit_id = f"eu_{len(accepted) + 1:02d}"
        authoritative_segment = _segment_for_offset(source, start)

        if alignment.status == "REPAIRED":
            results.append(
                validation(
                    "DETERMINISTIC_REPAIRABLE",
                    "TRACE_ALIGNMENT_REPAIRED",
                    "REPAIRED",
                    evidence_unit_id,
                    alignment.repair or "controlled normalization",
                    affects_epistemic_state=False,
                )
            )
        else:
            results.append(
                validation(
                    "DETERMINISTIC_REPAIRABLE",
                    "TRACE_ALIGNMENT_EXACT",
                    "PASS",
                    evidence_unit_id,
                    source_id,
                    affects_epistemic_state=False,
                )
            )

        if (
            scope is None
            or segment_repaired
            or (
                authoritative_segment
                and authoritative_segment["segmentId"] != proposal["segmentId"]
            )
        ):
            results.append(
                validation(
                    "DETERMINISTIC_REPAIRABLE",
                    "SEGMENT_DERIVED",
                    "REPAIRED",
                    evidence_unit_id,
                    authoritative_segment["segmentId"] if authoritative_segment else "none",
                    affects_epistemic_state=False,
                )
            )

        accepted.append(
            {
                "evidenceUnitId": evidence_unit_id,
                "normalizedProposition": proposal["normalizedProposition"],
                "claimType": proposal["claimType"],
                "semanticQualifiers": [
                    {"kind": item["kind"], "value": item["value"]}
                    for item in proposal["semanticQualifiers"]
                ],
                # SIEMPRE una rebanada del canonico verificado, nunca el texto que
                # mando el modelo: si difieren, la fuente gana.
                "exactQuote": canonical[start:end],
                "contextBefore": canonical[max(0, start - CONTEXT_RADIUS) : start],
                "contextAfter": canonical[end : min(len(canonical), end + CONTEXT_RADIUS)],
                # El artifact productivo no lleva `sectionLabel` por segmento.
                "sectionLabel": None,
                "sourceTrace": {
                    "sourceId": source_id,
                    "sourceSha256": source["sourceSha256"],
                    "segmentId": (
                        authoritative_segment["segmentId"] if authoritative_segment else None
                    ),
                    "pageNumber": _page_number_for_offset(source, start),
                    "charStart": start,
                    "charEnd": end,
                    "exactExcerpt": canonical[start:end],
                },
                "interpretationProvenance": INTERPRETATION_PROVENANCE,
                "extractionQuality": source["coverageStatus"],
            }
        )
        results.append(
            validation(
                "HARD_FACTUAL_INVARIANT",
                "SOURCE_SHA_IDENTITY_VALID",
                "PASS",
                evidence_unit_id,
                source["sourceSha256"],
                affects_epistemic_state=False,
            )
        )
        results.append(
            validation(
                "HARD_FACTUAL_INVARIANT",
                "AUTHORITATIVE_PROVENANCE_CONSTRUCTED",
                "PASS",
                evidence_unit_id,
                SOURCE_PROVENANCE,
                affects_epistemic_state=False,
            )
        )

    return accepted, results


def exact_redundancy_groups(
    evidence_units: list[dict[str, Any]]
) -> list[list[str]]:
    """Grupos de unidades que citan EXACTAMENTE el mismo span.

    Solo por span —`sourceSha256:charStart:charEnd`—: `PRODUCT_LINEAGE_ID_V1: NONE`,
    asi que la rama de lineage del candidato congelado no tiene con que agrupar y
    no se promueve.
    """
    groups: dict[str, list[str]] = defaultdict(list)
    for item in evidence_units:
        trace = item["sourceTrace"]
        key = f"{trace['sourceSha256']}:{trace['charStart']}:{trace['charEnd']}"
        groups[key].append(item["evidenceUnitId"])
    return [
        list(group)
        for group in sorted({tuple(sorted(ids)) for ids in groups.values() if len(set(ids)) > 1})
    ]


def source_observability_facts(
    sources: list[dict[str, Any]], evidence_units: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Un hecho por fuente INCLUIDA. Determinista, no un juicio del modelo.

    SE RECORREN LAS FUENTES, no las EvidenceUnits. Una fuente con `coverage FAILED`
    y cero unidades igual tiene su hecho: `coverage FAILED` es input epistemologico
    valido con sus limites de observabilidad, no ausencia de fuente. Construirlo al
    reves la borraria del registro justo cuando mas importa decir que se la miro.
    """
    return [
        {
            "sourceId": source["sourceId"],
            "coverageStatus": source["coverageStatus"],
            "observedEvidenceUnitIds": [
                unit["evidenceUnitId"]
                for unit in evidence_units
                if unit["sourceTrace"]["sourceId"] == source["sourceId"]
            ],
            "extractionDiagnostics": list(source.get("diagnostics", [])),
        }
        for source in sources
    ]
