import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams()
}));

import type {
  PublicAuthenticityResult,
  PublicBlockchainEvidenceResult,
  PublicCredentialVerificationVM,
  PublicVerificationHeadline
} from '@/models/public-verification';
import { PublicVerificationResult } from './public-verification-route';

const TX = `0x${'ab'.repeat(32)}`;
const CONTRACT = '0xCb7401e268f61b1242B17fE141453471CFbdc6e1';
const HASH = `0x${'c'.repeat(64)}`;
const PROOF_VALUE = `0x${'d'.repeat(130)}`;
const REGISTRANT = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';

type VerdictCase = {
  headline: PublicVerificationHeadline;
  authenticity: PublicAuthenticityResult;
  evidence: PublicBlockchainEvidenceResult;
  status?: 'issued' | 'revoked';
  summary: string;
};

function viewModel(verdict: VerdictCase, real = true): PublicCredentialVerificationVM {
  return {
    credentialReference: 'credential-1',
    status: verdict.status ?? 'issued',
    statusLabel: verdict.status === 'revoked' ? 'Revocada' : 'Emitida',
    title: 'Curso de gestión',
    type: 'course',
    typeLabel: 'Curso',
    issuerName: 'Plataforma de Cursos Demo',
    issuerDid: 'did:web:api.example:did:issuers:i',
    holderLabel: 'Titular real',
    holderDid: null,
    issuedAtLabel: '16 oct 2026',
    revokedAtLabel: verdict.status === 'revoked' ? '17 oct 2026' : null,
    revocationReason: verdict.status === 'revoked' ? 'Datos actualizados' : null,
    canonicalHash: HASH,
    canonicalHashShort: '0xcccccccc…cccccc',
    canonicalizationVersion: 'canon_v2',
    proof: {
      cryptosuite: 'ecdsa-secp256k1-eip191',
      verificationMethod: 'did:web:api.example:did:issuers:i#assert-1',
      proofValue: PROOF_VALUE
    },
    integrity: {
      canonicalHashPresent: true,
      blockchainRecordsCount: 1,
      latestBlockchainRecord: real
        ? {
            network: 'base_sepolia',
            networkLabel: 'Testnet',
            chainId: 84532,
            evidenceMode: 'credential_registry',
            txHash: TX,
            txHashShort: '0xabababab…abababab',
            statusLabel: 'Registro técnico disponible',
            registeredAtLabel: '16 oct 2026',
            revokedAtLabel: null,
            contractAddress: CONTRACT,
            deploymentId: 'base-sepolia-84532-0xcb7401e268f61b1242b17fe141453471cfbdc6e1',
            blockNumber: 47934900,
            registrantAddress: REGISTRANT
          }
        : {
            network: 'anvil',
            networkLabel: 'Entorno técnico/demo',
            chainId: 31337,
            evidenceMode: 'mock',
            txHash: null,
            txHashShort: '0xbbbbbbbb…bbbbbb',
            statusLabel: 'Registro técnico disponible',
            registeredAtLabel: '16 oct 2026',
            revokedAtLabel: null,
            contractAddress: null,
            deploymentId: null,
            blockNumber: null,
            registrantAddress: null
          }
    },
    verification: {
      result: verdict.headline === 'REVOKED' ? 'revoked' : verdict.headline === 'INVALID' || verdict.headline === 'INDETERMINATE' ? 'not_verifiable' : 'valid_issued',
      summary: verdict.summary,
      checkedAtLabel: '16 oct 2026',
      headline: verdict.headline,
      authenticity: { result: verdict.authenticity, reason: 'REASON_CODE' },
      blockchainEvidence: { result: verdict.evidence, reason: 'REASON_CODE' }
    }
  };
}

const CASES: Record<string, VerdictCase> = {
  verified: { headline: 'VERIFIED', authenticity: 'VERIFIED', evidence: 'REGISTERED', summary: 'Autoría verificada y registro confirmado.' },
  limited: { headline: 'VERIFIED_WITH_LIMITED_EVIDENCE', authenticity: 'VERIFIED', evidence: 'PENDING', summary: 'Registro pendiente.' },
  indeterminate: { headline: 'INDETERMINATE', authenticity: 'INDETERMINATE', evidence: 'UNAVAILABLE', summary: 'No se pudo comprobar la autoría.' },
  invalid: { headline: 'INVALID', authenticity: 'INVALID', evidence: 'REGISTERED', summary: 'La prueba no se corresponde con el contenido.' },
  revoked: { headline: 'REVOKED', authenticity: 'VERIFIED', evidence: 'REVOKED_ON_CHAIN', status: 'revoked', summary: 'Revocada.' }
};

const TITLES: Record<string, string> = {
  verified: 'Credencial verificada',
  limited: 'Autoría verificada, con evidencia de red limitada',
  indeterminate: 'No se pudo determinar la autenticidad',
  invalid: 'La credencial no supera la verificación',
  revoked: 'Credencial revocada'
};

