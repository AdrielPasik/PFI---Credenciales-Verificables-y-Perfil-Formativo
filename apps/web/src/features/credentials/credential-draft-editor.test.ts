import { describe, expect, it } from 'vitest';

import {
  applyCredentialTypeChange,
  buildDraftUpdateCommand,
  credentialDraftFieldsByType,
  detailToDraftEditorState,
  getIncompatiblePopulatedFields,
  linesToStringArray,
  validateDraftEditorState
} from '@/features/credentials/credential-draft-editor';
import type { IssuerCredentialDetailVM } from '@/models/credentials';

function detailFixture(
  overrides: Partial<IssuerCredentialDetailVM> = {}
): IssuerCredentialDetailVM {
  return {
    credentialReference: 'credential-reference',
    title: 'Arquitectura de Software',
    description: 'Descripción vigente',
    hours: '24.00',
    type: 'course',
    typeLabel: 'Curso',
    status: 'draft',
    statusLabel: 'Borrador',
    issuer: {
      displayName: 'Universidad Demo',
      did: null
    },
    credentialSubject: {
      achievementName: 'Arquitectura de Software',
      institutionName: 'Universidad Demo',
      completionDate: '2026-07-20',
      academicPeriod: null,
      programName: null,
      grade: null,
      providerName: 'Instituto Demo',
      platformName: 'Campus Virtual',
      modality: 'Híbrida',
      level: 'Intermedio',
      certificationCode: null,
      expirationDate: null,
      externalUrl: null,
      skills: ['Arquitectura', 'Testing'],
      competencies: ['Diseño'],
      learningOutcomes: ['Documentar decisiones']
    },
    holder: {
      displayLabel: 'Demo Holder',
      email: 'holder@example.com',
      did: null
    },
    createdAt: '2026-07-30T12:00:00.000Z',
    updatedAt: '2026-07-30T13:00:00.000Z',
    ...overrides
  };
}

