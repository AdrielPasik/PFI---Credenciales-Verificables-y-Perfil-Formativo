# Evolución segura del subsistema de IA v1

## Principio de evolución

La prioridad es mejorar evidencia, trazabilidad y calidad medible sin convertir la IA en autoridad académica ni introducir datos sensibles en fronteras incorrectas. Cada slice debe empezar por una hipótesis comprobable, una fixture representativa y una regresión negativa; no por un cambio de copy o de modelo aislado.

## Estado y deuda conocida

| Tema | Implementado hoy | Deuda / siguiente paso seguro |
| --- | --- | --- |
| PDF | Análisis automático best-effort de PDF vigente. | OCR/formatos adicionales solo con límites y pruebas. |
| Texto course/certification | Generación controlada desde datos declarados y análisis automático sin PDF. | Ajustar cobertura con fixtures reales sanitizadas. |
| Texto academic/degree | No hay automatismo equivalente. | Diseñar fuente y reglas específicas antes de habilitarlo. |
| Combined | Enum y modelo preparados. | Definir dos fuentes, dedupe, weighting y contrato antes de ejecutar. |
| Taxonomía | Reglas deterministas, incluidos patrones ágiles. | Métricas por dominio, revisión de falsos positivos/negativos. |
| Embeddings | Solo `textForEmbedding` preparado. | Elegir modelo, almacenamiento, versionado, privacidad y evaluación. |
| Profile | Rebuild determinista post-emisión/análisis. | Observabilidad de generaciones y UX de cobertura. |
| Templates | Interpretación revisada reusable permitida. | Aplicación a futuras credenciales/C4b solo con reglas de provenance. |
| Cloud | HTTPS público temporal + JWT interno. | Servicio privado/no spin-down, rate limiting y observabilidad. |

## Orden sugerido para evolución

### 1. Medición y regresión antes de cambiar taxonomía

Crear un corpus pequeño, versionado y sanitizado de entradas representativas. Para cada fixture, definir áreas, skills/concepts esperados, flags y límites de falsos positivos. Incluir contraejemplos. El caso Scrum/Kanban debe coexistir con casos de comunicación/humanidades para impedir overfitting.

No usar documentos personales, PDFs productivos, datos de alumnos o outputs de cloud como fixtures versionadas.

### 2. Calidad de clasificación por dominio

Al ajustar una taxonomía:

1. localizar términos en perfiles, anclas, lexicón y patrones;
2. identificar qué regla actual produjo el resultado;
3. corregir la señal general más pequeña posible;
4. añadir test positivo y negativo;
5. registrar el cambio de `taxonomyVersion` si cambia semánticamente el contrato/interpretación;
6. verificar no degradar dominios técnicos existentes.

Evitar un `if title == ...`, traducir etiquetas con LLM o crear áreas nuevas sin criterio de taxonomía.

### 3. Observabilidad y operación

Conservar diagnósticos seguros por run: etapa, código, status upstream y duración cuando exista. Para cloud, distinguir disponibilidad/cold start o gateway, timeout, rechazo del JWT interno, fuente inválida, artifact no compatible y fallo de persistencia/rebuild.

No loguear PDF, texto, token, URL del servicio, storage key, header de autorización ni stack trace crudo. Un dashboard/alerta futura debe operar sobre códigos y métricas agregadas.

### 4. Combined y análisis textual adicional

No habilitar `combined` mediante concatenación local. Antes de hacerlo se debe definir:

- que haya exactamente un documento actual y un texto actual;
- source snapshots y hashes para ambos;
- política de deduplicación de conceptos y skills;
- cómo ponderar evidencia documental vs textual;
- contrato de artifact y quality flags;
- operación de reintento y perfil posterior;
- tests de fuente reemplazada y errores parciales.

El análisis textual para otros tipos de credencial requiere primero declarar qué campos forman una fuente fiable y cuáles deben excluirse. No reutilizar el constructor de `course` por conveniencia.

### 5. Embeddings o componentes generativos

Antes de añadir embeddings, LLM o RAG, resolver explícitamente:

