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
});
