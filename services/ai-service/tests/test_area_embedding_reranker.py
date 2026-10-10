from __future__ import annotations

import json
import math
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import src.area_embedding_reranker as reranker
from src.area_embedding_reranker import (
    AREA_EMBEDDING_LAMBDA,
    AREA_EMBEDDING_RELATIVE_MARGIN,
    AreaEmbeddingSettings,
    AreaReferenceSet,
    ChunkPlan,
    LocalE5Embedder,
    MAX_INPUT_TOKENS,
    aggregate_chunk_vectors,
    build_area_embedding_source,
    cosine_similarity,
    load_reference_set,
    load_settings,
    plan_source_token_chunks,
    rerank_existing_area_candidates,
)
from src.semantic_builder import AREA_PROFILES


class FakeEmbedder:
    def __init__(self, vectors: list[list[float]], token_count: int = 24, raises: bool = False) -> None:
        self.vectors = vectors
        self.token_count = token_count
        self.raises = raises

    def count_tokens(self, text: str) -> int:
        return self.token_count

    def encode(self, texts: list[str]) -> list[list[float]]:
        if self.raises:
            raise RuntimeError("unavailable")
        return self.vectors


class PlannedFakeEmbedder(FakeEmbedder):
    def __init__(self, vectors: list[list[float]], plan: ChunkPlan | None = None, raises: bool = False) -> None:
        super().__init__(vectors, raises=raises)
        self.plan = plan or ChunkPlan(("texto original",), (2,), (4,))

    def plan_source_chunks(self, source_text: str) -> ChunkPlan:
        if self.raises:
            raise RuntimeError("chunk failure")
        return self.plan


def _candidate(area: str, score: float) -> dict:
    return {
        "area": area,
        "validated_area_score": score,
        "raw_area_signal_score": score,
        "context_unique": 1,
        "strong_hits": 1,
    }


def _references(*areas: str) -> AreaReferenceSet:
    return AreaReferenceSet("test-references-v1", {area: f"prototype for {area}" for area in areas})


def _enabled(lambda_weight: float = AREA_EMBEDDING_LAMBDA, margin: float = AREA_EMBEDDING_RELATIVE_MARGIN) -> AreaEmbeddingSettings:
    return AreaEmbeddingSettings(True, lambda_weight, margin)


def test_source_builder_uses_only_original_name_objectives_and_contents() -> None:
    source = build_area_embedding_source(
        "Física I",
        {
            "objectives_raw": "Explicar fenómenos físicos.",
            "contents_raw": "Mecánica y energía.",
            "bibliography_raw": "Texto que no debe entrar.",
        },
    )
    assert source == "Física I Explicar fenómenos físicos. Mecánica y energía."


def test_chunk_plan_covers_each_source_token_once_with_zero_overlap() -> None:
    source_tokens = list(range(961))
    plan = plan_source_token_chunks(
        source_tokens,
        decode_source_tokens=lambda ids: " ".join(str(token) for token in ids),
        encode_source_text=lambda text: [int(token) for token in text.split()],
        count_effective_tokens=lambda text: len(text.removeprefix("query: ").split()) + 2,
    )
    assert plan.source_token_counts == (480, 480, 1)
    assert plan.effective_token_counts == (482, 482, 3)
    reconstructed = [int(token) for chunk in plan.chunks for token in chunk.split()]
    assert reconstructed == source_tokens
    assert sum(plan.source_token_counts) == len(source_tokens)
    assert all(count <= MAX_INPUT_TOKENS for count in plan.effective_token_counts)


def test_chunk_plan_is_deterministic_and_refuses_an_unsafe_effective_input() -> None:
    kwargs = {
        "decode_source_tokens": lambda ids: " ".join(str(token) for token in ids),
        "encode_source_text": lambda text: [int(token) for token in text.split()],
        "count_effective_tokens": lambda text: len(text.removeprefix("query: ").split()) + 2,
    }
    assert plan_source_token_chunks(range(3), **kwargs) == plan_source_token_chunks(range(3), **kwargs)
    try:
        plan_source_token_chunks(
            range(480),
            decode_source_tokens=kwargs["decode_source_tokens"],
            encode_source_text=kwargs["encode_source_text"],
            count_effective_tokens=lambda _: 513,
        )
    except ValueError as exc:
        assert "exceeds" in str(exc)
    else:
        raise AssertionError("unsafe effective chunk must fail")


