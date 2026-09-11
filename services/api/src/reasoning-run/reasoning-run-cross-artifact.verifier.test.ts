/**
 * Verificadores cruzados entre artifacts de etapa — F3.1.
 *
 * Cada test parte de artifacts VALIDOS: lo que se prueba aca no es la forma sino
 * la coherencia entre etapas, que es una pregunta distinta.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clone,
  confirmedObjectiveSnapshot,
  validEvidenceUnits,
  validObjectiveAnalysis,
  validResult
} from './__fixtures__/reasoning-run-artifacts.fixture';
import { ReasoningRunArtifactError } from './reasoning-run-artifact.errors';
import { verifyEvidenceUnitsArtifact } from './evidence-units-artifact.validator';
import { verifyObjectiveAnalysisArtifact } from './objective-analysis-artifact.validator';
import { verifyReasoningRunResultArtifact } from './reasoning-run-result-artifact.validator';
import {
  verifyEvidenceUnitsAgainstRunInventory,
  verifyObjectiveAnalysisAgainstObjectiveSnapshot,
  verifyReasoningResultReferences,
  type FrozenInventoryItem
} from './reasoning-run-cross-artifact.verifier';

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

const includedInventory: readonly FrozenInventoryItem[] = [
  {
    disposition: 'INCLUDED',
    runLocalSourceId: 'src_01',
    sourceSha256: 'a'.repeat(64)
  }
];

// ---------------------------------------------------------------------------
// Objective Analysis contra el Objective congelado
// ---------------------------------------------------------------------------

test('un analisis que cubre exactamente los Requirements confirmados pasa', () => {
  const analysis = verifyObjectiveAnalysisArtifact(validObjectiveAnalysis());
  verifyObjectiveAnalysisAgainstObjectiveSnapshot(analysis, confirmedObjectiveSnapshot());
});

test('un Requirement analizado que el Objective no define se rechaza', () => {
  const raw = validObjectiveAnalysis();
  raw.requirements[0].requirementId = 'req_09';
  const analysis = verifyObjectiveAnalysisArtifact(raw);
  expectCode(
    () =>
      verifyObjectiveAnalysisAgainstObjectiveSnapshot(
        analysis,
        confirmedObjectiveSnapshot()
      ),
    'REQUIREMENT_REFERENCE_UNKNOWN'
  );
});

test('un Requirement confirmado sin analisis se rechaza', () => {
  // El Objective Analysis NO puede reducir el conjunto de Requirements: dejar uno
  // afuera cambiaria en silencio contra que se evalua al holder.
  const analysis = verifyObjectiveAnalysisArtifact(validObjectiveAnalysis());
  expectCode(
    () =>
      verifyObjectiveAnalysisAgainstObjectiveSnapshot(
        analysis,
        confirmedObjectiveSnapshot(['req_01', 'req_02'])
      ),
    'REQUIREMENT_COVERAGE_INCOMPLETE'
  );
});

test('el orden del analisis debe seguir al del Objective congelado', () => {
  const raw = validObjectiveAnalysis();
  const second = clone(raw.requirements[0]);
  second.requirementId = 'req_02';
  second.qualifiers[0].qualifierId = 'q_02';
  raw.requirements = [second, raw.requirements[0]];
  const analysis = verifyObjectiveAnalysisArtifact(raw);
  expectCode(
    () =>
      verifyObjectiveAnalysisAgainstObjectiveSnapshot(
        analysis,
        confirmedObjectiveSnapshot(['req_01', 'req_02'])
      ),
    'REQUIREMENT_COVERAGE_INCOMPLETE'
  );
});

// ---------------------------------------------------------------------------
// Anclaje de qualifiers — F3.3B
// ---------------------------------------------------------------------------

/** Cambia el `sourcePhrase` de un qualifier de la fixture y valida la forma. */
function withQualifier(
  index: number,
  patch: Record<string, unknown>
): ReturnType<typeof verifyObjectiveAnalysisArtifact> {
  const raw = validObjectiveAnalysis();
  Object.assign(raw.requirements[0].qualifiers[index], patch);
  return verifyObjectiveAnalysisArtifact(raw);
}

test('un MATERIAL_QUALIFIER que cita literalmente el Requirement pasa', () => {
  const analysis = withQualifier(0, { sourcePhrase: 'nivel intermedio' });
  verifyObjectiveAnalysisAgainstObjectiveSnapshot(
    analysis,
    confirmedObjectiveSnapshot()
  );
});

