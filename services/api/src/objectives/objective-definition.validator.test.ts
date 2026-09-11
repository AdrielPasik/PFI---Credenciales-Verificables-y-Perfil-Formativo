/**
 * Validador de `objective_definition_v1` — F2.1.
 *
 * Los casos negativos se construyen mutando una fixture valida, para que cada
 * test aisle exactamente un invariante.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ObjectiveDefinitionError } from './objective-definition.errors';
import { verifyObjectiveDefinitionArtifact } from './objective-definition.validator';

const ORIGINAL_TEXT = [
  'Buscamos Backend Developer Junior.',
  '',
  'Requisitos: diseño e implementación de APIs REST, testing automatizado',
  'backend y persistencia relacional.'
].join('\n');

/** Artifact valido de tipo PASTED_TEXT, con dos requirements citados. */
function validPastedArtifact(): Record<string, any> {
  return {
    schemaVersion: 'objective_definition_v1',
    objectiveType: 'EMPLOYMENT',
    objectiveContext: 'Backend Developer Junior',
    source: { inputType: 'PASTED_TEXT', originalText: ORIGINAL_TEXT },
    requirements: [
      {
        requirementId: 'req_01',
        order: 1,
        requirementText: 'Diseño e implementación de APIs REST',
        provenance: {
          kind: 'DERIVED_FROM_SOURCE_TEXT',
          sourceQuote: 'diseño e implementación de APIs REST'
        },
        qualifiers: []
      },
      {
        requirementId: 'req_02',
        order: 2,
        requirementText: 'Testing automatizado backend',
        provenance: {
          kind: 'DERIVED_FROM_SOURCE_TEXT',
          sourceQuote: 'testing automatizado'
        },
        qualifiers: []
      }
    ]
  };
}

/** Artifact valido escrito directamente, sin texto de origen. */
function validDirectArtifact(): Record<string, any> {
  return {
    schemaVersion: 'objective_definition_v1',
    objectiveType: 'ADMISSION',
    objectiveContext: '',
    source: { inputType: 'DIRECT_STRUCTURED_INPUT', originalText: null },
    requirements: [
      {
        requirementId: 'req_01',
        order: 1,
        requirementText: 'Fundamentos de estadística inferencial',
        provenance: { kind: 'DIRECT_STRUCTURED_INPUT', sourceQuote: null },
        qualifiers: []
      }
    ]
  };
}

function expectRejection(artifact: unknown, code: string, invariant?: string) {
  try {
    verifyObjectiveDefinitionArtifact(artifact);
  } catch (error) {
    assert.ok(error instanceof ObjectiveDefinitionError, String(error));
    assert.equal(error.code, code);
    if (invariant !== undefined) {
      assert.match(error.detail.invariant, new RegExp(invariant));
    }
    return error;
  }
  throw new assert.AssertionError({ message: `se esperaba ${code} y fue aceptado` });
}

// ---------------------------------------------------------------------------
// Casos validos
// ---------------------------------------------------------------------------

test('accepts a PASTED_TEXT artifact with literal quotes', () => {
  const verified = verifyObjectiveDefinitionArtifact(validPastedArtifact());

  assert.equal(verified.schemaVersion, 'objective_definition_v1');
  assert.equal(verified.objectiveType, 'EMPLOYMENT');
  assert.equal(verified.source.inputType, 'PASTED_TEXT');
  assert.equal(verified.requirements.length, 2);
  assert.equal(verified.requirements[1].requirementId, 'req_02');
  assert.equal(verified.requirements[1].order, 2);
});

test('accepts a DIRECT_STRUCTURED_INPUT artifact with no source text', () => {
  const verified = verifyObjectiveDefinitionArtifact(validDirectArtifact());

  assert.equal(verified.source.originalText, null);
  assert.equal(verified.requirements[0].provenance.sourceQuote, null);
});

test('an empty objectiveContext is valid — not every posting has a separable framing', () => {
  const artifact = validPastedArtifact();
  artifact.objectiveContext = '';
  assert.equal(verifyObjectiveDefinitionArtifact(artifact).objectiveContext, '');
});

