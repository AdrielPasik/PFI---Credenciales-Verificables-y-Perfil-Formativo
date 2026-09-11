/**
 * Policy epistemológica determinista — slice F3.6.
 *
 * NINGÚN estado final se afirma por fixture. Cada caso arma entradas
 * ESTRUCTURADAS legítimas —relaciones, composición, ceiling, continuidad,
 * utilidad, observabilidad, evaluabilidad— y comprueba qué sale. Un test que
 * pusiera `finalState: 'SUPPORTED'` en la fixture y lo leyera de vuelta no
 * probaría la policy: probaría el `deepEqual`.
 *
 *     REAL_PROVIDER_CALLS: 0
 *
 * La policy es pura: no hay proveedor, ni base, ni reloj que apagar.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyDeterministicReasoningPolicy,
  DeterministicPolicyInputError,
  POLICY_GUARD_PRECEDENCE,
  derivePolicyInputs,
  epistemicIntegrityGuards,
  hasHardFactualFailure,
  resolveFinalState
} from './deterministic-epistemic-policy';
import {
  clone,
  CONFIRMED_REQUIREMENT_TEXT,
  validEvidenceUnits,
  validObjectiveAnalysis,
  validResult,
  type Mutable
} from './__fixtures__/reasoning-run-artifacts.fixture';

// ---------------------------------------------------------------------------
// Constructores de entrada
// ---------------------------------------------------------------------------

/**
 * El resultado contextual de F3.5: el `RequirementResult` congelado MENOS las
 * tres claves que F3.6 agrega. Se deriva de la fixture del artifact final en vez
 * de escribirse a mano, para que no puedan divergir.
 */
function contextual(requirementId = 'req_01'): Mutable {
  const result = clone(validResult().requirementResults[0]) as Mutable;
  delete result.finalState;
  delete result.policyTrace;
  delete result.explanation;
  result.requirementId = requirementId;
  return result;
}

function analysis(requirementId = 'req_01'): Mutable {
  const requirement = clone(validObjectiveAnalysis().requirements[0]) as Mutable;
  requirement.requirementId = requirementId;
  return requirement;
}

function definition(requirementIds: readonly string[] = ['req_01']): Mutable {
  return {
    schemaVersion: 'objective_definition_v1',
    objectiveType: 'EMPLOYMENT',
    objectiveContext: 'Backend Developer Junior en equipo de plataforma',
    source: { inputType: 'DIRECT_STRUCTURED_INPUT', originalText: null },
    requirements: requirementIds.map((requirementId, index) => ({
      requirementId,
      order: index + 1,
      requirementText: CONFIRMED_REQUIREMENT_TEXT,
      provenance: { kind: 'DIRECT_STRUCTURED_INPUT', sourceQuote: null },
      qualifiers: []
    }))
  };
}

/** Arma el input completo de la policy a partir de piezas ya mutadas. */
function policyInput(options: {
  requirementIds?: readonly string[];
  analyses?: readonly Mutable[];
  contextuals?: readonly Mutable[];
  evidenceUnits?: Mutable;
}) {
  const ids = options.requirementIds ?? ['req_01'];
  return {
    definition: definition(ids),
    objectiveAnalysis: {
      schemaVersion: 'objective_analysis_v1',
      requirements: options.analyses ?? ids.map((id) => analysis(id))
    },
    evidenceUnits: options.evidenceUnits ?? validEvidenceUnits(),
    contextualReasoning: {
      schemaVersion: 'contextual_reasoning_v1',
      requirementResults: options.contextuals ?? ids.map((id) => contextual(id))
    }
  } as never;
}

function stateOf(options: Parameters<typeof policyInput>[0]): string {
  const result = applyDeterministicReasoningPolicy(policyInput(options));
  return result.requirementResults[0].finalState;
}

/** Un único Requirement con el resultado contextual ya mutado. */
function stateFor(mutate: (result: Mutable) => void): string {
  const result = contextual();
  mutate(result);
  return stateOf({ contextuals: [result] });
}

/** Un único Requirement con el análisis ya mutado. */
function stateForAnalysis(
  mutate: (requirement: Mutable) => void,
  mutateResult: (result: Mutable) => void = () => {}
): string {
  const requirement = analysis();
  mutate(requirement);
  const result = contextual();
  mutateResult(result);
  return stateOf({ analyses: [requirement], contextuals: [result] });
}

// ---------------------------------------------------------------------------
// Precedencia de guards — la cadena congelada
// ---------------------------------------------------------------------------

