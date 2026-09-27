import {
  applyTextEdit,
  buildCreateObjectiveBody,
  buildProposalRequestBody,
  buildReviewDraft,
  countCodePoints,
  createManualItem,
  formatSectionLabel,
  mapReviewItemToRequirement,
  MAX_OBJECTIVE_CODE_POINTS,
  MAX_REQUEST_BODY_BYTES,
  serializedByteLength,
  sliceByCodePoints,
  splitAroundRange,
  summarizeReview,
  utf8ByteLength,
  validateConfirm,
  validateIntake
} from '@/features/objectives/review-draft';
import type {
  AnalyzedObjectiveSnapshot,
  ObjectiveProposalVM,
  ReviewItem
} from '@/types/objectives';

const SNAPSHOT: AnalyzedObjectiveSnapshot = {
  objectiveType: 'EMPLOYMENT',
  title: 'Analista de datos',
  rawObjectiveText: 'Requisitos:\n- Python avanzado\n- SQL intermedio\n'
};

function proposal(
  overrides: Partial<ObjectiveProposalVM['candidates'][number]> = {}
): ObjectiveProposalVM {
  return {
    candidates: [
      {
        candidateId: 'cand_01',
        proposedRequirementText: 'Python avanzado',
        primaryExcerpt: 'Python avanzado',
        excerptRange: { start: 14, end: 29 },
        grounding: 'UNIQUE',
        confirmableAsSourceDerived: true,
        sourceSectionLabel: '## Requisitos',
        isExactDuplicate: false,
        ...overrides
      }
    ],
    unresolvedPassageCount: 0
  };
}

function proposedItem(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    localKey: 'item_test',
    candidateId: 'cand_01',
    text: 'Python avanzado',
    originalProposedText: 'Python avanzado',
    origin: 'PROPOSED',
    wasEverEdited: false,
    primaryExcerpt: 'Python avanzado',
    excerptRange: { start: 14, end: 29 },
    grounding: 'UNIQUE',
    confirmableAsSourceDerived: true,
    sourceSectionLabel: '## Requisitos',
    isExactDuplicate: false,
    ...overrides
  };
}

describe('conteo por code points', () => {
  it('cuenta ASCII igual que length', () => {
    expect(countCodePoints('abc')).toBe(3);
  });

  it('cuenta un carácter astral como UNO, no como dos', () => {
    const emoji = '\u{1F600}';
    expect(emoji.length).toBe(2);
    expect(countCodePoints(emoji)).toBe(1);
  });

  it('acepta un texto de emojis que supera el límite en UTF-16 pero no en code points', () => {
    const emojis = '\u{1F600}'.repeat(MAX_OBJECTIVE_CODE_POINTS - 1);
    expect(emojis.length).toBeGreaterThan(MAX_OBJECTIVE_CODE_POINTS);
    expect(countCodePoints(emojis)).toBeLessThan(MAX_OBJECTIVE_CODE_POINTS);
  });
});

describe('utf8ByteLength', () => {
  it.each([
    ['a', 1],
    ['ñ', 2],
    ['€', 3],
    ['\u{1F600}', 4],
    ['añ€\u{1F600}', 10]
  ])('mide %s como %i bytes', (text, expected) => {
    expect(utf8ByteLength(text)).toBe(expected);
  });

  it('coincide con la medida del cuerpo serializado', () => {
    const body = { a: 'ñ\u{1F600}' };
    expect(serializedByteLength(body)).toBe(
      utf8ByteLength(JSON.stringify(body))
    );
  });
});

describe('corte y resaltado por code points', () => {
  it('corta sin desplazarse tras un carácter astral', () => {
    const text = '\u{1F600}abc';
    expect(sliceByCodePoints(text, 1, 4)).toBe('abc');
  });

  it('parte el texto en tres alrededor del rango', () => {
    const text = '\u{1F600}Python avanzado fin';
    const parts = splitAroundRange(text, 1, 16);
    expect(parts.before).toBe('\u{1F600}');
    expect(parts.highlighted).toBe('Python avanzado');
    expect(parts.after).toBe(' fin');
  });
});

describe('wasEverEdited es monotónica', () => {
  it('arranca en false', () => {
    expect(proposedItem().wasEverEdited).toBe(false);
  });

  it('pasa a true en la primera edición estricta', () => {
    const edited = applyTextEdit(proposedItem(), 'Python experto');
    expect(edited.wasEverEdited).toBe(true);
  });

  it('NO vuelve a false aunque el texto se restaure al original', () => {
    const edited = applyTextEdit(proposedItem(), 'Python experto');
    const restored = applyTextEdit(edited, 'Python avanzado');

    expect(restored.text).toBe('Python avanzado');
    expect(restored.wasEverEdited).toBe(true);
  });

  it('no marca edición si el texto no cambió', () => {
    const same = applyTextEdit(proposedItem(), 'Python avanzado');
    expect(same.wasEverEdited).toBe(false);
  });

  it('un cambio de sólo espacios SÍ cuenta como edición', () => {
    // Sin trim ni normalización: cualquier intervención humana cuenta.
    const edited = applyTextEdit(proposedItem(), 'Python avanzado ');
    expect(edited.wasEverEdited).toBe(true);
  });
});

