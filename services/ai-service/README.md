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
El servicio todavia no tiene conexion automatica de `DocumentEvidence` o
`TextEvidence`.

## Endpoints

- `GET /health`: health liviano, sin ejecutar pipelines.
- `POST /v1/semantic-analysis/pdf`: recibe un PDF por multipart y devuelve
  `semantic_analysis_v1`; requiere JWT interno en modo `jwt`.
- `POST /v1/formative-profile/build`: recibe artifacts
  `semantic_analysis_v1` y devuelve `formative_profile_result_v0`; requiere
  JWT interno en modo `jwt`.

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

## Limites

- auth interna JWT HS256 disponible, deshabilitada por default local;
- sin acceso del browser;
- sin persistencia propia;
- sin acceso a S3 o PostgreSQL;
- sin embeddings o descarga de modelos;
- sin ejecucion automatica desde evidencias;
- sin `AnalysisRun`, readiness, emision o blockchain.
