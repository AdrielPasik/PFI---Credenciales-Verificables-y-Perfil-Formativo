from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

from .extraction import verify_excerpt
from .models import GuardStatus


def _result(name: str, passed: bool, reason: str, *, critical: bool = False) -> dict[str, Any]:
    return {
        "guard": name,
        "status": GuardStatus.PASS.value if passed else GuardStatus.FAIL.value,
        "reason": reason,
        "critical": critical and not passed,
    }


def validate_and_enrich_evidence_units(
    proposals: list[dict[str, Any]], snapshots: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    sources = {item["source"]["sourceId"]: item for item in snapshots}
    accepted: list[dict[str, Any]] = []
    guards: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for proposal in proposals:
        source = sources.get(proposal["sourceId"])
        guards.append(_result("eu_source_exists", source is not None, proposal["evidenceUnitId"]))
        if source is None:
            continue
        unique = proposal["evidenceUnitId"] not in seen_ids
        guards.append(_result("model_ids_unique", unique, proposal["evidenceUnitId"]))
        if not unique:
            continue
        aligned = verify_excerpt(source, proposal["charStart"], proposal["charEnd"], proposal["exactExcerpt"])
        guards.append(_result("excerpt_offsets_align", aligned, proposal["evidenceUnitId"]))
        sha_valid = len(source["source"]["sourceSha256"]) == 64
        guards.append(_result("sha_identity_valid", sha_valid, source["source"]["sourceId"], critical=True))
        if not aligned or not sha_valid:
            continue
        seen_ids.add(proposal["evidenceUnitId"])
        accepted.append(
            {
                **proposal,
                "schemaVersion": "evidence_unit_catalog_v1",
                "sourceTrace": {
                    "sourceId": source["source"]["sourceId"],
                    "credentialId": source["source"]["credentialId"],
                    "sourceSha256": source["source"]["sourceSha256"],
                    "extractionVersion": source["extractionVersion"],
                    "segmentId": _segment_for_offset(source, proposal["charStart"]),
                    "pageNumber": _page_for_offset(source, proposal["charStart"]),
                    "charStart": proposal["charStart"],
                    "charEnd": proposal["charEnd"],
                    "exactExcerpt": proposal["exactExcerpt"],
                },
                "sourceProvenance": source["source"]["sourceProvenance"],
                "interpretationProvenance": "AI_INFERRED",
                "extractionQuality": source["coverageStatus"],
                "lineageId": source["source"].get("lineageId"),
                "technicallyVerified": source["source"].get("technicallyVerified", False),
            }
        )
        guards.append(_result("provenance_from_authoritative_input", True, proposal["evidenceUnitId"]))
        guards.append(_result("ai_interpretation_not_issuer_authored", True, proposal["evidenceUnitId"]))
    return accepted, guards


def _page_for_offset(snapshot: dict[str, Any], offset: int) -> int | None:
    for page in snapshot.get("pages", []):
        if page["pageOffsetStart"] <= offset <= page["pageOffsetEnd"]:
            return page["pageNumber"]
    return None


def _segment_for_offset(snapshot: dict[str, Any], offset: int) -> str | None:
    for segment in snapshot.get("segments", []):
        if segment["charStart"] <= offset < segment["charEnd"]:
            return segment["segmentId"]
    return None


def exact_redundancy_groups(evidence_units: list[dict[str, Any]]) -> list[list[str]]:
    groups: dict[tuple[str, str], list[str]] = defaultdict(list)
    for item in evidence_units:
        lineage = item.get("lineageId")
        if lineage:
            groups[("lineage", lineage)].append(item["evidenceUnitId"])
        trace = item["sourceTrace"]
        groups[("span", f"{trace['sourceSha256']}:{trace['charStart']}:{trace['charEnd']}")].append(
            item["evidenceUnitId"]
        )
    unique: dict[tuple[str, ...], list[str]] = {}
    for ids in groups.values():
        if len(ids) > 1:
            key = tuple(sorted(ids))
            unique[key] = list(key)
    return list(unique.values())


def validate_relation_ids(
    relations: list[dict[str, Any]],
    requirement_ids: set[str],
    evidence_unit_ids: set[str],
    facet_ids: set[str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    accepted: list[dict[str, Any]] = []
    guards: list[dict[str, Any]] = []
    for relation in relations:
        requirement_valid = relation["requirementId"] in requirement_ids
        evidence_valid = relation["evidenceUnitId"] in evidence_unit_ids
        facets_valid = set(relation["facetIds"]) <= facet_ids
        guards.extend(
            [
                _result("relation_requirement_id_exists", requirement_valid, relation["requirementId"]),
                _result("relation_evidence_unit_id_exists", evidence_valid, relation["evidenceUnitId"]),
                _result("relation_facet_ids_exist", facets_valid, str(relation["facetIds"])),
            ]
        )
        if requirement_valid and evidence_valid and facets_valid:
            accepted.append(relation)
    return accepted, guards


def validate_requirement_result(
    requirement: dict[str, Any],
    ceiling: dict[str, Any],
    relations: list[dict[str, Any]],
    facets: list[dict[str, Any]],
    evidence_units: dict[str, dict[str, Any]],
    snapshots: list[dict[str, Any]],
    known_redundancy_groups: list[list[str]],
) -> list[dict[str, Any]]:
    guards: list[dict[str, Any]] = []
    eu_ids = set(evidence_units)
    used = set(ceiling["supportingEvidenceUnitIds"])
    guards.append(_result("model_evidence_ids_exist", used <= eu_ids, str(sorted(used - eu_ids)), critical=True))
    positive_semantics = ceiling["reachesFullRequirement"] or ceiling["hasMateriallyUsefulWeakerClaim"]
    guards.append(_result("positive_semantics_have_evidence", not positive_semantics or bool(used), requirement["requirementId"], critical=True))

    facet_ids = {item["facetId"] for item in facets}
    relation_facets = {facet for relation in relations for facet in relation.get("facetIds", []) if relation["evidenceUnitId"] in used}
    covered = set(ceiling["coveredFacetIds"])
    guards.append(_result("covered_facets_exist", covered <= facet_ids, str(sorted(covered - facet_ids)), critical=True))
    guards.append(_result("covered_facet_has_evidence", covered <= relation_facets, str(sorted(covered - relation_facets)), critical=True))

    supported_qualifiers = {q.casefold() for relation in relations for q in relation.get("supportedQualifiers", []) if relation["evidenceUnitId"] in used}
    ceiling_qualifiers = {q.casefold() for q in ceiling["supportedQualifiers"]}
    guards.append(_result("ceiling_qualifiers_supported", ceiling_qualifiers <= supported_qualifiers, str(sorted(ceiling_qualifiers - supported_qualifiers)), critical=True))

    requires_bridge = any(item.get("requiresIntegration") for item in facets if item["facetId"] in covered)
    bridges = set(ceiling["bridgeEvidenceUnitIds"])
    guards.append(_result("integration_requires_bridge", not requires_bridge or bool(bridges & used), requirement["requirementId"], critical=True))

    declared_redundancy = {tuple(sorted(group)) for group in ceiling["redundancyGroups"]}
    material_known_redundancy = {
        tuple(sorted(set(group) & used))
        for group in known_redundancy_groups
        if len(set(group) & used) > 1
    }
    redundancy_preserved = material_known_redundancy <= declared_redundancy
    guards.append(
        _result(
            "known_lineage_not_counted_independently",
            redundancy_preserved,
            str(sorted(material_known_redundancy - declared_redundancy)),
            critical=True,
        )
    )

    verified_terms = re.compile(
        r"\b(blockchain|verificad[oa]|integridad on-chain)\b.{0,80}\b(aument|increment|fortalece el soporte|mayor soporte)\w*",
        re.IGNORECASE,
    )
    semantic_text = f"{ceiling['claimCeiling']} {ceiling['semanticRationale']}"
    uses_verification_as_semantics = bool(verified_terms.search(semantic_text)) and any(
        evidence_units[item].get("technicallyVerified") for item in used if item in evidence_units
    )
    guards.append(_result("blockchain_not_semantic_support", not uses_verification_as_semantics, requirement["requirementId"], critical=True))

    incomplete = {item["source"]["sourceId"] for item in snapshots if item["coverageStatus"] != "FULL"}
    guards.append(
        _result(
            "material_extraction_quality",
            not incomplete,
            str(sorted(incomplete)),
            critical=bool(incomplete),
        )
    )
    return guards
