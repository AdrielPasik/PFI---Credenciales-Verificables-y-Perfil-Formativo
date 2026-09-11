/**
 * Invariantes row-local del inventario — F3.1.
 *
 * F3.1 NO construye inventario. Estos tests cubren SOLO lo que la persistencia
 * debe aceptar o rechazar por la forma de la fila. Las reglas de seleccion
 * —precedencia PDF sobre texto, elegibilidad `issued`/`current`, decision de
 * extraccion ausente, credencial sin fuentes— son de F3.2 y no se testean aca.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INVENTORY_DISPOSITIONS,
  ReasoningRunInventoryRowError,
  assertInventoryRowShape,
  type InventoryRowShape
} from './reasoning-run-inventory-row.invariants';

function baseRow(overrides: Partial<InventoryRowShape>): InventoryRowShape {
  return {
    credentialId: 'cred-1',
    disposition: 'INCLUDED',
    documentEvidenceId: null,
    textEvidenceId: null,
    sourceSha256: null,
    selectedAnalysisRunSourceId: null,
    artifactBlobSha256: null,
    runLocalSourceId: null,
    ...overrides
  };
}

function expectCode(row: InventoryRowShape, code: string): void {
  try {
    assertInventoryRowShape(row);
  } catch (error: unknown) {
    assert.ok(error instanceof ReasoningRunInventoryRowError, String(error));
    assert.equal(error.code, code);
    return;
  }
  throw new Error(`expected ${code} but nothing was thrown`);
}

const includedRow = baseRow({
  disposition: 'INCLUDED',
  documentEvidenceId: 'doc-1',
  sourceSha256: 'a'.repeat(64),
  selectedAnalysisRunSourceId: 'ars-1',
  artifactBlobSha256: 'b'.repeat(64),
  runLocalSourceId: 'src_01'
});

// ---------------------------------------------------------------------------
// El enum persistido
// ---------------------------------------------------------------------------

test('las nueve disposiciones persistibles son exactamente estas', () => {
  assert.deepEqual([...INVENTORY_DISPOSITIONS], [
    'EXCLUDED_CREDENTIAL_STATE_DRAFT',
    'EXCLUDED_CREDENTIAL_STATE_REVOKED',
    'EXCLUDED_NO_GROUNDING_SOURCE',
    'INCLUDED',
    'EXCLUDED_SOURCE_SUPERSEDED',
    'EXCLUDED_UNSUPPORTED_TYPE',
    'EXCLUDED_ALTERNATE_REPRESENTATION',
    'BLOCKED_EXTRACTION_UNAVAILABLE',
    'BLOCKED_EXTRACTION_INTEGRITY_FAILURE'
  ]);
});

test('los dos BLOCKED_* siguen siendo hechos DISTINTOS', () => {
  // No se colapsan ni se sustituyen: "no existe slot persistido" y "existe y
  // fallo la verificacion de integridad" son observaciones diferentes, y las dos
  // tienen que poder registrarse.
  const dispositions = INVENTORY_DISPOSITIONS as readonly string[];
  assert.ok(dispositions.includes('BLOCKED_EXTRACTION_UNAVAILABLE'));
  assert.ok(dispositions.includes('BLOCKED_EXTRACTION_INTEGRITY_FAILURE'));
  assert.notEqual(
    'BLOCKED_EXTRACTION_UNAVAILABLE',
    'BLOCKED_EXTRACTION_INTEGRITY_FAILURE'
  );
});

/** Fila de fallo de integridad bien formada: conserva el candidato que fallo. */
const blockedIntegrityRow = baseRow({
  disposition: 'BLOCKED_EXTRACTION_INTEGRITY_FAILURE',
  documentEvidenceId: 'doc-1',
  sourceSha256: 'a'.repeat(64),
  selectedAnalysisRunSourceId: 'ars-1'
});

test('BLOCKED_EXTRACTION_INTEGRITY_FAILURE es SOURCE_LEVEL y CONSERVA el candidato', () => {
  // HD-3 selecciona por tiempo y verifica despues, asi que hubo un candidato
  // concreto. La fila lo guarda: sin el, el fallo quedaria sin sujeto.
  assertInventoryRowShape(blockedIntegrityRow);
  assertInventoryRowShape({
    ...blockedIntegrityRow,
    documentEvidenceId: null,
    textEvidenceId: 'text-1'
  });
});