test('un CONTEXTUAL puede anclarse en el objectiveContext', () => {
  // Ésta es la razón por la que el anclaje es POR ROL y no uno solo: con la regla
  // anterior —todo contra requirementText— un contextual legítimo era
  // irrepresentable.
  const analysis = withQualifier(1, { sourcePhrase: 'equipo de plataforma' });
  verifyObjectiveAnalysisAgainstObjectiveSnapshot(
    analysis,
    confirmedObjectiveSnapshot()
  );
});

test('una frase que sólo está en el contexto NO puede ser MATERIAL_QUALIFIER', () => {
  const analysis = withQualifier(0, { sourcePhrase: 'equipo de plataforma' });
  expectCode(
    () =>
      verifyObjectiveAnalysisAgainstObjectiveSnapshot(
        analysis,
        confirmedObjectiveSnapshot()
      ),
    'QUALIFIER_ANCHOR_NOT_IN_REQUIREMENT_TEXT'
  );
});

test('un STRUCTURAL_WRAPPER tampoco puede anclarse en el contexto', () => {
  const analysis = withQualifier(0, {
    role: 'STRUCTURAL_WRAPPER',
    qualifierId: null,
    sourcePhrase: 'equipo de plataforma'
  });
  expectCode(
    () =>
      verifyObjectiveAnalysisAgainstObjectiveSnapshot(
        analysis,
        confirmedObjectiveSnapshot()
      ),
    'QUALIFIER_ANCHOR_NOT_IN_REQUIREMENT_TEXT'
  );
});

test('un sourcePhrase inventado no es persistible', () => {
  // La garantía no puede depender de que el prompt lo haya pedido.
  const analysis = withQualifier(0, { sourcePhrase: 'dominio avanzado' });
  expectCode(
    () =>
      verifyObjectiveAnalysisAgainstObjectiveSnapshot(
        analysis,
        confirmedObjectiveSnapshot()
      ),
    'QUALIFIER_ANCHOR_NOT_LITERAL'
  );
});

test('un CONTEXTUAL inventado tampoco pasa', () => {
  const analysis = withQualifier(1, { sourcePhrase: 'trabajo remoto' });
  expectCode(
    () =>
      verifyObjectiveAnalysisAgainstObjectiveSnapshot(
        analysis,
        confirmedObjectiveSnapshot()
      ),
    'QUALIFIER_ANCHOR_NOT_LITERAL'
  );
});

test('la contención es LITERAL: no se normaliza whitespace', () => {
  // Normalizar haría pasar frases que el snapshot no contiene, que es justo lo
  // que esta verificación existe para impedir.
  const analysis = withQualifier(0, { sourcePhrase: 'nivel  intermedio' });
  expectCode(
    () =>
      verifyObjectiveAnalysisAgainstObjectiveSnapshot(
        analysis,
        confirmedObjectiveSnapshot()
      ),
    'QUALIFIER_ANCHOR_NOT_LITERAL'
  );
});

test('la contención es LITERAL: no se pliegan mayúsculas', () => {
  const analysis = withQualifier(0, { sourcePhrase: 'Nivel Intermedio' });
  expectCode(
    () =>
      verifyObjectiveAnalysisAgainstObjectiveSnapshot(
        analysis,
        confirmedObjectiveSnapshot()
      ),
    'QUALIFIER_ANCHOR_NOT_LITERAL'
  );
});

test('la contención debe ser CONTIGUA', () => {
  // "APIs intermedio" son dos trozos del Requirement, pero no una cita.
  const analysis = withQualifier(0, { sourcePhrase: 'APIs intermedio' });
  expectCode(
    () =>
      verifyObjectiveAnalysisAgainstObjectiveSnapshot(
        analysis,
        confirmedObjectiveSnapshot()
      ),
    'QUALIFIER_ANCHOR_NOT_LITERAL'
  );
});

test('el error del anclaje no filtra texto del Objective', () => {
  const analysis = withQualifier(0, { sourcePhrase: 'dominio avanzado' });
  try {
    verifyObjectiveAnalysisAgainstObjectiveSnapshot(
      analysis,
      confirmedObjectiveSnapshot()
    );
  } catch (error: unknown) {
    assert.ok(error instanceof ReasoningRunArtifactError);
    // `observed` lleva el rol —token cerrado—, nunca la frase.
    assert.equal(error.observed, 'MATERIAL_QUALIFIER');
    assert.ok(!error.message.includes('dominio avanzado'));
    return;
  }
  throw new Error('expected the anchor verification to fail');
});

