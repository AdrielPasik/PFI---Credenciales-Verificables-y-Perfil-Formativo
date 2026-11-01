'use client';

import { DeadEndPage } from '@/components/feedback/dead-end-page';
import { Button } from '@/components/ui/button';

/**
 * Error inesperado de render. No muestra el mensaje tecnico: no le sirve a la
 * persona y podria filtrar detalles internos.
 */
export default function RouteError({ reset }: { error: Error; reset: () => void }) {
  return (
    <DeadEndPage
      title="Algo salió mal"
      description="No pudimos mostrar esta pantalla. Podés intentarlo de nuevo o volver al inicio."
      extraAction={
        <Button type="button" onClick={reset}>
          Intentar de nuevo
        </Button>
      }
    />
  );
}
