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
  emittedSkills: [], emittedCompetencies: [], emittedLearningOutcomes: [],
  confidenceLabel: '80% de confianza', qualityFlags: ['Información parcial'], generatedAtLabel: '1 ago 2026'
};
const profileWithDeclaredInfo = {
  ...profile,
  emittedSkills: ['Excel'],
  emittedCompetencies: ['Trabajo en equipo'],
  emittedLearningOutcomes: ['Redactar informes técnicos']
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

  it('shows the declared-by-institutions section when emitted data is present', () => {
    render(<WalletHomeView profileState={{ status: 'ready', profile: profileWithDeclaredInfo }} credentialsState={credentialsReady} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Información declarada por instituciones' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Habilidades declaradas' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Competencias declaradas' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Resultados de aprendizaje declarados' })).toBeTruthy();
    expect(screen.getByText('Excel')).toBeTruthy();
    expect(screen.getByText('Trabajo en equipo')).toBeTruthy();
    expect(screen.getByText('Redactar informes técnicos')).toBeTruthy();
  });

  it('hides the declared-by-institutions section when the three emitted arrays are empty', () => {
    render(<WalletHomeView profileState={{ status: 'ready', profile }} credentialsState={credentialsReady} />);
    expect(screen.queryByRole('heading', { level: 2, name: 'Información declarada por instituciones' })).toBeNull();
  });

  it('shows only the blocks with data inside the declared-by-institutions section', () => {
    const partial = { ...profile, emittedSkills: ['Excel'], emittedCompetencies: [], emittedLearningOutcomes: [] };
    render(<WalletHomeView profileState={{ status: 'ready', profile: partial }} credentialsState={credentialsReady} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Habilidades declaradas' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 3, name: 'Competencias declaradas' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 3, name: 'Resultados de aprendizaje declarados' })).toBeNull();
  });

  it('keeps profile skills and declared-by-institutions skills visually separate', () => {
    render(<WalletHomeView profileState={{ status: 'ready', profile: profileWithDeclaredInfo }} credentialsState={credentialsReady} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Habilidades del perfil' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Habilidades declaradas' })).toBeTruthy();
  });

  it('never implies AI certified or built the profile from emitted institutional data', () => {
    render(<WalletHomeView profileState={{ status: 'ready', profile: profileWithDeclaredInfo }} credentialsState={credentialsReady} />);
    expect(screen.getByText(/No son una certificación de la IA/)).toBeTruthy();
    expect(screen.queryByText(/detectad[ao]s? por (la )?ia/i)).toBeNull();
    expect(screen.queryByText(/certificad[ao]s? por (la )?ia/i)).toBeNull();
    expect(screen.queryByText(/skills? certificad/i)).toBeNull();
    expect(screen.queryByText(/estas credenciales construyeron/i)).toBeNull();
  });

  it.each<HolderProfileLoadState>([
    { status: 'ready', profile: profileWithDeclaredInfo },
    { status: 'ready', profile }
  ])('keeps one stable main heading with the declared-by-institutions section too', (profileState) => {
    render(<WalletHomeView profileState={profileState} credentialsState={credentialsReady} />);
    expect(screen.getAllByRole('heading', { level: 1, name: 'Mi perfil formativo' })).toHaveLength(1);
  });
});
