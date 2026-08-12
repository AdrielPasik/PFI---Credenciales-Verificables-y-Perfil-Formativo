import { describe, expect, it } from 'vitest';

import {
  adaptCourseTemplateSummary,
  adaptCourseTemplateSummaryList,
  adaptTemplateSemanticApprovalCandidate
} from '@/lib/adapters/course-templates.adapter';
import { IncompatiblePayloadError } from '@/lib/errors/api-error';

function courseTemplatePayload(overrides?: Record<string, unknown>) {
  return {
    id: 'template-1',
    credentialType: 'course',
    title: 'Curso de Python',
    description: 'Introducción a Python',
    hours: '22.00',
    modality: 'Online',
    platformName: 'Plataforma de Cursos Demo',
    externalUrl: 'https://plataforma-demo.example.com/curso/python',
    certificationCode: null,
    expirationDate: null,
    providerName: null,
    level: null,
    skills: [],
    competencies: ['Programación'],
    learningOutcomes: ['Escribir scripts básicos'],
    status: 'active',
    createdFromCredentialId: 'credential-1',
    lastSemanticAnalysisId: 'analysis-1',
    approvedSemanticAnalysisId: null,
    approvedSemanticApprovedAt: null,
    approvedSemanticPipelineVersion: null,
    approvedSemanticTaxonomyVersion: null,
    approvedSemanticSourceCredentialId: null,
    approvedSemanticSnapshotSummary: null,
    createdAt: '2026-08-11T10:00:00.000Z',
    updatedAt: '2026-08-11T10:05:00.000Z',
    ...overrides
  };
}

