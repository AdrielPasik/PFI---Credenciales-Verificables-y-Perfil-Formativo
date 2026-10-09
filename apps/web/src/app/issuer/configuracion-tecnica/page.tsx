import type { Metadata } from 'next';

import { IssuerTechnicalIdentityRoute } from '@/features/issuer-technical-identity/issuer-technical-identity-route';

export const metadata: Metadata = {
  title: 'Configuración técnica'
};

export default function IssuerTechnicalConfigurationPage() {
  return <IssuerTechnicalIdentityRoute />;
}
