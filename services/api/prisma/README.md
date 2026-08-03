# Prisma Schema v0

Este directorio contiene el `schema.prisma` base del backend API y los artefactos locales de persistencia asociados, como migraciones y seed, a medida que el proyecto avanza.

## Enfoque

- final-oriented pero incremental;
- relaciones centrales modeladas desde el inicio;
- campos opcionales donde el flujo todavia no completa toda la informacion;
- `Json` para artefactos versionados, flexibles o aun no normalizados;
- con migraciones versionadas como estrategia preferida para trazabilidad;
- con seed minimo reproducible para desarrollo local.

## Entidades principales

- `User`: titular de credenciales y usuario operativo potencial.
- `Issuer`: institucion o entidad emisora.
- `IssuerMembership`: pertenencia institucional para evitar un `issuer_admin` global.
- `Credential`: artefacto central off-chain.
- `DocumentEvidence`: metadata e historial de evidencia documental por
  credencial; los bytes viven fuera de PostgreSQL.
- `TextEvidence`: fuente textual institucional normalizada e historial por
  credencial; el contenido vive en PostgreSQL.
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

- `User.email` es opcional pero unico para permitir usuarios sin login inicial y evitar duplicados cuando el email exista.
- `IssuerMembership` existe para limitar `issuer_admin` a uno o mas `issuer_id`.
- `IssuerMembership @@unique([userId, issuerId])` representa el estado actual de pertenencia institucional; el historial fino de cambios debera conservarse mediante `AuditLog`, no con multiples filas historicas de membresia en esta etapa.
- `BlockchainRecord` permite multiples registros por credencial para soportar Anvil, Base Sepolia, reintentos e historial.
- `FormativeProfile` permite multiples generaciones por usuario para conservar recalculos y versionado.
- `FormativeProfile.isCurrent` existe como ayuda operativa, pero la unicidad del perfil vigente por usuario se resolvera por logica de aplicacion futura y no por constraint adicional en esta etapa.
- `SharingGrant` prepara sharing por link/QR/mobile sin implementar todavia tokens, permisos ni UX.
- `Credential.canonicalHash` queda indexado pero no marcado `unique` en esta etapa para no imponer una restriccion prematura sin validacion de negocio adicional.
- `Program.code` conserva el codigo institucional y es unico dentro del
  issuer; `ProgramCourse` es unico por version curricular y materia.
- `Credential.programCourseId` conserva opcionalmente la relacion curricular
  exacta elegida para un draft, sin reemplazar el snapshot de contenido.
- `DocumentEvidence` conserva cero o una fila `current` y varias `replaced` por
  credencial. La unicidad vigente se implementa con un indice unico parcial en
  SQL porque Prisma no expresa directamente ese predicado.
- `DocumentEvidence.sha256` identifica los bytes documentales y no reemplaza
  `Credential.canonicalHash` ni participa en `canon_v1`.
- `TextEvidence` conserva cero o una fila `current` y varias `replaced` por
  credencial. Su indice unico parcial se declara en SQL y el reemplazo usa una
  transaccion `Serializable`.
- `TextEvidence.sha256` identifica los bytes UTF-8 del contenido normalizado;
  no es `canonicalHash`, no participa en `canon_v1` y no se registra on-chain.

## Que no esta implementado todavia

- endpoints de negocio;
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

- el backend NestJS implementa auth, credenciales, perfil y catalogo incremental;
- el cliente Prisma puede generarse localmente con scripts del workspace;
- la migracion P4a agrega `DocumentEvidence` de forma aditiva, con relaciones a
  `Credential` y `User`, indices de consulta y una sola evidencia `current` por
  credencial;
- la migracion P4c-a agrega `TextEvidence` de forma aditiva, con contenido
  textual en PostgreSQL, relaciones a `Credential` y `User`, indices de
  consulta y una sola fuente textual `current` por credencial;
- el mismo issuer demo, identificado de forma estable por
  `did:example:issuer-demo`, se crea o actualiza idempotentemente con el nombre
  visible `Universidad Argentina de la Empresa (UADE)`;
- el seed local importa de forma idempotente 617 `AcademicCourse` demo desde
  `data/academic_catalog/demo-academic-courses-v0.json`;
- el seed tambien importa 22 `Program`, 22 `CurriculumVersion` y 977
  `ProgramCourse` desde `demo-academic-curriculum-v0.json`, asociados al issuer
  demo UADE;
- las materias siguen disponibles como catalogo plano y, adicionalmente, por
  su pertenencia formal a una version curricular;
- este schema queda como base revisable del sistema final, preparada para implementacion incremental.

El rename del issuer no reescribe snapshots historicos en
`Credential.credentialSubject`. Por eso, credenciales locales anteriores
pueden conservar `Demo University`, mientras los drafts nuevos derivan el
nombre UADE vigente. Para una demo completamente limpia, se puede crear una
base local nueva, aplicar las migraciones versionadas y ejecutar el seed; el
seed no realiza ningun reset destructivo automatico.
