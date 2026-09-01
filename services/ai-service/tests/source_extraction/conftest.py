"""Utilidades compartidas de los tests de F0.2.

Los tests del extractor viven separados de `tests/contracts/`, que es el corpus
de contrato congelado de F0.1. F0.2 puede AGREGAR fixtures y tests; no puede
tocar los fingerprints esperados, las contract fixtures, las expectativas de
serializacion canonica ni las restricciones de schema de F0.1 para hacer pasar
nada suyo.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator

CONTRACT_FIXTURES = Path(__file__).resolve().parents[1] / "contracts" / "fixtures" / "source_extraction_v1"
SOURCES = CONTRACT_FIXTURES / "sources"


def repository_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "packages" / "schemas").is_dir():
            return parent
    raise RuntimeError("No se pudo ubicar packages/schemas desde los tests de AI Service")


@pytest.fixture(scope="session")
def schema_validator() -> Draft202012Validator:
    schema = json.loads(
        (repository_root() / "packages" / "schemas" / "source_extraction_v1.schema.json").read_text(
            encoding="utf-8"
        )
    )
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def source_bytes(name: str) -> bytes:
    return (SOURCES / name).read_bytes()


def sha256_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def extract(name: str, **overrides: Any) -> dict[str, Any]:
    """Extrae una source fixture con su sha real, salvo override explicito."""
    from src.source_extraction import extract_pdf_source

    data = source_bytes(name)
    arguments: dict[str, Any] = {
        "pdf_bytes": data,
        "document_evidence_id": f"doc-{Path(name).stem}",
        "source_sha256": sha256_of(data),
        "storage_key": f"documents/{name}",
    }
    arguments.update(overrides)
    return extract_pdf_source(**arguments)
