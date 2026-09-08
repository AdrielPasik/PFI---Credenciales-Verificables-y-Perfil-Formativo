import { useLocalSearchParams } from 'expo-router';

import { CredentialDetailScreen } from '@/features/credentials/credential-detail-screen';

/**
 * Detalle de credencial: ruta anidada en la pila del titular, no una pestaña.
 * Volver devuelve naturalmente a la lista desde la que se abrió.
 */
export default function CredentialDetailRoute() {
  const params = useLocalSearchParams<{ credentialId?: string }>();
  const credentialReference =
    typeof params.credentialId === 'string' ? params.credentialId : '';

  return <CredentialDetailScreen credentialReference={credentialReference} />;
}
