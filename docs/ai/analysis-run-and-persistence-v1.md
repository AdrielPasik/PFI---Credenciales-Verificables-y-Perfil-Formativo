# AnalysisRun, persistencia y automatismos v1

## Propósito

NestJS controla el lifecycle de un análisis. FastAPI es un motor de transformación de contenido, no la autoridad de fuentes, permisos ni persistencia. Esta separación evita analizar evidencia incorrecta, persistir artifacts incompatibles o exponer contenido sensible.

## Modelo persistido relevante

### `AnalysisRun`

Representa una solicitud/ejeución individual. Campos relevantes:

- `credentialId`;
- `requestedByUserId`: requerido para trigger `manual`; puede ser `null` para trigger `system`;
- `status`: `pending`, `running`, `completed` o `failed`;
- `inputMode`: `document`, `text` o `combined`;
- `trigger`: `manual` o `system`;
- versiones solicitadas de pipeline y taxonomía;
- timestamps de inicio, fin o fallo;
- `errorCode` y `errorMessage` saneados.

### `AnalysisRunSource`

Congela la fuente exacta usada en un run:

- `documentEvidenceId` nullable;
- `textEvidenceId` nullable;
- `sourceType`, `sourceSha256`, `sourceLabel`, `sourceStatusAtRun`.

Existe una regla de aplicación obligatoria: exactamente una FK debe existir, `documentEvidenceId XOR textEvidenceId`. Prisma tiene uniques por `analysisRunId + documentEvidenceId` y por `analysisRunId + textEvidenceId`, pero la exclusión mutua se valida en servicio. No se debe asumir que el schema por sí solo la aplica.

### `SemanticAnalysis`

Persistencia normalizada del artifact validado. Conserva `status`, versiones, confianza, `areas`, `skills`, `concepts`, `qualityFlags`, `evidenceMap`, `textForEmbedding` y opcionalmente `analysisJson`. Estos últimos tres campos son internos: no son un DTO de frontend ni una respuesta pública.

### Evidencias

- `DocumentEvidence` conserva metadata, SHA-256, provider y `storageKey`. Los bytes se obtienen solo por el `DocumentStoragePort` interno.
- `TextEvidence` conserva texto, SHA-256, label y estado `current/replaced`.
- La fuente de un análisis debe tener hash y estado capturados al crear el run.

## Lifecycle de ejecución

```text
Autorización + fuente permitida
  -> createPendingRun()
  -> AnalysisRun pending + AnalysisRunSource exacta
  -> claim atómico pending -> running
  -> lectura controlada de bytes o texto
  -> AiServiceClient
  -> validateSemanticAnalysisArtifact()
  -> persist SemanticAnalysis + marcar completed

En fallo:
  -> marcar failed con error seguro
  -> no borrar evidencia ni cambiar el estado de la credencial
```

`AnalysisRunExecutionService` implementa caminos específicos para PDF y texto. No convertirlos en un método genérico que acepte content arbitrario desde HTTP: la fuente debe seguir resolviéndose desde evidencia persistida y scoping institucional.

## Reglas manuales y de sistema

| Operación | Estado permitido de Credential | Trigger | Observación |
| --- | --- | --- | --- |
| Endpoint manual documental issuer | `draft` | `manual` | Conserva la regla draft-only. |
| Lectura de runs issuer | `draft`, `issued`, `revoked` | N/A | Histórica y read-only. |
| Documento automático post-emisión | `issued` | `system` | Solo PDF vigente. |
| Texto automático post-emisión | `issued` | `system` | Solo `course`/`certification` sin PDF vigente. |
| `combined` | No ejecutable hoy | N/A | Rechazado explícitamente. |

Permitir un trigger manual en `issued` o `revoked` sería un cambio de dominio y no debe hacerse como efecto secundario de una mejora de UI.

## Documento automático

`AutomaticDocumentAnalysisService` se invoca después de una emisión exitosa. Busca PDF actual elegible, evita duplicar una ejecución equivalente y delega la creación/ejecución al lifecycle existente. La lectura de bytes ocurre mediante el adapter de storage; FastAPI no conoce `storageKey`, bucket ni credenciales S3.

El análisis no está dentro de la transacción de emisión. Si storage, FastAPI, JWT interno, timeout o artifact fallan, la credencial sigue `issued` y el run puede quedar `failed` con diagnóstico seguro.

## Texto automático para course y certification

`AutomaticCourseTextAnalysisService` cubre ambos tipos por compatibilidad de nombre de clase. Solo actúa tras emitir y cuando no existe PDF actual. Su orden de fuente es:

