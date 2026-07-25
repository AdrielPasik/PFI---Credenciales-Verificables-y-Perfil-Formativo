# AI HTTP Backend Integration v0

## 1. Resumen

El backend NestJS puede consumir el AI Service FastAPI mediante HTTP sin
importar ni ejecutar codigo Python:

```text
NestJS backend
-> AiServiceClient
-> FastAPI AI Service
-> artifact JSON versionado
-> validator backend
-> persistencia backend opcional
```

Este slice agrega un cliente y scripts internos. No agrega endpoints publicos
de IA, no cambia emision de credenciales y no conecta IA con blockchain.

El AI Service sigue viviendo en `Extractor Materias` y expone:

```text
GET  /health
POST /v1/semantic-analysis/pdf
POST /v1/formative-profile/build
```

Sus unicas respuestas contractuales de dominio son:

- `semantic_analysis_v1`;
- `formative_profile_result_v0`.

No devuelve payloads de frontend, `backend_formative_profile_snapshot_v0` ni
`credential_candidate_v1`.

## 2. Configuracion

Variables del backend:

```env
AI_SERVICE_BASE_URL=http://127.0.0.1:8000
AI_SERVICE_TIMEOUT_MS=60000
```

`AI_SERVICE_BASE_URL` es obligatoria. El timeout debe ser un entero positivo
y usa 60 segundos por default si no esta configurado.

El cliente no hace retries automaticos. En especial, no repite uploads o
procesamientos PDF pesados porque una repeticion silenciosa podria duplicar
trabajo y ocultar fallos operativos.

## 3. Componentes backend

### `AiServiceClient`

Responsabilidad exclusiva de transporte HTTP:

- health mediante `GET`;
- upload PDF mediante `FormData` y `Blob` nativos de Node;
- build de perfil mediante JSON;
- timeout y parseo de respuestas;
- errores HTTP con status y `detail` del AI Service.

No usa Axios, librerias multipart ni dependencias nuevas. No conoce Prisma,
usuarios, credenciales ni reglas de persistencia.

### `AiIntegrationService`

Orquesta validacion y asociacion backend:

- valida `semantic_analysis_v1` antes de persistir;
- usa `SemanticService.persistForCredential()` cuando se recibe
  `credentialId`;
- busca credenciales y sus ultimos analisis para construir perfiles;
- exige que cada credencial pertenezca al holder indicado;
- exige credenciales en estado `issued`;
- extrae el artifact original desde `SemanticAnalysis.analysisJson.artifact`;
- valida `formative_profile_result_v0`;
- usa `FormativeProfileService.persistAiArtifactForUser()`.

El AI Service nunca recibe ni decide `userId`, ownership, auth o permisos.

### `AiModule`

Registra y exporta el cliente y el servicio de integracion. No tiene
controller y no expone endpoints HTTP nuevos.

## 4. Ejecucion local

### Levantar AI Service

Desde `Extractor Materias`:

```powershell
.venv\Scripts\python.exe -m uvicorn src.api.main:app `
  --host 0.0.0.0 `
  --port 8000
```

El backend y el AI Service son procesos separados.

### Health

```powershell
$env:AI_SERVICE_BASE_URL = "http://127.0.0.1:8000"
$env:AI_SERVICE_TIMEOUT_MS = "60000"

npm run ai:health --workspace @credential-intelligence/api
```

Respuesta esperada:

```json
{
  "status": "ok",
  "service": "pfi-ai-service"
}
```

## 5. Flujo PDF a SemanticAnalysis

```text
PDF local
-> backend ai:analyze-pdf
-> multipart/form-data
-> FastAPI /v1/semantic-analysis/pdf
-> semantic_analysis_v1
-> validator backend
-> persistencia opcional en SemanticAnalysis
```

Solo analizar y validar:

```powershell
npm run ai:analyze-pdf --workspace @credential-intelligence/api -- `
  --file "C:\ruta\programa.pdf" `
  --documentId "backend-document-id"
```

Analizar y persistir para una credencial existente:

```powershell
npm run ai:analyze-pdf --workspace @credential-intelligence/api -- `
  --credentialId "<credential-id>" `
  --file "C:\ruta\programa.pdf" `
  --documentId "backend-document-id"
