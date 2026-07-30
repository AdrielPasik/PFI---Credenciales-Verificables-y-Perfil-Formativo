import type { Metadata } from 'next';

import { NewCredentialRoute } from '@/features/credentials/new-credential-route';

export const metadata: Metadata = {
  title: 'Nueva credencial'
};

export default function NewCredentialPage() {
  return <NewCredentialRoute />;
}
