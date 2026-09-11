/**
 * Nucleo puro de la revision — P2.3.
 *
 * Los tests de procedencia son los que mas importan de todo P2.3: el backend NO
 * puede detectar una edicion (nunca compara `requirementText` contra la
 * propuesta, que es transitoria), asi que la honestidad epistemica vive
 * enteramente en estas funciones.
 */

import { describe, expect, it } from 'vitest';

import {
  applyTextEdit,
  buildCreateObjectiveBody,
  buildReviewDraft,
  countCodePoints,
  createManualItem,
  formatSectionLabel,
  mapReviewItemToRequirement,
  MAX_OBJECTIVE_CODE_POINTS,
  MAX_REQUEST_BODY_BYTES,
  serializedByteLength,
  splitAroundRange,
  summarizeReview,
  validateConfirm,
  validateIntake
} from '@/features/holder/objectives/review-draft';
import type {
  AnalyzedObjectiveSnapshot,
  ObjectiveProposalVM,
  ReviewItem
} from '@/models/objectives';

const RAW = '\n## Requisitos\n\n- Experiencia con Python.\n- Titulo universitario.\n';

const snapshot: AnalyzedObjectiveSnapshot = {
  objectiveType: 'EMPLOYMENT',
  title: 'Backend Engineer',
  rawObjectiveText: RAW
};

