/**
 * Proyección holder-safe de evidencia — slice P2.4A.
 *
 * El módulo es puro, así que toda la cadena `eu_NN → src_NN → inventario
 * congelado → credencial` se prueba sin base de datos. Las fixtures de artefactos
 * son las mismas de F3.1: si el contrato cambiara, estos tests se enteran por el
 * mismo lugar que los validadores.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clone,
  validEvidenceUnits,
  validResult,
  type Mutable
} from './__fixtures__/reasoning-run-artifacts.fixture';
import { verifyEvidenceUnitsArtifact } from './evidence-units-artifact.validator';
import { verifyReasoningRunResultArtifact } from './reasoning-run-result-artifact.validator';
import { ReasoningRunEvidenceProjectionError } from './reasoning-run-evidence.errors';
import {
  projectReasoningRunEvidence,
  supportingEvidenceUnitIds,
  type FrozenInventorySourceView
} from './reasoning-run-evidence.projection';
import { mapReasoningRunDetail, type ReasoningRunView } from './reasoning-run.mapper';

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

function documentSource(
  runLocalSourceId: string,
  credentialId = 'cred-1'
): FrozenInventorySourceView {
  return {
    runLocalSourceId,
    documentEvidenceId: `doc-${runLocalSourceId}`,
    textEvidenceId: null,
    credential: {
      id: credentialId,
      title: 'Analisis de datos con Python para negocios',
      credentialType: 'course',
      issuerName: 'Plataforma de Cursos Demo',
      currentStatus: 'issued'
    }
  };
}

function textSource(
  runLocalSourceId: string,
  credentialId = 'cred-2'
): FrozenInventorySourceView {
  return {
    runLocalSourceId,
    documentEvidenceId: null,
    textEvidenceId: `txt-${runLocalSourceId}`,
    credential: {
      id: credentialId,
      title: 'Programa de formacion en backend',
      credentialType: 'certification',
      issuerName: 'Instituto Demo',
      currentStatus: 'issued'
    }
  };
}

/** Agrega una fuente y una unidad de evidencia al catálogo de la fixture. */
function withExtraUnit(
  units: Mutable,
  options: {
    evidenceUnitId: string;
    sourceId: string;
    excerpt?: string;
    pageNumber?: number | null;
    extractionQuality?: string;
    contextBefore?: string;
    contextAfter?: string;
    sectionLabel?: string | null;
  }
): Mutable {
  if (!units.sources.some((source: Mutable) => source.sourceId === options.sourceId)) {
    units.sources.push({
      sourceId: options.sourceId,
      sourceProvenance: 'ISSUER_DECLARED'
    });
    units.preparation.sourceObservabilityFacts.push({
      sourceId: options.sourceId,
      coverageStatus: 'FULL',
      observedEvidenceUnitIds: [options.evidenceUnitId],
      extractionDiagnostics: []
    });
  }

  const excerpt = options.excerpt ?? 'persistencia y despliegue continuo';
  units.evidenceUnits.push({
    evidenceUnitId: options.evidenceUnitId,
    normalizedProposition: 'El programa cubrio despliegue continuo.',
    claimType: 'DECLARED_CONTENT',
    semanticQualifiers: [],
    exactQuote: excerpt,
    contextBefore: options.contextBefore ?? 'Modulos: ',
    contextAfter: options.contextAfter ?? '.',
    sectionLabel: options.sectionLabel === undefined ? 'Modulos' : options.sectionLabel,
    sourceTrace: {
      sourceId: options.sourceId,
      sourceSha256: 'b'.repeat(64),
      segmentId: 'seg_009',
      pageNumber: options.pageNumber === undefined ? 4 : options.pageNumber,
      charStart: 40,
      charEnd: 40 + excerpt.length,
      exactExcerpt: excerpt
    },
    interpretationProvenance: 'AI_INFERRED',
    extractionQuality: options.extractionQuality ?? 'FULL'
  });
  units.preparation.evidenceUnitIds.push(options.evidenceUnitId);
  return units;
}

function project(
  result: Mutable,
  units: Mutable,
  inventory: readonly FrozenInventorySourceView[]
) {
  return projectReasoningRunEvidence(
    verifyReasoningRunResultArtifact(result).requirementResults,
    verifyEvidenceUnitsArtifact(units),
    inventory
  );
}