// ---------------------------------------------------------------------------
// EvidenceUnits contra el inventario congelado
// ---------------------------------------------------------------------------

test('EvidenceUnits ancladas en una fuente INCLUDED pasan', () => {
  const units = verifyEvidenceUnitsArtifact(validEvidenceUnits());
  verifyEvidenceUnitsAgainstRunInventory(units, includedInventory);
});

test('una fuente que no esta en el inventario se rechaza', () => {
  const units = verifyEvidenceUnitsArtifact(validEvidenceUnits());
  expectCode(
    () => verifyEvidenceUnitsAgainstRunInventory(units, []),
    'SOURCE_REFERENCE_NOT_GROUNDED'
  );
});

test('NINGUNA disposicion excluida o bloqueada puede servir de grounding', () => {
  // Es la invariante que mas importa de este verificador: si una fuente excluida
  // pudiera anclar evidencia, el inventario dejaria de significar algo.
  const units = verifyEvidenceUnitsArtifact(validEvidenceUnits());
  for (const disposition of [
    'EXCLUDED_ALTERNATE_REPRESENTATION',
    'EXCLUDED_SOURCE_SUPERSEDED',
    'EXCLUDED_UNSUPPORTED_TYPE',
    'EXCLUDED_CREDENTIAL_STATE_DRAFT',
    'EXCLUDED_CREDENTIAL_STATE_REVOKED',
    'EXCLUDED_NO_GROUNDING_SOURCE',
    'BLOCKED_EXTRACTION_UNAVAILABLE'
  ]) {
    expectCode(
      () =>
        verifyEvidenceUnitsAgainstRunInventory(units, [
          {
            disposition,
            runLocalSourceId: 'src_01',
            sourceSha256: 'a'.repeat(64)
          }
        ]),
      'SOURCE_REFERENCE_NOT_GROUNDED'
    );
  }
});

test('un sourceSha256 distinto del congelado se rechaza', () => {
  const units = verifyEvidenceUnitsArtifact(validEvidenceUnits());
  expectCode(
    () =>
      verifyEvidenceUnitsAgainstRunInventory(units, [
        {
          disposition: 'INCLUDED',
          runLocalSourceId: 'src_01',
          sourceSha256: 'b'.repeat(64)
        }
      ]),
    'SOURCE_SHA_MISMATCH'
  );
});

test('dos items INCLUDED con el mismo runLocalSourceId se rechazan', () => {
  const units = verifyEvidenceUnitsArtifact(validEvidenceUnits());
  expectCode(
    () =>
      verifyEvidenceUnitsAgainstRunInventory(units, [
        ...includedInventory,
        ...includedInventory
      ]),
    'RUN_LOCAL_SOURCE_ID_DUPLICATED'
  );
});

test('un observability fact sobre una fuente no incluida se rechaza', () => {
  const raw = validEvidenceUnits();
  raw.preparation.sourceObservabilityFacts.push({
    sourceId: 'src_02',
    coverageStatus: 'FAILED',
    observedEvidenceUnitIds: [],
    extractionDiagnostics: []
  });
  const units = verifyEvidenceUnitsArtifact(raw);
  expectCode(
    () => verifyEvidenceUnitsAgainstRunInventory(units, includedInventory),
    'SOURCE_REFERENCE_NOT_GROUNDED'
  );
});

test('un item INCLUDED sin sus campos de binding se rechaza', () => {
  const units = verifyEvidenceUnitsArtifact(validEvidenceUnits());
  expectCode(
    () =>
      verifyEvidenceUnitsAgainstRunInventory(units, [
        { disposition: 'INCLUDED', runLocalSourceId: null, sourceSha256: null }
      ]),
    'SOURCE_REFERENCE_NOT_GROUNDED'
  );
});

// ---------------------------------------------------------------------------
// Completitud: sources[] == el conjunto INCLUDED del inventario
// ---------------------------------------------------------------------------

/** Item INCLUDED del inventario, con el SHA que usan las fixtures. */
function included(runLocalSourceId: string): FrozenInventoryItem {
  return {
    disposition: 'INCLUDED',
    runLocalSourceId,
    sourceSha256: 'a'.repeat(64)
  };
}

test('una fuente INCLUDED sin declaracion se rechaza', () => {
  // La direccion que se olvida: cada declaracion apunta a un INCLUDED, pero falta
  // un INCLUDED sin declarar.
  const units = verifyEvidenceUnitsArtifact(validEvidenceUnits());
  expectCode(
    () =>
      verifyEvidenceUnitsAgainstRunInventory(units, [
        ...includedInventory,
        included('src_02')
      ]),
    'SOURCE_DECLARATION_MISSING'
  );
});

