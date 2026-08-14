import { PublicProfileShareRoute } from '@/features/holder/public-profile-share-route';

export default async function SharedProfilePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicProfileShareRoute token={token} />;
}
