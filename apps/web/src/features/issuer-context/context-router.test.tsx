import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContextRouter } from '@/features/issuer-context/context-router';
import type { UserOnboardingIntent } from '@/models/auth-session';

const router = vi.hoisted(() => ({ replace: vi.fn() }));
const session = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/session/session-provider', () => ({ useSession: () => session.value }));

const currentUser = { userReference: 'user-reference', email: 'holder@example.com', did: null };
const membership = {
  issuerReference: 'issuer-reference', issuerName: 'Institución demo', issuerDid: null,
  issuerAuthorizationStatus: 'authorized' as const, issuerAuthorizationLabel: 'Autorizada',
  role: 'admin' as const, roleLabel: 'Administrador', status: 'active' as const, operational: true
};

function authenticated(
  issuerContext: unknown,
  onboardingIntent: UserOnboardingIntent | null = null
) {
  session.value = {
    state: {
      status: 'authenticated',
      currentUser: { ...currentUser, onboardingIntent },
      issuerContext
    },
    logout: vi.fn(), retry: vi.fn(), selectIssuer: vi.fn(), clearSelectedIssuer: vi.fn()
  };
}

const noContext = {
  kind: 'none', issuerContexts: [], operationalIssuerContexts: [], selectedIssuer: null
};

describe('ContextRouter', () => {
  beforeEach(() => {
    router.replace.mockClear();
  });

  it('opens the wallet for an authenticated holder with zero operational issuer contexts', async () => {
    authenticated(noContext);
    render(<ContextRouter />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/wallet'));
  });

  it('opens the issuer portal for one operational issuer context', async () => {
    authenticated({ kind: 'single', issuerContexts: [membership], operationalIssuerContexts: [membership], selectedIssuer: membership });
    render(<ContextRouter />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/issuer'));
  });

  it('keeps explicit selection for two operational issuer contexts', () => {
    const second = { ...membership, issuerReference: 'issuer-reference-2', issuerName: 'Institución dos' };
    authenticated({ kind: 'selection-required', issuerContexts: [membership, second], operationalIssuerContexts: [membership, second], selectedIssuer: null });
    render(<ContextRouter />);
    expect(screen.getByRole('heading', { name: 'Elegí la institución con la que vas a operar' })).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalledWith('/issuer');
  });

  // -------------------------------------------------------------------------
  // O1: la intención sólo decide cuando NO hay contexto institucional.
  // -------------------------------------------------------------------------

  it('O1/14: none + institutional opens the institutional pending screen', async () => {
    authenticated(noContext, 'institutional');
    render(<ContextRouter />);
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/institutional-access-pending')
    );
    expect(router.replace).not.toHaveBeenCalledWith('/wallet');
  });

  it('O1/15: none + personal opens the wallet', async () => {
    authenticated(noContext, 'personal');
    render(<ContextRouter />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/wallet'));
    expect(router.replace).not.toHaveBeenCalledWith('/institutional-access-pending');
  });

  it('O1/16: none + null (legacy account) keeps the pre-O1 behaviour and opens the wallet', async () => {
    authenticated(noContext, null);
    render(<ContextRouter />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/wallet'));
    expect(router.replace).not.toHaveBeenCalledWith('/institutional-access-pending');
  });

  // -------------------------------------------------------------------------
  // O1/11-13: la membership operativa SIEMPRE gana sobre la intención.
  // -------------------------------------------------------------------------

  for (const intent of ['personal', 'institutional', null] as const) {
    it(`O1/11: single + intent=${String(intent)} opens the issuer portal`, async () => {
      authenticated(
        { kind: 'single', issuerContexts: [membership], operationalIssuerContexts: [membership], selectedIssuer: membership },
        intent
      );
      render(<ContextRouter />);
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/issuer'));
      expect(router.replace).not.toHaveBeenCalledWith('/institutional-access-pending');
      expect(router.replace).not.toHaveBeenCalledWith('/wallet');
    });

    it(`O1/12: selected + intent=${String(intent)} opens the issuer portal`, async () => {
      authenticated(
        { kind: 'selected', issuerContexts: [membership], operationalIssuerContexts: [membership], selectedIssuer: membership },
        intent
      );
      render(<ContextRouter />);
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/issuer'));
      expect(router.replace).not.toHaveBeenCalledWith('/institutional-access-pending');
    });
  }

  it('O1/13: selection-required + institutional still shows the selector, never the pending screen', () => {
    const second = { ...membership, issuerReference: 'issuer-reference-2', issuerName: 'Institución dos' };
    authenticated(
      { kind: 'selection-required', issuerContexts: [membership, second], operationalIssuerContexts: [membership, second], selectedIssuer: null },
      'institutional'
    );
    render(<ContextRouter />);
    expect(screen.getByRole('heading', { name: 'Elegí la institución con la que vas a operar' })).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalledWith('/institutional-access-pending');
  });
});
