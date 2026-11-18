# Architecture Docs

Documentacion de arquitectura logica del sistema.

## Contenido

- `architecture-v1.md`: arquitectura de dominio v1 orientada a implementacion incremental.
- `data-model-v0.md`: modelo conceptual de datos previo a Prisma.
- `api-contracts-v0.md`: contratos HTTP iniciales por dominio.
- `canonicalization-and-hashing-v0.md`: estrategia versionada de canonizacion y hashing.
- `auth-and-permissions-v0.md`: estrategia inicial de actores, roles y permisos.
- `platform-administration-and-institutional-authority-v1.md`: plano de plataforma (`PlatformAdmin`), autoridad institucional (`IssuerMembership`) y alta administrativa de instituciones.
- `deployment-architecture-v0.md`: arquitectura AWS definida, fronteras de
  integración y límites de comprobación externa.
- `environment-strategy-v0.md`: separación entre desarrollo local, arquitectura
  AWS y antecedentes de demo.
- `production-deployment-readiness-v1.md`: checklist técnico de transición AWS;
  debe leerse junto con Terraform y no prueba por sí solo recursos activos.
- `document-storage-decision-v0.md`: port de storage, adapter S3 y privacidad.
- `neon-demo-database-runbook-v0.md`, `render-api-deployment-runbook-v0.md` y
  `render-ai-private-service-runbook-v0.md`: antecedentes operativos de la
  etapa demo, no arquitectura AWS vigente.
- `render-ai-cloud-deployment-record-v0.md`: registro histórico de incidente y
  controles del AI Service en la demo anterior.
- `vercel-frontend-deployment-runbook-v0.md`: procedimiento de web y previews;
  no confirma alojamiento productivo.
- `ai-service-integration-v1.md`: evolucion IA para documento, texto y combinado.
- `analysis-job-lifecycle-v0.md`: `AnalysisRun` sincrono inicial y worker posterior.
- `semantic-analysis-source-traceability-v0.md`: fuentes exactas de artifacts IA.
- `ai-assisted-review-v0.md`: propuestas IA separadas y revision humana.
- `security-and-secrets-deployment-v0.md`: secretos, auth interna, IAM y logs.
- `academic-catalog-pipeline-v0.md`: pipeline offline versionado e idempotente.

La arquitectura de deployment v0 es una decision para demo/PFI. El hardening
productivo permanece explicitamente fuera de alcance.
