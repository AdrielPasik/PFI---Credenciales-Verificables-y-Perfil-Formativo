from __future__ import annotations

import json
from typing import Any

from .b2_versions import B2_PROMPT_VERSIONS


NORMATIVE_POLICY = """
Evaluá evidencia formativa, no a la persona. Similaridad temática no implica support. Evidence↔Requirement relation no determina el estado final. LIMITED_SCOPE no implica automáticamente INSUFFICIENT_EVIDENCE: puede existir un claim más débil, materialmente útil y perteneciente al mismo Requirement. Preservá qualifiers materiales. Una interpretación automática nunca crea evidencia primaria. SourceProvenance, InterpretationProvenance y blockchain sirven para autoridad/trazabilidad, pero nunca aumentan semantic support ni permiten fortalecer relation, facet coverage o claim ceiling. Las relations permitidas son exclusivamente DIRECT_SUPPORT, SPECIFIC_SUPPORT, CONTRIBUTORY_SUPPORT, RELATED_NON_ENTAILING, LIMITED_SCOPE y CONFLICTING. No hardcodees ejemplos/casos. No produzcas chain-of-thought: devolvé solo el artifact estructurado y rationales breves auditables.
""".strip()


def _json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def evidence_unit_quote_first_prompt(sources: list[dict[str, Any]]) -> str:
    safe_sources = [
        {
            "sourceId": item["source"]["sourceId"],
            "credentialId": item["source"]["credentialId"],
            "evidenceType": item["source"]["evidenceType"],
            "sourceProvenance": item["source"]["sourceProvenance"],
            "coverageStatus": item["coverageStatus"],
            "canonicalText": item["canonicalText"],
            "segments": [
                {
                    "segmentId": segment["segmentId"],
                    "sectionLabel": segment.get("sectionLabel"),
                    "exactExcerpt": segment["exactExcerpt"],
                }
                for segment in item["segments"]
            ],
        }
        for item in sources
    ]
    return f"""{NORMATIVE_POLICY}

Sos el stage B2 EvidenceUnit quote-first, objective-independent. Proponé EvidenceUnits source-locales. quoteText debe ser una cita literal, contigua y presente en la sourceId indicada; no uses elipsis ni paráfrasis como quote. normalizedProposition sí es una interpretación semántica, pero nunca reemplaza quoteText. Referenciá un segmentId suministrado. No generes evidenceUnitId, offsets, page, SHA, credentialId autoritativo, sourceTrace, provenance ni extraction quality: el código los construye. No combines fuentes dentro de una EvidenceUnit.

SOURCES={_json(safe_sources)}
PROMPT_VERSION={B2_PROMPT_VERSIONS['evidenceUnitQuoteFirst']}"""


def objective_quote_first_prompt(objective: str) -> str:
    return f"""{NORMATIVE_POLICY}

Sos el stage B2 Objective analysis quote-first. Analizá únicamente el Objective original. Extraé Requirements evaluables sin convertir wrappers/contexto en Requirements independientes. Marcá exactamente un PRIMARY cuando exista un único target explícito; usá ADDITIONAL solo para Requirements realmente independientes. requirementQuote y qualifier sourcePhrase deben ser citas literales contiguas del Objective. No generes IDs ni offsets.

NO SEMANTIC STRENGTHENING: normalizedRequirement puede normalizar redacción, pero no puede agregar achievement, assessment, mastery, depth, experiencia práctica, integración, tecnologías o modalidad; tampoco puede eliminar qualifiers materiales. En particular no conviertas "fundamentos de X" en "demostrar/dominar X". Separá qualifiers MATERIAL de wrappers discursivos/contextuales NON_MATERIAL. requiredEvidenceType y formativeEvidenceCapable describen qué clase de evidencia requiere el Requirement, no qué evidencia fue aportada.

OBJECTIVE={_json(objective)}
PROMPT_VERSION={B2_PROMPT_VERSIONS['objectiveQuoteFirst']}"""


def unified_contextual_reasoning_prompt(context: dict[str, Any]) -> str:
    return f"""{NORMATIVE_POLICY}

Sos el único stage semántico contextual B2 para un Requirement. Ves simultáneamente el Objective original, Requirement exacto/normalizado, qualifiers materiales, todas las EvidenceUnits full-scan con quotes/contexto, credential association, provenance, extraction quality y redundancy/lineage. En UNA decisión conjunta producí relations, evidence contributions, facets si hacen falta, composition, full claim assessment, un único joint claim ceiling, weaker claim candidate y unresolved semantics. NO produzcas final state.

FACETS: deben derivarse del Requirement. Para cada facet explicá requirementBasis y whyNecessary desde el texto/semántica del Requirement; no inventes facets para acomodar evidencia. Evidence responde coverage, nunca por qué la facet existe. requirementBasis obligatorio no prueba por sí solo ausencia de evidence-fitting.

COMPOSITION: COMPLEMENTARY_COVERAGE permite que EUs no redundantes cubran componentes distintos sin bridge artificial. INTEGRATED_CAPABILITY requiere integración evidence solo cuando el Requirement exige explícitamente aplicación/integración conjunta. No exijas bridge por la mera pluralidad de EUs.

RELATIONS: evaluá cada EU material con la taxonomy congelada. evidenceContribution es diagnóstico, no ceiling individual. RELATED_NON_ENTAILING si la evidencia vecina no habilita ningún claim del Requirement. LIMITED_SCOPE si pertenece al mismo núcleo con alcance inferior.

JOINT CEILING: decidilo en esta misma llamada. REACHED solo si la evidencia permite el Requirement completo con qualifiers/facets esenciales. Un weakerClaimCandidate debe explicitar preservedRequirementCore, qué qualifiers/facets se descartan, continuidad y utilidad. LIMITED_SCOPE puede producir PARTIALLY_SUPPORTED después mediante policy si continuidad=YES y utilidad=YES; no fuerces esos valores.

OBSERVABILITY: extraction incompleta solo es MATERIAL_GAP cuando impide resolver responsablemente este Requirement. Si no podés decidir semantic/composition/continuity/usefulness responsablemente, usá UNRESOLVED; no reemplaces incertidumbre con conservadurismo arbitrario.

PROVENANCE: ISSUER_REVIEWED no fortalece support frente a AI_INFERRED; blockchain/technical verification tampoco. Usalos únicamente como contexto de atribución.

Referenciá solo requirementId, evidenceUnitIds y qualifierIds suministrados. Los facet texts son propuestas semánticas, no IDs autoritativos.

CONTEXT={_json(context)}
PROMPT_VERSION={B2_PROMPT_VERSIONS['unifiedContextualReasoning']}"""
