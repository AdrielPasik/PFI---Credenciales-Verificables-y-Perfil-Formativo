import type { Metadata } from 'next';

import { InstitutionalAccessPendingRoute } from '@/features/onboarding/institutional-access-pending-route';

export const metadata: Metadata = { title: 'Acceso institucional pendiente' };

export default function InstitutionalAccessPendingPage() {
  return <InstitutionalAccessPendingRoute />;
}
