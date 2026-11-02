import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IssuerShell } from '@/components/layout/issuer-shell';
import { IssuerHome } from '@/features/issuer-context/issuer-home';
import type { IssuerMembershipSummaryVM } from '@/models/issuer-context';
import type { IssuerTechnicalIdentityVM } from '@/models/issuer-technical-identity';

const mocks = vi.hoisted(() => ({
  getIssuerTechnicalIdentityRequest: vi.fn(),
  requestAuthenticated: vi.fn()
}));

vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => ({ requestAuthenticated: mocks.requestAuthenticated })
}));

vi.mock('@/lib/api/issuer-technical-identity-api', () => ({
  getIssuerTechnicalIdentityRequest: mocks.getIssuerTechnicalIdentityRequest
}));

const membership = (overrides: Partial<IssuerMembershipSummaryVM> = {}) =>
  ({
    issuerReference: 'issuer-a',
    issuerName: 'Universidad Argentina de la Empresa',
    issuerDid: 'did:example:issuer-demo',
    issuerAuthorizationLabel: 'Autorizada',
    role: 'admin',
    roleLabel: 'Administrador',
    ...overrides
  }) as IssuerMembershipSummaryVM;

const technicalIdentity = {
  technicalIdentity: { status: 'active', did: 'did:example:issuer-demo', didDocumentUrl: null },
  anchorSigner: null,
  readyToIssue: false
} as unknown as IssuerTechnicalIdentityVM;

beforeEach(() => {
  mocks.getIssuerTechnicalIdentityRequest.mockReset();
});

afterEach(cleanup);

describe('IssuerHome', () => {
  it('muestra la institucion una sola vez como titulo de la banda, con sus acciones', async () => {
    mocks.getIssuerTechnicalIdentityRequest.mockResolvedValue(technicalIdentity);
    render(<IssuerHome membership={membership()} />);

    const title = screen.getByRole('heading', { level: 1, name: 'Universidad Argentina de la Empresa' });
    const band = title.closest('section') as HTMLElement;
    expect(band.className).toMatch(/ambient-surface/);
    expect(screen.getAllByText('Universidad Argentina de la Empresa')).toHaveLength(1);
    expect(within(band).getByRole('link', { name: 'Crear credencial' }).getAttribute('href')).toBe('/issuer/credentials/new');
    expect(within(band).getByRole('link', { name: 'Configuración técnica' }).getAttribute('href')).toBe('/issuer/configuracion-tecnica');
    await screen.findByText('Configurado');
  });

  it('explica el flujo de emision en cuatro pasos', async () => {
    mocks.getIssuerTechnicalIdentityRequest.mockResolvedValue(technicalIdentity);
    render(<IssuerHome membership={membership()} />);

    const steps = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(steps.map((step) => step.querySelector('p')?.textContent)).toEqual([
      'Titular',
      'Logro',
      'Evidencia',
      'Emisión'
    ]);
    await screen.findByText('Configurado');
  });

  it('lee el estado de DID y wallet del endpoint existente de configuracion tecnica', async () => {
    mocks.getIssuerTechnicalIdentityRequest.mockResolvedValue(technicalIdentity);
    render(<IssuerHome membership={membership()} />);

    expect(await screen.findByText('Configurado')).toBeTruthy();
    expect(screen.getByText('Sin configurar')).toBeTruthy();
    expect(screen.getByText('No lista para emitir')).toBeTruthy();
    expect(mocks.getIssuerTechnicalIdentityRequest).toHaveBeenCalledTimes(1);
    expect(mocks.getIssuerTechnicalIdentityRequest.mock.calls[0][1]).toBe('issuer-a');
  });

  it('no consulta la identidad tecnica ni ofrece la configuracion a un operador', () => {
    render(<IssuerHome membership={membership({ role: 'operator', roleLabel: 'Operador' })} />);

    expect(mocks.getIssuerTechnicalIdentityRequest).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'Configuración técnica' })).toBeNull();
    expect(screen.getByText(/la gestiona un administrador/)).toBeTruthy();
  });

  it('informa un error de consulta sin romper la pantalla', async () => {
    mocks.getIssuerTechnicalIdentityRequest.mockRejectedValue(new Error('boom'));
    render(<IssuerHome membership={membership()} />);

    expect(await screen.findByText('No se pudo consultar la identidad técnica.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Crear credencial' })).toBeTruthy();
  });

  it('copia el DID y lo confirma de forma accesible', async () => {
    mocks.getIssuerTechnicalIdentityRequest.mockResolvedValue(technicalIdentity);
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<IssuerHome membership={membership()} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copiar DID' }));
    });

    expect(writeText).toHaveBeenCalledWith('did:example:issuer-demo');
    expect(screen.getByRole('button', { name: 'DID copiado' })).toBeTruthy();
    expect(screen.getByText('DID copiado', { selector: '[role=status]' })).toBeTruthy();
  });

  it('si el navegador no deja copiar, selecciona el DID y lo avisa', async () => {
    mocks.getIssuerTechnicalIdentityRequest.mockResolvedValue(technicalIdentity);
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => { throw new Error('NotAllowedError'); }) } });
    render(<IssuerHome membership={membership()} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copiar DID' }));
    });

    expect(window.getSelection()?.toString()).toBe('did:example:issuer-demo');
    expect(screen.getByRole('button', { name: 'DID seleccionado para copiar' })).toBeTruthy();
    expect(screen.getByText(/El DID quedó seleccionado para copiarlo/)).toBeTruthy();
  });

  it('sin DID no ofrece copiar', async () => {
    mocks.getIssuerTechnicalIdentityRequest.mockResolvedValue(technicalIdentity);
    render(<IssuerHome membership={membership({ issuerDid: null })} />);

    expect(screen.getByText('DID no disponible')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copiar DID' })).toBeNull();
    await screen.findByText('Configurado');
  });
});

describe('banda dentro del shell', () => {
  it('se dibuja debajo del header, fuera del contenido principal, sin repetir la institucion', async () => {
    mocks.getIssuerTechnicalIdentityRequest.mockResolvedValue(technicalIdentity);
    render(
      <IssuerShell
        label="Ana"
        issuerName="Universidad Argentina de la Empresa"
        canChangeIssuer={false}
        onChangeIssuer={() => {}}
        onLogout={() => {}}
      >
        <IssuerHome membership={membership()} />
      </IssuerShell>
    );

    const band = screen.getByRole('heading', { level: 1 }).closest('section') as HTMLElement;
    const main = screen.getByRole('main');
    expect(main.contains(band)).toBe(false);
    expect(band.parentElement?.hasAttribute('data-shell-band')).toBe(true);
    // El rotulo de contexto del shell se oculta por CSS cuando hay banda.
    expect(document.querySelector('.shell-context-row')).toBeTruthy();
    await screen.findByText('Configurado');
  });
});
