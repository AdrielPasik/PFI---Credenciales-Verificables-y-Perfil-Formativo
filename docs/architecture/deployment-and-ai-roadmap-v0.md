# Roadmap de deployment e IA v0

## Proposito

Ordenar el trabajo posterior a P4c-b para desplegar Traza y construir analisis
IA trazable, revisable y separado de emision/blockchain.

## Principios del camino critico

- desplegar infraestructura basica antes de ampliar P5;
- NestJS sigue siendo autoridad y orquestador;
- IA produce artifacts/propuestas, no claims oficiales automaticos;
- evidencia exacta y hash se trazan antes de presentar readiness;
- `canon_v2` se decide despues de revision humana/readiness;
- mock/Anvil siguen siendo la demo blockchain garantizada.

## P4d - Arquitectura y ADRs

| Campo | Definicion |
| --- | --- |
| Objetivo | Aprobar deployment, storage, integracion IA, lifecycle, trazabilidad y revision. |
| Dependencias | P4c-b. |
| Modulos | `docs/architecture`, `docs/decisions`. |
| Migracion | No. |
| Endpoint | Ninguno. |
| Aceptacion | Documentos y ADRs coherentes con runtime actual y futuro explicito. |
| Pruebas | Revision documental, Mermaid y `git diff --check`. |
| Riesgos | Documentar como implementado un modelo futuro. |
| Entrega | 50%, obligatorio. |

## P4e - S3DocumentStorageAdapter

Estado: implementado en backend y validado mediante smoke con S3 privado real;
la configuracion del Web Service Render sigue pendiente.

| Campo | Definicion |
| --- | --- |
| Objetivo | Alternar storage local/S3 detras de `DocumentStoragePort`. |
| Dependencias | P4d y ADR 0007. |
| Modulos | `document-evidence`, config, adapter S3. |
| Migracion | No; `storageProvider/storageKey` ya existen. |
| Endpoint | Upload documental actual, sin cambio publico. |
| Aceptacion | Mismo DTO/flujo con local y S3; bucket privado e IAM minimo. |
| Pruebas | Contract tests del port, mock S3, runtime, compensacion DB-failure. |
| Riesgos | Objetos huerfanos, IAM excesivo, egress. |
| Entrega | 50%, obligatorio. |

## P4f - Neon demo y migraciones

Estado: preparacion operativa implementada y Neon real migrado, seeded y
verificado fuera del repositorio. Las credenciales permanecen en gestion
privada y no se versionan.

| Campo | Definicion |
| --- | --- |
| Objetivo | Provisionar PostgreSQL Neon reproducible. |
| Dependencias | P4d. |
| Modulos | Prisma, deployment docs/scripts. |
| Migracion | Ejecuta migraciones existentes; no exige una nueva. |
| Endpoint | Health DB separado u operativo, si se justifica. |
| Aceptacion | `migrate deploy`, seed/import idempotente y conteos esperados. |
| Pruebas | DB limpia, migraciones, seed repetido, queries sanitarias. |
| Riesgos | SSL/pool, drift, seed en base equivocada. |
| Entrega | 50%, obligatorio. |

## P4g - NestJS en Render

Estado: readiness documental cerrada y Web Service real desplegado en Render.
Health, Neon pooled, S3 y consumo desde frontend local fueron validados. Ver
`render-api-deployment-runbook-v0.md`.

| Campo | Definicion |
| --- | --- |
| Objetivo | Preparar y luego desplegar la API publica conectada a Neon pooled y S3 privado. |
| Dependencias | P4e, P4f. |
| Modulos | config API, CORS, health, deployment. |
| Migracion | No adicional. |
| Endpoint | Endpoints actuales. |
| Aceptacion | Login, catalogo, draft, documento y texto operan en cloud. |
| Pruebas | Smoke/E2E sanitario, CORS allowlist, secrets missing. |
| Riesgos | Cold start, pool DB, env incompleta, logs sensibles. |
| Entrega | 50%, obligatorio. |

## P4h - Next.js en Vercel

