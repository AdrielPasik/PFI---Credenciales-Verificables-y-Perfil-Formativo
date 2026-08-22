# Handoff técnico: sistema de IA de Traza v1

## Propósito y alcance

Traza usa IA como apoyo para interpretar evidencia formativa. El resultado no certifica competencias, no sustituye la decisión del emisor y no participa en la validez criptográfica de una credencial. Este documento describe cómo está construido el sistema hoy para que otro equipo o chat pueda evolucionarlo sin mezclar fronteras de seguridad ni cambiar accidentalmente el dominio.

El alcance actual incluye análisis semántico de PDF y texto, persistencia de ejecuciones, resultados versionados y agregación de perfil. No incluye LLM, embeddings activos, búsqueda vectorial, OCR general, análisis combinado, propuestas automáticas ni emisión automática.

## Arquitectura implementada

```text
Browser
  -> Next.js / NestJS API
       -> autorización y reglas de dominio
       -> AnalysisRun / SemanticAnalysis / FormativeProfile (PostgreSQL)
       -> DocumentStoragePort (solo para bytes PDF vigentes)
       -> AiServiceClient
            -> FastAPI AI Service
                 -> extracción / normalización / taxonomía / reglas

La IA nunca llama a PostgreSQL, S3, blockchain ni al navegador.
```

### Responsabilidades

| Componente | Responsabilidad | No hace |
| --- | --- | --- |
| `apps/web` | Presenta estados allowlisted y llama solo NestJS. | Llamar FastAPI, S3, blockchain o interpretar artifacts crudos. |
| NestJS `src/analysis-run` | Autoriza, fija fuente, crea/ejecuta runs y persiste resultados. | Delegar permisos al servicio IA. |
| NestJS `src/ai` | Cliente HTTP, JWT interno, timeout, validación y mapeo seguro. | Reenviar JWT humano. |
| FastAPI `services/ai-service` | Analiza contenido y exporta `semantic_analysis_v1`. | Acceder a DB, storage, contratos o credenciales de usuario. |
| PostgreSQL | Conserva evidencia, runs, artifacts y perfiles. | Ejecutar inferencia. |
| Document storage | Conserva bytes documentales privados. | Entregar URL pública a FastAPI o browser. |

## Flujos que existen hoy

### Análisis manual de borrador

El emisor autorizado puede crear un análisis documental manual para una credencial `draft` mediante el endpoint issuer-facing. El servicio toma la evidencia vigente exacta, crea un run `manual` y lo ejecuta. La restricción a draft es deliberada: no abre reintentos manuales sobre `issued` o `revoked`.

### Análisis automático post-emisión

`IssuerCredentialIssueService.issueForIssuer()` primero completa la emisión. Fuera de la transacción de emisión, realiza tres intentos best-effort y secuenciales:

1. reconstrucción baseline del perfil del titular;
2. análisis documental si hay un PDF actual elegible;
3. análisis textual para `course` o `certification` si no hay PDF actual.

Una excepción de cualquiera de estos pasos no revierte `issued`. Los servicios automáticos registran observabilidad segura y el endpoint conserva la respuesta de emisión issuer-facing.

### Prioridad de fuente automática

| Condición | Acción |
| --- | --- |
| PDF actual, MIME `application/pdf` | Intenta análisis documental `system`. |
| Sin PDF, `course` o `certification`, hay `TextEvidence` actual | Reutiliza esa fuente para análisis textual `system`. |
| Sin PDF, `course` o `certification`, no hay texto actual pero hay datos declarados suficientes | Crea/reutiliza `TextEvidence` generada por sistema y analiza texto. |
| Sin PDF y sin señal suficiente | No crea run; la emisión permanece válida. |
| `academic_subject` o `degree` sin PDF | No entra en el generador textual automático actual. |

El modo `combined` existe en el enum para evolución, pero la ejecución actual lo rechaza explícitamente. No debe habilitarse por concatenación informal de fuentes.

## Invariantes de dominio y seguridad

