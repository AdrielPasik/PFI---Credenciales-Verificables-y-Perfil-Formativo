import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import {
  getMyCurrentProfileRequest,
  rebuildMyProfileRequest
} from '@/lib/api/scope-api';
import { useAuthenticatedRequest } from '@/lib/auth/session-provider';
import { queryKeys } from '@/lib/query/query-client';
import type { HolderProfileVM } from '@/types/holder';

/**
 * Perfil formativo actual.
 *
 * `null` NO es un error: significa "el perfil todavía no está disponible".
 * Se distingue explícitamente de un fallo de carga (sección 122 del encargo).
 */
export function useCurrentProfile() {
  const request = useAuthenticatedRequest();

  return useQuery<HolderProfileVM | null>({
    queryKey: queryKeys.profile,
    queryFn: () => getMyCurrentProfileRequest(request)
  });
}

/**
 * "Actualizar perfil" -> `POST /me/profile/rebuild`.
 *
 * Recomposición determinística desde credenciales emitidas y semántica ya
 * disponible. NO ejecuta IA, no genera nada nuevo y no tiene progreso que
 * mostrar: por eso el copy dice "Actualizar" y no "Generar" ni "Analizar".
 *
 * Nunca se dispara sola: sólo por acción explícita de la persona. Y nunca al
 * montar la pantalla ni con pull-to-refresh (sección 23 del encargo).
 */
export function useProfileRebuild() {
  const request = useAuthenticatedRequest();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => rebuildMyProfileRequest(request),
    onSuccess: (profile) => {
      // La respuesta ya trae el perfil recompuesto: se escribe en la caché
      // en vez de forzar otro viaje al backend.
      queryClient.setQueryData(queryKeys.profile, profile);
    }
  });

  const rebuild = useCallback(async () => {
    // Evita envíos duplicados por doble toque.
    if (mutation.isPending) return;

    setError(null);

    try {
      await mutation.mutateAsync();
    } catch {
      setError(
        'No pudimos actualizar tu perfil. Intentá nuevamente más tarde.'
      );
    }
  }, [mutation]);

  return {
    rebuild,
    pending: mutation.isPending,
    error,
    dismissError: useCallback(() => setError(null), [])
  };
}