Estado: readiness documental y build local implementados. La creacion del
proyecto Vercel, el deploy real y la actualizacion final de `WEB_ORIGIN` siguen
pendientes fuera de este slice. Ver `vercel-frontend-deployment-runbook-v0.md`.

| Campo | Definicion |
| --- | --- |
| Objetivo | Preparar y luego desplegar el Portal del Emisor contra Render. |
| Dependencias | P4g. |
| Modulos | `apps/web`, env/deployment. |
| Migracion | No. |
| Endpoint | Consume API NestJS existente. |
| Aceptacion | Flujo login -> draft -> evidencias desde navegador desplegado. |
| Pruebas | Build, smoke, auth, responsive y consola. |
| Riesgos | API URL/CORS de previews, secretos en variables publicas. |
| Entrega | 50%, obligatorio. |

## P4i - FastAPI privado y auth interna

Estado: P4i-1 reemplazo el placeholder por un snapshot curado y testeable del
servicio FastAPI real. P4i-2 agrego tooling reproducible, `PORT` configurable,
Docker portable y tests de outputs Python contra los schemas compartidos. El
import excluye datos, outputs, embeddings y secretos. P4i-3 implemento auth
interna HS256 con modo local deshabilitado, fail-fast y `/health` publico.
P4i-4 deja el deployment privado listo a nivel runbook, sin crear el servicio
real. P4i-6a registra el deploy demo ya operativo como Web Service Free con URL
HTTPS publica y JWT interno, una desviacion temporal por restricciones de
costo/entorno actuales. Health, rechazo sin JWT y smoke NestJS -> FastAPI
pasaron; integracion de fuentes y hardening continuan en slices siguientes.

| Campo | Definicion |
| --- | --- |
| Objetivo | Operar FastAPI autenticado desde NestJS y migrar la excepcion demo a red privada. |
| Dependencias | P4g, ADR 0008. |
| Modulos | `AiServiceClient`, middleware FastAPI, config. |
| Migracion | No. |
| Endpoint | `/health` y endpoints IA v1 existentes. |
| Aceptacion | NestJS accede con JWT interno; navegador no accede; desviacion publica queda registrada. |
| Pruebas | token valido/ausente/vencido, issuer/audience, Docker y smoke privado documentado. |
| Riesgos | URL publica demo, abuso de recursos o reutilizar JWT de usuarios. |
| Entrega | 50%, obligatorio. |

## P5a - Resolucion interna de fuentes

Estado: foundation implementada. `AnalysisRun` `pending` captura fuentes current
exactas mediante servicio interno; no ejecuta IA ni expone endpoint.

| Campo | Definicion |
| --- | --- |
| Objetivo | Persistir run pendiente y versiones exactas de documento/texto. |
| Dependencias | P4e, P4i. |
| Modulos | storage port, document/text evidence, AI integration. |
| Migracion | Si, runs, sources y relacion semantica opcional. |
| Endpoint | Ninguno publico nuevo; servicio interno. |
| Aceptacion | Fuentes current quedan referenciadas por hash; combined exige ambas. |
| Pruebas | missing/replaced/cross-issuer, status y hash. |
| Riesgos | Analizar una version distinta de la persistida. |
| Entrega | 50%, obligatorio. |

## P5b - AnalysisRun sincrono

Estado: ejecucion interna documental implementada. No expone endpoint, worker
ni soporte para `text`/`combined`.

| Campo | Definicion |
| --- | --- |
| Objetivo | Ejecutar y transicionar el lifecycle persistido sin cola. |
| Dependencias | P5a. |
| Modulos | Prisma, analysis orchestration. |
| Migracion | Ninguna en P5b; reutiliza el schema de P5a. |
| Endpoint | Ninguno nuevo; base interna para triggers P5c-P5e. |
| Aceptacion | Claim atomico, `running -> completed/failed`, resultado asociado y error seguro. `partial` es status del artifact, no del run. |
| Pruebas | fuente exacta, timeout/auth, artifact invalido, concurrencia y persistencia semantica. |
| Riesgos | Runs en `running` y requests largos. |
| Entrega | 50%, obligatorio. |

