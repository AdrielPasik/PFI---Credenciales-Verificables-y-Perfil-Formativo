#!/usr/bin/env python3
"""Generate and evaluate the sealed lexical baseline on Development only.

``generate`` never reads human annotation data.  It invokes the frozen semantic
builder with the embedding feature explicitly disabled and writes a raw output
artifact for every Development case.  ``evaluate`` reads that immutable raw
artifact only after generation, joins it to human gold, and produces metrics.
Neither command loads an embedding backend or executes a Holdout case.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


EXPECTED = {
    "human_gold": "a670013b72402e3921e7f930bd3f35abbb4975f556da2b8a3d96f6a4e278c082",
    "gold_freeze": "9ca55ee211994ad7d0fd730fb9372000be0e4577426b1a597538517a75218323",
    "split_protocol": "e0149cb050a0d34d9721ff1a4b9a69c390bb78e68d53bc8603d6deda6cf6ac8f",
    "split": "f735f20cbee775184e93cbab57f1024ea9b5fa6988f26c41c9b4f67157acf4e0",
    "holdout_seal": "667368f6e48a7d979313916d83d0fda662ef0d030cdde412443030b3fe713c25",
    "implementation_freeze": "047f0e07a8618b5081dee4b0d08a5defbaaf8b8eecf120d8857589e86391b355",
    "corpus": "955156c451a46f80ded8b72a28f4d5ce95dd4f793a1e2cef254d24d18e2bb0c1",
    "annotation_packet": "2f6099f3e035615eafcdaf2141809b2a2ac556db52b24adca194550e0327445c",
    "prototype_freeze_content": "a2e5010cd64a4534039b1e919c7b6169bce9029f25056975217bf42dc181c55c",
    "long_text_policy_freeze_content": "1319e903ae818b2a0290dc3b952e7f4ca89a15621c4dc176b27fd0c7197f4cc1",
    "semantic_builder": "cc95355851acf8ac14076dbf7ebaa507aad8efb51dbc3872f67da5083e69edb7",
    "area_embedding_reranker": "5283cb0ca3f48ad0a63b10704dcb1036e0c174ee2fbed01c57df7cf34a93706c",
}
STATUSES = ("CLEAR", "BOUNDARY", "MULTIDISCIPLINARY", "NO_FIT")
CONFIDENCES = ("HIGH", "MEDIUM", "LOW")


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical_bytes(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode("utf-8")


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def source_paths(directory: Path) -> dict[str, Path]:
    service_root = directory.parents[1]
    return {
        "human_gold": directory / "area_embedding_human_annotations_v1.json",
        "gold_freeze": directory / "area_embedding_human_gold_v1.freeze.json",
        "split_protocol": directory / "area_embedding_dev_holdout_split_protocol_v1.json",
        "split": directory / "area_embedding_dev_holdout_split_v1.json",
        "holdout_seal": directory / "area_embedding_holdout_seal_v1.json",
        "implementation_freeze": directory / "area_embedding_evaluation_implementation_v1.freeze.json",
        "corpus": directory / "area_embedding_evaluation_corpus_v1.json",
        "annotation_packet": directory / "area_embedding_human_annotation_packet_v1.json",
        "prototype_freeze": service_root / "config" / "semantic" / "area_embedding_references_v1.freeze.json",
        "long_text_policy_freeze": service_root / "config" / "semantic" / "area_embedding_long_text_policy_v1.freeze.json",
        "semantic_builder": service_root / "src" / "semantic_builder.py",
        "area_embedding_reranker": service_root / "src" / "area_embedding_reranker.py",
        "settings": service_root / "config" / "settings.json",
    }


def verify_frozen_state(directory: Path) -> tuple[dict[str, Path], dict[str, str]]:
    paths = source_paths(directory)
    actual = {name: file_hash(path) for name, path in paths.items() if name != "settings"}
    expected_file_hashes = {
        key: value
        for key, value in EXPECTED.items()
        if key not in {"prototype_freeze_content", "long_text_policy_freeze_content"}
    }
    for name, expected in expected_file_hashes.items():
        if actual[name] != expected:
            raise ValueError(f"Frozen artifact drift: {name}.")
    prototype = load_json(paths["prototype_freeze"])
    long_text = load_json(paths["long_text_policy_freeze"])
    implementation = load_json(paths["implementation_freeze"])
    gold_freeze = load_json(paths["gold_freeze"])
    if prototype.get("sha256") != EXPECTED["prototype_freeze_content"]:
        raise ValueError("Frozen prototype definition drift.")
    if long_text.get("sha256") != EXPECTED["long_text_policy_freeze_content"]:
        raise ValueError("Frozen long-text policy drift.")
    if gold_freeze.get("humanGold", {}).get("sha256") != actual["human_gold"]:
        raise ValueError("Human gold freeze linkage mismatch.")
    if implementation.get("implementation", {}).get("semanticBuilderSha256") != actual["semantic_builder"]:
        raise ValueError("Implementation freeze semantic builder linkage mismatch.")
    if implementation.get("implementation", {}).get("areaEmbeddingRerankerSha256") != actual["area_embedding_reranker"]:
        raise ValueError("Implementation freeze reranker linkage mismatch.")
    return paths, actual


def development_ids_only(split: dict[str, Any]) -> tuple[list[str], set[str]]:
    development = split.get("developmentCaseIds")
    holdout = split.get("holdoutCaseIds")
    if not isinstance(development, list) or not isinstance(holdout, list):
        raise ValueError("Split artifact does not contain case lists.")
    if len(development) != 77 or len(holdout) != 39 or len(set(development)) != 77:
        raise ValueError("Split counts or Development identities are invalid.")
    if set(development) & set(holdout):
        raise ValueError("Split artifact contains a cross-split case overlap.")
    return list(development), set(holdout)


def candidate_from_case(case: dict[str, Any]) -> Any:
    # Imported late so Phase A can first establish embedding-off process guards.
    from src.models import CourseCandidate

    codes = case.get("courseCodes") or []
    course_code = codes[0] if isinstance(codes, list) and codes else None
    course_name = str(case["courseName"])
    return CourseCandidate(
        course_code=course_code,
        name=course_name,
        title_extracted=course_name,
        title_normalized=course_name,
        title_quality_status="as_extracted",
        hours_total=None,
        source_file=str(case["sourcePdfPath"]),
        raw_sections={
            "objectives_raw": str(case.get("objectivesRaw", "")),
            "minimum_contents_raw": str(case.get("minimumContentsRaw", "")),
            "conceptual_contents_raw": str(case.get("conceptualContentsRaw", "")),
            "procedural_contents_raw": str(case.get("proceduralContentsRaw", "")),
            "attitudinal_contents_raw": str(case.get("attitudinalContentsRaw", "")),
            "contents_raw": str(case.get("contentsRaw", "")),
        },
    )


def assert_embedding_not_loaded(reranker: Any) -> None:
    if reranker._MODEL_CACHE or reranker._REFERENCE_CACHE:
        raise RuntimeError("Embedding cache was populated during baseline generation.")
    if any(module == "torch" or module.startswith("torch.") for module in sys.modules):
        raise RuntimeError("Embedding model dependency torch was loaded during baseline generation.")
    if any(module == "transformers" or module.startswith("transformers.") for module in sys.modules):
        raise RuntimeError("Embedding tokenizer dependency transformers was loaded during baseline generation.")


def generate(directory: Path, output: Path) -> dict[str, Any]:
    paths, hashes = verify_frozen_state(directory)
    split = load_json(paths["split"])
    development_ids, holdout_ids = development_ids_only(split)
    corpus = load_json(paths["corpus"])
    cases_by_id = {case["caseId"]: case for case in corpus["cases"]}
    if set(development_ids) - set(cases_by_id):
        raise ValueError("A Development case is absent from frozen corpus.")
    if set(development_ids) & holdout_ids:
        raise ValueError("Harness guard rejected a Holdout case.")

    # Set the experimental process state before importing semantic code.
    os.environ["AI_AREA_EMBEDDINGS_ENABLED"] = "false"
    service_root = paths["semantic_builder"].parents[1]
    if str(service_root) not in sys.path:
        sys.path.insert(0, str(service_root))
    from src import area_embedding_reranker as reranker
    from src import semantic_builder

    assert_embedding_not_loaded(reranker)
    settings = load_json(paths["settings"])
    max_objectives = int(settings["max_objectives"])
    max_contents = int(settings["max_contents"])
    original_infer = semantic_builder.infer_areas_with_validation
    records: list[dict[str, Any]] = []
    try:
        for case_id in development_ids:
            captured: dict[str, Any] = {}

            def capture_inference(*args: Any, **kwargs: Any) -> dict[str, Any]:
                result = original_infer(*args, **kwargs)
                captured["areaInference"] = copy.deepcopy(result)
                return result

            semantic_builder.infer_areas_with_validation = capture_inference
            try:
                semantic_output = semantic_builder.build_semantic_output(
                    candidate_from_case(cases_by_id[case_id]), max_objectives, max_contents
                )
            finally:
                semantic_builder.infer_areas_with_validation = original_infer
            inference = captured.get("areaInference")
            if not isinstance(inference, dict):
                raise RuntimeError(f"Instrumentation did not capture lexical inference for {case_id}.")
            diagnostic = inference.get("embedding_rerank_diagnostic", {})
            assert_embedding_not_loaded(reranker)
            ranked = inference.get("ranked_candidates") or []
            if not isinstance(ranked, list):
                raise RuntimeError(f"Invalid lexical candidates for {case_id}.")
            if ranked:
                if diagnostic.get("applied") is not False or diagnostic.get("fallback_reason") != "feature_disabled":
                    raise RuntimeError(f"Embedding guard was not honored for {case_id}.")
                embedding_fallback_reason = "feature_disabled"
            else:
                # The lexical classifier may return before reranking when its
                # candidate gates yield no valid area.  That path has no model
                # interaction and is itself a baseline outcome to retain.
                if diagnostic:
                    raise RuntimeError(f"Unexpected embedding diagnostic without candidates for {case_id}.")
                embedding_fallback_reason = "no_lexical_candidates"
            candidate_areas = [entry.get("area") for entry in ranked if isinstance(entry, dict) and entry.get("area")]
            final_areas = semantic_output.get("areas") or []
            final_area = final_areas[0] if final_areas and final_areas[0] != "unresolved_domain_candidate" else None
            records.append(
                {
                    "caseId": case_id,
                    "candidateAreas": candidate_areas,
                    "lexicalCandidates": [
                        {
                            "area": entry["area"],
                            "validatedAreaScore": entry["validated_area_score"],
                            "rawAreaSignalScore": entry["raw_area_signal_score"],
                            "strongHits": entry["strong_hits"],
                            "totalHits": entry["total_hits"],
                            "contextUnique": entry["context_unique"],
                            "contextSectionHits": entry["context_section_hits"],
                            "validationFlags": entry["validation_flags"],
                        }
                        for entry in ranked
                    ],
                    "lexicalTop1": candidate_areas[0] if candidate_areas else None,
                    "finalBaselineArea": final_area,
                    "finalAreas": final_areas,
                    "classificationState": "CLASSIFIED" if final_area else "NO_CLASSIFICATION",
                    "qualityFlags": semantic_output.get("quality_flags", {}),
                    "technicalState": {
                        "embeddingFeatureEnabled": False,
                        "embeddingRerankApplied": False,
                        "embeddingFallbackReason": embedding_fallback_reason,
                        "embeddingModelLoaded": False,
                        "embeddingTokenizerLoaded": False,
                        "prototypeVectorsGenerated": False,
                        "cosineSimilarityExecuted": False,
                    },
                }
            )
    finally:
        semantic_builder.infer_areas_with_validation = original_infer
    assert_embedding_not_loaded(reranker)
    evaluated_ids = [record["caseId"] for record in records]
    if evaluated_ids != development_ids or len(set(evaluated_ids)) != 77:
        raise RuntimeError("Generation did not produce exactly the frozen Development sequence.")
    if set(evaluated_ids) & holdout_ids:
        raise RuntimeError("A Holdout case was executed.")
    raw = {
        "schemaVersion": "area_embedding_development_baseline_raw_v1",
        "experimentId": "scope-area-embedding-evaluation-v1",
        "splitSha256": hashes["split"],
        "humanGoldSha256": hashes["human_gold"],
        "implementationFreezeSha256": hashes["implementation_freeze"],
        "corpusSha256": hashes["corpus"],
        "embeddingsEnabled": False,
        "generationInput": {
            "caseCount": 77,
            "evaluatedCaseIds": evaluated_ids,
            "holdoutCasesExecuted": 0,
            "pipelineLimits": {"maxObjectives": max_objectives, "maxContents": max_contents},
            "settingsSha256": file_hash(paths["settings"]),
        },
        "embeddingExecutionGuard": {
            "featureFlag": "AI_AREA_EMBEDDINGS_ENABLED=false",
            "modelLoaded": False,
            "tokenizerLoaded": False,
            "prototypeVectorsGenerated": False,
            "cosineSimilarityExecuted": False,
            "hybridRankFusionExecuted": False,
        },
        "records": records,
    }
    output.write_bytes(canonical_bytes(raw))
    return raw


def metric_breakdown(items: list[dict[str, Any]]) -> dict[str, Any]:
    count = len(items)
    correct = sum(item["exactPrimaryCorrect"] for item in items)
    in_candidates = sum(item["goldPrimaryInCandidateSet"] for item in items)
    top2 = sum(item["top2ContainsPrimary"] for item in items)
    return {
        "n": count,
        "top1Correct": correct,
        "top1Accuracy": round(correct / count, 6) if count else None,
        "goldInCandidateSetCount": in_candidates,
        "goldInCandidateSetRate": round(in_candidates / count, 6) if count else None,
        "recallAt2": round(top2 / count, 6) if count else None,
        "sparsity": "SPARSE_GROUP" if count < 3 else "SUFFICIENT_SUPPORT",
    }


def evaluate(directory: Path, raw_path: Path, evaluation_output: Path, summary_output: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    paths, hashes = verify_frozen_state(directory)
    split = load_json(paths["split"])
    development_ids, holdout_ids = development_ids_only(split)
    raw = load_json(raw_path)
    if raw.get("splitSha256") != hashes["split"] or raw.get("humanGoldSha256") != hashes["human_gold"]:
        raise ValueError("Raw artifact does not link to frozen split and gold.")
    if raw.get("embeddingsEnabled") is not False or raw.get("embeddingExecutionGuard", {}).get("modelLoaded"):
        raise ValueError("Raw artifact is not a verified embeddings-off baseline.")
    records = raw.get("records")
    if not isinstance(records, list):
        raise ValueError("Raw artifact has no records.")
    raw_by_id = {record.get("caseId"): record for record in records if isinstance(record, dict)}
    if len(records) != 77 or len(raw_by_id) != 77 or set(raw_by_id) != set(development_ids):
        raise ValueError("Raw artifact does not contain exactly frozen Development outputs.")
    if set(raw_by_id) & holdout_ids:
        raise ValueError("Raw artifact contains Holdout output.")

    gold = load_json(paths["human_gold"])
    gold_by_id = {annotation["caseId"]: annotation for annotation in gold}
    corpus = load_json(paths["corpus"])
    family_by_id = {case["caseId"]: case["disciplinaryFamily"] for case in corpus["cases"]}
    evaluation_records: list[dict[str, Any]] = []
    for case_id in development_ids:
        raw_record = raw_by_id[case_id]
        annotation = gold_by_id[case_id]
        candidates = list(raw_record.get("candidateAreas") or [])
        gold_primary = annotation["primaryArea"]
        rank = candidates.index(gold_primary) + 1 if gold_primary in candidates else None
        final_area = raw_record.get("finalBaselineArea")
        exact = final_area == gold_primary
        top2 = gold_primary in candidates[:2]
        secondary = annotation["acceptableSecondaryAreas"]
        secondary_acceptable = bool(not exact and final_area in secondary)
        if exact:
            error = None
        elif not candidates or rank is None:
            error = "CANDIDATE_GENERATION_MISS"
        elif rank > 1:
            error = "RANKING_ERROR"
        elif rank == 1 and final_area != gold_primary:
            error = "FINAL_GATE_OR_POLICY_ERROR"
        elif final_area is None:
            error = "NO_CLASSIFICATION"
        else:
            error = "OTHER_UNRESOLVED"
        evaluation_records.append(
            {
                "caseId": case_id,
                "humanPrimaryArea": gold_primary,
                "humanAcceptableSecondaryAreas": secondary,
                "annotationStatus": annotation["annotationStatus"],
                "annotationConfidence": annotation["annotationConfidence"],
                "samplingFamily": family_by_id[case_id],
                "candidateAreas": candidates,
                "candidateCount": len(candidates),
                "goldPrimaryInCandidateSet": rank is not None,
                "goldPrimaryCandidateRank": rank if rank is not None else "NOT_PRESENT",
                "lexicalTop1": raw_record.get("lexicalTop1"),
                "finalBaselineArea": final_area,
                "exactPrimaryCorrect": exact,
                "top2ContainsPrimary": top2,
                "predictedTop1IsAcceptableSecondary": secondary_acceptable,
                "errorCategory": error,
            }
        )
    if len(evaluation_records) != 77 or set(record["caseId"] for record in evaluation_records) & holdout_ids:
        raise RuntimeError("Evaluation case guard failed.")

    total = len(evaluation_records)
    correct = sum(record["exactPrimaryCorrect"] for record in evaluation_records)
    in_candidates = sum(record["goldPrimaryInCandidateSet"] for record in evaluation_records)
    top2 = sum(record["top2ContainsPrimary"] for record in evaluation_records)
    candidates_distribution = Counter(record["candidateCount"] for record in evaluation_records)
    errors = Counter(record["errorCategory"] for record in evaluation_records if record["errorCategory"])
    family_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    status_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    confidence_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    primary_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in evaluation_records:
        family_groups[record["samplingFamily"]].append(record)
        status_groups[record["annotationStatus"]].append(record)
        confidence_groups[record["annotationConfidence"]].append(record)
        primary_groups[record["humanPrimaryArea"]].append(record)
    confusion = Counter(
        (record["humanPrimaryArea"], record["finalBaselineArea"] or "NO_CLASSIFICATION")
        for record in evaluation_records
        if not record["exactPrimaryCorrect"]
    )
    evaluation = {
        "schemaVersion": "area_embedding_development_baseline_evaluation_v1",
        "experimentId": "scope-area-embedding-evaluation-v1",
        "splitSha256": hashes["split"],
        "humanGoldSha256": hashes["human_gold"],
        "implementationFreezeSha256": hashes["implementation_freeze"],
        "embeddingsEnabled": False,
        "developmentCount": 77,
        "holdoutCasesExecuted": 0,
        "rawArtifactSha256": file_hash(raw_path),
        "records": evaluation_records,
    }
    summary = {
        "schemaVersion": "area_embedding_development_baseline_summary_v1",
        "experimentId": "scope-area-embedding-evaluation-v1",
        "splitSha256": hashes["split"],
        "humanGoldSha256": hashes["human_gold"],
        "implementationFreezeSha256": hashes["implementation_freeze"],
        "rawArtifactSha256": file_hash(raw_path),
        "totalCases": total,
        "exactTop1Correct": correct,
        "exactTop1Incorrect": total - correct,
        "exactTop1Accuracy": round(correct / total, 6),
        "recallAt2": round(top2 / total, 6),
        "goldInCandidateSetCount": in_candidates,
        "goldInCandidateSetRate": round(in_candidates / total, 6),
        "candidateGenerationMissCount": errors["CANDIDATE_GENERATION_MISS"],
        "rankingErrorCount": errors["RANKING_ERROR"],
        "finalGateOrPolicyErrorCount": errors["FINAL_GATE_OR_POLICY_ERROR"],
        "noClassificationCount": sum(record["finalBaselineArea"] is None for record in evaluation_records),
        "otherErrorCount": errors["OTHER_UNRESOLVED"],
        "candidateCountDistribution": {
            "mean": round(sum(record["candidateCount"] for record in evaluation_records) / total, 6),
            "median": sorted(record["candidateCount"] for record in evaluation_records)[total // 2],
            "min": min(record["candidateCount"] for record in evaluation_records),
            "max": max(record["candidateCount"] for record in evaluation_records),
            "zeroCandidateCases": candidates_distribution[0],
            "oneCandidateCases": candidates_distribution[1],
            "twoPlusCandidateCases": sum(value for key, value in candidates_distribution.items() if key >= 2),
            "histogram": {str(key): candidates_distribution[key] for key in sorted(candidates_distribution)},
        },
        "familyBreakdown": {key: metric_breakdown(value) for key, value in sorted(family_groups.items())},
        "annotationStatusBreakdown": {key: metric_breakdown(status_groups[key]) for key in STATUSES if key in status_groups},
        "annotationConfidenceBreakdown": {key: metric_breakdown(confidence_groups[key]) for key in CONFIDENCES if key in confidence_groups},
        "primaryAreaBreakdown": {key: metric_breakdown(value) for key, value in sorted(primary_groups.items())},
        "confusionPairs": [
            {"humanPrimaryArea": source, "predictedFinalArea": predicted, "count": count}
            for (source, predicted), count in sorted(confusion.items(), key=lambda item: (-item[1], item[0]))
        ],
        "secondaryAwareDiagnostic": {
            "primaryExactCorrect": correct,
            "secondaryAcceptableButPrimaryWrong": sum(record["predictedTop1IsAcceptableSecondary"] for record in evaluation_records),
            "outsideHumanAcceptableSet": sum(
                not record["exactPrimaryCorrect"] and not record["predictedTop1IsAcceptableSecondary"]
                for record in evaluation_records
            ),
        },
        "notes": {
            "goldInCandidateSetRate": "Empirical reranking ceiling indicator for existing valid lexical candidates; not a mathematical ceiling because post-gates may alter final output.",
            "primaryMetric": "FINAL_TOP1_EXACT_AREA_ACCURACY",
            "secondaryAreas": "Diagnostic only; they never replace primary exact correctness.",
        },
    }
    evaluation_output.write_bytes(canonical_bytes(evaluation))
    summary["evaluationArtifactSha256"] = file_hash(evaluation_output)
    summary_output.write_bytes(canonical_bytes(summary))
    return evaluation, summary


def main() -> int:
    directory = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    generation = subparsers.add_parser("generate")
    generation.add_argument("--output", type=Path, default=directory / "area_embedding_development_baseline_raw_v1.json")
    evaluation = subparsers.add_parser("evaluate")
    evaluation.add_argument("--raw", type=Path, default=directory / "area_embedding_development_baseline_raw_v1.json")
    evaluation.add_argument("--evaluation-output", type=Path, default=directory / "area_embedding_development_baseline_evaluation_v1.json")
    evaluation.add_argument("--summary-output", type=Path, default=directory / "area_embedding_development_baseline_summary_v1.json")
    args = parser.parse_args()
    try:
        if args.command == "generate":
            raw = generate(directory, args.output)
            print(json.dumps({"rawSha256": file_hash(args.output), "generatedCases": len(raw["records"]), "holdoutCasesExecuted": 0}, sort_keys=True))
        else:
            _, summary = evaluate(directory, args.raw, args.evaluation_output, args.summary_output)
            print(json.dumps({"evaluationSha256": file_hash(args.evaluation_output), "summarySha256": file_hash(args.summary_output), "totalCases": summary["totalCases"]}, sort_keys=True))
    except (OSError, ValueError, RuntimeError, KeyError, TypeError) as exc:
        print(f"INVALID: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