const first = (
  projected: ReadonlyMap<string, { evidence: readonly unknown[] }>
): Mutable => (projected.get('req_01') as Mutable).evidence[0] as Mutable;

// ---------------------------------------------------------------------------
// Cadena de resolución
// ---------------------------------------------------------------------------

test('resuelve eu_NN -> src_NN -> inventario congelado -> credencial', () => {
  const projected = project(validResult(), validEvidenceUnits(), [
    documentSource('src_01')
  ]);

  const evidence = first(projected);
  assert.equal(evidence.credential.credentialReference, 'cred-1');
  assert.equal(
    evidence.credential.title,
    'Analisis de datos con Python para negocios'
  );
  assert.equal(evidence.credential.credentialType, 'course');
  assert.equal(evidence.credential.issuerName, 'Plataforma de Cursos Demo');
  assert.equal(evidence.credential.currentStatus, 'issued');
});

test('la cita se preserva VERBATIM desde el artefacto congelado', () => {
  const units = validEvidenceUnits();
  const spaced = '   diseno de APIs REST   ';
  units.evidenceUnits[0].sourceTrace.exactExcerpt = spaced;
  units.evidenceUnits[0].sourceTrace.charEnd =
    units.evidenceUnits[0].sourceTrace.charStart + spaced.length;
  units.evidenceUnits[0].exactQuote = spaced;

  const evidence = first(project(validResult(), units, [documentSource('src_01')]));
  assert.equal(evidence.excerpt, spaced);
});

test('proyecta la pagina cuando el trace la identifica', () => {
  const evidence = first(
    project(validResult(), validEvidenceUnits(), [documentSource('src_01')])
  );
  assert.equal(evidence.pageNumber, 1);
  assert.equal(evidence.sourceKind, 'DOCUMENT');
});

test('pageNumber null se proyecta como null, no se fabrica una pagina', () => {
  const units = validEvidenceUnits();
  units.evidenceUnits[0].sourceTrace.pageNumber = null;

  const evidence = first(project(validResult(), units, [documentSource('src_01')]));
  assert.equal(evidence.pageNumber, null);
});

test('una fuente de TEXTO no inventa pagina y se marca como TEXT', () => {
  const units = validEvidenceUnits();
  units.evidenceUnits[0].sourceTrace.pageNumber = null;

  const evidence = first(project(validResult(), units, [textSource('src_01')]));
  assert.equal(evidence.sourceKind, 'TEXT');
  assert.equal(evidence.pageNumber, null);
  assert.equal(evidence.credential.credentialReference, 'cred-2');
});

test('el contexto vacio se proyecta como null, no como cadena vacia', () => {
  const units = validEvidenceUnits();
  units.evidenceUnits[0].contextBefore = '';
  units.evidenceUnits[0].contextAfter = '';
  units.evidenceUnits[0].sectionLabel = null;

  const evidence = first(project(validResult(), units, [documentSource('src_01')]));
  assert.equal(evidence.contextBefore, null);
  assert.equal(evidence.contextAfter, null);
  assert.equal(evidence.sectionLabel, null);
});

test('la cobertura de extraccion se proyecta tal cual, PARTIAL incluido', () => {
  const units = validEvidenceUnits();
  units.evidenceUnits[0].extractionQuality = 'PARTIAL';
  units.preparation.sourceObservabilityFacts[0].coverageStatus = 'PARTIAL';

  const evidence = first(project(validResult(), units, [documentSource('src_01')]));
  assert.equal(evidence.coverage, 'PARTIAL');
});

// ---------------------------------------------------------------------------
// Cardinalidad
// ---------------------------------------------------------------------------

