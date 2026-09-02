'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { SessionErrorState } from '@/components/feedback/session-error-state';
import { SessionLoadingState } from '@/components/feedback/session-loading-state';
import { AuthShell } from '@/components/layout/auth-shell';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { RegisterForm } from '@/features/auth/register-form';
import { useSession } from '@/lib/session/session-provider';

export function RegisterScreen() {
  const router = useRouter();
  const {
    register,
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

  return (
    <AuthShell>
      <Card className="overflow-hidden border-border-strong bg-surface shadow-md">
        <div aria-hidden="true" className="h-1 bg-brand-accent" />
        <CardHeader className="gap-3 pb-4 sm:p-8 sm:pb-5">
          <p className="text-sm font-semibold text-teal-700">
            Creá tu cuenta en Scope
          </p>
          <h2 className="text-3xl leading-tight font-bold tracking-tight text-text-strong">
            Crear cuenta
          </h2>
          <p className="text-sm leading-6 text-text-muted">
            Empezá a construir tu trayectoria formativa en un solo lugar.
          </p>
        </CardHeader>
        <CardContent className="pt-2 sm:px-8 sm:pb-8">
          <RegisterForm isSubmitting={isSubmitting} onSubmit={register} />
          <p className="mt-6 text-center text-sm text-text-muted">
            ¿Ya tenés una cuenta?{' '}
            <Link href="/login" className="font-semibold text-brand-700 underline underline-offset-4">
              Ingresar
            </Link>
          </p>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
