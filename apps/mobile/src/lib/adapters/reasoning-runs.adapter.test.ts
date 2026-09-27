import {
  adaptReasoningRunDetail,
  adaptReasoningRunSummaries
} from '@/lib/adapters/reasoning-runs.adapter';
import { IncompatiblePayloadError } from '@/lib/errors/api-error';
import {
  evidencePayload,
  FORBIDDEN_INTERNAL_TOKENS,
  reasoningRunDetailPayload,
  reasoningRunSummariesPayload
} from '@/test/objective-fixtures';
import { groupEvidenceByCredential } from '@/types/reasoning-runs';

describe('adaptReasoningRunSummaries', () => {
  it('adapta el historial conservando el orden del servidor', () => {
    const runs = adaptReasoningRunSummaries(reasoningRunSummariesPayload());

    expect(runs.map((run) => run.reasoningRunReference)).toEqual([
      'run_02',
      'run_01'
    ]);
    expect(runs[0]?.status).toBe('pending');
  });

  it('conserva el createdAt crudo además de la etiqueta', () => {
    const runs = adaptReasoningRunSummaries(reasoningRunSummariesPayload());

    expect(runs[0]?.createdAt).toBe('2026-09-22T10:00:00.000Z');
    expect(runs[0]?.createdAtLabel).toMatch(/2026/);
  });

  it('rechaza un estado de run desconocido', () => {
    const payload = reasoningRunSummariesPayload();
    (payload[0] as Record<string, unknown>).status = 'cancelled';

    expect(() => adaptReasoningRunSummaries(payload)).toThrow(
      IncompatiblePayloadError
    );
  });

  it('acepta una categoría de fallo cerrada y rechaza una inventada', () => {
    const ok = reasoningRunSummariesPayload();
    (ok[0] as Record<string, unknown>).failureCategory =
      'EVIDENCE_PREPARATION_BLOCKED';
    expect(adaptReasoningRunSummaries(ok)[0]?.failureCategory).toBe(
      'EVIDENCE_PREPARATION_BLOCKED'
    );

    const bad = reasoningRunSummariesPayload();
    (bad[0] as Record<string, unknown>).failureCategory =
      'reasoning_input_freeze_blocked';
    expect(() => adaptReasoningRunSummaries(bad)).toThrow(
      IncompatiblePayloadError
    );
  });
});

describe('adaptReasoningRunDetail', () => {
  it('adapta un run completado con resultados y síntesis', () => {
    const run = adaptReasoningRunDetail(reasoningRunDetailPayload());

    expect(run.status).toBe('completed');
    expect(run.requirementResults).toHaveLength(2);
    expect(run.synthesis).not.toBeNull();
    expect(run.completedAtLabel).toMatch(/2026/);
  });

  it('un run no completado NO trae resultados, y `null` no se vuelve []', () => {
    const run = adaptReasoningRunDetail(
      reasoningRunDetailPayload({
        status: 'pending',
        result: null,
        synthesis: null,
        completedAt: null
      })
    );

    // Distinguir "todavía no hay análisis" de "el análisis no encontró nada".
    expect(run.requirementResults).toBeNull();
    expect(run.synthesis).toBeNull();
    expect(run.completedAtLabel).toBeNull();
  });

  it('una síntesis AUSENTE (API anterior) también colapsa a null', () => {
    const payload = reasoningRunDetailPayload();
    delete payload.synthesis;

    expect(adaptReasoningRunDetail(payload).synthesis).toBeNull();
  });

  it('rechaza una síntesis con otra versión de schema', () => {
    const payload = reasoningRunDetailPayload();
    (payload.synthesis as Record<string, unknown>).schemaVersion =
      'objective_synthesis_v2';

    expect(() => adaptReasoningRunDetail(payload)).toThrow(
      IncompatiblePayloadError
    );
  });

  it('preserva los cinco estados finales exactos', () => {
    for (const finalState of [
      'SUPPORTED',
      'PARTIALLY_SUPPORTED',
      'INSUFFICIENT_EVIDENCE',
      'NOT_ASSESSABLE',
      'ABSTAIN'
    ] as const) {
      const payload = reasoningRunDetailPayload();
      const result = payload.result as Record<string, unknown>;
      const results = result.requirementResults as Record<string, unknown>[];
      results[0]!.finalState = finalState;

      expect(
        adaptReasoningRunDetail(payload).requirementResults?.[0]?.finalState
      ).toBe(finalState);
    }
  });

  it('rechaza un sexto estado final', () => {
    const payload = reasoningRunDetailPayload();
    const result = payload.result as Record<string, unknown>;
    const results = result.requirementResults as Record<string, unknown>[];
    results[0]!.finalState = 'MOSTLY_SUPPORTED';

    expect(() => adaptReasoningRunDetail(payload)).toThrow(
      IncompatiblePayloadError
    );
  });

  it('copia supportedWeakerClaim exacto y acepta su ausencia', () => {
    const payload = reasoningRunDetailPayload();
    const result = payload.result as Record<string, unknown>;
    const results = result.requirementResults as Record<string, unknown>[];
    results[0]!.finalState = 'PARTIALLY_SUPPORTED';
    results[0]!.supportedWeakerClaim =
      'Puede justificarse formación en Python aplicada a análisis de datos.';

    const run = adaptReasoningRunDetail(payload);
    expect(run.requirementResults?.[0]?.supportedWeakerClaim).toBe(
      'Puede justificarse formación en Python aplicada a análisis de datos.'
    );
    expect(run.requirementResults?.[1]?.supportedWeakerClaim).toBeNull();
  });
});