test('cero evidencias es un estado normal, no un error', () => {
  const result = validResult();
  result.requirementResults[0].finalState = 'INSUFFICIENT_EVIDENCE';
  result.requirementResults[0].jointClaimCeiling.supportingEvidenceUnitIds = [];
  result.requirementResults[0].weakerClaimSearch = {
    status: 'NONE',
    rationale: 'No se identifico una version defendible.',
    candidate: null
  };
  result.requirementResults[0].policyTrace.weakerSearchStatus = 'NONE';
  result.requirementResults[0].policyTrace.continuityStatus = null;
  result.requirementResults[0].policyTrace.materialUsefulness = null;
  result.requirementResults[0].policyTrace.hasMateriallyUsefulWeakerClaim = false;
  result.requirementResults[0].policyTrace.weakerClaimStillBelongsToRequirement = false;
  result.requirementResults[0].policyTrace.preGuardState = 'INSUFFICIENT_EVIDENCE';

  const projected = project(result, validEvidenceUnits(), [documentSource('src_01')]);
  assert.deepEqual(projected.get('req_01')?.evidence, []);
  assert.equal(projected.get('req_01')?.supportedWeakerClaim, null);
});

test('dos unidades de la MISMA credencial se preservan como dos evidencias', () => {
  const units = withExtraUnit(validEvidenceUnits(), {
    evidenceUnitId: 'eu_02',
    sourceId: 'src_01'
  });
  const result = validResult();
  result.requirementResults[0].jointClaimCeiling.supportingEvidenceUnitIds = [
    'eu_01',
    'eu_02'
  ];

  const evidence = project(result, units, [documentSource('src_01')]).get('req_01')
    ?.evidence as unknown as Mutable[];
  assert.equal(evidence.length, 2);
  assert.equal(evidence[0].credential.credentialReference, 'cred-1');
  assert.equal(evidence[1].credential.credentialReference, 'cred-1');
  assert.notEqual(evidence[0].excerpt, evidence[1].excerpt);
});

test('un Requirement respaldado por DOS credenciales conserva las dos', () => {
  const units = withExtraUnit(validEvidenceUnits(), {
    evidenceUnitId: 'eu_02',
    sourceId: 'src_02'
  });
  const result = validResult();
  result.requirementResults[0].jointClaimCeiling.supportingEvidenceUnitIds = [
    'eu_01',
    'eu_02'
  ];

  const evidence = project(result, units, [
    documentSource('src_01', 'cred-1'),
    textSource('src_02', 'cred-2')
  ]).get('req_01')?.evidence as unknown as Mutable[];

  assert.deepEqual(
    evidence.map((item) => item.credential.credentialReference),
    ['cred-1', 'cred-2']
  );
  assert.deepEqual(
    evidence.map((item) => item.sourceKind),
    ['DOCUMENT', 'TEXT']
  );
});

// ---------------------------------------------------------------------------
// Autoridad del conjunto que RESPALDA
// ---------------------------------------------------------------------------

test('una unidad SOLO evaluada no se proyecta como respaldo', () => {
  const units = withExtraUnit(validEvidenceUnits(), {
    evidenceUnitId: 'eu_02',
    sourceId: 'src_02'
  });
  const result = validResult();
  // Evaluada, pero nunca citada por el techo de claim ni por el candidato.
  result.requirementResults[0].evaluatedEvidence.push({
    evidenceUnitId: 'eu_02',
    relation: 'RELATED_NON_ENTAILING',
    supportedQualifierIds: [],
    missingQualifierIds: [],
    evidenceContribution: 'Menciona un tema vecino.',
    rationale: 'No implica el requisito.'
  });

  const evidence = project(result, units, [
    documentSource('src_01'),
    textSource('src_02')
  ]).get('req_01')?.evidence as unknown as Mutable[];

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].credential.credentialReference, 'cred-1');
});

for (const relation of ['CONFLICTING', 'LIMITED_SCOPE', 'RELATED_NON_ENTAILING']) {
  test(`relation ${relation} nunca aparece como evidencia de respaldo`, () => {
    const units = withExtraUnit(validEvidenceUnits(), {
      evidenceUnitId: 'eu_02',
      sourceId: 'src_02',
      excerpt: 'contenido que NO respalda'
    });
    const result = validResult();
    result.requirementResults[0].evaluatedEvidence.push({
      evidenceUnitId: 'eu_02',
      relation,
      supportedQualifierIds: [],
      missingQualifierIds: [],
      evidenceContribution: 'Evaluada y descartada.',
      rationale: 'No sostiene el requisito.'
    });

    const evidence = project(result, units, [
      documentSource('src_01'),
      textSource('src_02')
    ]).get('req_01')?.evidence as unknown as Mutable[];

    assert.ok(
      evidence.every((item) => item.excerpt !== 'contenido que NO respalda'),
      `${relation} se filtro como respaldo`
    );
  });
}

