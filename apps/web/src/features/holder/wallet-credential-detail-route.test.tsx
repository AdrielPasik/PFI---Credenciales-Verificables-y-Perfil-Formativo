import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { WalletCredentialDetailView } from '@/features/holder/wallet-credential-detail-route';
import type { HolderCredentialDetailVM } from '@/models/holder';

const detail: HolderCredentialDetailVM = {
  credentialReference: 'credential-reference', title: 'Arquitectura de software', typeLabel: 'Curso',
  status: 'issued', statusLabel: 'Emitida', issuerName: 'Institución demo', issuedAtLabel: '1 ago 2026',
  hasIntegrityEvidence: true, hasAnalysis: true, description: null, hoursLabel: null,
  issuerDid: null, holderLabel: 'Titular demo', holderEmail: 'holder@example.com', holderDid: null,
  revokedAtLabel: null, revocationReason: null,
  subject: { achievementName: null, institutionName: null, completionDate: null, academicPeriod: null, programName: null, grade: null, skills: ['Diseño'], competencies: [], learningOutcomes: [] },
  documentEvidence: null, textEvidence: null,
  integrity: { canonicalHash: null, canonicalHashShort: null, canonicalizationVersion: null, records: [] },
  analysis: { status: 'partial', statusLabel: 'Análisis parcial', confidenceLabel: null, areas: ['Software'], skills: [], concepts: [], qualityFlags: ['Información parcial'], analyzedAtLabel: '1 ago 2026' }
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
