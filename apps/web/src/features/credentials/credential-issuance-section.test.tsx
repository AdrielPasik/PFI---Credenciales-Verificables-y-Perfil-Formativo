import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CredentialIssuanceSection } from '@/features/credentials/credential-issuance-section';
import { ApiError } from '@/lib/errors/api-error';
import type { IssuerCredentialDetailVM } from '@/models/credentials';

function detailFixture(
  overrides: Partial<IssuerCredentialDetailVM> = {}
): IssuerCredentialDetailVM {
  return {
    credentialReference: 'credential-private-reference',
    title: 'Arquitectura de Software',
    description: null,
    hours: null,
    type: 'course',
    typeLabel: 'Curso',
    status: 'draft',
    statusLabel: 'Borrador',
    issuer: { displayName: 'Universidad Demo', did: null },
    holder: {
      displayLabel: 'Titular Demo',
      email: 'holder@example.com',
      did: null
    },
    credentialSubject: {
      achievementName: 'Arquitectura de Software',
      institutionName: 'Universidad Demo',
      completionDate: null,
      academicPeriod: null,
      programName: null,
      grade: null,
      providerName: null,
      platformName: null,
      modality: null,
      level: null,
      certificationCode: null,
      expirationDate: null,
      externalUrl: null,
      skills: [],
      competencies: [],
      learningOutcomes: []
    },
    academicCourse: null,
    documentEvidence: { currentDocument: null },
    textEvidence: { currentText: null },
    issuedAt: null,
    issuedAtLabel: null,
    canonicalHash: null,
    canonicalHashShort: null,
    canonicalizationVersion: null,
    blockchainEvidence: null,
    createdAt: '2026-08-05T12:00:00.000Z',
    updatedAt: '2026-08-05T12:00:00.000Z',
    ...overrides
  };
}

function issuedFixture(
  overrides: Partial<IssuerCredentialDetailVM> = {}
) {
  const canonicalHash = `0x${'a'.repeat(64)}`;
  const txHash = `0x${'b'.repeat(64)}`;

  return detailFixture({
    status: 'issued',
    statusLabel: 'Emitida',
    issuedAt: '2026-08-06T12:00:00.000Z',
    issuedAtLabel: '6 ago 2026, 09:00',
    canonicalHash,
    canonicalHashShort: `${canonicalHash.slice(0, 12)}…${canonicalHash.slice(-8)}`,
    canonicalizationVersion: 'canon_v1',
    blockchainEvidence: {
      network: 'anvil',
      networkLabel: 'Entorno técnico/demo',
      chainId: 31337,
      txHash,
      txHashShort: `${txHash.slice(0, 12)}…${txHash.slice(-8)}`,
      status: 'registered',
      statusLabel: 'Registrada',
      registeredAt: '2026-08-06T12:00:02.000Z',
      registeredAtLabel: '6 ago 2026, 09:00',
    },
    ...overrides
  });
}

