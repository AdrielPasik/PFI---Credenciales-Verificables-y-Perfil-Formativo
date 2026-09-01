from __future__ import annotations

# B2.4 / Target AI Architecture v1.5 — minimal semantic contract fix.
#
# Lineage:
#   B2 semantic core
#   + B2.2/B2.3 proven grounding & observability gains
#   + explicit weakerClaimSearch          (DELTA_A)
#   + constitutive-reduction continuity   (DELTA_B)
#   + epistemic-target preservation       (DELTA_C)
#   + quote-first continuity trace        (DELTA_D)
#
# RequirementIdentityFrame stays dropped. No fourth provider call.

B24_VERSIONS = {
    "runtime": "target_ai_architecture_v1.5_b24_runtime_v1.0.0",
    "artifact": "evidence_reasoning_b24_artifact_v1.0.0",
    "objective": "b24_objective_epistemic_target_v1.0.0",
    "unified": "b24_explicit_weaker_search_constitutive_continuity_v1.0.0",
    "validation": "b24_structural_contracts_v1.0.0",
    "policy": "b24_epistemic_policy_adapter_v1.0.0",
    "renderer": "b24_renderer_v1.0.0",
    "evaluator": "b24_probe_evaluator_v1.0.0",
}

B24_PROMPT_VERSIONS = {
    # Unchanged from B2: quote-first EvidenceUnit extraction is not a B2.4 delta.
    "evidenceUnitQuoteFirst": "b2_evidence_unit_quote_first_es_v1.0.0",
    "objectiveAnalysis": "b24_objective_epistemic_target_es_v1.0.0",
    "unifiedContextualReasoning": "b24_explicit_weaker_search_constitutive_continuity_es_v1.0.0",
}

EPISTEMIC_TARGETS = ["FORMATIVE_EVIDENCE", "INDIVIDUAL_ACHIEVEMENT", "UNRESOLVED"]
WEAKER_SEARCH_STATUSES = ["FOUND", "NONE", "UNRESOLVED"]
CONTINUITY_TRANSFORMATIONS = ["CONSTITUTIVE_REDUCTION", "SEMANTIC_SHIFT", "UNRESOLVED"]
