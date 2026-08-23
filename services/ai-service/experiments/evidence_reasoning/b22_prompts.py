from __future__ import annotations

import json
from typing import Any

from .b2_prompts import evidence_unit_quote_first_prompt
from .b22_versions import B22_PROMPT_VERSIONS


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


NORMATIVE = """Estados finales: SUPPORTED, PARTIALLY_SUPPORTED, INSUFFICIENT_EVIDENCE, NOT_ASSESSABLE y ABSTAIN. Relation no determina state. Provenance, revisión o blockchain no aumentan support. No produzcas chain-of-thought: devolvé solamente el JSON estructurado y rationales breves."""


def b22_evidence_unit_quote_first_prompt(sources: list[dict[str, Any]]) -> str:
    return evidence_unit_quote_first_prompt(sources)


def objective_analysis_prompt(objective: str) -> str:
    return f"""{NORMATIVE}

Sos el Objective Analysis B2.2, evidence-blind y quote-first. Clasificá candidateSegments literales como OBJECTIVE_CONTEXT, EVALUABLE_REQUIREMENT o STRUCTURAL_WRAPPER. Un Requirement es una proposición que el Objective presenta como criterio independiente cuya satisfacción debe evaluarse. Contexto puede parecer evaluable aislado pero no es criterio.

Si no podés decidir responsablemente qué span es un Requirement, devolvé decompositionStatus=AMBIGUOUS, conservá candidatas y rationale, y requirements=[]. No elijas por orden ni inventes un Requirement. Si RESOLVED, cada Requirement debe coincidir con un candidateSegment EVALUABLE_REQUIREMENT. Múltiples Requirements son válidos solo si son independientes.

Para cada Requirement, preservá citas literales. Clasificá qualifiers MATERIAL_QUALIFIER, CONTEXTUAL o STRUCTURAL_WRAPPER. Construí RequirementIdentityFrame desde el Requirement, nunca desde evidencia: identity elements con uno o más basisPhrases literales y bindings. Los roles son opcionales, repetibles y no constituyen una gramática universal. No reduzcas el Requirement a un core mínimo.

OBJECTIVE={_json(objective)}
PROMPT_VERSION={B22_PROMPT_VERSIONS['objectiveAnalysis']}"""


def unified_reasoning_prompt(context: dict[str, Any]) -> str:
    return f"""{NORMATIVE}

Sos el único stage semántico contextual B2.2 para un Requirement ya resuelto. Evaluá en una decisión conjunta relations, facets solo cuando la estructura del Requirement las necesite, composition, full claim, joint claim ceiling, weaker claim, continuidad y observabilidad. No emitas finalState.

FACETS: usá localFacetKey único. Todas las referencias downstream usan esas keys locales. requirementBasisPhrases debe ser una o más frases literales del Requirement; la evidencia explica coverage, nunca la existencia de la facet.

WEAKER CLAIM: debe explicitarse desde el jointClaimCeiling. derivedFromJointClaimCeiling es un juicio semántico YES/NO/UNRESOLVED, no una verdad factual. Compará el candidate con RequirementIdentityFrame mediante IDs preservados/relajados/cambiados. No uses conteos, keywords o roles como una regla automática. Un prerequisite o capacidad vecina no es automáticamente el mismo Requirement. LIMITED_SCOPE no implica PARTIAL; RELATED_NON_ENTAILING no implica INSUFFICIENT.

OBSERVABILITY: sourceObservabilityFacts son hechos. Solo evaluá incompleteSourceAssessments para sources PARTIAL/FAILED. Para FULL no inventes material faltante. independentObservableSupport determina si lo visible alcanza solo; observabilityStatus es SUFFICIENT, MATERIAL_GAP o UNRESOLVED. Una source incompleta irrelevante no veta; una fuente incompleta capaz de mover PARTIAL↔SUPPORTED puede justificar MATERIAL_GAP.

Referenciá exclusivamente IDs y sources suministrados. No atribuyas fuerza semántica a provenance o blockchain.

CONTEXT={_json(context)}
PROMPT_VERSION={B22_PROMPT_VERSIONS['unifiedContextualReasoning']}"""
