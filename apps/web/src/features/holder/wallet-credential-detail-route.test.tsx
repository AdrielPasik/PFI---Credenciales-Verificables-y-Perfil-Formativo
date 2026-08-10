import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { WalletCredentialDetailView } from '@/features/holder/wallet-credential-detail-route';
import type { HolderCredentialDetailVM } from '@/models/holder';

const detail: HolderCredentialDetailVM = {
  credentialReference: 'credential-reference', title: 'Arquitectura de software', type: 'course', typeLabel: 'Curso',
  status: 'issued', statusLabel: 'Emitida', issuerName: 'Institución demo', issuedAtLabel: '1 ago 2026',
  hasIntegrityEvidence: true, hasAnalysis: true, description: null, hoursLabel: null,
  issuerDid: null, holderLabel: 'Titular demo', holderEmail: 'holder@example.com', holderDid: null,
  revokedAtLabel: null, revocationReason: null,
  subject: {
    achievementName: null, institutionName: null, completionDate: null, academicPeriod: null, programName: null, grade: null,
    providerName: null, platformName: null, modality: null, level: null, externalUrl: null,
    skills: ['Diseño'], competencies: [], learningOutcomes: []
  },
  documentEvidence: null, textEvidence: null,
  integrity: { canonicalHash: null, canonicalHashShort: null, canonicalizationVersion: null, records: [] },
  analysis: { status: 'partial', statusLabel: 'Análisis parcial', confidenceLabel: null, areas: ['Software'], skills: [], concepts: [], qualityFlags: ['Información parcial'], analyzedAtLabel: '1 ago 2026' }
};

const courseDetailWithDeclaredData: HolderCredentialDetailVM = {
  ...detail,
  subject: {
    ...detail.subject,
    providerName: 'Instituto Demo',
    platformName: 'Campus Virtual Demo',
    modality: 'Online asincrónica',
    level: 'Intermedio',
    externalUrl: 'https://plataforma-demo.example.com/curso/123'
  }
};

const academicSubjectDetail: HolderCredentialDetailVM = {
  ...detail,
  type: 'academic_subject',
  typeLabel: 'Asignatura académica'
};

it('orders holder credential information before secondary integrity evidence', () => {
  render(<WalletCredentialDetailView detail={detail} />);
  const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
  expect(headings).toEqual([
    'Identidad de la credencial',
    'Aporte formativo de esta credencial',
    'Fuentes de respaldo',
    'Evidencia de integridad'
  ]);
  expect(screen.getByText('Información emitida por la institución')).toBeTruthy();
  expect(screen.getByText('Interpretación asistida por IA')).toBeTruthy();
  expect(screen.queryByText('credential-reference')).toBeNull();
});

it('shows declared course data separated from the AI interpretation section', () => {
  render(<WalletCredentialDetailView detail={courseDetailWithDeclaredData} />);

  expect(screen.getByText('Información declarada del curso')).toBeTruthy();
  expect(
    screen.getByText('Estos datos fueron declarados por la institución emisora de la credencial.')
  ).toBeTruthy();
  expect(screen.getByText('Instituto Demo')).toBeTruthy();
  expect(screen.getByText('Campus Virtual Demo')).toBeTruthy();
  expect(screen.getByText('Online asincrónica')).toBeTruthy();
  expect(screen.getByText('Intermedio')).toBeTruthy();

  const link = screen.getByRole('link', {
    name: 'https://plataforma-demo.example.com/curso/123'
  }) as HTMLAnchorElement;
  expect(link.target).toBe('_blank');
  expect(link.rel).toContain('noreferrer');
  expect(link.rel).toContain('noopener');
  expect(
    screen.getByText('Enlace declarado por la institución emisora. No implica verificación oficial externa.')
  ).toBeTruthy();

  const declaredHeadingIndex = screen.getAllByText(/Información declarada del curso|Interpretación asistida por IA/)
    .map((node) => node.textContent);
  expect(declaredHeadingIndex).toEqual([
    'Información declarada del curso',
    'Interpretación asistida por IA'
  ]);
  expect(document.body.textContent).not.toMatch(/verificado por|udemy|coursera|aws/i);
});

it('does not show declared course data for academic_subject credentials', () => {
  render(<WalletCredentialDetailView detail={academicSubjectDetail} />);

  expect(screen.queryByText('Información declarada del curso')).toBeNull();
});

it('does not show declared course data for a course credential without declared platform fields', () => {
  render(<WalletCredentialDetailView detail={detail} />);

  expect(screen.queryByText('Información declarada del curso')).toBeNull();
});
