import type { Metadata } from 'next';

import { PublicProfileShareRoute } from '@/features/holder/public-profile-share-route';

/**
 * Misma regla que la ruta de analisis: el token ES la autorizacion, asi que esta
 * pagina no puede indexarse. Ponerlo solo en la ruta hija no protegeria esta.
 */
export const metadata: Metadata = {
  title: 'Perfil compartido',
  robots: { index: false, follow: false }
};

export default async function SharedProfilePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicProfileShareRoute token={token} />;
}