test('the same quote appearing twice in the source is still valid', () => {
  // La validez es CONTENCIÓN LITERAL, no unicidad de ocurrencia. No se persisten
  // spans, así que no hay ninguna ambigüedad que resolver.
  const artifact = validPastedArtifact();
  artifact.source.originalText = 'APIs REST y más tarde otra vez APIs REST.';
  artifact.requirements = [
    {
      requirementId: 'req_01',
      order: 1,
      requirementText: 'APIs REST',
      provenance: { kind: 'DERIVED_FROM_SOURCE_TEXT', sourceQuote: 'APIs REST' },
      qualifiers: []
    }
  ];

  const verified = verifyObjectiveDefinitionArtifact(artifact);
  assert.equal(verified.requirements[0].provenance.sourceQuote, 'APIs REST');
});

// ---------------------------------------------------------------------------
// Preservación exacta del texto
// ---------------------------------------------------------------------------

test('text is preserved exactly — no trim, no NFC, no line-ending rewriting', () => {
  const artifact = validPastedArtifact();
  const messy = '  Requisito con  espacios raros\r\ny CRLF  ';
  artifact.source.originalText = `Prefacio. ${messy} Cierre.`;
  artifact.requirements = [
    {
      requirementId: 'req_01',
      order: 1,
      requirementText: messy,
      provenance: { kind: 'DERIVED_FROM_SOURCE_TEXT', sourceQuote: messy },
      qualifiers: []
    }
  ];

  const verified = verifyObjectiveDefinitionArtifact(artifact);
  assert.equal(verified.requirements[0].requirementText, messy);
  assert.equal(verified.requirements[0].provenance.sourceQuote, messy);
  assert.ok(verified.source.originalText?.includes('\r\n'));
});

test('non-ASCII and astral Unicode survive intact', () => {
  const astral = String.fromCodePoint(0x1f9ea);
  const text = `Diseño de ensayos ${astral} en química analítica — ñandú`;
  const artifact = validPastedArtifact();
  artifact.source.originalText = `Contexto. ${text} Fin.`;
  artifact.requirements = [
    {
      requirementId: 'req_01',
      order: 1,
      requirementText: text,
      provenance: { kind: 'DERIVED_FROM_SOURCE_TEXT', sourceQuote: text },
      qualifiers: []
    }
  ];

  const verified = verifyObjectiveDefinitionArtifact(artifact);
  assert.equal(verified.requirements[0].requirementText, text);
  assert.deepEqual(
    Array.from(verified.requirements[0].requirementText),
    Array.from(text),
    'ni un code point de diferencia'
  );
  assert.ok(
    Array.from(text).some((ch) => (ch.codePointAt(0) as number) > 0xffff),
    'la fixture tiene un caracter fuera del BMP'
  );
});

// ---------------------------------------------------------------------------
// Forma del artifact
// ---------------------------------------------------------------------------

test('rejects a non-object input', () => {
  for (const input of [null, 'texto', 42, [], undefined]) {
    expectRejection(input, 'SCHEMA_INVALID', 'must_be_object');
  }
});

test('rejects an unsupported schemaVersion', () => {
  const artifact = validPastedArtifact();
  artifact.schemaVersion = 'objective_definition_v2';
  expectRejection(artifact, 'SCHEMA_VERSION_UNSUPPORTED');
});

test('rejects an objectiveType outside the closed set', () => {
  const artifact = validPastedArtifact();
  artifact.objectiveType = 'FREELANCE';
  expectRejection(artifact, 'SCHEMA_INVALID', 'value_outside_closed_set');
});

test('rejects an extra key at the root', () => {
  const artifact = validPastedArtifact();
  artifact.notes = 'algo';
  expectRejection(artifact, 'UNKNOWN_PROPERTY');
});

for (const [label, mutate] of [
  ['source', (a: any) => { a.source.url = 'https://x'; }],
  ['requirement', (a: any) => { a.requirements[0].weight = 3; }],
  ['provenance', (a: any) => { a.requirements[0].provenance.charStart = 12; }]
] as const) {
  test(`rejects an extra key nested in ${label}`, () => {
    const artifact = validPastedArtifact();
    mutate(artifact);
    expectRejection(artifact, 'UNKNOWN_PROPERTY');
  });
}

