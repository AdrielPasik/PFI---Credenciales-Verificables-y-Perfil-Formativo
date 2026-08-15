import { describe, expect, it } from 'vitest';

import {
  adaptApplyReusableSemanticInterpretationResult,
  adaptAppliedReusableSemanticInterpretation,
  adaptReusableSemanticInterpretationCandidate,
  adaptReusableSemanticInterpretationRead
} from '@/lib/adapters/reusable-semantic-interpretation.adapter';
import { IncompatiblePayloadError } from '@/lib/errors/api-error';

function snapshotSummaryPayload(overrides?: Record<string, unknown>) {
  return {
    schema: 'approved_template_semantic_snapshot_v2',
    status: 'completed',
    areaCount: 2,
    skillCount: 3,
    conceptCount: 1,
    hasHoursDistribution: true,
    warningCount: 0,
    qualityFlagCount: 1,
    ...overrides
  };
}

function appliedSummaryPayload(overrides?: Record<string, unknown>) {
  return {
    templateId: 'template-1',
    templateTitle: 'Curso de Python',
    snapshotSummary: snapshotSummaryPayload(),
    appliedAt: '2026-08-14T11:00:00.000Z',
    appliedByDisplayLabel: 'Ana Aprobadora',
    approvalDriftStatus: 'up_to_date',
    templateContentStatus: 'matches_approved_source',
    destinationCompatibility: 'compatible',
    changedFields: [],
    ...overrides
  };
}

function candidatePayload(overrides?: Record<string, unknown>) {
  return {
    templateId: 'template-1',
    templateTitle: 'Curso de Python',
    snapshotSummary: snapshotSummaryPayload(),
    approvedAt: '2026-08-14T10:00:00.000Z',
    approvedByDisplayLabel: 'Ana Aprobadora',
    approvalRevision: '2026-08-14T10:00:00.000Z',
    approvalDriftStatus: 'none_applied',
    templateContentStatus: 'matches_approved_source',
    destinationCompatibility: 'compatible',
    changedFields: [],
    currentApplication: null,
    ...overrides
  };
}

describe('adaptAppliedReusableSemanticInterpretation', () => {
  it('adapts a full applied summary', () => {
    const result = adaptAppliedReusableSemanticInterpretation(
      appliedSummaryPayload()
    );

    expect(result.templateReference).toBe('template-1');
    expect(result.templateTitle).toBe('Curso de Python');
    expect(result.appliedAt).toBe('2026-08-14T11:00:00.000Z');
    expect(result.appliedAtLabel).not.toHaveLength(0);
    expect(result.appliedByDisplayLabel).toBe('Ana Aprobadora');
    expect(result.approvalDriftStatus).toBe('up_to_date');
    expect(result.templateContentStatus).toBe('matches_approved_source');
    expect(result.destinationCompatibility).toBe('compatible');
    expect(result.changedFields).toEqual([]);
    expect(result.snapshotSummary.schema).toBe(
      'approved_template_semantic_snapshot_v2'
    );
  });

  it('adapts an allowlisted changedFields set', () => {
    const result = adaptAppliedReusableSemanticInterpretation(
      appliedSummaryPayload({
        destinationCompatibility: 'modified',
        changedFields: ['title', 'description', 'competencies', 'hours']
      })
    );

    expect(result.changedFields).toEqual([
      'title',
      'description',
      'competencies',
      'hours'
    ]);
  });

  it('never leaks raw technical fields into the adapted shape', () => {
    const raw = appliedSummaryPayload({
      sourceCredentialId: 'credential-source',
      sourceSemanticAnalysisId: 'semantic-1',
      appliedByUserId: 'user-1',
      approvedSnapshot: { raw: true }
    });
    const result = adaptAppliedReusableSemanticInterpretation(raw);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toMatch(/credential-source|semantic-1|user-1/);
  });

  it('rejects a changedFields entry outside the allowlist', () => {
    expect(() =>
      adaptAppliedReusableSemanticInterpretation(
        appliedSummaryPayload({ changedFields: ['modality'] })
      )
    ).toThrow(IncompatiblePayloadError);
  });

  it('rejects an unknown approvalDriftStatus/templateContentStatus/destinationCompatibility value', () => {
    expect(() =>
      adaptAppliedReusableSemanticInterpretation(
        appliedSummaryPayload({ approvalDriftStatus: 'newer_available' })
      )
    ).toThrow(IncompatiblePayloadError);
    expect(() =>
      adaptAppliedReusableSemanticInterpretation(
        appliedSummaryPayload({ templateContentStatus: 'invalid' })
      )
    ).toThrow(IncompatiblePayloadError);
    expect(() =>
      adaptAppliedReusableSemanticInterpretation(
        appliedSummaryPayload({ destinationCompatibility: 'invalid' })
      )
    ).toThrow(IncompatiblePayloadError);
  });

  it('rejects a payload missing required fields', () => {
    expect(() =>
      adaptAppliedReusableSemanticInterpretation({})
    ).toThrow(IncompatiblePayloadError);
  });
});

