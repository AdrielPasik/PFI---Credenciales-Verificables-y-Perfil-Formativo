"""Optional local embedding reranking for already eligible area candidates."""
from __future__ import annotations

import hashlib
import json
import math
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, Sequence

from .text_utils import normalize_whitespace


MODEL_ID = "intfloat/multilingual-e5-small"
MODEL_REVISION = "fd1525a9fd15316a2d503bf26ab031a61d056e98"
MODEL_EMBEDDING_DIMENSION = 384
MAX_INPUT_TOKENS = 512
QUERY_PREFIX = "query: "
LONG_TEXT_POLICY_VERSION = "area_embedding_long_text_policy_v1"
SOURCE_TOKEN_BUDGET = 480
SOURCE_TOKEN_OVERLAP = 0
AGGREGATION_METHOD = "token_weighted_mean_then_l2_normalize"
REFERENCES_PATH = Path(__file__).resolve().parents[1] / "config" / "semantic" / "area_embedding_references_v1.json"
MODEL_MANIFEST_FILE = "pfi-model-manifest.json"
MODEL_WEIGHTS_FILE = "model.safetensors"
MODEL_WEIGHTS_SHA256 = "1a55775f53449dac10a2bcbc312469fac40b96d53198c407081a831f81c98477"
AREA_EMBEDDING_LAMBDA = 0.8
AREA_EMBEDDING_RELATIVE_MARGIN = 0.0
FROZEN_REFERENCES_VERSION = "scope-areas-2026-10-08-v1-frozen"
FROZEN_REFERENCE_COUNT = 69


@dataclass(frozen=True)
class AreaEmbeddingSettings:
    enabled: bool = False
    lambda_weight: float | None = None
    relative_margin: float | None = None
    model_dir: Path | None = None
    configuration_error: str | None = None


@dataclass(frozen=True)
class AreaReferenceSet:
    version: str
    descriptions: dict[str, str]


@dataclass(frozen=True)
class ChunkPlan:
    """Lossless source-token partition for one document embedding request."""

    chunks: tuple[str, ...]
    source_token_counts: tuple[int, ...]
    effective_token_counts: tuple[int, ...]

    @property
    def source_token_count(self) -> int:
        return sum(self.source_token_counts)


class EmbeddingBackend(Protocol):
    def count_tokens(self, text: str) -> int: ...

    def encode(self, texts: Sequence[str]) -> list[list[float]]: ...

    def plan_source_chunks(self, source_text: str) -> ChunkPlan: ...


_REFERENCE_CACHE: dict[Path, AreaReferenceSet] = {}
_MODEL_CACHE: dict[Path, "LocalE5Embedder"] = {}
_REFERENCE_CACHE_LOCK = threading.Lock()
_MODEL_CACHE_LOCK = threading.Lock()


def build_area_embedding_source(name: str, raw_sections: dict[str, str]) -> str:
    """Build an input from source name, objectives and curricular contents only."""
    content_keys = (
        "minimum_contents_raw",
        "conceptual_contents_raw",
        "procedural_contents_raw",
        "attitudinal_contents_raw",
        "contents_raw",
    )
    parts = [name, raw_sections.get("objectives_raw", "")]
    parts.extend(raw_sections.get(key, "") for key in content_keys)
    return normalize_whitespace(" ".join(part for part in parts if isinstance(part, str) and part.strip()))


def load_settings(environ: dict[str, str] | None = None) -> AreaEmbeddingSettings:
    env = os.environ if environ is None else environ
    raw_enabled = env.get("AI_AREA_EMBEDDINGS_ENABLED", "false").strip().lower()
    if raw_enabled not in {"true", "false"}:
        raise ValueError("AI_AREA_EMBEDDINGS_ENABLED must be true or false")
    if raw_enabled == "false":
        return AreaEmbeddingSettings(enabled=False)

    raw_model_dir = env.get("AI_AREA_EMBEDDINGS_MODEL_DIR", "").strip()
    if not raw_model_dir:
        raise ValueError("enabled embeddings require a model directory")
    return AreaEmbeddingSettings(True, AREA_EMBEDDING_LAMBDA, AREA_EMBEDDING_RELATIVE_MARGIN, Path(raw_model_dir))