```

Argumentos opcionales:

```text
--fileName
--pipelineVersion
--taxonomyVersion
```

La respuesta del AI Service se valida con el validator backend existente.
Sin `credentialId`, el script imprime un resumen y no persiste. Con
`credentialId`, `SemanticService` verifica que la credencial exista y crea un
nuevo `SemanticAnalysis`.

Este flujo no modifica `Credential`, no emite credenciales, no recalcula
`canonicalHash` y no crea `BlockchainRecord`.

## 6. Flujo SemanticAnalysis a FormativeProfile

```text
credentialIds seleccionados
-> backend verifica subjectUserId y status issued
-> latest SemanticAnalysis por credencial
-> analysisJson.artifact
-> semantic_analysis_v1[]
-> FastAPI /v1/formative-profile/build
-> formative_profile_result_v0
-> validator backend
-> FormativeProfile current
```

Comando:

```powershell
npm run ai:build-profile --workspace @credential-intelligence/api -- `
  --userId "<holder-user-id>" `
  --fromCredentialIds "<credential-id-1>,<credential-id-2>"
```

Validaciones previas a llamar IA:

- al menos un ID;
- cada credencial existe;
- `Credential.subjectUserId` coincide con `userId`;
- la credencial esta `issued`;
- existe un `SemanticAnalysis`;
- el ultimo analisis conserva un `semantic_analysis_v1` valido en
  `analysisJson.artifact`.

El backend envia artifacts completos, no reconstrucciones desde columnas
parciales. La respuesta debe pasar el validator de
`formative_profile_result_v0` antes de persistirse.

`FormativeProfileService` asocia externamente el artifact al usuario,
desmarca perfiles current anteriores y crea un nuevo perfil con:

```text
profileVersion = formative_profile_result_v0
generationMethod = ai_artifact_ingest_v0
isCurrent = true
```

## 7. Manejo de errores

El cliente distingue:

- configuracion invalida o faltante;
- archivo PDF inexistente o ilegible;
- AI Service no disponible;
- timeout;
- respuesta no JSON o vacia;
- error HTTP.

Los status `400`, `409`, `422`, `500` y `503` se conservan dentro del error
del cliente. Cuando FastAPI devuelve un `detail` seguro, se incluye en el
mensaje para debugging local.

No existe fallback silencioso al rebuild backend. Si el AI Service falla, el
script falla y no persiste su respuesta.

## 8. Responsabilidades

### Backend NestJS

- identidad, auth y autorizacion;
- ownership de Credential;
- asociacion de artifacts a Credential/User;
- validacion contractual antes de persistir;
- PostgreSQL y seleccion de perfil current;
- canonicalizacion, emision y blockchain como flujos independientes.

### AI Service FastAPI

- procesamiento PDF;
- produccion de `semantic_analysis_v1`;
- agregacion de `formative_profile_result_v0`;
- validacion semantica propia del pipeline;
- procesamiento temporal sin persistencia de dominio.

El AI Service no consulta usuarios, credenciales, Firebase ni blockchain.

## 9. Firebase y Storage futuro

Firebase Storage u otro object storage podria guardar PDFs subidos por
frontend. No reemplaza al AI Service.

Un flujo futuro posible:

```text
frontend
-> backend autorizado
-> PDF en storage
-> backend obtiene stream/URL controlada
-> AI Service procesa
-> backend valida y persiste artifact
```

La descarga, autorizacion, limites y lifecycle del archivo siguen siendo
responsabilidad de backend/storage. La IA permanece como servicio separado.
Firebase no esta integrado en este slice.

## 10. Prueba manual validada

Se valido localmente:

```text
ai:health
-> status ok

PDF academico real liviano
-> ai:analyze-pdf sin credentialId
-> semantic_analysis_v1 partial
-> sin persistencia

dos credenciales issued del holder con SemanticAnalysis
-> ai:build-profile
-> formative_profile_result_v0
-> FormativeProfile current en PostgreSQL
```

Resultado del build:

```text
artifactCount: 2
areas: 1
skills: 1
concepts: 18
generationMethod: ai_artifact_ingest_v0
isCurrent: true
```

El analisis PDF sin `credentialId` no incremento `SemanticAnalysis`.
`Credential` y `BlockchainRecord` tampoco fueron modificados.

## 11. Limites actuales

- no hay endpoint backend para iniciar analisis desde frontend;
- los CLIs internos confian en el operador local;
- no hay auth service-to-service;
- no hay TLS, retries, circuit breaker ni observabilidad distribuida;
- no hay streaming backend-to-AI: el cliente carga el PDF local en memoria;
- no hay Firebase/Storage;
- no hay jobs, cola ni procesamiento asincronico;
- no hay idempotencia de artifacts o perfiles;
- no hay despliegue del AI Service;
- `online_course_catalog` no prueba completion;
- `formative_profile_result_v0` no participa en `canon_v1`;
- ningun perfil se escribe on-chain.

El siguiente paso razonable es estabilizar fixtures contractuales y luego
disenar un endpoint o job backend protegido, sin exponer FastAPI directamente
al frontend.
