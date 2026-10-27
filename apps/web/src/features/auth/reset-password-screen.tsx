'use client';

import { LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  clearResetFragment,
  parseResetFragment
} from '@/features/auth/password-reset-fragment';
import {
  RecoveryCard,
  useFocusTitleOnChange
} from '@/features/auth/recovery-card';
import { ResetPasswordForm } from '@/features/auth/reset-password-form';
import {
  confirmPasswordReset,
  verifyPasswordResetToken
} from '@/lib/api/auth-api';
import { mapPasswordResetError } from '@/lib/errors/password-reset-error-mapper';
import { useSession } from '@/lib/session/session-provider';
import type { PasswordResetFeedback } from '@/models/password-reset';

/**
 * UN solo estado, como union discriminada: es imposible estar a la vez en "exito" y
 * en "error", o mostrar el formulario mientras el enlace no se verifico.
 */
type Screen =
  | { kind: 'reading' }
  | { kind: 'verifying' }
  | { kind: 'ready'; submitting: boolean; error: PasswordResetFeedback | null }
  | { kind: 'done' }
  | { kind: 'invalid'; reason: 'missing' | 'malformed' | 'rejected' }
  | { kind: 'error'; step: 'verify' | 'confirm'; feedback: PasswordResetFeedback };

function focusKeyOf(screen: Screen): string {
  switch (screen.kind) {
    case 'done':
      return 'done';
    case 'invalid':
      return `invalid-${screen.reason}`;
    case 'error':
      return `error-${screen.step}`;
    default:
      return 'flow';
  }
}

/** Estados de sesion con algo local que limpiar tras un restablecimiento exitoso. */
const SESSIONS_WORTH_CLEARING = new Set([
  'authenticated',
  'recoverable-error',
  'resolving-context'
]);

/**
 * `/reset-password#token=...`.
 *
 * EL TOKEN. Llega en el fragmento, que el servidor jamas ve. Se lee una vez, se saca
 * de la barra de direcciones (sin agregar una entrada al historial) y se conserva
 * UNICAMENTE en `tokenRef`: no es estado de React, no se renderiza, no se pasa como
 * prop, no se usa de `key`, no se guarda en ningun storage ni cookie, no se imprime
 * y no entra en ningun mensaje de error. Como no se persiste, refrescar la pagina lo
 * pierde: es la consecuencia deliberada de protegerlo.
 *
 * LA AUTORIDAD ES EL BACKEND. Esta pantalla no decide si un token corresponde a una
 * cuenta ni si sigue vigente: pregunta (`verify`, que NO consume) y actua segun la
 * respuesta. Que `verify` haya dicho "valido" no garantiza que lo siga siendo cuando
 * se confirme.
 *
 * SESION. Los endpoints son publicos y se llaman sin token de sesion. Solo despues de
 * un restablecimiento EXITOSO se limpia la sesion local, con el mecanismo oficial
 * (`logout`): el JWT que hubiera quedado en este navegador ya no sirve.
 */
