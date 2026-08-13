import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WalletHomeView, type HolderCredentialsLoadState, type HolderProfileLoadState } from '@/features/holder/wallet-home-route';

const credential = {
  credentialReference: 'credential-reference', title: 'Arquitectura de software', type: 'course' as const, typeLabel: 'Curso',
  status: 'issued' as const, statusLabel: 'Emitida', issuerName: 'Institución demo',
  issuedAtLabel: '1 ago 2026', hasIntegrityEvidence: true, hasAnalysis: true
};
const profile = {
  profileVersion: 'formative_profile_result_v0', credentialsCount: 1, totalOfficialHoursLabel: '64 horas',
  hoursCoverageNoticeLabel: null, semanticCoverageNoticeLabel: null,
  narrative: 'Según las credenciales emitidas y los análisis disponibles, la trayectoria muestra formación en Software.',
  areas: [{ label: 'Software', estimatedHoursLabel: '64 horas estimadas por IA' }],
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

  it('shows the prudent formative narrative without claiming mastery or AI certification', () => {
    render(<WalletHomeView profileState={{ status: 'ready', profile }} credentialsState={credentialsReady} />);
    expect(screen.getByText(profile.narrative)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/domina|experto|garantiza|certifica|apto para|nivel profesional/i);
  });

  it('shows the declared-by-institutions section when emitted data is present', () => {
    render(<WalletHomeView profileState={{ status: 'ready', profile: profileWithDeclaredInfo }} credentialsState={credentialsReady} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Información declarada por instituciones' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Habilidades declaradas' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Competencias declaradas' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Contenido adicional declarado' })).toBeTruthy();
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
    expect(screen.queryByRole('heading', { level: 3, name: 'Contenido adicional declarado' })).toBeNull();
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

  it('C2c: labels official hours clearly and never shows the ambiguous "Horas" copy', () => {
    render(<WalletHomeView profileState={{ status: 'ready', profile }} credentialsState={credentialsReady} />);
    expect(screen.getByText(/credenciales y 64 horas\./)).toBeTruthy();
    expect(screen.getByText(/Suma de horas informadas por las credenciales emitidas\. No representa una distribución por área\./)).toBeTruthy();
  });

  it('C2c: labels area hours as an AI estimate, never as official hours', () => {
    render(<WalletHomeView profileState={{ status: 'ready', profile }} credentialsState={credentialsReady} />);
    expect(screen.getByText('Software · 64 horas estimadas por IA')).toBeTruthy();
  });

  it('C2c: never renders "0h" for an area without an AI hours estimate', () => {
    const profileWithUnestimatedArea = { ...profile, areas: [{ label: 'Software', estimatedHoursLabel: null }] };
    render(<WalletHomeView profileState={{ status: 'ready', profile: profileWithUnestimatedArea }} credentialsState={credentialsReady} />);
    expect(screen.getByText('Software')).toBeTruthy();
    expect(screen.queryByText(/0h/)).toBeNull();
  });

  it('C2c: shows a soft notice when credentials lack declared hours or semantic coverage', () => {
    const profileWithGaps = {
      ...profile,
      hoursCoverageNoticeLabel: '1 credencial no informa horas.',
      semanticCoverageNoticeLabel: '2 credenciales todavía no tienen análisis semántico.'
    };
    render(<WalletHomeView profileState={{ status: 'ready', profile: profileWithGaps }} credentialsState={credentialsReady} />);
    expect(screen.getByText('1 credencial no informa horas.')).toBeTruthy();
    expect(screen.getByText('2 credenciales todavía no tienen análisis semántico.')).toBeTruthy();
    expect(screen.getByText('La distribución por áreas se muestra solo cuando existe evidencia suficiente.')).toBeTruthy();
  });

  it('C2c: hides the coverage notice card when both counters are absent', () => {
    render(<WalletHomeView profileState={{ status: 'ready', profile }} credentialsState={credentialsReady} />);
    expect(screen.queryByText('Cobertura del perfil')).toBeNull();
  });

  it('C2c: never claims AI certified competencies or that blockchain validates them', () => {
    render(<WalletHomeView profileState={{ status: 'ready', profile: profileWithDeclaredInfo }} credentialsState={credentialsReady} />);
    expect(screen.queryByText(/la ia certificó/i)).toBeNull();
    expect(screen.queryByText(/blockchain valida/i)).toBeNull();
  });
});