test('la precedencia declarada tiene los cinco guards en el orden congelado', () => {
  assert.deepEqual(POLICY_GUARD_PRECEDENCE, [
    'NOT_FORMATIVE_EVIDENCE_CAPABLE',
    'UNRESOLVED_OR_HARD_FACTUAL_FAILURE',
    'REACHES_FULL_REQUIREMENT',
    'MATERIALLY_USEFUL_WEAKER_CLAIM_WITH_CONTINUITY',
    'RESIDUAL_INSUFFICIENT_EVIDENCE'
  ]);
});

test('la no-evaluabilidad gana sobre TODO lo demas', () => {
  // Un caso que satisface simultaneamente los guards 1, 2, 3 y 4. Si la cadena
  // no estuviera ordenada, cualquiera de los cuatro podria contestar.
  assert.equal(
    resolveFinalState({
      formativeEvidenceCapable: false,
      unresolved: true,
      criticalGuardFailure: true,
      reachesFullRequirement: true,
      hasMateriallyUsefulWeakerClaim: true,
      weakerClaimStillBelongsToRequirement: true
    }),
    'NOT_ASSESSABLE'
  );
});

test('la irresolucion gana sobre alcanzar el Requirement completo', () => {
  assert.equal(
    resolveFinalState({
      formativeEvidenceCapable: true,
      unresolved: true,
      criticalGuardFailure: false,
      reachesFullRequirement: true,
      hasMateriallyUsefulWeakerClaim: true,
      weakerClaimStillBelongsToRequirement: true
    }),
    'ABSTAIN'
  );
});

test('un guard factual duro produce ABSTAIN aunque nada este irresuelto', () => {
  assert.equal(
    resolveFinalState({
      formativeEvidenceCapable: true,
      unresolved: false,
      criticalGuardFailure: true,
      reachesFullRequirement: true,
      hasMateriallyUsefulWeakerClaim: false,
      weakerClaimStillBelongsToRequirement: false
    }),
    'ABSTAIN'
  );
});

test('el claim completo gana sobre el claim mas debil', () => {
  assert.equal(
    resolveFinalState({
      formativeEvidenceCapable: true,
      unresolved: false,
      criticalGuardFailure: false,
      reachesFullRequirement: true,
      hasMateriallyUsefulWeakerClaim: true,
      weakerClaimStillBelongsToRequirement: true
    }),
    'SUPPORTED'
  );
});

test('los tres estados negativos NO se colapsan entre si', () => {
  const base = {
    formativeEvidenceCapable: true,
    unresolved: false,
    criticalGuardFailure: false,
    reachesFullRequirement: false,
    hasMateriallyUsefulWeakerClaim: false,
    weakerClaimStillBelongsToRequirement: false
  };
  assert.equal(resolveFinalState(base), 'INSUFFICIENT_EVIDENCE');
  assert.equal(resolveFinalState({ ...base, unresolved: true }), 'ABSTAIN');
  assert.equal(
    resolveFinalState({ ...base, formativeEvidenceCapable: false }),
    'NOT_ASSESSABLE'
  );
});

// ---------------------------------------------------------------------------
// Los cinco estados desde entradas estructuradas legitimas
// ---------------------------------------------------------------------------

test('PARTIALLY_SUPPORTED: la topologia exacta del smoke real de B2.4.1', () => {
  // relations LIMITED_SCOPE · fullClaim NOT_REACHED · weaker FOUND ·
  // continuidad YES/CONSTITUTIVE_REDUCTION · externalTarget NO · utilidad YES ·
  // observabilidad SUFFICIENT. NO se fuerza el estado: se comprueba que la
  // policy congelada maneja esta topologia por si sola.
  assert.equal(
    stateFor((result) => {
      result.evaluatedEvidence[0].relation = 'LIMITED_SCOPE';
      result.facets = [
        { ...clone(contextual().facets[0]), coverage: 'PARTIAL' },
        {
          ...clone(contextual().facets[0]),
          localFacetKey: 'facet_rest_semantics',
          coverage: 'NONE'
        }
      ];
      result.fullClaimAssessment.missingFacetLocalKeys = [
        'facet_api_design',
        'facet_rest_semantics'
      ];
    }),
    'PARTIALLY_SUPPORTED'
  );
});

test('SUPPORTED: el claim completo alcanzado', () => {
  assert.equal(
    stateFor((result) => {
      result.fullClaimAssessment.status = 'REACHED';
      result.fullClaimAssessment.supportedQualifierIds = ['q_01'];
      result.fullClaimAssessment.missingQualifierIds = [];
      result.fullClaimAssessment.coveredFacetLocalKeys = ['facet_api_design'];
      result.fullClaimAssessment.missingFacetLocalKeys = [];
      // Un claim completo alcanzado no necesita version debil: DELTA_A exige que
      // sin `FOUND` no haya candidato.
      result.weakerClaimSearch = {
        status: 'NONE',
        rationale: 'El requisito completo ya esta cubierto.',
        candidate: null
      };
    }),
    'SUPPORTED'
  );
});

