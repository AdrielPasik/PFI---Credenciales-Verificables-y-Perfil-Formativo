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
- Relaciones: pertenece a `User`, consume muchas `Credential` y `SemanticAnalysis`.
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

- Proposito: catalogo reusable de cursos PROPIO de cada issuer (C3a), para
  reutilizar cursos que un issuer carga manualmente en vez de volver a
  tipear los mismos datos. Deliberadamente distinto de `ExternalCourse`
  (ver nota abajo).
- Campos conceptuales: `id`, `issuer_id`, `title`, `description`, `hours`,
  `modality`, `platform_name`, `external_url`, `competencies`,
  `learning_outcomes`, `status` (`active`/`archived`),
  `created_from_credential_id`, `last_semantic_analysis_id`,
  `created_by_user_id`.
- Relaciones: pertenece a `Issuer` (`onDelete: Restrict`); pertenece a
  `User` como creador (`onDelete: Restrict`); `created_from_credential_id`
  y `last_semantic_analysis_id` son referencias informativas sin FK (el
  patron actual del schema evita relaciones opcionales adicionales cuando
  no son estrictamente necesarias para C3a).
- Relacional: issuer, titulo, horas, modality, status, timestamps.
- Postgres nativo: `competencies` y `learning_outcomes` son `String[]`
  (arrays escalares de Postgres), no JSONB -- primer uso de este tipo de
  columna en el schema.
- No on-chain: no participa en `canon_v1` ni blockchain -- no es una
  credencial emitida.
- Nota `ExternalCourse` vs `IssuerCourseTemplate`: `ExternalCourse` no
  tiene `issuer_id` (no es scoped a un emisor) y fue modelado para un
  futuro import de catalogos externos, no para un catalogo propio por
  issuer. El bundle de auditoria C2b-C3 ya habia señalado que no
  correspondia reutilizarlo para este caso. C3a no migra datos desde
  `ExternalCourse` ni lo modifica.

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
- `FormativeProfileSource`: evolucion para trazar perfiles a analisis concretos.

`semantic_analysis_v1` y `formative_profile_result_v0` siguen siendo artifacts
JSON oficiales validados. Los joins relacionales prueban asociacion/ownership;
no se delega esa autoridad a `sourceRefs` del artifact.
