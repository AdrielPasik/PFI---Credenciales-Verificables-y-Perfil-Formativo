# syntax=docker/dockerfile:1.7
# The downloader stage is the sole networked model acquisition point. The final
# image contains a complete, verified snapshot and runs Transformers offline.
FROM python:3.12-slim AS model-snapshot

ARG MODEL_ID=intfloat/multilingual-e5-small
ARG MODEL_REVISION=fd1525a9fd15316a2d503bf26ab031a61d056e98
ARG MODEL_WEIGHTS_SHA256=1a55775f53449dac10a2bcbc312469fac40b96d53198c407081a831f81c98477

RUN python -m pip install --no-cache-dir huggingface_hub==1.16.1

RUN python - <<'PY'
import hashlib
import json
import os
from pathlib import Path

from huggingface_hub import HfApi, snapshot_download

model_id = os.environ["MODEL_ID"]
revision = os.environ["MODEL_REVISION"]
expected_sha256 = os.environ["MODEL_WEIGHTS_SHA256"]
destination = Path("/opt/pfi-model")

info = HfApi().model_info(model_id, revision=revision)
if info.sha != revision:
    raise SystemExit("resolved model revision does not match the pinned commit")

snapshot_download(repo_id=model_id, revision=revision, local_dir=destination)
weights = destination / "model.safetensors"
if not weights.is_file():
    raise SystemExit("pinned snapshot does not contain model.safetensors")
actual_sha256 = hashlib.sha256(weights.read_bytes()).hexdigest()
if actual_sha256 != expected_sha256:
    raise SystemExit("pinned model.safetensors SHA-256 mismatch")

required = ("config.json", "tokenizer.json", "tokenizer_config.json")
missing = [name for name in required if not (destination / name).is_file()]
if missing:
    raise SystemExit(f"pinned snapshot is missing required tokenizer/model files: {missing}")

(destination / "pfi-model-manifest.json").write_text(
    json.dumps(
        {
            "modelId": model_id,
            "revision": revision,
            "modelSafetensorsSha256": expected_sha256,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    + "\n",
    encoding="utf-8",
)
PY

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    AI_AREA_EMBEDDINGS_ENABLED=false \
    AI_AREA_EMBEDDINGS_MODEL_DIR=/opt/pfi/models/multilingual-e5-small \
    PROFILE_EMBEDDINGS_ENABLED=false \
    PROFILE_EMBEDDINGS_MODEL_DIR=/opt/pfi/models/multilingual-e5-small \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

WORKDIR /app

COPY requirements.txt requirements-api.txt requirements-embeddings.txt ./
RUN python -m pip install --no-cache-dir -r requirements-api.txt \
    && python -m pip install --no-cache-dir -r requirements-embeddings.txt

COPY --from=model-snapshot /opt/pfi-model /opt/pfi/models/multilingual-e5-small
COPY src ./src
COPY config ./config

# This build-time smoke proves the final runtime resolves exclusively from the
# copied local snapshot and that prewarm can encode the frozen 69 references.
RUN python -c "from src.area_embedding_reranker import AreaEmbeddingSettings, prewarm_area_embeddings; from pathlib import Path; prewarm_area_embeddings(AreaEmbeddingSettings(True, model_dir=Path('/opt/pfi/models/multilingual-e5-small')))"

RUN useradd --create-home --uid 10001 appuser
USER appuser

EXPOSE 8000

CMD ["python", "-m", "src.api.run"]