test('INSUFFICIENT_EVIDENCE: se busco claim mas debil y no habia', () => {
  assert.equal(
    stateFor((result) => {
      result.weakerClaimSearch = {
        status: 'NONE',
        rationale: 'No se identifico una version defendible del requisito.',
        candidate: null
      };
    }),
    'INSUFFICIENT_EVIDENCE'
  );
});

test('ABSTAIN: la busqueda del claim mas debil quedo irresoluble', () => {
  assert.equal(
    stateFor((result) => {
      result.weakerClaimSearch = {
        status: 'UNRESOLVED',
        rationale: 'No se puede resolver responsablemente.',
        candidate: null
      };
    }),
    'ABSTAIN'
  );
});

test('NOT_ASSESSABLE: el Requirement no admite evidencia formativa', () => {
  assert.equal(
    stateForAnalysis((requirement) => {
      requirement.epistemicTarget = 'INDIVIDUAL_ACHIEVEMENT';
      requirement.evaluability.requiredEvidenceType = 'PROFESSIONAL_HISTORY';
      requirement.evaluability.formativeEvidenceCapable = false;
    }),
    'NOT_ASSESSABLE'
  );
});

// ---------------------------------------------------------------------------
// Los ocho aportantes de `unresolved`
// ---------------------------------------------------------------------------

test('cada aportante de irresolucion produce ABSTAIN por si solo', () => {
  const cases: readonly [string, (result: Mutable) => void][] = [
    ['semanticUnresolved', (r) => { r.semanticUnresolved = true; r.unresolvedReason = 'x'; }],
    ['composition', (r) => { r.compositionAssessment.unresolved = true; }],
    ['fullClaim', (r) => { r.fullClaimAssessment.status = 'UNRESOLVED'; }],
    ['observability MATERIAL_GAP', (r) => {
      r.observabilityAssessment.observabilityStatus = 'MATERIAL_GAP';
    }],
    ['observability UNRESOLVED', (r) => {
      r.observabilityAssessment.observabilityStatus = 'UNRESOLVED';
    }],
    ['weakerSearch', (r) => {
      r.weakerClaimSearch = { status: 'UNRESOLVED', rationale: 'x', candidate: null };
    }],
    ['continuity', (r) => {
      r.weakerClaimSearch.candidate.continuityAssessment.status = 'UNRESOLVED';
      r.weakerClaimSearch.candidate.continuityAssessment.transformation = 'UNRESOLVED';
      r.weakerClaimSearch.candidate.materialUsefulness = 'NOT_EVALUATED';
    }],
    ['usefulness', (r) => {
      r.weakerClaimSearch.candidate.materialUsefulness = 'UNRESOLVED';
    }]
  ];
  for (const [name, mutate] of cases) {
    assert.equal(stateFor(mutate), 'ABSTAIN', name);
  }
});

test('DELTA_C: un epistemicTarget UNRESOLVED es irresolucion, no un default', () => {
  // Sin este aportante, un target sin resolver caeria en silencio como si fuera
  // FORMATIVE_EVIDENCE y el caso terminaria PARTIALLY_SUPPORTED.
  assert.equal(
    stateForAnalysis((requirement) => {
      requirement.epistemicTarget = 'UNRESOLVED';
    }),
    'ABSTAIN'
  );
});

// ---------------------------------------------------------------------------
// Claim mas debil · continuidad · utilidad — la matriz de B2.4.1
// ---------------------------------------------------------------------------

test('FOUND no produce PARTIALLY_SUPPORTED por si solo', () => {
  // La continuidad NO significa que el claim se desplazo a otro objetivo. Que la
  // busqueda haya encontrado algo no lo devuelve a este Requirement.
  assert.equal(
    stateFor((result) => {
      const candidate = result.weakerClaimSearch.candidate;
      candidate.continuityAssessment.status = 'NO';
      candidate.continuityAssessment.transformation = 'SEMANTIC_SHIFT';
      candidate.continuityAssessment.shiftReason = 'PREREQUISITE_OR_FOUNDATION';
      candidate.materialUsefulness = 'NOT_EVALUATED';
    }),
    'INSUFFICIENT_EVIDENCE'
  );
});

test('un vecino o sustituto util NO se convierte en soporte parcial', () => {
  assert.equal(
    stateFor((result) => {
      const candidate = result.weakerClaimSearch.candidate;
      candidate.continuityAssessment.status = 'NO';
      candidate.continuityAssessment.transformation = 'SEMANTIC_SHIFT';
      candidate.continuityAssessment.shiftReason = 'NEIGHBOR_OR_SUBSTITUTION';
      candidate.continuityAssessment.externalTargetIntroduced = 'YES';
      candidate.materialUsefulness = 'NOT_EVALUATED';
    }),
    'INSUFFICIENT_EVIDENCE'
  );
});

