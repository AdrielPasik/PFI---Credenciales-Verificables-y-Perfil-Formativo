'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { SessionErrorState } from '@/components/feedback/session-error-state';
import { SessionLoadingState } from '@/components/feedback/session-loading-state';
import { WalletShell } from '@/components/layout/wallet-shell';
import { useSession } from '@/lib/session/session-provider';

export function WalletRouteBoundary({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { logout, retry, state } = useSession();

  useEffect(() => {
    if (state.status === 'unauthenticated' || state.status === 'expired') {
      router.replace('/login');
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

  return (
    <WalletShell label={state.currentUser.displayLabel} onLogout={handleLogout}>
      {children}
    </WalletShell>
  );
}