describe('evidencia', () => {
  function withEvidence(evidence: unknown[]) {
    const payload = reasoningRunDetailPayload();
    const result = payload.result as Record<string, unknown>;
    const results = result.requirementResults as Record<string, unknown>[];
    results[0]!.evidence = evidence;
    return adaptReasoningRunDetail(payload).requirementResults![0]!;
  }

  it('soporta 0, 1 y N evidencias', () => {
    expect(withEvidence([]).evidence).toHaveLength(0);
    expect(withEvidence([evidencePayload()]).evidence).toHaveLength(1);
    expect(
      withEvidence([evidencePayload(), evidencePayload(), evidencePayload()])
        .evidence
    ).toHaveLength(3);
  });

  it('preserva la cita VERBATIM', () => {
    const result = withEvidence([
      evidencePayload({ excerpt: '  Python   aplicado  ' })
    ]);
    expect(result.evidence[0]?.excerpt).toBe('  Python   aplicado  ');
  });

  it('acepta pageNumber null y no lo sustituye por 1', () => {
    const result = withEvidence([
      evidencePayload({ pageNumber: null, sourceKind: 'TEXT' })
    ]);
    expect(result.evidence[0]?.pageNumber).toBeNull();
  });

  it('rechaza un pageNumber 0 o negativo', () => {
    expect(() => withEvidence([evidencePayload({ pageNumber: 0 })])).toThrow(
      IncompatiblePayloadError
    );
  });

  it('acepta una evidencia sin credencial, sin inventarle una', () => {
    const result = withEvidence([evidencePayload({ credential: null })]);
    expect(result.evidence[0]?.credential).toBeNull();
  });

  it('traduce el estado actual de la credencial y conserva el crudo', () => {
    const result = withEvidence([
      evidencePayload({
        credential: {
          credentialReference: 'cred-002',
          title: 'Redes',
          credentialType: 'course',
          issuerName: 'Instituto',
          currentStatus: 'revoked'
        }
      })
    ]);

    expect(result.evidence[0]?.credential?.currentStatus).toBe('revoked');
    expect(result.evidence[0]?.credential?.currentStatusLabel).toBe('Revocada');
  });

  it('un estado desconocido se muestra tal cual antes que romper la lectura', () => {
    const result = withEvidence([
      evidencePayload({
        credential: {
          credentialReference: 'cred-003',
          title: 'X',
          credentialType: 'course',
          issuerName: 'Y',
          currentStatus: 'archived'
        }
      })
    ]);

    expect(result.evidence[0]?.credential?.currentStatusLabel).toBe('archived');
  });

  it('agrupa SÓLO por credentialReference, nunca por título ni emisor', () => {
    const result = withEvidence([
      evidencePayload(),
      evidencePayload({ excerpt: 'Otra cita de la misma credencial' }),
      evidencePayload({
        credential: {
          credentialReference: 'cred-999',
          // Mismo título y mismo emisor: si se agrupara por eso, se fusionarían.
          title: 'Análisis de Datos',
          credentialType: 'academic_subject',
          issuerName: 'Universidad Nacional Ejemplo',
          currentStatus: 'issued'
        }
      })
    ]);

    const groups = groupEvidenceByCredential(result.evidence);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.items).toHaveLength(2);
    expect(groups[1]?.credential?.credentialReference).toBe('cred-999');
  });

  it('las evidencias sin credencial no se agrupan entre sí', () => {
    const result = withEvidence([
      evidencePayload({ credential: null }),
      evidencePayload({ credential: null })
    ]);

    const groups = groupEvidenceByCredential(result.evidence);
    expect(groups).toHaveLength(2);
  });
});

describe('frontera de privacidad', () => {
  it('el modelo adaptado NO transporta identificadores internos', () => {
    const run = adaptReasoningRunDetail(reasoningRunDetailPayload());
    const serialized = JSON.stringify(run);

    for (const token of FORBIDDEN_INTERNAL_TOKENS) {
      // `schemaVersion` es la única excepción: la síntesis lo lleva por
      // contrato y no es un identificador interno ni material sensible.
      if (token === 'schemaVersion') continue;
      expect(serialized).not.toContain(token);
    }
  });

  it('IGNORA `explanation` aunque el servidor lo reenviara', () => {
    const payload = reasoningRunDetailPayload();
    const result = payload.result as Record<string, unknown>;
    const results = result.requirementResults as Record<string, unknown>[];
    results[0]!.explanation =
      'El requisito req_01 alcanzó FOUND sobre src_03 con eu_07.';

    const run = adaptReasoningRunDetail(payload);
    const serialized = JSON.stringify(run);

    expect(serialized).not.toContain('explanation');
    expect(serialized).not.toContain('src_03');
    expect(serialized).not.toContain('eu_07');
    expect(serialized).not.toContain('FOUND');
  });

  it('IGNORA executionMetadata y policyTrace si reaparecieran', () => {
    const payload = reasoningRunDetailPayload({
      executionMetadata: { provider: 'openai', model: 'gpt-x' },
      policyTrace: ['guard_1', 'guard_2']
    });

    const serialized = JSON.stringify(adaptReasoningRunDetail(payload));
    expect(serialized).not.toContain('openai');
    expect(serialized).not.toContain('gpt-x');
    expect(serialized).not.toContain('guard_1');
  });
});