test('continuidad YES con utilidad NO no alcanza para soporte parcial', () => {
  assert.equal(
    stateFor((result) => {
      result.weakerClaimSearch.candidate.materialUsefulness = 'NO';
    }),
    'INSUFFICIENT_EVIDENCE'
  );
});

test('la clausula restaurada de B2.4.1: la utilidad nunca rescata un desplazamiento', () => {
  // `continuidad NO + utilidad YES` no es representable en el contrato, y aunque
  // llegara, la policy la ordena: primero continuidad, despues utilidad.
  const derived = derivePolicyInputs(
    analysis() as never,
    {
      ...contextual(),
      weakerClaimSearch: {
        status: 'FOUND',
        rationale: 'x',
        candidate: {
          ...clone(contextual().weakerClaimSearch.candidate),
          materialUsefulness: 'YES',
          continuityAssessment: {
            ...clone(contextual().weakerClaimSearch.candidate.continuityAssessment),
            status: 'NO',
            transformation: 'SEMANTIC_SHIFT',
            shiftReason: 'OTHER'
          }
        }
      }
    } as never,
    false
  );
  assert.equal(derived.finalStateInputs.hasMateriallyUsefulWeakerClaim, false);
  assert.equal(derived.finalStateInputs.weakerClaimStillBelongsToRequirement, false);
  assert.equal(resolveFinalState(derived.finalStateInputs), 'INSUFFICIENT_EVIDENCE');
});

// ---------------------------------------------------------------------------
// Ceiling · composicion · qualifiers — negativos
// ---------------------------------------------------------------------------

test('CEILING: semantica positiva sin una sola EvidenceUnit no puede sobre-afirmar', () => {
  // Relaciones favorables y `REACHED`, pero ni el ceiling ni el candidato nombran
  // evidencia. Sin el guard, esto seria `SUPPORTED` sin nada que lo sostenga.
  const result = contextual();
  result.evaluatedEvidence[0].relation = 'DIRECT_SUPPORT';
  result.fullClaimAssessment.status = 'REACHED';
  result.fullClaimAssessment.supportedQualifierIds = ['q_01'];
  result.fullClaimAssessment.missingQualifierIds = [];
  result.fullClaimAssessment.coveredFacetLocalKeys = ['facet_api_design'];
  result.fullClaimAssessment.missingFacetLocalKeys = [];
  result.jointClaimCeiling.supportingEvidenceUnitIds = [];
  result.weakerClaimSearch = { status: 'NONE', rationale: 'x', candidate: null };

  const artifact = applyDeterministicReasoningPolicy(
    policyInput({ contextuals: [result] })
  );
  const only = artifact.requirementResults[0];
  assert.equal(only.finalState, 'ABSTAIN');
  // La diferencia entre los dos estados es EXACTAMENTE lo que aporto el guard.
  assert.equal(only.policyTrace.preGuardState, 'SUPPORTED');
  assert.equal(only.policyTrace.hardFactualFailure, true);
});

test('COMPOSICION: la pluralidad no fabrica integracion ni soporte completo', () => {
  const evidence = validEvidenceUnits();
  const extra = clone(evidence.evidenceUnits[0]) as Mutable;
  extra.evidenceUnitId = 'eu_02';
  extra.sourceTrace.charStart = 40;
  extra.sourceTrace.charEnd = 59;
  evidence.evidenceUnits.push(extra);
  evidence.preparation.evidenceUnitIds = ['eu_01', 'eu_02'];
  evidence.preparation.sourceObservabilityFacts[0].observedEvidenceUnitIds = [
    'eu_01',
    'eu_02'
  ];

  const result = contextual();
  result.evaluatedEvidence.push({
    ...clone(result.evaluatedEvidence[0]),
    evidenceUnitId: 'eu_02'
  });
  result.compositionAssessment.mode = 'MULTIPLE_INDEPENDENT';
  result.compositionAssessment.nonRedundantEvidenceUnitIds = ['eu_01', 'eu_02'];
  result.compositionAssessment.integrationRequired = true;
  result.compositionAssessment.integrationDemonstrated = false;
  result.compositionAssessment.jointlySupportsFullRequirement = false;
  result.weakerClaimSearch = { status: 'NONE', rationale: 'x', candidate: null };

  // DOS unidades, integracion exigida y NO demostrada: sigue sin alcanzar.
  assert.equal(
    stateOf({ contextuals: [result], evidenceUnits: evidence }),
    'INSUFFICIENT_EVIDENCE'
  );
});