export function ResetPasswordScreen() {
  const [screen, setScreen] = useState<Screen>({ kind: 'reading' });
  const session = useSession();
  const sessionRef = useRef(session);

  const tokenRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const mountedRef = useRef(false);
  const confirmingRef = useRef(false);
  // Cada enlace leido abre una "generacion": la respuesta de una verificacion de un
  // enlace anterior no puede pisar la pantalla del enlace nuevo.
  const generationRef = useRef(0);
  // El foco va al titulo solo al ENTRAR a un estado de resultado (exito, enlace
  // invalido, error). Dentro del flujo de carga/formulario comparten una misma clave:
  // ahi el foco lo maneja el campo con `autoFocus`, y moverlo al titulo lo pisaria.
  const titleRef = useFocusTitleOnChange(focusKeyOf(screen));

  useEffect(() => {
    sessionRef.current = session;
  });

  /** Verifica el token en memoria. Solo actualiza el estado tras la respuesta. */
  async function verify(token: string) {
    const generation = generationRef.current;
    const isCurrent = () =>
      mountedRef.current && generation === generationRef.current;

    try {
      await verifyPasswordResetToken({ token });

      if (isCurrent()) {
        setScreen({ kind: 'ready', submitting: false, error: null });
      }
    } catch (error) {
      if (!isCurrent()) {
        return;
      }

      const feedback = mapPasswordResetError(error, 'verify');

      if (feedback.problem === 'token_invalid') {
        tokenRef.current = null;
        setScreen({ kind: 'invalid', reason: 'rejected' });
        return;
      }

      // Red, 429, 5xx o respuesta ilegible: recuperable con un reintento EXPLICITO.
      // El token sigue en memoria; no vuelve a la URL.
      setScreen({ kind: 'error', step: 'verify', feedback });
    }
  }

  function retryVerification() {
    const token = tokenRef.current;

    if (token === null) {
      setScreen({ kind: 'invalid', reason: 'missing' });
      return;
    }

    setScreen({ kind: 'verifying' });
    void verify(token);
  }

  useEffect(() => {
    mountedRef.current = true;

    // React Strict Mode monta, desmonta y vuelve a montar este efecto en desarrollo,
    // conservando las refs. `startedRef` garantiza UNA lectura del fragmento y UNA
    // verificacion por enlace abierto: `verify` comparte el limite de intentos con
    // `confirm`, y un doble montaje no puede gastarlo dos veces.
    //
    // Por eso tampoco se cancela nada en la limpieza: abortar la primera solicitud y
    // saltear la segunda dejaria la pantalla sin respuesta. `mountedRef` basta para
    // no actualizar estado desmontado.
    if (!startedRef.current) {
      startedRef.current = true;

      const read = parseResetFragment(window.location.hash);
      // Siempre se limpia la URL si traia fragmento, sea valido o no.
      clearResetFragment();

      if (read.kind === 'token') {
        tokenRef.current = read.token;
        // La pantalla ya muestra "comprobando" (estado inicial): el estado solo cambia
        // tras el `await` de la verificacion, no de forma sincrona. La regla no distingue
        // ese caso: es una lectura unica de un sistema externo (la URL) al montar.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void verify(read.token);
      } else {
        // Sin token, o con algo que no lo es: NO se llama al backend. Es una lectura
        // unica de un sistema externo (`window.location.hash`), que no existe al
        // renderizar en el servidor; por eso se resuelve en el efecto y no en el estado inicial.
        setScreen({ kind: 'invalid', reason: read.kind });
      }
    }

    return () => {
      mountedRef.current = false;
    };
    // Una sola vez por montaje real: `verify` y las refs son estables.
  }, []);

  useEffect(() => {
    // Pegar OTRO enlace en la misma pestana es una navegacion solo de fragmento: no
    // recarga la pagina ni vuelve a montar el componente. Sin esto, el enlace nuevo
    // quedaria visible en la barra de direcciones y la pantalla seguiria mostrando el
    // estado del anterior.
    function onHashChange() {
      if (window.location.hash.length === 0) {
        return;
      }

      const read = parseResetFragment(window.location.hash);
      clearResetFragment();

      // Un envio en curso no se interrumpe ni se pisa; igual la URL ya quedo limpia.
      if (confirmingRef.current) {
        return;
      }

      generationRef.current += 1;

      if (read.kind === 'token') {
        tokenRef.current = read.token;
        setScreen({ kind: 'verifying' });
        void verify(read.token);
      } else {
        tokenRef.current = null;
        setScreen({ kind: 'invalid', reason: read.kind });
      }
    }

    window.addEventListener('hashchange', onHashChange);

    return () => window.removeEventListener('hashchange', onHashChange);
    // `verify` solo usa refs y `setScreen`, estables entre renders.
  }, []);

  async function handleSubmit(password: string) {
    const token = tokenRef.current;

    if (confirmingRef.current || token === null) {
      return;
    }

    confirmingRef.current = true;
    setScreen({ kind: 'ready', submitting: true, error: null });

    try {
      await confirmPasswordReset({ token, password });

      // Consumido: el secreto ya no sirve ni se necesita.
      tokenRef.current = null;

      if (SESSIONS_WORTH_CLEARING.has(sessionRef.current.state.status)) {
        sessionRef.current.logout();
      }

      if (mountedRef.current) {
        setScreen({ kind: 'done' });
      }
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }

      const feedback = mapPasswordResetError(error, 'confirm');

      switch (feedback.problem) {
        case 'token_invalid':
          // Vencio o lo uso otra pestana mientras se escribia la contrasena.
          tokenRef.current = null;
          setScreen({ kind: 'invalid', reason: 'rejected' });
          break;
        case 'outcome_unknown':
          // La solicitud pudo llegar y consumir el token. NO se reintenta (un token
          // de un solo uso) y no se afirma que fallo.
          tokenRef.current = null;
          setScreen({ kind: 'error', step: 'confirm', feedback });
          break;
        default:
          // Politica, entrada invalida, 429 u otro rechazo: el backend no cambio
          // nada y el token sigue en memoria. Se puede corregir en esta pantalla.
          setScreen({ kind: 'ready', submitting: false, error: feedback });
      }
    } finally {
      confirmingRef.current = false;
    }
  }

  switch (screen.kind) {
    case 'reading':
    case 'verifying':
      return (
        <RecoveryCard
          kicker="Restablecer contraseña"
          title="Comprobando el enlace"
          titleRef={titleRef}
        >
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-3 text-sm text-text-muted"
          >
            <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
            Un momento, estamos verificando que el enlace siga vigente.
          </div>
        </RecoveryCard>
      );

    case 'ready':
      return (
        <RecoveryCard
          kicker="Restablecer contraseña"
          title="Elegí una contraseña nueva"
          titleRef={titleRef}
          description="Escribí la contraseña que vas a usar para entrar a tu cuenta de Scope."
        >
          <ResetPasswordForm
            isSubmitting={screen.submitting}
            error={screen.error}
            onSubmit={handleSubmit}
          />
        </RecoveryCard>
      );

    case 'done':
      return (
        <RecoveryCard
          kicker="Restablecer contraseña"
          title="Tu contraseña se actualizó"
          titleRef={titleRef}
          description="Ya podés iniciar sesión con tu contraseña nueva. Por seguridad, las sesiones anteriores quedaron invalidadas."
        >
          <Button asChild size="lg" className="w-full">
            <Link href="/login">Ir a iniciar sesión</Link>
          </Button>
        </RecoveryCard>
      );

    case 'invalid':
      return (
        <RecoveryCard
          kicker="Restablecer contraseña"
          title="Este enlace ya no es válido"
          titleRef={titleRef}
          description={
            screen.reason === 'rejected'
              ? 'El enlace puede haber vencido, haberse utilizado o haber sido reemplazado por uno más nuevo.'
              : 'No encontramos un enlace de recuperación en esta página. Si la actualizaste, abrí de nuevo el enlace original del correo o pedí uno nuevo.'
          }
        >
          <div className="grid gap-3">
            <Button asChild size="lg">
              <Link href="/forgot-password">Pedir un enlace nuevo</Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href="/login">Volver a iniciar sesión</Link>
            </Button>
          </div>
        </RecoveryCard>
      );

    case 'error':
      return screen.step === 'verify' ? (
        <RecoveryCard
          kicker="Restablecer contraseña"
          title="No pudimos comprobar el enlace"
          titleRef={titleRef}
          description={screen.feedback.message}
        >
          <div className="grid gap-3">
            <Button type="button" size="lg" onClick={retryVerification}>
              Reintentar
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href="/forgot-password">Pedir un enlace nuevo</Link>
            </Button>
          </div>
        </RecoveryCard>
      ) : (
        <RecoveryCard
          kicker="Restablecer contraseña"
          title="No pudimos confirmar el cambio"
          titleRef={titleRef}
          description={`${screen.feedback.message} Probá iniciar sesión con la contraseña nueva; si no funciona, pedí un enlace nuevo.`}
        >
          <div className="grid gap-3">
            <Button asChild size="lg">
              <Link href="/login">Ir a iniciar sesión</Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href="/forgot-password">Pedir un enlace nuevo</Link>
            </Button>
          </div>
        </RecoveryCard>
      );
  }
}
