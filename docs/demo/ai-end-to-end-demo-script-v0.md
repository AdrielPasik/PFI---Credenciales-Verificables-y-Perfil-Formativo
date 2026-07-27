# AI End-to-End Demo Script v0

## 1. Objetivo

Este guion valida el flujo real de demo:

```text
PostgreSQL
-> Backend NestJS
-> AI Service FastAPI
-> login issuer y holder
-> Credential issued
-> PDF analizado por IA
-> SemanticAnalysis persistido
-> perfil IA construido
-> FormativeProfile current persistido
-> lectura holder
-> verificacion publica
```

El frontend no participa todavia. Todas las llamadas se hacen contra NestJS;
solo el backend llama a FastAPI.

## 2. Prerrequisitos

- Docker Desktop disponible;
- Node.js y dependencias npm instaladas;
- Python virtualenv del modulo `Extractor Materias`;
- `services/api/.env` local, no versionado;
- migraciones existentes aplicadas;
- seed demo ejecutado;
- un PDF academico liviano.

Rutas de referencia:

```powershell
$repoRoot = "C:\ruta\PFI---Credenciales-Verificables-y-Perfil-Formativo"
$aiRoot = "C:\ruta\Extractor Materias"
$apiBaseUrl = "http://127.0.0.1:3000"
$aiBaseUrl = "http://127.0.0.1:8000"
$pdfPath = "C:\ruta\programa-academico.pdf"
```

Variables backend esperadas:

```env
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/credential_intelligence
JWT_SECRET=<secreto-local-no-productivo>
JWT_EXPIRES_IN=1h
AI_SERVICE_BASE_URL=http://127.0.0.1:8000
AI_SERVICE_TIMEOUT_MS=60000
BLOCKCHAIN_EVIDENCE_MODE=mock
```

`services/api/.env.example` es la referencia. Nunca versionar `.env`.

## 3. Preparar PostgreSQL

Desde la raiz del repo principal:

```powershell
Set-Location $repoRoot

docker compose -f infra/docker/docker-compose.postgres.yml up -d
docker compose -f infra/docker/docker-compose.postgres.yml ps
```

El contenedor esperado es:

```text
credential-intelligence-postgres
```

Para una base nueva, aplicar las migraciones versionadas existentes:

```powershell
npx prisma migrate deploy --schema services/api/prisma/schema.prisma
```

No ejecutar `migrate dev --name ...` durante la demo: ese comando crea una
nueva migracion y no es necesario para este flujo.

Ejecutar el seed idempotente:

```powershell
npm run prisma:seed --workspace @credential-intelligence/api
```

El seed crea:

```text
Issuer Admin: issuer.admin@example.com / DemoIssuer123!
Demo Holder:  holder.demo@example.com / DemoHolder123!
Issuer:       Demo University
```

## 4. Levantar AI Service

Abrir una terminal PowerShell separada:

```powershell
Set-Location $aiRoot

.\.venv\Scripts\python.exe -m uvicorn src.api.main:app `
  --host 0.0.0.0 `
  --port 8000
```

Validar health:

```powershell
Invoke-RestMethod -Uri "$aiBaseUrl/health" -Method Get |
  ConvertTo-Json -Depth 10
```

Respuesta esperada:

```json
{
  "status": "ok",
  "service": "pfi-ai-service"
}
```

Este health solo comprueba que FastAPI responde. No ejecuta el pipeline.

## 5. Levantar backend NestJS

Abrir otra terminal PowerShell:

```powershell
Set-Location $repoRoot

$env:PORT = "3000"
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/credential_intelligence"
$env:JWT_SECRET = "demo-local-secret-change-me"
$env:JWT_EXPIRES_IN = "1h"
$env:AI_SERVICE_BASE_URL = "http://127.0.0.1:8000"
$env:AI_SERVICE_TIMEOUT_MS = "60000"
$env:BLOCKCHAIN_EVIDENCE_MODE = "mock"

npm run dev --workspace @credential-intelligence/api
```

Validar:

```powershell
Invoke-RestMethod -Uri "$apiBaseUrl/health" -Method Get
```

`BLOCKCHAIN_EVIDENCE_MODE=mock` mantiene la demo autocontenida. Para usar
`credential_registry_anvil` se necesita Anvil, contrato desplegado, direccion
del contrato y private key local; ese flujo no es requisito de esta demo IA.

## 6. Login issuer y holder

En una tercera terminal PowerShell:

