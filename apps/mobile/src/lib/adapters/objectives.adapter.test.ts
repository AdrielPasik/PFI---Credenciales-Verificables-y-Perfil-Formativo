import {
  adaptObjectiveDetail,
  adaptObjectiveProposal,
  adaptObjectiveSummaries
} from '@/lib/adapters/objectives.adapter';
import { IncompatiblePayloadError } from '@/lib/errors/api-error';
import {
  objectiveDetailPayload,
  objectiveSummariesPayload,
  proposalPayload,
  OBJECTIVE_SOURCE_TEXT
} from '@/test/objective-fixtures';

describe('adaptObjectiveProposal', () => {
  it('exige las banderas de autoridad del contrato', () => {
    expect(() =>
      adaptObjectiveProposal(proposalPayload({ authority: 'FINAL' }))
    ).toThrow(IncompatiblePayloadError);

    expect(() =>
      adaptObjectiveProposal(
        proposalPayload({ humanConfirmationRequired: false })
      )
    ).toThrow(IncompatiblePayloadError);
  });

  it('adapta candidatos con y sin cita primaria', () => {
    const proposal = adaptObjectiveProposal(proposalPayload());

    expect(proposal.candidates).toHaveLength(2);
    expect(proposal.candidates[0]?.primaryExcerpt).toBe('Python avanzado');
    expect(proposal.candidates[0]?.excerptRange).toEqual({
      start: 24,
      end: 39
    });
    expect(proposal.candidates[0]?.confirmableAsSourceDerived).toBe(true);

    expect(proposal.candidates[1]?.primaryExcerpt).toBeNull();
    expect(proposal.candidates[1]?.excerptRange).toBeNull();
    expect(proposal.candidates[1]?.grounding).toBe('NOT_FOUND');
    expect(proposal.candidates[1]?.confirmableAsSourceDerived).toBe(false);
  });

  it('cuenta los pasajes sin resolver sin exponer su contenido interno', () => {
    const proposal = adaptObjectiveProposal(proposalPayload());
    expect(proposal.unresolvedPassageCount).toBe(1);
    expect(JSON.stringify(proposal)).not.toContain('NO_EVALUABLE');
  });

  it('preserva la cita VERBATIM, sin colapsar espacios', () => {
    const payload = proposalPayload();
    const candidates = payload.candidates as Record<string, unknown>[];
    const reference = candidates[0]!.primarySourceReference as Record<
      string,
      unknown
    >;
    reference.exactExcerpt = '  Python   avanzado  ';

    const proposal = adaptObjectiveProposal(payload);
    expect(proposal.candidates[0]?.primaryExcerpt).toBe(
      '  Python   avanzado  '
    );
  });

  it('rechaza un grounding desconocido', () => {
    const payload = proposalPayload();
    const candidates = payload.candidates as Record<string, unknown>[];
    candidates[0]!.primarySourceGrounding = 'MAYBE';

    expect(() => adaptObjectiveProposal(payload)).toThrow(
      IncompatiblePayloadError
    );
  });
});

describe('adaptObjectiveSummaries', () => {
  it('traduce el tipo a etiqueta de producto, nunca el token', () => {
    const summaries = adaptObjectiveSummaries(objectiveSummariesPayload());

    expect(summaries[0]?.objectiveTypeLabel).toBe('Búsqueda laboral');
    expect(summaries[1]?.objectiveTypeLabel).toBe('Beca');
  });

  it('formatea la fecha en es-AR', () => {
    const summaries = adaptObjectiveSummaries(objectiveSummariesPayload());
    expect(summaries[0]?.createdAtLabel).toMatch(/2026/);
  });

  it('rechaza un tipo de objetivo desconocido', () => {
    expect(() =>
      adaptObjectiveSummaries([
        { ...objectiveSummariesPayload()[0], objectiveType: 'VACACIONES' }
      ])
    ).toThrow(IncompatiblePayloadError);
  });
});

describe('adaptObjectiveDetail', () => {
  it('lee la respuesta PLANA de lectura, no la forma anidada de creación', () => {
    const detail = adaptObjectiveDetail(objectiveDetailPayload());

    expect(detail.sourceInputType).toBe('PASTED_TEXT');
    expect(detail.sourceOriginalText).toBe(OBJECTIVE_SOURCE_TEXT);
  });

  it('preserva el texto original VERBATIM, con sus saltos de línea', () => {
    const detail = adaptObjectiveDetail(objectiveDetailPayload());
    expect(detail.sourceOriginalText).toContain('\n');
    expect(detail.sourceOriginalText).toBe(OBJECTIVE_SOURCE_TEXT);
  });

  it('traduce la procedencia a una etiqueta de producto', () => {
    const detail = adaptObjectiveDetail(objectiveDetailPayload());

    expect(detail.requirements[0]?.originLabel).toBe('Del objetivo');
    expect(detail.requirements[1]?.originLabel).toBe('Agregado por vos');
  });

  it('la cita persistida es subcadena literal del texto original', () => {
    const detail = adaptObjectiveDetail(objectiveDetailPayload());
    const quote = detail.requirements[0]?.sourceQuote;

    expect(quote).not.toBeNull();
    expect(detail.sourceOriginalText).toContain(quote!);
  });

  it('acepta un requisito sin cita', () => {
    const detail = adaptObjectiveDetail(objectiveDetailPayload());
    expect(detail.requirements[1]?.sourceQuote).toBeNull();
  });

  it('rechaza una procedencia desconocida', () => {
    const payload = objectiveDetailPayload();
    const definition = payload.definition as Record<string, unknown>;
    const requirements = definition.requirements as Record<string, unknown>[];
    requirements[0]!.provenanceKind = 'INVENTADO';

    expect(() => adaptObjectiveDetail(payload)).toThrow(
      IncompatiblePayloadError
    );
  });

  it('informa la ruta exacta del campo incompatible', () => {
    const payload = objectiveDetailPayload({ title: 42 });

    try {
      adaptObjectiveDetail(payload);
      throw new Error('debería haber fallado');
    } catch (error) {
      expect(error).toBeInstanceOf(IncompatiblePayloadError);
      expect((error as IncompatiblePayloadError).diagnostic).toEqual({
        path: 'objective.title',
        expected: 'string',
        actualCategory: 'number'
      });
    }
  });
});
