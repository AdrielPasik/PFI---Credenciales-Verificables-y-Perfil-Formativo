/**
 * Adapter del Analisis de trayectoria — P2.4B.
 *
 * Las fixtures reproducen la forma REAL que devuelve P2.4A, incluido lo que NO
 * trae: no hay `explanation`, y ninguna prueba lo agrega "por si acaso".
 *
 * Se construyen POR PARCHE en vez de mutando: el payload es JSON del servidor y
 * tiparlo laxo para poder escribirle encima obligaria a un `any` que el lint del
 * repo —con razon— no acepta.
 */

import { describe, expect, it } from 'vitest';

import {
  adaptReasoningRunDetail,
  adaptReasoningRunSummaries
} from '@/lib/adapters/reasoning-runs.adapter';
import { IncompatiblePayloadError } from '@/lib/errors/api-error';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Patch = Record<string, Json>;

const credential = (patch: Patch = {}): Json => ({
  credentialReference: 'cred-1',
  title: 'Analisis de datos con Python para negocios',
  credentialType: 'course',
  issuerName: 'Plataforma de Cursos Demo',
  currentStatus: 'issued',
  ...patch
});

const evidence = (patch: Patch = {}): Json => ({
  excerpt: 'diseno y consumo de APIs REST',
  contextBefore: 'Contenidos: ',
  contextAfter: ' y persistencia.',
  sectionLabel: 'Contenidos',
  pageNumber: 3,
  coverage: 'FULL',
  sourceKind: 'DOCUMENT',
  credential: credential(),
  ...patch
});

const requirementResult = (patch: Patch = {}): Json => ({
  requirementId: 'req_01',
  requirementText: 'Experiencia disenando APIs REST',
  finalState: 'SUPPORTED',
  supportedWeakerClaim: null,
  evidence: [evidence()],
  ...patch
});

const detailPayload = (patch: Patch = {}): Json => ({
  reasoningRunReference: 'run-1',
  status: 'completed',
  objective: {
    objectiveReference: 'obj-1',
    title: 'Backend Engineer',
    objectiveType: 'EMPLOYMENT',
    objectiveContext: 'Equipo de plataforma',
    requirements: []
  },
  failureCategory: null,
  createdAt: '2026-09-11T10:00:00.000Z',
  startedAt: '2026-09-11T10:00:05.000Z',
  completedAt: '2026-09-11T10:03:00.000Z',
  failedAt: null,
  result: { requirementResults: [requirementResult()] },
  ...patch
});

const synthesisRequirement = (index: number, patch: Patch = {}): Json => ({
  requirementId: `req_${String(index).padStart(2, '0')}`,
  order: index,
  requirementText: `Requisito confirmado ${index}`,
  finalState: 'INSUFFICIENT_EVIDENCE',
  ...patch
});

const realFourteenRequirementSynthesis = (): Json => ({
  schemaVersion: 'objective_synthesis_v1',
  reasoningRunReference: 'run-1',
  objectiveReference: 'obj-1',
  stateSummary: {
    supportedCount: 0,
    partiallySupportedCount: 1,
    insufficientEvidenceCount: 5,
    abstainCount: 2,
    notAssessableCount: 6
  },
  requirements: Array.from({ length: 14 }, (_, offset) => {
    const index = offset + 1;
    if (index === 4) {
      return synthesisRequirement(index, { finalState: 'PARTIALLY_SUPPORTED' });
    }
    if (index <= 6) return synthesisRequirement(index);
    if (index <= 8) return synthesisRequirement(index, { finalState: 'ABSTAIN' });
    return synthesisRequirement(index, { finalState: 'NOT_ASSESSABLE' });
  }),
  positiveConclusions: [
    {
      requirementId: 'req_04',
      requirementText: 'Aplicar programacion para el manejo de datos empresariales',
      finalState: 'PARTIALLY_SUPPORTED',
      supportedWeakerClaim:
        'Formacion introductoria en programacion con Python para el manejo de datos empresariales.',
      supportingCredentialReferences: ['cred-python']
    }
  ],
  credentialsSupportingPositiveConclusions: [
    {
      credentialReference: 'cred-python',
      credentialDisplay: {
        title: 'Analisis de datos con Python para negocios',
        credentialType: 'course',
        issuerName: 'Plataforma de Cursos Demo',
        currentStatus: 'revoked'
      },
      supportedRequirementIds: [],
      partiallySupportedRequirementIds: ['req_04']
    }
  ]
});

