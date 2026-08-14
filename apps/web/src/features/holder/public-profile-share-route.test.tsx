import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ getPublicProfileShareRequest: vi.fn() }));
vi.mock('@/lib/api/profile-sharing-api', () => api);

import { PublicProfileShareRoute } from './public-profile-share-route';

beforeEach(() => api.getPublicProfileShareRequest.mockReset());

it('renders an allowlisted shared profile without a session', async () => {
  api.getPublicProfileShareRequest.mockResolvedValue({
    holderLabel: 'Titular Demo', narrative: 'La trayectoria formativa muestra credenciales vinculadas con Gestión.',
    areas: [{ label: 'Gestión de proyectos', estimatedHoursLabel: '12 horas estimadas por IA' }],
    skills: ['Scrum'], concepts: ['Kanban'], totalOfficialHoursLabel: '12 horas oficiales declaradas', credentialsCount: 1,
    credentials: [{ credentialReference: 'credential-1', title: 'Curso ágil', typeLabel: 'Curso', issuerName: 'Institución Demo', issuedAtLabel: '14 ago 2026' }]
  });

  render(<PublicProfileShareRoute token={'a'.repeat(43)} />);

  expect(await screen.findByRole('heading', { name: 'Titular Demo' })).toBeTruthy();
  expect(screen.getByText('Scrum')).toBeTruthy();
  expect((screen.getByRole('link', { name: 'Ver credencial' }) as HTMLAnchorElement).getAttribute('href')).toBe('/verify?credential=credential-1');
  expect(document.body.textContent).not.toMatch(/analysisJson|sourceRefs|evidenceMap|storageKey/i);
  expect(document.body.textContent).not.toMatch(/@/);

  const chip = screen.getByText('Scrum');
  expect(chip.className).toMatch(/whitespace-normal/);
  expect(chip.className).toMatch(/break-words/);
  expect(screen.getByText('Gestión de proyectos · 12 horas estimadas por IA')).toBeTruthy();

  expect(screen.getByText('Credenciales incluidas')).toBeTruthy();
  expect(screen.getByText('1', { selector: 'dd' })).toBeTruthy();
  expect(screen.getByText('Esta es una vista pública resumida. No incluye email ni evidencias crudas.')).toBeTruthy();
});

it('shows a container wide enough for a desktop layout and no dedicated mobile-only wrapper', async () => {
  api.getPublicProfileShareRequest.mockResolvedValue({
    holderLabel: 'Titular Demo', narrative: null,
    areas: [], skills: [], concepts: [], totalOfficialHoursLabel: null, credentialsCount: 0,
    credentials: []
  });

  const { container } = render(<PublicProfileShareRoute token={'a'.repeat(43)} />);
  await screen.findByRole('heading', { name: 'Titular Demo' });

  expect(container.querySelector('.max-w-7xl')).toBeTruthy();
});
