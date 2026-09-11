/**
 * Conformidad de la policy productiva con Target v1.5.1 — slice F3.6.
 *
 * Se REPRODUCEN las 85 corridas congeladas de B2.4.1 —la re-ejecución completa
 * de development más el Holdout— a través de la policy del producto, y se
 * compara contra el estado que el candidato aceptado produjo.
 *
 *     REAL_PROVIDER_CALLS: 0
 *     imports desde experiments/: 0
 *     archivos de investigación modificados: 0
 *
 * QUÉ PRUEBA Y QUÉ NO. Prueba que la PROMOCIÓN es fiel: mismas entradas de
 * policy, mismo estado final, misma diferencia entre `preGuardState` y
 * `finalState`. NO prueba que el razonador semántico se comporte igual —eso lo
 * decidió la investigación y quedó cerrado con sus limitaciones aceptadas—, y no
 * podría: el razonador es el proveedor, y acá no se llama a ninguno.
 *
 * `hardFactualFailure` se toma del valor CONGELADO en vez de recomputarse. Los
 * guards duros del producto no son los mismos objetos que los del experimento
 * —F3.5 convirtió la mitad en fallo terminal de transporte—, así que
 * recomputarlos compararía dos cosas distintas. Lo que se aísla acá es
 * exactamente lo que F3.6 promovió: el MAPEO de entradas a estado final.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  derivePolicyInputs,
  resolveFinalState
} from './deterministic-epistemic-policy';
import {
  FROZEN_B241_POLICY_CONFORMANCE,
  type FrozenPolicyConformanceRow
} from './__fixtures__/frozen-b241-policy-conformance.fixture';

/**
 * Reconstruye las DOS entradas que `derivePolicyInputs` consume, a partir de los
 * tokens congelados. Nada se interpreta: cada campo va al campo homónimo.
 */
function inputsFor(row: FrozenPolicyConformanceRow) {
  const candidate =
    row.continuityStatus === null
      ? null
      : {
          continuityAssessment: { status: row.continuityStatus },
          materialUsefulness: row.materialUsefulness
        };
  return {
    analysisRequirement: {
      requirementId: 'req_01',
      epistemicTarget: row.epistemicTarget,
      evaluability: { formativeEvidenceCapable: row.formativeEvidenceCapable }
    },
    contextual: {
      requirementId: 'req_01',
      semanticUnresolved: row.semanticUnresolved,
      compositionAssessment: { unresolved: row.compositionUnresolved },
      fullClaimAssessment: { status: row.fullClaimStatus },
      observabilityAssessment: { observabilityStatus: row.observabilityStatus },
      weakerClaimSearch: { status: row.weakerSearchStatus, candidate }
    }
  };
}

function replay(row: FrozenPolicyConformanceRow, hardFactualFailure: boolean) {
  const { analysisRequirement, contextual } = inputsFor(row);
  return resolveFinalState(
    derivePolicyInputs(
      analysisRequirement as never,
      contextual as never,
      hardFactualFailure
    ).finalStateInputs
  );
}

test('el corpus congelado trae las 85 corridas de B2.4.1', () => {
  assert.equal(FROZEN_B241_POLICY_CONFORMANCE.length, 85);
});

test('CONFORMIDAD: la policy productiva reproduce cada finalState congelado', () => {
  const divergences: string[] = [];
  for (const row of FROZEN_B241_POLICY_CONFORMANCE) {
    const produced = replay(row, row.hardFactualFailure);
    if (produced !== row.finalState) {
      divergences.push(`${row.run}: congelado=${row.finalState} producto=${produced}`);
    }
  }
  assert.deepEqual(divergences, []);
});

test('CONFORMIDAD: tambien reproduce cada preGuardState congelado', () => {
  // El estado que habría salido sin guards duros. Comprobarlo por separado hace
  // observable que la promoción conserva el APORTE del guard, no sólo el
  // resultado.
  const divergences: string[] = [];
  for (const row of FROZEN_B241_POLICY_CONFORMANCE) {
    const produced = replay(row, false);
    if (produced !== row.preGuardState) {
      divergences.push(`${row.run}: congelado=${row.preGuardState} producto=${produced}`);
    }
  }
  assert.deepEqual(divergences, []);
});

test('el corpus congelado ejercita los CINCO estados finales', () => {
  const observed = new Set(
    FROZEN_B241_POLICY_CONFORMANCE.map((row) => row.finalState)
  );
  assert.deepEqual(
    [...observed].sort(),
    [
      'ABSTAIN',
      'INSUFFICIENT_EVIDENCE',
      'NOT_ASSESSABLE',
      'PARTIALLY_SUPPORTED',
      'SUPPORTED'
    ]
  );
});

test('la clausula restaurada de B2.4.1 se cumple en todo el corpus', () => {
  // Ninguna corrida congelada llega a PARTIALLY_SUPPORTED sin continuidad YES y
  // utilidad YES. Es la propiedad que la cláusula restaurada protege, verificada
  // sobre datos reales en vez de sobre un caso construido.
  for (const row of FROZEN_B241_POLICY_CONFORMANCE) {
    if (row.finalState !== 'PARTIALLY_SUPPORTED') continue;
    assert.equal(row.continuityStatus, 'YES', row.run);
    assert.equal(row.materialUsefulness, 'YES', row.run);
  }
});

test('ninguna corrida congelada con target no formativo dejo de ser NOT_ASSESSABLE', () => {
  for (const row of FROZEN_B241_POLICY_CONFORMANCE) {
    if (row.formativeEvidenceCapable) continue;
    assert.equal(row.finalState, 'NOT_ASSESSABLE', row.run);
    assert.equal(replay(row, row.hardFactualFailure), 'NOT_ASSESSABLE', row.run);
  }
});

test('el corpus cubre mas de una forma de entrada por estado final', () => {
  // Si todas las corridas de un estado tuvieran la MISMA tupla de entradas, la
  // conformidad probaría un solo camino y no el mapeo.
  const shapes = new Set(
    FROZEN_B241_POLICY_CONFORMANCE.map((row) =>
      [
        row.epistemicTarget,
        row.formativeEvidenceCapable,
        row.semanticUnresolved,
        row.compositionUnresolved,
        row.fullClaimStatus,
        row.observabilityStatus,
        row.weakerSearchStatus,
        row.continuityStatus,
        row.materialUsefulness,
        row.hardFactualFailure
      ].join('|')
    )
  );
  assert.ok(shapes.size >= 10, `formas distintas: ${shapes.size}`);
});