- consentimiento y clasificación de los datos enviados;
- proveedor/modelo, versión, región y retención;
- límite de contenido, redacción de PII y políticas de logging;
- storage de vectores, borrado, aislamiento por issuer/holder y costos;
- evaluación offline y métricas de recuperación/calidad;
- cómo se versiona el resultado y se mantiene reproducibilidad;
- fallback seguro cuando el proveedor no está disponible.

Un modelo generativo debe producir propuestas revisables, no escribir automáticamente credenciales, competencias emitidas, hash canónico o perfil sin reglas de aprobación claras.

## Cambios que requieren una decisión de dominio previa

No implementar como “mejora IA” aislada:

- exigir IA o PDF para emitir todas las credenciales;
- hacer que un análisis cambie `issued`, `revoked` o `canonicalHash`;
- usar una habilidad inferida como competencia declarada por emisor;
- hacer públicas evidencias o artifacts para el verificador;
- aplicar automáticamente snapshots aprobados de templates a credenciales nuevas o perfiles;
- analizar credenciales issued desde el endpoint manual draft-only;
- persistir `AnalysisRunSource` con ambas fuentes o sin ninguna;
- usar `canonicalHash` como identificador de una fuente o perfil.

## Matriz de validación por tipo de cambio

| Cambio | Validaciones mínimas |
| --- | --- |
| Taxonomía/patrones | Pytest de semantic builder, fixtures positivo/negativo, schema artifact. |
| Contrato FastAPI | `test:api`, `test:schemas`, validación Nest de artifact y cliente. |
| Lifecycle NestJS | Tests `analysis-run`, execution, issuer run read y protected issuance. |
| Perfil | Tests de `FormativeProfileService`, isCurrent único y separación emitted/inferred. |
| Texto automático | Tests del builder de contenido, automático course/certification y no rollback de emisión. |
| Cloud/auth | Tests JWT internos, health, smoke sanitizado y ausencia de secreto en logs. |

Comandos comunes:

```powershell
npm run test --workspace @credential-intelligence/ai-service
npm run test:schemas --workspace @credential-intelligence/ai-service
npm run test:analysis-run --workspace @credential-intelligence/api
npm run test:analysis-run-execution --workspace @credential-intelligence/api
npm run test:protected-issuance --workspace @credential-intelligence/api
npm run build --workspace @credential-intelligence/api
```

## Checklist de seguridad para otro chat

Antes de editar, responder explícitamente:

1. ¿El cambio toca input, artifact, persistencia, perfil o solo taxonomía?
2. ¿Qué datos exactos cruzan NestJS -> FastAPI y cuáles quedan excluidos?
3. ¿Qué ocurre si FastAPI falla, devuelve HTML/502, expira JWT o tarda más que el timeout?
4. ¿Se conserva la emisión aunque el análisis falle?
5. ¿Hay una fuente actual exacta y se guarda su hash?
6. ¿El read model nuevo expone un artifact, texto, path o secreto por error?
7. ¿La UI diferencia información declarada de inferencia IA?
8. ¿Hay test de regresión semántica y un caso negativo cercano?
9. ¿La propuesta afecta `canon_v1`, blockchain, verificadores o privacidad?

Si la respuesta a la última pregunta es sí, el cambio no es un slice IA local: requiere revisión de dominio, seguridad y contratos.

## Prueba manual de referencia

Para probar el flujo textual actual sin PDF:

1. crear/editar una credential `course` con título, descripción, competencias y contenido adicional suficientes;
2. usar un ejemplo de gestión ágil con Scrum, Kanban, backlog, sprint, planificación y mejora continua;
3. emitirla;
4. confirmar que no se exige PDF ni se muestra que el análisis textual quedó pendiente;
5. consultar el último `AnalysisRun` y confirmar análisis textual automático;
6. verificar que el área principal no sea Comunicación y Humanidades para ese contenido;
7. abrir el perfil del titular y confirmar una generación actualizada, con datos declarados e inferencias presentados por separado.

No usar documentos reales ni publicar IDs, tokens, URLs cloud o contenido de evidencia al registrar el resultado de la prueba.
