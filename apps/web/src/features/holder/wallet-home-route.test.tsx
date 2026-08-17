import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WalletHomeView, type HolderCredentialsLoadState, type HolderProfileLoadState } from '@/features/holder/wallet-home-route';
import type { HolderProfileVM } from '@/models/holder';

// P1.1: ProfileRebuildAction (montado solo cuando showProfileShare +
// onProfileRebuilt) usa useSession() y rebuildMyProfileRequest -- se
// mockean ambos para poder ejercitar el boton "Actualizar perfil" sin un
// SessionProvider real ni un fetch real.
vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => ({ requestAuthenticated: vi.fn() })
}));

const holderApiMocks = vi.hoisted(() => ({
  rebuildMyProfileRequest: vi.fn()
}));

vi.mock('@/lib/api/holder-api', () => ({
  rebuildMyProfileRequest: holderApiMocks.rebuildMyProfileRequest
}));

const credential = {
  credentialReference: 'credential-reference', title: 'Arquitectura de software', type: 'course' as const, typeLabel: 'Curso',
  status: 'issued' as const, statusLabel: 'Emitida', issuerName: 'Institución demo',
  issuedAtLabel: '1 ago 2026', hasIntegrityEvidence: true, hasAnalysis: true
};
const profile = {
  profileVersion: 'formative_profile_result_v0', credentialsCount: 1, totalOfficialHoursLabel: '64 horas',
  hoursCoverageNoticeLabel: null, semanticCoverageNoticeLabel: null, reviewedInterpretationNoticeLabel: null,
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

  it('C2c: separates the area label from its AI hours estimate, never presenting it as official hours', () => {
    render(<WalletHomeView profileState={{ status: 'ready', profile }} credentialsState={credentialsReady} />);
    expect(screen.getByText('Software')).toBeTruthy();
    expect(screen.getByText('64 horas estimadas por IA')).toBeTruthy();
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

  // C5b.2-R -- seccion 11 del diseno: la procedencia debe poder
  // comprenderse SIN hover/tooltip. Los tests verifican TEXTO VISIBLE
  // persistente en el DOM (nunca solo title/aria-label), acompañado de la
  // leyenda que define "Emisor"/"IA" de forma inequivoca.
  it('C5b.2-R (A): reviewed-only shows visible "Emisor" text plus a visible legend defining it, without relying on hover', () => {
    const profileReviewedOnly = {
      ...profile,
      areas: [{ label: 'Software', estimatedHoursLabel: '64 horas estimadas por IA', provenance: { issuerReviewedLabel: 'Revisado por el emisor', aiInferredLabel: null } }]
    };
    render(<WalletHomeView profileState={{ status: 'ready', profile: profileReviewedOnly }} credentialsState={credentialsReady} />);
    // Texto visible dentro del indicador (no title/aria-label): confirmado
    // buscando el nodo de texto real en el DOM, no un atributo.
    expect(screen.getByText('Emisor', { selector: 'span' })).toBeTruthy();
    expect(screen.queryByText('IA', { selector: 'span' })).toBeNull();
    // Leyenda visible y persistente que define "Emisor" sin ambiguedad.
    expect(screen.getByText(/interpretación revisada por el emisor/)).toBeTruthy();
  });

  it('C5b.2-R (B): AI-only shows visible "IA" text plus a visible legend defining it, without relying on hover', () => {
    const profileAiOnly = {
      ...profile,
      skills: [{ label: 'Diseño', confidenceLabel: '80% de confianza', provenance: { issuerReviewedLabel: null, aiInferredLabel: 'Interpretado con IA' } }]
    };
    render(<WalletHomeView profileState={{ status: 'ready', profile: profileAiOnly }} credentialsState={credentialsReady} />);
    expect(screen.getByText('IA', { selector: 'span' })).toBeTruthy();
    expect(screen.queryByText('Emisor', { selector: 'span' })).toBeNull();
    expect(screen.getByText(/interpretación realizada con inteligencia artificial/)).toBeTruthy();
  });

  it('C5b.2-R (C): mixed shows both "Emisor" and "IA" visible for the same item, without one hiding the other', () => {
    const profileMixed = {
      ...profile,
      areas: [{ label: 'Software', estimatedHoursLabel: '64 horas estimadas por IA', provenance: { issuerReviewedLabel: 'Revisado por el emisor', aiInferredLabel: 'Interpretado con IA' } }]
    };
    render(<WalletHomeView profileState={{ status: 'ready', profile: profileMixed }} credentialsState={credentialsReady} />);
    expect(screen.getByText('Emisor', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText('IA', { selector: 'span' })).toBeTruthy();
  });

  it('C5b.2-R (D): a long skills list keeps the compact badge structure -- no per-item card, no new heading per skill', () => {
    const manySkills = Array.from({ length: 20 }, (_, index) => ({
      label: `Habilidad ${index}`,
      confidenceLabel: null,
      provenance: index % 2 === 0 ? { issuerReviewedLabel: 'Revisado por el emisor', aiInferredLabel: null } : { issuerReviewedLabel: null, aiInferredLabel: 'Interpretado con IA' }
    }));
    const profileManySkills = { ...profile, skills: manySkills };
    render(<WalletHomeView profileState={{ status: 'ready', profile: profileManySkills }} credentialsState={credentialsReady} />);
    // Una sola tarjeta/heading para toda la lista, no una por skill.
    expect(screen.getAllByRole('heading', { level: 2, name: 'Habilidades del perfil' })).toHaveLength(1);
    expect(screen.getAllByText('Habilidad 0', { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Emisor', { selector: 'span' }).length).toBe(10);
    expect(screen.getAllByText('IA', { selector: 'span' }).length).toBe(10);
  });

  it('C5b.2-R (E): a legacy profile without provenance data shows no indicator and no legend', () => {
    render(<WalletHomeView profileState={{ status: 'ready', profile }} credentialsState={credentialsReady} />);
    expect(screen.queryByText('Emisor', { selector: 'span' })).toBeNull();
    expect(screen.queryByText('IA', { selector: 'span' })).toBeNull();
    expect(screen.queryByText(/interpretación revisada por el emisor/)).toBeNull();
    expect(screen.queryByText(/interpretación realizada con inteligencia artificial/)).toBeNull();
  });

  it('C5b.2-R (F): never renders technical provenance enums or the word "verificado" for this semantics', () => {
    const profileMixed = {
      ...profile,
      areas: [{ label: 'Software', estimatedHoursLabel: '64 horas estimadas por IA', provenance: { issuerReviewedLabel: 'Revisado por el emisor', aiInferredLabel: 'Interpretado con IA' } }],
      reviewedInterpretationNoticeLabel: '1 credencial cuenta con una interpretación revisada por el emisor.'
    };
    render(<WalletHomeView profileState={{ status: 'ready', profile: profileMixed }} credentialsState={credentialsReady} />);
    expect(document.body.textContent).not.toMatch(/issuer_reviewed|ai_inferred|provenanceSummary|SemanticAnalysis|snapshot/i);
    expect(document.body.textContent).not.toMatch(/habilidad verificada|competencia certificada|nivel verificado/i);
  });

  it('C5b.2: shows the optional global reviewed-interpretation notice when present', () => {
    const profileWithNotice = { ...profile, reviewedInterpretationNoticeLabel: '3 credenciales cuentan con una interpretación revisada por el emisor.' };
    render(<WalletHomeView profileState={{ status: 'ready', profile: profileWithNotice }} credentialsState={credentialsReady} />);
    expect(screen.getByText('3 credenciales cuentan con una interpretación revisada por el emisor.')).toBeTruthy();
  });

  it('C5b.2: hides the global reviewed-interpretation notice when absent (legacy profile)', () => {
    render(<WalletHomeView profileState={{ status: 'ready', profile }} credentialsState={credentialsReady} />);
    expect(screen.queryByText(/interpretación revisada por el emisor/)).toBeNull();
  });
});

// ─── P1.1: manual rebuild fallback ───────────────────────────────────────────

describe('WalletHomeView -- P1.1 manual rebuild fallback', () => {
  beforeEach(() => {
    holderApiMocks.rebuildMyProfileRequest.mockReset();
  });

  const noCredentials: HolderCredentialsLoadState = { status: 'ready', credentials: [] };

  // A
  it('A: shows "Actualizar perfil" next to the share action when a current profile is visible, and clicking it calls the endpoint', async () => {
    holderApiMocks.rebuildMyProfileRequest.mockResolvedValue(profile);
    render(
      <WalletHomeView
        profileState={{ status: 'ready', profile }}
        credentialsState={credentialsReady}
        showProfileShare
        onProfileRebuilt={() => {}}
      />
    );

    const button = screen.getByRole('button', { name: 'Actualizar perfil' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(holderApiMocks.rebuildMyProfileRequest).toHaveBeenCalledTimes(1);
    });
  });

  // B
  it('B: shows the recovery action inside the empty state when the profile is null but the holder has issued credentials', () => {
    render(
      <WalletHomeView
        profileState={{ status: 'empty' }}
        credentialsState={credentialsReady}
        showProfileShare
        onProfileRebuilt={() => {}}
      />
    );

    expect(screen.getByText('Tu perfil todavía no está disponible')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Actualizar perfil' })).toBeTruthy();
  });

  // C
  it('C: never shows the recovery action when the holder has zero credentials -- the plain empty state is enough', () => {
    render(
      <WalletHomeView
        profileState={{ status: 'empty' }}
        credentialsState={noCredentials}
        showProfileShare
        onProfileRebuilt={() => {}}
      />
    );

    expect(screen.getByText('Tu perfil todavía no está disponible')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Actualizar perfil' })).toBeNull();
  });

  it('never shows the recovery action without showProfileShare (not a self-view context)', () => {
    render(
      <WalletHomeView
        profileState={{ status: 'empty' }}
        credentialsState={credentialsReady}
        onProfileRebuilt={() => {}}
      />
    );

    expect(screen.queryByRole('button', { name: 'Actualizar perfil' })).toBeNull();
  });

  // D
  it('D: disables the button while the request is in flight, preventing a double click', async () => {
    let resolveRequest: (value: typeof profile) => void = () => {};
    holderApiMocks.rebuildMyProfileRequest.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );
    render(
      <WalletHomeView
        profileState={{ status: 'ready', profile }}
        credentialsState={credentialsReady}
        showProfileShare
        onProfileRebuilt={() => {}}
      />
    );

    const button = screen.getByRole('button', { name: 'Actualizar perfil' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Actualizando…' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizando…' }));
    expect(holderApiMocks.rebuildMyProfileRequest).toHaveBeenCalledTimes(1);

    resolveRequest(profile);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Actualizar perfil' })).toBeTruthy();
    });
  });

  // E
  it('E: reflects the rebuilt profile in the UI without a manual reload, via the onProfileRebuilt callback', async () => {
    const updatedProfile = { ...profile, credentialsCount: 3 };
    holderApiMocks.rebuildMyProfileRequest.mockResolvedValue(updatedProfile);

    function Harness() {
      const [state, setState] = useState<HolderProfileLoadState>({ status: 'empty' });
      return (
        <WalletHomeView
          profileState={state}
          credentialsState={credentialsReady}
          showProfileShare
          onProfileRebuilt={(rebuilt: HolderProfileVM | null) => {
            setState(rebuilt ? { status: 'ready', profile: rebuilt } : { status: 'empty' });
          }}
        />
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar perfil' }));

    await waitFor(() => {
      // credentialsCount pasa de ausente (empty) a 3 (updatedProfile) sin
      // que el usuario haya recargado la pagina.
      expect(screen.getByText(/3 credenciales y 64 horas\./)).toBeTruthy();
    });
  });

  // F
  it('F: shows a recoverable error and keeps the previously visible profile when the manual rebuild fails', async () => {
    holderApiMocks.rebuildMyProfileRequest.mockRejectedValue(new Error('network down'));
    render(
      <WalletHomeView
        profileState={{ status: 'ready', profile }}
        credentialsState={credentialsReady}
        showProfileShare
        onProfileRebuilt={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Actualizar perfil' }));

    await waitFor(() => {
      expect(screen.getByText('No pudimos actualizar tu perfil')).toBeTruthy();
    });
    // El perfil ya visible nunca desaparece por un fallo del rebuild manual.
    expect(screen.getByText(profile.narrative)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Actualizar perfil' })).toBeTruthy();
  });

  // G
  it('G: the share action keeps working unaffected by the new rebuild action sitting next to it', () => {
    render(
      <WalletHomeView
        profileState={{ status: 'ready', profile }}
        credentialsState={credentialsReady}
        showProfileShare
        onProfileRebuilt={() => {}}
      />
    );

    expect(screen.getByRole('button', { name: 'Compartir perfil' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Actualizar perfil' })).toBeTruthy();
  });
});