test('BLOCKED_EXTRACTION_INTEGRITY_FAILURE sin identidad de fuente se rechaza', () => {
  expectCode(
    { ...blockedIntegrityRow, documentEvidenceId: null },
    'SOURCE_LEVEL_ROW_IDENTITY_INVALID'
  );
});

test('BLOCKED_EXTRACTION_INTEGRITY_FAILURE sin sourceSha256 se rechaza', () => {
  expectCode(
    { ...blockedIntegrityRow, sourceSha256: null },
    'SOURCE_LEVEL_ROW_SHA_MISSING'
  );
});

test('BLOCKED_EXTRACTION_INTEGRITY_FAILURE SIN el candidato se rechaza', () => {
  // Es el hueco de auditabilidad que esta correccion cierra: se sabria que algo
  // no verifico, pero no que representacion.
  expectCode(
    { ...blockedIntegrityRow, selectedAnalysisRunSourceId: null },
    'BLOCKED_INTEGRITY_ROW_MISSING_CANDIDATE'
  );
});

test('BLOCKED_EXTRACTION_INTEGRITY_FAILURE nunca lleva binding CONFIABLE', () => {
  // El id del candidato SI; el testigo de consistencia y el id local NO. Los dos
  // ultimos afirman que el artifact fue aceptado, y no lo fue.
  for (const field of ['artifactBlobSha256', 'runLocalSourceId'] as const) {
    expectCode(
      { ...blockedIntegrityRow, [field]: 'algo' },
      'BLOCKED_INTEGRITY_ROW_CARRIES_TRUSTED_BINDING'
    );
  }
});

test('seleccionado NO significa que entro al razonamiento', () => {
  // Dos filas con `selectedAnalysisRunSourceId` presente y desenlaces opuestos.
  // Lo que las distingue no es el binding sino la disposicion y el id local: una
  // consulta de "que material entro al grounding" filtra por eso, nunca por la
  // sola presencia del candidato.
  assertInventoryRowShape(includedRow);
  assertInventoryRowShape(blockedIntegrityRow);

  assert.equal(includedRow.disposition, 'INCLUDED');
  assert.notEqual(includedRow.runLocalSourceId, null);

  assert.notEqual(blockedIntegrityRow.selectedAnalysisRunSourceId, null);
  assert.equal(blockedIntegrityRow.runLocalSourceId, null);
});

test('EXCLUDED_DUPLICATE_SOURCE no es persistible en V1', () => {
  // F3.0 lo auditó como inalcanzable con la identidad congelada. No se anticipan
  // estados persistidos sin productor.
  assert.ok(!(INVENTORY_DISPOSITIONS as readonly string[]).includes(
    'EXCLUDED_DUPLICATE_SOURCE'
  ));
  expectCode(
    baseRow({ disposition: 'EXCLUDED_DUPLICATE_SOURCE' }),
    'DISPOSITION_UNSUPPORTED'
  );
});

test('no hay catch-all: OTHER, UNKNOWN y ERROR se rechazan', () => {
  for (const disposition of ['OTHER', 'UNKNOWN', 'ERROR', '']) {
    expectCode(baseRow({ disposition }), 'DISPOSITION_UNSUPPORTED');
  }
});

// ---------------------------------------------------------------------------
// Familia credential-level
// ---------------------------------------------------------------------------

test('las tres filas credential-level validas se aceptan', () => {
  for (const disposition of [
    'EXCLUDED_CREDENTIAL_STATE_DRAFT',
    'EXCLUDED_CREDENTIAL_STATE_REVOKED',
    'EXCLUDED_NO_GROUNDING_SOURCE'
  ]) {
    assertInventoryRowShape(baseRow({ disposition }));
  }
});

test('una fila credential-level con identidad de fuente se rechaza', () => {
  for (const overrides of [
    { documentEvidenceId: 'doc-1' },
    { textEvidenceId: 'text-1' }
  ]) {
    expectCode(
      baseRow({ disposition: 'EXCLUDED_NO_GROUNDING_SOURCE', ...overrides }),
      'CREDENTIAL_LEVEL_ROW_CARRIES_SOURCE'
    );
  }
});

