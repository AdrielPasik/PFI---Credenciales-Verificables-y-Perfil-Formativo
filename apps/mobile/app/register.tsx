import { Redirect, useRouter } from 'expo-router';

import { RegisterScreen } from '@/features/auth/register-screen';
import { useSession } from '@/lib/auth/session-provider';

/** Ruta pública de alta Holder; no introduce un flujo de emisor. */
export default function RegisterRoute() {
  const router = useRouter();
  const { state, register } = useSession();

  if (state.status === 'authenticated') {
    return <Redirect href="/(holder)/(tabs)" />;
  }

  return (
    <RegisterScreen
      onSubmit={register}
      onBack={() => router.replace('/login')}
      submitting={state.status === 'authenticating'}
    />
  );
}