/** Atajo: un run completado con estos resultados. */
const withResults = (...results: Json[]): Json =>
  detailPayload({ result: { requirementResults: results } });

/** Atajo: un run completado con un resultado que lleva estas evidencias. */
const withEvidence = (...items: Json[]): Json =>
  withResults(requirementResult({ evidence: items }));

const firstResult = (payload: Json) =>
  adaptReasoningRunDetail(payload).requirementResults?.[0];

describe('adapter del analisis', () => {
  it('no necesita `explanation` y lo ignora si aparece', () => {
    const run = adaptReasoningRunDetail(
      withResults(
        requirementResult({
          explanation: 'Estado: SUPPORTED. Evidencia: src_01: "..."'
        })
      )
    );
    const serialized = JSON.stringify(run);

    expect(serialized).not.toContain('explanation');
    expect(serialized).not.toContain('src_01');
    expect(run.requirementResults?.[0].finalState).toBe('SUPPORTED');
  });

  it('adapta la sintesis real de catorce requisitos sin derivar promociones negativas', () => {
    const run = adaptReasoningRunDetail(
      detailPayload({
        result: {
          requirementResults: [
            requirementResult({
              finalState: 'INSUFFICIENT_EVIDENCE',
              evidence: [
                evidence({
                  credential: credential({ credentialReference: 'cred-insufficient' })
                })
              ]
            }),
            requirementResult({
              finalState: 'ABSTAIN',
              evidence: [
                evidence({ credential: credential({ credentialReference: 'cred-abstain' }) })
              ]
            }),
            requirementResult({
              finalState: 'NOT_ASSESSABLE',
              evidence: [
                evidence({
                  credential: credential({ credentialReference: 'cred-not-assessable' })
                })
              ]
            })
          ]
        },
        synthesis: realFourteenRequirementSynthesis()
      })
    );

    expect(run.synthesis).toMatchObject({
      schemaVersion: 'objective_synthesis_v1',
      stateSummary: {
        supportedCount: 0,
        partiallySupportedCount: 1,
        insufficientEvidenceCount: 5,
        abstainCount: 2,
        notAssessableCount: 6
      }
    });
    expect(run.synthesis?.requirements).toHaveLength(14);
    expect(run.synthesis?.positiveConclusions).toEqual([
      expect.objectContaining({
        requirementId: 'req_04',
        finalState: 'PARTIALLY_SUPPORTED',
        supportedWeakerClaim:
          'Formacion introductoria en programacion con Python para el manejo de datos empresariales.',
        supportingCredentialReferences: ['cred-python']
      })
    ]);
    expect(run.synthesis?.credentialsSupportingPositiveConclusions).toEqual([
      expect.objectContaining({
        credentialReference: 'cred-python',
        credentialDisplay: expect.objectContaining({
          title: 'Analisis de datos con Python para negocios',
          currentStatus: 'revoked'
        }),
        supportedRequirementIds: [],
        partiallySupportedRequirementIds: ['req_04']
      })
    ]);
    // El adapter no reconstruye promociones: credenciales que solo aparecen en
    // estados no positivos no pueden entrar a la sintesis por derivacion local.
    expect(run.synthesis?.credentialsSupportingPositiveConclusions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ credentialReference: 'cred-insufficient' }),
        expect.objectContaining({ credentialReference: 'cred-abstain' }),
        expect.objectContaining({ credentialReference: 'cred-not-assessable' })
      ])
    );
  });

  it('colapsa synthesis ausente y null explicito a null para compatibilidad aditiva', () => {
    expect(adaptReasoningRunDetail(detailPayload()).synthesis).toBeNull();
    expect(adaptReasoningRunDetail(detailPayload({ synthesis: null })).synthesis).toBeNull();
  });

  it('conserva el orden del backend y no reemplaza la identidad exterior', () => {
    const run = adaptReasoningRunDetail(
      detailPayload({
        synthesis: {
          ...(realFourteenRequirementSynthesis() as Record<string, Json>),
          reasoningRunReference: 'run-historic',
          objectiveReference: 'obj-historic'
        }
      })
    );

    expect(run.reasoningRunReference).toBe('run-1');
    expect(run.objectiveReference).toBe('obj-1');
    expect(run.synthesis?.reasoningRunReference).toBe('run-historic');
    expect(run.synthesis?.requirements.map((item) => item.requirementId)).toEqual([
      'req_01',
      'req_02',
      'req_03',
      'req_04',
      'req_05',
      'req_06',
      'req_07',
      'req_08',
      'req_09',
      'req_10',
      'req_11',
      'req_12',
      'req_13',
      'req_14'
    ]);
  });

  it('acepta conclusiones positivas supported y parcialmente supported', () => {
    const synthesis = realFourteenRequirementSynthesis() as Record<string, Json>;
    const run = adaptReasoningRunDetail(
      detailPayload({
        synthesis: {
          ...synthesis,
          positiveConclusions: [
            ...(synthesis.positiveConclusions as Json[]),
            {
              requirementId: 'req_01',
              requirementText: 'Requisito respaldado',
              finalState: 'SUPPORTED',
              supportedWeakerClaim: null,
              supportingCredentialReferences: ['cred-python', 'cred-2']
            }
          ],
          credentialsSupportingPositiveConclusions: [
            ...(synthesis.credentialsSupportingPositiveConclusions as Json[]),
            {
              credentialReference: 'cred-2',
              credentialDisplay: {
                title: 'Otra credencial',
                credentialType: 'course',
                issuerName: 'Emisor Demo',
                currentStatus: 'issued'
              },
              supportedRequirementIds: ['req_01'],
              partiallySupportedRequirementIds: ['req_04']
            }
          ]
        }
      })
    );

    expect(run.synthesis?.positiveConclusions.map((item) => item.finalState)).toEqual([
      'PARTIALLY_SUPPORTED',
      'SUPPORTED'
    ]);
    expect(
      run.synthesis?.credentialsSupportingPositiveConclusions[1]
        .partiallySupportedRequirementIds
    ).toEqual(['req_04']);
  });

  it.each([
    [
      'schemaVersion invalido',
      (value: Record<string, Json>) => ({ ...value, schemaVersion: 'objective_synthesis_v2' })
    ],
    [
      'estado desconocido',
      (value: Record<string, Json>) => ({
        ...value,
        requirements: [synthesisRequirement(1, { finalState: 'RANKED' })]
      })
    ],
    [
      'conteo negativo',
      (value: Record<string, Json>) => ({
        ...value,
        stateSummary: { ...(value.stateSummary as Record<string, Json>), abstainCount: -1 }
      })
    ],
    [
      'conteo no entero',
      (value: Record<string, Json>) => ({
        ...value,
        stateSummary: { ...(value.stateSummary as Record<string, Json>), abstainCount: 1.5 }
      })
    ],
    [
      'credencial sin metadata requerida',
      (value: Record<string, Json>) => ({
        ...value,
        credentialsSupportingPositiveConclusions: [
          { credentialReference: 'cred-python' }
        ]
      })
    ]
  ])('rechaza synthesis con %s', (_label, patch) => {
    expect(() =>
      adaptReasoningRunDetail(detailPayload({ synthesis: patch(realFourteenRequirementSynthesis() as Record<string, Json>) }))
    ).toThrow(IncompatiblePayloadError);
  });

  it('valida el estado final contra los cinco congelados', () => {
    expect(() =>
      adaptReasoningRunDetail(withResults(requirementResult({ finalState: 'APROBADO' })))
    ).toThrow(IncompatiblePayloadError);
  });

  it.each([
    'SUPPORTED',
    'PARTIALLY_SUPPORTED',
    'INSUFFICIENT_EVIDENCE',
    'NOT_ASSESSABLE',
    'ABSTAIN'
  ])('acepta el estado %s', (finalState) => {
    expect(firstResult(withResults(requirementResult({ finalState })))?.finalState).toBe(
      finalState
    );
  });

  it('supportedWeakerClaim es opcional y se copia exacto', () => {
    expect(firstResult(detailPayload())?.supportedWeakerClaim).toBeNull();

    expect(
      firstResult(
        withResults(
          requirementResult({
            supportedWeakerClaim: '  Exposicion formativa a APIs REST.  '
          })
        )
      )?.supportedWeakerClaim
    ).toBe('  Exposicion formativa a APIs REST.  ');
  });

  it('acepta 0, 1 y N evidencias', () => {
    expect(firstResult(withEvidence())?.evidence).toEqual([]);
    expect(firstResult(withEvidence(evidence()))?.evidence).toHaveLength(1);
    expect(
      firstResult(
        withEvidence(
          evidence(),
          evidence({ excerpt: 'otra cita' }),
          evidence({ excerpt: 'tercera cita' })
        )
      )?.evidence
    ).toHaveLength(3);
  });

  it('la cita se preserva VERBATIM, sin recortar ni colapsar espacios', () => {
    expect(
      firstResult(withEvidence(evidence({ excerpt: '  diseno   de  APIs REST  ' })))
        ?.evidence[0].excerpt
    ).toBe('  diseno   de  APIs REST  ');
  });

  it('credential puede ser null sin perder la cita', () => {
    const item = firstResult(withEvidence(evidence({ credential: null })))?.evidence[0];
    expect(item?.credential).toBeNull();
    expect(item?.excerpt).toBe('diseno y consumo de APIs REST');
  });

  it('traduce el estado ACTUAL de la credencial', () => {
    const item = firstResult(
      withEvidence(evidence({ credential: credential({ currentStatus: 'revoked' }) }))
    )?.evidence[0];
    expect(item?.credential?.currentStatus).toBe('revoked');
    expect(item?.credential?.currentStatusLabel).toBe('Revocada');
  });

  it('pageNumber null se conserva null; nunca se sustituye por 1', () => {
    const item = firstResult(
      withEvidence(evidence({ pageNumber: null, sourceKind: 'TEXT' }))
    )?.evidence[0];
    expect(item?.pageNumber).toBeNull();
    expect(item?.sourceKind).toBe('TEXT');
  });

  it('rechaza una pagina que no es un entero positivo', () => {
    expect(() =>
      adaptReasoningRunDetail(withEvidence(evidence({ pageNumber: 0 })))
    ).toThrow(IncompatiblePayloadError);
  });

  it.each(['FULL', 'PARTIAL', 'FAILED'])('acepta la cobertura %s', (coverage) => {
    expect(
      firstResult(withEvidence(evidence({ coverage })))?.evidence[0].coverage
    ).toBe(coverage);
  });

  it('un run sin resultado deja requirementResults en null, no en []', () => {
    // Distinguirlos importa: `[]` diria "analizado y sin nada", `null` dice
    // "todavia no hay analisis".
    const run = adaptReasoningRunDetail(
      detailPayload({ status: 'pending', result: null, completedAt: null })
    );
    expect(run.requirementResults).toBeNull();
    expect(run.completedAtLabel).toBeNull();
  });

  it('valida el estado del run y la categoria de fallo', () => {
    expect(() =>
      adaptReasoningRunDetail(detailPayload({ status: 'cancelled' }))
    ).toThrow(IncompatiblePayloadError);

    const failed = adaptReasoningRunDetail(
      detailPayload({
        status: 'failed',
        result: null,
        failureCategory: 'EVIDENCE_PREPARATION_BLOCKED'
      })
    );
    expect(failed.failureCategory).toBe('EVIDENCE_PREPARATION_BLOCKED');
  });

  it('adapta la lista de resumenes', () => {
    const summaries = adaptReasoningRunSummaries([
      {
        reasoningRunReference: 'run-1',
        objectiveReference: 'obj-1',
        objectiveTitle: 'Backend Engineer',
        objectiveType: 'EMPLOYMENT',
        status: 'completed',
        requirementCount: 9,
        failureCategory: null,
        createdAt: '2026-09-11T10:00:00.000Z',
        startedAt: null,
        completedAt: null,
        failedAt: null
      }
    ]);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].requirementCount).toBe(9);
    expect(summaries[0].createdAtLabel).toContain('2026');
  });
});
