import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContextRouter } from '@/features/issuer-context/context-router';

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

function authenticated(issuerContext: unknown) {
  session.value = { state: { status: 'authenticated', currentUser, issuerContext }, logout: vi.fn(), retry: vi.fn(), selectIssuer: vi.fn(), clearSelectedIssuer: vi.fn() };
}

describe('ContextRouter', () => {
  beforeEach(() => {
    router.replace.mockClear();
  });

  it('opens the wallet for an authenticated holder with zero operational issuer contexts', async () => {
    authenticated({ kind: 'none', issuerContexts: [], operationalIssuerContexts: [], selectedIssuer: null });
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
});
