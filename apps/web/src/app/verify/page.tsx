import { Suspense } from 'react';

import { PublicVerificationRoute } from '@/features/public-verification/public-verification-route';

export default function VerifyPage() {
  return <Suspense><PublicVerificationRoute /></Suspense>;
}
