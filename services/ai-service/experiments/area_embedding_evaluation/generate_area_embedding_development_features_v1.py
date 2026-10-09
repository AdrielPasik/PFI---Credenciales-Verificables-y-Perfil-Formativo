#!/usr/bin/env python3
"""Generate frozen E5 features for Development without reading human labels.

This module consumes only the frozen Development IDs, lexical candidate order,
and original source fields from the evaluation corpus.  It does not calculate a
hybrid score, prediction, gold-based metric, or any Holdout document embedding.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import statistics
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any, Sequence


EXPECTED = {
    "protocol": "752a9a06f40e59ad1b068914d689fcfd70378c02359a453990b514e79488b16d",
    "split": "f735f20cbee775184e93cbab57f1024ea9b5fa6988f26c41c9b4f67157acf4e0",
    "baseline_raw": "f369132ca27c0f11f20e38a5b29c6a65d996db2934417a3c2b99fe66496f46ca",
    "implementation_freeze": "047f0e07a8618b5081dee4b0d08a5defbaaf8b8eecf120d8857589e86391b355",
    "corpus": "955156c451a46f80ded8b72a28f4d5ce95dd4f793a1e2cef254d24d18e2bb0c1",
    "prototype": "a2e5010cd64a4534039b1e919c7b6169bce9029f25056975217bf42dc181c55c",
    "long_text": "1319e903ae818b2a0290dc3b952e7f4ca89a15621c4dc176b27fd0c7197f4cc1",
    "model_weights": "1a55775f53449dac10a2bcbc312469fac40b96d53198c407081a831f81c98477",
}
MODEL_ID = "intfloat/multilingual-e5-small"
MODEL_REVISION = "fd1525a9fd15316a2d503bf26ab031a61d056e98"
MODEL_DIR = Path(r"C:\Users\Personal\Downloads\scope-e5-local\intfloat--multilingual-e5-small--fd1525a9fd15316a2d503bf26ab031a61d056e98")


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical_bytes(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode("utf-8")


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def percentiles(values: Sequence[float | int]) -> dict[str, float | int]:
    if not values:
        return {"min": 0, "p50": 0, "p90": 0, "p95": 0, "max": 0}
    ordered = sorted(values)

    def nearest_rank(fraction: float) -> float | int:
        return ordered[max(0, math.ceil(fraction * len(ordered)) - 1)]

    return {
        "min": ordered[0],
        "p50": nearest_rank(0.50),
        "p90": nearest_rank(0.90),
        "p95": nearest_rank(0.95),
        "max": ordered[-1],
    }


def source_paths(directory: Path) -> dict[str, Path]:
    service_root = directory.parents[1]
    return {
        "protocol": directory / "area_embedding_development_calibration_protocol_v1.json",
        "split": directory / "area_embedding_dev_holdout_split_v1.json",
        "baseline_raw": directory / "area_embedding_development_baseline_raw_v1.json",
        "implementation_freeze": directory / "area_embedding_evaluation_implementation_v1.freeze.json",
        "corpus": directory / "area_embedding_evaluation_corpus_v1.json",
        "references": service_root / "config" / "semantic" / "area_embedding_references_v1.json",
        "long_text_policy": service_root / "config" / "semantic" / "area_embedding_long_text_policy_v1.json",
        "reranker": service_root / "src" / "area_embedding_reranker.py",
    }


def verify_preflight(directory: Path) -> tuple[dict[str, Path], dict[str, str]]:
    paths = source_paths(directory)
    hashes = {name: file_hash(path) for name, path in paths.items() if name not in {"references", "long_text_policy", "reranker"}}
    for key in ("protocol", "split", "baseline_raw", "implementation_freeze", "corpus"):
        if hashes[key] != EXPECTED[key]:
            raise ValueError(f"Frozen hash mismatch: {key}")
    if file_hash(paths["references"]) != EXPECTED["prototype"]:
        raise ValueError("Frozen prototype reference hash mismatch")
    if file_hash(paths["long_text_policy"]) != EXPECTED["long_text"]:
        raise ValueError("Frozen long-text policy hash mismatch")
    protocol = load_json(paths["protocol"])
    if protocol.get("encoder") != MODEL_ID or protocol.get("encoderRevision") != MODEL_REVISION:
        raise ValueError("Calibration protocol encoder identity mismatch")
    if protocol.get("encoderWeightsSha256") != EXPECTED["model_weights"]:
        raise ValueError("Calibration protocol weights mismatch")
    if protocol.get("prototypeReferencesSha256") != EXPECTED["prototype"]:
        raise ValueError("Calibration protocol prototype linkage mismatch")
    if protocol.get("longTextPolicySha256") != EXPECTED["long_text"]:
        raise ValueError("Calibration protocol long-text linkage mismatch")
    if not MODEL_DIR.is_dir():
        raise ValueError("Local E5 snapshot is unavailable")
    manifest = load_json(MODEL_DIR / "pfi-model-manifest.json")
    config = load_json(MODEL_DIR / "config.json")
    if manifest.get("modelId") != MODEL_ID or manifest.get("revision") != MODEL_REVISION:
        raise ValueError("Local E5 manifest mismatch")
    if file_hash(MODEL_DIR / "model.safetensors") != EXPECTED["model_weights"]:
        raise ValueError("Local E5 weights mismatch")
    if config.get("hidden_size") != 384:
        raise ValueError("Local E5 dimension mismatch")
    return paths, hashes


def l2_norm(vector: Sequence[float]) -> float:
    return math.sqrt(sum(float(value) * float(value) for value in vector))


def is_finite_vector(vector: Sequence[float]) -> bool:
    return bool(vector) and all(math.isfinite(float(value)) for value in vector)


def source_fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def generate(directory: Path, features_output: Path, summary_output: Path) -> tuple[dict[str, Any], dict[str, Any], dict[str, float]]:
    paths, hashes = verify_preflight(directory)
    split = load_json(paths["split"])
    development_ids = split.get("developmentCaseIds")
    holdout_ids = set(split.get("holdoutCaseIds") or [])
    if not isinstance(development_ids, list) or len(development_ids) != 77 or len(set(development_ids)) != 77:
        raise ValueError("Frozen Development case IDs are invalid")
    if set(development_ids) & holdout_ids:
        raise ValueError("Split has Development/Holdout overlap")
    raw = load_json(paths["baseline_raw"])
    raw_records = raw.get("records")
    if not isinstance(raw_records, list) or raw.get("splitSha256") != hashes["split"]:
        raise ValueError("Frozen baseline raw artifact mismatch")
    raw_by_id = {record.get("caseId"): record for record in raw_records if isinstance(record, dict)}
    if set(raw_by_id) != set(development_ids) or len(raw_by_id) != 77:
        raise ValueError("Baseline raw candidates are not exactly Development")
    corpus = load_json(paths["corpus"])
    corpus_by_id = {case["caseId"]: case for case in corpus["cases"]}
    if set(development_ids) - set(corpus_by_id):
        raise ValueError("Development corpus case missing")

    # Enforce offline local-only behavior before any embedding dependency loads.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    service_root = paths["reranker"].parents[1]
    if str(service_root) not in sys.path:
        sys.path.insert(0, str(service_root))
    from src.area_embedding_reranker import (
        AGGREGATION_METHOD,
        MODEL_ID as IMPLEMENTATION_MODEL_ID,
        MODEL_REVISION as IMPLEMENTATION_MODEL_REVISION,
        QUERY_PREFIX,
        LocalE5Embedder,
        aggregate_chunk_vectors,
        build_area_embedding_source,
        cosine_similarity,
        load_reference_set,
    )

    if IMPLEMENTATION_MODEL_ID != MODEL_ID or IMPLEMENTATION_MODEL_REVISION != MODEL_REVISION:
        raise ValueError("Frozen implementation model constants mismatch")
    load_start = time.perf_counter()
    embedder = LocalE5Embedder(MODEL_DIR)
    cold_load_seconds = time.perf_counter() - load_start
    if getattr(embedder._model.config, "hidden_size", None) != 384:
        raise ValueError("Loaded model dimension mismatch")

    reference_set = load_reference_set()
    if len(reference_set.descriptions) != 69:
        raise ValueError("Frozen reference set does not contain 69 prototypes")
    prototype_areas = sorted(reference_set.descriptions)
    prototype_start = time.perf_counter()
    prototype_vectors = embedder.encode([QUERY_PREFIX + reference_set.descriptions[area] for area in prototype_areas])
    prototype_seconds = time.perf_counter() - prototype_start
    if len(prototype_vectors) != 69:
        raise ValueError("Prototype encoding count mismatch")
    prototypes: dict[str, Sequence[float]] = {}
    prototype_status: list[dict[str, Any]] = []
    for area, description, vector in zip(prototype_areas, (reference_set.descriptions[a] for a in prototype_areas), prototype_vectors):
        norm = l2_norm(vector)
        if len(vector) != 384 or not is_finite_vector(vector) or abs(norm - 1.0) > 1e-5:
            raise ValueError(f"Prototype encoding invalid: {area}")
        prototypes[area] = vector
        prototype_status.append(
            {
                "area": area,
                "contentSha256": source_fingerprint(description),
                "dimension": len(vector),
                "l2Norm": round(norm, 9),
                "encodingStatus": "SUCCESS",
            }
        )

    records: list[dict[str, Any]] = []
    document_latencies: list[float] = []
    total_start = time.perf_counter()
    for case_id in development_ids:
        raw_record = raw_by_id[case_id]
        candidates = raw_record.get("candidateAreas") or []
        if not isinstance(candidates, list):
            raise ValueError(f"Candidate list invalid for {case_id}")
        if candidates != [entry.get("area") for entry in raw_record.get("lexicalCandidates", [])]:
            raise ValueError(f"Candidate order mismatch inside frozen raw artifact for {case_id}")
        if any(area not in prototypes for area in candidates):
            raise ValueError(f"Candidate lacks frozen prototype: {case_id}")
        case = corpus_by_id[case_id]
        raw_sections = {
            "objectives_raw": str(case.get("objectivesRaw", "")),
            "minimum_contents_raw": str(case.get("minimumContentsRaw", "")),
            "conceptual_contents_raw": str(case.get("conceptualContentsRaw", "")),
            "procedural_contents_raw": str(case.get("proceduralContentsRaw", "")),
            "attitudinal_contents_raw": str(case.get("attitudinalContentsRaw", "")),
            "contents_raw": str(case.get("contentsRaw", "")),
        }
        source = build_area_embedding_source(str(case["courseName"]), raw_sections)
        if not source:
            raise ValueError(f"Empty frozen embedding source: {case_id}")
        item_start = time.perf_counter()
        available = False
        failure: str | None = None
        plan = None
        document_vector: Sequence[float] | None = None
        try:
            plan = embedder.plan_source_chunks(source)
            if not plan.chunks or any(value > 512 for value in plan.effective_token_counts):
                raise ValueError("invalid_chunk_plan")
            chunk_vectors = embedder.encode([QUERY_PREFIX + chunk for chunk in plan.chunks])
            if len(chunk_vectors) != len(plan.chunks) or any(
                len(vector) != 384 or not is_finite_vector(vector) or abs(l2_norm(vector) - 1.0) > 1e-5
                for vector in chunk_vectors
            ):
                raise ValueError("invalid_chunk_embedding")
            document_vector = aggregate_chunk_vectors(chunk_vectors, plan.source_token_counts)
            if len(document_vector) != 384 or not is_finite_vector(document_vector) or abs(l2_norm(document_vector) - 1.0) > 1e-5:
                raise ValueError("invalid_document_embedding")
            available = True
        except Exception as exc:
            failure = f"embedding_failure:{type(exc).__name__}"
        document_latencies.append(time.perf_counter() - item_start)
        candidate_features: list[dict[str, Any]] = []
        record: dict[str, Any] = {
            "caseId": case_id,
            "candidateCount": len(candidates),
            "embeddingAvailable": available,
            "technicalFallbackReason": failure,
            "sourceFingerprint": source_fingerprint(source),
            "sourceTokenCount": plan.source_token_count if plan is not None else None,
            "chunkCount": len(plan.chunks) if plan is not None else None,
            "chunkTokenCounts": list(plan.source_token_counts) if plan is not None else None,
            "maximumEffectiveChunkTokens": max(plan.effective_token_counts) if plan is not None else None,
            "aggregationMethod": AGGREGATION_METHOD if available else None,
            "finalVectorDimension": len(document_vector) if document_vector is not None else None,
            "finalVectorNorm": round(l2_norm(document_vector), 9) if document_vector is not None else None,
            "candidates": candidate_features,
        }
        if available and document_vector is not None:
            for lexical_rank, area in enumerate(candidates, start=1):
                cosine = cosine_similarity(document_vector, prototypes[area])
                if not math.isfinite(cosine):
                    raise ValueError(f"Invalid candidate cosine: {case_id}/{area}")
                candidate_features.append(
                    {"area": area, "lexicalRank": lexical_rank, "cosine": round(cosine, 9)}
                )
            ordered = sorted(candidate_features, key=lambda item: (-item["cosine"], item["lexicalRank"]))
            for embedding_rank, item in enumerate(ordered, start=1):
                item["embeddingRank"] = embedding_rank
            # Restore frozen lexical candidate order after assigning rank fields.
            candidate_features.sort(key=lambda item: item["lexicalRank"])
            if candidate_features:
                top = ordered[0]
                record["semanticTop1Area"] = top["area"]
                record["semanticTop1Cosine"] = top["cosine"]
            if len(ordered) >= 2:
                second = ordered[1]
                record["semanticTop2Area"] = second["area"]
                record["semanticTop2Cosine"] = second["cosine"]
                record["relativeSemanticSeparation"] = round(top["cosine"] - second["cosine"], 9)
            else:
                record["relativeSemanticSeparation"] = "NOT_APPLICABLE"
        else:
            record["relativeSemanticSeparation"] = "NOT_APPLICABLE"
        records.append(record)
    total_document_seconds = time.perf_counter() - total_start

    if len(records) != 77 or set(record["caseId"] for record in records) != set(development_ids):
        raise ValueError("Feature generation did not cover exactly Development")
    if set(record["caseId"] for record in records) & holdout_ids:
        raise ValueError("Holdout document embedding detected")
    features = {
        "schemaVersion": "area_embedding_development_features_v1",
        "experimentId": "scope-area-embedding-evaluation-v1",
        "calibrationProtocolSha256": hashes["protocol"],
        "splitSha256": hashes["split"],
        "baselineRawSha256": hashes["baseline_raw"],
        "implementationFreezeSha256": hashes["implementation_freeze"],
        "model": MODEL_ID,
        "modelRevision": MODEL_REVISION,
        "modelWeightsSha256": EXPECTED["model_weights"],
        "dimensions": 384,
        "referencesVersion": reference_set.version,
        "prototypeSha256": EXPECTED["prototype"],
        "longTextPolicySha256": EXPECTED["long_text"],
        "developmentCount": 77,
        "holdoutDocumentsEmbedded": 0,
        "prototypeEncoding": prototype_status,
        "records": records,
    }
    features_output.write_bytes(canonical_bytes(features))
    available_records = [record for record in records if record["embeddingAvailable"]]
    all_cosines = [item["cosine"] for record in available_records for item in record["candidates"]]
    separations = [
        record["relativeSemanticSeparation"]
        for record in available_records
        if isinstance(record["relativeSemanticSeparation"], (float, int))
    ]
    norms = [record["finalVectorNorm"] for record in available_records if record["finalVectorNorm"] is not None]
    tokens = [record["sourceTokenCount"] for record in available_records if record["sourceTokenCount"] is not None]
    chunks = [record["chunkCount"] for record in available_records if record["chunkCount"] is not None]
    reasons = Counter(record["technicalFallbackReason"] for record in records if record["technicalFallbackReason"])
    summary = {
        "schemaVersion": "area_embedding_development_features_summary_v1",
        "experimentId": "scope-area-embedding-evaluation-v1",
        "calibrationProtocolSha256": hashes["protocol"],
        "featuresArtifactSha256": file_hash(features_output),
        "totalCases": 77,
        "embeddingAvailableCases": len(available_records),
        "embeddingUnavailableCases": 77 - len(available_records),
        "totalCandidateComparisons": len(all_cosines),
        "sourceTokenCount": percentiles(tokens),
        "chunkCount": percentiles(chunks),
        "maximumEffectiveChunkTokens": max(
            (record["maximumEffectiveChunkTokens"] or 0 for record in available_records), default=0
        ),
        "documentNorm": {"min": min(norms) if norms else None, "max": max(norms) if norms else None},
        "candidateCosine": percentiles(all_cosines),
        "relativeSemanticSeparation": percentiles(separations),
        "technicalFallbackReasons": dict(sorted(reasons.items())),
        "frozenBaselineContext": {
            "baselineCandidateGenerationMisses": 19,
            "baselineRankingErrors": 18,
            "baselineFinalGateOrPolicyErrors": 5,
        },
        "qualityMetricsIncluded": False,
    }
    summary_output.write_bytes(canonical_bytes(summary))
    operational = {
        "coldModelLoadSeconds": cold_load_seconds,
        "prototypeEncodingSeconds": prototype_seconds,
        "totalDevelopmentEmbeddingSeconds": total_document_seconds,
        "meanDocumentEmbeddingSeconds": statistics.mean(document_latencies) if document_latencies else 0.0,
    }
    return features, summary, operational


def compare_features(first: dict[str, Any], second: dict[str, Any]) -> tuple[float, float, bool]:
    first_by_id = {record["caseId"]: record for record in first["records"]}
    second_by_id = {record["caseId"]: record for record in second["records"]}
    if set(first_by_id) != set(second_by_id):
        return math.inf, math.inf, False
    max_cosine_delta = 0.0
    max_norm_delta = 0.0
    for case_id in first_by_id:
        left, right = first_by_id[case_id], second_by_id[case_id]
        if (
            left["candidateCount"] != right["candidateCount"]
            or left["chunkCount"] != right["chunkCount"]
            or left["chunkTokenCounts"] != right["chunkTokenCounts"]
            or [item["area"] for item in left["candidates"]] != [item["area"] for item in right["candidates"]]
            or [item.get("embeddingRank") for item in left["candidates"]] != [item.get("embeddingRank") for item in right["candidates"]]
        ):
            return math.inf, math.inf, False
        if left["finalVectorNorm"] is not None:
            max_norm_delta = max(max_norm_delta, abs(left["finalVectorNorm"] - right["finalVectorNorm"]))
        for left_item, right_item in zip(left["candidates"], right["candidates"]):
            max_cosine_delta = max(max_cosine_delta, abs(left_item["cosine"] - right_item["cosine"]))
    return max_cosine_delta, max_norm_delta, True


def main() -> int:
    directory = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--features-output", type=Path, default=directory / "area_embedding_development_features_v1.json")
    parser.add_argument("--summary-output", type=Path, default=directory / "area_embedding_development_features_summary_v1.json")
    args = parser.parse_args()
    try:
        features, _, operational = generate(directory, args.features_output, args.summary_output)
        print(
            json.dumps(
                {
                    "featuresSha256": file_hash(args.features_output),
                    "summarySha256": file_hash(args.summary_output),
                    "availableDocuments": sum(record["embeddingAvailable"] for record in features["records"]),
                    "operationalOnly": operational,
                },
                sort_keys=True,
            )
        )
    except (OSError, ValueError, RuntimeError, KeyError, TypeError) as exc:
        print(f"INVALID: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
