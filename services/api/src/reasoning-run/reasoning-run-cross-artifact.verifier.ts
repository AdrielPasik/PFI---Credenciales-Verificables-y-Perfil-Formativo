/**
 * Verificadores CRUZADOS entre artifacts de etapa — slice F3.1.
 *
 * Los validadores de forma responden "¿este artifact es valido?". Estos
 * responden la otra mitad: "¿es coherente con lo que este run ya congelo?".
 * Hacen falta las dos, y no se pueden fusionar: un artifact puede ser
 * impecablemente valido y referirse a un Requirement que el Objective no tiene.
 *
 * Funciones PURAS: reciben lo ya verificado, no tocan la base y no llaman a
 * nadie. Quien las usa —el servicio de slots— es el que carga la autoridad desde
 * persistencia.
 *
 * NO RECOMPUTAN NADA. No re-ejecutan la policy, no re-alinean citas, no
 * reconstruyen EvidenceUnits. Verifican REFERENCIAS.
 */

import { failArtifact } from './reasoning-run-artifact.errors';
import {
  type VerifiedEvidenceUnits,
  type VerifiedObjectiveAnalysis,
  type VerifiedReasoningRunResult
} from './reasoning-run-artifact.types';

/**
 * Vista minima de un item del inventario congelado, tal como la necesita la
 * verificacion de grounding.
 *
 * Se acepta esta forma y no la fila de Prisma entera para que el verificador
 * quede puro y testeable sin base.
 */
export interface FrozenInventoryItem {
  readonly disposition: string;
  readonly runLocalSourceId: string | null;
  readonly sourceSha256: string | null;
}

const INCLUDED = 'INCLUDED';

const CONTEXTUAL = 'CONTEXTUAL';

/**
 * Vista minima del Objective congelado que necesita la verificacion de la etapa 1.
 *
 * Lleva `requirementText` y `objectiveContext` porque son las ANCLAS contra las
 * que se comprueban las citas de los qualifiers. Sale siempre de
 * `ReasoningRun.objectiveDefinitionSnapshot`, nunca del Objective vigente: el
 * snapshot es la autoridad del run.
 */
export interface ConfirmedObjectiveSnapshot {
  readonly objectiveContext: string;
  readonly requirements: readonly {
    readonly requirementId: string;
    readonly requirementText: string;
  }[];
}

/**
 * §15 — el Objective Analysis NO puede cambiar el conjunto de Requirements.
 *
 * Un item por `requirementId` confirmado: ni falta ninguno, ni sobra ninguno, ni
 * se repite ninguno, y en el mismo orden que el Objective congelado.
 *
 * NO se compara `requirementText`: el artifact no lo persiste justamente porque
 * su autoridad ya esta en el snapshot. Compararlo exigiria que el artifact lo
 * duplicara, que es lo contrario de lo que se quiere. El texto se usa como ANCLA
 * —ver `verifyQualifierAnchors`—, que es otra cosa: no se compara el texto del
 * artifact contra el snapshot, se comprueba que lo que el artifact CITA exista
 * literalmente en el snapshot.
 *
 * El snapshot llega ya verificado por el validador productivo de F2, en su orden
 * de persistencia.
 */
export function verifyObjectiveAnalysisAgainstObjectiveSnapshot(
  analysis: VerifiedObjectiveAnalysis,
  snapshot: ConfirmedObjectiveSnapshot
): void {
  const confirmedRequirementIds = snapshot.requirements.map(
    (item) => item.requirementId
  );
  const analysed = analysis.requirements.map((item) => item.requirementId);
  const confirmed = new Set(confirmedRequirementIds);

  for (const [index, requirementId] of analysed.entries()) {
    if (!confirmed.has(requirementId)) {
      failArtifact('REQUIREMENT_REFERENCE_UNKNOWN', {
        invariant: 'objective_analysis_may_only_classify_confirmed_requirements',
        path: `objectiveAnalysis.requirements[${index}].requirementId`,
        observed: requirementId
      });
    }
  }

  const analysedSet = new Set(analysed);
  for (const requirementId of confirmedRequirementIds) {
    if (!analysedSet.has(requirementId)) {
      failArtifact('REQUIREMENT_COVERAGE_INCOMPLETE', {
        invariant: 'every_confirmed_requirement_must_be_analysed',
        path: 'objectiveAnalysis.requirements',
        observed: requirementId
      });
    }
  }

  // Longitudes iguales + ambos sin duplicados (el validador de forma ya lo
  // garantiza para el artifact) => misma multiplicidad. Queda comparar el orden.
  for (const [index, requirementId] of confirmedRequirementIds.entries()) {
    if (analysed[index] !== requirementId) {
      failArtifact('REQUIREMENT_COVERAGE_INCOMPLETE', {
        invariant: 'analysis_order_must_follow_the_objective_snapshot',
        path: `objectiveAnalysis.requirements[${index}].requirementId`,
        observed: `${analysed[index]}!=${requirementId}`
      });
    }
  }

  verifyQualifierAnchors(analysis, snapshot);
}

