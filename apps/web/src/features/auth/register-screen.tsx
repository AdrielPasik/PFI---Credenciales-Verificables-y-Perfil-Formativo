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
      <Card className="overflow-hidden border-border-strong bg-surface shadow-lg shadow-brand-900/8">
        <div aria-hidden="true" className="h-1 bg-brand-accent" />
        <CardHeader className="gap-3 pb-5 sm:p-9 sm:pb-6">
          <p className="text-xs font-semibold tracking-[0.16em] text-teal-700 uppercase">
            Creá tu cuenta en Scope
          </p>
          <h2 className="text-3xl leading-tight font-bold tracking-[-0.035em] text-text-strong sm:text-[2rem]">
            Crear cuenta
          </h2>
          <p className="max-w-md text-sm leading-6 text-text-muted">
            Empezá a construir tu trayectoria formativa en un solo lugar.
          </p>
        </CardHeader>
        <CardContent className="pt-2 sm:px-9 sm:pb-9">
          <RegisterForm isSubmitting={isSubmitting} onSubmit={register} />
          <p className="mt-7 border-t border-border-default pt-5 text-center text-sm text-text-muted">
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
