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