```powershell
$apiBaseUrl = "http://127.0.0.1:3000"

$issuerLoginBody = @{
  email = "issuer.admin@example.com"
  password = "DemoIssuer123!"
} | ConvertTo-Json

$issuerLogin = Invoke-RestMethod `
  -Uri "$apiBaseUrl/auth/login" `
  -Method Post `
  -ContentType "application/json" `
  -Body $issuerLoginBody

$issuerToken = $issuerLogin.accessToken

$holderLoginBody = @{
  email = "holder.demo@example.com"
  password = "DemoHolder123!"
} | ConvertTo-Json

$holderLogin = Invoke-RestMethod `
  -Uri "$apiBaseUrl/auth/login" `
  -Method Post `
  -ContentType "application/json" `
  -Body $holderLoginBody

$holderToken = $holderLogin.accessToken
$holderUserId = $holderLogin.user.id
```

Obtener el issuer habilitado para el admin:

```powershell
$issuerMe = Invoke-RestMethod `
  -Uri "$apiBaseUrl/auth/me" `
  -Method Get `
  -Headers @{ Authorization = "Bearer $issuerToken" }

$issuerId = $issuerMe.issuerMemberships[0].issuerId
```

No imprimir ni guardar tokens en archivos versionados.

## 7. Elegir o crear una credencial

### Opcion A: reutilizar una credencial issued

Listar la wallet del holder:

```powershell
$holderCredentials = Invoke-RestMethod `
  -Uri "$apiBaseUrl/me/credentials" `
  -Method Get `
  -Headers @{ Authorization = "Bearer $holderToken" }

$credential = @($holderCredentials) |
  Where-Object {
    $_.status -eq "issued" -and $_.issuer.id -eq $issuerId
  } |
  Select-Object -First 1

$credentialId = $credential.id
```

Si `$credentialId` queda vacio, usar la opcion B.

### Opcion B: crear draft y emitir

Crear draft:

```powershell
$draftBody = @{
  issuerId = $issuerId
  subjectUserId = $holderUserId
  type = "academic_subject"
  title = "Introduccion a la Bioinformatica"
  description = "Credencial creada para la demo IA end-to-end."
  sourceType = "academic_pdf"
  hours = 64
  credentialSubject = @{
    achievement_name = "Introduccion a la Bioinformatica"
    institution_name = "Demo University"
  }
} | ConvertTo-Json -Depth 20

$draft = Invoke-RestMethod `
  -Uri "$apiBaseUrl/credentials/draft" `
  -Method Post `
  -ContentType "application/json" `
  -Body $draftBody

$credentialId = $draft.id
```

En el estado actual, `POST /credentials/draft` todavia es publico. Es una
limitacion demo-grade que debe corregirse antes de un frontend productivo.

Emitir con el issuer admin:

```powershell
$issueBody = @{
  issuerId = $issuerId
} | ConvertTo-Json

$issuedCredential = Invoke-RestMethod `
  -Uri "$apiBaseUrl/credentials/$credentialId/issue" `
  -Method Post `
  -Headers @{ Authorization = "Bearer $issuerToken" } `
  -ContentType "application/json" `
  -Body $issueBody

$issuedCredential.status
$issuedCredential.canonicalHash
$issuedCredential.canonicalizationVersion
```

Aunque `issuerId` sigue en el body por compatibilidad, no es fuente de
autoridad. El backend usa `Credential.issuerId` persistido y valida
`IssuerMembership`.

## 8. Analizar PDF como issuer

Windows PowerShell 5.1 no soporta `Invoke-RestMethod -Form`. Usar `curl.exe`
evita diferencias entre PowerShell 5.1 y PowerShell 7:

```powershell
$documentId = "demo-$credentialId"

$analysisJson = curl.exe -sS -X POST `
  "$apiBaseUrl/credentials/$credentialId/semantic-analysis/from-pdf" `
  -H "Authorization: Bearer $issuerToken" `
  -F "file=@$pdfPath;type=application/pdf" `
  -F "documentId=$documentId"

if ($LASTEXITCODE -ne 0) {
  throw "Fallo curl.exe al enviar el PDF."
}

$analysis = $analysisJson | ConvertFrom-Json
$analysis | ConvertTo-Json -Depth 20
```

Reglas:

- requiere token de `admin` u `operator` con membresia activa;
- usa el issuer persistido de la credencial;
- no acepta `issuerId` externo;
- PDF maximo de 20 MB en NestJS;
- valida MIME y header PDF;
- devuelve resumen, no el artifact completo;
- valida `semantic_analysis_v1` antes de persistir.

Comprobar la persistencia:

```powershell
$latestSemantic = Invoke-RestMethod `
  -Uri "$apiBaseUrl/credentials/$credentialId/semantic-analysis/latest" `
  -Method Get

$latestSemantic.latestSemanticAnalysis.id
$latestSemantic.latestSemanticAnalysis.schemaVersion
```

## 9. Construir perfil IA como holder

```powershell
$profileBuildBody = @{
  credentialIds = @($credentialId)
} | ConvertTo-Json -Depth 10

