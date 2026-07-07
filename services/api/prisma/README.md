# Prisma Schema v0

Este directorio contiene el primer `schema.prisma` del backend API. El objetivo es dejar una base realista del dominio final del sistema, manteniendo una implementacion incremental y evitando un modelo descartable para entregas intermedias.

## Enfoque

- final-oriented pero incremental;
- relaciones centrales modeladas desde el inicio;
- campos opcionales donde el flujo todavia no completa toda la informacion;
- `Json` para artefactos versionados, flexibles o aun no normalizados;
- sin migraciones, sin generacion de cliente y sin servicios NestJS implementados todavia.

## Entidades principales

- `User`: titular de credenciales y usuario operativo potencial.
- `Issuer`: institucion o entidad emisora.
- `IssuerMembership`: pertenencia institucional para evitar un `issuer_admin` global.
- `Credential`: artefacto central off-chain.
- `SemanticAnalysis`: resultado semantico persistible por credencial.
- `FormativeProfile`: perfil agregado versionable por usuario.
- `BlockchainRecord`: evidencia blockchain historica por credencial.
- `VerificationEvent`: trazabilidad de verificaciones.
- `SharingGrant`: base para links y QR de wallet mobile/PWA.
- `AcademicCourse`, `ExternalCourse`, `Program`, `CurriculumVersion`, `ProgramCourse`: catalogo academico/formativo.
- `AuditLog`: auditoria tecnica y de negocio.

## Que se modelo relacionalmente

- usuarios, emisores y membresias institucionales;
- credenciales y sus relaciones principales;
- multiples analisis semanticos por credencial;
- multiples perfiles formativos por usuario;
- multiples registros blockchain por credencial;
- sharing grants para credenciales o perfiles;
- catalogo academico y programas con version curricular.

## Que se dejo como Json y por que

Se dejaron como `Json` las estructuras que hoy son versionadas, flexibles o todavia no conviene normalizar:

- `credentialSubject`, `metadata`, `rawData` en `Credential`;
- `areas`, `skills`, `concepts`, `qualityFlags`, `evidenceMap`, `analysisJson` en `SemanticAnalysis`;
- `areasSummary`, `skillsSummary`, `evidenceByArea`, `qualityFlags`, `profileJson` en `FormativeProfile`;
- `metadata` complementaria en catalogo, sharing y auditoria.

Esto mantiene compatibilidad con los JSON Schemas existentes y evita sobreingenieria temprana.

## Decisiones importantes

- `IssuerMembership` existe para limitar `issuer_admin` a uno o mas `issuer_id`.
- `IssuerMembership @@unique([userId, issuerId])` representa el estado actual de pertenencia institucional; el historial fino de cambios debera conservarse mediante `AuditLog`, no con multiples filas historicas de membresia en esta etapa.
- `BlockchainRecord` permite multiples registros por credencial para soportar Anvil, Base Sepolia, reintentos e historial.
- `FormativeProfile` permite multiples generaciones por usuario para conservar recalculos y versionado.
- `FormativeProfile.isCurrent` existe como ayuda operativa, pero la unicidad del perfil vigente por usuario se resolvera por logica de aplicacion futura y no por constraint adicional en esta etapa.
- `SharingGrant` prepara sharing por link/QR/mobile sin implementar todavia tokens, permisos ni UX.
- `Credential.canonicalHash` queda indexado pero no marcado `unique` en esta etapa para no imponer una restriccion prematura sin validacion de negocio adicional.

## Que no esta implementado todavia

- migraciones Prisma;
- NestJS modules, controllers o services;
- autenticacion real;
- logica de emision, hashing, blockchain o AI service;
- generacion de tokens de sharing;
- reglas de permisos en runtime.

## Decisiones pendientes

- constraint final sobre `Credential.canonicalHash`;
- criterio de seleccion de registro blockchain principal por credencial;
- politica exacta para `FormativeProfile.isCurrent`;
- proveedor definitivo de auth e identidad;
- si algunos `Json` deben normalizarse mas adelante.

## Relacion con los JSON Schemas

El schema Prisma no intenta reemplazar los contratos JSON versionados. Los artefactos `credential_v1`, `semantic_analysis_v1`, `formative_profile_v1` y `blockchain_record_v1` siguen representandose en parte mediante campos `Json` y campos relacionales complementarios para consulta, permisos y trazabilidad.

## Estado operativo

- no se corrieron migraciones;
- no se genero cliente Prisma;
- no se implemento backend, auth, IA ni blockchain;
- este schema queda como base revisable del sistema final, preparada para implementacion incremental.