test('una fila credential-level con sourceSha256 se rechaza', () => {
  expectCode(
    baseRow({
      disposition: 'EXCLUDED_CREDENTIAL_STATE_REVOKED',
      sourceSha256: 'a'.repeat(64)
    }),
    'CREDENTIAL_LEVEL_ROW_CARRIES_SOURCE'
  );
});

// ---------------------------------------------------------------------------
// Familia source-level
// ---------------------------------------------------------------------------

test('una fila source-level de documento valida se acepta', () => {
  assertInventoryRowShape(includedRow);
});

test('una fila source-level de texto valida se acepta', () => {
  assertInventoryRowShape(
    baseRow({
      disposition: 'EXCLUDED_ALTERNATE_REPRESENTATION',
      textEvidenceId: 'text-1',
      sourceSha256: 'a'.repeat(64)
    })
  );
});

test('una fila source-level con las DOS identidades se rechaza', () => {
  expectCode(
    baseRow({
      disposition: 'EXCLUDED_UNSUPPORTED_TYPE',
      documentEvidenceId: 'doc-1',
      textEvidenceId: 'text-1',
      sourceSha256: 'a'.repeat(64)
    }),
    'SOURCE_LEVEL_ROW_IDENTITY_INVALID'
  );
});

test('una fila source-level sin ninguna identidad se rechaza', () => {
  expectCode(
    baseRow({
      disposition: 'EXCLUDED_SOURCE_SUPERSEDED',
      sourceSha256: 'a'.repeat(64)
    }),
    'SOURCE_LEVEL_ROW_IDENTITY_INVALID'
  );
});

test('una fila source-level sin sourceSha256 se rechaza', () => {
  expectCode(
    baseRow({
      disposition: 'EXCLUDED_UNSUPPORTED_TYPE',
      documentEvidenceId: 'doc-1'
    }),
    'SOURCE_LEVEL_ROW_SHA_MISSING'
  );
});

// ---------------------------------------------------------------------------
// Binding de la extraccion seleccionada
// ---------------------------------------------------------------------------

test('INCLUDED sin alguno de los tres campos de binding se rechaza', () => {
  for (const missing of [
    'selectedAnalysisRunSourceId',
    'artifactBlobSha256',
    'runLocalSourceId'
  ] as const) {
    expectCode(
      { ...includedRow, [missing]: null },
      'INCLUDED_ROW_BINDING_INCOMPLETE'
    );
  }
});

test('una fila que no selecciono representacion no puede llevar binding', () => {
  // Incluye EXCLUDED_ALTERNATE_REPRESENTATION, que es el caso real: el
  // TextEvidence alterno de una credencial con PDF SUELE tener extraccion previa
  // de F1. Que exista no la vuelve parte del binding de ESTE run.
  //
  // BLOCKED_EXTRACTION_UNAVAILABLE tambien esta: ahi no hubo ningun candidato
  // estructuralmente presente que seleccionar, que es exactamente lo que lo
  // distingue del fallo de integridad.
  //
  // BLOCKED_EXTRACTION_INTEGRITY_FAILURE NO esta aca a proposito: ahi SI hubo
  // candidato y la fila lo conserva.
  for (const disposition of [
    'EXCLUDED_SOURCE_SUPERSEDED',
    'EXCLUDED_UNSUPPORTED_TYPE',
    'EXCLUDED_ALTERNATE_REPRESENTATION',
    'BLOCKED_EXTRACTION_UNAVAILABLE'
  ]) {
    for (const field of [
      'selectedAnalysisRunSourceId',
      'artifactBlobSha256',
      'runLocalSourceId'
    ] as const) {
      expectCode(
        baseRow({
          disposition,
          textEvidenceId: 'text-1',
          sourceSha256: 'a'.repeat(64),
          [field]: 'algo'
        }),
        'NON_INCLUDED_ROW_CARRIES_BINDING'
      );
    }
  }
});

test('una fila credential-level tampoco puede llevar binding', () => {
  expectCode(
    baseRow({
      disposition: 'EXCLUDED_NO_GROUNDING_SOURCE',
      runLocalSourceId: 'src_01'
    }),
    'NON_INCLUDED_ROW_CARRIES_BINDING'
  );
});
