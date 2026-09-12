"""Validación estructural del razonamiento contextual — slice F3.5.

Promoción de `validate_and_enrich_b24`, adaptada a la autoridad productiva.

QUÉ SE VALIDA, Y QUÉ NO. Esto comprueba ESTRUCTURA y REFERENCIAS: que el
Requirement sea el que se pidió, que cada `evidenceUnitId` exista en el catálogo,
que cada `qualifierId` sea un qualifier MATERIAL de ESTE Requirement, que las
`localFacetKey` sean únicas y que toda referencia downstream apunte a una que
existe, y que las combinaciones estructuralmente contradictorias no pasen.

NO se juzga si una relation es semánticamente acertada, si un ceiling es
suficientemente fuerte ni si la continuidad es verdadera. Eso sería un segundo
motor semántico.

DELTAS DE PRODUCTIZACIÓN respecto del validador congelado, los tres derivados del
contrato de F3.1:

    facetId global (`{req}_facet_NN`)   RETIRADO — el contrato productivo conserva
                                        `localFacetKey`, que ya es local al
                                        Requirement
    requirementBasisSpans               RETIRADO — no existe en el contrato
    facetEvidenceFitting                RETIRADO — no existe en el contrato
    searchRequired                      RETIRADO del artifact; F3.6 lo recomputa
                                        determinísticamente desde
                                        formativeEvidenceCapable + fullClaim +
                                        observabilityStatus, que ya tiene

REPARACIÓN DETERMINISTA, y sólo la que el candidato congelado autoriza: filtrar
`evaluatedEvidence` cuyas referencias no existan, DEJANDO el registro del fallo.
Nada de defaults semánticos.
"""

from __future__ import annotations

from typing import Any

