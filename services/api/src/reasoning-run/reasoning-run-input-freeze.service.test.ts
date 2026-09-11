/**
 * Congelamiento de inputs — F3.2.
 *
 * Ninguna llamada a proveedor, a FastAPI ni a extracción: el doble de Prisma no
 * expone nada de eso, así que si el servicio intentara crear una extracción el
 * test rompería con `undefined is not a function` en vez de pasar en silencio.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OBJECTIVE_ID,
  OWNER_ID,
  fakePrisma,
  objectiveDefinition,
  presentSlot,
  sha,
  validExtractionArtifact,
  type FakeAnalysisRunSource,
  type FakeCredential
} from './__fixtures__/reasoning-run-freeze.fixture';
import { ReasoningRunInputFreezeError } from './reasoning-run-input-freeze.errors';
import { ReasoningRunInputFreezeService } from './reasoning-run-input-freeze.service';
import { SourceExtractionSlotService } from '../source-extraction/source-extraction-slot.service';

const PDF_SHA = sha('pdf-content');
const TEXT_SHA = sha('text-content');

function service(prisma: unknown): ReasoningRunInputFreezeService {
  // El slot service real, no un stub: la verificación de integridad es
  // exactamente lo que hay que ejercitar.
  return new ReasoningRunInputFreezeService(
    prisma as never,
    new SourceExtractionSlotService({} as never)
  );
}

function credential(overrides: Partial<FakeCredential> = {}): FakeCredential {
  return {
    id: 'cred-1',
    subjectUserId: OWNER_ID,
    status: 'issued',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    documentEvidences: [],
    textEvidences: [],
    ...overrides
  };
}

function currentPdf(overrides: Record<string, any> = {}) {
  return {
    id: 'doc-1',
    kind: 'pdf' as const,
    mimeType: 'application/pdf',
    sha256: PDF_SHA,
    status: 'current' as const,
    uploadedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides
  };
}

function currentText(overrides: Record<string, any> = {}) {
  return {
    id: 'text-1',
    sha256: TEXT_SHA,
    status: 'current' as const,
    submittedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides
  };
}

function candidate(overrides: Partial<FakeAnalysisRunSource> = {}): FakeAnalysisRunSource {
  return {
    id: 'ars-1',
    createdAt: new Date('2026-02-01T00:00:00Z'),
    sourceSha256: PDF_SHA,
    documentEvidenceId: 'doc-1',
    textEvidenceId: null,
    analysisRun: { credentialId: 'cred-1' },
    ...presentSlot(validExtractionArtifact()),
    ...overrides
  };
}

async function freeze(options: Parameters<typeof fakePrisma>[0] = {}) {
  const { prisma, created } = fakePrisma(options);
  const result = await service(prisma).createFrozenReasoningRunForUser(
    OWNER_ID,
    OBJECTIVE_ID
  );
  return { result, run: created[0], inventory: created[0]?.inventory ?? [] };
}

function rowFor(inventory: Array<Record<string, any>>, credentialId: string) {
  return inventory.filter((row) => row.credentialId === credentialId);
}

// ---------------------------------------------------------------------------
// Objective
// ---------------------------------------------------------------------------

test('un Objective ajeno y uno inexistente dan el MISMO error', async () => {
  const foreign = fakePrisma({
    objective: {
      id: OBJECTIVE_ID,
      ownerUserId: 'otro-usuario',
      definition: objectiveDefinition(),
      title: 'x'
    }
  });
  const missing = fakePrisma({ objective: null });

  for (const { prisma } of [foreign, missing]) {
    await assert.rejects(
      () => service(prisma).createFrozenReasoningRunForUser(OWNER_ID, OBJECTIVE_ID),
      (error: unknown) => {
        assert.ok(error instanceof ReasoningRunInputFreezeError);
        assert.equal(error.code, 'OBJECTIVE_NOT_FOUND');
        return true;
      }
    );
  }
});

test('el snapshot del Objective se congela EXACTO, sin normalizar', async () => {
  const { run } = await freeze();
  assert.deepEqual(run.objectiveDefinitionSnapshot, objectiveDefinition());
  assert.equal(run.objectiveTitleSnapshot, 'Backend Developer Junior');
  // Sin fingerprint ni hash del snapshot: F3.1 no tiene esa columna.
  assert.ok(!('objectiveSnapshotSha256' in run));
});

test('una definición de Objective corrupta aborta el freeze', async () => {
  const { prisma, created } = fakePrisma({
    objective: {
      id: OBJECTIVE_ID,
      ownerUserId: OWNER_ID,
      definition: { schemaVersion: 'nope' },
      title: 'x'
    }
  });
  await assert.rejects(
    () => service(prisma).createFrozenReasoningRunForUser(OWNER_ID, OBJECTIVE_ID),
    /OBJECTIVE_DEFINITION_CORRUPT/
  );
  assert.equal(created.length, 0, 'no debe quedar un run a medias');
});

// ---------------------------------------------------------------------------
// Inventario enraizado en la credencial
// ---------------------------------------------------------------------------

test('sin credenciales: run pending con inventario vacío', async () => {
  const { result, inventory } = await freeze({ credentials: [] });
  assert.equal(result.status, 'pending');
  assert.equal(result.failureCode, null);
  assert.equal(inventory.length, 0);
});

test('una credencial draft produce UNA fila credential-level', async () => {
  const { result, inventory } = await freeze({
    credentials: [
      credential({
        status: 'draft',
        documentEvidences: [currentPdf()],
        textEvidences: [currentText()]
      })
    ]
  });
  assert.equal(inventory.length, 1, 'no se enumeran las fuentes de una excluida');
  assert.equal(inventory[0].disposition, 'EXCLUDED_CREDENTIAL_STATE_DRAFT');
  assert.equal(inventory[0].documentEvidenceId, null);
  assert.equal(inventory[0].sourceSha256, null);
  assert.equal(result.status, 'pending');
});

test('una credencial revocada produce UNA fila credential-level', async () => {
  const { inventory } = await freeze({
    credentials: [
      credential({ status: 'revoked', documentEvidences: [currentPdf()] })
    ]
  });
  assert.equal(inventory.length, 1);
  assert.equal(inventory[0].disposition, 'EXCLUDED_CREDENTIAL_STATE_REVOKED');
});

test('una credencial emitida SIN evidencia: EXCLUDED_NO_GROUNDING_SOURCE y run pending', async () => {
  const { result, inventory } = await freeze({ credentials: [credential()] });
  assert.equal(inventory.length, 1);
  assert.equal(inventory[0].disposition, 'EXCLUDED_NO_GROUNDING_SOURCE');
  assert.equal(inventory[0].documentEvidenceId, null);
  // Un universo epistemológicamente vacío NO es un fallo de infraestructura.
  assert.equal(result.status, 'pending');
  assert.equal(result.blockedSourceCount, 0);
});

// ---------------------------------------------------------------------------
// Selección de la representación primaria
// ---------------------------------------------------------------------------

test('PDF vigente elegible se selecciona como primaria', async () => {
  const { result, inventory } = await freeze({
    credentials: [credential({ documentEvidences: [currentPdf()] })],
    analysisRunSources: [candidate()]
  });
  assert.equal(inventory.length, 1);
  assert.equal(inventory[0].disposition, 'INCLUDED');
  assert.equal(inventory[0].documentEvidenceId, 'doc-1');
  assert.equal(inventory[0].sourceSha256, PDF_SHA);
  assert.equal(result.includedSourceCount, 1);
});

test('sólo texto vigente: el texto es la primaria', async () => {
  const { inventory } = await freeze({
    credentials: [credential({ textEvidences: [currentText()] })],
    analysisRunSources: [
      candidate({
        id: 'ars-text',
        documentEvidenceId: null,
        textEvidenceId: 'text-1',
        sourceSha256: TEXT_SHA
      })
    ]
  });
  assert.equal(inventory[0].disposition, 'INCLUDED');
  assert.equal(inventory[0].textEvidenceId, 'text-1');
});

test('PDF + texto vigentes: PDF primaria, texto ALTERNATE', async () => {
  const { inventory } = await freeze({
    credentials: [
      credential({
        documentEvidences: [currentPdf()],
        textEvidences: [currentText()]
      })
    ],
    analysisRunSources: [candidate()]
  });
  assert.equal(inventory.length, 2);
  const alternate = inventory.find((row) => row.textEvidenceId === 'text-1');
  assert.equal(alternate!.disposition, 'EXCLUDED_ALTERNATE_REPRESENTATION');
  // No se le bindea una extracción histórica ni se le crea una.
  assert.equal(alternate!.selectedAnalysisRunSourceId, null);
  assert.equal(alternate!.runLocalSourceId, null);
  assert.equal(
    inventory.find((row) => row.documentEvidenceId === 'doc-1')!.disposition,
    'INCLUDED'
  );
});

test('documento vigente NO soportado + texto: el texto es primaria', async () => {
  // La mera existencia de una imagen no bloquea al texto.
  const { inventory } = await freeze({
    credentials: [
      credential({
        documentEvidences: [
          currentPdf({ id: 'img-1', kind: 'image', mimeType: 'image/png' })
        ],
        textEvidences: [currentText()]
      })
    ],
    analysisRunSources: [
      candidate({
        id: 'ars-text',
        documentEvidenceId: null,
        textEvidenceId: 'text-1',
        sourceSha256: TEXT_SHA
      })
    ]
  });
  assert.equal(inventory.length, 2);
  assert.equal(
    inventory.find((row) => row.documentEvidenceId === 'img-1')!.disposition,
    'EXCLUDED_UNSUPPORTED_TYPE'
  );
  assert.equal(
    inventory.find((row) => row.textEvidenceId === 'text-1')!.disposition,
    'INCLUDED'
  );
});

test('un PDF con mimeType inconsistente NO es elegible', async () => {
  const { inventory } = await freeze({
    credentials: [
      credential({
        documentEvidences: [currentPdf({ mimeType: 'application/octet-stream' })]
      })
    ]
  });
  assert.equal(inventory[0].disposition, 'EXCLUDED_UNSUPPORTED_TYPE');
});

test('sólo documento no soportado: fila unsupported y NINGÚN blocked', async () => {
  const { result, inventory } = await freeze({
    credentials: [
      credential({
        documentEvidences: [
          currentPdf({ id: 'img-1', kind: 'image', mimeType: 'image/png' })
        ]
      })
    ]
  });
  assert.equal(inventory.length, 1);
  assert.equal(inventory[0].disposition, 'EXCLUDED_UNSUPPORTED_TYPE');
  assert.equal(result.status, 'pending');
  assert.equal(result.blockedSourceCount, 0);
});

test('una fuente replaced queda EXCLUDED_SOURCE_SUPERSEDED, nunca grounding', async () => {
  const { inventory } = await freeze({
    credentials: [
      credential({
        documentEvidences: [
          currentPdf({ id: 'doc-old', status: 'replaced', sha256: sha('old') }),
          currentPdf()
        ]
      })
    ],
    analysisRunSources: [candidate()]
  });
  assert.equal(
    inventory.find((row) => row.documentEvidenceId === 'doc-old')!.disposition,
    'EXCLUDED_SOURCE_SUPERSEDED'
  );
  assert.equal(
    inventory.find((row) => row.documentEvidenceId === 'doc-1')!.disposition,
    'INCLUDED'
  );
});

test('sólo fuentes replaced: superseded, SIN fila sourceless duplicada', async () => {
  // Las filas superseded ya hacen observable la ausencia de grounding; agregar
  // EXCLUDED_NO_GROUNDING_SOURCE grabaría dos veces el mismo hecho.
  const { result, inventory } = await freeze({
    credentials: [
      credential({
        documentEvidences: [currentPdf({ status: 'replaced' })],
        textEvidences: [currentText({ status: 'replaced' })]
      })
    ]
  });
  assert.equal(inventory.length, 2);
  assert.ok(
    inventory.every((row) => row.disposition === 'EXCLUDED_SOURCE_SUPERSEDED')
  );
  assert.ok(
    !inventory.some((row) => row.disposition === 'EXCLUDED_NO_GROUNDING_SOURCE')
  );
  assert.equal(result.status, 'pending');
});

// ---------------------------------------------------------------------------
// Binding del candidato de extracción — HD-3
// ---------------------------------------------------------------------------

test('entre varios candidatos se elige el MÁS NUEVO estructuralmente presente', async () => {
  const { inventory } = await freeze({
    credentials: [credential({ documentEvidences: [currentPdf()] })],
    analysisRunSources: [
      candidate({ id: 'ars-old', createdAt: new Date('2026-01-10T00:00:00Z') }),
      candidate({ id: 'ars-new', createdAt: new Date('2026-03-10T00:00:00Z') }),
      // ABSENT: no es candidato aunque sea el más nuevo.
      candidate({
        id: 'ars-absent',
        createdAt: new Date('2026-04-10T00:00:00Z'),
        extractionArtifactCanonicalJson: null,
        artifactBlobSha256: null,
        extractionDerivationTrust: null
      })
    ]
  });
  assert.equal(inventory[0].disposition, 'INCLUDED');
  assert.equal(inventory[0].selectedAnalysisRunSourceId, 'ars-new');
});

test('sin candidato estructuralmente presente: BLOCKED_EXTRACTION_UNAVAILABLE', async () => {
  const { result, inventory } = await freeze({
    credentials: [credential({ documentEvidences: [currentPdf()] })],
    analysisRunSources: []
  });
  assert.equal(inventory[0].disposition, 'BLOCKED_EXTRACTION_UNAVAILABLE');
  assert.equal(inventory[0].selectedAnalysisRunSourceId, null);
  assert.equal(inventory[0].artifactBlobSha256, null);
  assert.equal(inventory[0].runLocalSourceId, null);
  // La identidad de fuente y el SHA SÍ se conservan.
  assert.equal(inventory[0].documentEvidenceId, 'doc-1');
  assert.equal(inventory[0].sourceSha256, PDF_SHA);
  assert.equal(result.status, 'failed');
});

test('candidato más nuevo CORRUPTO: se bloquea y NO hay fallback al anterior', async () => {
  const good = candidate({ id: 'ars-old', createdAt: new Date('2026-01-10T00:00:00Z') });
  const { inventory } = await freeze({
    credentials: [credential({ documentEvidences: [currentPdf()] })],
    analysisRunSources: [
      good,
      candidate({
        id: 'ars-new',
        createdAt: new Date('2026-03-10T00:00:00Z'),
        // El blob no corresponde al JSON: corrupción determinista.
        artifactBlobSha256: 'f'.repeat(64)
      })
    ]
  });
  assert.equal(inventory[0].disposition, 'BLOCKED_EXTRACTION_INTEGRITY_FAILURE');
  assert.equal(
    inventory[0].selectedAnalysisRunSourceId,
    'ars-new',
    'se conserva el candidato que falló, no el que funcionaba'
  );
  assert.equal(inventory[0].artifactBlobSha256, null);
  assert.equal(inventory[0].runLocalSourceId, null);
});

test('mismatch de sourceSha256: integrity blocked, no se filtra en silencio', async () => {
  // La entidad de evidencia es content-immutable: un AnalysisRunSource que la
  // referencia con otro SHA es una inconsistencia, no historia legítima.
  const { inventory } = await freeze({
    credentials: [credential({ documentEvidences: [currentPdf()] })],
    analysisRunSources: [candidate({ sourceSha256: sha('otro') })]
  });
  assert.equal(inventory[0].disposition, 'BLOCKED_EXTRACTION_INTEGRITY_FAILURE');
  assert.equal(inventory[0].selectedAnalysisRunSourceId, 'ars-1');
});

test('mismatch de credencial: integrity blocked', async () => {
  const { inventory } = await freeze({
    credentials: [credential({ documentEvidences: [currentPdf()] })],
    analysisRunSources: [
      candidate({ analysisRun: { credentialId: 'cred-ajena' } })
    ]
  });
  assert.equal(inventory[0].disposition, 'BLOCKED_EXTRACTION_INTEGRITY_FAILURE');
});

test('coverage FULL, PARTIAL y FAILED son TODOS INCLUDED', async () => {
  // Un artifact válido con coverage FAILED sigue siendo input epistemológico:
  // coverage FAILED no es un fallo de integridad.
  for (const coverage of ['FULL', 'PARTIAL', 'FAILED'] as const) {
    const artifact = validExtractionArtifact(coverage);
    const { inventory } = await freeze({
      credentials: [credential({ documentEvidences: [currentPdf()] })],
      analysisRunSources: [candidate({ ...presentSlot(artifact) })]
    });
    assert.equal(
      inventory[0].disposition,
      'INCLUDED',
      `coverage ${coverage} debe ser INCLUDED`
    );
  }
});

test('INCLUDED congela el artifactBlobSha256 EXACTO del slot verificado', async () => {
  const slot = presentSlot(validExtractionArtifact());
  const { inventory } = await freeze({
    credentials: [credential({ documentEvidences: [currentPdf()] })],
    analysisRunSources: [candidate({ ...slot })]
  });
  assert.equal(inventory[0].artifactBlobSha256, slot.artifactBlobSha256);
  assert.equal(inventory[0].runLocalSourceId, 'src_01');
});

// ---------------------------------------------------------------------------
// Múltiples bloqueos
// ---------------------------------------------------------------------------

test('dos credenciales bloqueadas por causas DISTINTAS: ambas persisten', async () => {
  const { result, inventory, run } = await freeze({
    credentials: [
      credential({ id: 'cred-a', documentEvidences: [currentPdf({ id: 'doc-a' })] }),
      credential({
        id: 'cred-b',
        createdAt: new Date('2026-01-05T00:00:00Z'),
        documentEvidences: [currentPdf({ id: 'doc-b' })]
      })
    ],
    analysisRunSources: [
      // cred-a: sin candidato → UNAVAILABLE
      candidate({
        id: 'ars-b',
        documentEvidenceId: 'doc-b',
        analysisRun: { credentialId: 'cred-b' },
        artifactBlobSha256: 'f'.repeat(64)
      })
    ]
  });

  assert.equal(
    rowFor(inventory, 'cred-a')[0].disposition,
    'BLOCKED_EXTRACTION_UNAVAILABLE'
  );
  assert.equal(
    rowFor(inventory, 'cred-b')[0].disposition,
    'BLOCKED_EXTRACTION_INTEGRITY_FAILURE'
  );

  // El inventario se construye COMPLETO: no se corta en el primer bloqueo.
  assert.equal(inventory.length, 2);
  assert.equal(result.blockedSourceCount, 2);
  assert.equal(run.status, 'failed');
  // UN solo código a nivel de run, sin detalle por item.
  assert.equal(run.failureCode, 'reasoning_input_freeze_blocked');
  assert.ok(run.failedAt instanceof Date);
  assert.ok(!run.failureCode!.includes('doc-'));
  assert.ok(!run.failureCode!.includes('cred-'));
});

// ---------------------------------------------------------------------------
// Invariante cross-row y determinismo
// ---------------------------------------------------------------------------

test('una credencial excluida por estado NUNCA coexiste con filas source-level', async () => {
  const { inventory } = await freeze({
    credentials: [
      credential({ id: 'cred-draft', status: 'draft', documentEvidences: [currentPdf()] }),
      credential({
        id: 'cred-rev',
        status: 'revoked',
        createdAt: new Date('2026-01-03T00:00:00Z'),
        textEvidences: [currentText()]
      })
    ]
  });
  for (const credentialId of ['cred-draft', 'cred-rev']) {
    const rows = rowFor(inventory, credentialId);
    assert.equal(rows.length, 1, `${credentialId} debe tener exactamente una fila`);
    assert.equal(rows[0].documentEvidenceId, null);
    assert.equal(rows[0].textEvidenceId, null);
  }
});

test('dos freezes del mismo estado producen el MISMO inventario', async () => {
  const options = {
    credentials: [
      credential({
        id: 'cred-b',
        createdAt: new Date('2026-01-09T00:00:00Z'),
        documentEvidences: [currentPdf({ id: 'doc-b' })]
      }),
      credential({
        id: 'cred-a',
        createdAt: new Date('2026-01-02T00:00:00Z'),
        textEvidences: [currentText({ id: 'text-a' })]
      })
    ],
    analysisRunSources: [
      candidate({
        id: 'ars-b',
        documentEvidenceId: 'doc-b',
        analysisRun: { credentialId: 'cred-b' }
      }),
      candidate({
        id: 'ars-a',
        documentEvidenceId: null,
        textEvidenceId: 'text-a',
        sourceSha256: TEXT_SHA,
        analysisRun: { credentialId: 'cred-a' }
      })
    ]
  };

  const first = await freeze(options);
  const second = await freeze(options);
  assert.deepEqual(first.inventory, second.inventory);

  // El orden es por credencial `(createdAt ASC, id ASC)`, no el de llegada.
  assert.equal(first.inventory[0].credentialId, 'cred-a');
  assert.equal(first.inventory[0].runLocalSourceId, 'src_01');
  assert.equal(first.inventory[1].credentialId, 'cred-b');
  assert.equal(first.inventory[1].runLocalSourceId, 'src_02');
});

test('los runLocalSourceId se asignan SÓLO a las filas INCLUDED', async () => {
  const { inventory } = await freeze({
    credentials: [
      credential({
        documentEvidences: [
          currentPdf({ id: 'doc-old', status: 'replaced', sha256: sha('old') }),
          currentPdf()
        ],
        textEvidences: [currentText()]
      })
    ],
    analysisRunSources: [candidate()]
  });
  const numbered = inventory.filter((row) => row.runLocalSourceId !== null);
  assert.equal(numbered.length, 1);
  assert.equal(numbered[0].disposition, 'INCLUDED');
  assert.equal(numbered[0].runLocalSourceId, 'src_01');
});

// ---------------------------------------------------------------------------
// Fallo de infraestructura vs bloqueo determinista
// ---------------------------------------------------------------------------

test('un error de infraestructura ABORTA el freeze, no inventa una fila', async () => {
  // Un error que NO es SourceExtractionSlotError no describe ningún hecho sobre
  // ninguna fuente: se propaga y la transacción revierte.
  const { prisma, created } = fakePrisma({
    credentials: [credential({ documentEvidences: [currentPdf()] })]
  });
  (prisma as any).analysisRunSource.findFirst = async () => {
    throw new Error('ECONNRESET: la base se cayó');
  };

  await assert.rejects(
    () => service(prisma).createFrozenReasoningRunForUser(OWNER_ID, OBJECTIVE_ID),
    /ECONNRESET/
  );
  assert.equal(created.length, 0, 'no debe persistirse un ReasoningRun parcial');
});

test('ninguna fila se pierde: toda credencial enumerada aparece', async () => {
  const { inventory } = await freeze({
    credentials: [
      credential({ id: 'c1', status: 'draft' }),
      credential({ id: 'c2', status: 'revoked', createdAt: new Date('2026-01-02Z') }),
      credential({ id: 'c3', createdAt: new Date('2026-01-03Z') }),
      credential({
        id: 'c4',
        createdAt: new Date('2026-01-04Z'),
        documentEvidences: [currentPdf({ id: 'd4' })]
      })
    ]
  });
  assert.deepEqual(
    [...new Set(inventory.map((row) => row.credentialId))].sort(),
    ['c1', 'c2', 'c3', 'c4']
  );
});
