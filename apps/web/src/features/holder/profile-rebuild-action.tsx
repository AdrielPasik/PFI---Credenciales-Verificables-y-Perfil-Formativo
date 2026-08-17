'use client';

import { useState } from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { rebuildMyProfileRequest } from '@/lib/api/holder-api';
import { useSession } from '@/lib/session/session-provider';
import type { HolderProfileVM } from '@/models/holder';

interface ProfileRebuildActionProps {
  label?: string;
  onRebuilt: (profile: HolderProfileVM | null) => void;
}

// P1.1: fallback manual -- NUNCA la via principal (el perfil se mantiene
// automaticamente desde la emision, ver AutomaticProfileRebuildService).
// Reconstruye la proyeccion desde las credenciales emitidas y la
// semantica ya disponible -- nunca ejecuta IA, por eso el copy evita
// "generar"/"analizar". Mismo patron idle/loading/error que
// ProfileShareAction (disabled durante loading evita doble click; el
// exito se refleja actualizando el perfil mostrado, sin recargar la
// pagina).
export function ProfileRebuildAction({
  label = 'Actualizar perfil',
  onRebuilt
}: ProfileRebuildActionProps) {
  const { requestAuthenticated } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rebuild() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const profile = await rebuildMyProfileRequest(requestAuthenticated);
      onRebuilt(profile);
    } catch {
      setError('No pudimos actualizar tu perfil. Intentá nuevamente más tarde.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-3">
      <button
        type="button"
        className="w-fit rounded-control border border-border-strong px-4 py-2 text-sm font-semibold text-text-strong transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
        disabled={loading}
        onClick={() => void rebuild()}
      >
        {loading ? 'Actualizando…' : label}
      </button>
      {error ? (
        <FeedbackAlert variant="warning" title="No pudimos actualizar tu perfil">
          {error}
        </FeedbackAlert>
      ) : null}
    </div>
  );
}