describe('CredentialIssuanceSection', () => {
  it('asks for confirmation and cancel does not issue', () => {
    const onIssue = vi.fn();
    render(
      <CredentialIssuanceSection detail={detailFixture()} onIssue={onIssue} />
    );

    expect(screen.getByText('Emisión de credencial')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Emitir credencial' }));
    expect(screen.getByText('Confirmar emisión')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onIssue).not.toHaveBeenCalled();
    expect(screen.queryByText('Confirmar emisión')).toBeNull();
  });

  it('issues once, shows loading and replaces the draft with the issued snapshot', async () => {
    let resolveIssue: ((detail: IssuerCredentialDetailVM) => void) | undefined;
    const onIssue = vi.fn(
      () =>
        new Promise<IssuerCredentialDetailVM>((resolve) => {
          resolveIssue = resolve;
        })
    );

    function Harness() {
      const [detail, setDetail] = useState(detailFixture());

      return (
        <CredentialIssuanceSection
          detail={detail}
          onIssue={async () => {
            const issued = await onIssue();
            setDetail(issued);
            return issued;
          }}
        />
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Emitir credencial' }));
    fireEvent.click(screen.getByRole('button', { name: 'Emitir credencial' }));

    expect(
      (
        screen.getByRole('button', {
          name: 'Emitiendo credencial…'
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Emitiendo credencial…' }));
    expect(onIssue).toHaveBeenCalledOnce();

    resolveIssue?.(issuedFixture());

    await waitFor(() => {
      expect(screen.getByText('Credencial emitida')).toBeTruthy();
    });
    expect(screen.getByText('canon_v1')).toBeTruthy();
    expect(screen.getByText('Entorno técnico/demo')).toBeTruthy();
    expect(screen.getByText('anvil')).toBeTruthy();
    expect(screen.getByText('31337')).toBeTruthy();
    expect(screen.getAllByText('Registrada').length).toBeGreaterThan(0);
    expect(
      screen.getByText(/no a una red pública productiva/i)
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Emitir credencial' })).toBeNull();
  });

  it('shows an honest issued state without blockchain evidence', () => {
    render(
      <CredentialIssuanceSection
        detail={issuedFixture({ blockchainEvidence: null })}
        onIssue={vi.fn()}
      />
    );

    expect(
      screen.getByText(
        'La credencial fue emitida, pero no hay evidencia blockchain disponible para mostrar.'
      )
    ).toBeTruthy();
  });

  it('keeps revoked historical evidence read-only', () => {
    render(
      <CredentialIssuanceSection
        detail={issuedFixture({
          status: 'revoked',
          statusLabel: 'Revocada',
          blockchainEvidence: {
            ...issuedFixture().blockchainEvidence!,
            status: 'revoked',
            statusLabel: 'Revocada'
          }
        })}
        onIssue={vi.fn()}
      />
    );

    expect(screen.getByText('Credencial revocada')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Emitir credencial' })).toBeNull();
    expect(screen.getAllByText('Revocada').length).toBeGreaterThan(0);
  });

  it.each([
    [400, /datos o la configuración necesarios/i],
    [401, /sesión venció/i],
    [403, /permisos para emitir/i],
    [404, /contexto institucional activo/i],
    [409, /ya no está en borrador/i],
    [502, /registro técnico/i],
    [503, /registro técnico/i],
    [504, /registro técnico/i]
  ])('maps issuance HTTP %i to safe copy', async (status, message) => {
    const onIssue = vi
      .fn()
      .mockRejectedValue(new ApiError('private upstream detail', 'http', status));
    render(
      <CredentialIssuanceSection detail={detailFixture()} onIssue={onIssue} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Emitir credencial' }));
    fireEvent.click(screen.getByRole('button', { name: 'Emitir credencial' }));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByText(/private upstream detail/i)).toBeNull();
  });

  it('describes an uncertain network result without exposing internals', async () => {
    const onIssue = vi
      .fn()
      .mockRejectedValue(new ApiError('private RPC URL', 'network'));
    render(
      <CredentialIssuanceSection detail={detailFixture()} onIssue={onIssue} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Emitir credencial' }));
    fireEvent.click(screen.getByRole('button', { name: 'Emitir credencial' }));

    expect(
      await screen.findByText(/actualizá el detalle antes de volver a intentarlo/i)
    ).toBeTruthy();
    expect(screen.queryByText(/private RPC URL/i)).toBeNull();
  });

  it('does not render prohibited claims or dangerous fields', () => {
    render(
      <CredentialIssuanceSection detail={issuedFixture()} onIssue={vi.fn()} />
    );

    const content = document.body.textContent ?? '';
    expect(content).not.toMatch(
      /100% verificado|inmutable para siempre|verificación garantizada|blockchain certificó|IA certificó|privateKey|rpcUrl|storageKey|rawData/i
    );
  });
});
