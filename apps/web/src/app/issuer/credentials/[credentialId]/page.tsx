import type { Metadata } from 'next';

import { CredentialDetailRoute } from '@/features/credentials/credential-detail-route';

export const metadata: Metadata = {
  title: 'Detalle de credencial'
};

export default async function CredentialDetailPage({
  params
}: {
  params: Promise<{ credentialId: string }>;
}) {
  const { credentialId } = await params;

  return (
    <CredentialDetailRoute credentialReference={credentialId} />
  );
}
