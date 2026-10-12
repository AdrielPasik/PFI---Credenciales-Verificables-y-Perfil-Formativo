#!/usr/bin/env python3
"""Validate human annotation records without inferring or altering any label."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import unicodedata
from pathlib import Path
from typing import Any


EXPECTED_SCHEMA_SHA256 = "19d0ac39a9d26b2f02d8c7aa93a3508b4081f80714e212a233dd3447fdccf6a7"
REQUIRED_FIELDS = {
    "caseId",
    "primaryArea",
    "acceptableSecondaryAreas",
    "annotationStatus",
    "annotationConfidence",
    "rationale",
    "supportingFragments",
}


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"No se pudo leer JSON: {path}: {exc}") from exc


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalize_text(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def visible_source(case: dict[str, Any]) -> str:
    return "\n".join(
        str(case.get(field, ""))
        for field in ("courseName", "objectives", "curricularContents")
    )


def validate(
    annotations: Any,
    schema: dict[str, Any],
    packet: dict[str, Any],
    require_complete: bool,
) -> list[str]:
    errors: list[str] = []
    if not isinstance(annotations, list):
        return ["El archivo de respuestas debe ser un array JSON de anotaciones."]

    properties = schema.get("properties", {})
    schema_required = set(schema.get("required", []))
    if schema_required != REQUIRED_FIELDS:
        errors.append("El schema de respuesta no coincide con el contrato congelado.")
        return errors

    primary_options = set(properties["primaryArea"]["oneOf"][0]["enum"])
    primary_options.add(properties["primaryArea"]["oneOf"][1]["const"])
    secondary_options = set(properties["acceptableSecondaryAreas"]["items"]["enum"])
    status_options = set(properties["annotationStatus"]["enum"])
    confidence_options = set(properties["annotationConfidence"]["enum"])
    allowed_fields = set(properties)

    packet_cases = packet.get("cases")
    if not isinstance(packet_cases, list):
        return ["El packet de anotación no contiene un array de casos."]
    cases_by_id = {
        case.get("caseId"): case
        for case in packet_cases
        if isinstance(case, dict) and isinstance(case.get("caseId"), str)
    }
    catalog = packet.get("catalog")
    catalog_areas = {
        item.get("area")
        for item in catalog
        if isinstance(item, dict) and isinstance(item.get("area"), str)
    } if isinstance(catalog, list) else set()
    if catalog_areas != secondary_options or len(catalog_areas) != 69:
        return ["El catálogo del packet no coincide con las 69 áreas del schema congelado."]

    seen_case_ids: set[str] = set()
    for index, annotation in enumerate(annotations):
        prefix = f"Anotación {index + 1}"
        if not isinstance(annotation, dict):
            errors.append(f"{prefix}: debe ser un objeto JSON.")
            continue

        fields = set(annotation)
        missing = REQUIRED_FIELDS - fields
        unexpected = fields - allowed_fields
        if missing:
            errors.append(f"{prefix}: faltan campos requeridos: {', '.join(sorted(missing))}.")
        if unexpected:
            errors.append(f"{prefix}: contiene campos no permitidos: {', '.join(sorted(unexpected))}.")
        if missing or unexpected:
            continue

        case_id = annotation["caseId"]
        if not isinstance(case_id, str) or not case_id:
            errors.append(f"{prefix}: caseId debe ser un string no vacío.")
            continue
        if case_id not in cases_by_id:
            errors.append(f"{prefix}: caseId no pertenece al packet congelado.")
            continue
        if case_id in seen_case_ids:
            errors.append(f"{prefix}: caseId está repetido.")
        seen_case_ids.add(case_id)

        primary = annotation["primaryArea"]
        secondary = annotation["acceptableSecondaryAreas"]
        status = annotation["annotationStatus"]
        confidence = annotation["annotationConfidence"]
        rationale = annotation["rationale"]
        fragments = annotation["supportingFragments"]

        if not isinstance(primary, str) or primary not in primary_options:
            errors.append(f"{prefix}: primaryArea no pertenece al contrato congelado.")
        if not isinstance(status, str) or status not in status_options:
            errors.append(f"{prefix}: annotationStatus no pertenece al contrato congelado.")
        if not isinstance(confidence, str) or confidence not in confidence_options:
            errors.append(f"{prefix}: annotationConfidence no pertenece al contrato congelado.")
        if not isinstance(secondary, list):
            errors.append(f"{prefix}: acceptableSecondaryAreas debe ser un array.")
        else:
            if len(set(secondary)) != len(secondary):
                errors.append(f"{prefix}: acceptableSecondaryAreas contiene valores repetidos.")
            if any(not isinstance(area, str) or area not in secondary_options for area in secondary):
                errors.append(f"{prefix}: acceptableSecondaryAreas contiene un área fuera del catálogo congelado.")
            if primary in secondary:
                errors.append(f"{prefix}: primaryArea no puede repetirse como área secundaria.")

        if primary == "NONE" and status != "NO_FIT":
            errors.append(f"{prefix}: primaryArea NONE requiere annotationStatus NO_FIT.")
        if primary != "NONE" and status == "NO_FIT":
            errors.append(f"{prefix}: annotationStatus NO_FIT requiere primaryArea NONE.")
        if not isinstance(rationale, str) or not rationale.strip():
            errors.append(f"{prefix}: rationale debe ser un texto no vacío.")
        if not isinstance(fragments, list) or not fragments:
            errors.append(f"{prefix}: supportingFragments debe contener al menos un fragmento.")
        elif any(not isinstance(fragment, str) or not fragment.strip() for fragment in fragments):
            errors.append(f"{prefix}: supportingFragments contiene un fragmento vacío o no textual.")
        elif len(set(fragments)) != len(fragments):
            errors.append(f"{prefix}: supportingFragments contiene fragmentos repetidos.")
        else:
            source = normalize_text(visible_source(cases_by_id[case_id]))
            for fragment in fragments:
                if normalize_text(fragment) not in source:
                    errors.append(f"{prefix}: un supportingFragment no pertenece al texto expuesto al anotador.")
                    break

    if require_complete:
        absent = set(cases_by_id) - seen_case_ids
        if absent:
            errors.append(f"Faltan {len(absent)} caseId del packet congelado.")
    return errors


def main() -> int:
    directory = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(
        description="Valida estructura y consistencia de anotaciones humanas sin sugerir ni corregir etiquetas."
    )
    parser.add_argument(
        "annotations",
        nargs="?",
        type=Path,
        default=directory / "area_embedding_human_annotations_v1.json",
        help="Array JSON de respuestas humanas.",
    )
    parser.add_argument(
        "--schema",
        type=Path,
        default=directory / "area_embedding_human_annotation_response_schema_v1.json",
    )
    parser.add_argument(
        "--packet",
        type=Path,
        default=directory / "area_embedding_human_annotation_packet_v1.json",
    )
    parser.add_argument(
        "--require-complete",
        action="store_true",
        help="Exige una anotación para cada caseId del packet. No se usa durante carga parcial.",
    )
    args = parser.parse_args()

    try:
        if sha256(args.schema) != EXPECTED_SCHEMA_SHA256:
            raise ValueError("El SHA-256 del schema no coincide con el contrato congelado.")
        errors = validate(
            load_json(args.annotations),
            load_json(args.schema),
            load_json(args.packet),
            args.require_complete,
        )
    except (OSError, ValueError) as exc:
        print(f"INVALID: {exc}", file=sys.stderr)
        return 1

    if errors:
        for error in errors:
            print(f"INVALID: {error}", file=sys.stderr)
        return 1
    print("VALID: estructura y consistencia verificadas; no se propusieron ni corrigieron etiquetas.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