// ---------------------------------------------------------------------------
// Fronteras epistémicas
// ---------------------------------------------------------------------------

for (const key of [
  'epistemicTarget',
  'atomicity',
  'evaluability',
  'objectiveAnalysisStatus',
  'decompositionStatus'
] as const) {
  test(`rejects the Objective Analysis key ${key} with its own code`, () => {
    // No es "clave desconocida": es un intento de cruzar la frontera que fijó
    // HD-1. El Objective Analysis lo produce y lo congela el ReasoningRun.
    const artifact = validPastedArtifact();
    artifact.requirements[0][key] = 'FORMATIVE_EVIDENCE';
    expectRejection(
      artifact,
      'OBJECTIVE_ANALYSIS_FIELD_NOT_ALLOWED',
      'objective_analysis_is_produced_and_frozen_by_the_reasoning_run'
    );
  });
}

test('rejects Objective Analysis keys at the root too', () => {
  const artifact = validPastedArtifact();
  artifact.decompositionStatus = 'RESOLVED';
  expectRejection(artifact, 'OBJECTIVE_ANALYSIS_FIELD_NOT_ALLOWED');
});

for (const key of [
  'holderId',
  'credentialId',
  'credentialIds',
  'evidenceId',
  'evidenceUnits',
  'analysisRunId'
] as const) {
  test(`rejects the holder-scoped key ${key}`, () => {
    const artifact = validPastedArtifact();
    artifact[key] = 'x';
    expectRejection(
      artifact,
      'HOLDER_SCOPED_FIELD_NOT_ALLOWED',
      'objective_definition_must_stay_holder_independent'
    );
  });
}

test('holder independence is STRUCTURAL — free text may mention credentials', () => {
  // Una oferta real puede decir "se valorará una credencial de AWS" o incluir un
  // UUID. Escanear el texto buscando esas palabras daría falsos positivos sobre
  // contenido perfectamente legítimo del usuario.
  const artifact = validPastedArtifact();
  const text =
    'Se valorará credentialId propio y evidencia 3f7a9c21-0000-4000-8000-000000000000';
  artifact.source.originalText = `Contexto. ${text} Fin.`;
  artifact.objectiveContext = 'Puesto con credentialId mencionado';
  artifact.requirements = [
    {
      requirementId: 'req_01',
      order: 1,
      requirementText: text,
      provenance: { kind: 'DERIVED_FROM_SOURCE_TEXT', sourceQuote: text },
      qualifiers: []
    }
  ];

  const verified = verifyObjectiveDefinitionArtifact(artifact);
  assert.equal(verified.requirements[0].requirementText, text);
});

// ---------------------------------------------------------------------------
// Requirements: secuencia e identidad
// ---------------------------------------------------------------------------

test('rejects an empty requirements array', () => {
  const artifact = validPastedArtifact();
  artifact.requirements = [];
  expectRejection(artifact, 'REQUIREMENTS_EMPTY', 'at_least_one_requirement');
});

test('rejects a gap in order', () => {
  const artifact = validPastedArtifact();
  artifact.requirements[1].order = 3;
  expectRejection(artifact, 'REQUIREMENT_SEQUENCE_INVALID', 'consecutive_without_gaps');
});

test('rejects a duplicated order', () => {
  const artifact = validPastedArtifact();
  artifact.requirements[1].order = 1;
  expectRejection(artifact, 'REQUIREMENT_SEQUENCE_INVALID');
});

test('rejects order that does not start at 1', () => {
  const artifact = validDirectArtifact();
  artifact.requirements[0].order = 0;
  expectRejection(artifact, 'REQUIREMENT_SEQUENCE_INVALID');
});

test('rejects a requirementId that does not match req_NN', () => {
  const artifact = validDirectArtifact();
  artifact.requirements[0].requirementId = 'requirement-1';
  expectRejection(artifact, 'REQUIREMENT_SEQUENCE_INVALID', 'req_NN');
});

test('rejects a requirementId inconsistent with its order', () => {
  const artifact = validPastedArtifact();
  artifact.requirements[1].requirementId = 'req_07';
  expectRejection(artifact, 'REQUIREMENT_SEQUENCE_INVALID', 'agree_with_order');
});

