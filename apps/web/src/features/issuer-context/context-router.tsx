'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { SessionErrorState } from '@/components/feedback/session-error-state';
import { SessionLoadingState } from '@/components/feedback/session-loading-state';
import { ContextShell } from '@/components/layout/context-shell';
import { IssuerSelector } from '@/features/issuer-context/issuer-selector';
import { useSession } from '@/lib/session/session-provider';

export function ContextRouter() {
  const router = useRouter();
  const {
    logout,
    retry,
    selectIssuer,
    state
  } = useSession();

  useEffect(() => {
    if (state.status === 'unauthenticated' || state.status === 'expired') {
      router.replace('/login');
      return;
    }

    if (
      state.status === 'authenticated' &&
      (state.issuerContext.kind === 'single' ||
        state.issuerContext.kind === 'selected')
    ) {
      router.replace('/issuer');
    }

    if (state.status === 'authenticated' && state.issuerContext.kind === 'none') {
      router.replace('/wallet');
    }
  }, [router, state]);

  function handleLogout() {
    logout();
    router.replace('/login');
  }

  if (
    state.status === 'booting' ||
    state.status === 'authenticating' ||
    state.status === 'resolving-context' ||
    state.status === 'unauthenticated' ||
    state.status === 'expired'
  ) {
    return <SessionLoadingState />;
  }

  if (state.status === 'recoverable-error') {
    return (
      <ContextShell label="Sesión sin validar" onLogout={handleLogout}>
        <SessionErrorState
          feedback={state.error}
          onRetry={() => void retry()}
          onLogout={handleLogout}
        />
      </ContextShell>
    );
  }

  const context = state.issuerContext;

  return (
    <ContextShell label={state.currentUser.displayLabel} onLogout={handleLogout}>
      {context.kind === 'none' ? <SessionLoadingState label="Abriendo tu espacio personal" /> : null}
      {context.kind === 'selection-required' ? (
        <IssuerSelector
          memberships={context.operationalIssuerContexts}
          onSelect={(issuerReference) => {
            if (selectIssuer(issuerReference)) {
              router.replace('/issuer');
            }
          }}
        />
      ) : null}
      {context.kind === 'single' || context.kind === 'selected' ? (
        <SessionLoadingState label="Abriendo el portal institucional" />
      ) : null}
    </ContextShell>
  );
}
