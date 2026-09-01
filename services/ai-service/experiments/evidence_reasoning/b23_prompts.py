from __future__ import annotations

import json
from typing import Any
from .b2_prompts import evidence_unit_quote_first_prompt
from .b23_versions import B23_PROMPT_VERSIONS

def _json(value: Any) -> str: return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
NORMATIVE = "Estados finales: SUPPORTED, PARTIALLY_SUPPORTED, INSUFFICIENT_EVIDENCE, NOT_ASSESSABLE y ABSTAIN. Relation no determina state. Provenance, revisión o blockchain no aumentan support. Devolvé solamente JSON estructurado y rationales breves."
def b23_evidence_unit_quote_first_prompt(sources: list[dict[str, Any]]) -> str: return evidence_unit_quote_first_prompt(sources)
def objective_analysis_prompt(objective: str) -> str:
    return f"""{NORMATIVE}
Sos Objective Analysis B2.3, evidence-blind y quote-first. Clasificá candidateSegments literales como OBJECTIVE_CONTEXT, EVALUABLE_REQUIREMENT o STRUCTURAL_WRAPPER. Si no podés identificar responsablemente un Requirement, devolvé AMBIGUOUS, persistí candidatas/rationale y requirements=[]. Si RESOLVED, cada Requirement coincide con un candidate EVALUABLE_REQUIREMENT. No construyas core, identity frame, bindings ni cualquier representación equivalente. Clasificá qualifiers: MATERIAL_QUALIFIER, CONTEXTUAL o STRUCTURAL_WRAPPER. Un span ya segmentado como OBJECTIVE_CONTEXT o STRUCTURAL_WRAPPER no puede ser MATERIAL_QUALIFIER.
OBJECTIVE={_json(objective)}
PROMPT_VERSION={B23_PROMPT_VERSIONS['objectiveAnalysis']}"""
def unified_reasoning_prompt(context: dict[str, Any]) -> str:
    return f"""{NORMATIVE}
Sos el único stage contextual B2.3 para un Requirement resuelto. Evaluá conjuntamente relations, facets (solo si el Requirement lo exige), composition, full claim, jointClaimCeiling, weaker candidate, observability y continuidad. No emitas finalState.
Primero derivá jointClaimCeiling desde EvidenceUnits. Después, si proponés weakerClaimCandidate, hacé una comparación post-ceiling directa Requirement↔candidate: ¿dice MENOS del MISMO Requirement o dice algo DIFERENTE aunque sea relacionado, preparatorio o vecino? Reportá continuityAssessment. C1 candidate contenido por ceiling; C2 proyección al Requirement; C3 mismo target semántico; C4 no prerequisite/foundation; C5 no neighbor/substitution; C6 remainder constitutivo; C7 explicá pérdidas. Esto es juicio semántico, no regla de keywords, score ni guard factual. derivedFromJointClaimCeiling también es juicio semántico.
FACETS usan localFacetKey único y requirementBasisPhrases literales del Requirement. Evidencia cubre facets pero no crea su necesidad. No uses identity frame ni core precomputado.
OBSERVABILITY: source facts son determinísticos. Sólo evaluá PARTIAL/FAILED. FULL no tiene material faltante. Una fuente incompleta irrelevante no veta; material capaz de cambiar PARTIAL↔SUPPORTED justifica MATERIAL_GAP.
Referenciá exclusivamente IDs/sources suministrados. No des peso semántico a provenance o blockchain.
CONTEXT={_json(context)}
PROMPT_VERSION={B23_PROMPT_VERSIONS['unifiedContextualReasoning']}"""
