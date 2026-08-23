from __future__ import annotations

import json
from typing import Any

from .b2_prompts import NORMATIVE_POLICY, evidence_unit_quote_first_prompt
from .b21_versions import B21_PROMPT_VERSIONS

def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

def objective_quote_first_prompt(objective: str) -> str:
    return f"""{NORMATIVE_POLICY}

Sos B2.1 Objective Analysis quote-first y evidence-blind. Analizá únicamente Objective. requirementQuote y cada sourcePhrase son literales contiguos. No generes IDs/offsets.

Para cada qualifier elegí exactamente un role: MATERIAL_QUALIFIER cambia el claim requerido; CONTEXTUAL ayuda a interpretar sin cambiarlo; STRUCTURAL_WRAPPER es etiqueta discursiva. Solo el primero podrá entrar a reasoning semántico.

Antes de ver EvidenceUnits generá continuityCore. statement debe poder reconstruirse solo con palabras del requirementQuote; requirementBasisPhrases deben ser citas literales del requirementQuote. El core es la proposición mínima que debe sobrevivir a un weaker claim; no agregues acción, objeto, dominio, modalidad ni qualifier. No agregues achievement, práctica, mastery, depth ni tecnología.

OBJECTIVE={_json(objective)}
PROMPT_VERSION={B21_PROMPT_VERSIONS['objectiveQuoteFirst']}"""

def unified_contextual_reasoning_prompt(context: dict[str, Any]) -> str:
    return f"""{NORMATIVE_POLICY}

Sos el único unified contextual reasoner B2.1. No produzcas final state. Recibís Objective, Requirement, continuityCore congelado y sourceObservabilityFacts determinísticos además de EvidenceUnits full-scan.

Relations, composition, ceiling y weaker claim se deciden conjuntamente. Un weaker claim solo puede ser útil si conserva el continuityCore recibido; no lo redefinas. Usá corePreservation/corePreservationRationale/changedCoreElements y materialUsefulness.

Facets usan localFacetKey. requirementBasisRefs solo puede citar continuityCore o qualifierIds materiales recibidos, nunca EvidenceUnit IDs. Todas las referencias internas de facet usan localFacetKey. Si facets=[] todas las listas de keys de facets deben estar vacías.

Para cada source no FULL emití incompleteSourceAssessment. No supongas que todo PARTIAL implica ABSTAIN ni que lo no observado está ausente. Declarar observableSupport: si el support observable establece independientemente full/weaker claim y si el material faltante podría cambiar final state. El código, no vos, deriva resolutionClosure.

SourceProvenance, InterpretationProvenance y blockchain son trazabilidad, no support semántico.
CONTEXT={_json(context)}
PROMPT_VERSION={B21_PROMPT_VERSIONS['unifiedContextualReasoning']}"""
