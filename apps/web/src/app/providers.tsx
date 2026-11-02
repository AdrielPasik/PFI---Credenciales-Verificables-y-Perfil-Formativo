'use client';

import type { ReactNode } from 'react';

import { AppearanceSync } from '@/lib/appearance/use-appearance';
import { SessionProvider } from '@/lib/session/session-provider';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <AppearanceSync />
      {children}
    </SessionProvider>
  );
}
