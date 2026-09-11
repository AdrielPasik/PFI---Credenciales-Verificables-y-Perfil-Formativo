/**
 * Verificación independiente del artefacto — slice P2.2.
 *
 * Cada caso de acá es una forma de artefacto BIEN FORMADO y ESTRUCTURALMENTE
 * FALSO: JSON válido que afirma algo que no se sostiene contra el texto que este
 * proceso envió. Si el verificador los dejara pasar, el browser recibiría
 * resaltados que apuntan al lugar equivocado sin que nadie se entere.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OBJECTIVE_REQUIREMENT_PROPOSAL_RESPONSE_SCHEMA_VERSION,
  OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY
} from './objective-requirement-proposal.contract';
import { ObjectiveProposalArtifactInvariantError } from './objective-requirement-proposal.errors';
import { verifyObjectiveProposalResponse } from './objective-requirement-proposal.verifier';

const RAW = '- Experiencia minima de 3 anos.\n- Titulo universitario afin.\n';
const QUOTE_A = '- Experiencia minima de 3 anos.';
const QUOTE_B = '- Titulo universitario afin.';

function offsetsOf(quote: string): { charStart: number; charEnd: number } {
  const charStart = Array.from(RAW.slice(0, RAW.indexOf(quote))).length;
  return { charStart, charEnd: charStart + Array.from(quote).length };
}

function reference(quote: string) {
  const { charStart, charEnd } = offsetsOf(quote);
  return { exactExcerpt: quote, charStart, charEnd, offsetUnit: 'UNICODE_CODE_POINT' };
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    candidateId: 'cand_01',
    order: 1,
    proposedRequirementText: 'Experiencia minima de 3 anos.',
    primarySourceReference: reference(QUOTE_A),
    primarySourceGrounding: 'UNIQUE',
    auxiliarySourceReferences: [],
    ambiguousReferences: [],
    unmatchedReferences: [],
    sourceSectionLabel: 'Requisitos',
    exactDuplicateOfEarlier: false,
    confirmableAsSourceDerived: true,
    ...overrides
  };
}

function response(overrides: Record<string, unknown> = {}, artifactOverrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: OBJECTIVE_REQUIREMENT_PROPOSAL_RESPONSE_SCHEMA_VERSION,
    execution: {
      artifactSchemaVersion: OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY.artifactSchemaVersion,
      promptVersion: OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY.promptVersion,
      adapterVersion: OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY.adapterVersion,
      providerProposalSchemaVersion:
        OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY.providerProposalSchemaVersion,
      provider: 'openai',
      reasoningEffort: 'medium'
    },
    artifact: {
      schemaVersion: OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY.artifactSchemaVersion,
      sourceNormalization: 'NONE',
      offsetUnit: 'UNICODE_CODE_POINT',
      sourceCharacterCount: Array.from(RAW).length,
      candidates: [candidate()],
      unresolvedPassages: [],
      ...artifactOverrides
    },
    ...overrides
  };
}

function expectInvariant(input: unknown, fragment: string): void {
  assert.throws(
    () => verifyObjectiveProposalResponse(input, RAW),
    (error: unknown) => {
      assert.ok(error instanceof ObjectiveProposalArtifactInvariantError);
      assert.match(error.detail, new RegExp(fragment));
      return true;
    }
  );
}

test('acepta un artefacto coherente con el texto enviado', () => {
  const verified = verifyObjectiveProposalResponse(response(), RAW);
  assert.equal(verified.candidates.length, 1);
  assert.equal(verified.candidates[0].candidateId, 'cand_01');
  assert.equal(verified.candidates[0].primarySourceReference?.exactExcerpt, QUOTE_A);
});

test('rechaza un excerpt que NO es lo que hay en esos offsets', () => {
  // El fallo más importante: los offsets apuntan a otro lado que el excerpt.
  const bad = response({}, {
    candidates: [
      candidate({
        primarySourceReference: {
          ...reference(QUOTE_A),
          exactExcerpt: QUOTE_B
        }
      })
    ]
  });
  expectInvariant(bad, 'excerpt_does_not_match_source');
});

test('rechaza offsets fuera del texto', () => {
  const bad = response({}, {
    candidates: [
      candidate({
        primarySourceReference: {
          exactExcerpt: QUOTE_A,
          charStart: 0,
          charEnd: 100_000,
          offsetUnit: 'UNICODE_CODE_POINT'
        }
      })
    ]
  });
  expectInvariant(bad, 'offset_out_of_bounds');
});

test('rechaza una unidad de offset distinta de code points', () => {
  const bad = response({}, {
    candidates: [
      candidate({
        primarySourceReference: { ...reference(QUOTE_A), offsetUnit: 'UTF16' }
      })
    ]
  });
  expectInvariant(bad, 'offset_unit_unsupported');
});

test('rechaza un artefacto construido sobre otro texto', () => {
  const bad = response({}, { sourceCharacterCount: 12 });
  expectInvariant(bad, 'source_character_count_mismatch');
});

test('rechaza una referencia primaria sin anclaje único', () => {
  // Una cita ambigua o no encontrada jamás puede presentarse con offsets.
  const bad = response({}, {
    candidates: [candidate({ primarySourceGrounding: 'AMBIGUOUS' })]
  });
  expectInvariant(bad, 'primary_reference_present_without_unique_grounding');
});

test('rechaza anclaje único sin referencia primaria', () => {
  const bad = response({}, {
    candidates: [candidate({ primarySourceReference: null })]
  });
  expectInvariant(bad, 'primary_reference_missing_for_unique_grounding');
});

test('rechaza la bandera de confirmable incoherente con el anclaje', () => {
  const bad = response({}, {
    candidates: [
      candidate({
        primarySourceGrounding: 'NOT_FOUND',
        primarySourceReference: null,
        confirmableAsSourceDerived: true
      })
    ]
  });
  expectInvariant(bad, 'confirmable_flag_inconsistent_with_grounding');
});

test('acepta un candidato sin anclaje: se muestra, pero no es confirmable como derivado', () => {
  const verified = verifyObjectiveProposalResponse(
    response({}, {
      candidates: [
        candidate({
          primarySourceGrounding: 'NOT_FOUND',
          primarySourceReference: null,
          confirmableAsSourceDerived: false,
          unmatchedReferences: ['una cita que no existe']
        })
      ]
    }),
    RAW
  );
  assert.equal(verified.candidates[0].confirmableAsSourceDerived, false);
  assert.equal(verified.candidates[0].primarySourceReference, null);
});

test('rechaza ids de candidato duplicados o mal formados', () => {
  expectInvariant(
    response({}, { candidates: [candidate({ candidateId: 'req_01' })] }),
    'candidate_id_format_invalid'
  );
  expectInvariant(
    response({}, {
      candidates: [candidate(), candidate({ order: 2 })]
    }),
    'candidate_id_duplicated'
  );
});

test('rechaza un orden con huecos', () => {
  expectInvariant(
    response({}, { candidates: [candidate({ order: 7 })] }),
    'candidate_order_not_consecutive'
  );
});

test('rechaza CUALQUIER campo prohibido, en cualquier nivel', () => {
  for (const campo of ['finalState', 'confidence', 'requirementId', 'provenance', 'model']) {
    expectInvariant(
      response({}, { candidates: [candidate({ [campo]: 'lo-que-sea' })] }),
      'forbidden_field'
    );
  }
  // También anidado tres niveles abajo.
  expectInvariant(
    response({}, {
      candidates: [
        candidate({
          primarySourceReference: { ...reference(QUOTE_A), policyTrace: ['algo'] }
        })
      ]
    }),
    'forbidden_field'
  );
});

test('rechaza una identidad de etapa que no es la esperada', () => {
  const bad = response();
  (bad.execution as Record<string, unknown>).promptVersion = 'otro_prompt_v9';
  expectInvariant(bad, 'stage_identity_mismatch');
});

test('rechaza un effort o un proveedor distintos de los evaluados', () => {
  const badEffort = response();
  (badEffort.execution as Record<string, unknown>).reasoningEffort = 'high';
  expectInvariant(badEffort, 'reasoning_effort_mismatch');

  const badProvider = response();
  (badProvider.execution as Record<string, unknown>).provider = 'otro';
  expectInvariant(badProvider, 'provider_mismatch');
});

test('rechaza una normalización de fuente distinta de NONE', () => {
  expectInvariant(response({}, { sourceNormalization: 'NFC' }), 'source_normalization_unsupported');
});

test('verifica offsets en code points, no en unidades UTF-16', () => {
  // Un emoji fuera del BMP ocupa 2 unidades UTF-16 y 1 code point. Si el
  // verificador usara `slice` a secas, este caso fallaría.
  const raw = '🙂 Requisito: titulo afin.';
  const quote = 'Requisito: titulo afin.';
  const charStart = Array.from(raw).indexOf('R');
  const artifact = {
    schemaVersion: OBJECTIVE_UNDERSTANDING_STAGE_IDENTITY.artifactSchemaVersion,
    sourceNormalization: 'NONE',
    offsetUnit: 'UNICODE_CODE_POINT',
    sourceCharacterCount: Array.from(raw).length,
    candidates: [
      {
        ...candidate(),
        primarySourceReference: {
          exactExcerpt: quote,
          charStart,
          charEnd: charStart + Array.from(quote).length,
          offsetUnit: 'UNICODE_CODE_POINT'
        }
      }
    ],
    unresolvedPassages: []
  };
  const verified = verifyObjectiveProposalResponse(
    { ...response(), artifact },
    raw
  );
  assert.equal(verified.candidates[0].primarySourceReference?.exactExcerpt, quote);
});

test('verifica también los pasajes no resueltos', () => {
  const { charStart, charEnd } = offsetsOf(QUOTE_B);
  const ok = verifyObjectiveProposalResponse(
    response({}, {
      unresolvedPassages: [
        {
          exactExcerpt: QUOTE_B,
          reason: 'modalidad indecidible',
          grounding: 'UNIQUE',
          charStart,
          charEnd,
          offsetUnit: 'UNICODE_CODE_POINT'
        }
      ]
    }),
    RAW
  );
  assert.equal(ok.unresolvedPassages[0].charStart, charStart);

  expectInvariant(
    response({}, {
      unresolvedPassages: [
        {
          exactExcerpt: QUOTE_A,
          reason: 'x',
          grounding: 'UNIQUE',
          charStart,
          charEnd,
          offsetUnit: 'UNICODE_CODE_POINT'
        }
      ]
    }),
    'excerpt_does_not_match_source'
  );
});

test('acepta cero candidatos como resultado válido', () => {
  const verified = verifyObjectiveProposalResponse(
    response({}, { candidates: [] }),
    RAW
  );
  assert.deepEqual(verified.candidates, []);
});
