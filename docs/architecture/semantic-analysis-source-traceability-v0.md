# Trazabilidad de fuentes del analisis semantico v0

## Proposito

Permitir demostrar que artifact, documento y texto exactos originaron cada
resultado IA, incluso cuando una evidencia fue reemplazada despues.

## Estado actual

`SemanticAnalysis` persiste el artifact validado y `analysisJson`, pero no tiene
una relacion relacional con `DocumentEvidence` o `TextEvidence`. `sourceRefs`
dentro del JSON no reemplaza ownership ni foreign keys backend.

## Decision

P5f propondra `SemanticAnalysisSource` como relacion allowlisted entre un
`SemanticAnalysis` y cada fuente exacta. El schema no se modifica en P4d.

Cada fila futura debe conservar como minimo:

- `semanticAnalysisId`;
- tipo `document` o `text`;
- referencia relacional a la evidencia exacta;
- hash SHA-256 observado;
- status/version de fuente al analizar;
- rol en modo combinado;
- orden o alias solo si el contrato lo necesita.

El hash permite detectar drift, pero no reemplaza la FK. Una fuente `replaced`
continua siendo trazable y no se resuelve de nuevo como `current`.

## Artifacts oficiales

- `semantic_analysis_v1`: analisis por fuente/credencial validado;
- `formative_profile_result_v0`: perfil agregado validado;
- propuestas de enriquecimiento: contrato futuro separado;
- prompts, debug, respuestas crudas y traces internas: no son artifacts
  oficiales ni se exponen como dominio.

`backend_formative_profile_snapshot_v0` sigue siendo fallback backend y no se
confunde con el artifact IA real.

## Evolucion futura

`FormativeProfileSource` puede relacionar un perfil con SemanticAnalysis
concretos. No se debe inferir completion desde `online_course_catalog` ni desde
`generatedFrom.artifactCount`.

## Alcance

- identidad y hash de cada fuente;
- trazabilidad de documento, texto y combinado;
- separacion artifact oficial/debug;
- base para stale detection y revision.

## Fuera de alcance

- migracion o modelo implementado;
- readiness automatica;
- invalidar perfiles actuales;
- meter evidencias o IA en `canon_v1`;
- almacenar bytes/documentos en PostgreSQL.

## Impacto en modulos actuales

P5f afectara Prisma, `SemanticService` y mappers. Los validators actuales de
artifact se conservan; la asociacion con user/credential/fuentes sigue siendo
autoridad backend externa al artifact.

## Riesgos

- confiar solo en JSON manipulable;
- analizar `current` y persistir otra version;
- perder historial de fuentes reemplazadas;
- duplicar referencias en modo combinado;
- presentar artifact partial como dato confirmado.

## Proximos slices relacionados

P5a resolucion, P5b run, P5f join de fuentes, P5h propuestas y P6a revision.