describe('mapeo de procedencia', () => {
  it('un item propuesto, sin editar y anclado se confirma como derivado', () => {
    expect(mapReviewItemToRequirement(proposedItem())).toEqual({
      requirementText: 'Python avanzado',
      provenanceKind: 'DERIVED_FROM_SOURCE_TEXT',
      sourceQuote: 'Python avanzado'
    });
  });

  it('un item MANUAL siempre es entrada directa, sin cita', () => {
    const manual = createManualItem();
    manual.text = 'Escrito por la persona';

    expect(mapReviewItemToRequirement(manual)).toEqual({
      requirementText: 'Escrito por la persona',
      provenanceKind: 'DIRECT_STRUCTURED_INPUT',
      sourceQuote: null
    });
  });

  it('un item EDITADO pierde la cita aunque el texto vuelva al original', () => {
    const edited = applyTextEdit(
      applyTextEdit(proposedItem(), 'otro'),
      'Python avanzado'
    );

    expect(mapReviewItemToRequirement(edited)).toEqual({
      requirementText: 'Python avanzado',
      provenanceKind: 'DIRECT_STRUCTURED_INPUT',
      sourceQuote: null
    });
  });

  it('un item no confirmable como derivado es entrada directa', () => {
    const item = proposedItem({ confirmableAsSourceDerived: false });
    expect(mapReviewItemToRequirement(item).provenanceKind).toBe(
      'DIRECT_STRUCTURED_INPUT'
    );
    expect(mapReviewItemToRequirement(item).sourceQuote).toBeNull();
  });

  it('un item sin cita primaria es entrada directa', () => {
    const item = proposedItem({ primaryExcerpt: null, grounding: 'NOT_FOUND' });
    expect(mapReviewItemToRequirement(item).provenanceKind).toBe(
      'DIRECT_STRUCTURED_INPUT'
    );
  });

  it('NUNCA concatena varias citas: usa sólo la primaria y literal', () => {
    const mapped = mapReviewItemToRequirement(proposedItem());
    expect(mapped.sourceQuote).toBe('Python avanzado');
    expect(SNAPSHOT.rawObjectiveText).toContain(mapped.sourceQuote!);
  });
});

describe('reordenar no altera la procedencia', () => {
  it('el mapeo depende del item, no de su posición', () => {
    const draft = buildReviewDraft(SNAPSHOT, proposal());
    const manual = createManualItem();
    manual.text = 'Agregado';
    draft.items = [...draft.items, manual];

    const before = buildCreateObjectiveBody(draft).requirements;
    draft.items = [...draft.items].reverse();
    const after = buildCreateObjectiveBody(draft).requirements;

    expect(after[0]).toEqual(before[1]);
    expect(after[1]).toEqual(before[0]);
  });
});

describe('cuerpo de creación', () => {
  it('usa el texto del SNAPSHOT, no el estado actual del formulario', () => {
    const draft = buildReviewDraft(SNAPSHOT, proposal());
    const body = buildCreateObjectiveBody(draft);

    expect(body.source.inputType).toBe('PASTED_TEXT');
    expect(body.source.originalText).toBe(SNAPSHOT.rawObjectiveText);
  });

  it('manda objectiveContext vacío: el título ya es metadata de fila', () => {
    const body = buildCreateObjectiveBody(buildReviewDraft(SNAPSHOT, proposal()));
    expect(body.objectiveContext).toBe('');
  });

  it('NO envía candidateId, order, requirementId ni qualifiers', () => {
    const body = buildCreateObjectiveBody(buildReviewDraft(SNAPSHOT, proposal()));
    const serialized = JSON.stringify(body);

    expect(serialized).not.toContain('candidateId');
    expect(serialized).not.toContain('cand_01');
    expect(serialized).not.toContain('order');
    expect(serialized).not.toContain('requirementId');
    expect(serialized).not.toContain('qualifiers');
    expect(serialized).not.toContain('localKey');
  });

  it('el cuerpo de propuesta manda el texto verbatim', () => {
    const body = buildProposalRequestBody({
      objectiveType: 'SCHOLARSHIP',
      title: '  Con espacios  ',
      rawObjectiveText: '  texto\n\ncon saltos  '
    });

    expect(body.title).toBe('  Con espacios  ');
    expect(body.rawObjectiveText).toBe('  texto\n\ncon saltos  ');
  });
});

