/**
 * Entrada a Objetivos desde /wallet — P2.3.
 *
 * Va entre el perfil formativo y las credenciales. El perfil sigue siendo la
 * respuesta a "quien soy", que es la promesa de esa pantalla; el objetivo es la
 * pregunta siguiente, no la primera.
 *
 * "Ver mis objetivos" esta SIEMPRE visible. Condicionarlo a que exista al menos
 * uno obligaria a pedir la lista solo para decidir si se dibuja un link, y eso
 * agregaria una peticion y un salto de layout a la pantalla principal. La ruta
 * de lista ya tiene su estado vacio.
 *
 * El copy no promete P2.4: "Prepara un objetivo PARA analizar tu trayectoria".
 * El analisis de la trayectoria todavia no existe.
 */

import Link from 'next/link';

import { Button } from '@/components/ui/button';

export function ObjectiveEntryCard() {
  return (
    <section
      aria-labelledby="wallet-objectives-title"
      className="grid min-w-0 gap-5 border-t border-border-default pt-8"
    >
      <div className="min-w-0 max-w-2xl">
        <p className="text-sm font-semibold text-teal-700">Objetivos</p>
        <h2
          id="wallet-objectives-title"
          className="mt-1 text-2xl font-bold tracking-tight text-text-strong"
        >
          Prepara un objetivo para analizar tu trayectoria
        </h2>
        <p className="mt-2 text-sm leading-6 text-text-muted">
          Pega una busqueda laboral, una convocatoria o los requisitos de un programa.
          Scope va a identificar que pide para que puedas revisarlo antes de comparar
          tu trayectoria.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/wallet/objectives/new">Analizar un objetivo</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/wallet/objectives">Ver mis objetivos</Link>
        </Button>
      </div>
    </section>
  );
}