1. **Fuente exacta y vigente.** Cada `AnalysisRunSource` apunta a una sola evidencia: `DocumentEvidence` XOR `TextEvidence`. Las FKs son nullable en Prisma para soportar ambas variantes, pero el servicio valida el XOR. No se analiza una fuente reemplazada como si fuera la actual.
2. **Artifact validado dos veces.** FastAPI construye un artifact versionado; NestJS valida el contrato antes de persistirlo. Un payload incompatible se trata como error de integración, no como resultado semántico.
3. **No hay IA en el canon.** `SemanticAnalysis`, evidencias, perfiles y `AnalysisRun` no entran en `canon_v1`, `canonicalHash` ni `BlockchainRecord`.
4. **No hay IA como requisito de emisión.** La credencial puede emitirse con PDF, evidencia textual o sin evidencia con confirmación de producto. Un fallo de IA no cambia su estado emitido.
5. **Separación de identidades.** FastAPI recibe un JWT interno de servicio, no el token de sesión del usuario, ni datos de permisos o identidad del titular.
6. **Read models mínimos.** El frontend issuer ve un resumen seguro de runs; wallet y verificador público no reciben artifacts crudos. El verificador público no usa análisis IA.
7. **No mutación por lectura.** Consultar el perfil actual o un run no crea análisis, no reconstruye perfiles y no modifica evidencia.

## Ubicación de código útil

| Tema | Archivos principales |
| --- | --- |
| FastAPI | `services/ai-service/src/api/main.py`, `service.py`, `models.py`, `internal_auth.py` |
| Pipeline | `services/ai-service/src/pipeline.py`, `semantic_builder.py`, `semantic_ontology.py`, `section_detector.py` |
| Exporter | `services/ai-service/src/exporters/backend_contract/semantic_analysis_exporter.py` |
| Cliente NestJS | `services/api/src/ai/ai-service.client.ts`, `ai-service-internal-auth.ts`, `ai-service-http-error.mapper.ts` |
| Runs | `services/api/src/analysis-run/analysis-run.service.ts`, `analysis-run-execution.service.ts` |
| Automatismos | `automatic-document-analysis.service.ts`, `automatic-course-text-analysis.service.ts`, `automatic-profile-rebuild.service.ts` |
| Contenido declarativo | `services/api/src/credentials/course-text-analysis-content.ts` |
| Persistencia semántica | `services/api/src/semantic` y `services/api/src/ai/ai-integration.service.ts` |
| Perfil | `services/api/src/profiles/formative-profile.service.ts` |
| Esquema | `services/api/prisma/schema.prisma` |

## Datos sensibles y fronteras

| Dato | Puede llegar a FastAPI | Puede ir a UI issuer | Puede ir a verificador público |
| --- | --- | --- | --- |
| PDF vigente | Sí, como bytes desde NestJS. | No, solo metadatos allowlisted. | No. |
| `TextEvidence.content` | Sí, solo en análisis de texto. | No como artifact técnico. | No. |
| `storageKey`, bucket, URL interna | No. | No. | No. |
| `analysisJson`, `evidenceMap`, `textForEmbedding` | Devuelto a NestJS para validación/persistencia. | No crudo. | No. |
| JWT interno | Solo header NestJS -> FastAPI. | No. | No. |
| Datos personales del holder | No como authority ni metadata de IA. | Solo los mínimos del detalle autorizado. | No email ni datos privados. |

## Estado cloud documentado

En la demo actual, FastAPI se ejecuta como Render Web Service Free con HTTPS público y JWT interno HS256. Es una desviación temporal respecto del objetivo de red privada/Private Service, tomada por limitación operativa y de costo del entorno demo. `/health` es público; `/v1/*` requiere la credencial interna.

El riesgo residual principal es disponibilidad: puede haber cold start o gateway temporal antes de que FastAPI devuelva JSON. El incidente documentado produjo `ai_invalid_response` con upstream `502`; no fue un error de JWT, S3, Prisma ni contrato. La mitigación de demo es precalentar con `GET /health`. La solución estructural es una instancia sin spin-down y red privada cuando el entorno lo permita.

Ver `docs/architecture/render-ai-cloud-deployment-record-v0.md` para el runbook sanitizado completo. No copiar URLs ni secretos a esta carpeta.

## Qué debe verificar un cambio futuro

Antes de modificar taxonomía, contrato o lifecycle:

1. identificar si cambia solo clasificación, el artifact compartido o la persistencia;
2. agregar fixture representativo y regresión de un caso cercano negativo;
3. preservar versiones de pipeline/taxonomía en `AnalysisRun` y `SemanticAnalysis`;
4. validar que no se cuelen `rawData`, content, storage keys o tokens en logs/DTOs;
5. probar que una falla del servicio sigue sin revertir emisión;
6. verificar que perfil separa datos declarados de inferencias;
7. no modificar `canon_v1` salvo un slice de dominio/canonicalización explícito.

Los cambios propuestos y sus precondiciones están detallados en [ai-evolution-backlog-v1.md](ai-evolution-backlog-v1.md).
