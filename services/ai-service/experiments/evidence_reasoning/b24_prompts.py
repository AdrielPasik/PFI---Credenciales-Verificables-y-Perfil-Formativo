from __future__ import annotations

import json
from typing import Any

from .b2_prompts import evidence_unit_quote_first_prompt
from .b24_versions import B24_PROMPT_VERSIONS


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


# B2 semantic-core normative policy. B2.2 and B2.3 rewrote this text from scratch
# and lost several of B2's *symmetric* clauses -- the ones that guard against
# over-conservatism as well as against over-claiming. Restoring them is lineage
# conformance with "B2 semantic core", not a new delta.
NORMATIVE_POLICY = """
Evaluá evidencia formativa, no a la persona. Similaridad temática no implica support. Evidence↔Requirement relation no determina el estado final. LIMITED_SCOPE no implica automáticamente INSUFFICIENT_EVIDENCE: puede existir un claim más débil, materialmente útil y perteneciente al mismo Requirement. RELATED_NON_ENTAILING tampoco implica automáticamente INSUFFICIENT_EVIDENCE. Preservá qualifiers materiales. Una interpretación automática nunca crea evidencia primaria. SourceProvenance, InterpretationProvenance y blockchain sirven para autoridad/trazabilidad, pero nunca aumentan semantic support ni permiten fortalecer relation, facet coverage o claim ceiling. Las relations permitidas son exclusivamente DIRECT_SUPPORT, SPECIFIC_SUPPORT, CONTRIBUTORY_SUPPORT, RELATED_NON_ENTAILING, LIMITED_SCOPE y CONFLICTING. Estados finales posibles: SUPPORTED, PARTIALLY_SUPPORTED, INSUFFICIENT_EVIDENCE, NOT_ASSESSABLE y ABSTAIN, pero vos NUNCA los emitís. No hardcodees ejemplos/casos. No produzcas chain-of-thought: devolvé solo el artifact estructurado y rationales breves auditables.
""".strip()


def b24_evidence_unit_quote_first_prompt(sources: list[dict[str, Any]]) -> str:
    """Unchanged from B2. Quote-first EvidenceUnit extraction is not a B2.4 delta."""
    return evidence_unit_quote_first_prompt(sources)


def objective_analysis_prompt(objective: str) -> str:
    return f"""{NORMATIVE_POLICY}

Sos Objective Analysis B2.4: evidence-blind y quote-first. NO ves ninguna EvidenceUnit, fuente ni contenido disponible. Clasificá candidateSegments literales como OBJECTIVE_CONTEXT, EVALUABLE_REQUIREMENT o STRUCTURAL_WRAPPER. Un Requirement es una proposición que el Objective presenta como criterio independiente cuya satisfacción debe evaluarse; el contexto puede parecer evaluable aislado sin ser criterio.

Si no podés decidir responsablemente qué span es un Requirement, devolvé decompositionStatus=AMBIGUOUS, conservá candidatas y rationale, y requirements=[]. No elijas por orden ni inventes un Requirement. Si RESOLVED, cada Requirement coincide con un candidateSegment EVALUABLE_REQUIREMENT. No construyas core, identity frame, bindings ni ninguna representación equivalente.

QUALIFIERS: clasificá MATERIAL_QUALIFIER, CONTEXTUAL o STRUCTURAL_WRAPPER. Un span ya segmentado como OBJECTIVE_CONTEXT o STRUCTURAL_WRAPPER no puede ser MATERIAL_QUALIFIER. sourcePhrase debe ser cita literal contigua del Objective.

NO SEMANTIC STRENGTHENING: normalizedRequirement es una PARÁFRASIS AUXILIAR sin autoridad epistemológica propia. Puede normalizar redacción, pero no puede agregar achievement, assessment, mastery, posesión individual, depth, experiencia práctica, integración, tecnologías ni modalidad; tampoco puede eliminar qualifiers materiales. En particular no conviertas "fundamentos de X" en "demostrar/dominar/contar con X". La autoridad semántica es requirementQuote.

EPISTEMIC TARGET: clasificá qué CLASE de afirmación intenta justificar el Requirement, leyendo únicamente el Objective/Requirement.
- FORMATIVE_EVIDENCE: el criterio se satisface mostrando formación/cobertura formativa trazable sobre el objeto pedido. Es el caso cuando el Requirement pide formación, contenido, fundamentos o similar SIN exigir explícitamente mastery, desempeño evaluado, logro demostrado o competencia individual.
- INDIVIDUAL_ACHIEVEMENT: el Requirement exige explícitamente dominio, desempeño evaluado, logro acreditado o competencia individual demostrada.
- UNRESOLVED: no podés decidirlo responsablemente. No adivines un target más fuerte.
No fortalezcas implícitamente hacia INDIVIDUAL_ACHIEVEMENT. Que un contenido sea formativo no significa que la persona lo domine, y el Requirement puede legítimamente pedir solo lo primero. epistemicTargetRationale debe citar qué del Requirement justifica la clasificación.

OBJECTIVE={_json(objective)}
PROMPT_VERSION={B24_PROMPT_VERSIONS['objectiveAnalysis']}"""