test('los ids del techo de claim SI se proyectan', () => {
  const result = validResult();
  assert.deepEqual(supportingEvidenceUnitIds(verifyReasoningRunResultArtifact(result).requirementResults[0]), [
    'eu_01'
  ]);
});

test('el candidato mas debil aporta ids SOLO cuando la busqueda es FOUND', () => {
  const units = withExtraUnit(validEvidenceUnits(), {
    evidenceUnitId: 'eu_02',
    sourceId: 'src_02'
  });

  const found = validResult();
  found.requirementResults[0].weakerClaimSearch.candidate.supportingEvidenceUnitIds = [
    'eu_02'
  ];
  const withCandidate = supportingEvidenceUnitIds(
    verifyReasoningRunResultArtifact(found).requirementResults[0]
  );
  assert.deepEqual(withCandidate, ['eu_01', 'eu_02']);

  const notFound = clone(found);
  notFound.requirementResults[0].weakerClaimSearch = {
    status: 'NONE',
    rationale: 'No se identifico una version defendible.',
    candidate: null
  };
  notFound.requirementResults[0].policyTrace.weakerSearchStatus = 'NONE';
  notFound.requirementResults[0].policyTrace.continuityStatus = null;
  notFound.requirementResults[0].policyTrace.materialUsefulness = null;
  notFound.requirementResults[0].policyTrace.hasMateriallyUsefulWeakerClaim = false;
  notFound.requirementResults[0].policyTrace.weakerClaimStillBelongsToRequirement =
    false;

  assert.deepEqual(
    supportingEvidenceUnitIds(
      verifyReasoningRunResultArtifact(notFound).requirementResults[0]
    ),
    ['eu_01']
  );
  void units;
});

test('la deduplicacion conserva la PRIMERA aparicion y su orden', () => {
  const units = withExtraUnit(validEvidenceUnits(), {
    evidenceUnitId: 'eu_02',
    sourceId: 'src_02'
  });
  const result = validResult();
  result.requirementResults[0].jointClaimCeiling.supportingEvidenceUnitIds = [
    'eu_02',
    'eu_01'
  ];
  result.requirementResults[0].weakerClaimSearch.candidate.supportingEvidenceUnitIds = [
    'eu_01',
    'eu_02'
  ];

  assert.deepEqual(
    supportingEvidenceUnitIds(
      verifyReasoningRunResultArtifact(result).requirementResults[0]
    ),
    ['eu_02', 'eu_01']
  );
  void units;
});

test('supportedWeakerClaim se copia EXACTO y solo cuando es FOUND', () => {
  const projected = project(validResult(), validEvidenceUnits(), [
    documentSource('src_01')
  ]);
  assert.equal(
    projected.get('req_01')?.supportedWeakerClaim,
    'Exposicion formativa a diseno de APIs REST.'
  );
});

// ---------------------------------------------------------------------------
// Falla cerrada
// ---------------------------------------------------------------------------

test('un id de evidencia que no esta en el catalogo FALLA, no se omite', () => {
  const result = validResult();
  result.requirementResults[0].jointClaimCeiling.supportingEvidenceUnitIds = [
    'eu_01',
    'eu_99'
  ];

  assert.throws(
    () => project(result, validEvidenceUnits(), [documentSource('src_01')]),
    (error: unknown) =>
      error instanceof ReasoningRunEvidenceProjectionError &&
      error.code === 'EVIDENCE_UNIT_NOT_IN_CATALOG'
  );
});

test('un src_NN ausente del inventario congelado FALLA, sin caer a la fuente actual', () => {
  assert.throws(
    () => project(validResult(), validEvidenceUnits(), [documentSource('src_07')]),
    (error: unknown) =>
      error instanceof ReasoningRunEvidenceProjectionError &&
      error.code === 'SOURCE_NOT_IN_FROZEN_INVENTORY'
  );
});

