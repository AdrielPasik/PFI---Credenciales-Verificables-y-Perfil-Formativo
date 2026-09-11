/**
 * Contrato transitorio del razonamiento contextual — F3.5.
 *
 * Dos verificaciones distintas, probadas juntas porque se usan juntas:
 * la ESTRUCTURAL (forma y vocabularios) y la de REFERENCIAS (que todo lo
 * nombrado exista en el universo congelado de este run).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTEXTUAL_REASONING_CONTRACT_VERSION,
  type ContextualRequirementResult
} from './contextual-reasoning.contract';
import { verifyContextualRequirementResult } from './contextual-reasoning.validator';
import { verifyContextualResultReferences } from './contextual-reasoning-references.verifier';
import { ReasoningRunArtifactError } from './reasoning-run-artifact.errors';
import { verifyEvidenceUnitsArtifact } from './evidence-units-artifact.validator';
import { verifyObjectiveAnalysisArtifact } from './objective-analysis-artifact.validator';

const REQUIREMENT_TEXT = 'Diseno de APIs REST con manejo de errores';

function qualifier(id: string | null, role = 'MATERIAL_QUALIFIER', phrase = 'APIs REST'): any {
  return {
    qualifierId: id,
    kind: 'tecnologia',
    value: 'REST',
    sourcePhrase: phrase,
    role,
    rationale: 'Acota el alcance.'
  };
}

function analysisArtifact(requirements: any[]): any {
  return { schemaVersion: 'objective_analysis_v1', requirements };
}

function analysisRequirement(id = 'req_01', qualifiers: any[] = [qualifier('q_01')]): any {
  return {
    requirementId: id,
    epistemicTarget: 'FORMATIVE_EVIDENCE',
    epistemicTargetRationale: 'Pide formacion.',
    atomicity: 'ATOMIC',
    evaluability: {
      requiredEvidenceType: 'FORMATIVE_EVIDENCE',
      formativeEvidenceCapable: true,
      rationale: 'Evaluable.'
    },
    qualifiers,
    normalizedRequirement: 'Formacion en APIs REST.',
    validations: [
      {
        taxonomy: 'SEMANTIC_CONSISTENCY',
        code: 'EPISTEMIC_TARGET_CLASSIFICATION',
        status: 'MANUAL_ADJUDICATION_REQUIRED',
        artifactRef: id,
        detail: 'FORMATIVE_EVIDENCE',
        affectsEpistemicState: false
      }
    ]
  };
}

function evidenceCatalog(unitIds: string[] = ['eu_01']): any {
  return {
    schemaVersion: 'evidence_units_v1',
    sources: [{ sourceId: 'src_01', sourceProvenance: 'ISSUER_DECLARED' }],
    evidenceUnits: unitIds.map((id) => ({
      evidenceUnitId: id,
      normalizedProposition: 'Cubre APIs REST.',
      claimType: 'DECLARED_CONTENT',
      semanticQualifiers: [],
      exactQuote: 'Curso de APIs REST.',
      contextBefore: '',
      contextAfter: '',
      sectionLabel: null,
      sourceTrace: {
        sourceId: 'src_01',
        sourceSha256: 'a'.repeat(64),
        segmentId: 'd:0-19',
        pageNumber: null,
        charStart: 0,
        charEnd: 19,
        exactExcerpt: 'Curso de APIs REST.'
      },
      interpretationProvenance: 'AI_INFERRED',
      extractionQuality: 'FULL'
    })),
    preparation: {
      mode: 'FULL_SCAN',
      evidenceUnitIds: unitIds,
      exactRedundancyGroups: [],
      sourceObservabilityFacts: [
        {
          sourceId: 'src_01',
          coverageStatus: 'FULL',
          observedEvidenceUnitIds: unitIds,
          extractionDiagnostics: []
        }
      ],
      discardedEvidenceProposalCount: 0
    },
    validations: []
  };
}

function continuity(status = 'YES', overrides: Record<string, unknown> = {}): any {
  const transformation =
    status === 'YES' ? 'CONSTITUTIVE_REDUCTION' : status === 'NO' ? 'SEMANTIC_SHIFT' : 'UNRESOLVED';
  return {
    status,
    transformation,
    requirementBasisPhrases: ['APIs REST'],
    constitutiveProjection: 'Version mas general.',
    explicitlyRelaxed: ['manejo de errores'],
    externalTargetIntroduced: 'NO',
    shiftReason: status === 'NO' ? 'PREREQUISITE_OR_FOUNDATION' : null,
    rationale: 'Mismo target.',
    ...overrides
  };
}

function candidate(overrides: Record<string, unknown> = {}): any {
  return {
    text: 'Formacion introductoria en APIs REST.',
    supportingEvidenceUnitIds: ['eu_01'],
    derivedFromJointClaimCeiling: 'YES',
    droppedQualifierIds: [],
    droppedFacetLocalKeys: [],
    continuityAssessment: continuity(),
    materialUsefulness: 'YES',
    usefulnessRationale: 'Aporta.',
    ...overrides
  };
}

function contextualResult(overrides: Record<string, unknown> = {}): any {
  return {
    requirementId: 'req_01',
    evaluatedEvidence: [
      {
        evidenceUnitId: 'eu_01',
        relation: 'LIMITED_SCOPE',
        supportedQualifierIds: ['q_01'],
        missingQualifierIds: [],
        evidenceContribution: 'Menor alcance.',
        rationale: 'Mismo nucleo.'
      }
    ],
    facets: [],
    compositionAssessment: {
      mode: 'NONE',
      nonRedundantEvidenceUnitIds: ['eu_01'],
      jointlySupportsFullRequirement: false,
      integrationRequired: false,
      integrationDemonstrated: false,
      integrationEvidenceIds: [],
      missingFacetLocalKeys: [],
      unresolved: false,
      rationale: 'Una unidad.'
    },
    fullClaimAssessment: {
      status: 'NOT_REACHED',
      supportedQualifierIds: ['q_01'],
      missingQualifierIds: [],
      coveredFacetLocalKeys: [],
      missingFacetLocalKeys: [],
      rationale: 'No alcanza.'
    },
    jointClaimCeiling: {
      text: 'Formacion en APIs REST.',
      supportingEvidenceUnitIds: ['eu_01']
    },
    observabilityAssessment: {
      incompleteSourceAssessments: [],
      independentObservableSupport: 'WEAKER_CLAIM',
      observabilityStatus: 'SUFFICIENT',
      rationale: 'Fuente completa.'
    },
    weakerClaimSearch: {
      status: 'FOUND',
      rationale: 'Buscada.',
      candidate: candidate()
    },
    semanticUnresolved: false,
    unresolvedReason: '',
    ...overrides
  };
}

function facet(key = 'facet_01', overrides: Record<string, unknown> = {}): any {
  return {
    localFacetKey: key,
    facetText: 'Manejo de errores',
    requirementBasisPhrases: ['manejo de errores'],
    whyNecessary: 'El Requirement lo pide.',
    essential: true,
    coverage: 'PARTIAL',
    evidenceUnitIds: ['eu_01'],
    rationale: 'Parcial.',
    ...overrides
  };
}

function universe(overrides: Record<string, any> = {}) {
  return {
    analysisRequirement: verifyObjectiveAnalysisArtifact(
      analysisArtifact([overrides.requirement ?? analysisRequirement()])
    ).requirements[0],
    requirementText: REQUIREMENT_TEXT,
    evidenceUnits: verifyEvidenceUnitsArtifact(overrides.catalog ?? evidenceCatalog()),
    ...(overrides.extra ?? {})
  };
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error: unknown) {
    assert.ok(error instanceof ReasoningRunArtifactError, String(error));
    assert.equal(error.code, code);
    return;
  }
  throw new Error(`expected ${code} but nothing was thrown`);
}

function verified(overrides: Record<string, unknown> = {}): ContextualRequirementResult {
  return verifyContextualRequirementResult(contextualResult(overrides));
}

// ---------------------------------------------------------------------------
// Estructura
// ---------------------------------------------------------------------------

test('un resultado contextual valido pasa las dos verificaciones', () => {
  const result = verified();
  verifyContextualResultReferences(result, universe());
  assert.equal(result.requirementId, 'req_01');
});

test('el contrato transitorio se identifica con su propia version', () => {
  assert.equal(CONTEXTUAL_REASONING_CONTRACT_VERSION, 'contextual_reasoning_v1');
});

// ---------------------------------------------------------------------------
// Ninguna autoridad de estado final
// ---------------------------------------------------------------------------

for (const key of ['finalState', 'policyTrace', 'explanation']) {
  test(`el proveedor no puede traer ${key}`, () => {
    expectCode(
      () => verifyContextualRequirementResult(contextualResult({ [key]: 'SUPPORTED' })),
      'EXPERIMENTAL_FIELD_NOT_ALLOWED'
    );
  });
}

for (const key of ['globalScore', 'fitPercentage', 'rank', 'chainOfThought']) {
  test(`${key} no existe en el contrato congelado`, () => {
    expectCode(
      () => verifyContextualRequirementResult(contextualResult({ [key]: 1 })),
      'EXPERIMENTAL_FIELD_NOT_ALLOWED'
    );
  });
}

// ---------------------------------------------------------------------------
// Vocabularios cerrados
// ---------------------------------------------------------------------------

test('una relation fuera de la taxonomia se rechaza', () => {
  const invalid = contextualResult();
  invalid.evaluatedEvidence[0].relation = 'STRONG_SUPPORT';
  expectCode(() => verifyContextualRequirementResult(invalid), 'ENUM_TOKEN_UNSUPPORTED');
});

test('una relation no es un estado final', () => {
  const invalid = contextualResult();
  invalid.evaluatedEvidence[0].relation = 'SUPPORTED';
  expectCode(() => verifyContextualRequirementResult(invalid), 'ENUM_TOKEN_UNSUPPORTED');
});

// ---------------------------------------------------------------------------
// DELTA_A y DELTA_B, contradicciones estructurales
// ---------------------------------------------------------------------------

test('FOUND sin candidate se rechaza', () => {
  expectCode(
    () =>
      verifyContextualRequirementResult(
        contextualResult({
          weakerClaimSearch: { status: 'FOUND', rationale: 'x', candidate: null }
        })
      ),
    'SCHEMA_INVALID'
  );
});

test('NONE con candidate se rechaza', () => {
  expectCode(
    () =>
      verifyContextualRequirementResult(
        contextualResult({
          weakerClaimSearch: { status: 'NONE', rationale: 'x', candidate: candidate() }
        })
      ),
    'SCHEMA_INVALID'
  );
});

test('la transformacion debe acompanar al status de continuidad', () => {
  expectCode(
    () =>
      verifyContextualRequirementResult(
        contextualResult({
          weakerClaimSearch: {
            status: 'FOUND',
            rationale: 'x',
            candidate: candidate({
              continuityAssessment: continuity('YES', { transformation: 'SEMANTIC_SHIFT' })
            })
          }
        })
      ),
    'SCHEMA_INVALID'
  );
});

test('un SEMANTIC_SHIFT sin shiftReason se rechaza', () => {
  expectCode(
    () =>
      verifyContextualRequirementResult(
        contextualResult({
          weakerClaimSearch: {
            status: 'FOUND',
            rationale: 'x',
            candidate: candidate({
              continuityAssessment: continuity('NO', { shiftReason: null }),
              materialUsefulness: 'NOT_EVALUATED'
            })
          }
        })
      ),
    'SCHEMA_INVALID'
  );
});

test('la utilidad material sin continuidad YES se rechaza', () => {
  // La clausula restaurada de B2.4.1: la utilidad nunca rescata un shift.
  expectCode(
    () =>
      verifyContextualRequirementResult(
        contextualResult({
          weakerClaimSearch: {
            status: 'FOUND',
            rationale: 'x',
            candidate: candidate({ continuityAssessment: continuity('NO') })
          }
        })
      ),
    'SCHEMA_INVALID'
  );
});

test('NOT_EVALUATED con continuidad NO es valido', () => {
  const result = verifyContextualRequirementResult(
    contextualResult({
      weakerClaimSearch: {
        status: 'FOUND',
        rationale: 'x',
        candidate: candidate({
          continuityAssessment: continuity('NO'),
          materialUsefulness: 'NOT_EVALUATED'
        })
      }
    })
  );
  assert.equal(result.weakerClaimSearch.candidate?.materialUsefulness, 'NOT_EVALUATED');
});

// ---------------------------------------------------------------------------
// LA PRUEBA CENTRAL: qualifiers Requirement-locales
// ---------------------------------------------------------------------------

test('req_01/q_01 y req_02/q_01 son qualifiers DISTINTOS', () => {
  // El experimento congelado numeraba global y un solo mapa habria resuelto los
  // dos. El producto no: la identidad es el par.
  const analysis = verifyObjectiveAnalysisArtifact(
    analysisArtifact([
      analysisRequirement('req_01', [qualifier('q_01')]),
      analysisRequirement('req_02', [qualifier('q_01')])
    ])
  );
  const catalog = verifyEvidenceUnitsArtifact(evidenceCatalog());

  // req_01 dice que q_01 esta soportado; req_02 dice que su q_01 falta.
  const first = verified();
  const second = verifyContextualRequirementResult(
    contextualResult({
      requirementId: 'req_02',
      fullClaimAssessment: {
        status: 'NOT_REACHED',
        supportedQualifierIds: [],
        missingQualifierIds: ['q_01'],
        coveredFacetLocalKeys: [],
        missingFacetLocalKeys: [],
        rationale: 'Falta.'
      },
      evaluatedEvidence: [
        {
          evidenceUnitId: 'eu_01',
          relation: 'RELATED_NON_ENTAILING',
          supportedQualifierIds: [],
          missingQualifierIds: ['q_01'],
          evidenceContribution: 'x',
          rationale: 'y'
        }
      ]
    })
  );

  // Cada uno resuelve SOLO contra su propio Requirement, y ambos pasan.
  verifyContextualResultReferences(first, {
    analysisRequirement: analysis.requirements[0],
    requirementText: REQUIREMENT_TEXT,
    evidenceUnits: catalog
  });
  verifyContextualResultReferences(second, {
    analysisRequirement: analysis.requirements[1],
    requirementText: REQUIREMENT_TEXT,
    evidenceUnits: catalog
  });
});

test('un qualifier que no existe en ESTE Requirement se rechaza', () => {
  const result = verified();
  // El universo declara solo q_01; el resultado no puede nombrar q_02 aunque
  // exista en otro Requirement.
  const analysis = verifyObjectiveAnalysisArtifact(
    analysisArtifact([analysisRequirement('req_01', [qualifier('q_02')])])
  );
  expectCode(
    () =>
      verifyContextualResultReferences(result, {
        analysisRequirement: analysis.requirements[0],
        requirementText: REQUIREMENT_TEXT,
        evidenceUnits: verifyEvidenceUnitsArtifact(evidenceCatalog())
      }),
    'REQUIREMENT_REFERENCE_UNKNOWN'
  );
});

test('el error de qualifier nombra el PAR, no solo el id', () => {
  const result = verified();
  const analysis = verifyObjectiveAnalysisArtifact(
    analysisArtifact([analysisRequirement('req_01', [qualifier('q_02')])])
  );
  try {
    verifyContextualResultReferences(result, {
      analysisRequirement: analysis.requirements[0],
      requirementText: REQUIREMENT_TEXT,
      evidenceUnits: verifyEvidenceUnitsArtifact(evidenceCatalog())
    });
  } catch (error: unknown) {
    assert.ok(error instanceof ReasoningRunArtifactError);
    assert.equal(error.observed, 'req_01/q_01');
    return;
  }
  throw new Error('expected the reference verification to fail');
});

test('un qualifier CONTEXTUAL no es referenciable', () => {
  // Describe el entorno del Requirement: no puede volverse condicion de soporte.
  const analysis = verifyObjectiveAnalysisArtifact(
    analysisArtifact([
      analysisRequirement('req_01', [qualifier(null, 'CONTEXTUAL'), qualifier('q_01')])
    ])
  );
  const invalid = verifyContextualRequirementResult(
    contextualResult({
      fullClaimAssessment: {
        status: 'NOT_REACHED',
        supportedQualifierIds: [],
        missingQualifierIds: ['q_02'],
        coveredFacetLocalKeys: [],
        missingFacetLocalKeys: [],
        rationale: 'x'
      }
    })
  );
  expectCode(
    () =>
      verifyContextualResultReferences(invalid, {
        analysisRequirement: analysis.requirements[0],
        requirementText: REQUIREMENT_TEXT,
        evidenceUnits: verifyEvidenceUnitsArtifact(evidenceCatalog())
      }),
    'REQUIREMENT_REFERENCE_UNKNOWN'
  );
});

test('droppedQualifierIds tambien se resuelve dentro del Requirement', () => {
  const result = verified({
    weakerClaimSearch: {
      status: 'FOUND',
      rationale: 'x',
      candidate: candidate({ droppedQualifierIds: ['q_99'] })
    }
  });
  expectCode(
    () => verifyContextualResultReferences(result, universe()),
    'REQUIREMENT_REFERENCE_UNKNOWN'
  );
});

// ---------------------------------------------------------------------------
// Referencias a EvidenceUnits: todas las superficies
// ---------------------------------------------------------------------------

const evidenceSurfaces: [string, () => ContextualRequirementResult][] = [
  [
    'evaluatedEvidence',
    () =>
      verified({
        evaluatedEvidence: [
          {
            evidenceUnitId: 'eu_99',
            relation: 'DIRECT_SUPPORT',
            supportedQualifierIds: [],
            missingQualifierIds: [],
            evidenceContribution: 'x',
            rationale: 'y'
          }
        ]
      })
  ],
  ['facets', () => verified({ facets: [facet('facet_01', { evidenceUnitIds: ['eu_99'] })] })],
  [
    'composition.nonRedundant',
    () =>
      verified({
        compositionAssessment: {
          ...contextualResult().compositionAssessment,
          nonRedundantEvidenceUnitIds: ['eu_99']
        }
      })
  ],
  [
    'composition.integration',
    () =>
      verified({
        compositionAssessment: {
          ...contextualResult().compositionAssessment,
          integrationEvidenceIds: ['eu_99']
        }
      })
  ],
  [
    'jointClaimCeiling',
    () => verified({ jointClaimCeiling: { text: 'x', supportingEvidenceUnitIds: ['eu_99'] } })
  ],
  [
    'weakerClaim.candidate',
    () =>
      verified({
        weakerClaimSearch: {
          status: 'FOUND',
          rationale: 'x',
          candidate: candidate({ supportingEvidenceUnitIds: ['eu_99'] })
        }
      })
  ]
];

for (const [surface, build] of evidenceSurfaces) {
  test(`una EvidenceUnit desconocida en ${surface} se rechaza`, () => {
    expectCode(
      () => verifyContextualResultReferences(build(), universe()),
      'EVIDENCE_UNIT_REFERENCE_UNKNOWN'
    );
  });
}

// ---------------------------------------------------------------------------
// Facets
// ---------------------------------------------------------------------------

test('claves de facet duplicadas se rechazan', () => {
  expectCode(
    () => verifyContextualRequirementResult(contextualResult({ facets: [facet(), facet()] })),
    'IDENTIFIER_DUPLICATED'
  );
});

test('req_01/facet_01 y req_02/facet_01 no colisionan', () => {
  // `localFacetKey` es local al Requirement: la misma clave en dos Requirements
  // distintos son facets distintas, y ninguna verificacion las mezcla.
  const analysis = verifyObjectiveAnalysisArtifact(
    analysisArtifact([
      analysisRequirement('req_01', [qualifier('q_01')]),
      analysisRequirement('req_02', [qualifier('q_01')])
    ])
  );
  const catalog = verifyEvidenceUnitsArtifact(evidenceCatalog());

  const first = verified({ facets: [facet('facet_01')] });
  const second = verifyContextualRequirementResult(
    contextualResult({ requirementId: 'req_02', facets: [facet('facet_01')] })
  );

  verifyContextualResultReferences(first, {
    analysisRequirement: analysis.requirements[0],
    requirementText: REQUIREMENT_TEXT,
    evidenceUnits: catalog
  });
  verifyContextualResultReferences(second, {
    analysisRequirement: analysis.requirements[1],
    requirementText: REQUIREMENT_TEXT,
    evidenceUnits: catalog
  });
});

const facetSurfaces: [string, () => ContextualRequirementResult][] = [
  [
    'composition.missingFacetLocalKeys',
    () =>
      verified({
        facets: [facet()],
        compositionAssessment: {
          ...contextualResult().compositionAssessment,
          missingFacetLocalKeys: ['facet_99']
        }
      })
  ],
  [
    'fullClaim.coveredFacetLocalKeys',
    () =>
      verified({
        facets: [facet()],
        fullClaimAssessment: {
          ...contextualResult().fullClaimAssessment,
          coveredFacetLocalKeys: ['facet_99']
        }
      })
  ],
  [
    'weakerClaim.droppedFacetLocalKeys',
    () =>
      verified({
        facets: [facet()],
        weakerClaimSearch: {
          status: 'FOUND',
          rationale: 'x',
          candidate: candidate({ droppedFacetLocalKeys: ['facet_99'] })
        }
      })
  ]
];

for (const [surface, build] of facetSurfaces) {
  test(`una facet colgada en ${surface} se rechaza`, () => {
    expectCode(
      () => verifyContextualResultReferences(build(), universe()),
      'FACET_KEY_DUPLICATED'
    );
  });
}

test('la base de una facet debe ser cita literal del Requirement', () => {
  const result = verified({
    facets: [facet('facet_01', { requirementBasisPhrases: ['algo inventado'] })]
  });
  expectCode(
    () => verifyContextualResultReferences(result, universe()),
    'QUALIFIER_ANCHOR_NOT_LITERAL'
  );
});

test('una facet sin base se rechaza', () => {
  const result = verified({
    facets: [facet('facet_01', { requirementBasisPhrases: [] })]
  });
  expectCode(() => verifyContextualResultReferences(result, universe()), 'TEXT_EMPTY');
});

test('la base de continuidad tambien debe ser literal', () => {
  const result = verified({
    weakerClaimSearch: {
      status: 'FOUND',
      rationale: 'x',
      candidate: candidate({
        continuityAssessment: continuity('YES', { requirementBasisPhrases: ['inventado'] })
      })
    }
  });
  expectCode(
    () => verifyContextualResultReferences(result, universe()),
    'QUALIFIER_ANCHOR_NOT_LITERAL'
  );
});

// ---------------------------------------------------------------------------
// Requirement y observabilidad
// ---------------------------------------------------------------------------

test('un resultado que responde por otro Requirement se rechaza', () => {
  const result = verified({ requirementId: 'req_02' });
  expectCode(
    () => verifyContextualResultReferences(result, universe()),
    'REQUIREMENT_REFERENCE_UNKNOWN'
  );
});

test('una fuente ajena en observabilidad se rechaza', () => {
  const result = verified({
    observabilityAssessment: {
      incompleteSourceAssessments: [
        {
          sourceId: 'src_99',
          affectedRequirementElements: [],
          missingMaterialRelevance: 'RELEVANT',
          rationale: 'x'
        }
      ],
      independentObservableSupport: 'NONE',
      observabilityStatus: 'MATERIAL_GAP',
      rationale: 'x'
    }
  });
  expectCode(
    () => verifyContextualResultReferences(result, universe()),
    'SOURCE_REFERENCE_NOT_GROUNDED'
  );
});

test('una EvidenceUnit evaluada dos veces se rechaza', () => {
  const entry = contextualResult().evaluatedEvidence[0];
  expectCode(
    () =>
      verifyContextualRequirementResult(
        contextualResult({ evaluatedEvidence: [entry, { ...entry }] })
      ),
    'IDENTIFIER_DUPLICATED'
  );
});

// ---------------------------------------------------------------------------
// Privacidad
// ---------------------------------------------------------------------------

test('los errores no filtran texto del Requirement ni citas', () => {
  const result = verified({
    facets: [facet('facet_01', { requirementBasisPhrases: ['TEXTO-CONFIDENCIAL'] })]
  });
  try {
    verifyContextualResultReferences(result, universe());
  } catch (error: unknown) {
    assert.ok(error instanceof ReasoningRunArtifactError);
    assert.ok(!error.message.includes('TEXTO-CONFIDENCIAL'));
    assert.ok(!String(error.observed).includes('TEXTO-CONFIDENCIAL'));
    return;
  }
  throw new Error('expected the verification to fail');
});