function proposal(
  overrides: Partial<ObjectiveProposalVM['candidates'][number]> = {}
): ObjectiveProposalVM {
  return {
    candidates: [
      {
        candidateId: 'cand_01',
        proposedRequirementText: 'Experiencia con Python.',
        primaryExcerpt: '- Experiencia con Python.',
        excerptRange: { start: 17, end: 42 },
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

function item(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    localKey: 'item_1',
    candidateId: 'cand_01',
    text: 'Experiencia con Python.',
    originalProposedText: 'Experiencia con Python.',
    origin: 'PROPOSED',
    wasEverEdited: false,
    primaryExcerpt: '- Experiencia con Python.',
    excerptRange: { start: 17, end: 42 },
    grounding: 'UNIQUE',
    confirmableAsSourceDerived: true,
    sourceSectionLabel: '## Requisitos',
    isExactDuplicate: false,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Code points vs UTF-16
// ---------------------------------------------------------------------------

describe('medicion de texto', () => {
  it('cuenta code points, no unidades UTF-16', () => {
    const rocket = '\u{1F680}';
    expect(rocket.length).toBe(2);
    expect(countCodePoints(rocket)).toBe(1);
    expect(countCodePoints('gestion')).toBe(7);
    // Texto con acentos precompuestos: un code point por letra.
    expect(countCodePoints('gestión')).toBe(7);
  });

  it('mide el cuerpo HTTP en bytes UTF-8, no en caracteres', () => {
    // Un acento pesa 2 bytes; un emoji, 4.
    expect(serializedByteLength('a')).toBe(3); // '"a"'
    expect(serializedByteLength('é')).toBeGreaterThan(3);
    expect(serializedByteLength({ a: '\u{1F680}' })).toBeGreaterThan(
      serializedByteLength({ a: 'ab' })
    );
  });

  it('corta por code points alrededor de un caracter astral', () => {
    const text = '\u{1F680} Requisito: titulo.';
    const start = Array.from(text).indexOf('R');
    const { before, highlighted, after } = splitAroundRange(text, start, start + 9);

    expect(highlighted).toBe('Requisito');
    expect(before + highlighted + after).toBe(text);
    // Con `slice` UTF-16 el resaltado quedaria corrido en uno.
    expect(text.slice(start, start + 9)).not.toBe(highlighted);
  });
});

// ---------------------------------------------------------------------------
// Edicion monotonica
// ---------------------------------------------------------------------------

describe('historial de edicion monotonico', () => {
  it('arranca sin editar', () => {
    expect(item().wasEverEdited).toBe(false);
  });

  it('marca editado en el primer cambio real', () => {
    const edited = applyTextEdit(item(), 'Experiencia avanzada con Python.');
    expect(edited.wasEverEdited).toBe(true);
    expect(edited.text).toBe('Experiencia avanzada con Python.');
  });

  it('no marca editado si el texto no cambio', () => {
    const same = applyTextEdit(item(), 'Experiencia con Python.');
    expect(same.wasEverEdited).toBe(false);
  });

  it('SIGUE editado tras revertir al texto exacto del proveedor', () => {
    // El caso decisivo. El Requirement fue intervenido por una persona durante
    // la revision; que los caracteres coincidan otra vez no devuelve el
    // respaldo documental.
    const edited = applyTextEdit(item(), 'Experiencia avanzada con Python.');
    const reverted = applyTextEdit(edited, 'Experiencia con Python.');

    expect(reverted.text).toBe('Experiencia con Python.');
    expect(reverted.wasEverEdited).toBe(true);
    expect(mapReviewItemToRequirement(reverted).provenanceKind).toBe(
      'DIRECT_STRUCTURED_INPUT'
    );
  });

  it('un item manual no se desmarca al escribir', () => {
    const manual = applyTextEdit(createManualItem(), 'Disponibilidad para viajar.');
    expect(manual.origin).toBe('MANUAL');
    expect(mapReviewItemToRequirement(manual).provenanceKind).toBe(
      'DIRECT_STRUCTURED_INPUT'
    );
  });
});

// ---------------------------------------------------------------------------
// Procedencia
// ---------------------------------------------------------------------------

describe('mapeo de procedencia', () => {
  it('intacto y con anclaje unico conserva la procedencia derivada', () => {
    const mapped = mapReviewItemToRequirement(item());
    expect(mapped.provenanceKind).toBe('DERIVED_FROM_SOURCE_TEXT');
    expect(mapped.sourceQuote).toBe('- Experiencia con Python.');
    expect(mapped.requirementText).toBe('Experiencia con Python.');
  });

  it('editado cae a entrada directa sin cita', () => {
    const mapped = mapReviewItemToRequirement(item({ wasEverEdited: true }));
    expect(mapped.provenanceKind).toBe('DIRECT_STRUCTURED_INPUT');
    expect(mapped.sourceQuote).toBeNull();
  });

  it('manual cae a entrada directa sin cita', () => {
    const mapped = mapReviewItemToRequirement(
      item({ origin: 'MANUAL', candidateId: null, primaryExcerpt: null })
    );
    expect(mapped.provenanceKind).toBe('DIRECT_STRUCTURED_INPUT');
    expect(mapped.sourceQuote).toBeNull();
  });

  it.each(['AMBIGUOUS', 'NOT_FOUND'] as const)(
    'anclaje %s no puede confirmarse como derivado',
    (grounding) => {
      const mapped = mapReviewItemToRequirement(
        item({ grounding, confirmableAsSourceDerived: false, primaryExcerpt: null })
      );
      expect(mapped.provenanceKind).toBe('DIRECT_STRUCTURED_INPUT');
      expect(mapped.sourceQuote).toBeNull();
    }
  );

  it('sin cita primaria no hay procedencia derivada aunque diga confirmable', () => {
    const mapped = mapReviewItemToRequirement(item({ primaryExcerpt: null }));
    expect(mapped.provenanceKind).toBe('DIRECT_STRUCTURED_INPUT');
  });

  it('nunca concatena excerpts', () => {
    const mapped = mapReviewItemToRequirement(item());
    expect(mapped.sourceQuote).toBe('- Experiencia con Python.');
    expect(RAW.includes(mapped.sourceQuote as string)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cuerpo de creacion
// ---------------------------------------------------------------------------

describe('cuerpo de creacion del Objective', () => {
  const draft = buildReviewDraft(snapshot, proposal());

  it('envia el texto original EXACTO del snapshot', () => {
    const body = buildCreateObjectiveBody(draft);
    expect(body.source.originalText).toBe(RAW);
    expect(body.source.inputType).toBe('PASTED_TEXT');
  });

  it('no envia campos que pone el servidor', () => {
    const body = buildCreateObjectiveBody(draft);
    const serialized = JSON.stringify(body);
    for (const forbidden of [
      'order',
      'requirementId',
      'qualifiers',
      'candidateId',
      'schemaVersion',
      'status',
      'ownerUserId',
      'grounding',
      'sourceSectionLabel'
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('cada requisito lleva exactamente tres claves', () => {
    const body = buildCreateObjectiveBody(draft);
    for (const requirement of body.requirements) {
      expect(Object.keys(requirement).sort()).toEqual([
        'provenanceKind',
        'requirementText',
        'sourceQuote'
      ]);
    }
  });

  it('objectiveContext va vacio: el titulo ya es metadata de fila', () => {
    expect(buildCreateObjectiveBody(draft).objectiveContext).toBe('');
  });

  it('el orden del array es el orden de la lista', () => {
    const many = buildReviewDraft(snapshot, {
      candidates: [
        { ...proposal().candidates[0], candidateId: 'cand_01', proposedRequirementText: 'A' },
        { ...proposal().candidates[0], candidateId: 'cand_02', proposedRequirementText: 'B' }
      ],
      unresolvedPassageCount: 0
    });
    const swapped = { ...many, items: [many.items[1], many.items[0]] };
    const body = buildCreateObjectiveBody(swapped);

    expect(body.requirements.map((r) => r.requirementText)).toEqual(['B', 'A']);
    // Reordenar NO toca la procedencia.
    expect(body.requirements[0].provenanceKind).toBe('DERIVED_FROM_SOURCE_TEXT');
    expect(body.requirements[1].provenanceKind).toBe('DERIVED_FROM_SOURCE_TEXT');
  });
});

// ---------------------------------------------------------------------------
// Validacion
// ---------------------------------------------------------------------------

describe('validacion del intake', () => {
  const valid = {
    objectiveType: 'EMPLOYMENT' as const,
    title: 'Backend Engineer',
    rawObjectiveText: RAW
  };

  it('acepta un intake valido', () => {
    expect(validateIntake(valid)).toBeNull();
  });

  it('exige tipo, titulo y texto', () => {
    expect(validateIntake({ ...valid, objectiveType: null })).toBe(
      'OBJECTIVE_TYPE_REQUIRED'
    );
    expect(validateIntake({ ...valid, title: '   ' })).toBe('TITLE_REQUIRED');
    expect(validateIntake({ ...valid, rawObjectiveText: '  \n ' })).toBe(
      'TEXT_REQUIRED'
    );
  });

  it('rechaza un titulo desmedido', () => {
    expect(validateIntake({ ...valid, title: 'x'.repeat(501) })).toBe('TITLE_TOO_LONG');
  });

  it('mide el limite semantico en code points', () => {
    // 30.001 emojis son 60.002 unidades UTF-16 pero solo 30.001 code points:
    // entra de sobra. Medir con `.length` lo rechazaria.
    const emojis = '\u{1F680}'.repeat(30_001);
    expect(emojis.length).toBeGreaterThan(MAX_OBJECTIVE_CODE_POINTS);
    expect(countCodePoints(emojis)).toBeLessThan(MAX_OBJECTIVE_CODE_POINTS);

    // Y sin embargo NO pasa, porque en UTF-8 pesa 120 KB: lo frena el limite de
    // transporte, que es el correcto para este caso.
    expect(validateIntake({ ...valid, rawObjectiveText: emojis })).toBe(
      'REQUEST_BODY_TOO_LARGE'
    );
  });

  it('rechaza por code points cuando el texto es ASCII largo', () => {
    expect(
      validateIntake({
        ...valid,
        rawObjectiveText: 'x'.repeat(MAX_OBJECTIVE_CODE_POINTS + 1)
      })
      // El limite semantico muerde primero: 60.001 bytes entran en 100 KiB.
    ).toBe('TEXT_TOO_MANY_CODE_POINTS');
  });

  it('rechaza cuando pasa los code points pero no los bytes', () => {
    // Texto con acentos: 52.000 code points (dentro del limite semantico de
    // 60.000) pero 104.000 bytes UTF-8, por encima de los 102.400 del
    // transporte. Es exactamente el caso que contar caracteres no ve.
    const accented = 'é'.repeat(52_000);
    expect(countCodePoints(accented)).toBeLessThanOrEqual(MAX_OBJECTIVE_CODE_POINTS);
    expect(validateIntake({ ...valid, rawObjectiveText: accented })).toBe(
      'REQUEST_BODY_TOO_LARGE'
    );
  });
});

describe('validacion de la confirmacion', () => {
  const draft = buildReviewDraft(snapshot, proposal());

  it('acepta un borrador valido', () => {
    expect(validateConfirm(draft)).toBeNull();
  });

  it('bloquea con cero requisitos', () => {
    expect(validateConfirm({ ...draft, items: [] })?.code).toBe('NO_REQUIREMENTS');
  });

  it('bloquea con un requisito en blanco y dice cual', () => {
    const withBlank = {
      ...draft,
      items: [draft.items[0], item({ localKey: 'item_9', text: '   ' })]
    };
    const result = validateConfirm(withBlank);
    expect(result?.code).toBe('BLANK_REQUIREMENT');
    expect(result?.localKey).toBe('item_9');
  });

  it('bloquea cuando el cuerpo de creacion supera el transporte', () => {
    // El objetivo por si solo entra, pero al sumarle los requisitos y las citas
    // el cuerpo se pasa. Este es el caso que el limite de code points NO ve.
    const big = 'a'.repeat(40_000);
    const heavy = {
      ...draft,
      snapshot: { ...snapshot, rawObjectiveText: big },
      items: Array.from({ length: 20 }, (_, index) =>
        item({
          localKey: `item_${index}`,
          text: 'b'.repeat(2_000),
          primaryExcerpt: 'c'.repeat(2_000)
        })
      )
    };
    expect(countCodePoints(big)).toBeLessThan(MAX_OBJECTIVE_CODE_POINTS);
    expect(serializedByteLength(buildCreateObjectiveBody(heavy))).toBeGreaterThan(
      MAX_REQUEST_BODY_BYTES
    );
    expect(validateConfirm(heavy)?.code).toBe('REQUEST_BODY_TOO_LARGE');
  });
});

// ---------------------------------------------------------------------------
// Presentacion
// ---------------------------------------------------------------------------

describe('presentacion', () => {
  it('limpia el encabezado markdown solo para mostrarlo', () => {
    expect(formatSectionLabel('## Requisitos')).toBe('Requisitos');
    expect(formatSectionLabel('Conocimientos valorados')).toBe(
      'Conocimientos valorados'
    );
    expect(formatSectionLabel(null)).toBeNull();
    expect(formatSectionLabel('###')).toBeNull();
  });

  it('resume la revision sin inventar un puntaje', () => {
    const draft = buildReviewDraft(snapshot, proposal());
    const withManual = {
      ...draft,
      items: [...draft.items, createManualItem()]
    };
    const summary = summarizeReview(withManual, 1);
    expect(summary).toContain('1 propuestos');
    expect(summary).toContain('2 quedan');
    expect(summary).toContain('1 agregados');
    expect(summary).not.toMatch(/%|score|punta/i);
  });
});
