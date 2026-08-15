# Modelo de datos v0

> Este documento describe el modelo conceptual de datos previo al schema Prisma definitivo. No define SQL ni migraciones.

## Criterios generales

- PostgreSQL es la fuente principal de verdad off-chain.
- Las entidades relacionales sostienen trazabilidad, permisos y consultas.
- JSONB se reserva para estructuras flexibles o versionadas que no conviene normalizar temprano.
- Nada de datos personales completos o contenido academico completo debe vivir on-chain.

## User

- Proposito: representar al titular de credenciales y consumidor principal de wallet/perfil.
- Campos conceptuales: `id`, `did`, `first_name`, `last_name`, `email`, `document_reference`, `status`, `created_at`, `updated_at`.
- Relaciones: tiene muchas `Credential`, uno o varios `FormativeProfile`, muchos `VerificationEvent` como titular indirecto.
- Relacional: ids, did, estado, timestamps, referencias de identidad.
- JSONB: preferencias de wallet o sharing settings futuras.
- No on-chain: datos personales, email, documentos, preferencias.
- Nota: `did` puede existir aun si el mecanismo definitivo de identidad no esta cerrado.

## Issuer

- Proposito: representar la entidad autorizada para emitir credenciales.
- Campos conceptuales: `id`, `name`, `legal_name`, `did`, `wallet_address`, `authorization_status`, `authorized_at`, `revoked_at`, `created_at`.
- Relaciones: emite muchas `Credential`, se vincula con muchos `BlockchainRecord`, puede asociarse a `Program`.
- Relacional: identidad institucional, estado de autorizacion, wallet address.
- JSONB: metadata institucional no critica, configuraciones futuras de emision.
- No on-chain: datos administrativos internos, contactos, configuraciones operativas.

## Credential

- Proposito: representar la credencial educativa off-chain y su estado operativo.
- Campos conceptuales: `id`, `schema_version`, `issuer_id`, `user_id`, `type`, `title`, `description`, `source_type`, `created_at`, `issued_at`, `status`, `canonical_hash`, `canonicalization_version`, `revoked_at`, `revocation_reason`.
- Relaciones: pertenece a `User`, pertenece a `Issuer`, puede tener un `BlockchainRecord`, puede tener muchos `SemanticAnalysis`.
- Relacional: ids, tipo, estado, fechas, hash, version de canonizacion.
- JSONB: `credential_subject`, `metadata`, `raw_data`.
- No on-chain: contenido completo, raw source, datos personales, metadata mutable.
- Nota: `canonical_hash` debe derivarse de una proyeccion estable y no del registro operativo completo.

## SemanticAnalysis

- Proposito: almacenar el resultado versionado del pipeline semantico sobre una credencial.
- Campos conceptuales: `id`, `credential_id`, `status`, `pipeline_version`, `taxonomy_version`, `analyzed_at`, `confidence`.
- Relaciones: pertenece a `Credential`, alimenta `FormativeProfile`.
- Relacional: ids, estado, versiones, timestamps, confidence agregada.
- JSONB: `areas`, `skills`, `concepts`, `quality_flags`, `evidence_map`, `text_for_embedding`.
- No on-chain: resultados semanticos, embeddings, evidencia textual.
- Nota: puede haber multiples analisis por evolucion de pipeline o taxonomia.

## DocumentEvidence

- Proposito: conservar metadata verificable e historial de documentos de
  respaldo asociados a una credencial.
- Campos: `id`, `credential_id`, `uploaded_by_user_id`, `kind`,
  `original_file_name`, `mime_type`, `size_bytes`, `sha256`,
  `storage_provider`, `storage_key`, `status`, `uploaded_at`, `replaced_at`.
- Relaciones: pertenece a `Credential` y al `User` institucional que realizo el
  upload.
- Relacional: metadata, hash, provider/key interna, estado e historial.
- Fuera de PostgreSQL: bytes del documento.
- Regla v0: una sola fila `current` por credencial mediante indice unico
  parcial; filas anteriores pasan a `replaced` y se conservan.
- No on-chain: archivo, storage key, metadata de upload y SHA-256 documental.

## TextEvidence

- Proposito: conservar una fuente textual institucional original asociada a
  una credencial sin convertirla en contenido oficial confirmado.
- Campos: `id`, `credential_id`, `submitted_by_user_id`, `label`, `content`,
  `sha256`, `status`, `submitted_at`, `replaced_at`.
- Relaciones: pertenece a `Credential` y al `User` institucional que registro
  el texto.
- Relacional: contenido normalizado, hash, estado e historial completos en
  PostgreSQL; no usa storage de archivos.
