import type { Metadata } from 'next';

import { ForgotPasswordScreen } from '@/features/auth/forgot-password-screen';
import { RecoveryUnavailableScreen } from '@/features/auth/recovery-unavailable-screen';
import { isPasswordRecoveryEnabled } from '@/lib/env/feature-flags';

export const metadata: Metadata = {
  title: 'Recuperar contraseña',
  // Mientras la recuperacion esta apagada la pagina no debe indexarse.
  robots: isPasswordRecoveryEnabled()
    ? undefined
    : { index: false, follow: false }
};

export default function ForgotPasswordPage() {
  if (!isPasswordRecoveryEnabled()) {
    return <RecoveryUnavailableScreen />;
  }

  return <ForgotPasswordScreen />;
}
