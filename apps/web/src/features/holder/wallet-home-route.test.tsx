import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WalletHomeView, type HolderCredentialsLoadState, type HolderProfileLoadState } from '@/features/holder/wallet-home-route';

const credential = {
  credentialReference: 'credential-reference', title: 'Arquitectura de software', typeLabel: 'Curso',
  status: 'issued' as const, statusLabel: 'Emitida', issuerName: 'Institución demo',
  issuedAtLabel: '1 ago 2026', hasIntegrityEvidence: true, hasAnalysis: true
};
const profile = {
  profileVersion: 'formative_profile_result_v0', credentialsCount: 1, totalHoursLabel: '64 horas',
  areas: [{ label: 'Software', estimatedHoursLabel: '64 horas estimadas' }],
  skills: [{ label: 'Diseño', confidenceLabel: '80% de confianza' }], concepts: ['arquitectura'],
  confidenceLabel: '80% de confianza', qualityFlags: ['Información parcial'], generatedAtLabel: '1 ago 2026'
};

const credentialsReady: HolderCredentialsLoadState = { status: 'ready', credentials: [credential] };

describe('WalletHomeView', () => {
  it.each<HolderProfileLoadState>([
    { status: 'loading' },
    { status: 'ready', profile },
    { status: 'empty' },
    { status: 'error', message: 'Error seguro' }
  ])('keeps one stable main heading for profile state %#', (profileState) => {
    render(<WalletHomeView profileState={profileState} credentialsState={credentialsReady} />);
    expect(screen.getAllByRole('heading', { level: 1, name: 'Mi perfil formativo' })).toHaveLength(1);
  });

  it('keeps credentials available when the profile fails without claiming provenance', () => {
    render(<WalletHomeView profileState={{ status: 'error', message: 'Error seguro' }} credentialsState={credentialsReady} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Tus credenciales' })).toBeTruthy();
    expect(screen.getByText('Arquitectura de software')).toBeTruthy();
    expect(screen.queryByText(/estas credenciales son las fuentes/i)).toBeNull();
  });

  it('uses neutral profile skills and human-readable quality flags', () => {
    render(<WalletHomeView profileState={{ status: 'ready', profile }} credentialsState={credentialsReady} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Habilidades del perfil' })).toBeTruthy();
    expect(screen.getByText(/Información parcial/)).toBeTruthy();
    expect(screen.queryByText(/proviene de esta credencial/i)).toBeNull();
  });
});
