import { useMutation } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useRef, useState } from 'react';
import { Linking, Share } from 'react-native';

import { useAppConfig } from '@/lib/config/app-config-provider';
import { useAuthenticatedRequest } from '@/lib/auth/session-provider';
import { createProfileShareRequest } from '@/lib/api/scope-api';
import {
  buildCredentialShareMessage,
  buildCredentialVerificationUrl,
  buildProfileShareMessage,
  buildProfileShareUrl,
  isSafeExternalUrl
} from '@/features/sharing/share-links';

/**
 * Compartir en mobile es una acción NATIVA: se genera/recupera el enlace
 * público por el API existente y se entrega al share sheet del sistema.
 *
 * Es una capacidad MOBILE-ADAPTED respecto de Holder Web, que despliega un
 * panel con campos y botones de copiar (secciones 78, 79 y 202 del encargo).
 * Misma capacidad de dominio, interacción propia de la plataforma.
 *
 * Nunca se registra en logs el enlace ni el token (sección 31).
 */

export type ShareFeedback =
  | { kind: 'idle' }
  | { kind: 'copied' }
  | { kind: 'error'; message: string };

export function useProfileShare() {
  const request = useAuthenticatedRequest();
  const { webBaseUrl } = useAppConfig();
  const [feedback, setFeedback] = useState<ShareFeedback>({ kind: 'idle' });
  // El enlace se reutiliza mientras la pantalla siga viva: no se crea un
  // share nuevo cada vez que la persona toca "Compartir".
  const cachedUrl = useRef<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (): Promise<string> => {
      if (cachedUrl.current) return cachedUrl.current;

      const link = await createProfileShareRequest(request);
      const url = buildProfileShareUrl(webBaseUrl, link.sharePath);
      cachedUrl.current = url;
      return url;
    }
  });

  const share = useCallback(async () => {
    setFeedback({ kind: 'idle' });

    try {
      const url = await mutation.mutateAsync();
      await Share.share({
        message: buildProfileShareMessage(url),
        url
      });
    } catch {
      setFeedback({
        kind: 'error',
        message:
          'No pudimos preparar un enlace para compartir tu perfil. Intentá nuevamente más tarde.'
      });
    }
  }, [mutation]);

  const copyLink = useCallback(async () => {
    setFeedback({ kind: 'idle' });

    try {
      const url = await mutation.mutateAsync();
      await Clipboard.setStringAsync(url);
      setFeedback({ kind: 'copied' });
    } catch {
      setFeedback({
        kind: 'error',
        message: 'No pudimos copiar el enlace. Intentá nuevamente más tarde.'
      });
    }
  }, [mutation]);

  const openPublicView = useCallback(async () => {
    setFeedback({ kind: 'idle' });

    try {
      const url = await mutation.mutateAsync();

      if (!isSafeExternalUrl(url)) {
        setFeedback({
          kind: 'error',
          message: 'El enlace público no es válido.'
        });
        return;
      }

      await Linking.openURL(url);
    } catch {
      setFeedback({
        kind: 'error',
        message: 'No pudimos abrir la vista pública. Intentá nuevamente.'
      });
    }
  }, [mutation]);

  return {
    share,
    copyLink,
    openPublicView,
    pending: mutation.isPending,
    feedback,
    dismissFeedback: useCallback(() => setFeedback({ kind: 'idle' }), [])
  };
}

/**
 * Compartir una credencial no requiere mutación: el enlace público es la
 * vista de verificación de Scope Web para esa referencia, exactamente como
 * en Holder Web.
 */
export function useCredentialShare(
  credentialReference: string,
  credentialTitle: string
) {
  const { webBaseUrl } = useAppConfig();
  const [feedback, setFeedback] = useState<ShareFeedback>({ kind: 'idle' });
  const url = buildCredentialVerificationUrl(webBaseUrl, credentialReference);

  const share = useCallback(async () => {
    setFeedback({ kind: 'idle' });

    try {
      await Share.share({
        message: buildCredentialShareMessage(credentialTitle, url),
        url
      });
    } catch {
      setFeedback({
        kind: 'error',
        message: 'No pudimos compartir la credencial. Intentá nuevamente.'
      });
    }
  }, [credentialTitle, url]);

  const copyLink = useCallback(async () => {
    setFeedback({ kind: 'idle' });

    try {
      await Clipboard.setStringAsync(url);
      setFeedback({ kind: 'copied' });
    } catch {
      setFeedback({
        kind: 'error',
        message: 'No pudimos copiar el enlace. Intentá nuevamente.'
      });
    }
  }, [url]);

  const openPublicView = useCallback(async () => {
    setFeedback({ kind: 'idle' });

    if (!isSafeExternalUrl(url)) {
      setFeedback({ kind: 'error', message: 'El enlace público no es válido.' });
      return;
    }

    try {
      await Linking.openURL(url);
    } catch {
      setFeedback({
        kind: 'error',
        message: 'No pudimos abrir la vista pública. Intentá nuevamente.'
      });
    }
  }, [url]);

  return {
    share,
    copyLink,
    openPublicView,
    pending: false,
    feedback,
    dismissFeedback: useCallback(() => setFeedback({ kind: 'idle' }), [])
  };
}
