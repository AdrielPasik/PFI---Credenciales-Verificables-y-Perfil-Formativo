# Runtime FastAPI y contratos de IA v1

## Runtime actual

El servicio está en `services/ai-service`. Se inicia sin rutas absolutas ni dependencia de un virtualenv específico:

```powershell
npm run dev --workspace @credential-intelligence/ai-service
# o
python -m src.api.run
```

`src/api/run.py` lee `PORT` y usa `8000` por defecto. El runtime HTTP es FastAPI/Uvicorn. Sus dependencias base son deliberadamente pequeñas:

- `fastapi`, `uvicorn`, `python-multipart` y `PyJWT` para el adaptador HTTP;
- `pdfplumber` con fallback `pypdf` para extraer PDF.

Las etapas de análisis de objetivos, unidades de evidencia, razonamiento
contextual y propuesta de requisitos usan clientes HTTP propios sobre la
Responses API de OpenAI. No requieren un SDK adicional: cada cliente usa la
biblioteca estándar y solo puede operar cuando su clave y modelo de etapa están
configurados. Si faltan, el servicio devuelve un error controlado sin inventar
un resultado.

La imagen del servicio instala además las dependencias de embeddings locales
(`torch`, `transformers` y el snapshot fijado de E5). El reranking híbrido de
áreas utiliza la configuración seleccionada en una campaña versionada sobre un
conjunto de referencia de 116 casos, dividido en desarrollo (77) y reserva
(39): `lambda=0,8` y margen relativo `0,0`. La reserva final obtuvo 66,7 %
Top-1 frente a 59,0 % de la línea base determinística, sin cambios perjudiciales.
La codificación de fuentes alimenta la persistencia de
representaciones de perfil de 384 dimensiones en NestJS. Ambas capacidades se
habilitan por separado mediante flags: el valor predeterminado no determina el
estado efectivo de un entorno desplegado.

No existe una base vectorial ni una búsqueda vectorial en el runtime.
`textForEmbedding` continúa siendo un dato interno: no es una API pública ni
una autorización para persistir o exponer texto adicional.

## Endpoints

| Método y ruta | Auth interna | Entrada | Resultado |
| --- | --- | --- | --- |
| `GET /health` | No | Ninguna | `{ status: "ok", service: "pfi-ai-service" }` |
| `POST /v1/semantic-analysis/pdf` | Sí en modo JWT | `multipart/form-data` con PDF | Artifact `semantic_analysis_v1` |
| `POST /v1/semantic-analysis/text` | Sí en modo JWT | JSON con texto y metadata mínima | Artifact `semantic_analysis_v1` |
| `POST /v1/formative-profile/build` | Sí en modo JWT | Lista de artifacts válidos | Artifact de perfil histórico `formative_profile_result_v0` |
| `POST /v1/profile-embedding/source` | Sí en modo JWT | Texto fuente ya autorizado | Vector local de fuente, si el flag está habilitado |
| `POST /v1/source-extraction/pdf` y `/text` | Sí en modo JWT | Fuente PDF o textual | Artifact `source_extraction_v1` |
| `POST /v1/objective-analysis` | Sí en modo JWT | Objetivo congelado | Artifact `objective_analysis_v1` |
| `POST /v1/evidence-units` | Sí en modo JWT | Fuentes extraídas de un run | Artifact `evidence_units_v1` |
| `POST /v1/contextual-reasoning` | Sí en modo JWT | Un requisito y evidencia direccionable | Resultado `contextual_reasoning_v1` |
| `POST /v1/objective-requirement-proposal` | Sí en modo JWT | Objetivo apto para interpretación | Propuesta `objective_requirement_proposal_v1` |

Los endpoints `/v1/*` son internos: no son una API pública para el navegador ni un contrato directo para apps externas. El profile builder FastAPI continúa disponible por compatibilidad/contrato, pero la reconstrucción operativa de perfil de Scope la realiza NestJS en PostgreSQL.

## Autenticación interna

### Modos

- `AI_INTERNAL_AUTH_MODE=disabled`: modo local. Permite tests y smoke local sin secretos. No se debe usar para demo cloud o producción.
- `AI_INTERNAL_AUTH_MODE=jwt`: exige configuración al iniciar, antes de aceptar tráfico de `/v1/*`.

El modo JWT valida un bearer HS256 con algoritmo fijo, `iss`, `aud`, `sub`, `iat`, `exp` y `jti`. El subject esperado es `traza-api`; el clock skew se limita a 0-300 segundos. El servicio rechaza secretos internos iguales a `JWT_SECRET` humano si esta variable existe.

Variables FastAPI, sin valores reales:

```dotenv
PORT=8000
AI_SERVICE_MAX_PDF_BYTES=26214400
AI_INTERNAL_AUTH_MODE=jwt
AI_INTERNAL_JWT_SECRET=<secret-interno-dedicado>
AI_INTERNAL_JWT_ISSUER=traza-api
AI_INTERNAL_JWT_AUDIENCE=traza-ai-service
AI_INTERNAL_JWT_CLOCK_SKEW_SECONDS=30
```

NestJS usa el par complementario:

```dotenv
AI_SERVICE_BASE_URL=<url-interna-o-https-del-servicio>
AI_SERVICE_TIMEOUT_MS=60000
AI_SERVICE_AUTH_MODE=jwt
AI_SERVICE_JWT_SECRET=<mismo-secreto-interno>
AI_SERVICE_JWT_ISSUER=traza-api
AI_SERVICE_JWT_AUDIENCE=traza-ai-service
AI_SERVICE_JWT_EXPIRES_IN_SECONDS=60
```