test('QUALIFIER: falta un qualifier MATERIAL y el claim completo no se alcanza', () => {
  // No se infiere el desenlace: se comprueba que la policy consume el estado que
  // el razonador produjo con ese qualifier faltante.
  const result = contextual();
  result.fullClaimAssessment.missingQualifierIds = ['q_01'];
  result.weakerClaimSearch = { status: 'NONE', rationale: 'x', candidate: null };
  assert.equal(stateOf({ contextuals: [result] }), 'INSUFFICIENT_EVIDENCE');
});

// ---------------------------------------------------------------------------
// Identidad LOCAL al Requirement
// ---------------------------------------------------------------------------

test('COLISION DE QUALIFIER: req_01/q_01 y req_02/q_01 son independientes', () => {
  const first = analysis('req_01');
  const second = analysis('req_02');
  // Mismo `qualifierId`, significados distintos. Un mapa global los confundiria.
  second.qualifiers[0].value = 'avanzado';

  const alcanzado = contextual('req_01');
  alcanzado.fullClaimAssessment.status = 'REACHED';
  alcanzado.fullClaimAssessment.supportedQualifierIds = ['q_01'];
  alcanzado.fullClaimAssessment.missingQualifierIds = [];
  alcanzado.fullClaimAssessment.coveredFacetLocalKeys = ['facet_api_design'];
  alcanzado.fullClaimAssessment.missingFacetLocalKeys = [];
  alcanzado.weakerClaimSearch = { status: 'NONE', rationale: 'x', candidate: null };

  const faltante = contextual('req_02');
  faltante.fullClaimAssessment.missingQualifierIds = ['q_01'];
  faltante.weakerClaimSearch = { status: 'NONE', rationale: 'x', candidate: null };

  const artifact = applyDeterministicReasoningPolicy(
    policyInput({
      requirementIds: ['req_01', 'req_02'],
      analyses: [first, second],
      contextuals: [alcanzado, faltante]
    })
  );
  assert.equal(artifact.requirementResults[0].finalState, 'SUPPORTED');
  assert.equal(artifact.requirementResults[1].finalState, 'INSUFFICIENT_EVIDENCE');
});

test('COLISION DE FACET: req_01/facet_01 y req_02/facet_01 son independientes', () => {
  const cubierta = contextual('req_01');
  cubierta.facets[0].localFacetKey = 'facet_01';
  cubierta.facets[0].coverage = 'FULL';
  cubierta.fullClaimAssessment.status = 'REACHED';
  cubierta.fullClaimAssessment.supportedQualifierIds = ['q_01'];
  cubierta.fullClaimAssessment.missingQualifierIds = [];
  cubierta.fullClaimAssessment.coveredFacetLocalKeys = ['facet_01'];
  cubierta.fullClaimAssessment.missingFacetLocalKeys = [];
  cubierta.weakerClaimSearch = { status: 'NONE', rationale: 'x', candidate: null };

  const vacia = contextual('req_02');
  vacia.facets[0].localFacetKey = 'facet_01';
  vacia.facets[0].coverage = 'NONE';
  vacia.fullClaimAssessment.coveredFacetLocalKeys = [];
  vacia.fullClaimAssessment.missingFacetLocalKeys = ['facet_01'];
  vacia.weakerClaimSearch = { status: 'NONE', rationale: 'x', candidate: null };

  const artifact = applyDeterministicReasoningPolicy(
    policyInput({
      requirementIds: ['req_01', 'req_02'],
      contextuals: [cubierta, vacia]
    })
  );
  assert.equal(artifact.requirementResults[0].finalState, 'SUPPORTED');
  assert.equal(artifact.requirementResults[1].finalState, 'INSUFFICIENT_EVIDENCE');
});

// ---------------------------------------------------------------------------
// Observabilidad
// ---------------------------------------------------------------------------

test('observabilidad COMPLETA con evidencia debil es INSUFFICIENT, no ABSTAIN', () => {
  // La distincion epistemologica del contrato: una fuente leida entera cuya
  // evidencia no alcanza NO es lo mismo que una fuente que no se pudo observar.
  const result = contextual();
  result.evaluatedEvidence[0].relation = 'RELATED_NON_ENTAILING';
  result.observabilityAssessment.observabilityStatus = 'SUFFICIENT';
  result.weakerClaimSearch = { status: 'NONE', rationale: 'x', candidate: null };
  assert.equal(stateOf({ contextuals: [result] }), 'INSUFFICIENT_EVIDENCE');
});

test('una laguna material de observabilidad si produce ABSTAIN', () => {
  const evidence = validEvidenceUnits();
  evidence.preparation.sourceObservabilityFacts[0].coverageStatus = 'PARTIAL';

  const result = contextual();
  result.observabilityAssessment.observabilityStatus = 'MATERIAL_GAP';
  result.observabilityAssessment.incompleteSourceAssessments = [
    {
      sourceId: 'src_01',
      affectedRequirementElements: ['facet_api_design'],
      missingMaterialRelevance: 'MATERIAL',
      rationale: 'Falta material relevante para el requisito.'
    }
  ];
  assert.equal(
    stateOf({ contextuals: [result], evidenceUnits: evidence }),
    'ABSTAIN'
  );
});