## P5c - Analisis documental

Estado: trigger issuer-scoped protegido implementado sobre P5a/P5b. Solo
admin/operator de un issuer autorizado y credenciales draft; no hay frontend.

| Campo | Definicion |
| --- | --- |
| Objetivo | Analizar `DocumentEvidence` exacta, inicialmente PDF. |
| Dependencias | P5b, ADR 0009. |
| Modulos | AI client, storage, semantic, issuer AI controller. |
| Migracion | Ninguna; reutiliza P5a/P5b. |
| Endpoint | `POST /issuers/:issuerId/credentials/:credentialId/analysis-runs/document`. |
| Aceptacion | `semantic_analysis_v1` validado/persistido sin cambiar Credential. |
| Pruebas | auth/scoping, body no confiable, fuente faltante, error sanitizado y regresiones P5b. |
| Riesgos | OCR/imagen no soportados, memoria y latencia. |
| Entrega | 50%, obligatorio al menos para PDF. |

## P5d - Lectura y status de AnalysisRun

Estado: implementado con reads issuer-scoped `latest` y por ID. La lectura es
historica y no exige que la credencial permanezca draft.

| Campo | Definicion |
| --- | --- |
| Objetivo | Consultar lifecycle y resumen semantico seguro sin ejecutar IA. |
| Dependencias | P5a-P5c. |
| Modulos | AnalysisRun read service, mapper y controller issuer-facing. |
| Migracion | Ninguna. |
| Endpoint | `GET .../analysis-runs/latest` y `GET .../analysis-runs/:analysisRunId`. |
| Aceptacion | Scope seguro, latest nullable, 404 uniforme y allowlist sin artifact/storage. |
| Pruebas | routing, permisos, draft/issued/revoked, estados, JSON invalido y minimizacion. |
| Riesgos | Exponer errores historicos o payloads semanticos internos. |
| Entrega | 50%, obligatorio. |

## P5e - Analisis textual y combinado

| Campo | Definicion |
| --- | --- |
| Objetivo | Agregar triggers `text` y `combined` con fuentes exactas. |
| Dependencias | P5c y contrato FastAPI para texto/combinado. |
| Modulos | AI contract, orchestration, semantic. |
| Migracion | No adicional a P5b/P5f. |
| Endpoint | Futuros POST issuer-scoped para `text` y `combined`. |
| Aceptacion | Artifact identifica ambas fuentes, evidencia y conflictos. |
| Pruebas | fuente faltante, contradiccion, doble conteo, partial. |
| Riesgos | Fusion no explicable y evidencia duplicada. |
| Entrega | 50%, despues de modos individuales. |

## P5f - SemanticAnalysisSource

| Campo | Definicion |
| --- | --- |
| Objetivo | Relacionar cada analisis con fuentes concretas y hashes. |
| Dependencias | P5b-P5e. |
| Modulos | Prisma, semantic mapper/service/read models. |
| Migracion | Si. |
| Endpoint | GET latest/run status issuer-facing. |
| Aceptacion | Se demuestra exactamente que fuentes produjeron el resultado. |
| Pruebas | FK, ownership, source hash, replaced history, allowlist. |
| Riesgos | Confiar solo en `sourceRefs` JSON. |
| Entrega | 50%, obligatorio. |

## P5g - UI de estado y resultado

| Campo | Definicion |
| --- | --- |
| Objetivo | Trigger manual, loading, estado, resumen, warnings y retry. |
| Dependencias | P5f. |
| Modulos | detalle issuer, API client, adapters, view models. |
| Migracion | No. |
| Endpoint | Triggers P5c-P5e + GET latest/run. |
| Aceptacion | No hay analisis automatico al subir; IA no se presenta como verdad. |
| Pruebas | estados, 401/403/409/5xx, doble submit, read-only. |
| Riesgos | UI optimista o artifacts crudos expuestos. |
| Entrega | 50%, obligatorio. |

## P5h - Propuestas IA