def load_reference_set(path: Path = REFERENCES_PATH) -> AreaReferenceSet:
    resolved = path.resolve()
    if resolved in _REFERENCE_CACHE:
        return _REFERENCE_CACHE[resolved]
    with _REFERENCE_CACHE_LOCK:
        cached = _REFERENCE_CACHE.get(resolved)
        if cached is not None:
            return cached
        with resolved.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict) or payload.get("schemaVersion") != "scope_area_embedding_references_v1":
            raise ValueError("invalid area embedding references schema")
        version, references = payload.get("referencesVersion"), payload.get("references")
        if version != FROZEN_REFERENCES_VERSION or not isinstance(references, list):
            raise ValueError("area embedding references do not match the frozen reference version")
        descriptions: dict[str, str] = {}
        for item in references:
            if not isinstance(item, dict):
                raise ValueError("area embedding reference must be an object")
            area, description = item.get("area"), item.get("description")
            if not isinstance(area, str) or not area.strip() or not isinstance(description, str) or not description.strip():
                raise ValueError("area embedding reference requires area and description")
            if area in descriptions:
                raise ValueError(f"duplicate area embedding reference: {area}")
            descriptions[area] = normalize_whitespace(description)
        if len(descriptions) != FROZEN_REFERENCE_COUNT:
            raise ValueError("area embedding references do not contain the frozen area count")
        result = AreaReferenceSet(version, descriptions)
        _REFERENCE_CACHE[resolved] = result
        return result


def plan_source_token_chunks(
    source_token_ids: Sequence[int],
    *,
    decode_source_tokens: Any,
    encode_source_text: Any,
    count_effective_tokens: Any,
    is_safe_chunk_start: Any | None = None,
) -> ChunkPlan:
    """Partition source tokens once, then prove each effective query is safe.

    The source token sequence is partitioned consecutively with no overlap. A
    decode/re-encode equality check prevents an implicit tokenizer boundary
    rewrite from changing, dropping, or duplicating source tokens.
    """
    token_ids = tuple(int(token) for token in source_token_ids)
    if not token_ids:
        raise ValueError("source text has no tokens")

    chunks: list[str] = []
    source_counts: list[int] = []
    effective_counts: list[int] = []
    start = 0
    while start < len(token_ids):
        end = min(start + SOURCE_TOKEN_BUDGET, len(token_ids))
        # SentencePiece must not begin the following decoded fragment in the
        # middle of a word; step back to its next word boundary if needed.
        if end < len(token_ids) and is_safe_chunk_start is not None:
            while end > start and not bool(is_safe_chunk_start(token_ids[end])):
                end -= 1
            if end == start:
                raise ValueError("no safe source chunk boundary within token budget")
        source_chunk = token_ids[start:end]
        text = str(decode_source_tokens(source_chunk)).strip()
        if not text:
            raise ValueError("decoded source chunk is empty")
        if tuple(encode_source_text(text)) != source_chunk:
            raise ValueError("source chunk token round trip failed")
        effective_count = int(count_effective_tokens(QUERY_PREFIX + text))
        if effective_count > MAX_INPUT_TOKENS:
            raise ValueError("effective chunk exceeds model token limit")
        chunks.append(text)
        source_counts.append(len(source_chunk))
        effective_counts.append(effective_count)
        start = end

    if sum(source_counts) != len(token_ids) or any(count > SOURCE_TOKEN_BUDGET for count in source_counts):
        raise ValueError("source chunk coverage is invalid")
    return ChunkPlan(tuple(chunks), tuple(source_counts), tuple(effective_counts))


def aggregate_chunk_vectors(vectors: Sequence[Sequence[float]], source_token_counts: Sequence[int]) -> list[float]:
    """Token-weighted mean of normalized chunk vectors, then final L2 normalization."""
    if not vectors or len(vectors) != len(source_token_counts):
        raise ValueError("chunk vectors and token counts must have the same non-zero length")
    dimension = len(vectors[0])
    if dimension == 0 or any(len(vector) != dimension for vector in vectors):
        raise ValueError("chunk embedding dimensions must match and be non-zero")
    if any(count <= 0 for count in source_token_counts):
        raise ValueError("chunk source token counts must be positive")
    if any(not math.isfinite(value) for vector in vectors for value in vector):
        raise ValueError("chunk embedding contains non-finite values")

    total_tokens = float(sum(source_token_counts))
    aggregate = [0.0] * dimension
    for vector, count in zip(vectors, source_token_counts):
        weight = count / total_tokens
        for index, value in enumerate(vector):
            aggregate[index] += weight * float(value)
    norm = math.sqrt(sum(value * value for value in aggregate))
    if norm == 0.0 or not math.isfinite(norm):
        raise ValueError("aggregated embedding is invalid")
    return [value / norm for value in aggregate]


