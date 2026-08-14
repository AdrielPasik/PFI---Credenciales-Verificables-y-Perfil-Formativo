import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({ getPublicCredentialVerificationRequest: vi.fn() }));
const navigationMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  searchParams: new URLSearchParams()
}));

vi.mock('@/lib/api/public-verification-api', () => apiMocks);
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navigationMocks.replace }),
  useSearchParams: () => navigationMocks.searchParams
}));

import { PublicVerificationRoute } from './public-verification-route';

const issuedVerification = {
  credentialReference: 'credential-1', status: 'issued' as const, statusLabel: 'Emitida', title: 'Curso de gestión', type: 'course' as const, typeLabel: 'Curso', issuerName: 'Institución demo', issuerDid: 'did:example:issuer', holderLabel: 'Titular demo', holderDid: null, issuedAtLabel: '14 ago 2026', revokedAtLabel: null, revocationReason: null, canonicalHashShort: '0xaaaaaaaa…aaaaaa', canonicalizationVersion: 'canon_v1', integrity: { canonicalHashPresent: true, blockchainRecordsCount: 1, latestBlockchainRecord: { networkLabel: 'Entorno técnico/demo', chainId: 31337, txHashShort: '0xbbbbbbbb…bbbbbb', statusLabel: 'Registro técnico disponible', registeredAtLabel: '14 ago 2026' } }, verification: { result: 'valid_issued' as const, summary: 'Resultado seguro.', checkedAtLabel: '14 ago 2026' }
};

describe('PublicVerificationRoute', () => {
  beforeEach(() => {
    apiMocks.getPublicCredentialVerificationRequest.mockReset();
    navigationMocks.replace.mockReset();
    navigationMocks.searchParams = new URLSearchParams();
  });

  it('renders without a session and validates an empty input locally', () => {
    render(<PublicVerificationRoute />);

    fireEvent.click(screen.getByRole('button', { name: 'Verificar credencial' }));

    expect(screen.getByText('Revisá el código o enlace ingresado.')).toBeTruthy();
    expect(apiMocks.getPublicCredentialVerificationRequest).not.toHaveBeenCalled();
    expect(
      (screen.getByRole('link', { name: 'Volver a iniciar sesión' }) as HTMLAnchorElement).getAttribute('href')
    ).toBe('/login');
  });

  it('warns against pasting the canonical hash before any lookup happens', () => {
    render(<PublicVerificationRoute />);

    expect(screen.getByText('Pegá el enlace público o el código compartido desde Traza.')).toBeTruthy();
    expect(
      screen.getByText(/No pegues la huella canónica: esa huella se muestra después como evidencia técnica de integridad\./)
    ).toBeTruthy();
  });

  it('extracts a query/link reference, calls only the public endpoint and renders issued data without private extras', async () => {
    apiMocks.getPublicCredentialVerificationRequest.mockResolvedValue(issuedVerification);
    render(<PublicVerificationRoute />);

    fireEvent.change(screen.getByLabelText('Código o enlace de credencial'), {
      target: { value: 'https://traza.example/verify?credential=credential-1' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verificar credencial' }));

    await waitFor(() => expect(apiMocks.getPublicCredentialVerificationRequest).toHaveBeenCalledWith('credential-1'));
    expect(navigationMocks.replace).toHaveBeenCalledWith('/verify?credential=credential-1');
    expect(await screen.findByRole('heading', { name: 'Credencial emitida' })).toBeTruthy();
    expect(screen.getByText('Titular demo')).toBeTruthy();
    expect(screen.getByText(/No es el código que se comparte para verificar/i)).toBeTruthy();
    expect(screen.getByText('Entorno técnico/demo')).toBeTruthy();
    expect(screen.getByText('Este registro corresponde a un entorno técnico de demostración.')).toBeTruthy();
    expect(screen.getByText('31337')).toBeTruthy();
    expect(
      screen.getByText(/La huella canónica es un identificador criptográfico calculado por Traza/)
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/holder@example|rawData|analysisJson|sourceRefs|evidenceMap|textForEmbedding|storageKey/i);
    expect(document.body.textContent).not.toMatch(/100% verificada|blockchain valida el contenido|IA certifica/i);
  });

  it('explains a testnet registration distinctly from the demo environment', async () => {
    apiMocks.getPublicCredentialVerificationRequest.mockResolvedValue({
      ...issuedVerification,
      integrity: {
        ...issuedVerification.integrity,
        latestBlockchainRecord: {
          ...issuedVerification.integrity.latestBlockchainRecord,
          networkLabel: 'Testnet'
        }
      }
    });
    render(<PublicVerificationRoute />);

    fireEvent.change(screen.getByLabelText('Código o enlace de credencial'), { target: { value: 'credential-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verificar credencial' }));

    expect(await screen.findByText('Testnet')).toBeTruthy();
    expect(screen.getByText('Este registro corresponde a una red de pruebas.')).toBeTruthy();
  });

  it('loads a verifier query parameter and renders the revoked state', async () => {
    navigationMocks.searchParams = new URLSearchParams('credential=credential-2');
    apiMocks.getPublicCredentialVerificationRequest.mockResolvedValue({
      ...issuedVerification,
      credentialReference: 'credential-2',
      status: 'revoked',
      statusLabel: 'Revocada',
      revokedAtLabel: '15 ago 2026',
      revocationReason: 'Datos actualizados',
      verification: { ...issuedVerification.verification, result: 'revoked', summary: 'Revocada.' }
    });

    render(<PublicVerificationRoute />);

    expect(await screen.findByRole('heading', { name: 'Credencial revocada' })).toBeTruthy();
    expect(screen.getByText('Datos actualizados')).toBeTruthy();
  });

  it('shows the generic not-found message without revealing the lookup reason', async () => {
    apiMocks.getPublicCredentialVerificationRequest.mockRejectedValue(new Error('raw server details'));
    render(<PublicVerificationRoute />);

    fireEvent.change(screen.getByLabelText('Código o enlace de credencial'), { target: { value: 'credential-404' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verificar credencial' }));

    expect(await screen.findByText('No pudimos completar la verificación en este momento. Probá nuevamente.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('raw server details');
  });
});