function semanticApprovalSnapshotSummaryPayload(
  overrides?: Record<string, unknown>
) {
  return {
    schema: 'approved_template_semantic_snapshot_v1',
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

function templateSemanticApprovalCandidatePayload(
  overrides?: Record<string, unknown>
) {
  return {
    semanticAnalysisId: 'analysis-1',
    status: 'completed',
    pipelineVersion: 'pipeline-v1',
    taxonomyVersion: 'taxonomy-v1',
    sourceCredentialId: 'credential-1',
    summary: semanticApprovalSnapshotSummaryPayload(),
    ...overrides
  };
}

describe('adaptCourseTemplateSummary', () => {
  it('adapts a course template response', () => {
    const result = adaptCourseTemplateSummary(courseTemplatePayload());

    expect(result).toEqual({
      reference: 'template-1',
      credentialType: 'course',
      title: 'Curso de Python',
      description: 'Introducción a Python',
      hours: '22.00',
      modality: 'Online',
      platformName: 'Plataforma de Cursos Demo',
      externalUrl: 'https://plataforma-demo.example.com/curso/python',
      certificationCode: null,
      expirationDate: null,
      providerName: null,
      level: null,
      skills: [],
      competencies: ['Programación'],
      learningOutcomes: ['Escribir scripts básicos'],
      status: 'active',
      createdFromCredentialId: 'credential-1',
      lastSemanticAnalysisId: 'analysis-1',
      approvedSemanticAnalysisId: null,
      approvedSemanticApprovedAt: null,
      approvedSemanticPipelineVersion: null,
      approvedSemanticTaxonomyVersion: null,
      approvedSemanticSourceCredentialId: null,
      approvedSemanticSnapshotSummary: null,
      createdAt: '2026-08-11T10:00:00.000Z',
      updatedAt: '2026-08-11T10:05:00.000Z'
    });
  });

  it('adapts a certification template response with its own fields', () => {
    const result = adaptCourseTemplateSummary(
      courseTemplatePayload({
        credentialType: 'certification',
        title: 'Certificación AWS Cloud Practitioner',
        modality: null,
        platformName: null,
        certificationCode: 'AWS-CCP',
        expirationDate: '2027-01-01',
        providerName: 'Instituto Demo',
        level: 'Fundamentos',
        skills: ['Cloud'],
        learningOutcomes: []
      })
    );

    expect(result.credentialType).toBe('certification');
    expect(result.certificationCode).toBe('AWS-CCP');
    expect(result.expirationDate).toBe('2027-01-01');
    expect(result.providerName).toBe('Instituto Demo');
    expect(result.level).toBe('Fundamentos');
    expect(result.skills).toEqual(['Cloud']);
  });

  it('tolerates optional nulls', () => {
    const result = adaptCourseTemplateSummary(
      courseTemplatePayload({
        description: null,
        hours: null,
        modality: null,
        platformName: null,
        externalUrl: null,
        createdFromCredentialId: null,
        lastSemanticAnalysisId: null
      })
    );

    expect(result.description).toBeNull();
    expect(result.hours).toBeNull();
    expect(result.modality).toBeNull();
    expect(result.platformName).toBeNull();
    expect(result.externalUrl).toBeNull();
    expect(result.createdFromCredentialId).toBeNull();
    expect(result.lastSemanticAnalysisId).toBeNull();
  });

  it('never exposes issuerId or createdByUserId even if present in the payload', () => {
    const result = adaptCourseTemplateSummary(
      courseTemplatePayload({
        issuerId: 'must-not-leak',
        createdByUserId: 'must-not-leak'
      })
    );

    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('rejects an incompatible payload', () => {
    expect(() => adaptCourseTemplateSummary(null)).toThrow(
      IncompatiblePayloadError
    );
    expect(() => adaptCourseTemplateSummary({})).toThrow(
      IncompatiblePayloadError
    );
    expect(() =>
      adaptCourseTemplateSummary(
        courseTemplatePayload({ credentialType: 'academic_subject' })
      )
    ).toThrow(IncompatiblePayloadError);
    expect(() =>
      adaptCourseTemplateSummary(courseTemplatePayload({ status: 'deleted' }))
    ).toThrow(IncompatiblePayloadError);
    expect(() =>
      adaptCourseTemplateSummary(
        courseTemplatePayload({ competencies: 'not-an-array' })
      )
    ).toThrow(IncompatiblePayloadError);
  });

  // C4a.1: campos aditivos de aprobacion semantica.
  it('maps approvedSemanticSnapshotSummary when the template was already approved', () => {
    const result = adaptCourseTemplateSummary(
      courseTemplatePayload({
        approvedSemanticAnalysisId: 'analysis-1',
        approvedSemanticApprovedAt: '2026-08-12T09:00:00.000Z',
        approvedSemanticPipelineVersion: 'pipeline-v1',
        approvedSemanticTaxonomyVersion: 'taxonomy-v1',
        approvedSemanticSourceCredentialId: 'credential-1',
        approvedSemanticSnapshotSummary: semanticApprovalSnapshotSummaryPayload()
      })
    );

    expect(result.approvedSemanticAnalysisId).toBe('analysis-1');
    expect(result.approvedSemanticApprovedAt).toBe('2026-08-12T09:00:00.000Z');
    expect(result.approvedSemanticPipelineVersion).toBe('pipeline-v1');
    expect(result.approvedSemanticTaxonomyVersion).toBe('taxonomy-v1');
    expect(result.approvedSemanticSourceCredentialId).toBe('credential-1');
    expect(result.approvedSemanticSnapshotSummary).toEqual(
      semanticApprovalSnapshotSummaryPayload()
    );
  });

  it('rejects an incompatible approvedSemanticSnapshotSummary instead of showing partial data', () => {
    expect(() =>
      adaptCourseTemplateSummary(
        courseTemplatePayload({
          approvedSemanticSnapshotSummary: { schema: 'x' }
        })
      )
    ).toThrow(IncompatiblePayloadError);
    expect(() =>
      adaptCourseTemplateSummary(
        courseTemplatePayload({
          approvedSemanticSnapshotSummary: semanticApprovalSnapshotSummaryPayload(
            { areaCount: -1 }
          )
        })
      )
    ).toThrow(IncompatiblePayloadError);
    expect(() =>
      adaptCourseTemplateSummary(
        courseTemplatePayload({
          approvedSemanticSnapshotSummary: semanticApprovalSnapshotSummaryPayload(
            { hasHoursDistribution: 'yes' }
          )
        })
      )
    ).toThrow(IncompatiblePayloadError);
  });

  it('never exposes a full snapshot even if the backend accidentally included one', () => {
    const result = adaptCourseTemplateSummary(
      courseTemplatePayload({
        approvedSemanticSnapshotSummary: semanticApprovalSnapshotSummaryPayload()
      })
    );

    expect(JSON.stringify(result)).not.toContain('analysisJson');
    expect(JSON.stringify(result)).not.toContain('sourceRefs');
    expect(JSON.stringify(result)).not.toContain('evidenceMap');
  });
});

describe('adaptCourseTemplateSummaryList', () => {
  it('adapts each item in the array', () => {
    const result = adaptCourseTemplateSummaryList([
      courseTemplatePayload({ id: 't-1' }),
      courseTemplatePayload({ id: 't-2', credentialType: 'certification' })
    ]);

    expect(result.map((item) => item.reference)).toEqual(['t-1', 't-2']);
    expect(result[1].credentialType).toBe('certification');
  });

  it('handles an empty array', () => {
    expect(adaptCourseTemplateSummaryList([])).toEqual([]);
  });

  it('rejects a non-array payload', () => {
    expect(() => adaptCourseTemplateSummaryList({ items: [] })).toThrow(
      IncompatiblePayloadError
    );
    expect(() => adaptCourseTemplateSummaryList(null)).toThrow(
      IncompatiblePayloadError
    );
  });
});

// C4a.2: candidate summary, ANTES de aprobar.
describe('adaptTemplateSemanticApprovalCandidate', () => {
  it('adapts a completed candidate response', () => {
    const result = adaptTemplateSemanticApprovalCandidate(
      templateSemanticApprovalCandidatePayload()
    );

    expect(result).toEqual({
      semanticAnalysisReference: 'analysis-1',
      status: 'completed',
      pipelineVersion: 'pipeline-v1',
      taxonomyVersion: 'taxonomy-v1',
      sourceCredentialReference: 'credential-1',
      summary: semanticApprovalSnapshotSummaryPayload()
    });
  });

  it('adapts a partial candidate response', () => {
    const result = adaptTemplateSemanticApprovalCandidate(
      templateSemanticApprovalCandidatePayload({
        status: 'partial',
        summary: semanticApprovalSnapshotSummaryPayload({ status: 'partial' })
      })
    );

    expect(result.status).toBe('partial');
    expect(result.summary.status).toBe('partial');
  });

  it('rejects an incompatible payload', () => {
    expect(() => adaptTemplateSemanticApprovalCandidate(null)).toThrow(
      IncompatiblePayloadError
    );
    expect(() => adaptTemplateSemanticApprovalCandidate({})).toThrow(
      IncompatiblePayloadError
    );
    expect(() =>
      adaptTemplateSemanticApprovalCandidate(
        templateSemanticApprovalCandidatePayload({ status: 'failed' })
      )
    ).toThrow(IncompatiblePayloadError);
  });

  it('rejects an incompatible summary instead of showing partial data', () => {
    expect(() =>
      adaptTemplateSemanticApprovalCandidate(
        templateSemanticApprovalCandidatePayload({ summary: { schema: 'x' } })
      )
    ).toThrow(IncompatiblePayloadError);
    expect(() =>
      adaptTemplateSemanticApprovalCandidate(
        templateSemanticApprovalCandidatePayload({
          summary: semanticApprovalSnapshotSummaryPayload({
            warningCount: 'zero'
          })
        })
      )
    ).toThrow(IncompatiblePayloadError);
  });

  it('never exposes a full snapshot, analysisJson or evidence keys', () => {
    const result = adaptTemplateSemanticApprovalCandidate(
      templateSemanticApprovalCandidatePayload()
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('analysisJson');
    expect(serialized).not.toContain('sourceRefs');
    expect(serialized).not.toContain('evidenceMap');
    expect(serialized).not.toContain('textForEmbedding');
  });
});