| Campo | Definicion |
| --- | --- |
| Objetivo | Persistir propuestas editables separadas del analisis. |
| Dependencias | P5f, ADR 0012. |
| Modulos | contratos IA, proposal service, Prisma. |
| Migracion | Si, `CredentialEnrichmentProposal` o equivalente. |
| Endpoint | `GET .../proposals/latest` issuer-facing. |
| Aceptacion | Propuestas con fuente/confianza sin PATCH automatico. |
| Pruebas | schema, extras, stale, evidencia por campo. |
| Riesgos | Convertir respuesta cruda en dato oficial. |
| Entrega | 50%, alcance minimo. |

## P6a - Revision humana

| Campo | Definicion |
| --- | --- |
| Objetivo | Aceptar, editar o rechazar propuestas por campo. |
| Dependencias | P5h. |
| Modulos | review service, draft update, frontend. |
| Migracion | Probablemente si para decisiones/auditoria. |
| Endpoint | `POST .../proposals/:proposalId/review`. |
| Aceptacion | Solo decisiones confirmadas actualizan el draft con CAS. |
| Pruebas | partial accept, stale draft/source, permisos, auditoria. |
| Riesgos | Aplicar propuesta sobre version antigua. |
| Entrega | 50%, obligatorio para IA responsable. |

## P6b - Readiness derivada

| Campo | Definicion |
| --- | --- |
| Objetivo | Calcular blockers/warnings para drafts, sin nuevo lifecycle. |
| Dependencias | P6a. |
| Modulos | credentials/readiness y read model issuer. |
| Migracion | No, salvo auditoria opcional futura. |
| Endpoint | GET readiness o campo derivado en detail. |
| Aceptacion | `draft` tiene readiness explicable; issued/revoked no aplica. |
| Pruebas | matriz por type, fuentes stale, warnings/blockers. |
| Riesgos | Persistir y producir drift o habilitar emision prematura. |
| Entrega | 50%, obligatorio. |

## P7 - Canon v2, emision y blockchain

| Campo | Definicion |
| --- | --- |
| Objetivo | Congelar claims oficiales y emitir con evidencia reconciliable. |
| Dependencias | P6a, P6b y ADR futura de `canon_v2`. |
| Modulos | hashing, credentials, blockchain, deployment. |
| Migracion | Posible para version/receipt/hardening. |
| Endpoint | Issue protegido existente, endurecido por readiness. |
| Aceptacion | Golden vectors, mock/Anvil y testnet reconciliables. |
| Pruebas | determinismo, idempotencia, DB-failure, Anvil y Base Sepolia. |
| Riesgos | blockchain success + DB failure; canon prematuro. |
| Entrega | Posterior/stretch respecto del 50%, obligatorio para vertical final. |

## P8 - Verificador publico y QR

| Campo | Definicion |
| --- | --- |
| Objetivo | Read model publico minimizado y URL/QR estable. |
| Dependencias | P7. |
| Modulos | verification backend y ruta publica Next.js. |
| Migracion | Solo si sharing grants/aliases lo requieren. |
| Endpoint | `GET /verify/credentials/:reference` endurecido. |
| Aceptacion | draft/inexistente no se confirma; issued/revoked son claros. |
| Pruebas | privacidad, tampering, revoked, unknown y PII allowlist. |
| Riesgos | Reutilizar DTO tecnico o exponer drafts/holder. |
| Entrega | Posterior, obligatorio para vertical final. |

## Corte Entrega 50%

Camino obligatorio: P4d-P4i, P5a-P5h, P6a y P6b. P7 y P8 son posteriores al
corte pero forman parte obligatoria del producto Traza; no son ideas fuera de
alcance.

Recorrido defendible del corte:

```text
login -> issuer -> draft -> documento/texto -> analisis manual
-> artifact trazable -> propuestas -> revision humana -> readiness derivada
```

## Decisiones postergadas

- ADR y alcance exacto de `canon_v2`;
- OCR de imagenes;
- worker/cola y polling;
- presigned GET para FastAPI;
- Base Sepolia estable;
- QR/sharing y holder app completa;
- KMS/HSM, mTLS o workload identity productiva.