- Regla v0: una sola fila `current` por credencial mediante indice unico
  parcial; las anteriores pasan a `replaced` y se conservan.
- No on-chain: contenido, label, submitter, historial y SHA-256 textual.
- Separacion: `content` es fuente aportada, no reemplaza
  `Credential.description` ni genera skills, competencies o learning outcomes.

## FormativeProfile

- Proposito: representar el resumen agregado del perfil formativo de un usuario.
- Campos conceptuales: `id`, `user_id`, `schema_version`, `generated_at`, `credentials_count`, `total_hours`, `profile_status`.
- Relaciones: pertenece a `User`, consume muchas `Credential` y, para cada una,
  como maximo UNA fuente semantica: una `CredentialReusableSemanticInterpretation`
  `active` (C5b.1, prioridad `issuer_reviewed`) o, si no existe, su ultima
  `SemanticAnalysis` (`ai_inferred`) -- nunca ambas para la misma `Credential`.
- Relacional: ids, generated_at, contadores, estado del perfil.
- JSONB: `areas_summary`, `skills_summary`, `evidence_by_area`, `quality_flags`.
- No on-chain: resumen formativo, evidencia agregada, flags de calidad.
- Nota: no se agrega `created_at` en schema por ahora porque `generated_at` ya describe el momento material del perfil.

## BlockchainRecord

- Proposito: vincular una credencial con su evidencia minima on-chain.
- Campos conceptuales: `id`, `credential_id`, `credential_hash`, `hash_algorithm`, `canonicalization_version`, `network`, `chain_id`, `contract_address`, `tx_hash`, `issuer_address`, `registered_at`, `status`, `revoked_at`, `revocation_reason`.
- Relaciones: pertenece a `Credential`, se asocia indirectamente a `Issuer`.
- Relacional: hashes, red, chain id, tx, estado, fechas.
- JSONB: en principio no hace falta; si luego se agrega receipt resumido podria evaluarse.
- No on-chain: referencia a usuario, raw_data, perfil, analisis.
- Nota: `network` y `chain_id` conviven porque ambos son utiles para negocio y diagnostico.

## VerificationEvent

- Proposito: registrar verificaciones ejecutadas por terceros o por el sistema.
- Campos conceptuales: `id`, `credential_id`, `actor_type`, `verifier_id`, `verification_channel`, `result`, `verified_at`, `shared_token_id`.
- Relaciones: pertenece a `Credential`, puede asociarse a `User` o actor verificador.
- Relacional: ids, canal, resultado, timestamps.
- JSONB: request/response resumida, contexto adicional de verificacion.
- No on-chain: identidad del verificador, trazas de acceso, payloads compartidos.

## AcademicCourse

- Proposito: modelar materias o unidades curriculares institucionales.
- Campos conceptuales: `id`, `issuer_id`, `code`, `name`, `description`, `hours`, `status`.
- Relaciones: puede vincularse con `ProgramCourse`, puede servir como fuente para `Credential`.
- Relacional: codigo, nombre, horas, estado, issuer.
- JSONB: contenidos o bibliografia preliminar si no conviene normalizar.
- No on-chain: descripcion completa, planes, correlativas.

## ExternalCourse

- Proposito: representar cursos externos no pertenecientes al plan institucional principal.
- Campos conceptuales: `id`, `provider_name`, `external_reference`, `title`, `description`, `hours`, `status`.
- Relaciones: puede derivar en `Credential`; puede contribuir al perfil formativo.
- Relacional: proveedor, referencia, titulo, horas, estado.
- JSONB: datos de importacion o certificacion externa.
- No on-chain: contenido completo, datos del proveedor no necesarios para verificacion.

## IssuerCourseTemplate

- Proposito: catalogo reusable PROPIO de cada issuer (C3a), para
  reutilizar cursos o certificaciones que un issuer carga manualmente en
  vez de volver a tipear los mismos datos. Deliberadamente distinto de
  `ExternalCourse` (ver nota abajo).
- Campos conceptuales: `id`, `issuer_id`, `credential_type`
  (`course`/`certification`, C3a.2), `title`, `description`, `hours`,
  `modality`, `platform_name`, `external_url`, `certification_code`,
  `expiration_date`, `provider_name`, `level`, `skills`, `competencies`,
  `learning_outcomes`, `status` (`active`/`archived`),
  `created_from_credential_id`, `last_semantic_analysis_id`,
  `approved_semantic_analysis_id`, `approved_semantic_snapshot`,
  `approved_semantic_approved_by_user_id`, `approved_semantic_approved_at`,
  `approved_semantic_pipeline_version`, `approved_semantic_taxonomy_version`,
  `approved_semantic_source_credential_id` (los 7 ultimos son de C4a.1, ver
  nota mas abajo), `created_by_user_id`.
