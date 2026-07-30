'use client';

import type { ReactNode } from 'react';

import { SessionProvider } from '@/lib/session/session-provider';

export function AppProviders({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
