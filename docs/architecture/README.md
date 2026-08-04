# Architecture Docs

Documentacion de arquitectura logica del sistema.

## Contenido

- `architecture-v0.md`: mapa funcional, responsabilidades, flujos y riesgos tecnicos de la primera version documental.
- `architecture-v1.md`: arquitectura de dominio v1 orientada a implementacion incremental.
- `data-model-v0.md`: modelo conceptual de datos previo a Prisma.
- `api-contracts-v0.md`: contratos HTTP iniciales por dominio.
- `canonicalization-and-hashing-v0.md`: estrategia versionada de canonizacion y hashing.
- `auth-and-permissions-v0.md`: estrategia inicial de actores, roles y permisos.
- `deployment-architecture-v0.md`: arquitectura logica, deployment demo y ambientes.
- `document-storage-decision-v0.md`: port de storage, adapter S3 futuro y privacidad.
- `neon-demo-database-runbook-v0.md`: migraciones, seed y verificacion sanitaria de la base demo Neon.
- `render-api-deployment-runbook-v0.md`: configuracion y operacion segura del Web Service NestJS en Render.
- `vercel-frontend-deployment-runbook-v0.md`: configuracion y smoke seguro del frontend Next.js en Vercel.
- `ai-service-integration-v1.md`: evolucion IA para documento, texto y combinado.
- `analysis-job-lifecycle-v0.md`: `AnalysisRun` sincrono inicial y worker posterior.
- `semantic-analysis-source-traceability-v0.md`: fuentes exactas de artifacts IA.
- `ai-assisted-review-v0.md`: propuestas IA separadas y revision humana.
- `environment-strategy-v0.md`: local, demo/staging y produccion futura.
- `security-and-secrets-deployment-v0.md`: secretos, auth interna, IAM y logs.
- `academic-catalog-pipeline-v0.md`: pipeline offline versionado e idempotente.
- `cost-model-demo-v0.md`: supuestos y drivers de costo no contractuales.
- `deployment-and-ai-roadmap-v0.md`: secuencia P4d-P8.

La arquitectura de deployment v0 es una decision para demo/PFI. El hardening
productivo permanece explicitamente fuera de alcance.
