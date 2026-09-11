import { Redirect, useRouter } from 'expo-router';

import { LoginScreen } from '@/features/auth/login-screen';
import { useSession } from '@/lib/auth/session-provider';

/**
 * Ruta de acceso. Sólo orquesta: la pantalla vive en `src/features/auth`
 * para que se pueda testear sin montar el router (sección 143 del encargo).
 */
export default function LoginRoute() {
  const router = useRouter();
  const { state, login } = useSession();

  if (state.status === 'authenticated') {
    return <Redirect href="/(holder)/(tabs)" />;
  }

  return (
    <LoginScreen
      onSubmit={login}
      onCreateAccount={() => router.push('/register')}
      submitting={state.status === 'authenticating'}
      initialFeedback={
        state.status === 'unauthenticated' ? state.notice : null
      }
    />
  );
}
