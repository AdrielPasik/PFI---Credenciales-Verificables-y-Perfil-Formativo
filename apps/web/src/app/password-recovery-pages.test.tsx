import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/auth/forgot-password-screen', () => ({
  ForgotPasswordScreen: () => <div>FORGOT_SCREEN</div>
}));
vi.mock('@/features/auth/reset-password-screen', () => ({
  ResetPasswordScreen: () => <div>RESET_SCREEN</div>
}));

import ForgotPasswordPage, {
  metadata as forgotMetadata
} from '@/app/forgot-password/page';
import ResetPasswordPage, {
  metadata as resetMetadata
} from '@/app/reset-password/page';

describe('password recovery pages and the build flag', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('show the unavailable notice, not the flow, while recovery is switched off', () => {
    vi.stubEnv('NEXT_PUBLIC_PASSWORD_RECOVERY_ENABLED', '');

    for (const Page of [ForgotPasswordPage, ResetPasswordPage]) {
      const { unmount } = render(<Page />);
      expect(screen.queryByText('FORGOT_SCREEN')).toBeNull();
      expect(screen.queryByText('RESET_SCREEN')).toBeNull();
      expect(
        screen.getByRole('heading', {
          name: 'La recuperación de contraseña todavía no está disponible'
        })
      ).toBeTruthy();
      expect(screen.queryByRole('textbox')).toBeNull();
      unmount();
    }
  });

  it('mount the real screens when the flag is exactly "true"', () => {
    vi.stubEnv('NEXT_PUBLIC_PASSWORD_RECOVERY_ENABLED', 'true');

    const forgot = render(<ForgotPasswordPage />);
    expect(screen.getByText('FORGOT_SCREEN')).toBeTruthy();
    forgot.unmount();

    render(<ResetPasswordPage />);
    expect(screen.getByText('RESET_SCREEN')).toBeTruthy();
  });

  it('keep the personal reset link out of search indexes', () => {
    expect(resetMetadata.robots).toEqual({ index: false, follow: false });
    expect(forgotMetadata.title).toBe('Recuperar contraseña');
  });
});
