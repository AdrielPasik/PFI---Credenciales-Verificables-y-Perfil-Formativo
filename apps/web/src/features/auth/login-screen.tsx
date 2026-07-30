'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { SessionErrorState } from '@/components/feedback/session-error-state';
import { SessionLoadingState } from '@/components/feedback/session-loading-state';
import { AuthShell } from '@/components/layout/auth-shell';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { LoginForm } from '@/features/auth/login-form';
import { useSession } from '@/lib/session/session-provider';

export function LoginScreen() {
  const router = useRouter();
  const {
    login,
    logout,
    retry,
    state
  } = useSession();

  useEffect(() => {
    if (state.status === 'authenticated') {
      router.replace('/');
    }
  }, [router, state.status]);

  if (
    state.status === 'booting' ||
    state.status === 'resolving-context' ||
    state.status === 'authenticated'
  ) {
    return (
      <AuthShell>
        <SessionLoadingState label="Validando tu acceso" />
      </AuthShell>
    );
  }

  if (state.status === 'recoverable-error') {
    return (
      <AuthShell>
        <SessionErrorState
          feedback={state.error}
          onRetry={() => void retry()}
          onLogout={logout}
        />
      </AuthShell>
    );
  }

  const isSubmitting = state.status === 'authenticating';
  const initialFeedback =
    state.status === 'expired' ? state.error : null;

  return (
    <AuthShell>
      <Card className="overflow-hidden border-border-strong shadow-md">
        <div aria-hidden="true" className="h-1 bg-teal-700" />
        <CardHeader className="gap-3 pb-4 sm:p-8 sm:pb-5">
          <p className="text-sm font-semibold text-teal-700">
            Acceso a Traza
          </p>
          <h1 className="text-3xl leading-tight font-bold tracking-tight text-text-strong">
            Iniciá sesión
          </h1>
          <p className="text-sm leading-6 text-text-muted">
            Ingresá con tu cuenta para validar el contexto institucional
            disponible.
          </p>
        </CardHeader>
        <CardContent className="pt-2 sm:px-8 sm:pb-8">
          <LoginForm
            key={initialFeedback?.code ?? 'login'}
            initialFeedback={initialFeedback}
            isSubmitting={isSubmitting}
            onSubmit={login}
          />
        </CardContent>
      </Card>
    </AuthShell>
  );
}
