# AI Frontend-Ready Flow v0

## 1. Resumen

El backend NestJS expone endpoints protegidos para usar el AI Service sin que
un frontend tenga acceso directo a FastAPI:

```text
Frontend futuro
-> Backend NestJS + JWT
-> validacion de permisos y ownership
-> AI Service FastAPI
-> artifact JSON versionado
-> validator backend
-> persistencia PostgreSQL
-> response segura al frontend
```

Este slice agrega transporte y orquestacion HTTP. No mueve logica de IA al
backend y no modifica emision, `canon_v1`, hashes ni evidencia blockchain.

## 2. Endpoints backend

### `POST /credentials/:id/semantic-analysis/from-pdf`

Analiza un PDF para una credencial existente.

Requiere:

- Bearer token valido;
- archivo multipart en el campo `file`;
- credencial existente;
- membresia activa del usuario sobre el issuer persistido de la credencial;
- rol institucional `admin` u `operator`.

No recibe ni confia en `issuerId` desde el body. El issuer se obtiene de
`Credential.issuerId`.

Campos multipart opcionales:

- `documentId`;
- `fileName`;
- `pipelineVersion`;
- `taxonomyVersion`.

El upload:

- se procesa en memoria;
- acepta un unico PDF;
- limita el archivo a 20 MB;
- valida MIME `application/pdf`;
- valida que exista el header `%PDF-` en los primeros 1024 bytes.

Flujo:

```text
PDF
-> CredentialAiController
-> AiIntegrationService
-> validacion IssuerMembership
-> AiServiceClient
-> POST FastAPI /v1/semantic-analysis/pdf
-> semantic_analysis_v1
-> validator backend
-> SemanticService.persistForCredential()
-> SemanticAnalysis
```

La respuesta es un resumen y no el artifact completo:

```json
{
  "credentialId": "credential-id",
  "semanticAnalysisId": "semantic-analysis-id",
  "analyzedAt": "2026-07-25T12:00:00.000Z",
  "schemaVersion": "semantic_analysis_v1",
  "status": "completed",
  "sourceType": "academic_pdf",
  "areasCount": 2,
  "skillsCount": 8,
  "conceptsCount": 12,
  "confidence": 0.84,
  "warnings": [],
  "qualityFlags": []
}
```

### `POST /me/profile/build-from-ai`

Construye el perfil IA del holder autenticado a partir de analisis ya
persistidos.

Body:

```json
{
  "credentialIds": [
    "credential-id-1",
    "credential-id-2"
  ]
}
```

El endpoint:

- obtiene `userId` exclusivamente desde el JWT;
- no acepta identidad del holder en path, query o body;
- exige que todas las credenciales existan;
- exige `Credential.subjectUserId === currentUser.id`;
- exige estado `issued`;
- exige un ultimo `SemanticAnalysis` por credencial;
- extrae `SemanticAnalysis.analysisJson.artifact`;
- revalida cada `semantic_analysis_v1`;
- llama al AI Service;
- valida `formative_profile_result_v0`;
- persiste un nuevo `FormativeProfile` current.

Flujo:

```text
credentialIds
-> ProfileAiController
-> AiIntegrationService
-> ownership + issued + latest SemanticAnalysis
-> semantic_analysis_v1[]
-> POST FastAPI /v1/formative-profile/build
-> formative_profile_result_v0
-> validator backend
-> FormativeProfileService.persistAiArtifactForUser()
-> FormativeProfile current
```

La respuesta usa el mismo contrato de `GET /me/profile/current`:

```text
CurrentProfileResponseDto
```

El perfil persistido usa:

```text
profileVersion = formative_profile_result_v0
generationMethod = ai_artifact_ingest_v0
```

## 3. Responsabilidades

### Frontend

- autentica al usuario contra NestJS;
- envia el Bearer token;
- sube el PDF al backend;
- envia solo los `credentialIds` seleccionados para su propio perfil;
- consume respuestas backend y nunca contratos internos de FastAPI.

### Backend NestJS

- autentica y autoriza;
- determina issuer y holder desde datos persistidos y JWT;
- valida ownership;
- llama al AI Service;
- valida artifacts versionados;
- asocia artifacts a `Credential` o `User`;
- persiste `SemanticAnalysis` y `FormativeProfile`;
- devuelve DTOs serializables y controlados.

### AI Service FastAPI

- procesa el PDF;
- produce `semantic_analysis_v1`;
- agrega artifacts y produce `formative_profile_result_v0`;
- no autentica usuarios del producto;
- no recibe ni decide `userId`;
- no persiste en PostgreSQL;
- no modifica credenciales ni blockchain.

## 4. Por que el frontend no llama directo a IA

El acceso directo desde frontend permitiria omitir reglas de dominio y
expondria detalles operativos del servicio IA. El backend conserva:

- autenticacion;
- permisos institucionales;
- ownership del holder;
- asociacion entre artifact y entidades internas;
- validacion contractual antes de persistir;
- una API estable aunque cambie el despliegue de FastAPI.

## 5. Ejemplos locales

Configuracion backend:

```env
AI_SERVICE_BASE_URL=http://127.0.0.1:8000
AI_SERVICE_TIMEOUT_MS=60000
```

Analisis PDF:

```bash
curl -X POST "http://127.0.0.1:3000/credentials/<credential-id>/semantic-analysis/from-pdf" \
  -H "Authorization: Bearer <issuer-user-token>" \
  -F "file=@<path-to-pdf>;type=application/pdf" \
  -F "documentId=<document-id>"
```

Build de perfil:

```bash
curl -X POST "http://127.0.0.1:3000/me/profile/build-from-ai" \
  -H "Authorization: Bearer <holder-token>" \
  -H "Content-Type: application/json" \
  -d "{\"credentialIds\":[\"<credential-id-1>\",\"<credential-id-2>\"]}"
```

## 6. Firebase o storage futuro

Firebase Storage u otro object storage puede almacenar PDFs enviados por el
frontend. No reemplaza al AI Service.

Un flujo futuro posible es:

```text
Frontend
-> storage
-> Backend recibe referencia autorizada
-> Backend descarga o transmite PDF
-> AI Service procesa
-> Backend valida y persiste
```

Esa etapa requerira reglas de acceso, validacion de tipo/tamano, expiracion de
URLs y limpieza de archivos. No esta implementada en v0.

## 7. Limites actuales

- no existe frontend en este slice;
- no se usa Firebase ni storage remoto;
- el PDF se mantiene temporalmente en memoria del proceso NestJS;
- no existe cola ni procesamiento asincronico;
- no hay idempotencia para evitar analisis repetidos;
- no hay endpoint de progreso de jobs;
- el AI Service debe estar disponible durante el request;
- no hay auth service-to-service entre NestJS y FastAPI;
- no se infiere completion desde `online_course_catalog`;
- no existe `credential_candidate_v1`;
- `formative_profile_result_v0` no participa en `canon_v1`;
- SemanticAnalysis y FormativeProfile no escriben evidencia on-chain.

## 8. Proximos pasos

1. Integrar estos endpoints desde un frontend web minimo.
2. Definir limites de upload y errores de UX segun PDFs reales de demo.
3. Agregar idempotencia o identificadores de job para analisis repetidos.
4. Evaluar storage temporal para evitar uploads grandes en memoria.
5. Agregar autenticacion interna entre backend y AI Service.
6. Migrar a jobs asincronicos solo cuando la demo sincrona este estable.