def test_token_weighted_aggregation_is_l2_normalized_and_single_chunk_equivalent() -> None:
    one = aggregate_chunk_vectors([[0.6, 0.8]], [480])
    assert one == [0.6, 0.8]
    combined = aggregate_chunk_vectors([[1.0, 0.0], [0.0, 1.0]], [1, 3])
    assert math.isclose(combined[0], 1 / math.sqrt(10), rel_tol=1e-12)
    assert math.isclose(combined[1], 3 / math.sqrt(10), rel_tol=1e-12)
    assert math.isclose(math.sqrt(sum(value * value for value in combined)), 1.0, rel_tol=1e-12)


def test_cosine_similarity_normalizes_vector_magnitude() -> None:
    assert cosine_similarity([3, 4], [0, 5]) == 0.8


def test_reference_set_covers_exactly_the_current_area_taxonomy() -> None:
    references = load_reference_set()
    assert set(references.descriptions) == set(AREA_PROFILES)


def test_long_text_diagnostic_is_not_added_to_the_public_semantic_contract() -> None:
    schema_path = Path(__file__).resolve().parents[3] / "packages" / "schemas" / "semantic_analysis_v1.schema.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    assert "embedding_rerank_diagnostic" not in json.dumps(schema, ensure_ascii=False)


def test_long_text_policy_artifact_is_pinned_to_the_implemented_policy() -> None:
    policy_path = Path(__file__).resolve().parents[1] / "config" / "semantic" / "area_embedding_long_text_policy_v1.json"
    policy = json.loads(policy_path.read_text(encoding="utf-8"))
    assert policy["policyVersion"] == "area_embedding_long_text_policy_v1"
    assert policy["model"] == {
        "modelId": "intfloat/multilingual-e5-small",
        "revision": "fd1525a9fd15316a2d503bf26ab031a61d056e98",
    }
    assert policy["chunking"] == {"overlapSourceTokens": 0, "sourceTokenBudget": 480}
    assert policy["effectiveModelTokenLimit"] == MAX_INPUT_TOKENS


def test_weighted_rank_fusion_changes_order_only_after_existing_candidates() -> None:
    candidates = [_candidate("A", 10), _candidate("B", 9), _candidate("C", 8)]
    ordered, diagnostic = rerank_existing_area_candidates(
        candidates,
        "texto original",
        _enabled(),
        embedder=FakeEmbedder([[1, 0], [0.1, math.sqrt(0.99)], [0.9, math.sqrt(0.19)], [0.8, 0.6]]),
        references=_references("A", "B", "C"),
    )
    assert [item["area"] for item in ordered] == ["B", "C", "A"]
    assert diagnostic["applied"] is True
    assert diagnostic["candidates"][0] == {
        "area": "B",
        "lexical_rank": 2,
        "lexical_score": 9,
        "cosine": 0.9,
        "embedding_rank": 1,
        "combined_rank_score": 0.9,
    }


def test_multiple_chunks_are_encoded_then_aggregated_with_internal_diagnostics() -> None:
    candidates = [_candidate("A", 10), _candidate("B", 9)]
    plan = ChunkPlan(("primer chunk", "segundo chunk"), (1, 3), (4, 4))
    ordered, diagnostic = rerank_existing_area_candidates(
        candidates,
        "texto original largo",
        _enabled(),
        embedder=PlannedFakeEmbedder(
            [[1, 0], [0, 1], [0.9, math.sqrt(0.19)], [0.1, math.sqrt(0.99)]], plan
        ),
        references=_references("A", "B"),
    )
    assert [item["area"] for item in ordered] == ["B", "A"]
    assert diagnostic["longTextPolicyVersion"] == "area_embedding_long_text_policy_v1"
    assert diagnostic["sourceTokenCount"] == 4
    assert diagnostic["chunkCount"] == 2
    assert diagnostic["chunkSourceTokenCounts"] == [1, 3]
    assert diagnostic["aggregationMethod"] == "token_weighted_mean_then_l2_normalize"


def test_any_chunk_failure_returns_the_exact_lexical_baseline() -> None:
    candidates = [_candidate("A", 10), _candidate("B", 9)]
    ordered, diagnostic = rerank_existing_area_candidates(
        candidates,
        "texto original",
        _enabled(),
        embedder=PlannedFakeEmbedder([], raises=True),
        references=_references("A", "B"),
    )
    assert ordered is candidates
    assert diagnostic["applied"] is False
    assert diagnostic["fallback_reason"] == "chunk_tokenization_failure"


