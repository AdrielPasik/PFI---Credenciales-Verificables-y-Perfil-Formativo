import type { Metadata } from 'next';

import { IssuerRoute } from '@/features/issuer-context/issuer-route';

export const metadata: Metadata = {
  title: 'Portal del emisor'
};

export default function IssuerPage() {
  return <IssuerRoute />;
}