def unified_reasoning_prompt(context: dict[str, Any]) -> str:
    return f"""{NORMATIVE_POLICY}

Sos el único stage semántico contextual B2.4 para un Requirement ya resuelto. Ves simultáneamente el Objective original, requirementQuote literal, normalizedRequirement, epistemicTarget congelado, qualifiers materiales, todas las EvidenceUnits full-scan con quotes/contexto, provenance, extraction quality y redundancy/lineage. Resolvé todo en UNA decisión conjunta. NO emitas finalState.

AUTORIDAD: requirementQuote > normalizedRequirement. La paráfrasis ayuda lingüísticamente pero no tiene autoridad epistemológica independiente y no puede modificar epistemicTarget, que llega congelado desde Objective Analysis (evidence-blind) y es read-only para vos.

EPISTEMIC TARGET:
- FORMATIVE_EVIDENCE: la pregunta es si la evidencia trazable justifica formación/cobertura formativa sobre el Requirement. Una EvidenceUnit DECLARED_CONTENT puede contribuir legítimamente. NO exijas que la persona domine, posea, sepa o ejecute profesionalmente salvo que el Requirement lo pida expresamente. No introduzcas en ningún rationale una exigencia de posesión/dominio/logro individual que el Requirement no pidió.
- INDIVIDUAL_ACHIEVEMENT: presencia temática puede no alcanzar; el claim type de las fuentes importa.
- UNRESOLVED: no adivines un target más fuerte; marcá semanticUnresolved.

ORDEN LÓGICO OBLIGATORIO — resolvé en este orden y respetá las dependencias:
relations → facets → composition → fullClaimAssessment → jointClaimCeiling → observabilityAssessment → weakerClaimSearch → continuityAssessment (solo si FOUND) → materialUsefulness (solo si continuity=YES).

RELATIONS: evaluá cada EU material con la taxonomy congelada. evidenceContribution es diagnóstico, no ceiling individual. RELATED_NON_ENTAILING si la evidencia vecina no habilita ningún claim del Requirement. LIMITED_SCOPE si pertenece al mismo núcleo con alcance inferior. Ninguna relation decide por sí sola weakerClaimSearch ni el estado.

FACETS: deben derivarse del Requirement. localFacetKey único; todas las referencias downstream usan esas keys locales. requirementBasisPhrases deben ser frases literales del requirementQuote. Explicá whyNecessary desde el Requirement; la evidencia responde coverage, nunca por qué la facet existe. No inventes facets para acomodar evidencia.

COMPOSITION: COMPLEMENTARY_COVERAGE permite que EUs no redundantes cubran componentes distintos sin bridge artificial. INTEGRATED_CAPABILITY requiere integración evidence solo cuando el Requirement exige explícitamente aplicación/integración conjunta. No exijas bridge por la mera pluralidad de EUs.

JOINT CEILING: uno solo, en esta misma llamada. REACHED solo si la evidencia permite el Requirement completo con qualifiers/facets esenciales, interpretado según epistemicTarget.

OBSERVABILITY (antes de weakerClaimSearch): sourceObservabilityFacts son hechos determinísticos. Solo evaluá incompleteSourceAssessments para sources PARTIAL/FAILED; para FULL no inventes material faltante. Una fuente incompleta irrelevante no veta. Material faltante capaz de mover PARTIAL↔SUPPORTED justifica MATERIAL_GAP.

WEAKER CLAIM SEARCH (DELTA_A): si formativeEvidenceCapable=true Y fullClaimAssessment=NOT_REACHED Y observabilityStatus=SUFFICIENT, DEBÉS considerar explícitamente si existe una versión más débil del MISMO Requirement respaldada por el ceiling. Considerarla es obligatorio; encontrarla NO lo es.
- FOUND: existe una proyección candidata. candidate obligatorio.
- NONE: la buscaste y no existe una defendible. candidate=null.
- UNRESOLVED: no podés decidir responsablemente si existe. candidate=null.
NONE y UNRESOLVED son respuestas legítimas, pero exigen rationale explícito de la búsqueda. No uses NONE como salida temprana por omisión. Ninguna relation, coverage de facet, qualifier faltante ni similitud decide automáticamente el status: es juicio semántico.

CONTINUITY (DELTA_B, solo si FOUND): pregunta central: ¿el candidate describe una parte, nivel, alcance, generalización o facet CONSTITUTIVA del mismo Requirement, o describe otra capacidad que solamente ayuda/prepara para poder satisfacerlo?
- C1 ceiling containment: el candidate completo debe estar respaldado por jointClaimCeiling; no puede excederlo.
- C2 constitutive projection: puede resultar de menor profundidad, menor especificidad, scope más general, pérdida explícita de qualifier, pérdida de facet, pérdida de integración o proyección a una facet constitutiva cubierta. Son clases explicativas, no reglas.
- C3 no target substitution: si para formular el candidate hay que reemplazar el target por otra capacidad, objeto o tecnología, continuity=NO.
- C4 constitutive vs merely preparatory: ¿es todavía una versión reducida de lo pedido, o algo útil para llegar a ello? Las palabras fundamento, introductorio o general NO deciden por sí solas. Una versión introductoria del MISMO objeto puede ser constitutiva; un prerequisito externo puede ser meramente preparatorio.
Un status=YES debe poder justificar: qué exige R, qué afirma W, por qué W sigue siendo parte/nivel/alcance constitutivo de R, qué se relaja explícitamente, y que no se introduce un target externo. Un status=NO debe poder justificar qué capacidad/objeto nuevo haría falta introducir para llegar de X a R.
transformation=CONSTITUTIVE_REDUCTION acompaña YES; SEMANTIC_SHIFT acompaña NO con shiftReason.
requirementBasisPhrases: frases LITERALES del requirementQuote. El código las alinea determinísticamente. Nunca escribas una paráfrasis donde va una cita.

MATERIAL USEFULNESS (solo si continuity=YES): si continuity no es YES, devolvé NOT_EVALUATED. La utilidad nunca rescata un semantic shift.

INCERTIDUMBRE: si no podés decidir responsablemente relations, composition, ceiling, búsqueda, continuidad, utilidad u observabilidad, usá UNRESOLVED. No reemplaces incertidumbre con conservadurismo arbitrario, ni conservadurismo con una afirmación no respaldada.

Referenciá exclusivamente requirementId, evidenceUnitIds, qualifierIds y sources suministrados.

CONTEXT={_json(context)}
PROMPT_VERSION={B24_PROMPT_VERSIONS['unifiedContextualReasoning']}"""