test('una fuente INCLUDED con coverage FAILED y CERO EvidenceUnits es valida si esta declarada', () => {
  // El caso que motiva toda esta invariante. `coverage FAILED` es input
  // epistemologico valido con sus limites de observabilidad, no ausencia de
  // fuente: la fuente entro al grounding set y su autoridad de asercion tiene que
  // quedar fijada aunque no haya producido ni una sola unidad.
  const raw = validEvidenceUnits();
  raw.evidenceUnits = [];
  raw.preparation.evidenceUnitIds = [];
  raw.preparation.exactRedundancyGroups = [];
  raw.preparation.sourceObservabilityFacts = [
    {
      sourceId: 'src_01',
      coverageStatus: 'FAILED',
      observedEvidenceUnitIds: [],
      extractionDiagnostics: ['NO_SUBSTANTIVE_CONTENT_OBSERVED']
    }
  ];
  raw.preparation.discardedEvidenceProposalCount = 0;

  const units = verifyEvidenceUnitsArtifact(raw);
  assert.equal(units.evidenceUnits.length, 0);
  assert.equal(units.sources.length, 1);

  verifyEvidenceUnitsAgainstRunInventory(units, includedInventory);
});

test('esa misma fuente SIN declaracion se rechaza', () => {
  // Es exactamente lo que pasaria si `sources[]` se construyera recorriendo las
  // EvidenceUnits producidas: cero unidades, cero declaraciones, y la fuente
  // desaparece del artifact sin que nada lo note.
  const raw = validEvidenceUnits();
  raw.evidenceUnits = [];
  raw.preparation.evidenceUnitIds = [];
  raw.preparation.exactRedundancyGroups = [];
  raw.preparation.sourceObservabilityFacts[0].observedEvidenceUnitIds = [];
  raw.sources = [];

  const units = verifyEvidenceUnitsArtifact(raw);
  expectCode(
    () => verifyEvidenceUnitsAgainstRunInventory(units, includedInventory),
    'SOURCE_DECLARATION_MISSING'
  );
});

test('la falta del observability fact de una fuente INCLUDED tambien se rechaza', () => {
  const raw = validEvidenceUnits();
  raw.preparation.sourceObservabilityFacts = [];
  const units = verifyEvidenceUnitsArtifact(raw);
  expectCode(
    () => verifyEvidenceUnitsAgainstRunInventory(units, includedInventory),
    'SOURCE_DECLARATION_MISSING'
  );
});

test('una declaracion para una fuente EXCLUIDA o BLOQUEADA se rechaza', () => {
  // No es "cito evidencia de una fuente excluida": es atribuirle autoridad de
  // asercion a material que quedo fuera del razonamiento. Por eso tiene codigo
  // propio.
  const raw = validEvidenceUnits();
  raw.evidenceUnits = [];
  raw.preparation.evidenceUnitIds = [];
  raw.preparation.exactRedundancyGroups = [];
  raw.preparation.sourceObservabilityFacts = [];
  const units = verifyEvidenceUnitsArtifact(raw);

  for (const disposition of [
    'EXCLUDED_ALTERNATE_REPRESENTATION',
    'EXCLUDED_SOURCE_SUPERSEDED',
    'EXCLUDED_UNSUPPORTED_TYPE',
    'EXCLUDED_NO_GROUNDING_SOURCE',
    'BLOCKED_EXTRACTION_UNAVAILABLE',
    'BLOCKED_EXTRACTION_INTEGRITY_FAILURE'
  ]) {
    expectCode(
      () =>
        verifyEvidenceUnitsAgainstRunInventory(units, [
          {
            disposition,
            runLocalSourceId: 'src_01',
            sourceSha256: 'a'.repeat(64)
          }
        ]),
      'SOURCE_DECLARATION_NOT_INCLUDED'
    );
  }
});

test('una declaracion duplicada se rechaza tambien en el verificador cruzado', () => {
  // El validador de forma ya la rechaza; el cruzado no puede confiar en que su
  // input haya pasado por el.
  const units = {
    ...verifyEvidenceUnitsArtifact(validEvidenceUnits()),
    sources: [
      { sourceId: 'src_01', sourceProvenance: 'ISSUER_DECLARED' as const },
      { sourceId: 'src_01', sourceProvenance: 'ISSUER_DECLARED' as const }
    ]
  };
  expectCode(
    () => verifyEvidenceUnitsAgainstRunInventory(units, includedInventory),
    'SOURCE_DECLARATION_DUPLICATE'
  );
});

