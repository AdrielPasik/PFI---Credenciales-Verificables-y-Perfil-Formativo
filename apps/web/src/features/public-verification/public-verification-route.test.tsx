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
  credentialReference: 'credential-1', status: 'issued' as const, statusLabel: 'Emitida', title: 'Curso de gestión', type: 'course' as const, typeLabel: 'Curso', issuerName: 'Institución demo', issuerDid: 'did:example:issuer', holderLabel: 'Titular demo', holderDid: null, issuedAtLabel: '14 ago 2026', revokedAtLabel: null, revocationReason: null, canonicalHash: null, canonicalHashShort: '0xaaaaaaaa…aaaaaa', canonicalizationVersion: 'canon_v1', proof: null, integrity: { canonicalHashPresent: true, blockchainRecordsCount: 1, latestBlockchainRecord: { network: 'anvil' as const, networkLabel: 'Entorno técnico/demo', chainId: 31337, evidenceMode: 'mock' as const, txHash: null, txHashShort: '0xbbbbbbbb…bbbbbb', statusLabel: 'Registro técnico disponible', registeredAtLabel: '14 ago 2026', revokedAtLabel: null, contractAddress: null, deploymentId: null, blockNumber: null, registrantAddress: null } }, verification: { result: 'valid_issued' as const, summary: 'Resultado seguro.', checkedAtLabel: '14 ago 2026', headline: 'VERIFIED_WITH_LIMITED_EVIDENCE' as const, authenticity: { result: 'VERIFIED' as const, reason: 'PROOF_VERIFIED' }, blockchainEvidence: { result: 'NOT_APPLICABLE_MOCK' as const, reason: 'MOCK_EVIDENCE_RECORD' } }
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

  it('explains that the public reference, not the canonical hash, starts a lookup', () => {
    render(<PublicVerificationRoute />);

    expect(screen.getByText('Consultá el estado y la evidencia disponible de una credencial emitida en Scope.')).toBeTruthy();
    expect(
      screen.getByText(/La huella canónica se muestra después como evidencia técnica de integridad\./)
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
    // S8: con evidencia MOCK el veredicto NO es "verificada" a secas.
    expect(await screen.findByRole('heading', { name: 'Autoría verificada, con evidencia de red limitada' })).toBeTruthy();
    expect(screen.getByText('Titular demo')).toBeTruthy();
    expect(screen.getByText(/No es el código que se comparte para verificar/i)).toBeTruthy();
    expect(screen.getByText('Entorno técnico/demo')).toBeTruthy();
    expect(screen.getByText('Este registro corresponde a un entorno técnico de demostración.')).toBeTruthy();
    expect(screen.getByText('31337')).toBeTruthy();
    expect(
      screen.getByText(/La huella canónica es un identificador criptográfico calculado por Scope/)
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
      verification: { ...issuedVerification.verification, result: 'revoked', summary: 'Revocada.', headline: 'REVOKED' as const }
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

  // -------------------------------------------------------------------------
  // Regreso contextual al analisis publico
  // -------------------------------------------------------------------------

  describe('regreso al análisis', () => {
    const analysisPath = `/share/profile/${'s'.repeat(43)}/analysis`;

    it('abierta desde un análisis ofrece "Volver al análisis" hacia esa misma ruta', async () => {
      apiMocks.getPublicCredentialVerificationRequest.mockResolvedValue(issuedVerification);
      navigationMocks.searchParams = new URLSearchParams({ credential: 'credential-1', returnTo: analysisPath });
      render(<PublicVerificationRoute />);

      const back = screen.getByRole('link', { name: 'Volver al análisis' }) as HTMLAnchorElement;
      expect(back.getAttribute('href')).toBe(analysisPath);
      expect(screen.queryByRole('link', { name: 'Volver a iniciar sesión' })).toBeNull();
      await screen.findByRole('heading', { name: 'Autoría verificada, con evidencia de red limitada' });
    });

    it('verificar otra credencial desde ahí conserva el regreso validado', async () => {
      apiMocks.getPublicCredentialVerificationRequest.mockResolvedValue(issuedVerification);
      navigationMocks.searchParams = new URLSearchParams({ returnTo: analysisPath });
      render(<PublicVerificationRoute />);

      fireEvent.change(screen.getByLabelText('Código o enlace de credencial'), { target: { value: 'credential-2' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verificar credencial' }));

      const replaced = new URL(navigationMocks.replace.mock.calls[0][0], 'https://scope.example');
      expect(replaced.searchParams.get('credential')).toBe('credential-2');
      expect(replaced.searchParams.get('returnTo')).toBe(analysisPath);
    });

    it('una visita directa NO muestra un "Volver al análisis" falso', () => {
      navigationMocks.searchParams = new URLSearchParams({ credential: 'credential-1' });
      apiMocks.getPublicCredentialVerificationRequest.mockResolvedValue(issuedVerification);
      render(<PublicVerificationRoute />);

      expect(screen.queryByRole('link', { name: 'Volver al análisis' })).toBeNull();
      expect(
        (screen.getByRole('link', { name: 'Volver a iniciar sesión' }) as HTMLAnchorElement).getAttribute('href')
      ).toBe('/login');
    });

    it.each([
      ['absoluta externa', 'https://evil.example/share/profile/x/analysis'],
      ['protocol-relative', `//evil.example${analysisPath}`],
      ['malformada', '/share/profile/<x>/analysis'],
      ['ruta interna inesperada', '/wallet']
    ])('un returnTo %s se ignora: no hay regreso ni redirect', (_caso, value) => {
      navigationMocks.searchParams = new URLSearchParams({ returnTo: value });
      render(<PublicVerificationRoute />);

      expect(screen.queryByRole('link', { name: 'Volver al análisis' })).toBeNull();
      expect(document.body.innerHTML).not.toContain('evil.example');
      expect(
        (screen.getByRole('link', { name: 'Volver a iniciar sesión' }) as HTMLAnchorElement).getAttribute('href')
      ).toBe('/login');
    });
  });

  it('la superficie pública no nombra a Traza', async () => {
    apiMocks.getPublicCredentialVerificationRequest.mockResolvedValue({
      ...issuedVerification,
      verification: {
        ...issuedVerification.verification,
        summary: 'La credencial está emitida y conserva una huella de integridad registrada por Scope.'
      }
    });
    navigationMocks.searchParams = new URLSearchParams({ credential: 'credential-1' });
    render(<PublicVerificationRoute />);

    expect(await screen.findByText(/huella de integridad registrada por Scope/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('Traza');
  });
});
