import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { RecoveryCard } from '@/features/auth/recovery-card';

/**
 * Lo que muestran /forgot-password y /reset-password mientras la recuperacion esta
 * apagada (`NEXT_PUBLIC_PASSWORD_RECOVERY_ENABLED`). No hay formulario, no se lee el
 * fragmento de la URL y no se llama a la API.
 */
export function RecoveryUnavailableScreen() {
  return (
    <RecoveryCard
      kicker="Recuperar acceso"
      title="La recuperación de contraseña todavía no está disponible"
      description="Estamos terminando de habilitarla. Mientras tanto, si no podés ingresar, contactá a la institución que administra tu cuenta."
    >
      <Button asChild size="lg" className="w-full">
        <Link href="/login">Volver a iniciar sesión</Link>
      </Button>
    </RecoveryCard>
  );
}