from src.api.contextual_reasoning.requirement_anchoring import (
    derive_basis_phrases,
    tokenize_requirement,
)
from src.api.contextual_reasoning.contracts import (
    CONTINUITY_TRANSFORMATION_BY_STATUS,
    FORBIDDEN_FINAL_STATE_TOKENS,
    MATERIAL_QUALIFIER_ROLE,
    ProviderInvalidOutputError,
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
    """Registro de validación. `detail` lleva ids y tokens, nunca texto libre."""
    return {
        "taxonomy": taxonomy,
        "code": code,
        "status": status,
        "artifactRef": artifact_ref,
        "detail": detail,
        "affectsEpistemicState": affects_epistemic_state,
    }


def _fail(code: str) -> None:
    raise ProviderInvalidOutputError(code)


def _subset(values: list[str], allowed: set[str]) -> bool:
    return set(values) <= allowed


def material_qualifier_ids(analysis_requirement: dict[str, Any]) -> set[str]:
    """Los qualifiers REFERENCIABLES de este Requirement.

    SOLO los materiales. Un `CONTEXTUAL` o un `STRUCTURAL_WRAPPER` describe el
    entorno o el envoltorio discursivo del Requirement: convertirlo en condición
    de soporte faltante inventaría una exigencia que el Requirement no hace. El
    validador congelado hace exactamente esto —`requirement["materialQualifiers"]`—
    y acá se reproduce desde el rol, porque el artifact productivo guarda los tres
    roles en una sola lista.
    """
    return {
        qualifier["qualifierId"]
        for qualifier in analysis_requirement["qualifiers"]
        if qualifier["role"] == MATERIAL_QUALIFIER_ROLE and qualifier["qualifierId"]
    }


def validate_contextual_result(
    raw: dict[str, Any],
    *,
    analysis_requirement: dict[str, Any],
    evidence_unit_ids: set[str],
    source_ids: set[str],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Valida la salida del proveedor para UN Requirement.

    Devuelve `(resultado, validaciones)`. Cualquier violación estructural dura es
    `ProviderInvalidOutputError`: el proveedor respondió entero y su salida no
    cumple el contrato, así que no se le vuelve a preguntar.
    """
    requirement_id = analysis_requirement["requirementId"]
    result = dict(raw)
    results: list[dict[str, Any]] = []
    qualifier_ids = material_qualifier_ids(analysis_requirement)

    # --- el Requirement es el que se pidió --------------------------------
    if result["requirementId"] != requirement_id:
        _fail("contextual_requirement_id_mismatch")
    results.append(
        validation(
            "HARD_FACTUAL_INVARIANT",
            "REQUIREMENT_ID_EXISTS",
            "PASS",
            requirement_id,
            requirement_id,
            affects_epistemic_state=False,
        )
    )

    # --- ninguna autoridad de estado final --------------------------------
    for token in FORBIDDEN_FINAL_STATE_TOKENS:
        if token in (result.get("unresolvedReason") or ""):
            # No es paranoia: el schema ya impide un campo `finalState`, pero un
            # `unresolvedReason` que diga "SUPPORTED" intentaría colar el veredicto
            # por un canal de texto.
            _fail("contextual_output_attempts_final_state")

    # --- referencias a EvidenceUnits --------------------------------------
    evaluated = [item["evidenceUnitId"] for item in result["evaluatedEvidence"]]
    evaluated_ok = _subset(evaluated, evidence_unit_ids)
    results.append(
        validation(
            "HARD_FACTUAL_INVARIANT",
            "EVALUATED_EVIDENCE_IDS_EXIST",
            "PASS" if evaluated_ok else "FAIL",
            requirement_id,
            str(sorted(set(evaluated) - evidence_unit_ids)),
            affects_epistemic_state=not evaluated_ok,
        )
    )
    if not evaluated_ok:
        # Reparación determinista del candidato congelado: se descartan las
        # entradas que referencian evidencia inexistente, dejando el registro.
        result["evaluatedEvidence"] = [
            item
            for item in result["evaluatedEvidence"]
            if item["evidenceUnitId"] in evidence_unit_ids
        ]

    duplicated = len(evaluated) != len(set(evaluated))
    if duplicated:
        _fail("contextual_evaluated_evidence_duplicated")

    # --- DELTA_A: consistencia estructural de la búsqueda ------------------
    search = result["weakerClaimSearch"]
    candidate = search["candidate"]
    if (search["status"] == "FOUND") != (candidate is not None):
        _fail("contextual_weaker_search_candidate_inconsistent")
    results.append(
        validation(
            "HARD_FACTUAL_INVARIANT",
            "WEAKER_SEARCH_CANDIDATE_CONSISTENT",
            "PASS",
            requirement_id,
            f"status={search['status']}",
            affects_epistemic_state=False,
        )
    )

    full_status = result["fullClaimAssessment"]["status"]
    observability_status = result["observabilityAssessment"]["observabilityStatus"]
    search_required = (
        bool(analysis_requirement["evaluability"]["formativeEvidenceCapable"])
        and full_status == "NOT_REACHED"
        and observability_status == "SUFFICIENT"
    )
    documented = bool(search["rationale"].strip())
    results.append(
        validation(
            "HARD_FACTUAL_INVARIANT",
            "WEAKER_SEARCH_DOCUMENTED_WHEN_REQUIRED",
            "PASS" if (not search_required or documented) else "FAIL",
            requirement_id,
            f"required={search_required};rationale={'present' if documented else 'empty'}",
            affects_epistemic_state=search_required and not documented,
        )
    )
    results.append(
        validation(
            "SEMANTIC_CONSISTENCY",
            "WEAKER_SEARCH_OUTCOME",
            "MANUAL_ADJUDICATION_REQUIRED",
            requirement_id,
            search["status"],
            affects_epistemic_state=False,
        )
    )

    # --- qualifiers: SIEMPRE dentro de ESTE Requirement --------------------
    qualifier_fields = [
        *[
            item["supportedQualifierIds"] + item["missingQualifierIds"]
            for item in result["evaluatedEvidence"]
        ],
        result["fullClaimAssessment"]["supportedQualifierIds"]
        + result["fullClaimAssessment"]["missingQualifierIds"],
    ]
    if candidate:
        qualifier_fields.append(candidate["droppedQualifierIds"])
    if not all(_subset(field, qualifier_ids) for field in qualifier_fields):
        # Un `q_01` de otro Requirement es un id perfectamente bien formado y
        # completamente ajeno: la identidad real es (requirementId, qualifierId).
        _fail("contextual_qualifier_reference_outside_requirement")
    results.append(
        validation(
            "HARD_FACTUAL_INVARIANT",
            "MATERIAL_QUALIFIER_IDS_EXIST",
            "PASS",
            requirement_id,
            f"scope={requirement_id}",
            affects_epistemic_state=False,
        )
    )

    # --- facets: claves únicas y referencias resolubles --------------------
    facets = result["facets"]
    keys = [facet["localFacetKey"] for facet in facets]
    if len(keys) != len(set(keys)):
        _fail("contextual_facet_local_keys_duplicated")
    results.append(
        validation(
            "HARD_FACTUAL_INVARIANT",
            "FACET_LOCAL_KEY_DEFINITIONS_UNIQUE",
            "PASS",
            requirement_id,
            str(len(keys)),
            affects_epistemic_state=False,
        )
    )

    facet_refs = (
        result["compositionAssessment"]["missingFacetLocalKeys"]
        + result["fullClaimAssessment"]["coveredFacetLocalKeys"]
        + result["fullClaimAssessment"]["missingFacetLocalKeys"]
        + (candidate["droppedFacetLocalKeys"] if candidate else [])
    )
    if not _subset(facet_refs, set(keys)):
        _fail("contextual_facet_reference_dangling")
    results.append(
        validation(
            "HARD_FACTUAL_INVARIANT",
            "FACET_LOCAL_REFERENCES_EXIST",
            "PASS",
            requirement_id,
            str(len(facet_refs)),
            affects_epistemic_state=False,
        )
    )

    requirement_text = analysis_requirement["requirementText"]
    # P2.4: la tokenizacion es la MISMA que se le mostro al modelo en el prompt,
    # asi que sus indices y estos coinciden por construccion.
    tokens = tokenize_requirement(requirement_text)

    # `requirementBasisPhrases` ya NO viene del modelo: se DERIVA recortando el
    # Requirement por los rangos que eligio. Por eso la literalidad no se
    # comprueba — es imposible no cumplirla.
    anchored_facets: list[dict[str, Any]] = []
    for facet in facets:
        if not _subset(facet["evidenceUnitIds"], evidence_unit_ids):
            _fail("contextual_facet_evidence_reference_unknown")
        phrases = derive_basis_phrases(
            requirement_text, tokens, facet["requirementBasisRanges"]
        )
        anchored = {key: value for key, value in facet.items()
                    if key != "requirementBasisRanges"}
        anchored["requirementBasisPhrases"] = phrases
        anchored_facets.append(anchored)
    result["facets"] = anchored_facets
    facets = anchored_facets

    # --- referencias semánticas a evidencia --------------------------------
    reference_fields = [
        result["compositionAssessment"]["nonRedundantEvidenceUnitIds"],
        result["compositionAssessment"]["integrationEvidenceIds"],
        result["jointClaimCeiling"]["supportingEvidenceUnitIds"],
    ]
    if candidate:
        reference_fields.append(candidate["supportingEvidenceUnitIds"])
    if not all(_subset(field, evidence_unit_ids) for field in reference_fields):
        _fail("contextual_semantic_evidence_reference_unknown")
    results.append(
        validation(
            "HARD_FACTUAL_INVARIANT",
            "SEMANTIC_EVIDENCE_IDS_EXIST",
            "PASS",
            requirement_id,
            "resolved",
            affects_epistemic_state=False,
        )
    )

    # --- observabilidad: sólo fuentes del run ------------------------------
    for assessment in result["observabilityAssessment"]["incompleteSourceAssessments"]:
        if assessment["sourceId"] not in source_ids:
            _fail("contextual_observability_source_unknown")

    # --- DELTA_B: consistencia estructural de la continuidad ---------------
    if candidate:
        continuity = candidate["continuityAssessment"]
        expected = CONTINUITY_TRANSFORMATION_BY_STATUS[continuity["status"]]
        if continuity["transformation"] != expected:
            _fail("contextual_continuity_transformation_inconsistent")
        results.append(
            validation(
                "HARD_FACTUAL_INVARIANT",
                "CONTINUITY_TRANSFORMATION_CONSISTENT",
                "PASS",
                requirement_id,
                f"{continuity['status']}/{continuity['transformation']}",
                affects_epistemic_state=False,
            )
        )

        if continuity["status"] == "NO" and not continuity["shiftReason"]:
            _fail("contextual_continuity_shift_reason_missing")
        results.append(
            validation(
                "HARD_FACTUAL_INVARIANT",
                "CONTINUITY_SHIFT_REASON_PRESENT",
                "PASS",
                requirement_id,
                str(continuity["shiftReason"]),
                affects_epistemic_state=False,
            )
        )

        # Misma derivacion determinista que en las facets: el candidato mas
        # debil tampoco escribe sus citas.
        anchored_continuity = {
            key: value
            for key, value in continuity.items()
            if key != "requirementBasisRanges"
        }
        anchored_continuity["requirementBasisPhrases"] = derive_basis_phrases(
            requirement_text,
            tokens,
            continuity["requirementBasisRanges"],
            allow_empty=True,
        )
        candidate["continuityAssessment"] = anchored_continuity
        continuity = anchored_continuity

        # --- la puerta de B2.4.1: utilidad SÓLO si continuidad YES ---------
        if continuity["status"] != "YES" and candidate["materialUsefulness"] != "NOT_EVALUATED":
            # La utilidad nunca rescata un semantic shift. Evaluarla con
            # continuidad NO/UNRESOLVED sería exactamente el rescate que la
            # cláusula restaurada prohíbe.
            _fail("contextual_material_usefulness_evaluated_without_continuity")
        results.append(
            validation(
                "HARD_FACTUAL_INVARIANT",
                "MATERIAL_USEFULNESS_ORDERING",
                "PASS",
                requirement_id,
                f"{continuity['status']}/{candidate['materialUsefulness']}",
                affects_epistemic_state=False,
            )
        )

    return result, results