- Relaciones: pertenece a `Issuer` (`onDelete: Restrict`); pertenece a
  `User` como creador (`onDelete: Restrict`); `created_from_credential_id`,
  `last_semantic_analysis_id`, `approved_semantic_analysis_id` y
  `approved_semantic_source_credential_id` son referencias informativas
  sin FK (el patron actual del schema evita relaciones opcionales
  adicionales cuando no son estrictamente necesarias).
- Relacional: issuer, tipo de credencial, titulo, horas, modality, status,
  timestamps.
- Postgres nativo: `skills`, `competencies` y `learning_outcomes` son
  `String[]` (arrays escalares de Postgres), no JSONB -- primer uso de
  este tipo de columna en el schema (introducido en C3a con
  `competencies`/`learning_outcomes`; `skills` se agrego en C3a.2).
- No on-chain: no participa en `canon_v1` ni blockchain -- no es una
  credencial emitida.
- Nota `ExternalCourse` vs `IssuerCourseTemplate`: `ExternalCourse` no
  tiene `issuer_id` (no es scoped a un emisor) y fue modelado para un
  futuro import de catalogos externos, no para un catalogo propio por
  issuer. El bundle de auditoria C2b-C3 ya habia señalado que no
  correspondia reutilizarlo para este caso. Ni C3a ni C3a.2 migran datos
  desde `ExternalCourse` ni lo modifican.
- Nota C3a.2 (`credentialType`): solo `course` y `certification` son
  validos -- `academic_subject` y `degree` pertenecen al catalogo
  academico formal (`AcademicCourse`/`Program`), nunca a este catalogo
  libre. `credentialType` es inmutable despues de creado (define que
  subconjunto de columnas aplica: `modality`/`platform_name`/
  `learning_outcomes` para `course`; `certification_code`/
  `expiration_date`/`provider_name`/`level`/`skills` para
  `certification`). El modelo no se renombro fisicamente al agregar
  `certification` -- deuda de naming documentada, ver
  `docs/architecture/domain-rules-v0.md`.
- Nota C4a.1 (`approved_semantic_*`): 7 campos aditivos, todos nullable,
  que persisten la aprobacion **explicita** del emisor de una
  `SemanticAnalysis` como interpretacion reutilizable del template.
  `approved_semantic_snapshot` (JSONB) es un allowlist estricto -- ver
  `buildApprovedTemplateSemanticSnapshot` en
  `services/api/src/issuer-course-templates/issuer-course-templates.helpers.ts`
  -- nunca una copia de `analysisJson`; excluye `sourceRefs`,
  `evidenceMap`, `textForEmbedding`, IDs de evidencia, storage paths y
  omite deliberadamente `competencies`/`learning_outcomes` (no existen en
  `SemanticAnalysis`). `approved_semantic_approved_by_user_id` guarda el
  `user.id` autenticado que aprobo; `approved_semantic_approved_at` la
  fecha de aprobacion. No se agrego `approved_semantic_profile_id` -- la
  aprobacion no se acopla a ningun `FormativeProfile` en este slice.
  Migracion:
  `20260811193253_add_approved_semantic_snapshot_to_issuer_course_template`.
  Ver `docs/architecture/domain-rules-v0.md` (seccion 18) para las reglas
  completas.

## CredentialReusableSemanticInterpretation

- Proposito: aplicacion **congelada** de una interpretacion semantica ya
  aprobada (`IssuerCourseTemplate.approved_semantic_*`, ver arriba) sobre
  una `Credential` concreta ya `issued` (C4b.1a — foundation de
  persistencia; `candidate`/`apply`/`read` todavia no existen, ver
  `docs/architecture/approved-semantic-interpretation-application-v0.md`
  v0.2). Nunca es una referencia viva al template: una re-aprobacion
  posterior del template no afecta filas ya insertadas.
- Campos conceptuales: `id`, `credential_id`, `template_id`; provenance
  historica de la aprobacion **fuente** (congelada al momento de
  aplicar, nunca releida del estado actual del template):
  `source_semantic_analysis_id`, `source_credential_id`,
  `source_approved_by_user_id`, `source_approved_at`,
  `source_pipeline_version`, `source_taxonomy_version`; snapshot
  congelado: `approved_snapshot` (JSONB), `snapshot_version`;
  `provenance` (`issuer_reviewed_template_snapshot`), `status`
  (`active`/`superseded`); provenance de la **aplicacion** a esta
  credencial (distinta de la aprobacion fuente): `applied_by_user_id`,
  `applied_at`; historial: `superseded_at`, `superseded_by_user_id`. Sin
  `created_at`/`updated_at` -- `applied_at` es el timestamp material de
  creacion; una fila nunca se actualiza salvo la transicion
  `active -> superseded`.
