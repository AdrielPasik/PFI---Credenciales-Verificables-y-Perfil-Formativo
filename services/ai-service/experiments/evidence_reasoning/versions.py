from __future__ import annotations

VERSIONS = {
    "extractionSchema": "source_extraction_v1",
    "extractionImplementation": "source_extractor_v1.0.0",
    "evidenceUnitSchema": "evidence_unit_catalog_v1",
    "objectiveAnalysisSchema": "objective_analysis_v1",
    "relationSchema": "evidence_relation_v1",
    "reasoningSchema": "requirement_reasoning_v1",
    "resultSchema": "evidence_reasoning_result_v1",
    "epistemicPolicy": "epistemic_policy_v1.0.0",
    "guards": "evidence_reasoning_guards_v1.0.0",
    "renderer": "evidence_reasoning_renderer_v1.0.0",
    "seedDataset": "seed_gold_set_v0_frozen",
    "split": "seed_split_v1",
}

PROMPT_VERSIONS = {
    "b1a_single_shot": "b1a_single_shot_es_v1.0.0",
    "evidence_unit_extraction": "evidence_unit_extraction_es_v1.0.0",
    "objective_analysis": "objective_analysis_es_v1.0.0",
    "facet_planning": "facet_planning_es_v1.0.0",
    "relation_reasoning": "relation_reasoning_es_v1.0.0",
    "composition_claim_ceiling": "composition_claim_ceiling_es_v1.0.0",
}

