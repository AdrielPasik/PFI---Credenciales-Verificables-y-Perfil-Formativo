'use client';

import { useState } from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { createProfileShareRequest } from '@/lib/api/profile-sharing-api';
import { useSession } from '@/lib/session/session-provider';
import type { ProfileShareLinkVM } from '@/models/profile-sharing';
import { PublicSharePanel } from './public-share-panel';

export function ProfileShareAction() {
  const { requestAuthenticated } = useSession();
  const [share, setShare] = useState<ProfileShareLinkVM | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createShare() {
    setLoading(true);
    setError(null);
    try {
      setShare(await createProfileShareRequest(requestAuthenticated));
    } catch {
      setError('No pudimos preparar un enlace para compartir tu perfil. Intentá nuevamente más tarde.');
    } finally {
      setLoading(false);
    }
  }

  if (share) {
    return <PublicSharePanel title="Compartir perfil" sharePath={share.sharePath} description="Cualquier persona con este enlace podrá ver una versión resumida y pública de tu perfil formativo. No incluye tu email ni evidencias crudas." />;
  }

  return <div className="grid gap-3"><button type="button" className="w-fit rounded-control border border-border-strong px-4 py-2 text-sm font-semibold text-text-strong transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700" disabled={loading} onClick={() => void createShare()}>{loading ? 'Preparando enlace…' : 'Compartir perfil'}</button>{error ? <FeedbackAlert variant="warning" title="No pudimos compartir el perfil">{error}</FeedbackAlert> : null}</div>;
}
