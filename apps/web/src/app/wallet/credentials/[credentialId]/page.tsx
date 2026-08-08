import type { Metadata } from 'next';

import { WalletCredentialDetailRoute } from '@/features/holder/wallet-credential-detail-route';

export const metadata: Metadata = { title: 'Credencial formativa' };

export default function WalletCredentialDetailPage() { return <WalletCredentialDetailRoute />; }
