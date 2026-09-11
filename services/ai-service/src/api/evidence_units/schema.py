"""Schema de la PROPUESTA del proveedor — slice F3.4.

Promocion de `EVIDENCE_UNIT_PROPOSAL` / `EVIDENCE_UNIT_CATALOG_PROPOSAL_SCHEMA`
de B2, sin cambios de campo.

LO QUE EL MODELO PUEDE PROPONER, Y NADA MAS:

    sourceId · segmentId · quoteText · normalizedProposition · claimType
    semanticQualifiers

LO QUE NO APARECE ACA, A PROPOSITO:

    evidenceUnitId · charStart · charEnd · pageNumber · sourceSha256
    sourceTrace · sourceProvenance · interpretationProvenance · extractionQuality

No es una omision: `additionalProperties: False` hace que proponer una coordenada
sea estructuralmente imposible. El modelo no es autoridad sobre donde esta algo en
la fuente; el codigo confiable lo resuelve alineando la cita contra el texto
canonico verificado.
"""

from __future__ import annotations

from typing import Any

from src.api.evidence_units.contracts import CLAIM_TYPES

_SEMANTIC_QUALIFIER: dict[str, Any] = {
    "type": "object",
    "properties": {
        "kind": {"type": "string"},
        "value": {"type": "string"},
    },
    "required": ["kind", "value"],
    "additionalProperties": False,
}

_EVIDENCE_UNIT_PROPOSAL: dict[str, Any] = {
    "type": "object",
    "properties": {
        # El `runLocalSourceId` congelado del run. Una fuente fuera de ese
        # conjunto se rechaza; el modelo no puede ampliar el universo.
        "sourceId": {"type": "string"},
        "segmentId": {"type": "string"},
        "quoteText": {"type": "string"},
        "normalizedProposition": {"type": "string"},
        "claimType": {"type": "string", "enum": list(CLAIM_TYPES)},
        "semanticQualifiers": {"type": "array", "items": _SEMANTIC_QUALIFIER},
    },
    "required": [
        "sourceId",
        "segmentId",
        "quoteText",
        "normalizedProposition",
        "claimType",
        "semanticQualifiers",
    ],
    "additionalProperties": False,
}

EVIDENCE_UNITS_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"evidenceUnits": {"type": "array", "items": _EVIDENCE_UNIT_PROPOSAL}},
    "required": ["evidenceUnits"],
    "additionalProperties": False,
}

EVIDENCE_UNITS_SCHEMA_NAME = "product_evidence_unit_catalog"
