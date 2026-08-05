"""
Exporter offline/aditivo de `semantic_analysis_v1` para el modulo IA.

Lee JSON ya existentes de `output_json/` (PDF academico) y
`output/online_courses_json/` (cursos online) y los transforma en el
artifact `semantic_analysis_v1` definido en
`docs/architecture/ai-backend-integration-contract-v0.md` (repo backend,
addendum de integracion por fases) y evaluado en
`docs/architecture/ai-exporter-backend-contract-viability-v0.md`
(este repo).

No modifica `raw_normalized` ni `semantic_final`. No escribe dentro de
`output_json/`, `output/online_courses_json/`, `embedding_store/` ni
`benchmarks/`. No implementa todavia `credential_candidate_v1`.

`PIPELINE_VERSION` y `TAXONOMY_VERSION` son placeholders explicitos —
ningun pipeline del repo produce hoy un numero de version real para
extraccion ni para taxonomia de areas/skills. No reemplazar por un
numero con apariencia de version estable (ej. "1.0") hasta que exista
un esquema de versionado acordado.
"""

SCHEMA_VERSION = "semantic_analysis_v1"
PIPELINE_VERSION = "unversioned_current"
TAXONOMY_VERSION = "unversioned_current"

SOURCE_TYPE_ACADEMIC_PDF = "academic_pdf"
SOURCE_TYPE_ONLINE_COURSE_CATALOG = "online_course_catalog"

__all__ = [
    "SCHEMA_VERSION",
    "PIPELINE_VERSION",
    "TAXONOMY_VERSION",
    "SOURCE_TYPE_ACADEMIC_PDF",
    "SOURCE_TYPE_ONLINE_COURSE_CATALOG",
]