test('un inventario con varias fuentes INCLUDED exige declarar TODAS', () => {
  const raw = validEvidenceUnits();
  raw.sources = [
    { sourceId: 'src_01', sourceProvenance: 'ISSUER_DECLARED' },
    { sourceId: 'src_02', sourceProvenance: 'ISSUER_DECLARED' }
  ];
  raw.preparation.sourceObservabilityFacts.push({
    sourceId: 'src_02',
    coverageStatus: 'PARTIAL',
    observedEvidenceUnitIds: [],
    extractionDiagnostics: []
  });

  const units = verifyEvidenceUnitsArtifact(raw);
  verifyEvidenceUnitsAgainstRunInventory(units, [
    ...includedInventory,
    included('src_02')
  ]);
});

// ---------------------------------------------------------------------------
// Resultado contra las dos etapas anteriores
// ---------------------------------------------------------------------------

function verified() {
  return {
    analysis: verifyObjectiveAnalysisArtifact(validObjectiveAnalysis()),
    units: verifyEvidenceUnitsArtifact(validEvidenceUnits()),
    result: verifyReasoningRunResultArtifact(validResult())
  };
}

test('un resultado con referencias resolubles pasa', () => {
  const { analysis, units, result } = verified();
  verifyReasoningResultReferences(result, analysis, units);
});

test('un resultado sobre un Requirement no analizado se rechaza', () => {
  const raw = validResult();
  raw.requirementResults[0].requirementId = 'req_07';
  const result = verifyReasoningRunResultArtifact(raw);
  const { analysis, units } = verified();
  expectCode(
    () => verifyReasoningResultReferences(result, analysis, units),
    'REQUIREMENT_REFERENCE_UNKNOWN'
  );
});

test('falta el resultado de un Requirement analizado', () => {
  const rawAnalysis = validObjectiveAnalysis();
  const second = clone(rawAnalysis.requirements[0]);
  second.requirementId = 'req_02';
  second.qualifiers[0].qualifierId = 'q_02';
  rawAnalysis.requirements.push(second);
  const analysis = verifyObjectiveAnalysisArtifact(rawAnalysis);
  const { units, result } = verified();
  expectCode(
    () => verifyReasoningResultReferences(result, analysis, units),
    'REQUIREMENT_COVERAGE_INCOMPLETE'
  );
});

test('cada superficie que referencia EvidenceUnits se verifica', () => {
  const surfaces: Array<(raw: any) => void> = [
    (raw) => {
      raw.requirementResults[0].evaluatedEvidence[0].evidenceUnitId = 'eu_09';
    },
    (raw) => {
      raw.requirementResults[0].facets[0].evidenceUnitIds = ['eu_09'];
    },
    (raw) => {
      raw.requirementResults[0].jointClaimCeiling.supportingEvidenceUnitIds = [
        'eu_09'
      ];
    },
    (raw) => {
      raw.requirementResults[0].compositionAssessment.nonRedundantEvidenceUnitIds =
        ['eu_09'];
    },
    (raw) => {
      raw.requirementResults[0].compositionAssessment.integrationEvidenceIds = [
        'eu_09'
      ];
    },
    (raw) => {
      raw.requirementResults[0].weakerClaimSearch.candidate.supportingEvidenceUnitIds =
        ['eu_09'];
    }
  ];

  for (const mutate of surfaces) {
    const raw = validResult();
    mutate(raw);
    const result = verifyReasoningRunResultArtifact(raw);
    const { analysis, units } = verified();
    expectCode(
      () => verifyReasoningResultReferences(result, analysis, units),
      'EVIDENCE_UNIT_REFERENCE_UNKNOWN'
    );
  }
});

test('los verificadores cruzados NO recomputan la policy', () => {
  // `finalState` se cambia a uno que las entradas del policyTrace no producirian.
  // El verificador debe seguir pasando: valida referencias, no re-ejecuta el
  // razonamiento, y un artifact historico tiene que poder leerse aunque la policy
  // cambie de version despues.
  const raw = validResult();
  raw.requirementResults[0].finalState = 'SUPPORTED';
  const result = verifyReasoningRunResultArtifact(raw);
  const { analysis, units } = verified();
  verifyReasoningResultReferences(result, analysis, units);
});