`AiServiceInternalAuth` construye un token nuevo por llamada. No incluye email, holder, permisos humanos, PDF ni contenido. `AiServiceClient` agrega el header solo para `/v1/*`; `GET /health` no lo necesita. No publicar estas variables en Vercel, `NEXT_PUBLIC_*`, capturas, logs o documentación de producto.

## Contrato PDF

El endpoint recibe:

```text
file                 PDF obligatorio
documentId           opcional, referencia opaca de correlación
fileName             opcional
pipelineVersion      opcional
taxonomyVersion      opcional
```

El servicio transmite el upload a un archivo temporal acotado y verifica:

- no está vacío;
- no supera `AI_SERVICE_MAX_PDF_BYTES` (25 MiB por defecto);
- el encabezado contiene `%PDF-`;
- las versiones solicitadas, si existen, coinciden con las expuestas.

No persiste el archivo ni conoce S3. NestJS lee bytes mediante `DocumentStoragePort` y los entrega para una ejecución concreta. Un error de tipo, tamaño o versión se devuelve como `400` o `409`; un PDF que no puede procesarse se devuelve como `422`.

## Contrato de texto

El JSON de `/v1/semantic-analysis/text` usa `extra="forbid"` y tiene este shape conceptual:

```json
{
  "content": "texto formativo no vacío, hasta 30000 caracteres",
  "metadata": {
    "platformName": "opcional",
    "hours": 0,
    "modality": "opcional",
    "credentialType": "opcional",
    "languageHint": "opcional"
  },
  "sourceRefs": {
    "textEvidenceId": "referencia opaca opcional",
    "credentialId": "referencia opaca opcional"
  },
  "requestedPipelineVersion": "opcional",
  "requestedTaxonomyVersion": "opcional"
}
```

El contenido se normaliza y es el único texto analizable. `metadata` se mantiene separada para evitar que plataforma, modalidad u horas fabriquen una clasificación o distribución horaria. `externalUrl` no es parte del contrato y el servicio no realiza fetch de URLs.

Un texto menor a 400 caracteres o sin secciones curriculares detectables puede producir resultado `partial`, flags y confianza limitada; no es un fallo técnico por sí mismo.

## Artifact `semantic_analysis_v1`

El exporter en `src/exporters/backend_contract` produce un artifact versionado. El validador NestJS es la segunda barrera antes de persistirlo. Sus bloques conceptuales son:

| Bloque | Uso |
| --- | --- |
| `schema`, `status`, `pipelineVersion`, `taxonomyVersion` | Compatibilidad y trazabilidad. |
| `sourceRefs` | Correlación de fuente, no UI pública. |
| `areas`, `skills`, `concepts`, `competencies`, `learningOutcomes` | Interpretación semántica allowlisted. |
| `hoursDistribution` | Estimación cuando hay evidencia suficiente; no reemplaza horas oficiales. |
| `confidence`, `qualityFlags`, `warnings`, `partialReasons` | Cobertura y prudencia, no validación académica. |
| `evidenceMap`, `textForEmbedding` | Persistencia/control interno; no exponer crudo al browser o verificador. |

`status=completed` indica que el pipeline obtuvo un artifact usable conforme a sus reglas; `partial` indica cobertura limitada pero potencialmente útil para revisión. `failed` no se aprueba ni se presenta como resultado semántico.

## Pipeline determinista

```text
PDF o texto
  -> extracción PDF (pdfplumber, fallback pypdf) cuando corresponde
  -> normalización Unicode/espacios/acentos
  -> detección de secciones y frases
  -> matching de taxonomías, perfiles de área y patrones de skill
  -> scoring, anclas y controles de cobertura
  -> exporter semantic_analysis_v1
```

La semántica determinista vive principalmente en:

- `src/semantic_builder.py`;
- `src/semantic_ontology.py`;
- `src/section_detector.py`;
- `config/semantic/area_profiles.json`;
- `config/semantic/domain_concept_lexicon.json`;
- `config/semantic/name_area_hints.json`;
- `config/semantic/area_anchor_requirements.json`;
- `config/semantic/skill_evidence_patterns.json`.

No introducir traducción libre ni sustituir estas reglas por un modelo generativo
en un ajuste de taxonomía sin fixtures, métricas y una decisión explícita de
contrato. Las etapas asistidas por proveedor tienen contratos y validaciones
propios; no reemplazan el pipeline determinista de clasificación.

## Errores y observabilidad

FastAPI devuelve errores HTTP normales; NestJS los traduce a errores internos con códigos como `unavailable`, `timeout`, `invalid_response` o `http`. El `AnalysisRunExecutionService` persiste solo `errorCode` y `errorMessage` saneados para el lifecycle del run. No debe persistir ni devolver token interno, headers `Authorization`, URL/host de FastAPI, PDF, texto, `analysisJson` crudo, storage keys, rutas locales, secrets ni stack traces upstream.

En cloud puede aparecer `502` de gateway/cold start antes de recibir JSON. Eso se clasifica como respuesta inválida/upstream no disponible según la capa que lo detecte y no debe confundirse con una baja calidad semántica.

## Comandos de desarrollo

```powershell
npm run python:check --workspace @credential-intelligence/ai-service
npm run test --workspace @credential-intelligence/ai-service
npm run test:api --workspace @credential-intelligence/ai-service
npm run test:schemas --workspace @credential-intelligence/ai-service
npm run docker:build --workspace @credential-intelligence/ai-service
```

El build Docker es opcional si Docker/daemon no están disponibles. Los tests de schemas deben validar artifacts producidos por el pipeline actual, no solo fixtures estáticos.