test('a duplicated requirementId is rejected — by the order rule that subsumes it', () => {
  // Honestidad sobre la cobertura: con la regla id<->order vigente, un id
  // repetido SIEMPRE choca antes con la secuencia, así que
  // `REQUIREMENT_ID_DUPLICATED` no es alcanzable hoy. La comprobación de
  // unicidad se mantiene como defensa en profundidad por si esa regla se relaja,
  // y este test fija lo que realmente ocurre en vez de inventar el otro código.
  const artifact = validPastedArtifact();
  artifact.requirements[1].requirementId = 'req_01';
  expectRejection(artifact, 'REQUIREMENT_SEQUENCE_INVALID');
});

test('rejects whitespace-only requirementText', () => {
  const artifact = validDirectArtifact();
  artifact.requirements[0].requirementText = '   \n\t ';
  expectRejection(artifact, 'TEXT_EMPTY', 'must_not_be_blank');
});

// ---------------------------------------------------------------------------
// Source y provenance
// ---------------------------------------------------------------------------

test('rejects PASTED_TEXT with a null originalText', () => {
  const artifact = validPastedArtifact();
  artifact.source.originalText = null;
  expectRejection(artifact, 'SCHEMA_INVALID', 'must_be_string');
});

test('rejects PASTED_TEXT with a blank originalText', () => {
  const artifact = validPastedArtifact();
  artifact.source.originalText = '    ';
  expectRejection(artifact, 'SOURCE_INPUT_INCONSISTENT', 'non_blank_original_text');
});

test('rejects DIRECT_STRUCTURED_INPUT carrying an originalText', () => {
  const artifact = validDirectArtifact();
  artifact.source.originalText = 'texto que no debería estar';
  expectRejection(artifact, 'SOURCE_INPUT_INCONSISTENT', 'must_not_carry_original_text');
});

test('rejects derived provenance with a null quote', () => {
  const artifact = validPastedArtifact();
  artifact.requirements[0].provenance.sourceQuote = null;
  expectRejection(artifact, 'SCHEMA_INVALID', 'must_be_string');
});

test('rejects derived provenance when the source has no original text', () => {
  const artifact = validDirectArtifact();
  artifact.requirements[0].provenance = {
    kind: 'DERIVED_FROM_SOURCE_TEXT',
    sourceQuote: 'algo'
  };
  expectRejection(artifact, 'PROVENANCE_INCONSISTENT', 'requires_source_original_text');
});

test('rejects a quote that is not a literal substring', () => {
  const artifact = validPastedArtifact();
  artifact.requirements[0].provenance.sourceQuote = 'diseño de APIs GraphQL';
  expectRejection(artifact, 'SOURCE_QUOTE_NOT_LITERAL', 'literal_substring');
});

for (const [label, quote] of [
  ['casing', 'DISEÑO E IMPLEMENTACIÓN DE APIS REST'],
  ['whitespace colapsado', 'diseño  e  implementación  de  APIs  REST'],
  ['acentos removidos', 'diseno e implementacion de APIs REST']
] as const) {
  test(`literal means literal — rejects a quote differing only in ${label}`, () => {
    const artifact = validPastedArtifact();
    artifact.requirements[0].provenance.sourceQuote = quote;
    expectRejection(artifact, 'SOURCE_QUOTE_NOT_LITERAL');
  });
}

test('rejects direct provenance carrying a sourceQuote', () => {
  const artifact = validDirectArtifact();
  artifact.requirements[0].provenance.sourceQuote = 'inventado';
  expectRejection(artifact, 'PROVENANCE_INCONSISTENT', 'must_not_carry_a_source_quote');
});

test('rejects a provenance kind outside the closed set', () => {
  const artifact = validDirectArtifact();
  artifact.requirements[0].provenance.kind = 'AI_PROPOSED';
  expectRejection(artifact, 'SCHEMA_INVALID', 'value_outside_closed_set');
});

// ---------------------------------------------------------------------------
// Qualifiers — contrato de `kind` no congelado
// ---------------------------------------------------------------------------

