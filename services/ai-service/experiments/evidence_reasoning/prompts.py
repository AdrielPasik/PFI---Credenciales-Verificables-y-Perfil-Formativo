from __future__ import annotations

import json
from typing import Any

from .versions import PROMPT_VERSIONS

POLICY = """
Contrato normativo resumido: evaluá evidencia formativa, no a la persona. Similaridad no implica soporte. Preservá qualifiers. Una interpretación automática nunca crea evidencia primaria. No inventes IDs, texto, offsets, fuentes, credentials ni provenance. Las relaciones permitidas son DIRECT_SUPPORT, SPECIFIC_SUPPORT, CONTRIBUTORY_SUPPORT, RELATED_NON_ENTAILING, LIMITED_SCOPE y CONFLICTING. Evidence↔Requirement relation no determina el estado final. LIMITED_SCOPE puede producir PARTIALLY_SUPPORTED si existe un claim más débil, materialmente útil, trazable y perteneciente al mismo Requirement. La composición requiere facets explícitas, complementariedad y, cuando el claim es integrado, evidencia puente. Blockchain y provenance no aumentan fuerza semántica. No produzcas chain-of-thought: devolvé solo decisiones estructuradas y rationale breve.
""".strip()


def _json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def b1a_prompt(model_input: dict[str, Any]) -> str:
    return f"""{POLICY}

Sos B1a, baseline single-shot deliberadamente mínimo. Resolvé en una sola respuesta Objective analysis, EvidenceUnits/citations, relations, facets, claim ceilings, estados finales y explicación. No ocultes la naturaleza single-shot. Los offsets se refieren al canonicalText de cada source. No recibís labels gold.

INPUT={_json(model_input)}
PROMPT_VERSION={PROMPT_VERSIONS['b1a_single_shot']}"""


def evidence_unit_prompt(sources: list[dict[str, Any]]) -> str:
    safe_sources = [
        {
            "sourceId": item["source"]["sourceId"],
            "sourceSha256": item["source"]["sourceSha256"],
            "canonicalText": item["canonicalText"],
            "coverageStatus": item["coverageStatus"],
            "segments": item["segments"],
        }
        for item in sources
    ]
    return f"""{POLICY}

Extraé un catálogo objective-independent de EvidenceUnits. Una EvidenceUnit es una proposición formativa trazable, no un label aislado. Copiá exactExcerpt literalmente y usá offsets del canonicalText suministrado. No interpretes contra ningún Objective.

SOURCES={_json(safe_sources)}
PROMPT_VERSION={PROMPT_VERSIONS['evidence_unit_extraction']}"""


def objective_prompt(objective: str) -> str:
    return f"""{POLICY}

Analizá exclusivamente el Objective. Conservá originalObjective idéntico. Extraé Requirements atómicos con spans exactos, evaluability, evidence type requerido y qualifiers. Separá enumeraciones independientes, pero no destruyas unidades integradas como 'testing automatizado backend'. No ves evidencia en esta etapa.

OBJECTIVE={_json(objective)}
PROMPT_VERSION={PROMPT_VERSIONS['objective_analysis']}"""


def facet_prompt(objective_analysis: dict[str, Any]) -> str:
    requirements = [
        {
            "requirementId": item["requirementId"],
            "normalizedRequirement": item["normalizedRequirement"],
            "compositionRequired": item["compositionRequired"],
            "qualifiers": item["qualifiers"],
        }
        for item in objective_analysis["requirements"]
    ]
    return f"""{POLICY}

Proponé facets solo cuando el Requirement sigue siendo una proposición pero necesita varios componentes para composición. Las facets deben derivarse del Requirement, sin ver evidencia, sin agregar tecnologías ni profundidad. Para Requirements sin composición devolvé facets vacías.

REQUIREMENTS={_json(requirements)}
PROMPT_VERSION={PROMPT_VERSIONS['facet_planning']}"""


def relation_prompt(
    objective_analysis: dict[str, Any],
    facets: dict[str, Any],
    evidence_units: list[dict[str, Any]],
) -> str:
    return f"""{POLICY}

Para cada pareja material Requirement/EvidenceUnit, decidí la relation sin emitir final state. Pregunta central: ¿qué afirmación concreta sobre este Requirement permite repetir responsablemente la EvidenceUnit y cuál no? RELATED_NON_ENTAILING si no permite afirmar nada sobre el Requirement aunque sea vecina. LIMITED_SCOPE si habla del mismo objeto con alcance inferior. Referenciá solo IDs suministrados.

OBJECTIVE_ANALYSIS={_json(objective_analysis)}
FACETS={_json(facets)}
EVIDENCE_UNITS={_json(evidence_units)}
PROMPT_VERSION={PROMPT_VERSIONS['relation_reasoning']}"""


def ceiling_prompt(
    objective_analysis: dict[str, Any],
    facets: dict[str, Any],
    evidence_units: list[dict[str, Any]],
    relations: dict[str, Any],
    exact_redundancy_groups: list[list[str]],
) -> str:
    return f"""{POLICY}

Evaluá composición y formulá el claim ceiling por Requirement sobre el set no redundante. Decidí semánticamente reachesFullRequirement, hasMateriallyUsefulWeakerClaim y weakerClaimStillBelongsToRequirement; esos booleanos no son estados. No inventes integración: un claim integrado exige bridgeEvidenceUnitIds. La cantidad de evidencia no crea profundidad. No emitas final state.

OBJECTIVE_ANALYSIS={_json(objective_analysis)}
FACETS={_json(facets)}
EVIDENCE_UNITS={_json(evidence_units)}
RELATIONS={_json(relations)}
EXACT_REDUNDANCY_GROUPS={_json(exact_redundancy_groups)}
PROMPT_VERSION={PROMPT_VERSIONS['composition_claim_ceiling']}"""

