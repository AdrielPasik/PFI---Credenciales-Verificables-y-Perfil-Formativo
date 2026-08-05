"""
Fase 5A (experimental) — carga y validacion minima de consumidor para
artifacts `semantic_analysis_v1` (ver `src/exporters/backend_contract/`).

Esta capa es aditiva: no reemplaza `course_adapter.py` (que sigue leyendo
el formato interno de `output_json/` / `output/online_courses_json/` para
el `profile_builder` productivo actual). Solo permite que codigo nuevo
consuma artifacts `semantic_analysis_v1` ya versionados, en memoria o desde
disco, sin tocar el pipeline productivo.

No implementa la validacion completa que hace el exporter/backend (eso ya
existe en `src/exporters/backend_contract/`). Esto es una validacion minima
de *consumidor*: confirma que el artifact tiene la forma esperada antes de
agregarlo, no revalida como se construyo.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

EXPECTED_SCHEMA_VERSION = "semantic_analysis_v1"

# Campos minimos que esta capa necesita para poder agregar un artifact.
# No es la lista completa del contrato (ver models.py del exporter) --
# es lo minimo que necesita el consumidor de Fase 5A.
REQUIRED_ARTIFACT_FIELDS = (
    "schemaVersion",
    "status",
    "sourceType",
    "sourceRefs",
    "areas",
    "skills",
    "concepts",
    "hoursDistribution",
    "confidence",
    "qualityFlags",
    "warnings",
    "partialReasons",
    "textForEmbedding",
)


class InvalidArtifactError(ValueError):
    """El artifact no cumple la validacion minima de consumidor de semantic_analysis_v1."""


def validate_artifact_shape(artifact: Any, *, source_label: str = "<artifact>") -> None:
    """
    Levanta InvalidArtifactError si `artifact` no es un dict con
    schemaVersion == "semantic_analysis_v1" y los campos minimos requeridos.

    No modifica `artifact`.
    """
    if not isinstance(artifact, dict):
        raise InvalidArtifactError(
            f"{source_label}: el artifact no es un objeto JSON (dict) -- tipo real: {type(artifact).__name__}"
        )

    schema_version = artifact.get("schemaVersion")
    if schema_version != EXPECTED_SCHEMA_VERSION:
        if schema_version == "credential_candidate_v1":
            raise InvalidArtifactError(
                f"{source_label}: schemaVersion='credential_candidate_v1' no esta soportado por esta capa "
                f"(esquema distinto, no implementado en src/exporters/backend_contract/) -- rechazado explicitamente."
            )
        raise InvalidArtifactError(
            f"{source_label}: schemaVersion invalido o ausente "
            f"(recibido: {schema_version!r}, esperado: {EXPECTED_SCHEMA_VERSION!r})."
        )

    missing = [field for field in REQUIRED_ARTIFACT_FIELDS if field not in artifact]
    if missing:
        raise InvalidArtifactError(f"{source_label}: faltan campos requeridos: {missing}")


def load_artifacts_from_objects(artifacts: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Valida una secuencia de artifacts semantic_analysis_v1 ya cargados en
    memoria (por ejemplo, ya parseados de JSON por el caller). No los
    modifica ni los copia -- devuelve los mismos objetos recibidos.

    Levanta InvalidArtifactError en el primer artifact invalido.
    """
    validated: list[dict[str, Any]] = []
    for index, artifact in enumerate(artifacts):
        validate_artifact_shape(artifact, source_label=f"artifact[{index}]")
        validated.append(artifact)
    return validated


def load_artifacts_from_directory(directory: Path | str, *, pattern: str = "*.json") -> list[dict[str, Any]]:
    """
    Lee y valida artifacts semantic_analysis_v1 desde archivos JSON de un
    directorio. Solo lectura -- no escribe ni modifica nada en `directory`.

    No recursivo por defecto; pasar pattern="**/*.json" para recursividad.
    Levanta InvalidArtifactError en el primer archivo invalido (incluye la
    ruta del archivo en el mensaje).
    """
    directory = Path(directory)
    paths = sorted(directory.glob(pattern))

    artifacts: list[dict[str, Any]] = []
    for path in paths:
        with path.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
        validate_artifact_shape(data, source_label=str(path))
        artifacts.append(data)
    return artifacts
