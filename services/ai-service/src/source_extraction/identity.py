"""Identidad de extraccion — `extractionIdentity` de `source_extraction_v1`.

La identidad es COMPUESTA, no un solo string de version (diseño F0 §11.1)::

    schemaVersion          forma del artifact
    implementationVersion  nuestro algoritmo
    parserProfile          que parser produjo realmente el texto
    dependencyFingerprint  versiones exactas resueltas del stack de parseo

`parserProfile` esta dentro de la identidad y no como nota diagnostica porque
pdfplumber y pypdf producen texto distinto para los mismos bytes: si el fallback
fuera una nota al pie, dos extracciones de una fuente podrian diferir
materialmente declarando la misma identidad.

`dependencyFingerprint` es obligatorio por la misma razon, verificada en §11.2:
`requirements.txt` fija `pdfplumber` y `pypdf` por RANGO y no menciona
`pdfminer.six`, que es el componente que realmente determina el texto extraido.
Un `pip install -U` rutinario dentro del rango declarado puede entonces cambiar
el texto canonico sin cambio de codigo ni de `implementationVersion`. El
fingerprint no impide esa deriva — la vuelve visible y atribuible, que es la
propiedad que importa.
"""

from __future__ import annotations

from importlib import metadata

from .canonical import fingerprint
from .errors import DependencyFingerprintUnavailable

SCHEMA_VERSION = "source_extraction_v1"
IMPLEMENTATION_VERSION = "source_extractor_v1.0.0"

PARSER_PDFPLUMBER = "PDFPLUMBER"
PARSER_PYPDF = "PYPDF"
PARSER_TEXT_DIRECT = "TEXT_DIRECT"

#: Stack de parseo cubierto por el fingerprint, congelado por el diseño §11.2.
#: `pdfminer.six` y `pypdfium2` estan aunque no los declaremos en
#: requirements.txt: son justamente las dependencias transitivas que pueden
#: cambiar el texto sin que nada nuestro cambie.
FINGERPRINTED_DEPENDENCIES = ("pdfminer.six", "pdfplumber", "pypdf", "pypdfium2")


def resolved_dependency_versions() -> dict[str, str]:
    """Versiones exactas instaladas, leidas en tiempo de extraccion.

    Si falta alguna, aborta. El contrato prohibe `UNKNOWN`, `null`, un hash
    ficticio u omitir la dependencia del preimage: cualquiera de las tres haria
    que dos entornos distintos produjeran la misma identidad declarada.
    """
    versions: dict[str, str] = {}
    for package in FINGERPRINTED_DEPENDENCIES:
        try:
            versions[package] = metadata.version(package)
        except metadata.PackageNotFoundError as error:
            raise DependencyFingerprintUnavailable(package) from error
    return versions


def dependency_fingerprint() -> str:
    """SHA-256 sobre el mapa nombre->version bajo `MINIMAL_DETERMINISTIC_JSON_V1`.

    El preimage reutiliza la canonicalizacion ya congelada en F0.1 en vez de
    inventar un segundo formato de serializacion: las claves quedan ordenadas
    por code point y el resultado es reproducible desde cualquier runtime que
    ya implemente el contrato.
    """
    return fingerprint(resolved_dependency_versions())


def text_extraction_identity() -> dict[str, str]:
    """Identidad de una fuente `TEXT`. TRES campos, no cuatro.

    `dependencyFingerprint` esta ESTRUCTURALMENTE PROHIBIDO por el schema, y no
    puesto en `null`: no hay dependencia de parser de PDF que pueda alterar el
    texto, y un campo nullable no distinguiria "no aplica" de "me olvide de
    calcularlo". Reutilizar aca el fingerprint de PDF seria peor todavia: haria
    que la identidad de un TextEvidence cambiara cuando se actualiza pdfminer,
    que no interviene en nada.
    """
    return {
        "schemaVersion": SCHEMA_VERSION,
        "implementationVersion": IMPLEMENTATION_VERSION,
        "parserProfile": PARSER_TEXT_DIRECT,
    }


def pdf_extraction_identity(parser_profile: str) -> dict[str, str]:
    if parser_profile not in (PARSER_PDFPLUMBER, PARSER_PYPDF):
        raise ValueError(f"parser_profile invalido: {parser_profile!r}")
    return {
        "schemaVersion": SCHEMA_VERSION,
        "implementationVersion": IMPLEMENTATION_VERSION,
        "parserProfile": parser_profile,
        "dependencyFingerprint": dependency_fingerprint(),
    }
