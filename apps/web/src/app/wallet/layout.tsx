import type { ReactNode } from 'react';

import { WalletRouteBoundary } from '@/features/holder/wallet-route-boundary';

export default function WalletLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <WalletRouteBoundary>{children}</WalletRouteBoundary>;
}
