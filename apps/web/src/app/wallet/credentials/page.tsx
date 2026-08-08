import type { Metadata } from 'next';

import { WalletCredentialsRoute } from '@/features/holder/wallet-credentials-route';

export const metadata: Metadata = { title: 'Mis credenciales' };

export default function WalletCredentialsPage() { return <WalletCredentialsRoute />; }
