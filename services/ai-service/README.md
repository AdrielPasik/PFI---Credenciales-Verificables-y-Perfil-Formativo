# Traza AI Service

Servicio Python/FastAPI desacoplado que expone el analisis semantico y la
construccion de perfiles formativos de Traza.

## Estado

P4i-1 incorporo un snapshot curado del servicio IA externo inventariado en
P4i-0. El monorepo es ahora la ubicacion de trabajo para el runtime HTTP, sus
tests contractuales y su configuracion. El import excluyo datasets, PDFs,
outputs, perfiles, embeddings, caches, logs y secretos.

Este slice conserva el comportamiento del servicio de origen. Todavia no
implementa autenticacion interna, deployment privado ni conexion automatica de
`DocumentEvidence` o `TextEvidence`.

## Endpoints

- `GET /health`: health liviano, sin ejecutar pipelines.
- `POST /v1/semantic-analysis/pdf`: recibe un PDF por multipart y devuelve
  `semantic_analysis_v1`.
- `POST /v1/formative-profile/build`: recibe artifacts
  `semantic_analysis_v1` y devuelve `formative_profile_result_v0`.

Los JSON Schemas autoritativos no se duplican en este servicio. Permanecen en:

- `../../packages/schemas/semantic_analysis_v1.schema.json`;
- `../../packages/schemas/formative_profile_result_v0.schema.json`.

La validacion automatica de los artifacts Python contra esos schemas queda
pendiente para P4i-2.

## Requisitos

- Python 3.12 recomendado;
- no requiere LLM externo;
- no requiere embeddings;
- no requiere Neon, S3, blockchain ni secretos en modo local actual.

Crear un entorno local ignorado:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-api-dev.txt
```

`requirements-api.txt` instala solo runtime HTTP. No se incluyen ni se deben
instalar dependencias de embeddings para este servicio v0.

## Ejecucion local

Desde `services/ai-service`:

```powershell
.\.venv\Scripts\python.exe -m uvicorn src.api.main:app --host 0.0.0.0 --port 8000
```

Tambien existe el wrapper npm del workspace:

```powershell
npm run dev --workspace @credential-intelligence/ai-service
```

Configuracion opcional:

```dotenv
AI_SERVICE_MAX_PDF_BYTES=26214400
```

## Tests

Desde `services/ai-service`:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/api
.\.venv\Scripts\python.exe -m pytest tests/exporters/test_semantic_analysis_exporter.py tests/profile_builder/test_artifact_loader.py tests/profile_builder/test_artifact_profile_adapter.py tests/profile_builder/test_artifact_confidence_interpreter.py tests/profile_builder/test_formative_profile_result.py tests/profile_builder/test_stability_validation.py
```

O desde la raiz, con `python` apuntando al entorno preparado:

```powershell
npm run test --workspace @credential-intelligence/ai-service
```

Los tests usan fixtures sinteticos pequenos y no necesitan los datasets del
modulo original.

## Docker

El Dockerfile usa Python 3.12 slim, instala solo requirements del API, copia
`src` y `config`, y ejecuta como usuario no root. Mantiene el puerto fijo 8000
del servicio de origen.

La adaptacion a `PORT`, auth interna y Render Private Service corresponde a
P4i-2/P4i-4. No usar este README como confirmacion de deployment productivo.

## Limites

- sin auth JWT service-to-service;
- sin acceso del browser;
- sin persistencia propia;
- sin acceso a S3 o PostgreSQL;
- sin embeddings o descarga de modelos;
- sin ejecucion automatica desde evidencias;
- sin `AnalysisRun`, readiness, emision o blockchain.
