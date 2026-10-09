import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IssuerTechnicalIdentityView } from '@/features/issuer-technical-identity/issuer-technical-identity-route';
import { adaptIssuerTechnicalIdentity } from '@/lib/adapters/issuer-technical-identity.adapter';
import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';

function payload(overrides: Record<string, unknown> = {}) {
  return {
    issuerId: 'issuer-1',
    issuerName: 'UADE',
    authorizationStatus: 'authorized',
    allowedCredentialTypes: ['course'],
    administrativelyAuthorized: true,
    configurationReady: true,
    hasCredentialCapabilities: true,
    readyToIssue: true,
    readinessReasons: [],
    technicalIdentity: {
      status: 'active',
      did: 'did:web:scope.example:issuers:issuer-1',
      didDocumentUrl: 'https://scope.example/did/issuers/issuer-1/did.json'
    },
    assertionSigner: {
      address: '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf',
      keyVersion: 1,
      status: 'active'
    },
    anchorSigner: {
      address: '0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF',
      keyVersion: 1,
      status: 'active',
      shared: false
    },
    blockchainTarget: {
      mode: 'mock',
      network: null,
      chainId: null,
      contractAddress: null,
      deploymentId: null
    },
    ...overrides
  };
}

const health = {
  status: 'NOT_APPLICABLE_MOCK',
  reasons: [],
  chainMatched: null,
  contractCodePresent: null,
  latestBlockObserved: null,
  anchorFunded: null,
  network: null,
  chainId: null,
  contractAddress: null,
  latestBlockNumber: null,
  anchorBalanceWei: null,
  checkedAt: '2026-10-09T12:00:00.000Z'
};

describe('configuracion tecnica del emisor', () => {
  it('al cargar hace SOLO el GET; nunca consulta la red sola', async () => {
    const request = vi.fn().mockResolvedValue(payload());
    render(<IssuerTechnicalIdentityView issuerReference="issuer-1" request={request} />);

    await screen.findByText('Configuración técnica');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe('/issuers/issuer-1/technical-identity');
    expect(request.mock.calls.some(([path]) => String(path).includes('network-health'))).toBe(
      false
    );
  });

  it('"Comprobar red" hace UN POST explicito sin body', async () => {
    const request = vi.fn().mockResolvedValueOnce(payload()).mockResolvedValueOnce(health);
    render(<IssuerTechnicalIdentityView issuerReference="issuer-1" request={request} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Comprobar red' }));

    await screen.findByText('No aplica: entorno de simulación');
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]).toEqual([
      '/issuers/issuer-1/technical-identity/network-health',
      { method: 'POST' }
    ]);
  });

  it('mock se rotula como simulacion y no como aceptacion en Base Sepolia', async () => {
    const request = vi.fn().mockResolvedValue(payload());
    render(<IssuerTechnicalIdentityView issuerReference="issuer-1" request={request} />);

    expect(await screen.findByText('Simulación (mock)')).toBeTruthy();
    expect(screen.getByText(/No equivale a la aceptación final en Base Sepolia/)).toBeTruthy();
  });

  it('muestra advertencia de anchor compartido', async () => {
    const request = vi.fn().mockResolvedValue(
      payload({
        anchorSigner: {
          address: '0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF',
          keyVersion: 1,
          status: 'active',
          shared: true
        }
      })
    );
    render(<IssuerTechnicalIdentityView issuerReference="issuer-1" request={request} />);

    expect(await screen.findByText(/Cuenta de anclaje compartida/)).toBeTruthy();
  });

  it('muestra motivos y tipos de solo lectura; sin controles de clave', async () => {
    const request = vi.fn().mockResolvedValue(
      payload({
        readyToIssue: false,
        hasCredentialCapabilities: false,
        allowedCredentialTypes: [],
        readinessReasons: ['NO_CREDENTIAL_CAPABILITIES']
      })
    );
    const { container } = render(
      <IssuerTechnicalIdentityView issuerReference="issuer-1" request={request} />
    );

    expect(await screen.findByText('NO_CREDENTIAL_CAPABILITIES')).toBeTruthy();
    expect(screen.getByText('Ningún tipo habilitado.')).toBeTruthy();
    expect(container.querySelectorAll('input, textarea, select').length).toBe(0);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Comprobar red']);
  });

  it('403 muestra mensaje de solo-admin', async () => {
    const request = vi.fn().mockRejectedValue(new ApiError('x', 'http', 403));
    render(<IssuerTechnicalIdentityView issuerReference="issuer-1" request={request} />);

    expect(await screen.findByText(/Solo un administrador/)).toBeTruthy();
  });

  it('fallo de red en el diagnostico no rompe la pagina', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(payload())
      .mockRejectedValueOnce(new ApiError('x', 'network'));
    render(<IssuerTechnicalIdentityView issuerReference="issuer-1" request={request} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Comprobar red' }));
    await waitFor(() => expect(screen.getByText('No se pudo comprobar la red.')).toBeTruthy());
    expect(screen.getByText('Configuración técnica')).toBeTruthy();
  });
});

describe('adapter de configuracion tecnica', () => {
  it('es allowlist: campos extra (p. ej. secretRef) no llegan al VM', () => {
    const vm = adaptIssuerTechnicalIdentity(
      payload({ secretRef: '/scope/x', rpcUrl: 'https://rpc' })
    );
    const serialized = JSON.stringify(vm);
    expect(serialized).not.toContain('secretRef');
    expect(serialized).not.toContain('rpcUrl');
  });

  it('rechaza tipos y estados desconocidos', () => {
    expect(() => adaptIssuerTechnicalIdentity(payload({ allowedCredentialTypes: ['X'] }))).toThrow(
      IncompatiblePayloadError
    );
    expect(() => adaptIssuerTechnicalIdentity(payload({ readyToIssue: 'yes' }))).toThrow(
      IncompatiblePayloadError
    );
  });
});

describe('guards estructurales de la superficie web', () => {
  const read = (relative: string) =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
  const files = [
    './issuer-technical-identity-route.tsx',
    '../../lib/api/issuer-technical-identity-api.ts',
    '../../lib/adapters/issuer-technical-identity.adapter.ts',
    '../../models/issuer-technical-identity.ts'
  ];

  it('ninguna mencion de claves privadas, secretos ni mutaciones de identidad', () => {
    for (const file of files) {
      const source = read(file);
      expect(source).not.toMatch(/privateKey|private_key|mnemonic|secretRef/i);
      expect(source).not.toMatch(/method:\s*'(PUT|PATCH|DELETE)'/);
      expect(source).not.toMatch(/\/(provision|rotate|capabilities)\b/);
    }
  });
});
