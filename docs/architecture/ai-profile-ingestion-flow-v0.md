# AI Profile Ingestion Flow v0

## 1. Resumen ejecutivo

El sistema soporta una integracion real, local y controlada del perfil
formativo producido por el modulo IA:

```text
Extractor Materias/profile_builder
-> formative_profile_result_v0
-> backend profile:ingest:file
-> FormativeProfile en PostgreSQL
-> GET /me/profile/current
```

El flujo usa un artifact JSON versionado, validacion backend y asociacion
externa con un holder existente. Es suficiente para una demo reproducible,
pero todavia no es una API de IA ni un pipeline automatico productivo.

## 2. Estado actual implementado

Los contratos y metodos actuales tienen responsabilidades distintas:

- `semantic_analysis_v1` representa el analisis de una fuente o credencial;
- `formative_profile_result_v0` representa el perfil agregado real producido
  por `Extractor Materias/profile_builder`;
- `backend_formative_profile_snapshot_v0` es el fallback deterministico que
  el backend puede reconstruir desde `SemanticAnalysis` persistidos;
- `ai_artifact_ingest_v0` identifica perfiles persistidos desde el artifact
  IA real;
- `backend_deterministic_aggregation_v0` identifica snapshots fallback
  reconstruidos por backend.

`GET /me/profile/current` devuelve el perfil marcado como current sin
depender de su metodo de generacion. Actualmente `generationMethod` queda
persistido en PostgreSQL, aunque no se expone como campo top-level de esa
respuesta.

No se mezclan los shapes de `formative_profile_result_v0` y
`backend_formative_profile_snapshot_v0`, y ninguno participa en `canon_v1`.

## 3. Flujo actual de demo

El flujo manual es:

1. IA genera uno o mas artifacts `semantic_analysis_v1`.
2. `profile_builder` produce un `formative_profile_result_v0`.
3. El backend recibe un archivo JSON standalone.
4. El validator comprueba version, secciones y tipos principales.
5. El script recibe `userId` como contexto externo y verifica que el usuario
   exista.
6. Una transaccion Prisma desmarca perfiles current anteriores y crea un
   nuevo `FormativeProfile` con `isCurrent = true`.
7. El holder autenticado consulta `GET /me/profile/current`.

### Preparar PostgreSQL

```powershell
docker compose -f infra/docker/docker-compose.postgres.yml up -d
docker compose -f infra/docker/docker-compose.postgres.yml ps
```

### Obtener el holder demo

El seed actual crea `holder.demo@example.com`. Su ID puede consultarse sin
hardcodearlo:

```powershell
'SELECT id FROM "User" WHERE email=''holder.demo@example.com'' LIMIT 1;' |
  docker exec -i credential-intelligence-postgres `
    psql -U postgres -d credential_intelligence -t -A
```

### Extraer un artifact desde un report wrapper

El report real contiene un array `results`; cada entrada es un artifact
standalone. Para una prueba se puede extraer temporalmente la primera:

```powershell
$reportPath = "C:\ruta\Extractor Materias\reports\formative_profile_result_real_sample_v0.json"
$artifactPath = Join-Path $env:TEMP "formative_profile_result_v0.result-0.json"
$report = Get-Content -Raw -LiteralPath $reportPath | ConvertFrom-Json
$json = $report.results[0] | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText(
  $artifactPath,
  $json,
  (New-Object System.Text.UTF8Encoding($false))
)
```

El archivo temporal no debe versionarse y debe eliminarse al terminar.

### Ingerir el perfil

```powershell
npm run profile:ingest:file --workspace @credential-intelligence/api -- `
  --userId <holder-user-id> `
  --file $artifactPath
```

El script informa ID del perfil, usuario, version, metodo, cantidad de
artifacts fuente, areas, skills, conceptos, warnings e `isCurrent`.

### Consultar como holder

En una terminal, configurar un secreto local no productivo y levantar el API:

```powershell
$env:JWT_SECRET = "demo-local-secret-change-me"
npm run dev --workspace @credential-intelligence/api
```

En otra terminal:

```powershell
$body = @{
  email = "holder.demo@example.com"
  password = "DemoHolder123!"
} | ConvertTo-Json

$login = Invoke-RestMethod `
  -Uri "http://127.0.0.1:3000/auth/login" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body

$profile = Invoke-RestMethod `
  -Uri "http://127.0.0.1:3000/me/profile/current" `
  -Method Get `
  -Headers @{ Authorization = "Bearer $($login.accessToken)" }