class LocalE5Embedder:
    """Local E5 mean-pooling implementation; dependencies load only when used."""

    def __init__(self, model_dir: Path) -> None:
        if not model_dir.is_dir():
            raise ValueError("embedding model directory is unavailable")
        manifest_path = model_dir / MODEL_MANIFEST_FILE
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError("embedding model manifest is unavailable") from exc
        if manifest.get("modelId") != MODEL_ID or manifest.get("revision") != MODEL_REVISION:
            raise ValueError("embedding model manifest does not match the pinned model revision")
        weights_path = model_dir / MODEL_WEIGHTS_FILE
        if not weights_path.is_file():
            raise ValueError("embedding model weights are unavailable")
        weights_hash = hashlib.sha256()
        try:
            with weights_path.open("rb") as handle:
                for block in iter(lambda: handle.read(1024 * 1024), b""):
                    weights_hash.update(block)
        except OSError as exc:
            raise ValueError("embedding model weights are unavailable") from exc
        if weights_hash.hexdigest() != MODEL_WEIGHTS_SHA256:
            raise ValueError("embedding model weights do not match the frozen snapshot")
        try:
            import torch
            import torch.nn.functional as functional
            from transformers import AutoModel, AutoTokenizer
        except ImportError as exc:
            raise RuntimeError("local embedding dependencies are unavailable") from exc
        self._torch = torch
        self._functional = functional
        self._tokenizer = AutoTokenizer.from_pretrained(model_dir, local_files_only=True)
        self._model = AutoModel.from_pretrained(model_dir, local_files_only=True)
        if getattr(self._model.config, "hidden_size", None) != MODEL_EMBEDDING_DIMENSION:
            raise ValueError("embedding model dimension does not match the frozen encoder")
        self._model.eval()

    def count_tokens(self, text: str) -> int:
        return len(self._tokenizer(text, add_special_tokens=True, truncation=False)["input_ids"])

    def plan_source_chunks(self, source_text: str) -> ChunkPlan:
        source_token_ids = self._tokenizer(
            source_text,
            add_special_tokens=False,
            truncation=False,
            verbose=False,
        )["input_ids"]
        return plan_source_token_chunks(
            source_token_ids,
            decode_source_tokens=lambda token_ids: self._tokenizer.decode(
                list(token_ids), skip_special_tokens=True, clean_up_tokenization_spaces=False
            ),
            encode_source_text=lambda text: self._tokenizer.encode(text, add_special_tokens=False),
            count_effective_tokens=self.count_tokens,
            is_safe_chunk_start=lambda token_id: self._tokenizer.convert_ids_to_tokens(int(token_id)).startswith("▁"),
        )

    def encode(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts or any(self.count_tokens(text) > MAX_INPUT_TOKENS for text in texts):
            raise ValueError("embedding input exceeds model token limit")
        batch = self._tokenizer(list(texts), padding=True, truncation=False, return_tensors="pt")
        with self._torch.inference_mode():
            output = self._model(**batch)
            masked = output.last_hidden_state.masked_fill(~batch["attention_mask"][..., None].bool(), 0.0)
            pooled = masked.sum(dim=1) / batch["attention_mask"].sum(dim=1)[..., None]
            normalized = self._functional.normalize(pooled, p=2, dim=1)
        vectors = normalized.cpu().tolist()
        if any(len(vector) != MODEL_EMBEDDING_DIMENSION for vector in vectors):
            raise ValueError("embedding output dimension does not match the frozen encoder")
        return vectors


def _get_local_embedder(model_dir: Path) -> LocalE5Embedder:
    resolved = model_dir.resolve()
    if resolved not in _MODEL_CACHE:
        with _MODEL_CACHE_LOCK:
            if resolved not in _MODEL_CACHE:
                _MODEL_CACHE[resolved] = LocalE5Embedder(resolved)
    return _MODEL_CACHE[resolved]


def _lexical_sort_key(item: dict[str, Any]) -> tuple[float, float, int, int]:
    return (
        float(item["validated_area_score"]),
        float(item["raw_area_signal_score"]),
        int(item["context_unique"]),
        int(item["strong_hits"]),
    )


def cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    if len(left) != len(right) or not left:
        raise ValueError("embedding vectors must have equal non-zero dimension")
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0.0 or right_norm == 0.0:
        raise ValueError("embedding vectors must be non-zero")
    return dot / (left_norm * right_norm)


def _fallback(reason: str, plan: ChunkPlan | None = None) -> dict[str, Any]:
    diagnostic: dict[str, Any] = {
        "model_revision": MODEL_REVISION,
        "references_version": None,
        "candidates": [],
        "applied": False,
        "fallback_reason": reason,
    }
    if plan is not None:
        diagnostic.update(_long_text_diagnostic(plan))
    return diagnostic


def _long_text_diagnostic(plan: ChunkPlan) -> dict[str, Any]:
    return {
        "longTextPolicyVersion": LONG_TEXT_POLICY_VERSION,
        "sourceTokenCount": plan.source_token_count,
        "chunkCount": len(plan.chunks),
        "chunkSourceTokenCounts": list(plan.source_token_counts),
        "aggregationMethod": AGGREGATION_METHOD,
    }


def rerank_existing_area_candidates(
    candidates: list[dict[str, Any]],
    source_text: str,
    settings: AreaEmbeddingSettings,
    *,
    embedder: EmbeddingBackend | None = None,
    references: AreaReferenceSet | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Weighted rank fusion after, never before, lexical candidate gates.

    The relative margin is the difference between the first and second cosine.
    It is a separation check, not an absolute similarity threshold. Failures
    return the untouched list so the caller can reproduce lexical ordering.
    """
    if settings.configuration_error:
        return candidates, _fallback(settings.configuration_error)
    if not settings.enabled:
        return candidates, _fallback("feature_disabled")
    if len(candidates) < 2:
        return candidates, _fallback("insufficient_candidates")
    if not source_text.strip():
        return candidates, _fallback("invalid_source_text")
    plan: ChunkPlan | None = None
    try:
        reference_set = references or load_reference_set()
        if any(item["area"] not in reference_set.descriptions for item in candidates):
            return candidates, _fallback("missing_area_reference")
        backend = embedder
        if backend is None:
            if settings.model_dir is None:
                return candidates, _fallback("invalid_configuration")
            backend = _get_local_embedder(settings.model_dir)

        planner = getattr(backend, "plan_source_chunks", None)
        if not callable(planner):
            # Test or alternative backends can preserve the established
            # single-document path, but may never silently truncate a long one.
            effective_tokens = backend.count_tokens(QUERY_PREFIX + source_text)
            if effective_tokens > MAX_INPUT_TOKENS:
                return candidates, _fallback("chunk_planner_unavailable")
            plan = ChunkPlan((source_text,), (max(1, effective_tokens - 2),), (effective_tokens,))
        else:
            try:
                plan = planner(source_text)
            except Exception:
                return candidates, _fallback("chunk_tokenization_failure")
        if not plan.chunks or any(count > MAX_INPUT_TOKENS for count in plan.effective_token_counts):
            return candidates, _fallback("invalid_chunk_plan", plan)

        source_queries = [QUERY_PREFIX + chunk for chunk in plan.chunks]
        prototype_queries = [QUERY_PREFIX + reference_set.descriptions[item["area"]] for item in candidates]
        vectors = backend.encode([*source_queries, *prototype_queries])
        if len(vectors) != len(plan.chunks) + len(candidates) or not vectors[0]:
            return candidates, _fallback("invalid_embedding_output", plan)
        source_vector = aggregate_chunk_vectors(vectors[: len(plan.chunks)], plan.source_token_counts)
        scored = [dict(item) for item in candidates]

        lexical_order = sorted(range(len(scored)), key=lambda index: _lexical_sort_key(scored[index]), reverse=True)
        for rank, index in enumerate(lexical_order, start=1):
            scored[index]["_lexical_rank"] = rank
        for index, vector in enumerate(vectors[len(plan.chunks) :]):
            cosine = cosine_similarity(source_vector, vector)
            if not math.isfinite(cosine):
                return candidates, _fallback("invalid_embedding_output", plan)
            scored[index]["_cosine"] = cosine

        embedding_order = sorted(
            range(len(scored)),
            key=lambda index: (-scored[index]["_cosine"], scored[index]["_lexical_rank"]),
        )
        margin = scored[embedding_order[0]]["_cosine"] - scored[embedding_order[1]]["_cosine"]
        if margin < AREA_EMBEDDING_RELATIVE_MARGIN:
            return candidates, _fallback("relative_margin_not_met", plan)

        count = len(scored)
        for rank, index in enumerate(embedding_order, start=1):
            scored[index]["_embedding_rank"] = rank
        for item in scored:
            lexical_rank_score = 1.0 - ((item["_lexical_rank"] - 1) / (count - 1))
            embedding_rank_score = 1.0 - ((item["_embedding_rank"] - 1) / (count - 1))
            item["_combined_rank_score"] = round(
                (1.0 - AREA_EMBEDDING_LAMBDA) * lexical_rank_score
                + AREA_EMBEDDING_LAMBDA * embedding_rank_score,
                12,
            )

        ordered = sorted(
            scored,
            key=lambda item: (-item["_combined_rank_score"], item["_lexical_rank"]),
        )
        diagnostic = {
            "model_revision": MODEL_REVISION,
            "references_version": reference_set.version,
            "candidates": [
                {
                    "area": item["area"],
                    "lexical_rank": item["_lexical_rank"],
                    "lexical_score": item["validated_area_score"],
                    "cosine": round(item["_cosine"], 6),
                    "embedding_rank": item["_embedding_rank"],
                    "combined_rank_score": round(item["_combined_rank_score"], 6),
                }
                for item in ordered
            ],
            "applied": True,
            "fallback_reason": None,
        }
        diagnostic.update(_long_text_diagnostic(plan))
        for item in ordered:
            for key in tuple(item):
                if key.startswith("_"):
                    item.pop(key)
        return ordered, diagnostic
    except Exception:
        return candidates, _fallback("model_or_reference_failure", plan)
