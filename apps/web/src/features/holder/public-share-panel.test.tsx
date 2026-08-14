import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { PublicSharePanel } from './public-share-panel';

afterEach(() => {
  vi.restoreAllMocks();
});

it('shows a manual-copy fallback when clipboard access is unavailable', () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  render(<PublicSharePanel title="Compartir credencial" sharePath="/verify?credential=credential-1" credentialReference="credential-1" description="Descripción segura." />);

  fireEvent.click(screen.getByRole('button', { name: 'Compartir credencial' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Copiar' })[0]!);

  expect(screen.getByText('No pudimos copiar automáticamente. Podés copiar el enlace manualmente.')).toBeTruthy();
  expect(screen.getByDisplayValue('credential-1')).toBeTruthy();
  expect(
    (screen.getByRole('link', { name: 'Ver vista pública' }) as HTMLAnchorElement).getAttribute('href')
  ).toBe('/verify?credential=credential-1');
});