test('coverage FAILED NO se convierte mecanicamente en ABSTAIN', () => {
  // El hecho determinista es que una fuente no se pudo leer entera. Si el
  // razonador juzgo que esa limitacion es IRRELEVANTE para este Requirement, la
  // policy no la convierte en abstencion por su cuenta.
  const evidence = validEvidenceUnits();
  evidence.preparation.sourceObservabilityFacts[0].coverageStatus = 'FAILED';

  const result = contextual();
  result.observabilityAssessment.observabilityStatus = 'SUFFICIENT';
  result.observabilityAssessment.incompleteSourceAssessments = [
    {
      sourceId: 'src_01',
      affectedRequirementElements: [],
      missingMaterialRelevance: 'IRRELEVANT',
      rationale: 'Lo no leido no toca este requisito.'
    }
  ];
  assert.equal(
    stateOf({ contextuals: [result], evidenceUnits: evidence }),
    'PARTIALLY_SUPPORTED'
  );
});

test('alegar una laguna sobre una fuente leida ENTERA es un guard duro', () => {
  const result = contextual();
  result.observabilityAssessment.incompleteSourceAssessments = [
    {
      sourceId: 'src_01', // la fixture la declara `FULL`
      affectedRequirementElements: [],
      missingMaterialRelevance: 'IRRELEVANT',
      rationale: 'Inventa una laguna que los hechos del run contradicen.'
    }
  ];
  const artifact = applyDeterministicReasoningPolicy(
    policyInput({ contextuals: [result] })
  );
  assert.equal(artifact.requirementResults[0].finalState, 'ABSTAIN');
  assert.equal(artifact.requirementResults[0].policyTrace.hardFactualFailure, true);
  const codes = artifact.validations
    .filter((item) => item.status === 'FAIL')
    .map((item) => item.code);
  assert.ok(codes.includes('INCOMPLETE_SOURCE_ASSESSMENTS_ELIGIBLE'), codes.join(','));
  assert.ok(codes.includes('FULL_SOURCES_NO_MISSING_MATERIAL'), codes.join(','));
});

// ---------------------------------------------------------------------------
// Guards duros restantes
// ---------------------------------------------------------------------------

test('la procedencia no puede usarse como soporte semantico', () => {
  const result = contextual();
  result.fullClaimAssessment.rationale =
    'La credencial esta verificada en blockchain, lo que aumenta el soporte del requisito.';
  const artifact = applyDeterministicReasoningPolicy(
    policyInput({ contextuals: [result] })
  );
  assert.equal(artifact.requirementResults[0].finalState, 'ABSTAIN');
  assert.ok(
    artifact.validations.some(
      (item) =>
        item.code === 'PROVENANCE_BLOCKCHAIN_NOT_SEMANTIC_SUPPORT' &&
        item.status === 'FAIL'
    )
  );
});

test('la busqueda del claim mas debil sin documentar cuando era exigida', () => {
  const result = contextual();
  result.weakerClaimSearch = { status: 'NONE', rationale: '   ', candidate: null };
  const artifact = applyDeterministicReasoningPolicy(
    policyInput({ contextuals: [result] })
  );
  assert.equal(artifact.requirementResults[0].finalState, 'ABSTAIN');
  assert.ok(
    artifact.validations.some(
      (item) =>
        item.code === 'WEAKER_SEARCH_DOCUMENTED_WHEN_REQUIRED' &&
        item.status === 'FAIL'
    )
  );
});

test('el cue de logro individual es DESCRIPTIVO y no cambia el estado', () => {
  const result = contextual();
  result.compositionAssessment.rationale =
    'La persona cuenta con experiencia y domina el tema.';
  const artifact = applyDeterministicReasoningPolicy(
    policyInput({ contextuals: [result] })
  );
  assert.equal(artifact.requirementResults[0].finalState, 'PARTIALLY_SUPPORTED');
  const cue = artifact.validations.find(
    (item) => item.code === 'EPISTEMIC_TARGET_PRESERVATION'
  );
  assert.equal(cue?.status, 'MANUAL_ADJUDICATION_REQUIRED');
  assert.equal(cue?.affectsEpistemicState, false);
  // El detail lleva un CONTEO, nunca las palabras del razonador.
  assert.ok(/^target=FORMATIVE_EVIDENCE;cues=\d+$/.test(cue?.detail ?? ''));
});

