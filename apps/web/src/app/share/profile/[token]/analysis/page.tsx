import type { Metadata } from 'next';

import { PublicAnalysisRoute } from '@/features/verifier/public-analysis-route';

/**
 * Pagina autorizada por token: nunca indexable. El enlace es la credencial de
 * acceso, asi que aparecer en un buscador lo volveria publico de verdad.
 */
export const metadata: Metadata = {
  title: 'Análisis de trayectoria',
  robots: { index: false, follow: false }
};

export default async function SharedProfileAnalysisPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PublicAnalysisRoute token={token} />;
}
