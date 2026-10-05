import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AccountMenu } from '@/components/navigation/account-menu';
import { IssuerShell } from '@/components/layout/issuer-shell';
import { WalletShell } from '@/components/layout/wallet-shell';

/**
 * Entry point a /admin -- S6a.
 *
 * El unico punto de descubrimiento de la superficie de plataforma en la UI, y
 * la unica condicion que lo gobierna es `isPlatformAdmin === true`.
 *
 * ES SOLO UX. Ocultar el enlace no protege nada: quien escriba /admin a mano
 * se topa con `AdminRouteBoundary` y, sobre todo, con
 * `AuthGuard` + `PlatformAdminGuard` server-side en cada request.
 */
describe('AccountMenu: entry point a /admin', () => {
  const noop = () => {};

  function adminLink() {
    return screen.queryByRole('link', {
      name: /Administración de plataforma/
    });
  }

  it('1: un PlatformAdmin ve "Administración de plataforma"', () => {
    render(<AccountMenu label="Adriel Pasik" isPlatformAdmin onLogout={noop} />);

    expect(adminLink()).toBeTruthy();
  });

  it('2: un User normal NO lo ve', () => {
    render(
      <AccountMenu
        label="Juan Pérez"
        isPlatformAdmin={false}
        onLogout={noop}
      />
    );

    expect(adminLink()).toBeNull();
  });

  it('2: omitir la prop tampoco lo muestra (fail-closed por defecto)', () => {
    render(<AccountMenu label="Juan Pérez" onLogout={noop} />);

    expect(adminLink()).toBeNull();
  });

  it('3: un admin institucional SIN capacidad de plataforma NO lo ve', () => {
    // `canChangeIssuer` viene del plano INSTITUCIONAL y no implica nada sobre
    // el plano de plataforma.
    render(
      <AccountMenu
        label="Juan Pérez"
        canChangeIssuer
        onChangeIssuer={noop}
        isPlatformAdmin={false}
        onLogout={noop}
      />
    );

    expect(adminLink()).toBeNull();
    expect(
      screen.getByRole('button', { name: /Cambiar institución/ })
    ).toBeTruthy();
  });

  it('4: el enlace apunta a /admin', () => {
    render(<AccountMenu label="Adriel Pasik" isPlatformAdmin onLogout={noop} />);

    expect(adminLink()?.getAttribute('href')).toBe('/admin');
  });

  it('es un enlace real, no un div con onClick', () => {
    render(<AccountMenu label="Adriel Pasik" isPlatformAdmin onLogout={noop} />);

    expect(adminLink()?.tagName).toBe('A');
  });

  it('las dos capacidades son independientes y pueden convivir', () => {
    // PlatformAdmin + varias memberships: se ven los dos controles, y cada uno
    // lleva a su propio plano.
    render(
      <AccountMenu
        label="Adriel Pasik"
        canChangeIssuer
        onChangeIssuer={noop}
        isPlatformAdmin
        onLogout={noop}
      />
    );

    expect(adminLink()).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Cambiar institución/ })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Cerrar sesión/ })).toBeTruthy();
  });

  it('no se mezcla con el nombre de la institución activa', () => {
    render(<AccountMenu label="Adriel Pasik" isPlatformAdmin onLogout={noop} />);

    expect(adminLink()?.textContent).toBe('Administración de plataforma');
  });

  it('cerrar sesión sigue funcionando con el entry point presente', () => {
    const onLogout = vi.fn();
    render(
      <AccountMenu label="Adriel Pasik" isPlatformAdmin onLogout={onLogout} />
    );

    screen.getByRole('button', { name: /Cerrar sesión/ }).click();

    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});

/**
 * Los shells solo pasan la prop a traves. Se verifica en los dos que llevan a
 * una superficie donde una persona se queda: el espacio personal (que tambien
 * usa `/institutional-access-pending`) y el portal institucional.
 */
describe('shells: propagación del entry point', () => {
  const noop = () => {};

  function adminLink() {
    return screen.queryByRole('link', {
      name: /Administración de plataforma/
    });
  }

  it('WalletShell lo muestra para un PlatformAdmin', () => {
    render(
      <WalletShell label="Adriel Pasik" isPlatformAdmin onLogout={noop}>
        <p>contenido</p>
      </WalletShell>
    );

    expect(adminLink()?.getAttribute('href')).toBe('/admin');
  });

  it('WalletShell NO lo muestra para un User normal', () => {
    render(
      <WalletShell label="Juan Pérez" onLogout={noop}>
        <p>contenido</p>
      </WalletShell>
    );

    expect(adminLink()).toBeNull();
  });

  it('IssuerShell lo muestra para un PlatformAdmin, junto a lo institucional', () => {
    render(
      <IssuerShell
        label="Adriel Pasik"
        issuerName="UADE"
        canChangeIssuer
        isPlatformAdmin
        onChangeIssuer={noop}
        onLogout={noop}
      >
        <p>contenido</p>
      </IssuerShell>
    );

    expect(adminLink()?.getAttribute('href')).toBe('/admin');
    // Y lo institucional sigue intacto.
    expect(screen.getByText('UADE')).toBeTruthy();
    expect(screen.getByText('Institución activa')).toBeTruthy();
  });

  it('IssuerShell NO lo muestra para un admin institucional sin la capacidad', () => {
    render(
      <IssuerShell
        label="Juan Pérez"
        issuerName="UADE"
        canChangeIssuer={false}
        onChangeIssuer={noop}
        onLogout={noop}
      >
        <p>contenido</p>
      </IssuerShell>
    );

    expect(adminLink()).toBeNull();
    expect(screen.getByText('UADE')).toBeTruthy();
  });
});
