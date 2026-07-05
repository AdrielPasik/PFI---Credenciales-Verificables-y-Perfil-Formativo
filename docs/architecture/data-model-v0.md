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
- `User` 1..N `FormativeProfile`
- `Credential` 0..1 `BlockchainRecord`
- `Credential` 1..N `VerificationEvent`
- `Program` 1..N `CurriculumVersion`
- `CurriculumVersion` 1..N `ProgramCourse`
- `AcademicCourse` 1..N `ProgramCourse`

## Limites de modelado para la siguiente iteracion

- No usar JSON Schema como reemplazo del modelo relacional.
- No modelar todavia colas, jobs o storage externo.
- No cerrar aun estrategia final de multi-tenant institucional.
