'use client';

import { IssuerHome } from '@/features/issuer-context/issuer-home';
import { IssuerRouteBoundary } from '@/features/issuer-context/issuer-route-boundary';

export function IssuerRoute() {
  return (
    <IssuerRouteBoundary>
      {(membership) => <IssuerHome membership={membership} />}
    </IssuerRouteBoundary>
  );
}