describe('adaptReusableSemanticInterpretationRead', () => {
  it('adapts null (200 + null body, never an error) as null', () => {
    expect(adaptReusableSemanticInterpretationRead(null)).toBeNull();
  });

  it('adapts a real applied summary the same way as adaptAppliedReusableSemanticInterpretation', () => {
    const result = adaptReusableSemanticInterpretationRead(
      appliedSummaryPayload()
    );

    expect(result?.templateReference).toBe('template-1');
  });
});

describe('adaptReusableSemanticInterpretationCandidate', () => {
  it('adapts a top-level candidate with no current application', () => {
    const result = adaptReusableSemanticInterpretationCandidate(
      candidatePayload()
    );

    expect(result.templateReference).toBe('template-1');
    expect(result.approvalRevision).toBe('2026-08-14T10:00:00.000Z');
    expect(result.currentApplication).toBeNull();
  });

  it('adapts currentApplication when present, independently of the top-level signals (frozen source UX)', () => {
    const result = adaptReusableSemanticInterpretationCandidate(
      candidatePayload({
        destinationCompatibility: 'modified',
        changedFields: ['title'],
        currentApplication: appliedSummaryPayload({
          destinationCompatibility: 'compatible',
          changedFields: []
        })
      })
    );

    expect(result.destinationCompatibility).toBe('modified');
    expect(result.currentApplication?.destinationCompatibility).toBe(
      'compatible'
    );
  });

  it('never exposes approvalRevision as anything other than an opaque string field (never parsed/interpreted)', () => {
    const result = adaptReusableSemanticInterpretationCandidate(
      candidatePayload({ approvalRevision: '2026-08-15T00:00:00.000Z' })
    );

    expect(typeof result.approvalRevision).toBe('string');
  });

  it('rejects a payload missing approvalRevision', () => {
    const payload = candidatePayload();
    delete (payload as Record<string, unknown>).approvalRevision;

    expect(() => adaptReusableSemanticInterpretationCandidate(payload)).toThrow(
      IncompatiblePayloadError
    );
  });
});

describe('adaptApplyReusableSemanticInterpretationResult', () => {
  it('adapts a first-apply result', () => {
    const result = adaptApplyReusableSemanticInterpretationResult({
      changed: true,
      supersededPreviousApplication: false,
      application: appliedSummaryPayload()
    });

    expect(result.changed).toBe(true);
    expect(result.supersededPreviousApplication).toBe(false);
    expect(result.application.templateReference).toBe('template-1');
  });

  it('adapts an idempotent result (changed: false)', () => {
    const result = adaptApplyReusableSemanticInterpretationResult({
      changed: false,
      supersededPreviousApplication: false,
      application: appliedSummaryPayload()
    });

    expect(result.changed).toBe(false);
  });

  it('adapts a supersede result', () => {
    const result = adaptApplyReusableSemanticInterpretationResult({
      changed: true,
      supersededPreviousApplication: true,
      application: appliedSummaryPayload()
    });

    expect(result.supersededPreviousApplication).toBe(true);
  });

  it('rejects a payload missing changed/supersededPreviousApplication', () => {
    expect(() =>
      adaptApplyReusableSemanticInterpretationResult({
        application: appliedSummaryPayload()
      })
    ).toThrow(IncompatiblePayloadError);
  });
});
