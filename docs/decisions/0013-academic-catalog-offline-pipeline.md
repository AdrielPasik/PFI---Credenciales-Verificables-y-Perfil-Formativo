# ADR 0013 - Academic catalog offline pipeline

## Estado

Aceptado.

## Contexto

El catalogo academico proviene de fuentes locales que requieren correccion,
normalizacion, validacion y una importacion idempotente. No es una carga
transaccional ni un analisis IA de credenciales.

## Decision

Mantener un pipeline offline que genere artifacts versionados con checksums y
conteos, seguido por un importador idempotente. NestJS runtime solo consulta los
datos importados.

## Consecuencias

- no se despliega un servicio adicional;
- los imports pueden reproducirse y auditarse;
- schema/version/checksum se vuelven parte del handoff;
- el pipeline no prueba completion del holder;
- P4f debe validar migracion, seed/import y conteos en Neon.

## Alternativas consideradas

- servicio runtime de catalogo: complejidad sin necesidad actual;
- importar archivos crudos en cada boot: lento y riesgoso;
- mezclar con FastAPI semantico: responsabilidades diferentes;
- deduplicar por nombre: puede unir materias distintas.