test('hasHardFactualFailure ignora lo que no afecta el estado epistemico', () => {
  assert.equal(
    hasHardFactualFailure([
      {
        taxonomy: 'HARD_FACTUAL_INVARIANT',
        code: 'X',
        status: 'FAIL',
        artifactRef: 'req_01',
        detail: '',
        affectsEpistemicState: false
      },
      {
        taxonomy: 'SEMANTIC_CONSISTENCY',
        code: 'Y',
        status: 'FAIL',
        artifactRef: 'req_01',
        detail: '',
        affectsEpistemicState: true
      }
    ]),
    false
  );
});

test('los guards no inventan fallos sobre una entrada sana', () => {
  const guards = epistemicIntegrityGuards(
    analysis() as never,
    contextual() as never,
    validEvidenceUnits() as never,
    false
  );
  assert.equal(hasHardFactualFailure(guards), false);
});

// ---------------------------------------------------------------------------
// Artifact final
// ---------------------------------------------------------------------------

test('hay exactamente un resultado por Requirement, en el orden del snapshot', () => {
  const ids = ['req_01', 'req_02', 'req_03'];
  // El razonamiento contextual llega DESORDENADO a proposito.
  const contextuals = ['req_03', 'req_01', 'req_02'].map((id) => contextual(id));
  const artifact = applyDeterministicReasoningPolicy(
    policyInput({ requirementIds: ids, contextuals })
  );
  assert.deepEqual(
    artifact.requirementResults.map((item) => item.requirementId),
    ids
  );
});

test('un Requirement del snapshot sin resultado contextual es inconsistencia', () => {
  assert.throws(
    () =>
      applyDeterministicReasoningPolicy(
        policyInput({
          requirementIds: ['req_01', 'req_02'],
          contextuals: [contextual('req_01'), contextual('req_01')]
        })
      ),
    DeterministicPolicyInputError
  );
});

test('sobran o faltan resultados contextuales respecto del snapshot', () => {
  assert.throws(
    () =>
      applyDeterministicReasoningPolicy(
        policyInput({
          requirementIds: ['req_01', 'req_02'],
          analyses: [analysis('req_01'), analysis('req_02')],
          contextuals: [contextual('req_01')]
        })
      ),
    DeterministicPolicyInputError
  );
});

test('el artifact no lleva score, porcentaje ni estado del Objective', () => {
  const artifact = applyDeterministicReasoningPolicy(policyInput({}));
  assert.deepEqual(Object.keys(artifact).sort(), [
    'requirementResults',
    'schemaVersion',
    'validations'
  ]);
  const serialized = JSON.stringify(artifact);
  for (const forbidden of [
    'globalScore',
    'fitPercentage',
    'rank',
    'chainOfThought',
    'confidence'
  ]) {
    assert.ok(!serialized.includes(forbidden), forbidden);
  }
});

