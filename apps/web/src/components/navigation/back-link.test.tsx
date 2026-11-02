import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DeadEndPage } from '@/components/feedback/dead-end-page';
import { BackLink } from '@/components/navigation/back-link';

describe('BackLink', () => {
  it('es un enlace real al padre, con el destino en su nombre accesible', () => {
    render(<BackLink href="/wallet/credentials" label="Volver a mis credenciales" />);

    const link = screen.getByRole('link', { name: 'Volver a mis credenciales' });
    expect(link.getAttribute('href')).toBe('/wallet/credentials');
    // La flecha es decorativa: no agrega ruido al lector de pantalla.
    expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('DeadEndPage', () => {
  it('siempre ofrece una salida al inicio de Scope', () => {
    render(<DeadEndPage title="No encontramos esta página" description="Enlace incompleto." />);

    expect(screen.getByRole('heading', { name: 'No encontramos esta página' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ir al inicio de Scope' }).getAttribute('href')).toBe('/');
  });
});