describe('credential draft editor helpers', () => {
  it('keeps one exact field matrix for every supported type', () => {
    expect(credentialDraftFieldsByType).toEqual({
      academic_subject: [
        'completionDate',
        'academicPeriod',
        'programName',
        'grade',
        'skills',
        'competencies'
      ],
      course: [
        'completionDate',
        'providerName',
        'platformName',
        'modality',
        'level',
        'skills',
        'competencies',
        'learningOutcomes'
      ],
      certification: [
        'completionDate',
        'certificationCode',
        'expirationDate',
        'externalUrl',
        'providerName',
        'level',
        'skills',
        'competencies'
      ],
      degree: [
        'completionDate',
        'programName',
        'level',
        'grade',
        'competencies',
        'learningOutcomes'
      ]
    });
  });

  it('converts arrays to editable lines and back without inventing values', () => {
    const state = detailToDraftEditorState(detailFixture());

    expect(state.skills).toBe('Arquitectura\nTesting');
    expect(linesToStringArray(' Arquitectura \n\n Testing ')).toEqual([
      'Arquitectura',
      'Testing'
    ]);
  });

  it('returns no command when the form has no semantic changes', () => {
    const detail = detailFixture();

    expect(
      buildDraftUpdateCommand({
        detail,
        state: detailToDraftEditorState(detail),
        issuerReference: 'issuer-reference',
        credentialReference: 'credential-reference'
      })
    ).toBeNull();
  });

  it('builds a sparse command with expectedUpdatedAt and changed fields only', () => {
    const detail = detailFixture();
    const state = {
      ...detailToDraftEditorState(detail),
      achievementName: '  Arquitectura Aplicada  ',
      description: '',
      skills: 'Arquitectura\nObservabilidad'
    };

    expect(
      buildDraftUpdateCommand({
        detail,
        state,
        issuerReference: 'issuer-reference',
        credentialReference: 'credential-reference'
      })
    ).toEqual({
      issuerReference: 'issuer-reference',
      credentialReference: 'credential-reference',
      expectedUpdatedAt: '2026-07-30T13:00:00.000Z',
      achievementName: 'Arquitectura Aplicada',
      description: null,
      skills: ['Arquitectura', 'Observabilidad']
    });
  });

  it('uses null for cleared nullable strings and [] for cleared arrays', () => {
    const detail = detailFixture();
    const state = {
      ...detailToDraftEditorState(detail),
      providerName: '   ',
      competencies: ''
    };

    expect(
      buildDraftUpdateCommand({
        detail,
        state,
        issuerReference: 'issuer-reference',
        credentialReference: 'credential-reference'
      })
    ).toMatchObject({
      providerName: null,
      competencies: []
    });
  });

  it('includes changed certification dates in the sparse command', () => {
    const current = detailFixture();
    const detail = detailFixture({
      type: 'certification',
      typeLabel: 'Certificación',
      credentialSubject: {
        ...current.credentialSubject,
        platformName: null,
        modality: null,
        learningOutcomes: []
      }
    });
    const state = {
      ...detailToDraftEditorState(detail),
      completionDate: '2026-07-30',
      expirationDate: '2027-07-30'
    };

    expect(
      buildDraftUpdateCommand({
        detail,
        state,
        issuerReference: 'issuer-reference',
        credentialReference: 'credential-reference'
      })
    ).toMatchObject({
      completionDate: '2026-07-30',
      expirationDate: '2027-07-30'
    });
  });

  it('detects incompatible populated fields before changing type', () => {
    const state = detailToDraftEditorState(detailFixture());

    expect(
      getIncompatiblePopulatedFields(state, 'certification')
    ).toEqual(['platformName', 'modality', 'learningOutcomes']);
  });

  it('clears only incompatible local fields and preserves compatible values', () => {
    const detail = detailFixture();
    const changed = applyCredentialTypeChange(
      detailToDraftEditorState(detail),
      'certification'
    );

    expect(changed).toMatchObject({
      type: 'certification',
      providerName: 'Instituto Demo',
      level: 'Intermedio',
      skills: 'Arquitectura\nTesting',
      competencies: 'Diseño',
      platformName: '',
      modality: '',
      learningOutcomes: ''
    });
  });

  it('sends the new type without hidden incompatible fields', () => {
    const detail = detailFixture();
    const state = applyCredentialTypeChange(
      detailToDraftEditorState(detail),
      'certification'
    );
    const command = buildDraftUpdateCommand({
      detail,
      state,
      issuerReference: 'issuer-reference',
      credentialReference: 'credential-reference'
    });

    expect(command).toEqual({
      issuerReference: 'issuer-reference',
      credentialReference: 'credential-reference',
      expectedUpdatedAt: '2026-07-30T13:00:00.000Z',
      type: 'certification'
    });
    expect(command).not.toHaveProperty('platformName');
    expect(command).not.toHaveProperty('modality');
    expect(command).not.toHaveProperty('learningOutcomes');
  });

  it('never sends a populated field that does not apply to the final type', () => {
    const detail = detailFixture();
    const state = {
      ...detailToDraftEditorState(detail),
      certificationCode: 'SHOULD-NOT-BE-SENT'
    };

    expect(
      buildDraftUpdateCommand({
        detail,
        state,
        issuerReference: 'issuer-reference',
        credentialReference: 'credential-reference'
      })
    ).toBeNull();
  });

  it('validates only the basic client-side formats needed for immediate feedback', () => {
    const state = {
      ...detailToDraftEditorState(detailFixture()),
      achievementName: ' ',
      hours: '-2',
      externalUrl: 'ftp://example.com'
    };

    expect(validateDraftEditorState(state)).toEqual({
      achievementName: 'Ingresá el nombre del logro.',
      hours: 'Ingresá un valor positivo con hasta dos decimales.',
      externalUrl: 'Ingresá una URL HTTP o HTTPS válida.'
    });
  });
});