/**
 * Anclaje de qualifiers, congelado por F3.3A §22.5 — POR ROL, no uno solo.
 *
 *     MATERIAL_QUALIFIER    subcadena literal y contigua de requirementText
 *     STRUCTURAL_WRAPPER    subcadena literal y contigua de requirementText
 *     CONTEXTUAL            de requirementText O de objectiveContext
 *
 * La regla anterior —todo `sourcePhrase` contra `requirementText`— era demasiado
 * estricta y volvia IRREPRESENTABLE un qualifier contextual legitimo, que es
 * precisamente el que cita el entorno del Objective. Al reves tampoco sirve:
 * dejar que un MATERIAL_QUALIFIER se ancle en el contexto permitiria acotar el
 * Requirement con algo que el Requirement no dice.
 *
 * CONTENCION LITERAL, sin normalizar whitespace, sin plegar mayusculas y sin
 * matching difuso. Cualquiera de esas cosas haria pasar frases que el snapshot no
 * contiene, y esta verificacion existe exactamente para que eso no pase. Se
 * verifica acá ADEMAS de en el AI service porque la autoridad es el snapshot
 * persistido, no lo que el servicio remoto dijo haber recibido.
 *
 * `observed` NUNCA lleva el `sourcePhrase`: es texto del Objective. Lleva el rol,
 * que es un token cerrado.
 */
function verifyQualifierAnchors(
  analysis: VerifiedObjectiveAnalysis,
  snapshot: ConfirmedObjectiveSnapshot
): void {
  const textById = new Map(
    snapshot.requirements.map((item) => [item.requirementId, item.requirementText])
  );

  for (const [index, requirement] of analysis.requirements.entries()) {
    const requirementText = textById.get(requirement.requirementId) ?? '';

    for (const [position, qualifier] of requirement.qualifiers.entries()) {
      const path = `objectiveAnalysis.requirements[${index}].qualifiers[${position}].sourcePhrase`;
      const inRequirement = requirementText.includes(qualifier.sourcePhrase);

      if (inRequirement) continue;

      if (qualifier.role === CONTEXTUAL) {
        if (snapshot.objectiveContext.includes(qualifier.sourcePhrase)) continue;
        failArtifact('QUALIFIER_ANCHOR_NOT_LITERAL', {
          invariant:
            'contextual_qualifier_must_quote_requirement_text_or_objective_context',
          path,
          observed: qualifier.role
        });
      }

      // Rol material o estructural. Se distingue "no esta en ningun lado" de
      // "esta, pero solo en el contexto": son dos fallos distintos y colapsarlos
      // esconderia cual de los dos ocurrio.
      if (snapshot.objectiveContext.includes(qualifier.sourcePhrase)) {
        failArtifact('QUALIFIER_ANCHOR_NOT_IN_REQUIREMENT_TEXT', {
          invariant: 'objective_context_cannot_anchor_a_material_qualifier',
          path,
          observed: qualifier.role
        });
      }

      failArtifact('QUALIFIER_ANCHOR_NOT_LITERAL', {
        invariant: 'qualifier_source_phrase_must_be_a_literal_requirement_quote',
        path,
        observed: qualifier.role
      });
    }
  }
}

/**
 * §16B — pertenencia al grounding congelado.
 *
 * Verifica que cada fuente que una EvidenceUnit dice haber usado sea realmente
 * una fuente INCLUIDA de este run, y que el SHA coincida con el congelado. Lo que
 * impide es lo peor que podria pasar en silencio: que el razonamiento se apoye en
 * material que el inventario excluyo o bloqueo.
 *
 * NO valida `exactExcerpt` contra el texto canonico, ni la contencion en el
 * segmento, ni la correccion de pagina. Eso necesita el artifact de
 * `source_extraction_v1` y es F3.4. Aca se verifica MEMBRESIA, no reconstruccion.
 */
