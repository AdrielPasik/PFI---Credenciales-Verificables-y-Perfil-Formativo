'use client';

import { useRouter } from 'next/navigation';
import {
  useEffect,
  type ReactNode
} from 'react';

import { SessionErrorState } from '@/components/feedback/session-error-state';
import { SessionLoadingState } from '@/components/feedback/session-loading-state';
import { IssuerShell } from '@/components/layout/issuer-shell';
import { useSession } from '@/lib/session/session-provider';
import type { IssuerMembershipSummaryVM } from '@/models/issuer-context';

interface IssuerRouteBoundaryProps {
  children: (membership: IssuerMembershipSummaryVM) => ReactNode;
}

export function IssuerRouteBoundary({
  children
}: IssuerRouteBoundaryProps) {
  const router = useRouter();
  const {
    clearSelectedIssuer,
    logout,
    retry,
    state
  } = useSession();

  useEffect(() => {
    if (state.status === 'unauthenticated' || state.status === 'expired') {
      router.replace('/login');
      return;
    }

    if (
      state.status === 'authenticated' &&
      (state.issuerContext.kind === 'none' ||
        state.issuerContext.kind === 'selection-required')
    ) {
      router.replace('/');
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
      <div className="flex min-h-svh bg-canvas px-4 py-12 sm:px-6">
        <SessionErrorState
          feedback={state.error}
          onRetry={() => void retry()}
          onLogout={handleLogout}
        />
      </div>
    );
  }

  const membership = state.issuerContext.selectedIssuer;

  if (!membership) {
    return <SessionLoadingState label="Resolviendo contexto institucional" />;
  }

  return (
    <IssuerShell
      email={state.currentUser.email}
      issuerName={membership.issuerName}
      canChangeIssuer={
        state.issuerContext.operationalIssuerContexts.length > 1
      }
      onChangeIssuer={() => {
        clearSelectedIssuer();
        router.replace('/');
      }}
      onLogout={handleLogout}
    >
      {children(membership)}
    </IssuerShell>
  );
}
