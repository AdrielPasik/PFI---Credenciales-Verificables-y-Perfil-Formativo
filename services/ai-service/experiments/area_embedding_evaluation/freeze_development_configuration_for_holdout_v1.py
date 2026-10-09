"""Freeze the accepted Development configuration before any Holdout output.

This utility only verifies immutable artifacts and writes canonical protocol
artifacts.  It deliberately has no model, tokenizer, feature-generation, or
classification imports.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


EXPECTED = {
    "humanGoldSha256": ("area_embedding_human_annotations_v1.json", "a670013b72402e3921e7f930bd3f35abbb4975f556da2b8a3d96f6a4e278c082"),
    "splitSha256": ("area_embedding_dev_holdout_split_v1.json", "f735f20cbee775184e93cbab57f1024ea9b5fa6988f26c41c9b4f67157acf4e0"),
    "holdoutSealSha256": ("area_embedding_holdout_seal_v1.json", "667368f6e48a7d979313916d83d0fda662ef0d030cdde412443030b3fe713c25"),
    "developmentBaselineRawSha256": ("area_embedding_development_baseline_raw_v1.json", "f369132ca27c0f11f20e38a5b29c6a65d996db2934417a3c2b99fe66496f46ca"),
    "developmentBaselineEvaluationSha256": ("area_embedding_development_baseline_evaluation_v1.json", "d1ba00b1ddb4a02ec66cb1011cedc87b823b8766a4ac048977e9eab6b328481f"),
    "developmentBaselineSummarySha256": ("area_embedding_development_baseline_summary_v1.json", "a1b5946dc13a64f99be7de3f26615d8303fe7d8bd0c507ad926c4c3573d0e7f8"),
    "calibrationProtocolSha256": ("area_embedding_development_calibration_protocol_v1.json", "752a9a06f40e59ad1b068914d689fcfd70378c02359a453990b514e79488b16d"),
    "embeddingFeaturesSha256": ("area_embedding_development_features_v1.json", "1842b197a5191507b48f72b97ccabc7a5b8d0b25432dd5dcf2dd44494521db47"),
    "developmentHybridRawSha256": ("area_embedding_development_global_hybrid_raw_v1.json", "7757d273b431b8bbeb2ac1af2467580566b784f5a48358b5ded3fa84753c8421"),
    "developmentHybridGridSha256": ("area_embedding_development_global_hybrid_grid_v1.json", "60046193a080ce2e73e83f56bb4f1eea69d49f2bd848a0ffce9359c797a5d5f0"),
    "developmentHybridWinnerSha256": ("area_embedding_development_global_hybrid_winner_v1.json", "7162ed02086eee954d433a75780d45aacaf55b14f3399f23d37083bced56842a"),
    "developmentHybridResultFreezeSha256": ("area_embedding_development_global_hybrid_result_v1.freeze.json", "89edb60a293d4eaf753607690d0f60198e719cc5d669b69a46234cd99ebc500b"),
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def main() -> None:
    root = Path(__file__).resolve().parent
    resolved: dict[str, str] = {}
    for key, (name, expected) in EXPECTED.items():
        actual = digest(root / name)
        if actual != expected:
            raise SystemExit(f"EXPERIMENT_INTEGRITY_FAIL: {key} expected {expected}, got {actual}")
        resolved[key] = actual

    winner = json.loads((root / "area_embedding_development_global_hybrid_winner_v1.json").read_text(encoding="utf-8"))
    if (winner["selectedLambda"], winner["selectedRelativeMargin"], winner["developmentAcceptance"]) != (0.8, 0.0, "PASS"):
        raise SystemExit("EXPERIMENT_INTEGRITY_FAIL: frozen winner differs from accepted Development result")
    if winner["baselineCorrect"] + winner["correctRescues"] - winner["harmfulFlips"] != winner["hybridCorrect"]:
        raise SystemExit("EXPERIMENT_INTEGRITY_FAIL: Development accounting identity failed")

    configuration = {
        "ambiguityGatedContingency": "NOT_ACTIVATED",
        "configurationStatus": "FROZEN_FOR_HOLDOUT",
        "developmentAcceptance": "PASS",
        "developmentBaselineCorrect": 35,
        "developmentCorrectRescues": 9,
        "developmentHarmfulFlips": 2,
        "developmentHybridCorrect": 42,
        "developmentNetBenefit": 7,
        "experimentId": "scope-area-embedding-evaluation-v1",
        "schemaVersion": "area_embedding_development_configuration_for_holdout_freeze_v1",
        "selectedFamily": "GLOBAL_HYBRID",
        "selectedLambda": 0.8,
        "selectedRelativeMargin": 0.0,
        **resolved,
    }
    protocol = {
        "configuration": {
            "candidateUniverse": "existing_valid_lexical_candidates_only",
            "embeddingUnavailable": "exact_lexical_baseline",
            "hybridFamily": "GLOBAL_HYBRID",
            "lambda": 0.8,
            "nLessThan2": "exact_lexical_baseline",
            "ordering": ["combinedScore_desc", "lexicalRank_asc"],
            "relativeMargin": 0.0,
            "scores": {"combined": "0.2 * lexicalRankScore + 0.8 * embeddingRankScore", "embeddingRank": "1 - (r - 1) / (n - 1)", "lexicalRank": "1 - (r - 1) / (n - 1)"},
        },
        "encoder": {"dimensions": 384, "modelId": "intfloat/multilingual-e5-small", "revision": "fd1525a9fd15316a2d503bf26ab031a61d056e98", "weightsSha256": "1a55775f53449dac10a2bcbc312469fac40b96d53198c407081a831f81c98477"},
        "experimentId": "scope-area-embedding-evaluation-v1",
        "holdoutCaseCount": 39,
        "holdoutEmbeddingFeaturesGeneratedBeforeProtocolFreeze": False,
        "holdoutOutputsObservedBeforeProtocolFreeze": False,
        "longTextPolicy": {"aggregation": "token_weighted_then_L2_normalize", "chunkSourceTokenBudget": 480, "fallback": "all_or_nothing_exact_lexical_baseline", "overlap": 0, "prefix": "query:", "sourceBuilder": "build_area_embedding_source"},
        "metrics": {"diagnostics": ["baselineRecallAt2", "hybridRecallAt2", "goldInCandidateSet", "candidateGenerationMisses", "rerankEligibleCount", "candidateTop1ChangedCount", "finalOutputChangedCount", "technicalFallbackCount", "family", "annotationStatus", "annotationConfidence", "primaryArea"], "primary": "FINAL_TOP1_EXACT_AREA_ACCURACY", "primaryCorrectness": "finalArea_equals_frozen_human_primaryArea"},
        "outputs": ["BASELINE_HOLDOUT_embeddings_OFF", "FROZEN_GLOBAL_HYBRID_HOLDOUT_lambda_0.8_margin_0.0"],
        "predeclaredAcceptance": {"A": "hybridExactTop1Correct >= baselineExactTop1Correct", "B": "correctRescues > harmfulFlips", "C": "for_each_family_with_holdout_n_ge_5: hybridCorrectInFamily >= baselineCorrectInFamily - 1", "D": "candidateCount_lt_2_or_technical_embedding_failure_preserves_exact_lexical_final_baseline", "pass": "A_and_B_and_C_and_D"},
        "prohibitedAfterFreeze": ["parameter_changes", "alternative_configuration_selection", "ensembles", "family_area_or_case_specific_parameters", "ambiguity_contingency", "retuning_after_holdout"],
        "schemaVersion": "area_embedding_holdout_evaluation_protocol_v1",
        "unseenDevelopmentPrimaryAreas": ["Genómica y Proteómica", "Hidráulica y Neumática", "Inteligencia Artificial", "Logística y Cadena de Abastecimiento", "Manufactura y CAD/CAM", "Química"],
        "workflow": ["verify_frozen_configuration", "unseal_holdout_once", "generate_all_baseline_raw_without_gold", "generate_all_E5_features", "generate_all_frozen_hybrid_raw_without_gold", "freeze_raw_outputs", "load_human_gold", "compute_metrics", "evaluate_A_B_C_D", "freeze_final_result"],
    }
    configuration_path = root / "area_embedding_development_configuration_for_holdout_v1.freeze.json"
    protocol_path = root / "area_embedding_holdout_evaluation_protocol_v1.json"
    configuration_path.write_bytes(canonical(configuration))
    protocol_path.write_bytes(canonical(protocol))
    print(json.dumps({"configurationSha256": digest(configuration_path), "protocolSha256": digest(protocol_path)}, sort_keys=True))


if __name__ == "__main__":
    main()
