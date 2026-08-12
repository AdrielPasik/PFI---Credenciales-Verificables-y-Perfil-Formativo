# Traza AI Service

Servicio Python/FastAPI desacoplado que expone el analisis semantico y la
construccion de perfiles formativos de Traza.

## Estado

P4i-1 incorporo un snapshot curado del servicio IA externo inventariado en
P4i-0. El monorepo es ahora la ubicacion de trabajo para el runtime HTTP, sus
tests contractuales y su configuracion. El import excluyo datasets, PDFs,
outputs, perfiles, embeddings, caches, logs y secretos.

P4i-2 consolido los comandos del workspace, el puerto configurable y la
validacion de artifacts generados por Python contra los JSON Schemas
compartidos del monorepo.

P4i-3 agrego autenticacion JWT interna opcional. P4i-4 deja documentada la
configuracion recomendada para un servicio privado, pero no ejecuta el deploy.
P4i-6a registra el deploy demo real como Web Service Free con HTTPS publico y
JWT interno, una excepcion temporal; la red privada sigue siendo el objetivo.
El servicio todavia no tiene conexion automatica de `DocumentEvidence` o
`TextEvidence`.

## Endpoints

- `GET /health`: health liviano, sin ejecutar pipelines.
- `POST /v1/semantic-analysis/pdf`: recibe un PDF por multipart y devuelve
  `semantic_analysis_v1`; requiere JWT interno en modo `jwt`.
- `POST /v1/semantic-analysis/text` (C2b.1): recibe texto formativo
  declarado (sin PDF, ej. un `course` sin documento adjunto) y devuelve
  `semantic_analysis_v1` con `sourceType: "text"`; requiere JWT interno en
  modo `jwt`, igual que el endpoint PDF. Endpoint interno unicamente —
  pensado para que el backend lo llame, nunca el frontend.
- `POST /v1/formative-profile/build`: recibe artifacts
  `semantic_analysis_v1` y devuelve `formative_profile_result_v0`; requiere
  JWT interno en modo `jwt`.

### `POST /v1/semantic-analysis/text` (C2b.1)

Reusa el mismo pipeline de deteccion que el endpoint PDF
(`process_single_input(manual_text=...)`, ya existente pero antes solo
usado por el batch/CLI offline) — no agrega un modelo ni un pipeline
nuevo. No usa LLM ni embeddings, no hace OCR y no hace fetch de ninguna
URL (`externalUrl` no forma parte del contrato de request; enviarlo dentro
de `metadata` es un 422).

Request:

```json
{
  "content": "The Complete Python Bootcamp From Zero to Hero in Python\n\nLearn Python like a Professional. Start from the basics and go all the way to creating your own applications and games.",
  "metadata": {
    "platformName": "Plataforma de Cursos Demo",
    "hours": 22,
    "modality": "Online",
    "credentialType": "course",
    "languageHint": "en"
  },
  "sourceRefs": {
    "textEvidenceId": "text-evidence-demo",
    "credentialId": "credential-demo"
  },
  "requestedPipelineVersion": "unversioned_current",
  "requestedTaxonomyVersion": "unversioned_current"
}
```

- `content` es el unico campo analizable (max. 30000 caracteres, no puede
  quedar en blanco tras normalizar espacios).
- `metadata` y `sourceRefs` son opcionales y nunca se mezclan con `content`
  — evita que "Online" o el nombre de una plataforma contaminen la
  deteccion de skills/areas. `metadata.hours` es solo informativo: nunca
  se usa para fabricar `hoursDistribution` (esa distribucion solo sale de
  evidencia real dentro de `content`, y en la practica queda vacia para
  texto corto/no estructurado).
- `requestedPipelineVersion`/`requestedTaxonomyVersion` siguen el mismo
  contrato 409 que el endpoint PDF si no coinciden con lo que expone el
  servicio.

Reglas de conservadurismo especificas de texto (`sourceType: "text"`,
ver `src/exporters/backend_contract/semantic_analysis_exporter.py::_export_text`
y `normalizers.py`):

- `status` nunca es `"completed"` para texto corto/no estructurado
  (< 400 caracteres o sin secciones curriculares detectadas) —
  `qualityFlags` incluye `short_unstructured_text` y/o
  `no_curricular_sections_detected` cuando corresponde.
- La confianza de areas/skills detectadas se topea (`<= 0.45`) y se
  re-etiqueta `confidenceMethod: "heuristic"` — nunca `"measured"` — porque
  un texto declarado sin estructura curricular es evidencia mas debil que
  un PDF con secciones explicitas, aunque el mismo keyword produzca el
  mismo score interno.
- No inventa `hoursDistribution` para texto corto: solo se puebla si hay
  evidencia real de area en `content` (mismo umbral conservador que PDF).
- NestJS usa este endpoint internamente para `AnalysisRun` textuales cuando
  corresponde; el browser nunca lo llama. `combined` sigue pendiente.

### Calidad semantica de gestion agil

La taxonomia usa el area existente **Gestion de Proyectos Tecnologicos** para
contenidos que combinan señales distintivas de Scrum, Kanban, metodologias
agiles, backlog, sprint, retrospectiva o gestion agil de proyectos. No se
agrega un area nueva ni se fuerza por menciones genericas de gestion: los casos
de comunicacion y humanidades conservan sus reglas de clasificacion. Skills y
conceptos se detectan mediante patrones controlados, no mediante traduccion
libre ni LLM.

