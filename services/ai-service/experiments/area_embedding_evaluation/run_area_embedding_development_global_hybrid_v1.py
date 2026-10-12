#!/usr/bin/env python3
"""Evaluate the frozen 72-configuration global hybrid grid on Development.

Generation consumes only frozen lexical candidates and frozen E5 features.  It
does not import an encoder, tokenizer, or cosine function.  A temporary
in-memory callback supplies a frozen candidate order to the existing
``semantic_builder`` downstream area policy; no production file is changed.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Callable


EXPECTED = {
    "human_gold": "a670013b72402e3921e7f930bd3f35abbb4975f556da2b8a3d96f6a4e278c082",
    "split": "f735f20cbee775184e93cbab57f1024ea9b5fa6988f26c41c9b4f67157acf4e0",
    "holdout_seal": "667368f6e48a7d979313916d83d0fda662ef0d030cdde412443030b3fe713c25",
    "baseline_raw": "f369132ca27c0f11f20e38a5b29c6a65d996db2934417a3c2b99fe66496f46ca",
    "baseline_evaluation": "d1ba00b1ddb4a02ec66cb1011cedc87b823b8766a4ac048977e9eab6b328481f",
    "baseline_summary": "a1b5946dc13a64f99be7de3f26615d8303fe7d8bd0c507ad926c4c3573d0e7f8",
    "calibration_protocol": "752a9a06f40e59ad1b068914d689fcfd70378c02359a453990b514e79488b16d",
    "features": "1842b197a5191507b48f72b97ccabc7a5b8d0b25432dd5dcf2dd44494521db47",
    "features_summary": "43934bc7c6ca7b2a61948b1fe50e87e3353ad0ee7edcf39032e0a57e46077513",
    "implementation_freeze": "047f0e07a8618b5081dee4b0d08a5defbaaf8b8eecf120d8857589e86391b355",
    "corpus": "955156c451a46f80ded8b72a28f4d5ce95dd4f793a1e2cef254d24d18e2bb0c1",
    "prototype": "a2e5010cd64a4534039b1e919c7b6169bce9029f25056975217bf42dc181c55c",
    "long_text": "1319e903ae818b2a0290dc3b952e7f4ca89a15621c4dc176b27fd0c7197f4cc1",
    "semantic_builder": "cc95355851acf8ac14076dbf7ebaa507aad8efb51dbc3872f67da5083e69edb7",
    "reranker": "5283cb0ca3f48ad0a63b10704dcb1036e0c174ee2fbed01c57df7cf34a93706c",
}
STATUSES = ("CLEAR", "BOUNDARY", "MULTIDISCIPLINARY", "NO_FIT")
CONFIDENCES = ("HIGH", "MEDIUM", "LOW")


def h(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def canonical_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def paths(directory: Path) -> dict[str, Path]:
    service = directory.parents[1]
    return {
        "human_gold": directory / "area_embedding_human_annotations_v1.json",
        "split": directory / "area_embedding_dev_holdout_split_v1.json",
        "holdout_seal": directory / "area_embedding_holdout_seal_v1.json",
        "baseline_raw": directory / "area_embedding_development_baseline_raw_v1.json",
        "baseline_evaluation": directory / "area_embedding_development_baseline_evaluation_v1.json",
        "baseline_summary": directory / "area_embedding_development_baseline_summary_v1.json",
        "calibration_protocol": directory / "area_embedding_development_calibration_protocol_v1.json",
        "features": directory / "area_embedding_development_features_v1.json",
        "features_summary": directory / "area_embedding_development_features_summary_v1.json",
        "implementation_freeze": directory / "area_embedding_evaluation_implementation_v1.freeze.json",
        "corpus": directory / "area_embedding_evaluation_corpus_v1.json",
        "prototype": service / "config" / "semantic" / "area_embedding_references_v1.json",
        "long_text": service / "config" / "semantic" / "area_embedding_long_text_policy_v1.json",
        "semantic_builder": service / "src" / "semantic_builder.py",
        "reranker": service / "src" / "area_embedding_reranker.py",
    }


def verify(directory: Path) -> tuple[dict[str, Path], dict[str, str]]:
    file_paths = paths(directory)
    hashes = {name: h(path) for name, path in file_paths.items()}
    for name, expected in EXPECTED.items():
        if hashes[name] != expected:
            raise ValueError(f"Frozen artifact drift: {name}")
    protocol = load(file_paths["calibration_protocol"])
    if protocol.get("globalConfigurations") != 72 or len(protocol.get("lambdaGrid", [])) != 9 or len(protocol.get("relativeMarginGrid", [])) != 8:
        raise ValueError("Frozen calibration protocol grid mismatch")
    if protocol.get("splitSha256") != hashes["split"] or protocol.get("baselineRawSha256") != hashes["baseline_raw"]:
        raise ValueError("Calibration protocol linkage mismatch")
    features = load(file_paths["features"])
    if features.get("calibrationProtocolSha256") != hashes["calibration_protocol"]:
        raise ValueError("Feature artifact calibration protocol linkage mismatch")
    if features.get("splitSha256") != hashes["split"] or features.get("baselineRawSha256") != hashes["baseline_raw"]:
        raise ValueError("Feature artifact baseline linkage mismatch")
    return file_paths, hashes


def final_area(result: dict[str, Any]) -> str | None:
    areas = result.get("areas") or []
    return areas[0] if areas and areas[0] != "unresolved_domain_candidate" else None


def prepare_inputs(semantic_builder: Any, corpus_cases: list[dict[str, Any]]) -> tuple[dict[str, dict[str, Any]], dict[tuple[str, str], str]]:
    prepared: dict[str, dict[str, Any]] = {}
    source_identity: dict[tuple[str, str], str] = {}
    for case in corpus_cases:
        raw_sections = {
            "objectives_raw": str(case.get("objectivesRaw", "")),
            "minimum_contents_raw": str(case.get("minimumContentsRaw", "")),
            "conceptual_contents_raw": str(case.get("conceptualContentsRaw", "")),
            "procedural_contents_raw": str(case.get("proceduralContentsRaw", "")),
            "attitudinal_contents_raw": str(case.get("attitudinalContentsRaw", "")),
            "contents_raw": str(case.get("contentsRaw", "")),
        }
        objectives = semantic_builder.build_objectives(raw_sections, 5)
        contents = semantic_builder.build_contents(raw_sections, 12)
        preliminary_keywords = semantic_builder.build_keywords(raw_sections, objectives, contents, concepts=[])
        concepts = semantic_builder.build_detected_concepts(raw_sections, max_items=24, keywords=preliminary_keywords)
        keywords = semantic_builder.build_keywords(raw_sections, objectives, contents, concepts=concepts)
        name = str(case["courseName"])
        source_file = str(case["sourcePdfPath"])
        identity = (name, source_file)
        if identity in source_identity:
            raise ValueError("Development source identity collision prevents safe instrumentation")
        source_identity[identity] = case["caseId"]
        prepared[case["caseId"]] = {
            "name": name,
            "source_file": source_file,
            "objectives": objectives,
            # The frozen production call passes detected concepts in the
            # ``contents`` positional slot.  Preserve that invocation exactly;
            # infer_areas_with_validation has no ``concepts`` keyword.
            "contents": concepts,
            "keywords": keywords,
            "transversal_noise_risk": semantic_builder.build_transversal_noise_risk(raw_sections.get("objectives_raw", "")),
            "embedding_source_text": semantic_builder.build_area_embedding_source(name, raw_sections),
        }
    return prepared, source_identity


def evaluate_final_path(
    *,
    semantic_builder: Any,
    lexical_sort_key: Callable[[dict[str, Any]], Any],
    prepared: dict[str, dict[str, Any]],
    source_identity: dict[tuple[str, str], str],
    raw_by_id: dict[str, dict[str, Any]],
    override_order_by_case: dict[str, list[str]] | None,
) -> dict[str, dict[str, Any]]:
    """Run frozen post-candidate policy with lexical or frozen-fused candidate order."""

    original = semantic_builder.rerank_existing_area_candidates
    observed: dict[str, dict[str, Any]] = {}

    def injected_reranker(candidates: list[dict[str, Any]], source_text: str, settings: Any, **kwargs: Any) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        # infer_areas_with_validation has already constructed/gated all lexical
        # candidates.  The callback only supplies an order from frozen features.
        active_name = kwargs.pop("_unused_name", None)
        del active_name
        case_id = None
        # name/source are unavailable in callback; infer wrapper sets this local.
        case_id = current_case["caseId"]
        lexical = sorted(candidates, key=lexical_sort_key, reverse=True)
        lexical_areas = [item["area"] for item in lexical]
        expected_areas = raw_by_id[case_id]["candidateAreas"]
        if lexical_areas != expected_areas:
            raise ValueError(f"Frozen lexical candidate universe/order drift: {case_id}")
        if override_order_by_case is None or not expected_areas:
            observed[case_id] = {"lexicalAreas": lexical_areas, "returnedAreas": lexical_areas, "applied": False}
            return candidates, {"applied": False, "fallback_reason": "sentinel_lexical_order"}
        requested = override_order_by_case[case_id]
        if set(requested) != set(lexical_areas) or len(requested) != len(lexical_areas):
            raise ValueError(f"Frozen feature candidate universe mismatch: {case_id}")
        by_area = {item["area"]: item for item in candidates}
        ordered = [by_area[area] for area in requested]
        observed[case_id] = {"lexicalAreas": lexical_areas, "returnedAreas": requested, "applied": requested != lexical_areas}
        # applied=True bypasses the lexical sort in frozen infer_areas logic.
        return ordered, {"applied": True, "fallback_reason": None}

    current_case: dict[str, str] = {}
    semantic_builder.rerank_existing_area_candidates = injected_reranker
    try:
        for case_id, values in prepared.items():
            current_case["caseId"] = case_id
            result = semantic_builder.infer_areas_with_validation(**values)
            observed.setdefault(case_id, {"lexicalAreas": [], "returnedAreas": [], "applied": False})
            observed[case_id]["finalArea"] = final_area(result)
            observed[case_id]["classificationState"] = "CLASSIFIED" if observed[case_id]["finalArea"] else "NO_CLASSIFICATION"
    finally:
        semantic_builder.rerank_existing_area_candidates = original
    return observed


def fused_order(feature: dict[str, Any], lambda_weight: float, margin: float) -> tuple[list[str], bool, bool, str | None]:
    candidates = feature["candidates"]
    lexical = [item["area"] for item in candidates]
    if len(candidates) < 2:
        return lexical, False, False, "insufficient_candidates"
    if not feature["embeddingAvailable"]:
        return lexical, False, True, "embedding_unavailable"
    separation = feature.get("relativeSemanticSeparation")
    if not isinstance(separation, (float, int)):
        return lexical, False, False, "relative_separation_not_applicable"
    if separation < margin:
        return lexical, False, False, "relative_margin_not_met"
    count = len(candidates)
    scores: list[tuple[str, float, int]] = []
    for item in candidates:
        lexical_rank = int(item["lexicalRank"])
        embedding_rank = int(item["embeddingRank"])
        lexical_score = 1.0 - ((lexical_rank - 1) / (count - 1))
        embedding_score = 1.0 - ((embedding_rank - 1) / (count - 1))
        combined = (1.0 - lambda_weight) * lexical_score + lambda_weight * embedding_score
        scores.append((item["area"], combined, lexical_rank))
    ordered = [area for area, _, _ in sorted(scores, key=lambda value: (-value[1], value[2]))]
    return ordered, True, False, None


def generate(directory: Path, output: Path) -> dict[str, Any]:
    file_paths, hashes = verify(directory)
    # Keep production's optional feature disabled; the callback never invokes it.
    os.environ["AI_AREA_EMBEDDINGS_ENABLED"] = "false"
    service_root = file_paths["semantic_builder"].parents[1]
    if str(service_root) not in sys.path:
        sys.path.insert(0, str(service_root))
    from src import area_embedding_reranker as reranker
    from src import semantic_builder

    if reranker._MODEL_CACHE or reranker._REFERENCE_CACHE:
        raise RuntimeError("Embedding cache is populated before calibration")
    if any(name == "torch" or name.startswith("torch.") or name == "transformers" or name.startswith("transformers.") for name in sys.modules):
        raise RuntimeError("Embedding runtime is unexpectedly loaded")
    split = load(file_paths["split"])
    development_ids = split["developmentCaseIds"]
    holdout_ids = set(split["holdoutCaseIds"])
    raw = load(file_paths["baseline_raw"])
    features = load(file_paths["features"])
    protocol = load(file_paths["calibration_protocol"])
    if len(development_ids) != 77 or set(development_ids) & holdout_ids:
        raise ValueError("Invalid frozen split")
    raw_by_id = {record["caseId"]: record for record in raw["records"]}
    feature_by_id = {record["caseId"]: record for record in features["records"]}
    if set(raw_by_id) != set(development_ids) or set(feature_by_id) != set(development_ids):
        raise ValueError("Baseline raw/features do not cover exactly Development")
    corpus_by_id = {case["caseId"]: case for case in load(file_paths["corpus"])["cases"]}
    prepared, source_identity = prepare_inputs(semantic_builder, [corpus_by_id[case_id] for case_id in development_ids])
    # Sentinel: return exact lexical order through the same frozen downstream
    # policy.  No gold is loaded in this phase.
    sentinel = evaluate_final_path(
        semantic_builder=semantic_builder,
        lexical_sort_key=reranker._lexical_sort_key,
        prepared=prepared,
        source_identity=source_identity,
        raw_by_id=raw_by_id,
        override_order_by_case=None,
    )
    for case_id in development_ids:
        raw_record = raw_by_id[case_id]
        if sentinel[case_id]["lexicalAreas"] != raw_record["candidateAreas"]:
            raise ValueError(f"Hybrid sentinel candidate order mismatch: {case_id}")
        if sentinel[case_id]["finalArea"] != raw_record["finalBaselineArea"]:
            raise ValueError(f"Hybrid sentinel final output mismatch: {case_id}")
        if sentinel[case_id]["classificationState"] != raw_record["classificationState"]:
            raise ValueError(f"Hybrid sentinel classification state mismatch: {case_id}")
    lambda_grid = protocol["lambdaGrid"]
    margin_grid = protocol["relativeMarginGrid"]
    configs = [(float(lam), float(margin)) for lam in lambda_grid for margin in margin_grid]
    if len(configs) != 72:
        raise ValueError("Calibration protocol does not define 72 configurations")
    config_outputs: list[dict[str, Any]] = []
    for lambda_weight, margin in configs:
        overrides: dict[str, list[str]] = {}
        per_case: dict[str, dict[str, Any]] = {}
        for case_id in development_ids:
            feature = feature_by_id[case_id]
            order, applied, technical, fallback = fused_order(feature, lambda_weight, margin)
            overrides[case_id] = order
            per_case[case_id] = {
                "caseId": case_id,
                "lambda": lambda_weight,
                "relativeMargin": margin,
                "candidateCount": feature["candidateCount"],
                "embeddingAvailable": feature["embeddingAvailable"],
                "relativeSemanticSeparation": feature.get("relativeSemanticSeparation"),
                "marginPassed": applied,
                "rerankApplied": applied,
                "lexicalTop1": raw_by_id[case_id]["lexicalTop1"],
                "fusedTop1BeforePostGates": order[0] if order else None,
                "candidateRanking": order,
                "candidateRankingChanged": order != raw_by_id[case_id]["candidateAreas"],
                "baselineFinalArea": raw_by_id[case_id]["finalBaselineArea"],
                "technicalFallback": technical,
                "fallbackReason": fallback,
            }
        downstream = evaluate_final_path(
            semantic_builder=semantic_builder,
            lexical_sort_key=reranker._lexical_sort_key,
            prepared=prepared,
            source_identity=source_identity,
            raw_by_id=raw_by_id,
            override_order_by_case=overrides,
        )
        for case_id in development_ids:
            record = per_case[case_id]
            record["hybridFinalArea"] = downstream[case_id]["finalArea"]
            record["finalOutputChanged"] = record["hybridFinalArea"] != record["baselineFinalArea"]
        config_outputs.append({"lambda": lambda_weight, "relativeMargin": margin, "records": [per_case[case_id] for case_id in development_ids]})
    if len(config_outputs) != 72 or sum(len(config["records"]) for config in config_outputs) != 5544:
        raise ValueError("Hybrid generation count mismatch")
    if reranker._MODEL_CACHE or reranker._REFERENCE_CACHE:
        raise RuntimeError("Embedding cache was populated during calibration")
    if any(name == "torch" or name.startswith("torch.") or name == "transformers" or name.startswith("transformers.") for name in sys.modules):
        raise RuntimeError("Embedding runtime loaded during calibration")
    raw_artifact = {
        "schemaVersion": "area_embedding_development_global_hybrid_raw_v1",
        "experimentId": "scope-area-embedding-evaluation-v1",
        "calibrationProtocolSha256": hashes["calibration_protocol"],
        "featuresSha256": hashes["features"],
        "baselineRawSha256": hashes["baseline_raw"],
        "splitSha256": hashes["split"],
        "developmentCount": 77,
        "holdoutCasesExecuted": 0,
        "hybridHarnessEquivalence": {"passed": True, "matchingFinalAreas": 77, "matchingClassificationStates": 77},
        "configurations": config_outputs,
    }
    output.write_bytes(canonical_bytes(raw_artifact))
    return raw_artifact


def breakdown(records: list[dict[str, Any]]) -> dict[str, Any]:
    n = len(records)
    return {
        "n": n,
        "exactTop1Correct": sum(record["exactPrimaryCorrect"] for record in records),
        "exactTop1Accuracy": round(sum(record["exactPrimaryCorrect"] for record in records) / n, 6) if n else None,
        "correctRescues": sum(record["outcomeCategory"] == "CORRECT_RESCUE" for record in records),
        "harmfulFlips": sum(record["outcomeCategory"] == "HARMFUL_FLIP" for record in records),
        "sparsity": "SPARSE_GROUP" if n < 3 else "SUFFICIENT_SUPPORT",
    }


def evaluate(directory: Path, raw_path: Path, grid_output: Path, winner_output: Path, freeze_output: Path) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    file_paths, hashes = verify(directory)
    raw = load(raw_path)
    if raw.get("calibrationProtocolSha256") != hashes["calibration_protocol"] or raw.get("featuresSha256") != hashes["features"]:
        raise ValueError("Hybrid raw artifact linkage mismatch")
    configs = raw.get("configurations")
    if not isinstance(configs, list) or len(configs) != 72 or sum(len(item.get("records", [])) for item in configs) != 5544:
        raise ValueError("Hybrid raw artifact does not contain 72x77 outputs")
    split = load(file_paths["split"])
    development_ids = split["developmentCaseIds"]
    holdout_ids = set(split["holdoutCaseIds"])
    if any({record["caseId"] for record in config["records"]} != set(development_ids) for config in configs):
        raise ValueError("A hybrid configuration does not cover exactly Development")
    if any(set(record["caseId"] for record in config["records"]) & holdout_ids for config in configs):
        raise ValueError("Hybrid raw artifact includes Holdout")
    gold = load(file_paths["human_gold"])
    gold_by_id = {annotation["caseId"]: annotation for annotation in gold}
    corpus_by_id = {case["caseId"]: case for case in load(file_paths["corpus"])["cases"]}
    baseline = load(file_paths["baseline_raw"])
    baseline_by_id = {record["caseId"]: record for record in baseline["records"]}
    baseline_correct = 35
    evaluations: list[dict[str, Any]] = []
    winner_case_records_by_config: dict[tuple[float, float], list[dict[str, Any]]] = {}
    for config in configs:
        lambda_weight, margin = config["lambda"], config["relativeMargin"]
        enriched: list[dict[str, Any]] = []
        for raw_record in config["records"]:
            case_id = raw_record["caseId"]
            gold_item = gold_by_id[case_id]
            primary = gold_item["primaryArea"]
            baseline_area = raw_record["baselineFinalArea"]
            hybrid_area = raw_record["hybridFinalArea"]
            exact = hybrid_area == primary
            baseline_exact = baseline_area == primary
            if not baseline_exact and exact:
                outcome = "CORRECT_RESCUE"
            elif baseline_exact and not exact:
                outcome = "HARMFUL_FLIP"
            elif not baseline_exact and not exact and hybrid_area != baseline_area:
                outcome = "NEUTRAL_WRONG_CHANGE"
            elif exact:
                outcome = "UNCHANGED_CORRECT"
            else:
                outcome = "UNCHANGED_WRONG"
            enriched.append({
                **raw_record,
                "humanPrimaryArea": primary,
                "annotationStatus": gold_item["annotationStatus"],
                "samplingFamily": corpus_by_id[case_id]["disciplinaryFamily"],
                "exactPrimaryCorrect": exact,
                "top2ContainsPrimary": primary in raw_record["candidateRanking"][:2],
                "goldPrimaryInCandidateSet": primary in raw_record["candidateRanking"],
                "outcomeCategory": outcome,
            })
        correct = sum(record["exactPrimaryCorrect"] for record in enriched)
        rescues = sum(record["outcomeCategory"] == "CORRECT_RESCUE" for record in enriched)
        harmful = sum(record["outcomeCategory"] == "HARMFUL_FLIP" for record in enriched)
        neutral = sum(record["outcomeCategory"] == "NEUTRAL_WRONG_CHANGE" for record in enriched)
        if correct != baseline_correct + rescues - harmful:
            raise ValueError("Evaluator accounting identity failed")
        if sum(record["goldPrimaryInCandidateSet"] for record in enriched) != 54:
            raise ValueError("Candidate universe changed from frozen baseline")
        family = defaultdict(list); status = defaultdict(list)
        for record in enriched:
            family[record["samplingFamily"]].append(record)
            status[record["annotationStatus"]].append(record)
        metrics = {
            "lambda": lambda_weight,
            "relativeMargin": margin,
            "exactTop1Correct": correct,
            "exactTop1Accuracy": round(correct / 77, 6),
            "recallAt2": round(sum(record["top2ContainsPrimary"] for record in enriched) / 77, 6),
            "correctRescues": rescues,
            "harmfulFlips": harmful,
            "neutralWrongChanges": neutral,
            "netBenefit": rescues - harmful,
            "rerankEligibleCount": sum(record["rerankApplied"] for record in enriched),
            "candidateTop1ChangedCount": sum(record["candidateRankingChanged"] for record in enriched),
            "finalOutputChangedCount": sum(record["finalOutputChanged"] for record in enriched),
            "technicalFallbackCount": sum(record["technicalFallback"] for record in enriched),
            "familyBreakdown": {key: breakdown(value) for key, value in sorted(family.items())},
            "annotationStatusBreakdown": {key: breakdown(value) for key, value in sorted(status.items())},
        }
        evaluations.append(metrics)
        winner_case_records_by_config[(lambda_weight, margin)] = enriched
    ranked = sorted(
        evaluations,
        key=lambda item: (-item["exactTop1Correct"], item["harmfulFlips"], -item["correctRescues"], item["lambda"], -item["relativeMargin"]),
    )
    for rank, item in enumerate(ranked, start=1):
        item["selectionRank"] = rank
    grid = {
        "schemaVersion": "area_embedding_development_global_hybrid_grid_v1",
        "experimentId": "scope-area-embedding-evaluation-v1",
        "calibrationProtocolSha256": hashes["calibration_protocol"],
        "featuresSha256": hashes["features"],
        "baselineEvaluationSha256": hashes["baseline_evaluation"],
        "humanGoldSha256": hashes["human_gold"],
        "splitSha256": hashes["split"],
        "configurationsEvaluated": 72,
        "developmentCases": 77,
        "holdoutCasesExecuted": 0,
        "configurations": ranked,
    }
    grid_output.write_bytes(canonical_bytes(grid))
    winner_metrics = ranked[0]
    winner_key = (winner_metrics["lambda"], winner_metrics["relativeMargin"])
    winner_cases = winner_case_records_by_config[winner_key]
    acceptance = winner_metrics["exactTop1Correct"] > 35 and winner_metrics["correctRescues"] > winner_metrics["harmfulFlips"]
    winner = {
        "schemaVersion": "area_embedding_development_global_hybrid_winner_v1",
        "experimentId": "scope-area-embedding-evaluation-v1",
        "selectedLambda": winner_metrics["lambda"],
        "selectedRelativeMargin": winner_metrics["relativeMargin"],
        "baselineCorrect": 35,
        "baselineAccuracy": round(35 / 77, 6),
        "hybridCorrect": winner_metrics["exactTop1Correct"],
        "hybridAccuracy": winner_metrics["exactTop1Accuracy"],
        "absoluteAccuracyDelta": round((winner_metrics["exactTop1Correct"] - 35) / 77, 6),
        "relativeErrorReduction": round((42 - (77 - winner_metrics["exactTop1Correct"])) / 42, 6),
        "correctRescues": winner_metrics["correctRescues"],
        "harmfulFlips": winner_metrics["harmfulFlips"],
        "neutralWrongChanges": winner_metrics["neutralWrongChanges"],
        "netBenefit": winner_metrics["netBenefit"],
        "rerankEligibleCount": winner_metrics["rerankEligibleCount"],
        "candidateTop1ChangedCount": winner_metrics["candidateTop1ChangedCount"],
        "finalOutputChangedCount": winner_metrics["finalOutputChangedCount"],
        "recallAt2": winner_metrics["recallAt2"],
        "technicalFallbackCount": winner_metrics["technicalFallbackCount"],
        "selectionRule": ["highest FINAL_TOP1_EXACT_AREA_ACCURACY", "fewer HARMFUL_FLIPS", "more CORRECT_RESCUES", "smaller lambda", "larger relativeMargin"],
        "developmentAcceptance": "PASS" if acceptance else "FAIL",
        "cases": [{key: record[key] for key in ("caseId", "baselineFinalArea", "hybridFinalArea", "finalOutputChanged", "humanPrimaryArea", "outcomeCategory")} for record in winner_cases],
    }
    winner_output.write_bytes(canonical_bytes(winner))
    freeze = {
        "schemaVersion": "area_embedding_development_global_hybrid_result_freeze_v1",
        "calibrationProtocolSha256": hashes["calibration_protocol"],
        "embeddingFeaturesSha256": hashes["features"],
        "baselineSha256": hashes["baseline_evaluation"],
        "humanGoldSha256": hashes["human_gold"],
        "splitSha256": hashes["split"],
        "configurationsEvaluated": 72,
        "selectedLambda": winner_metrics["lambda"],
        "selectedRelativeMargin": winner_metrics["relativeMargin"],
        "developmentAcceptance": winner["developmentAcceptance"],
        "winnerArtifactSha256": h(winner_output),
        "gridArtifactSha256": h(grid_output),
        "rawHybridSha256": h(raw_path),
    }
    freeze_output.write_bytes(canonical_bytes(freeze))
    return grid, winner, freeze


def main() -> int:
    directory = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    generation = commands.add_parser("generate")
    generation.add_argument("--output", type=Path, default=directory / "area_embedding_development_global_hybrid_raw_v1.json")
    evaluation = commands.add_parser("evaluate")
    evaluation.add_argument("--raw", type=Path, default=directory / "area_embedding_development_global_hybrid_raw_v1.json")
    evaluation.add_argument("--grid-output", type=Path, default=directory / "area_embedding_development_global_hybrid_grid_v1.json")
    evaluation.add_argument("--winner-output", type=Path, default=directory / "area_embedding_development_global_hybrid_winner_v1.json")
    evaluation.add_argument("--freeze-output", type=Path, default=directory / "area_embedding_development_global_hybrid_result_v1.freeze.json")
    args = parser.parse_args()
    try:
        if args.command == "generate":
            raw = generate(directory, args.output)
            print(json.dumps({"rawHybridSha256": h(args.output), "configurations": len(raw["configurations"]), "configCaseEvaluations": sum(len(x["records"]) for x in raw["configurations"])}, sort_keys=True))
        else:
            grid, winner, freeze = evaluate(directory, args.raw, args.grid_output, args.winner_output, args.freeze_output)
            print(json.dumps({"gridSha256": h(args.grid_output), "winnerSha256": h(args.winner_output), "freezeSha256": h(args.freeze_output), "winner": {"lambda": winner["selectedLambda"], "margin": winner["selectedRelativeMargin"], "acceptance": winner["developmentAcceptance"]}, "configurations": len(grid["configurations"])}, sort_keys=True))
    except (OSError, ValueError, RuntimeError, KeyError, TypeError) as exc:
        print(f"INVALID: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
