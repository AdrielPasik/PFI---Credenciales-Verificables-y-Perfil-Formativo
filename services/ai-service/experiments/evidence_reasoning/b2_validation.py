from __future__ import annotations

import re
from copy import deepcopy
from typing import Any

from .b2_artifacts import validation


_WORD = re.compile(r"[a-záéíóúñü0-9]+", re.IGNORECASE)
_STOP = {"para", "como", "con", "sobre", "desde", "hasta", "formación", "requisito", "formativo"}
_STRENGTHENING = {"demostrar", "dominio", "dominar", "maestría", "experiencia", "evaluado", "certificar"}


def _ids_valid(ids: list[str], allowed: set[str]) -> bool:
    return len(ids) == len(set(ids)) and set(ids) <= allowed


def _tokens(text: str) -> set[str]:
    return {word.casefold() for word in _WORD.findall(text) if len(word) >= 4 and word.casefold() not in _STOP}


def validate_and_enrich_reasoning(
    raw: dict[str, Any],
    requirement: dict[str, Any],
    evidence_units: list[dict[str, Any]],
    redundancy_groups: list[list[str]],
    inherited_validations: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[dict[str, Any]], bool]:
    artifact = deepcopy(raw)
    results: list[dict[str, Any]] = []
    requirement_id = requirement["requirementId"]
    evidence_ids = {item["evidenceUnitId"] for item in evidence_units}
    qualifier_ids = {item["qualifierId"] for item in requirement["materialQualifiers"]}

    requirement_matches = artifact["requirementId"] == requirement_id
    results.append(validation("HARD_FACTUAL_INVARIANT", "REQUIREMENT_ID_EXISTS", "PASS" if requirement_matches else "FAIL", requirement_id, artifact["requirementId"], affects_epistemic_state=not requirement_matches))

    evaluated_ids = [item["evidenceUnitId"] for item in artifact["evaluatedEvidence"]]
    evaluated_valid = _ids_valid(evaluated_ids, evidence_ids)
    results.append(validation("HARD_FACTUAL_INVARIANT", "EVALUATED_EVIDENCE_IDS_EXIST", "PASS" if evaluated_valid else "FAIL", requirement_id, str(sorted(set(evaluated_ids) - evidence_ids)), affects_epistemic_state=not evaluated_valid))
    artifact["evaluatedEvidence"] = [item for item in artifact["evaluatedEvidence"] if item["evidenceUnitId"] in evidence_ids]

    qualifiers_valid = True
    for relation in artifact["evaluatedEvidence"]:
        ids = relation["supportedQualifierIds"] + relation["missingQualifierIds"]
        qualifiers_valid = qualifiers_valid and _ids_valid(ids, qualifier_ids)
    full = artifact["fullClaimAssessment"]
    qualifiers_valid = qualifiers_valid and _ids_valid(full["supportedQualifierIds"] + full["missingQualifierIds"], qualifier_ids)
    weaker = artifact["weakerClaimCandidate"]
    if weaker is not None:
        qualifiers_valid = qualifiers_valid and _ids_valid(weaker["droppedQualifierIds"], qualifier_ids)
    results.append(validation("HARD_FACTUAL_INVARIANT", "QUALIFIER_IDS_EXIST", "PASS" if qualifiers_valid else "FAIL", requirement_id, "supplied qualifier IDs only", affects_epistemic_state=not qualifiers_valid))

    facet_texts: list[str] = []
    facet_ids: dict[str, str] = {}
    for index, facet in enumerate(artifact["facets"], start=1):
        facet["facetId"] = f"{requirement_id}_facet_{index:02d}"
        facet_texts.append(facet["facetText"])
        if facet["facetText"] not in facet_ids:
            facet_ids[facet["facetText"]] = facet["facetId"]
        valid_refs = _ids_valid(facet["evidenceUnitIds"], evidence_ids)
        results.append(validation("HARD_FACTUAL_INVARIANT", "FACET_EVIDENCE_IDS_EXIST", "PASS" if valid_refs else "FAIL", facet["facetId"], str(sorted(set(facet["evidenceUnitIds"]) - evidence_ids)), affects_epistemic_state=not valid_refs))

    facet_references = (
        artifact["compositionAssessment"]["missingFacetTexts"]
        + full["coveredFacetTexts"]
        + full["missingFacetTexts"]
        + (weaker["droppedFacetTexts"] if weaker else [])
    )
    facets_valid = len(facet_texts) == len(set(facet_texts)) and set(facet_references) <= set(facet_texts)
    results.append(validation("HARD_FACTUAL_INVARIANT", "FACET_REFERENCES_EXIST", "PASS" if facets_valid else "FAIL", requirement_id, str(sorted(set(facet_references) - set(facet_texts))), affects_epistemic_state=not facets_valid))

    id_fields = [
        artifact["compositionAssessment"]["nonRedundantEvidenceUnitIds"],
        artifact["compositionAssessment"]["integrationEvidenceIds"],
        artifact["jointClaimCeiling"]["supportingEvidenceUnitIds"],
    ]
    if weaker:
        id_fields.append(weaker["supportingEvidenceUnitIds"])
    referenced_valid = all(_ids_valid(ids, evidence_ids) for ids in id_fields)
    results.append(validation("HARD_FACTUAL_INVARIANT", "SEMANTIC_EVIDENCE_IDS_EXIST", "PASS" if referenced_valid else "FAIL", requirement_id, "all semantic references", affects_epistemic_state=not referenced_valid))

    positive = full["status"] == "REACHED" or (
        weaker is not None
        and weaker["sameRequirementContinuity"] == "YES"
        and weaker["materialUsefulness"] == "YES"
    )
    support_ids = set(artifact["jointClaimCeiling"]["supportingEvidenceUnitIds"])
    if weaker:
        support_ids |= set(weaker["supportingEvidenceUnitIds"])
    positive_grounded = not positive or bool(support_ids & evidence_ids)
    results.append(validation("HARD_FACTUAL_INVARIANT", "POSITIVE_SEMANTICS_HAVE_EVIDENCE", "PASS" if positive_grounded else "FAIL", requirement_id, str(sorted(support_ids)), affects_epistemic_state=not positive_grounded))

    semantic_text = " ".join(
        [
            artifact["jointClaimCeiling"]["text"],
            full["rationale"],
            artifact["compositionAssessment"]["rationale"],
            *(item["rationale"] for item in artifact["evaluatedEvidence"]),
        ]
    )
    inflation = bool(re.search(r"(blockchain|on-chain|issuer_reviewed|verificad[oa]).{0,100}(aument|fortale|mayor soporte|más soporte)", semantic_text, re.IGNORECASE))
    results.append(validation("HARD_FACTUAL_INVARIANT", "PROVENANCE_BLOCKCHAIN_NOT_SEMANTIC_SUPPORT", "PASS" if not inflation else "FAIL", requirement_id, "authority is trace context only", affects_epistemic_state=inflation))

    requirement_tokens = _tokens(requirement["requirementQuote"] + " " + requirement["normalizedRequirement"])
    evidence_tokens = _tokens(" ".join(item["normalizedProposition"] for item in evidence_units))
    facet_statuses: list[str] = []
    for facet in artifact["facets"]:
        facet_tokens = _tokens(facet["facetText"])
        if facet_tokens & requirement_tokens:
            status = "PASS"
        elif facet_tokens & evidence_tokens:
            status = "SUSPECT"
        else:
            status = "MANUAL_ADJUDICATION_REQUIRED"
        facet_statuses.append(status)
        results.append(validation("SEMANTIC_CONSISTENCY", "FACET_EVIDENCE_FITTING", status, facet["facetId"], facet["requirementBasis"], affects_epistemic_state=False))
    if not artifact["facets"]:
        results.append(validation("SEMANTIC_CONSISTENCY", "FACET_EVIDENCE_FITTING", "PASS", requirement_id, "no facets proposed", affects_epistemic_state=False))

    quote_tokens = _tokens(requirement["requirementQuote"])
    normalized_tokens = _tokens(requirement["normalizedRequirement"])
    added_strength = sorted((_STRENGTHENING & normalized_tokens) - quote_tokens)
    results.append(validation("SEMANTIC_CONSISTENCY", "REQUIREMENT_SEMANTIC_PRESERVATION", "SUSPECT" if added_strength else "MANUAL_ADJUDICATION_REQUIRED", requirement_id, str(added_strength), affects_epistemic_state=False))

    results.append(
        validation(
            "SEMANTIC_CONSISTENCY",
            "OBSERVABILITY_MATERIALITY",
            "MANUAL_ADJUDICATION_REQUIRED",
            requirement_id,
            artifact["observabilityAssessment"]["rationale"],
            affects_epistemic_state=False,
        )
    )

    hard_failure = any(
        item["taxonomy"] == "HARD_FACTUAL_INVARIANT"
        and item["status"] in {"FAIL", "REJECTED"}
        and item["affectsEpistemicState"]
        for item in [*inherited_validations, *results]
    )
    artifact["exactRedundancyGroups"] = redundancy_groups
    artifact["facetEvidenceFitting"] = (
        "SUSPECT" if "SUSPECT" in facet_statuses else
        "MANUAL_ADJUDICATION_REQUIRED" if "MANUAL_ADJUDICATION_REQUIRED" in facet_statuses else
        "PASS"
    )
    return artifact, results, hard_failure
