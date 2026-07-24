# Schemas

Contratos de datos iniciales del proyecto definidos con JSON Schema Draft 2020-12.

## Objetivo

Establecer un lenguaje comun entre backend, frontend, AI service y futuros procesos de validacion o versionado.

## Schemas iniciales

- `credential_v1.schema.json`
- `semantic_analysis_v1.schema.json`
- `formative_profile_result_v0.schema.json`
- `formative_profile_v1.schema.json`
- `blockchain_record_v1.schema.json`

## Criterios

- versionar cada contrato;
- evitar acoplar la forma de datos a una sola tecnologia;
- permitir evolucion controlada entre modulos.

## Validacion

`semantic_analysis_v1.schema.json` describe el artifact camelCase producido
por el modulo IA. La asociacion con `credentialId` y el timestamp
`analyzedAt` pertenecen al contexto de persistencia del backend y no forman
parte del artifact.

`formative_profile_result_v0.schema.json` describe el perfil agregado real
producido por `Extractor Materias/profile_builder` a partir de artifacts
`semantic_analysis_v1`. No incluye una identidad confiable del holder: el
backend debe asociarlo externamente y validar la pertenencia de sus fuentes.
Tampoco es payload de frontend, prueba de finalizacion, evidencia blockchain
ni parte de `canon_v1`.

Este contrato no debe confundirse con
`backend_formative_profile_snapshot_v0`, el fallback deterministico que el
backend reconstruye con
`generationMethod = backend_deterministic_aggregation_v0`. Son artifacts
distintos y no comparten schema.

El workspace todavia no tiene un validador JSON Schema automatizado. Como
proximo paso, conviene agregar un test liviano compatible con Draft 2020-12
que valide contra este schema los examples `completed`, `partial` y
`online_course_catalog` de `semantic_analysis_v1`. Para
`formative_profile_result_v0`, conviene versionar fixtures standalone chicos:
uno academico, uno mixto con catalogo online y su warning de no-finalizacion,
y uno sin confidence numerica disponible.