- Relaciones: pertenece a `Credential` (`onDelete: Cascade` -- mismo
  patron que `SemanticAnalysis`/`DocumentEvidence`/`TextEvidence`);
  pertenece a `IssuerCourseTemplate` (`onDelete: Restrict` -- no existe
  borrado de templates, solo archivado por `status`); pertenece a `User`
  como quien aplico (`applied_by_user_id`, `onDelete: Restrict`, relacion
  nombrada `CredentialSemanticInterpretationApplier` para evitar
  ambiguedad, mismo patron que `DocumentEvidenceUploader`/
  `TextEvidenceSubmitter`/`AnalysisRunRequester`). `source_semantic_
  analysis_id`, `source_credential_id`, `source_approved_by_user_id` y
  `superseded_by_user_id` son referencias informativas sin FK -- mismo
  patron ya usado por `IssuerCourseTemplate.approved_semantic_source_
  credential_id`/`.approved_semantic_approved_by_user_id`.
- Invariante de integridad: a lo sumo una fila `status = active` por
  `credential_id` (`Credential` -> `0..1 active`, `0..N superseded`).
  Prisma no expresa un indice unico parcial (`WHERE`) en el DSL del
  schema -- se agrega como SQL manual en la migracion, mismo patron ya
  usado por `DocumentEvidence`/`TextEvidence` para "una fila `current`
  por credencial". Nombre corto explicito
  (`crsi_one_active_per_credential_uq`): el nombre autogenerado por
  Prisma para este modelo excede el limite de 63 bytes de identifier de
  PostgreSQL.
- `approved_snapshot`: copia exacta del mismo shape allowlisted ya
  saneado `approved_template_semantic_snapshot_v2` (ver
  `IssuerCourseTemplate` arriba) -- nunca reinventado, nunca
  `analysisJson` crudo, `evidenceMap`, `textForEmbedding`, storage paths
  ni IDs de evidencia.
- No on-chain: no participa en `canon_v1`, `canonicalHash` ni
  `BlockchainRecord` -- capa semantica/off-chain estrictamente posterior
  a la emision.
- Migracion:
  `20260814150000_add_credential_reusable_semantic_interpretation`.
  Foundation de persistencia solamente (C4b.1a) -- sin controller, sin
  endpoints, sin logica de `candidate`/`apply`/`read`/idempotencia/
  supersede (eso es C4b.1b). Ver
  `docs/architecture/approved-semantic-interpretation-application-v0.md`
  para el diseno completo.

## Program

- Proposito: representar una carrera, trayecto o programa formativo.
- Campos conceptuales: `id`, `issuer_id`, `name`, `program_type`, `status`, `created_at`.
- Relaciones: tiene muchas `CurriculumVersion`, puede asociarse a `Credential`.
- Relacional: identidad del programa, issuer, estado.
- JSONB: metadata academica flexible.
- No on-chain: plan completo, objetivos detallados, configuraciones internas.

## CurriculumVersion

- Proposito: versionar la estructura curricular de un programa.
- Campos conceptuales: `id`, `program_id`, `version_label`, `effective_from`, `effective_to`, `status`.
- Relaciones: pertenece a `Program`, tiene muchos `ProgramCourse`.
- Relacional: versionado y vigencia.
- JSONB: notas o equivalencias transitorias.
- No on-chain: estructura curricular completa.

## ProgramCourse

- Proposito: vincular cursos o materias con una version curricular concreta.
- Campos conceptuales: `id`, `curriculum_version_id`, `academic_course_id`, `semester`, `is_required`, `ordering`.
- Relaciones: pertenece a `CurriculumVersion`, pertenece a `AcademicCourse`.
- Relacional: foreign keys y atributos de orden/obligatoriedad.
- JSONB: no parece necesario en primera instancia.
- No on-chain: composicion del plan y secuencia curricular.

## AuditLog

- Proposito: registrar acciones tecnicas y de negocio relevantes para trazabilidad.
- Campos conceptuales: `id`, `actor_id`, `actor_type`, `action`, `resource_type`, `resource_id`, `occurred_at`.
- Relaciones: puede referenciar `User`, `Issuer`, `Credential` u otras entidades.
- Relacional: actor, accion, recurso, timestamp.
- JSONB: diff resumido, metadata operativa, request context.
- No on-chain: logs, IPs, payloads, auditoria interna.

