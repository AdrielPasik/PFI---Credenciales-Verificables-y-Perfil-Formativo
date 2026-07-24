# Schemas

Contratos de datos iniciales del proyecto definidos con JSON Schema Draft 2020-12.

## Objetivo

Establecer un lenguaje comun entre backend, frontend, AI service y futuros procesos de validacion o versionado.

## Schemas iniciales

- `credential_v1.schema.json`
- `semantic_analysis_v1.schema.json`
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

El workspace todavia no tiene un validador JSON Schema automatizado. Como
proximo paso, conviene agregar un test liviano compatible con Draft 2020-12
que valide contra este schema los examples `completed`, `partial` y
`online_course_catalog`, sin acoplar el runtime NestJS al exporter Python.
