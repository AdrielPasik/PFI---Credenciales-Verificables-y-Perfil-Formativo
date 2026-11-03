import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';

import { RegisterScreen } from '@/features/auth/register-screen';
import { useSession } from '@/lib/auth/session-provider';
import { HOLDER_HOME, safeHolderDestination } from '@/lib/navigation/return-destination';

/** Ruta pública de alta Holder; no introduce un flujo de emisor. */
export default function RegisterRoute() {
  const router = useRouter();
  const { state, register } = useSession();
  // Destino del enlace profundo, si se llego desde el login. Misma validacion.
  const next = safeHolderDestination(useLocalSearchParams<{ next?: string }>().next);

  if (state.status === 'authenticated') {
    return <Redirect href={next ?? HOLDER_HOME} />;
  }

  return (
    <RegisterScreen
      onSubmit={register}
      onBack={() =>
        router.replace(next ? { pathname: '/login', params: { next } } : '/login')
      }
      submitting={state.status === 'authenticating'}
    />
  );
}