def test_missing_local_model_returns_the_exact_lexical_baseline() -> None:
    candidates = [_candidate("A", 10), _candidate("B", 9)]
    settings = AreaEmbeddingSettings(True, 0.5, 0.01, Path("/definitely-missing-model"))
    ordered, diagnostic = rerank_existing_area_candidates(
        candidates, "texto original", settings, references=_references("A", "B")
    )
    assert ordered is candidates
    assert diagnostic["fallback_reason"] == "model_or_reference_failure"


def test_runtime_uses_the_frozen_zero_relative_margin_even_when_a_setting_attempts_an_override() -> None:
    candidates = [_candidate("A", 10), _candidate("B", 9)]
    ordered, diagnostic = rerank_existing_area_candidates(
        candidates,
        "texto original",
        _enabled(margin=0.2),
        embedder=FakeEmbedder([[1, 0], [0.2, math.sqrt(0.96)], [0.1, math.sqrt(0.99)]]),
        references=_references("A", "B"),
    )
    assert diagnostic["applied"] is True
    assert [item["area"] for item in ordered] == ["A", "B"]


def test_combined_rank_tie_uses_lexical_rank_as_final_tie_break() -> None:
    candidates = [_candidate("A", 10), _candidate("B", 6), _candidate("C", 8), _candidate("D", 7), _candidate("E", 9)]
    ordered, diagnostic = rerank_existing_area_candidates(
        candidates,
        "texto original",
        _enabled(lambda_weight=0.5, margin=0.01),
        embedder=FakeEmbedder(
            [
                [1, 0],
                [0.1, math.sqrt(0.99)],
                [0.2, math.sqrt(0.96)],
                [0.3, math.sqrt(0.91)],
                [0.4, math.sqrt(0.84)],
                [0.5, math.sqrt(0.75)],
            ]
        ),
        references=_references("A", "B", "C", "D", "E"),
    )
    assert diagnostic["applied"] is True
    assert [item["area"] for item in ordered][-2:] == ["A", "B"]


def test_disabled_and_failure_paths_return_the_exact_baseline_candidate_sequence() -> None:
    candidates = [_candidate("A", 10), _candidate("B", 9)]
    disabled, disabled_diagnostic = rerank_existing_area_candidates(
        candidates, "texto original", AreaEmbeddingSettings(enabled=False)
    )
    failed, failed_diagnostic = rerank_existing_area_candidates(
        candidates,
        "texto original",
        _enabled(),
        embedder=FakeEmbedder([], raises=True),
        references=_references("A", "B"),
    )
    assert disabled is candidates
    assert failed is candidates
    assert disabled_diagnostic["fallback_reason"] == "feature_disabled"
    assert failed_diagnostic["fallback_reason"] == "model_or_reference_failure"


def test_invalid_configuration_has_an_explicit_internal_fallback_reason() -> None:
    candidates = [_candidate("A", 10), _candidate("B", 9)]
    ordered, diagnostic = rerank_existing_area_candidates(
        candidates,
        "texto original",
        AreaEmbeddingSettings(configuration_error="invalid_configuration"),
    )
    assert ordered is candidates
    assert diagnostic["fallback_reason"] == "invalid_configuration"


def test_invalid_or_unplannable_input_does_not_get_truncated_for_reranking() -> None:
    candidates = [_candidate("A", 10), _candidate("B", 9)]
    invalid, invalid_diagnostic = rerank_existing_area_candidates(
        candidates, "", _enabled(), embedder=FakeEmbedder([]), references=_references("A", "B")
    )
    too_long, too_long_diagnostic = rerank_existing_area_candidates(
        candidates,
        "texto original",
        _enabled(),
        embedder=FakeEmbedder([], token_count=513),
        references=_references("A", "B"),
    )
    assert invalid is candidates
    assert too_long is candidates
    assert invalid_diagnostic["fallback_reason"] == "invalid_source_text"
    assert too_long_diagnostic["fallback_reason"] == "chunk_planner_unavailable"


