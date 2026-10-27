import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RecoveryUnavailableScreen } from '@/features/auth/recovery-unavailable-screen';

describe('RecoveryUnavailableScreen', () => {
  it('explains that recovery is not available and offers no form', () => {
    render(<RecoveryUnavailableScreen />);

    expect(
      screen.getByRole('heading', {
        name: 'La recuperación de contraseña todavía no está disponible'
      })
    ).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByLabelText(/contraseña nueva|correo/i)).toBeNull();

    const link = screen.getByRole('link', { name: 'Volver a iniciar sesión' });
    expect(link.getAttribute('href')).toBe('/login');
  });
});