afterEach(cleanup);

describe('PublicVerificationResult — one visibly different state per server verdict', () => {
  for (const [name, verdict] of Object.entries(CASES)) {
    it(`renders ${verdict.headline} with its own title and data-verdict`, () => {
      render(<PublicVerificationResult verification={viewModel(verdict)} />);

      expect(screen.getByRole('heading', { name: TITLES[name] })).toBeTruthy();
      expect(document.querySelector('[data-verdict]')?.getAttribute('data-verdict')).toBe(verdict.headline);
      expect(screen.getByText(verdict.summary)).toBeTruthy();
      // El titular real viene del servidor, no de un texto fijo.
      expect(screen.getByText('Titular real')).toBeTruthy();
    });
  }

  it('shows the positive title ONLY for VERIFIED', () => {
    for (const [name, verdict] of Object.entries(CASES)) {
      const { unmount } = render(<PublicVerificationResult verification={viewModel(verdict)} />);
      const positive = screen.queryByRole('heading', { name: 'Credencial verificada' }) !== null;

      expect(positive, name).toBe(name === 'verified');
      unmount();
    }
  });

  it('never implies VERIFIED for INVALID or INDETERMINATE (no positive heading, badge or legacy "emitida" title)', () => {
    for (const name of ['invalid', 'indeterminate']) {
      const { unmount } = render(<PublicVerificationResult verification={viewModel(CASES[name])} />);

      expect(screen.queryByText('Credencial verificada')).toBeNull();
      expect(screen.queryByText('Verificada')).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Credencial emitida' })).toBeNull();
      unmount();
    }
  });

  it('INVALID shows an explicit error alert; INDETERMINATE a warning; neither is a success state', () => {
    const invalid = render(<PublicVerificationResult verification={viewModel(CASES.invalid)} />);
    expect(screen.getByText('No presentes esta credencial como auténtica')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    invalid.unmount();

    render(<PublicVerificationResult verification={viewModel(CASES.indeterminate)} />);
    expect(screen.getByText('La verificación no es concluyente')).toBeTruthy();
  });

  it('INVALID is not softened by a revoked status', () => {
    render(<PublicVerificationResult verification={viewModel({ ...CASES.invalid, status: 'revoked' })} />);

    expect(screen.getByRole('heading', { name: TITLES.invalid })).toBeTruthy();
  });

  it('a revoked status overrides a stale positive headline', () => {
    render(<PublicVerificationResult verification={viewModel({ ...CASES.verified, status: 'revoked' })} />);

    expect(screen.getByRole('heading', { name: 'Credencial revocada' })).toBeTruthy();
    expect(screen.getByText('Datos actualizados')).toBeTruthy();
  });
});

describe('PublicVerificationResult — public blockchain information', () => {
  it('shows the full hash, proof, tx, contract, block and registrant for a real Base Sepolia record', () => {
    render(<PublicVerificationResult verification={viewModel(CASES.verified)} />);

    const text = document.body.textContent ?? '';
    for (const value of [HASH, PROOF_VALUE, TX, CONTRACT, REGISTRANT, '47934900', '84532', 'did:web:api.example:did:issuers:i#assert-1']) {
      expect(text).toContain(value);
    }
    expect(screen.getByText('Registrada en la red')).toBeTruthy();
    expect(screen.getByText('Firma y contenido verificados')).toBeTruthy();
  });

  it('adds Base Sepolia explorer links built only from public data, opened safely', () => {
    render(<PublicVerificationResult verification={viewModel(CASES.verified)} />);

    const tx = screen.getByRole('link', { name: 'Ver transacción en el explorador' });
    const contract = screen.getByRole('link', { name: 'Ver contrato en el explorador' });

    expect(tx.getAttribute('href')).toBe(`https://sepolia.basescan.org/tx/${TX}`);
    expect(contract.getAttribute('href')).toBe(`https://sepolia.basescan.org/address/${CONTRACT}`);
    for (const link of [tx, contract]) {
      expect(link.getAttribute('rel')).toContain('noopener');
      expect(link.getAttribute('rel')).toContain('noreferrer');
    }
  });

  it('marks mock evidence as simulated and builds no explorer link', () => {
    render(<PublicVerificationResult verification={viewModel(CASES.limited, false)} />);

    expect(screen.getByText(/Evidencia local simulada: no es un registro en una red pública de blockchain/)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(document.body.textContent).not.toContain('sepolia.basescan.org');
  });

  it('copies a full value to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<PublicVerificationResult verification={viewModel(CASES.verified)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copiar transacción' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(TX));
  });

  it('never renders RPC endpoints, secrets or private extras', () => {
    render(<PublicVerificationResult verification={viewModel(CASES.verified)} />);

    expect(document.body.textContent).not.toMatch(/rpc|secret|privateKey|secretRef|api[_-]?key|100% verificada|IA certifica/i);
  });
});