1. reutilizar `TextEvidence.current` existente;
2. si no existe, construir texto controlado desde campos declarados;
3. si no hay señal formativa suficiente, no crear evidencia ni run.

El texto generado se normaliza y queda etiquetado como fuente del sistema. No se copia desde una `SemanticAnalysis` anterior ni desde snapshot reusable.

### Campos admitidos por tipo

| Tipo | Campos que entran en contenido | Campos excluidos deliberadamente |
| --- | --- | --- |
| `course` | título, descripción, competencias, resultados de aprendizaje/contenido adicional | plataforma, proveedor, modalidad, URL externa, referencias curriculares, IDs, blockchain, snapshots y análisis previos |
| `certification` | título, descripción, código, vencimiento, proveedor, nivel, skills y competencias declaradas | plataforma, modalidad, URL externa, referencias curriculares, IDs, blockchain, snapshots y análisis previos |

Para ambos tipos hay un umbral mínimo de 30 caracteres y una regla de suficiencia: título o descripción como base, más descripción suficiente o dos fuentes formativas. El objetivo es evitar ejecutar IA sobre un nombre aislado sin contexto, no exigir PDF.

## Idempotencia

Los automatismos consultan runs existentes para la misma credencial/fuente y evitan duplicados. En el flujo textual automático, cualquier estado previo `pending`, `running`, `completed` o `failed` para la misma `TextEvidence` bloquea una nueva creación automática durante la emisión. Esto evita loops y reintentos invisibles; no sustituye una futura política explícita de reintento.

## Perfil post-análisis

Tras una ejecución automática exitosa, el servicio llama a `AutomaticProfileRebuildService.rebuildAfterAutomaticAnalysis()`. Este wrapper llama `FormativeProfileService.rebuildForUser(holderUserId)` y atrapa errores para preservar la semántica best-effort.

También hay reconstrucción baseline inmediatamente después de emitir. Por eso el titular recibe al menos un perfil que incorpore la credencial emitida aunque no se genere análisis; un rebuild posterior enriquece ese perfil si la IA completa correctamente.

Si un rebuild falla, se emite un log estructurado seguro con `errorCode=formative_profile_rebuild_failed`, motivo y referencias internas operativas. No se registra texto, PDF, artifact crudo, secreto o excepción upstream completa.

## Errores que conviene diagnosticar

| Síntoma | Punto a revisar |
| --- | --- |
| Run `failed` antes de IA | Fuente no vigente, MIME no PDF, XOR inválido, autorización o lock de run. |
| `ai_unavailable`/timeout | URL/configuración, cold start, gateway o disponibilidad de FastAPI. |
| `ai_invalid_response` | Respuesta no JSON o artifact incompatible; revisar logs saneados y contrato. |
| No hay run tras emitir course/certification | PDF vigente con prioridad, contenido insuficiente o run equivalente ya existente. |
| Hay run completed, pero profile parece viejo | Verificar `AutomaticProfileRebuildService`, `FormativeProfile.isCurrent`, endpoint `/me/profile/current` y cache de UI. |
| Perfil no muestra una inferencia | Verificar separación de emitted vs inferred y que exista `SemanticAnalysis` usable del credential. |

No diagnosticar leyendo directamente secretos o imprimiendo contenido de evidencia. Para cloud, correlacionar `AnalysisRun.errorCode`, etapa, status HTTP y timestamps con logs sanitizados de NestJS/FastAPI.

## Endpoints issuer de lectura

Los endpoints P5 de issuer exponen estados y resúmenes allowlisted. `latest` devuelve `null` si no hay runs para una credencial que pertenece al issuer; una lectura no exige `draft`. El endpoint por id devuelve `404` seguro si el run no corresponde a esa credencial o issuer. Ninguno debe devolver `analysisJson`, `textForEmbedding`, `evidenceMap` completo, texto fuente, rutas de storage ni errores upstream crudos.

## Pruebas mínimas cuando se modifique este flujo

```powershell
npm run test:analysis-run --workspace @credential-intelligence/api
npm run test:analysis-run-execution --workspace @credential-intelligence/api
npm run test:issuer-analysis-run --workspace @credential-intelligence/api
npm run test:issuer-analysis-run-read --workspace @credential-intelligence/api
npm run test:protected-issuance --workspace @credential-intelligence/api
```

Agregar pruebas de no regresión para fuente exacta, status de run, ausencia de duplicados, no rollback de emisión y no exposición de artifacts crudos.