export function verifyEvidenceUnitsAgainstRunInventory(
  evidenceUnits: VerifiedEvidenceUnits,
  inventory: readonly FrozenInventoryItem[]
): void {
  const grounded = new Map<string, string>();

  for (const item of inventory) {
    if (item.disposition !== INCLUDED) continue;
    // El CHECK de la migracion ya garantiza que un INCLUDED trae las tres
    // columnas, pero este verificador es puro y recibe datos de afuera: si
    // llegan incompletos se falla en vez de asumir.
    if (item.runLocalSourceId === null || item.sourceSha256 === null) {
      failArtifact('SOURCE_REFERENCE_NOT_GROUNDED', {
        invariant: 'an_included_inventory_item_carries_its_binding_fields',
        path: 'inventory'
      });
    }
    if (grounded.has(item.runLocalSourceId)) {
      failArtifact('RUN_LOCAL_SOURCE_ID_DUPLICATED', {
        invariant: 'run_local_source_ids_are_unique_within_a_run',
        path: 'inventory',
        observed: item.runLocalSourceId
      });
    }
    grounded.set(item.runLocalSourceId, item.sourceSha256);
  }

  for (const [index, unit] of evidenceUnits.evidenceUnits.entries()) {
    const path = `evidenceUnits.evidenceUnits[${index}].sourceTrace`;
    const expectedSha = grounded.get(unit.sourceTrace.sourceId);

    if (expectedSha === undefined) {
      // Cubre los dos casos de una sola vez: la fuente no existe en el run, o
      // existe pero fue EXCLUDED_*/BLOCKED_*. Ninguna de las dos puede servir de
      // grounding, y el codigo lo dice.
      failArtifact('SOURCE_REFERENCE_NOT_GROUNDED', {
        invariant: 'evidence_may_only_come_from_an_included_inventory_item',
        path: `${path}.sourceId`,
        observed: unit.sourceTrace.sourceId
      });
    }

    if (expectedSha !== unit.sourceTrace.sourceSha256) {
      failArtifact('SOURCE_SHA_MISMATCH', {
        invariant: 'evidence_trace_sha_must_equal_the_frozen_inventory_sha',
        path: `${path}.sourceSha256`,
        observed: unit.sourceTrace.sourceId
      });
    }
  }

  // ---------------------------------------------------------------------
  // IGUALDAD DE CONJUNTOS entre lo declarado y lo incluido.
  //
  // No alcanza con que cada declaracion apunte a un item INCLUDED: el conjunto
  // tiene que ser EXACTAMENTE el mismo en las dos direcciones.
  //
  // La direccion que se olvida es la segunda. Si `sources[]` se construyera
  // recorriendo las EvidenceUnits producidas, una fuente INCLUDED que no genero
  // ninguna unidad —coverage FAILED, por ejemplo— quedaria sin declarar y sin que
  // nada lo notara. Y esa fuente SI entro al grounding set: `coverage FAILED` es
  // input epistemologico valido con sus limites de observabilidad, no ausencia de
  // fuente. Perder su declaracion seria perder de quien provienen las
  // afirmaciones de un material que el razonamiento si considero.
  // ---------------------------------------------------------------------
  const declared = new Set<string>();
  for (const [index, source] of evidenceUnits.sources.entries()) {
    if (declared.has(source.sourceId)) {
      failArtifact('SOURCE_DECLARATION_DUPLICATE', {
        invariant: 'one_declaration_per_included_source',
        path: `evidenceUnits.sources[${index}].sourceId`,
        observed: source.sourceId
      });
    }
    if (!grounded.has(source.sourceId)) {
      // No es "cito evidencia de una fuente excluida": es atribuirle autoridad de
      // asercion a material que quedo fuera del razonamiento.
      failArtifact('SOURCE_DECLARATION_NOT_INCLUDED', {
        invariant: 'only_included_inventory_items_are_declared',
        path: `evidenceUnits.sources[${index}].sourceId`,
        observed: source.sourceId
      });
    }
    declared.add(source.sourceId);
  }

  for (const sourceId of grounded.keys()) {
    if (!declared.has(sourceId)) {
      failArtifact('SOURCE_DECLARATION_MISSING', {
        invariant: 'every_included_inventory_item_is_declared',
        path: 'evidenceUnits.sources',
        observed: sourceId
      });
    }
  }

  // Misma igualdad para los hechos de observabilidad, y por el mismo motivo: una
  // fuente incluida que no produjo unidades sigue teniendo un coverage que
  // reportar. Sin su fact, el reasoner no sabria que esa fuente se observo mal.
  const described = new Set<string>();
  for (const [index, fact] of evidenceUnits.preparation.sourceObservabilityFacts.entries()) {
    if (!grounded.has(fact.sourceId)) {
      failArtifact('SOURCE_REFERENCE_NOT_GROUNDED', {
        invariant: 'observability_facts_describe_included_sources_only',
        path: `evidenceUnits.preparation.sourceObservabilityFacts[${index}].sourceId`,
        observed: fact.sourceId
      });
    }
    described.add(fact.sourceId);
  }

  for (const sourceId of grounded.keys()) {
    if (!described.has(sourceId)) {
      failArtifact('SOURCE_DECLARATION_MISSING', {
        invariant: 'every_included_inventory_item_has_an_observability_fact',
        path: 'evidenceUnits.preparation.sourceObservabilityFacts',
        observed: sourceId
      });
    }
  }
}