test('DETERMINISMO: las mismas entradas producen el MISMO artifact', () => {
  const first = applyDeterministicReasoningPolicy(
    policyInput({ requirementIds: ['req_01', 'req_02'] })
  );
  const second = applyDeterministicReasoningPolicy(
    policyInput({ requirementIds: ['req_01', 'req_02'] })
  );
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('el artifact NO lleva timestamps', () => {
  const serialized = JSON.stringify(
    applyDeterministicReasoningPolicy(policyInput({}))
  );
  assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(serialized));
});

// ---------------------------------------------------------------------------
// Explicacion determinista
// ---------------------------------------------------------------------------

test('la explicacion habla de la EVIDENCIA, nunca de lo que la persona sabe', () => {
  const result = contextual();
  result.weakerClaimSearch = { status: 'NONE', rationale: 'Se busco.', candidate: null };
  const artifact = applyDeterministicReasoningPolicy(
    policyInput({ contextuals: [result] })
  );
  const { explanation, finalState } = artifact.requirementResults[0];

  assert.equal(finalState, 'INSUFFICIENT_EVIDENCE');
  assert.ok(explanation.includes('Estado: INSUFFICIENT_EVIDENCE.'));
  for (const forbidden of [
    'no sabe',
    'no puede',
    'carece de',
    'no es capaz',
    'incompetente',
    'no domina'
  ]) {
    assert.ok(!explanation.toLowerCase().includes(forbidden), forbidden);
  }
});

test('la explicacion cita la evidencia por sourceId local y excerpt exacto', () => {
  const artifact = applyDeterministicReasoningPolicy(policyInput({}));
  const { explanation } = artifact.requirementResults[0];
  assert.ok(explanation.includes('Evidencia: src_01: “diseno de APIs REST”.'));
  // El trace del producto NO lleva credentialId: no se puede citar lo que no hay.
  assert.ok(!explanation.includes('credentialId'));
});

test('la explicacion nombra el ceiling y la continuidad cuando existen', () => {
  const artifact = applyDeterministicReasoningPolicy(policyInput({}));
  const { explanation } = artifact.requirementResults[0];
  assert.ok(explanation.includes('Claim ceiling: Contenido declarado sobre APIs REST.'));
  assert.ok(explanation.includes('Claim más débil considerado:'));
  assert.ok(explanation.includes('reducción constitutiva del mismo Requirement'));
  assert.ok(explanation.includes('Se relaja explícitamente: nivel intermedio.'));
});

test('la explicacion dice cuando la continuidad NO es constitutiva', () => {
  const result = contextual();
  const candidate = result.weakerClaimSearch.candidate;
  candidate.continuityAssessment.status = 'NO';
  candidate.continuityAssessment.transformation = 'SEMANTIC_SHIFT';
  candidate.continuityAssessment.shiftReason = 'NEIGHBOR_OR_SUBSTITUTION';
  candidate.materialUsefulness = 'NOT_EVALUATED';

  const artifact = applyDeterministicReasoningPolicy(
    policyInput({ contextuals: [result] })
  );
  assert.ok(
    artifact.requirementResults[0].explanation.includes(
      'Continuidad: no constitutiva (NEIGHBOR_OR_SUBSTITUTION).'
    )
  );
});

test('la explicacion reporta la observabilidad solo cuando no es suficiente', () => {
  const evidence = validEvidenceUnits();
  evidence.preparation.sourceObservabilityFacts[0].coverageStatus = 'PARTIAL';
  const result = contextual();
  result.observabilityAssessment.observabilityStatus = 'MATERIAL_GAP';
  result.observabilityAssessment.rationale = 'Quedo material sin observar.';
  result.observabilityAssessment.incompleteSourceAssessments = [
    {
      sourceId: 'src_01',
      affectedRequirementElements: [],
      missingMaterialRelevance: 'MATERIAL',
      rationale: 'x'
    }
  ];

  const conGap = applyDeterministicReasoningPolicy(
    policyInput({ contextuals: [result], evidenceUnits: evidence })
  );
  assert.ok(
    conGap.requirementResults[0].explanation.includes(
      'Observabilidad: Quedo material sin observar.'
    )
  );

  const sinGap = applyDeterministicReasoningPolicy(policyInput({}));
  assert.ok(!sinGap.requirementResults[0].explanation.includes('Observabilidad:'));
});

// ---------------------------------------------------------------------------
// Trace
// ---------------------------------------------------------------------------

test('el policyTrace lleva las entradas deterministas y nada mas', () => {
  const artifact = applyDeterministicReasoningPolicy(policyInput({}));
  assert.deepEqual(
    Object.keys(artifact.requirementResults[0].policyTrace).sort(),
    [
      'continuityStatus',
      'epistemicTarget',
      'formativeEvidenceCapable',
      'hardFactualFailure',
      'hasMateriallyUsefulWeakerClaim',
      'materialUsefulness',
      'observabilityStatus',
      'preGuardState',
      'reachesFullRequirement',
      'unresolved',
      'weakerClaimStillBelongsToRequirement',
      'weakerSearchStatus'
    ]
  );
});

test('sin candidato, continuidad y utilidad quedan en null', () => {
  const result = contextual();
  result.weakerClaimSearch = { status: 'NONE', rationale: 'x', candidate: null };
  const artifact = applyDeterministicReasoningPolicy(
    policyInput({ contextuals: [result] })
  );
  const trace = artifact.requirementResults[0].policyTrace;
  assert.equal(trace.continuityStatus, null);
  assert.equal(trace.materialUsefulness, null);
  assert.equal(trace.weakerSearchStatus, 'NONE');
});

test('sin guards duros, preGuardState y finalState coinciden', () => {
  const artifact = applyDeterministicReasoningPolicy(policyInput({}));
  const trace = artifact.requirementResults[0].policyTrace;
  assert.equal(trace.hardFactualFailure, false);
  assert.equal(trace.preGuardState, artifact.requirementResults[0].finalState);
});

test('weakerSearchRequired se recomputa desde sus tres entradas', () => {
  const requiredWhenNotReached = derivePolicyInputs(
    analysis() as never,
    contextual() as never,
    false
  );
  assert.equal(requiredWhenNotReached.weakerSearchRequired, true);

  const alcanzado = contextual();
  alcanzado.fullClaimAssessment.status = 'REACHED';
  assert.equal(
    derivePolicyInputs(analysis() as never, alcanzado as never, false)
      .weakerSearchRequired,
    false
  );

  const conGap = contextual();
  conGap.observabilityAssessment.observabilityStatus = 'MATERIAL_GAP';
  assert.equal(
    derivePolicyInputs(analysis() as never, conGap as never, false)
      .weakerSearchRequired,
    false
  );
});