Los JSON Schemas autoritativos no se duplican en este servicio. Permanecen en:

- `../../packages/schemas/semantic_analysis_v1.schema.json`;
- `../../packages/schemas/formative_profile_result_v0.schema.json`.

## Requisitos

- Python 3.12 recomendado;
- no requiere LLM externo;
- no requiere embeddings;
- no requiere Neon, S3, blockchain ni secretos en modo local actual.

Crear un entorno local ignorado e instalar dependencias de desarrollo:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-api-dev.txt
.\.venv\Scripts\Activate.ps1
```

`requirements-api.txt` instala solo runtime HTTP. No se incluyen ni se deben
instalar dependencias de embeddings para este servicio v0.

Los wrappers npm invocan `python` desde `PATH`; no contienen rutas absolutas ni
dependen de una ubicacion hardcodeada de `.venv`. Activar primero el entorno
Python elegido.

## Ejecucion

Desde `services/ai-service`:

```powershell
python -m src.api.run
```

Desde la raiz del monorepo:

```powershell
npm run dev --workspace @credential-intelligence/ai-service
npm run start --workspace @credential-intelligence/ai-service
```

`src.api.run` escucha en `0.0.0.0`, lee `PORT` y usa `8000` cuando la variable
no esta definida. Rechaza valores vacios, no numericos o fuera de `1..65535`.

```dotenv
PORT=8000
AI_SERVICE_MAX_PDF_BYTES=26214400
AI_INTERNAL_AUTH_MODE=disabled
AI_INTERNAL_JWT_SECRET=
AI_INTERNAL_JWT_ISSUER=traza-api
AI_INTERNAL_JWT_AUDIENCE=traza-ai-service
AI_INTERNAL_JWT_CLOCK_SKEW_SECONDS=30
```

`disabled` es el default local y no requiere secretos. En demo/production se
usa `jwt`: secreto, issuer y audience son obligatorios al construir la app;
clock skew debe estar entre 0 y 300 segundos. FastAPI acepta exclusivamente
HS256, exige `iss`, `aud`, `sub`, `iat`, `exp` y `jti`, y espera
`sub=traza-api`. `/health` permanece publico. Los errores de autenticacion son
uniformes y no imprimen tokens, secretos ni payloads.

El secreto debe ser de alta entropia, distinto de `JWT_SECRET` y coincidir con
`AI_SERVICE_JWT_SECRET` del backend. La rotacion `current/previous` queda como
hardening futuro; P4i-3 usa un unico secreto interno vigente.

## Tests

Desde `services/ai-service`:

```powershell
python -m pytest tests/api
python -m pytest tests/exporters/test_semantic_analysis_exporter.py tests/profile_builder/test_artifact_loader.py tests/profile_builder/test_artifact_profile_adapter.py tests/profile_builder/test_artifact_confidence_interpreter.py tests/profile_builder/test_formative_profile_result.py tests/profile_builder/test_stability_validation.py
python -m pytest tests/contracts/test_shared_json_schemas.py
```

Desde la raiz:

```powershell
npm run python:check --workspace @credential-intelligence/ai-service
npm run test --workspace @credential-intelligence/ai-service
npm run test:api --workspace @credential-intelligence/ai-service
npm run test:contracts --workspace @credential-intelligence/ai-service
npm run test:schemas --workspace @credential-intelligence/ai-service
```

Los tests usan entradas sinteticas pequenas y no necesitan datasets. La suite
de schemas genera primero `semantic_analysis_v1` mediante el exporter Python
actual, genera despues `formative_profile_result_v0` mediante el builder actual
y valida ambos contra `packages/schemas`; no valida solamente JSON estatico.

## Docker

El Dockerfile usa Python 3.12 slim, instala solo requirements del API, copia
`src` y `config`, y ejecuta como usuario no root. `EXPOSE 8000` documenta el
default; el proceso usa `PORT` mediante `src.api.run`.

```powershell
npm run docker:build --workspace @credential-intelligence/ai-service
docker run --rm -p 8000:8000 -e PORT=8000 traza-ai-service:local
```

Para demo se recomienda desplegar este Dockerfile desde el contexto
`services/ai-service`, conservar su CMD y usar `/health`. El runbook completo,
incluidas variables, URL interna, smoke y rollback, esta en
`../../docs/architecture/render-ai-private-service-runbook-v0.md`. P4i-4 no es
confirmacion de que el servicio real haya sido creado o desplegado.

El estado cloud real, smoke sanitizado, riesgos y controles compensatorios se
documentan en
`../../docs/architecture/render-ai-cloud-deployment-record-v0.md`. La URL
publica demo no habilita llamadas directas desde frontend.

En la demo cloud se observo un cold start/gateway temporal antes de que FastAPI
pudiera devolver JSON: el backend registro un `AnalysisRun` fallido seguro y
el health posterior fue exitoso. Antes de una demo IA, consultar `/health` para
despertar el servicio si corresponde. No incluir URL real, token, PDF ni logs
sensibles en comandos o documentacion. Una instancia sin spin-down y Private
Service o equivalente son la mejora estructural futura.

## Limites

- auth interna JWT HS256 disponible, deshabilitada por default local;
- sin acceso del browser;
- sin persistencia propia;
- sin acceso a S3 o PostgreSQL;
- sin embeddings o descarga de modelos;
- sin ejecucion automatica desde evidencias;
- sin `AnalysisRun`, readiness, emision o blockchain.