describe('validación de carga', () => {
  it('exige elegir el tipo: no hay valor por defecto', () => {
    expect(
      validateIntake({
        objectiveType: null,
        title: 'x',
        rawObjectiveText: 'y'
      })
    ).toBe('OBJECTIVE_TYPE_REQUIRED');
  });

  it('exige título', () => {
    expect(
      validateIntake({
        objectiveType: 'EMPLOYMENT',
        title: '   ',
        rawObjectiveText: 'y'
      })
    ).toBe('TITLE_REQUIRED');
  });

  it('rechaza un título de más de 500 caracteres', () => {
    expect(
      validateIntake({
        objectiveType: 'EMPLOYMENT',
        title: 'x'.repeat(501),
        rawObjectiveText: 'y'
      })
    ).toBe('TITLE_TOO_LONG');
  });

  it('exige texto', () => {
    expect(
      validateIntake({
        objectiveType: 'EMPLOYMENT',
        title: 'x',
        rawObjectiveText: '  \n '
      })
    ).toBe('TEXT_REQUIRED');
  });

  it('rechaza un texto de más de 60.000 code points', () => {
    expect(
      validateIntake({
        objectiveType: 'EMPLOYMENT',
        title: 'x',
        rawObjectiveText: 'x'.repeat(MAX_OBJECTIVE_CODE_POINTS + 1)
      })
    ).toBe('TEXT_TOO_MANY_CODE_POINTS');
  });

  it('acepta acentos dentro del límite de code points', () => {
    const accented = 'á'.repeat(MAX_OBJECTIVE_CODE_POINTS - 1);
    expect(countCodePoints(accented)).toBeLessThanOrEqual(
      MAX_OBJECTIVE_CODE_POINTS
    );
    expect(
      validateIntake({
        objectiveType: 'EMPLOYMENT',
        title: 'x',
        rawObjectiveText: accented
      })
    ).toBe('REQUEST_BODY_TOO_LARGE');
  });

  it('acepta una carga válida', () => {
    expect(
      validateIntake({
        objectiveType: 'EMPLOYMENT',
        title: SNAPSHOT.title,
        rawObjectiveText: SNAPSHOT.rawObjectiveText
      })
    ).toBeNull();
  });
});

describe('guard de bytes al confirmar', () => {
  it('detecta un cuerpo que pasa el límite de transporte aunque el texto entre', () => {
    // El cuerpo de creación lleva el texto original completo MÁS cada
    // requirementText MÁS cada sourceQuote: puede pasarse aunque el objetivo
    // solo sí entrara.
    const big = 'x'.repeat(60_000);
    expect(countCodePoints(big)).toBeLessThanOrEqual(
      MAX_OBJECTIVE_CODE_POINTS
    );

    const draft = buildReviewDraft(
      { ...SNAPSHOT, rawObjectiveText: big },
      proposal({
        proposedRequirementText: big,
        primaryExcerpt: big
      })
    );

    expect(serializedByteLength(buildCreateObjectiveBody(draft))).toBeGreaterThan(
      MAX_REQUEST_BODY_BYTES
    );
    expect(validateConfirm(draft)).toEqual({ code: 'REQUEST_BODY_TOO_LARGE' });
  });

  it('exige al menos un requisito', () => {
    const draft = buildReviewDraft(SNAPSHOT, {
      candidates: [],
      unresolvedPassageCount: 0
    });
    expect(validateConfirm(draft)).toEqual({ code: 'NO_REQUIREMENTS' });
  });

  it('señala el requisito en blanco que hay que completar', () => {
    const draft = buildReviewDraft(SNAPSHOT, proposal());
    const blank = createManualItem();
    draft.items = [...draft.items, blank];

    expect(validateConfirm(draft)).toEqual({
      code: 'BLANK_REQUIREMENT',
      localKey: blank.localKey
    });
  });

  it('acepta un borrador válido', () => {
    expect(validateConfirm(buildReviewDraft(SNAPSHOT, proposal()))).toBeNull();
  });
});

describe('presentación', () => {
  it('limpia el encabezado markdown de la sección', () => {
    expect(formatSectionLabel('## Requisitos')).toBe('Requisitos');
    expect(formatSectionLabel('   ')).toBeNull();
    expect(formatSectionLabel(null)).toBeNull();
  });

  it('resume la revisión con conteos reales', () => {
    const draft = buildReviewDraft(SNAPSHOT, proposal());
    const manual = createManualItem();
    draft.items = [...draft.items, manual];

    expect(summarizeReview(draft, 1)).toBe(
      '1 propuestos · 2 quedan · 1 agregados'
    );
  });
});
