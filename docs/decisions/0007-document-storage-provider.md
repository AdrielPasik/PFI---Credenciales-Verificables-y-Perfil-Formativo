# ADR 0007 - Document storage provider

## Estado

Aceptado para P4e.

## Contexto

P4a almacena metadata en PostgreSQL y bytes fuera de DB mediante
`DocumentStoragePort`. El adapter local no es suficiente para deployment.

## Decision

Agregar `S3DocumentStorageAdapter`, conservar el adapter local y mantener upload
Web -> NestJS -> port. El bucket sera privado, con Block Public Access e IAM
minimo. `storageProvider` y `storageKey` no se exponen.

## Consecuencias

- los endpoints y el frontend no cambian por elegir S3;
- se necesitan credenciales AWS solo en NestJS;
- storage y PostgreSQL siguen sin transaccion distribuida;
- P5 ampliara el port con lectura interna;
- presigned URLs quedan para lectura futura, no upload frontend.

## Alternativas consideradas

- GCS: buena opcion si el runtime migrara a Cloud Run;
- Azure Blob: robusto pero innecesariamente complejo para PFI;
- Supabase/Firebase Storage: mayor acoplamiento a auth/plataforma cliente;
- bytes en PostgreSQL: descartado por costo y responsabilidad;
- upload directo con presigned URL: postergado por seguridad y complejidad.

