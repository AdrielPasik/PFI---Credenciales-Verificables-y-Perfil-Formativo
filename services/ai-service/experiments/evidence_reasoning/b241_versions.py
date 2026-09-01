from __future__ import annotations

from .b24_versions import (  # noqa: F401  (re-exported unchanged)
    CONTINUITY_TRANSFORMATIONS,
    EPISTEMIC_TARGETS,
    WEAKER_SEARCH_STATUSES,
)

# B2.4.1 / Target AI Architecture v1.5.1 — BASELINE_CONFORMANCE_REPAIR.
#
# B2.4 declared it inherited the B2 semantic core, but the semantic clause
# lineage gate proved that declaration false: `B2_NO_FORCED_CONTINUITY_USEFULNESS`
# is mandatory in B2, declared inherited by B2.4, and absent from its prompt.
#
# This successor differs from B2.4 by exactly one semantic change: the restoration
# of that clause, verbatim from B2. Everything else -- schemas, artifacts,
# validation, policy, renderer, topology, evidence extraction, objective analysis,
# observability, facets, qualifier roles, weakerClaimSearch, epistemicTarget and
# the C1-C4 continuity rubric -- is imported unchanged from B2.4.
#
# This is NOT behavioral tuning and NOT a case-specific fix: the clause predates
# case_06, B2.4 and the whole observation.

B241_VERSIONS = {
    "runtime": "target_ai_architecture_v1.5.1_b241_runtime_v1.0.0",
    "artifact": "evidence_reasoning_b241_artifact_v1.0.0",
    "objective": "b24_objective_epistemic_target_v1.0.0",
    "unified": "b241_baseline_conformance_repair_v1.0.0",
    "validation": "b24_structural_contracts_v1.0.0",
    "policy": "b24_epistemic_policy_adapter_v1.0.0",
    "renderer": "b24_renderer_v1.0.0",
    "evaluator": "b241_probe_evaluator_v1.0.0",
}

B241_PROMPT_VERSIONS = {
    "evidenceUnitQuoteFirst": "b2_evidence_unit_quote_first_es_v1.0.0",
    "objectiveAnalysis": "b24_objective_epistemic_target_es_v1.0.0",
    "unifiedContextualReasoning": "b241_baseline_conformance_repair_es_v1.0.0",
}

# Verbatim B2 clause, restored. Source: b2_prompts.py, JOINT CEILING paragraph.
B2_NO_FORCED_CONTINUITY_USEFULNESS = (
    "LIMITED_SCOPE puede producir PARTIALLY_SUPPORTED después mediante policy "
    "si continuidad=YES y utilidad=YES; no fuerces esos valores."
)

B241_LINEAGE = {
    "changeClass": "BASELINE_CONFORMANCE_REPAIR",
    "predecessor": "B2.4",
    "predecessorFingerprint": "1cc883d785fd689213708106f715910025bf806db116f1814a2f48e8980c2be9",
    "inherits": [
        "B2_NO_SEMANTIC_STRENGTHENING",
        "B2_NO_FORCED_CONTINUITY_USEFULNESS",
        "B2_NO_ARBITRARY_CONSERVATIVE_UNCERTAINTY",
        "B2_NO_PLURALITY_IMPLIES_INTEGRATION_BRIDGE",
        "B24_EXPLICIT_WEAKER_CLAIM_SEARCH",
        "B24_CONSTITUTIVE_REDUCTION_CONTINUITY",
        "B24_EPISTEMIC_TARGET_AUTHORITY",
        "B24_QUOTE_FIRST_CONTINUITY_TRACE",
    ],
    "adds": [],
    "supersedes": [],
    "removes": [],
    "restores": ["B2_NO_FORCED_CONTINUITY_USEFULNESS"],
    "newSemanticContentBeyondRestoration": "NONE",
}
