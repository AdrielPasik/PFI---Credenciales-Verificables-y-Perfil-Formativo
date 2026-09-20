/**
 * "Compartir perfil" abre la gestion; NO crea enlaces.
 *
 * Es la regresion del defecto encontrado en QA manual: cada click creaba otro
 * SharingGrant y el anterior quedaba irrecuperable.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  createProfileShareRequest: vi.fn(),
  listMyProfileSharesRequest: vi.fn(),
  recoverProfileShareLinkRequest: vi.fn(),
  revokeProfileShareRequest: vi.fn(),
  replaceShareVerificationPolicyRequest: vi.fn()
}));
vi.mock('@/lib/api/profile-sharing-api', () => api);
vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => ({ requestAuthenticated: vi.fn() })
}));

import { ProfileShareAction } from './profile-share-action';
import { SHARE_MANAGEMENT_SECTION_ID } from './profile-share-management';

afterEach(cleanup);

it('no crea ningún enlace al hacer click', () => {
  render(<ProfileShareAction />);

  fireEvent.click(screen.getByRole('button', { name: 'Compartir perfil' }));

  expect(api.createProfileShareRequest).not.toHaveBeenCalled();
});

it('abre la sección de enlaces compartidos', () => {
  const section = document.createElement('details');
  section.id = SHARE_MANAGEMENT_SECTION_ID;
  section.appendChild(document.createElement('summary'));
  section.scrollIntoView = vi.fn();
  document.body.appendChild(section);

  render(<ProfileShareAction />);
  fireEvent.click(screen.getByRole('button', { name: 'Compartir perfil' }));

  expect(section.open).toBe(true);
  expect(section.scrollIntoView).toHaveBeenCalled();

  section.remove();
});