/**
 * §20 — referencias del resultado contra las dos etapas anteriores.
 *
 * Un resultado que referencia un Requirement inexistente o un EvidenceUnit que
 * nadie construyo no es un resultado: es una afirmacion sin anclaje. Y como el
 * resultado NO recopia ninguno de los dos, estas referencias son lo unico que
 * los une.
 */
export function verifyReasoningResultReferences(
  result: VerifiedReasoningRunResult,
  analysis: VerifiedObjectiveAnalysis,
  evidenceUnits: VerifiedEvidenceUnits
): void {
  const analysedRequirements = analysis.requirements.map(
    (item) => item.requirementId
  );
  const analysedSet = new Set(analysedRequirements);
  const catalog = new Set(
    evidenceUnits.evidenceUnits.map((unit) => unit.evidenceUnitId)
  );

  const assertEvidence = (
    ids: readonly string[],
    path: string,
    invariant: string
  ): void => {
    for (const [index, id] of ids.entries()) {
      if (!catalog.has(id)) {
        failArtifact('EVIDENCE_UNIT_REFERENCE_UNKNOWN', {
          invariant,
          path: `${path}[${index}]`,
          observed: id
        });
      }
    }
  };

  for (const [index, requirementResult] of result.requirementResults.entries()) {
    const path = `result.requirementResults[${index}]`;

    if (!analysedSet.has(requirementResult.requirementId)) {
      failArtifact('REQUIREMENT_REFERENCE_UNKNOWN', {
        invariant: 'result_may_only_conclude_about_analysed_requirements',
        path: `${path}.requirementId`,
        observed: requirementResult.requirementId
      });
    }

    for (const [position, evaluated] of requirementResult.evaluatedEvidence.entries()) {
      if (!catalog.has(evaluated.evidenceUnitId)) {
        failArtifact('EVIDENCE_UNIT_REFERENCE_UNKNOWN', {
          invariant: 'evaluated_evidence_must_exist_in_the_catalog',
          path: `${path}.evaluatedEvidence[${position}].evidenceUnitId`,
          observed: evaluated.evidenceUnitId
        });
      }
    }

    for (const [position, facet] of requirementResult.facets.entries()) {
      assertEvidence(
        facet.evidenceUnitIds,
        `${path}.facets[${position}].evidenceUnitIds`,
        'facet_evidence_must_exist_in_the_catalog'
      );
    }

    assertEvidence(
      requirementResult.jointClaimCeiling.supportingEvidenceUnitIds,
      `${path}.jointClaimCeiling.supportingEvidenceUnitIds`,
      'claim_ceiling_support_must_exist_in_the_catalog'
    );
    assertEvidence(
      requirementResult.compositionAssessment.nonRedundantEvidenceUnitIds,
      `${path}.compositionAssessment.nonRedundantEvidenceUnitIds`,
      'composition_support_must_exist_in_the_catalog'
    );
    assertEvidence(
      requirementResult.compositionAssessment.integrationEvidenceIds,
      `${path}.compositionAssessment.integrationEvidenceIds`,
      'integration_evidence_must_exist_in_the_catalog'
    );

    const candidate = requirementResult.weakerClaimSearch.candidate;
    if (candidate !== null) {
      assertEvidence(
        candidate.supportingEvidenceUnitIds,
        `${path}.weakerClaimSearch.candidate.supportingEvidenceUnitIds`,
        'weaker_claim_support_must_exist_in_the_catalog'
      );
    }
  }

  // Exactamente un resultado por Requirement analizado. El validador de forma ya
  // descarto duplicados, asi que basta comprobar que no falte ninguno.
  const concluded = new Set(
    result.requirementResults.map((item) => item.requirementId)
  );
  for (const requirementId of analysedRequirements) {
    if (!concluded.has(requirementId)) {
      failArtifact('REQUIREMENT_COVERAGE_INCOMPLETE', {
        invariant: 'every_analysed_requirement_must_have_exactly_one_result',
        path: 'result.requirementResults',
        observed: requirementId
      });
    }
  }
}
