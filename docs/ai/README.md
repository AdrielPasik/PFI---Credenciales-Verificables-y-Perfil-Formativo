# Inteligencia artificial de Traza

Esta carpeta es el handoff técnico del subsistema de análisis semántico de Traza. Describe el estado implementado del repositorio a agosto de 2026; no es una especificación aspiracional. Debe leerse junto con el código indicado en cada documento antes de cambiar contratos, taxonomías o el ciclo de vida de un análisis.

## Lectura recomendada

1. [Arquitectura y frontera de seguridad](ai-system-handoff-v1.md): mapa de componentes, responsabilidades e invariantes que no deben romperse.
2. [Runtime FastAPI y contrato HTTP](ai-service-runtime-and-contracts-v1.md): endpoints internos, autenticación, payloads, límites y artefacto `semantic_analysis_v1`.
3. [Orquestación NestJS y persistencia](analysis-run-and-persistence-v1.md): `AnalysisRun`, fuentes, ejecución, análisis automático y errores seguros.
4. [Taxonomía, calidad y perfil formativo](taxonomy-quality-and-profile-v1.md): pipeline determinista, configuración, quality flags y reconstrucción de perfiles.
5. [Evolución segura](ai-evolution-backlog-v1.md): deuda conocida, orden de evolución, pruebas y anti-patrones.

## Estado actual en una página

- El runtime de IA es un servicio FastAPI en `services/ai-service`. Usa un pipeline determinista de normalización, secciones, taxonomías y reglas; no usa actualmente un LLM, embeddings activos, búsqueda vectorial ni modelos de aprendizaje automático cargados en runtime.
- El navegador nunca llama al servicio de IA. Solo NestJS, mediante `AiServiceClient`, envía PDF o contenido de `TextEvidence` a FastAPI.
- El JWT humano termina en NestJS. En demo/producción, NestJS fabrica un JWT interno HS256 de vida corta para FastAPI; no reenvía el token del usuario.
- Un análisis se representa con `AnalysisRun` y una fuente exacta (`DocumentEvidence` XOR `TextEvidence`). La respuesta FastAPI se valida en NestJS antes de persistir un `SemanticAnalysis`.
- La emisión es la operación principal. El análisis automático posterior es best-effort: su falla queda en el run y nunca revierte una credencial emitida.
- Un PDF vigente habilita análisis documental. Para `course` y `certification` sin PDF vigente, el backend puede construir una evidencia textual a partir de campos declarados por el emisor y ejecutar análisis de texto.
- `SemanticAnalysis`, `AnalysisRun`, `TextEvidence`, `DocumentEvidence` y `FormativeProfile` quedan fuera de `canon_v1`, del hash canónico y de la evidencia blockchain.
- El perfil formativo se reconstruye de forma determinista en NestJS, no por una consulta de IA al abrir la wallet. Mantiene separados datos declarados por el emisor e inferencias semánticas.

## Autoridad de cada fuente

| Tema | Fuente de verdad actual |
| --- | --- |
| Contrato del artefacto | `packages/schemas/semantic_analysis_v1.schema.json` y validador NestJS |
| Pipeline y taxonomía | `services/ai-service/src` y `services/ai-service/config/semantic` |
| Llamada segura a FastAPI | `services/api/src/ai` |
| Lifecycle y persistencia | `services/api/src/analysis-run`, `services/api/src/semantic` |
| Perfil actual | `services/api/src/profiles/formative-profile.service.ts` |
| Reglas de negocio | `docs/architecture/domain-rules-v0.md` |
| Contratos HTTP externos | `docs/architecture/api-contracts-v0.md` |
| Operación cloud y riesgo temporal | `docs/architecture/render-ai-cloud-deployment-record-v0.md` |

## Límites deliberados

No interpretar estos documentos como autorización para:

- exponer FastAPI al browser o agregar `NEXT_PUBLIC_AI_SERVICE_BASE_URL`;
- usar el JWT humano como token interno de servicio;
- guardar texto/PDF/artifacts crudos en logs, read models públicos o snapshots reutilizables;
- usar IA como condición de emisión, validez académica o canonicalización;
- crear análisis textual o `combined` sobre una credencial issued mediante el endpoint manual;
- afirmar que la IA certifica habilidades o competencias;
- afirmar que una red blockchain valida el contenido académico.

La evolución recomendada está documentada en [ai-evolution-backlog-v1.md](ai-evolution-backlog-v1.md).
