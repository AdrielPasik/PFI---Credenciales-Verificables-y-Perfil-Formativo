import { describe, expect, it } from 'vitest';

import {
  adaptObjectiveDetail,
  adaptObjectiveProposal,
  adaptObjectiveSummaries
} from '@/lib/adapters/objectives.adapter';
import { IncompatiblePayloadError } from '@/lib/errors/api-error';

const proposalPayload = {
  schemaVersion: 'objective_requirement_proposal_v1',
  authority: 'PROPOSAL_ONLY',
  humanConfirmationRequired: true,
  candidates: [
    {
      candidateId: 'cand_01',
      order: 1,
      proposedRequirementText: 'Experiencia con Python.',
      primarySourceReference: {
        exactExcerpt: '- Experiencia  con   Python.',
        charStart: 10,
        charEnd: 38,
        offsetUnit: 'UNICODE_CODE_POINT'
      },
      primarySourceGrounding: 'UNIQUE',
      auxiliarySourceReferences: [],
      ambiguousReferences: [],
      unmatchedReferences: [],
      sourceSectionLabel: '## Requisitos',
      exactDuplicateOfEarlier: false,
      confirmableAsSourceDerived: true
    }
  ],
  unresolvedPassages: [{ exactExcerpt: 'x', reason: 'y', grounding: 'UNIQUE' }]
};

describe('adapter de propuesta', () => {
  it('conserva el excerpt VERBATIM, sin colapsar espacios', () => {
    // Critico: el backend exige que `sourceQuote` sea subcadena LITERAL del
    // texto original. Normalizar aqui convertiria una cita valida en una que el
    // servidor rechaza.
    const proposal = adaptObjectiveProposal(proposalPayload);
    expect(proposal.candidates[0].primaryExcerpt).toBe('- Experiencia  con   Python.');
  });

  it('mapea los campos que la UI necesita', () => {
    const [candidate] = adaptObjectiveProposal(proposalPayload).candidates;
    expect(candidate.candidateId).toBe('cand_01');
    expect(candidate.grounding).toBe('UNIQUE');
    expect(candidate.confirmableAsSourceDerived).toBe(true);
    expect(candidate.excerptRange).toEqual({ start: 10, end: 38 });
    expect(candidate.isExactDuplicate).toBe(false);
  });

  it('cuenta los pasajes no resueltos sin exponer su detalle tecnico', () => {
    const proposal = adaptObjectiveProposal(proposalPayload);
    expect(proposal.unresolvedPassageCount).toBe(1);
    expect(JSON.stringify(proposal)).not.toContain('reason');
  });

  it('acepta una referencia primaria nula', () => {
    const [candidate] = adaptObjectiveProposal({
      ...proposalPayload,
      candidates: [
        {
          ...proposalPayload.candidates[0],
          primarySourceReference: null,
          primarySourceGrounding: 'NOT_FOUND',
          confirmableAsSourceDerived: false
        }
      ]
    }).candidates;

    expect(candidate.primaryExcerpt).toBeNull();
    expect(candidate.excerptRange).toBeNull();
    expect(candidate.confirmableAsSourceDerived).toBe(false);
  });

  it('rechaza una respuesta que no declara autoridad de sola propuesta', () => {
    expect(() =>
      adaptObjectiveProposal({ ...proposalPayload, authority: 'FINAL' })
    ).toThrow(IncompatiblePayloadError);
    expect(() =>
      adaptObjectiveProposal({ ...proposalPayload, humanConfirmationRequired: false })
    ).toThrow(IncompatiblePayloadError);
  });

  it('rechaza un anclaje desconocido', () => {
    expect(() =>
      adaptObjectiveProposal({
        ...proposalPayload,
        candidates: [
          { ...proposalPayload.candidates[0], primarySourceGrounding: 'MAYBE' }
        ]
      })
    ).toThrow(IncompatiblePayloadError);
  });

  it('acepta cero candidatos', () => {
    const proposal = adaptObjectiveProposal({
      ...proposalPayload,
      candidates: [],
      unresolvedPassages: []
    });
    expect(proposal.candidates).toEqual([]);
  });
});

describe('adapter de resumen', () => {
  it('mapea solo lo que trae el contrato de resumen', () => {
    const [summary] = adaptObjectiveSummaries([
      {
        objectiveReference: 'obj-1',
        objectiveType: 'SCHOLARSHIP',
        title: 'Beca de posgrado',
        status: 'active',
        supersedesObjectiveReference: null,
        createdAt: '2026-09-11T10:00:00.000Z'
      }
    ]);

    expect(summary.objectiveReference).toBe('obj-1');
    expect(summary.objectiveTypeLabel).toBe('Beca');
    expect(summary.createdAtLabel).toMatch(/2026/);
    // El resumen no trae `definition`, asi que no hay cantidad de requisitos.
    expect(summary).not.toHaveProperty('requirementCount');
  });

  it('rechaza un tipo fuera del enum', () => {
    expect(() =>
      adaptObjectiveSummaries([
        {
          objectiveReference: 'obj-1',
          objectiveType: 'TRABAJO',
          title: 'x',
          createdAt: '2026-09-11T10:00:00.000Z'
        }
      ])
    ).toThrow(IncompatiblePayloadError);
  });
});

describe('adapter de detalle', () => {
  const detailPayload = {
    objectiveReference: 'obj-1',
    objectiveType: 'EMPLOYMENT',
    title: 'Backend Engineer',
    status: 'active',
    supersedesObjectiveReference: null,
    createdAt: '2026-09-11T10:00:00.000Z',
    definition: {
      schemaVersion: 'objective_definition_v1',
      objectiveType: 'EMPLOYMENT',
      objectiveContext: '',
      // Forma REAL de la respuesta: PLANA, no anidada bajo `source`. La forma
      // anidada es la de la PETICION de creacion. Ver
      // objectives.detail-contract.test.ts.
      sourceInputType: 'PASTED_TEXT',
      sourceOriginalText: '\n- Experiencia.\n',
      requirements: [
        {
          requirementId: 'req_01',
          order: 1,
          requirementText: 'Experiencia con Python.',
          provenanceKind: 'DERIVED_FROM_SOURCE_TEXT',
          sourceQuote: '- Experiencia.',
          qualifiers: []
        },
        {
          requirementId: 'req_02',
          order: 2,
          requirementText: 'Disponibilidad para viajar.',
          provenanceKind: 'DIRECT_STRUCTURED_INPUT',
          sourceQuote: null,
          qualifiers: []
        }
      ]
    }
  };

  it('traduce la procedencia a lenguaje de producto', () => {
    const detail = adaptObjectiveDetail(detailPayload);
    expect(detail.requirements[0].originLabel).toBe('Del objetivo');
    expect(detail.requirements[1].originLabel).toBe('Agregado por vos');
  });

  it('conserva el texto original verbatim, con sus saltos de linea', () => {
    expect(adaptObjectiveDetail(detailPayload).sourceOriginalText).toBe(
      '\n- Experiencia.\n'
    );
  });

  it('mapea el tipo a etiqueta legible', () => {
    expect(adaptObjectiveDetail(detailPayload).objectiveTypeLabel).toBe(
      'Busqueda laboral'
    );
  });
});