## Relaciones clave resumidas

- `User` 1..N `Credential`
- `Issuer` 1..N `Credential`
- `Credential` 1..N `SemanticAnalysis`
- `Credential` 1..N `DocumentEvidence`
- `User` 1..N `DocumentEvidence` como uploader
- `Credential` 1..N `TextEvidence`
- `Credential` 1..N `AnalysisRun`
- `AnalysisRun` 1..N `AnalysisRunSource`
- `AnalysisRun` 0..N `SemanticAnalysis`
- `User` 1..N `TextEvidence` como submitter
- `User` 1..N `FormativeProfile`
- `Credential` 0..1 `BlockchainRecord`
- `Credential` 1..N `VerificationEvent`
- `Program` 1..N `CurriculumVersion`
- `CurriculumVersion` 1..N `ProgramCourse`
- `AcademicCourse` 1..N `ProgramCourse`
- `Issuer` 1..N `IssuerCourseTemplate`
- `User` 1..N `IssuerCourseTemplate` como creador
- `Credential` 1..N `CredentialReusableSemanticInterpretation` (0..1 `active`, 0..N `superseded`)
- `IssuerCourseTemplate` 1..N `CredentialReusableSemanticInterpretation`
- `User` 1..N `CredentialReusableSemanticInterpretation` como quien aplico

## Limites de modelado para la siguiente iteracion

- No usar JSON Schema como reemplazo del modelo relacional.
- No modificar Prisma en P4d. Storage externo permanece detras de
  `DocumentStoragePort` y sus referencias ya viven en `DocumentEvidence`.
- No cerrar aun estrategia final de multi-tenant institucional.

## Modelos de evolucion aprobados por P4d

P5a implementa la primera parte de esta direccion:

- `AnalysisRun`: lifecycle, modo, trigger, versiones y errores;
- `AnalysisRunSource`: documento XOR texto exacto, hash y estado snapshot, sin
  bytes, contenido o storage internals;
- `SemanticAnalysis.analysisRunId`: relacion opcional compatible con historicos.

P5b usa esa relacion al persistir un resultado documental. No agrega tablas ni
migraciones: el run conserva el lifecycle operativo y `SemanticAnalysis` el
artifact validado, incluso cuando su status semantico es `partial`.

Permanecen futuros:

- idempotencia, correlation, intentos y duracion operativa;
- `SemanticAnalysisSource`: relacion de un analisis con documento/texto exactos
  y sus hashes;
- `CredentialEnrichmentProposal`: propuesta IA separada de claims oficiales;
- decision de revision humana por campo, posiblemente en tabla propia;
- `FormativeProfileSource`: evolucion para trazar perfiles a analisis concretos
  en una tabla relacional propia -- sigue sin implementarse (C5b.1 no agrega
  ninguna tabla ni migracion).

C5b.1 cubre parte de esa necesidad dentro del JSON existente, sin tabla
nueva: cada entrada de `profileJson.areas`/`.skills`/`.concepts` ahora
incluye `sources[]` (provenance por Credential contribuyente --
`issuer_reviewed` con `reusableInterpretationId`, o `ai_inferred` con
`semanticAnalysisId`, nunca ambos) y `provenanceSummary`. Ver
`domain-rules-v0.md` seccion 23 para el detalle completo. `FormativeProfile`
ahora tambien puede consumir, ademas de `SemanticAnalysis`, como maximo una
fila `active` de `CredentialReusableSemanticInterpretation` por
`Credential` -- su `approvedSnapshot` ya congelado, nunca
`IssuerCourseTemplate.approvedSemanticSnapshot` releido en vivo.

C5b.2 no agrega tabla ni migracion tampoco: proyecta `provenanceSummary`
(agregado, nunca `sources[]` completo) al holder autenticado via
`GET /me/profile/current`/`POST /me/profile/rebuild`, y endurece
`profile-sharing.service.ts` para que el perfil publico compartido siga sin
recibir `provenanceSummary`/`sources`/ningun id interno nuevo. Ver
`domain-rules-v0.md` seccion 24 y `api-contracts-v0.md` para el contrato
exacto. `sources[]`/`provenanceSummary` por `concept` siguen siendo
internos de `profileJson` -- C5b.2 no los expone (el contrato holder de
`concepts` sigue siendo `string[]`).

`semantic_analysis_v1` y `formative_profile_result_v0` siguen siendo artifacts
JSON oficiales validados. Los joins relacionales prueban asociacion/ownership;
no se delega esa autoridad a `sourceRefs` del artifact.
