import type { Metadata } from 'next';

import { WalletHomeRoute } from '@/features/holder/wallet-home-route';

export const metadata: Metadata = { title: 'Mi perfil formativo' };

export default function WalletPage() { return <WalletHomeRoute />; }
