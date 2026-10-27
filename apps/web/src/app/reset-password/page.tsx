import type { Metadata } from 'next';

import { RecoveryUnavailableScreen } from '@/features/auth/recovery-unavailable-screen';
import { ResetPasswordScreen } from '@/features/auth/reset-password-screen';
import { isPasswordRecoveryEnabled } from '@/lib/env/feature-flags';

export const metadata: Metadata = {
  title: 'Restablecer contraseña',
  // La pagina solo tiene sentido con un enlace personal: no se indexa ni se sigue.
  robots: { index: false, follow: false }
};

// Pagina dinamica (sin prerender/cache estatico): garantiza que las cabeceras
// `Cache-Control: no-store` definidas en next.config.ts se emitan tal cual.
export const dynamic = 'force-dynamic';

export default function ResetPasswordPage() {
  // Apagada: no se monta la pantalla, asi que tampoco se lee el fragmento (#token).
  if (!isPasswordRecoveryEnabled()) {
    return <RecoveryUnavailableScreen />;
  }

  return <ResetPasswordScreen />;
}