$profile.currentProfile.profileVersion
```

El resultado esperado es:

```text
formative_profile_result_v0
```

### Prueba manual validada

El 25 de julio de 2026 se uso `results[0]` de
`formative_profile_result_real_sample_v0.json`:

```text
artifactCount: 8
areas: 4
skills: 11
concepts: 59
totalHours persistidas: 544
profileVersion: formative_profile_result_v0
generationMethod: ai_artifact_ingest_v0
```

PostgreSQL confirmo un solo perfil current. Los conteos y checksums completos
de `Credential`, `SemanticAnalysis` y `BlockchainRecord` permanecieron
identicos antes y despues. La lectura autenticada devolvio el mismo perfil.

## 4. Decisiones de arquitectura

La ingesta file-based se usa ahora porque:

- evita ejecutar Python dentro de NestJS;
- mantiene `Extractor Materias` como modulo separado;
- obliga a usar contratos JSON explicitos y versionados;
- evita sumar despliegue, red, timeouts y autenticacion interna antes de
  estabilizar el contrato;
- permite repetir la demo con PostgreSQL y artifacts reales;
- conserva la independencia entre IA, credenciales y blockchain.

El backend consume artifacts, no imports ni estructuras internas del
pipeline Python.

## 5. Seguridad y limites actuales

- El artifact IA no contiene una identidad confiable del holder.
- `userId` proviene del script/backend y no se infiere desde el artifact.
- `sourceRefs` todavia no incluye `credentialId` o `semanticAnalysisId` del
  backend; no puede validarse ownership fuente por fuente.
- `generatedFrom.artifactCount` cuenta artifacts `semantic_analysis_v1`, no
  credenciales completadas. Se usa en `credentialsCount` solo como
  aproximacion tecnica exigida por el modelo actual.
- `online_course_catalog` describe catalogo formativo y no prueba completion.
- `formative_profile_result_v0` no participa en `canon_v1`.
- El perfil no se registra on-chain y no modifica evidencia blockchain.
- La ingesta no recalcula hashes ni modifica `Credential` o
  `SemanticAnalysis`.
- El CLI es una herramienta interna local/demo, no un limite de seguridad
  productivo ni un endpoint para archivos no confiables.

## 6. Arquitectura futura posible

### A. File-based controlada

Es la opcion actual y recomendada para demo y pruebas. Es simple,
reproducible y no requiere un servicio IA disponible en linea.

### B. Artifact storage y job backend

IA deposita JSON versionados en storage y un job backend los valida e
ingiere. Mejora trazabilidad, reintentos, auditoria e idempotencia sin
acoplar ambos runtimes directamente.

### C. Servicio IA HTTP/FastAPI

Backend solicita una generacion o consulta un artifact mediante HTTP. Requiere
despliegue independiente, autenticacion interna, timeouts, reintentos,
observabilidad y manejo de fallos parciales.

### D. Worker o cola asincronica

Backend publica un job, IA procesa y devuelve un artifact para ingesta. Es la
opcion mas robusta para cargas largas y produccion, pero tambien la mas
compleja.

Recomendacion:

```text
ahora          -> file-based para entrega/demo
siguiente      -> artifact storage o job interno controlado
mas adelante   -> FastAPI o cola, cuando contratos y trazabilidad sean estables
```

## 7. Roadmap incremental

1. Versionar fixtures pequenos de `formative_profile_result_v0`.
2. Agregar validacion JSON Schema liviana para `semantic_analysis_v1` y
   `formative_profile_result_v0`.
3. Incorporar referencias backend-friendly opcionales, como `credentialId`,
   `semanticAnalysisId` o un mapping externo versionado.
4. Validar ownership de cada fuente contra el holder objetivo.
5. Automatizar export/import mediante carpeta controlada o artifact storage.
6. Agregar idempotencia y auditoria de ingesta.
7. Evaluar un servicio IA separado.
8. Evaluar `services/ai` solo si el modulo queda reproducible, desplegable y
   libre de datasets/outputs pesados.

## 8. No implementado todavia

- endpoint publico o administrativo de ingesta IA;
- FastAPI o integracion HTTP con IA;
- ejecucion Python desde NestJS;
- worker, cola o scheduler;
- artifact storage remoto;
- validacion de ownership por `sourceRef`;
- perfil o evidencia de perfil on-chain;
- `credential_candidate_v1`;
- payload frontend especifico para el perfil IA;
- trigger automatico desde emision o persistencia de `SemanticAnalysis`.
