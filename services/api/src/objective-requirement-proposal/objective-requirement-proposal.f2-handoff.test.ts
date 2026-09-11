/**
 * Handoff a F2 — slice P2.2.
 *
 * La regla de procedencia es gruesa a propósito, y estos tests fijan justamente
 * los casos donde alguien sentiría la tentación de afinarla: la edición cosmética,
 * el candidato ambiguo, la cita auxiliar que "completaría" a la primaria.
 *
 * Nada acá crea un Objective ni toca la base: la función es pura.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { REQUIREMENT_PROVENANCE_KINDS } from '../objectives/objective-definition.types';
import {
  type ObjectiveProposalCandidateDto
} from './dto/objective-requirement-proposal.dto';
import { mapReviewDecisionToRequirement } from './objective-requirement-proposal.f2-handoff';

const QUOTE = '- Experiencia minima de 3 anos.';

function candidate(
  overrides: Partial<ObjectiveProposalCandidateDto> = {}
): ObjectiveProposalCandidateDto {
  return {
    candidateId: 'cand_01',
    order: 1,
    proposedRequirementText: 'Experiencia minima de 3 anos.',
    primarySourceReference: {
      exactExcerpt: QUOTE,
      charStart: 0,
      charEnd: Array.from(QUOTE).length,
      offsetUnit: 'UNICODE_CODE_POINT'
    },
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

function mapOf(...candidates: ObjectiveProposalCandidateDto[]) {
  return new Map(candidates.map((item) => [item.candidateId, item]));
}

test('candidato sin editar y con anclaje único conserva la procedencia derivada', () => {
  const proposal = candidate();
  const handoff = mapReviewDecisionToRequirement(
    { kind: 'UNCHANGED', candidateId: 'cand_01' },
    mapOf(proposal)
  );

  assert.equal(handoff.provenance.kind, 'DERIVED_FROM_SOURCE_TEXT');
  assert.equal(handoff.provenance.sourceQuote, QUOTE);
  assert.equal(handoff.requirementText, proposal.proposedRequirementText);
});

test('la cita que va a F2 es la primaria literal, nunca una concatenación', () => {
  // Si el handoff pegara la auxiliar a la primaria, el resultado dejaría de ser
  // subcadena del texto fuente y F2 lo rechazaría al finalizar.
  const proposal = candidate({
    auxiliarySourceReferences: [
      {
        exactExcerpt: '**Requisitos**',
        charStart: 0,
        charEnd: 14,
        offsetUnit: 'UNICODE_CODE_POINT'
      }
    ]
  });
  const handoff = mapReviewDecisionToRequirement(
    { kind: 'UNCHANGED', candidateId: 'cand_01' },
    mapOf(proposal)
  );

  assert.equal(handoff.provenance.sourceQuote, QUOTE);
  assert.ok(!handoff.provenance.sourceQuote?.includes('**Requisitos**'));
});

test('cualquier edición cae a entrada estructurada directa, sin cita', () => {
  const handoff = mapReviewDecisionToRequirement(
    {
      kind: 'EDITED',
      candidateId: 'cand_01',
      editedText: 'Experiencia minima de 3 anos en el area.'
    },
    mapOf(candidate())
  );

  assert.equal(handoff.provenance.kind, 'DIRECT_STRUCTURED_INPUT');
  assert.equal(handoff.provenance.sourceQuote, null);
  assert.equal(handoff.requirementText, 'Experiencia minima de 3 anos en el area.');
});

test('una edición cosmética tampoco conserva la procedencia derivada', () => {
  // El texto editado sigue conteniendo la cita entera. Da igual: la regla no mide
  // cuánto cambió, porque medirlo sería el juicio semántico que se evitó.
  const handoff = mapReviewDecisionToRequirement(
    {
      kind: 'EDITED',
      candidateId: 'cand_01',
      editedText: 'Experiencia minima de 3 anos'
    },
    mapOf(candidate())
  );
  assert.equal(handoff.provenance.kind, 'DIRECT_STRUCTURED_INPUT');
  assert.equal(handoff.provenance.sourceQuote, null);
});

test('un Requirement agregado a mano es entrada estructurada directa', () => {
  const handoff = mapReviewDecisionToRequirement(
    { kind: 'MANUALLY_ADDED', text: 'Disponibilidad para viajar.' },
    mapOf(candidate())
  );

  assert.equal(handoff.provenance.kind, 'DIRECT_STRUCTURED_INPUT');
  assert.equal(handoff.provenance.sourceQuote, null);
  assert.equal(handoff.requirementText, 'Disponibilidad para viajar.');
});

test('un candidato sin anclaje único no puede confirmarse como derivado', () => {
  for (const grounding of ['AMBIGUOUS', 'NOT_FOUND'] as const) {
    const handoff = mapReviewDecisionToRequirement(
      { kind: 'UNCHANGED', candidateId: 'cand_01' },
      mapOf(
        candidate({
          primarySourceGrounding: grounding,
          primarySourceReference: null,
          confirmableAsSourceDerived: false
        })
      )
    );
    assert.equal(handoff.provenance.kind, 'DIRECT_STRUCTURED_INPUT');
    assert.equal(handoff.provenance.sourceQuote, null);
  }
});

test('un candidato desconocido es un error del llamante, no un silencio', () => {
  assert.throws(
    () =>
      mapReviewDecisionToRequirement(
        { kind: 'UNCHANGED', candidateId: 'cand_99' },
        mapOf(candidate())
      ),
    /unknown_candidate:cand_99/
  );
});

test('el handoff no inventa una tercera procedencia: F2_SCHEMA_CHANGES = 0', () => {
  const decisiones = [
    { kind: 'UNCHANGED', candidateId: 'cand_01' } as const,
    { kind: 'EDITED', candidateId: 'cand_01', editedText: 'otra cosa' } as const,
    { kind: 'MANUALLY_ADDED', text: 'otra cosa' } as const
  ];
  for (const decision of decisiones) {
    const handoff = mapReviewDecisionToRequirement(decision, mapOf(candidate()));
    assert.ok(
      (REQUIREMENT_PROVENANCE_KINDS as readonly string[]).includes(handoff.provenance.kind)
    );
  }
  assert.equal(REQUIREMENT_PROVENANCE_KINDS.length, 2);
});

test('el candidateId transitorio no viaja a F2', () => {
  const handoff = mapReviewDecisionToRequirement(
    { kind: 'UNCHANGED', candidateId: 'cand_01' },
    mapOf(candidate())
  );
  assert.deepEqual(Object.keys(handoff).sort(), ['provenance', 'requirementText']);
});