def test_empty_and_single_candidate_sets_are_baseline_only() -> None:
    empty, empty_diagnostic = rerank_existing_area_candidates([], "texto", _enabled())
    one = [_candidate("A", 10)]
    single, single_diagnostic = rerank_existing_area_candidates(one, "texto", _enabled())
    assert empty == []
    assert empty_diagnostic["fallback_reason"] == "insufficient_candidates"
    assert single is one
    assert single_diagnostic["fallback_reason"] == "insufficient_candidates"


def test_runtime_configuration_uses_frozen_calibration_and_ignores_environment_overrides() -> None:
    assert load_settings({"AI_AREA_EMBEDDINGS_ENABLED": "false"}).enabled is False
    settings = load_settings(
        {
            "AI_AREA_EMBEDDINGS_ENABLED": "true",
            "AI_AREA_EMBEDDINGS_LAMBDA": "0.4",
            "AI_AREA_EMBEDDINGS_RELATIVE_MARGIN": "0.1",
            "AI_AREA_EMBEDDINGS_MODEL_DIR": "/models/e5",
        }
    )
    assert settings.lambda_weight == AREA_EMBEDDING_LAMBDA == 0.8
    assert settings.relative_margin == AREA_EMBEDDING_RELATIVE_MARGIN == 0.0
    invalid_override_settings = load_settings(
        {
            "AI_AREA_EMBEDDINGS_ENABLED": "true",
            "AI_AREA_EMBEDDINGS_LAMBDA": "not-a-number",
            "AI_AREA_EMBEDDINGS_RELATIVE_MARGIN": "also-not-a-number",
            "AI_AREA_EMBEDDINGS_MODEL_DIR": "/models/e5",
        }
    )
    assert invalid_override_settings.lambda_weight == AREA_EMBEDDING_LAMBDA
    assert invalid_override_settings.relative_margin == AREA_EMBEDDING_RELATIVE_MARGIN


def test_disabled_feature_never_initializes_the_local_model(monkeypatch) -> None:
    candidates = [_candidate("A", 10), _candidate("B", 9)]

    def fail_if_called(model_dir: Path):
        raise AssertionError(f"model must not load while disabled: {model_dir}")

    monkeypatch.setattr(reranker, "_get_local_embedder", fail_if_called)
    ordered, diagnostic = rerank_existing_area_candidates(
        candidates,
        "texto original",
        load_settings({"AI_AREA_EMBEDDINGS_ENABLED": "false"}),
    )
    assert ordered is candidates
    assert diagnostic["fallback_reason"] == "feature_disabled"


def test_reference_initialization_is_singleton_under_concurrent_access(monkeypatch) -> None:
    resolved = reranker.REFERENCES_PATH.resolve()
    with reranker._REFERENCE_CACHE_LOCK:
        reranker._REFERENCE_CACHE.pop(resolved, None)
    original_load = reranker.json.load
    calls = 0

    def counted_load(handle):
        nonlocal calls
        calls += 1
        time.sleep(0.01)
        return original_load(handle)

    monkeypatch.setattr(reranker.json, "load", counted_load)
    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(lambda _: load_reference_set(), range(8)))
    assert calls == 1
    assert all(result is results[0] for result in results)


def test_model_initialization_is_singleton_under_concurrent_access(monkeypatch) -> None:
    model_dir = Path("concurrency-test-model").resolve()
    resolved = model_dir
    with reranker._MODEL_CACHE_LOCK:
        reranker._MODEL_CACHE.pop(resolved, None)
    calls = 0

    class StubEmbedder:
        def __init__(self, path: Path) -> None:
            nonlocal calls
            calls += 1
            time.sleep(0.01)
            self.path = path

    monkeypatch.setattr(reranker, "LocalE5Embedder", StubEmbedder)
    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(lambda _: reranker._get_local_embedder(model_dir), range(8)))
    assert calls == 1
    assert all(result is results[0] for result in results)


def test_local_loader_rejects_an_unpinned_model_manifest_before_importing_ml_dependencies() -> None:
    with (
        patch("src.area_embedding_reranker.Path.is_dir", return_value=True),
        patch(
            "src.area_embedding_reranker.Path.read_text",
            return_value='{"modelId":"intfloat/multilingual-e5-small","revision":"other"}',
        ),
    ):
        try:
            LocalE5Embedder(Path("/models/e5"))
        except ValueError as exc:
            assert "pinned model revision" in str(exc)
        else:
            raise AssertionError("unpinning the local model must fail")