$builtProfile = Invoke-RestMethod `
  -Uri "$apiBaseUrl/me/profile/build-from-ai" `
  -Method Post `
  -Headers @{ Authorization = "Bearer $holderToken" } `
  -ContentType "application/json" `
  -Body $profileBuildBody

$builtProfile.currentProfile |
  Select-Object id, profileVersion, isCurrent, credentialsCount, totalHours
```

El backend:

- toma `userId` exclusivamente del JWT;
- valida ownership de cada credencial;
- exige estado `issued`;
- exige un ultimo `SemanticAnalysis`;
- envia artifacts validados al AI Service;
- valida `formative_profile_result_v0`;
- crea un nuevo `FormativeProfile` current.

Resultado esperado:

```text
profileVersion   formative_profile_result_v0
isCurrent        True
```

## 10. Consultar perfil current

```powershell
$currentProfile = Invoke-RestMethod `
  -Uri "$apiBaseUrl/me/profile/current" `
  -Method Get `
  -Headers @{ Authorization = "Bearer $holderToken" }

$currentProfile.currentProfile.profileVersion
$currentProfile.currentProfile.isCurrent
$currentProfile.currentProfile.areasSummary
$currentProfile.currentProfile.skillsSummary
$currentProfile.currentProfile.profileJson
```

El ID debe coincidir con el perfil creado en el paso anterior.

## 11. Verificacion publica

```powershell
$verification = Invoke-RestMethod `
  -Uri "$apiBaseUrl/verify/credentials/$credentialId" `
  -Method Get

$verification |
  Select-Object credentialId, verificationStatus

$verification.blockchain.records
$verification.semanticAnalysis.latest
```

Con credencial `issued`, hash, `canon_v1` y un `BlockchainRecord` registrado,
el estado esperado es `valid`. El endpoint actual consulta evidencia
persistida; no llama al contrato en tiempo real.

## 12. Checks de seguridad

### Sin token: `401`

```powershell
curl.exe -sS -o NUL -w "%{http_code}" -X POST `
  "$apiBaseUrl/credentials/$credentialId/semantic-analysis/from-pdf" `
  -F "file=@$pdfPath;type=application/pdf"
```

### Holder intentando operar para issuer: `403`

```powershell
curl.exe -sS -o NUL -w "%{http_code}" -X POST `
  "$apiBaseUrl/credentials/$credentialId/semantic-analysis/from-pdf" `
  -H "Authorization: Bearer $holderToken" `
  -F "file=@$pdfPath;type=application/pdf"
```

### Credencial de otro holder en build: `403`

Reemplazar el placeholder por una credencial `issued` de otro usuario:

```powershell
$otherHolderBody = @{
  credentialIds = @("<other-holder-credential-id>")
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri "$apiBaseUrl/me/profile/build-from-ai" `
  -Method Post `
  -Headers @{ Authorization = "Bearer $holderToken" } `
  -ContentType "application/json" `
  -Body $otherHolderBody
```

### Credencial sin SemanticAnalysis: `400`

Usar una credencial propia `issued` sin analisis persistido en
`credentialIds`.

### AI Service apagado: `503`

Detener FastAPI, mantener NestJS activo y repetir el upload. La respuesta
incluye:

```json
{
  "statusCode": 503,
  "error": "AI Service Error",
  "aiServiceCode": "unavailable"
}
```

Si falta `AI_SERVICE_BASE_URL`, `aiServiceCode` es `configuration`.

### Timeout: `504`

Para una prueba controlada, reiniciar el backend con un timeout muy bajo:

```powershell
$env:AI_SERVICE_TIMEOUT_MS = "1"
npm run dev --workspace @credential-intelligence/api
```

Repetir el upload y esperar `504` con `aiServiceCode = timeout`. Restaurar
`60000` despues. Este check no debe ejecutarse durante la demo principal.

## 13. Que no se modifica

El flujo IA:

- no cambia `Credential.status`;
- no emite credenciales;
- no recalcula `canonicalHash`;
- no cambia `canonicalizationVersion`;
- no toca `canon_v1`;
- no crea ni modifica `BlockchainRecord`;
- no llama clientes blockchain;
- no toca Solidity;
- no ejecuta Python dentro de NestJS;
- no permite que el frontend llame FastAPI directamente;
- no trata catalogos online como prueba de completion.

## 14. Cierre

Al terminar:

```powershell
docker compose -f infra/docker/docker-compose.postgres.yml ps
```

Detener manualmente NestJS y FastAPI con `Ctrl+C`. Si se desea apagar
PostgreSQL sin borrar datos:

```powershell
docker compose -f infra/docker/docker-compose.postgres.yml stop
```

No usar `down -v`: eliminaria el volumen local de PostgreSQL.