test('inventario vacio no degrada a "sin evidencia": FALLA', () => {
  assert.throws(
    () => project(validResult(), validEvidenceUnits(), []),
    (error: unknown) =>
      error instanceof ReasoningRunEvidenceProjectionError &&
      error.code === 'SOURCE_NOT_IN_FROZEN_INVENTORY'
  );
});

test('una fila de inventario sin entidad de evidencia FALLA', () => {
  const broken: FrozenInventorySourceView = {
    ...documentSource('src_01'),
    documentEvidenceId: null,
    textEvidenceId: null
  };

  assert.throws(
    () => project(validResult(), validEvidenceUnits(), [broken]),
    (error: unknown) =>
      error instanceof ReasoningRunEvidenceProjectionError &&
      error.code === 'INVENTORY_SOURCE_BINDING_INCONSISTENT'
  );
});

test('una fila con documento Y texto a la vez FALLA', () => {
  const broken: FrozenInventorySourceView = {
    ...documentSource('src_01'),
    textEvidenceId: 'txt-src_01'
  };

  assert.throws(
    () => project(validResult(), validEvidenceUnits(), [broken]),
    (error: unknown) =>
      error instanceof ReasoningRunEvidenceProjectionError &&
      error.code === 'INVENTORY_SOURCE_BINDING_INCONSISTENT'
  );
});

test('un runLocalSourceId repetido —filas de otro run— FALLA', () => {
  assert.throws(
    () =>
      project(validResult(), validEvidenceUnits(), [
        documentSource('src_01', 'cred-1'),
        textSource('src_01', 'cred-9')
      ]),
    (error: unknown) =>
      error instanceof ReasoningRunEvidenceProjectionError &&
      error.code === 'INVENTORY_SOURCE_BINDING_INCONSISTENT'
  );
});

test('sin etiqueta de credencial se conserva la cita, con credential null', () => {
  const orphan: FrozenInventorySourceView = {
    ...documentSource('src_01'),
    credential: null
  };

  const evidence = first(project(validResult(), validEvidenceUnits(), [orphan]));
  assert.equal(evidence.credential, null);
  assert.equal(evidence.excerpt, 'diseno de APIs REST');
  assert.equal(evidence.pageNumber, 1);
});

// ---------------------------------------------------------------------------
// Privacidad de la respuesta
// ---------------------------------------------------------------------------

function detailFixture(): ReasoningRunView {
  const result = verifyReasoningRunResultArtifact(validResult());
  return {
    id: 'run-1',
    objectiveId: 'obj-1',
    objectiveTitleSnapshot: 'Backend Developer Junior',
    status: 'completed',
    failureCode: null,
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    startedAt: new Date('2026-09-01T10:00:01.000Z'),
    completedAt: new Date('2026-09-01T10:02:00.000Z'),
    failedAt: null,
    definition: {
      schemaVersion: 'objective_definition_v1',
      objectiveType: 'JOB_POSTING',
      objectiveContext: 'Backend Developer Junior en equipo de plataforma',
      requirements: [
        {
          requirementId: 'req_01',
          order: 1,
          requirementText: 'Diseno de APIs REST nivel intermedio en backend'
        }
      ]
    } as unknown as ReasoningRunView['definition'],
    result,
    evidence: project(validResult(), validEvidenceUnits(), [documentSource('src_01')])
  };
}

/**
 * Tokens internos que no pueden salir.
 *
 * EL BARRIDO ES SOBRE LA RESPUESTA ENTERA — P2.4A.1. Antes se excluía
 * `explanation`, porque el render determinista lleva adentro los `src_NN` y los
 * tokens de enum. Excluir del test un campo que sabemos inseguro era describir la
 * frontera con un agujero declarado; ahora el campo no viaja y la afirmación es
 * sobre todo lo que el holder puede ver en el inspector de red.
 */