test('an empty qualifiers array is valid', () => {
  const verified = verifyObjectiveDefinitionArtifact(validDirectArtifact());
  assert.deepEqual(verified.requirements[0].qualifiers, []);
});

test('rejects a missing qualifiers key', () => {
  const artifact = validDirectArtifact();
  delete artifact.requirements[0].qualifiers;
  expectRejection(artifact, 'SCHEMA_INVALID', 'must_be_array');
});

for (const [label, qualifier] of [
  ['un kind del vocabulario de la spec', { kind: 'contexto', value: 'backend', sourcePhrase: null }],
  ['un kind del reasoner', { kind: 'scope', value: 'backend', sourcePhrase: null }],
  ['un kind inventado', { kind: 'lo_que_sea', value: 'x', sourcePhrase: null }],
  ['un value vacío', { kind: 'contexto', value: '  ', sourcePhrase: null }]
] as const) {
  test(`rejects qualifiers with content: ${label}`, () => {
    // `objective_definition_v1` exige []. CONGELADO, no pendiente: los
    // qualifiers estructurados entrarían por `objective_definition_v2`.
    const artifact = validDirectArtifact();
    artifact.requirements[0].qualifiers = [qualifier];
    expectRejection(
      artifact,
      'QUALIFIERS_NOT_SUPPORTED_IN_V1',
      'requires_an_empty_qualifiers_array'
    );
  });
}

test('v1 is frozen: an artifact valid today stays valid under its schema version', () => {
  // La razón por la que v1 no se ampliará. Un artifact escrito hoy se re-valida
  // en cada lectura; si v1 aceptara mañana qualifiers con contenido y luego se
  // cerrara el vocabulario, filas históricas dejarían de validar. Con v1
  // congelado, `[]` sigue siendo válido para siempre bajo v1.
  const stored = validPastedArtifact();
  const first = verifyObjectiveDefinitionArtifact(stored);
  const reread = verifyObjectiveDefinitionArtifact(JSON.parse(JSON.stringify(first)));

  assert.deepEqual(reread, first);
  assert.deepEqual(reread.requirements[0].qualifiers, []);
});

// ---------------------------------------------------------------------------
// Snapshot desacoplado y congelado
// ---------------------------------------------------------------------------

test('the verified artifact is deeply frozen', () => {
  const verified = verifyObjectiveDefinitionArtifact(validPastedArtifact());

  assert.ok(Object.isFrozen(verified));
  assert.ok(Object.isFrozen(verified.source));
  assert.ok(Object.isFrozen(verified.requirements));
  assert.ok(Object.isFrozen(verified.requirements[0]));
  assert.ok(Object.isFrozen(verified.requirements[0].provenance));
  assert.ok(Object.isFrozen(verified.requirements[0].qualifiers));
});

test('the verified artifact is detached from the input', () => {
  const artifact = validPastedArtifact();
  const verified = verifyObjectiveDefinitionArtifact(artifact);

  artifact.objectiveType = 'OTHER';
  artifact.requirements[0].requirementText = 'mutado';
  artifact.requirements.push({ nada: true });

  assert.equal(verified.objectiveType, 'EMPLOYMENT');
  assert.equal(verified.requirements[0].requirementText, 'Diseño e implementación de APIs REST');
  assert.equal(verified.requirements.length, 2);
});

// ---------------------------------------------------------------------------
// Privacidad de los errores
// ---------------------------------------------------------------------------

test('errors never echo the user text', () => {
  const secret = 'CENTINELA_TEXTO_DE_OFERTA_4b1e';
  const artifact = validPastedArtifact();
  artifact.source.originalText = `Contexto ${secret} fin.`;
  artifact.requirements[0].requirementText = secret;
  artifact.requirements[0].provenance.sourceQuote = `${secret} inexistente`;

  const error = expectRejection(artifact, 'SOURCE_QUOTE_NOT_LITERAL');
  const serialized = `${error.message} ${JSON.stringify(error.detail)}`;
  assert.ok(!serialized.includes(secret), 'el error no debe llevar el texto');
  assert.match(error.detail.path, /^definition\.requirements\[0\]\.provenance\.sourceQuote$/);
});
