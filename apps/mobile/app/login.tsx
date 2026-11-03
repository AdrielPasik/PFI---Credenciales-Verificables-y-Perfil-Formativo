import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';

import { LoginScreen } from '@/features/auth/login-screen';
import { useSession } from '@/lib/auth/session-provider';
import { HOLDER_HOME, safeHolderDestination } from '@/lib/navigation/return-destination';

/**
 * Ruta de acceso. Sólo orquesta: la pantalla vive en `src/features/auth`
 * para que se pueda testear sin montar el router (sección 143 del encargo).
 */
export default function LoginRoute() {
  const router = useRouter();
  const { state, login } = useSession();
  const next = safeHolderDestination(useLocalSearchParams<{ next?: string }>().next);

  if (state.status === 'authenticated') {
    // Vuelve al destino del enlace profundo solo si es una ruta permitida del
    // titular; si no, al Perfil.
    return <Redirect href={next ?? HOLDER_HOME} />;
  }

  return (
    <LoginScreen
      onSubmit={login}
      onCreateAccount={() =>
        router.push(next ? { pathname: '/register', params: { next } } : '/register')
      }
      submitting={state.status === 'authenticating'}
      initialFeedback={
        state.status === 'unauthenticated' ? state.notice : null
      }
    />
  );
}