test('la respuesta ENTERA no publica ningun identificador interno', () => {
  const detail = mapReasoningRunDetail(detailFixture()) as Mutable;

  const serialized = JSON.stringify(detail);
  for (const forbidden of [
    'explanation',
    'src_',
    'eu_',
    'FORMATIVE_EVIDENCE',
    'Objetivo epistemologico',
    'Objetivo epistemológico',
    'Claim ceiling',
    'Observabilidad',
    'sourceId',
    'evidenceUnitId',
    'sourceSha256',
    'charStart',
    'charEnd',
    'segmentId',
    'artifactBlobSha256',
    'selectedAnalysisRunSourceId',
    'storageKey',
    'extractionArtifactCanonicalJson',
    'executionMetadata',
    'policyTrace',
    'evaluatedEvidence',
    'jointClaimCeiling',
    'weakerClaimSearch',
    'observabilityAssessment',
    'compositionAssessment',
    'fullClaimAssessment',
    'facets',
    'validations',
    'ownerUserId',
    'openai',
    'promptVersion',
    'reasoningEffort',
    'ISSUER_DECLARED',
    'AI_INFERRED'
  ]) {
    assert.ok(
      !serialized.includes(forbidden),
      `la respuesta publica "${forbidden}"`
    );
  }
});

/**
 * LAS DOS MITADES DE P2.4A.1, en un solo test para que no puedan divergir.
 *
 * La fidelidad histórica y la frontera del holder son afirmaciones distintas, y
 * cada una sin la otra es engañosa: conservar el artifact sin cerrar la
 * respuesta deja la fuga abierta, y cerrar la respuesta borrando el artifact
 * destruiría la explicación que ese run realmente produjo.
 */
test('la explicacion diagnostica SIGUE persistida y NO viaja al holder', () => {
  const view = detailFixture();

  // A. el artifact interno la conserva, exacta y con su material interno.
  const persisted = view.result!.requirementResults[0].explanation;
  assert.ok(persisted.includes('src_01'));
  assert.ok(persisted.includes('Estado: PARTIALLY_SUPPORTED'));

  // B. la respuesta del holder no la lleva, ni entera ni por fragmentos.
  const detail = mapReasoningRunDetail(view) as Mutable;
  const result = detail.result.requirementResults[0];
  assert.equal(result.explanation, undefined);
  assert.ok(!Object.prototype.hasOwnProperty.call(result, 'explanation'));
  assert.ok(!JSON.stringify(detail).includes(persisted));

  // Y el estado final SÍ sigue, porque es un token cerrado del contrato y no
  // material de diagnóstico. Cerrar la frontera no puede costar el resultado.
  assert.equal(result.finalState, 'PARTIALLY_SUPPORTED');
});

test('la explicacion NO se reemplaza por una version parseada del diagnostico', () => {
  const view = detailFixture();
  const detail = mapReasoningRunDetail(view) as Mutable;
  const result = detail.result.requirementResults[0];

  // Nada de `explanationText`, `summary`, `description` ni primos: el lenguaje
  // del holder lo compone P2.4B desde campos estructurados, no recortando el
  // string de diagnostico.
  assert.deepEqual(Object.keys(result).sort(), [
    'evidence',
    'finalState',
    'requirementId',
    'requirementText',
    'supportedWeakerClaim'
  ]);
});

test('el detalle expone la evidencia proyectada con sus campos seguros', () => {
  const detail = mapReasoningRunDetail(detailFixture()) as Mutable;
  const evidence = detail.result.requirementResults[0].evidence[0];

  assert.deepEqual(Object.keys(evidence).sort(), [
    'contextAfter',
    'contextBefore',
    'coverage',
    'credential',
    'excerpt',
    'pageNumber',
    'sectionLabel',
    'sourceKind'
  ]);
  assert.deepEqual(Object.keys(evidence.credential).sort(), [
    'credentialReference',
    'credentialType',
    'currentStatus',
    'issuerName',
    'title'
  ]);
  assert.equal(
    detail.result.requirementResults[0].supportedWeakerClaim,
    'Exposicion formativa a diseno de APIs REST.'
  );
});

test('el DTO no declara statusChangedSinceRun: no hay instantanea autoritativa', () => {
  const detail = mapReasoningRunDetail(detailFixture()) as Mutable;
  assert.ok(
    !JSON.stringify(detail).includes('statusChangedSinceRun'),
    'se afirmo un cambio historico sin persistencia que lo respalde'
  );
});
