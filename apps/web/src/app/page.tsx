import {
  Accessibility,
  CircleDotDashed,
  Landmark,
  Layers3,
  type LucideIcon
} from 'lucide-react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { FoundationLandingShell } from '@/components/layout/foundation-landing-shell';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

interface FoundationPrinciple {
  description: string;
  icon: LucideIcon;
  title: string;
}

const foundationPrinciples: FoundationPrinciple[] = [
  {
    icon: Landmark,
    title: 'Institucional y comprensible',
    description:
      'La experiencia prioriza la trayectoria formativa antes que la complejidad técnica.'
  },
  {
    icon: Layers3,
    title: 'Sistema coherente',
    description:
      'Tokens compartidos y primitives code-owned sostienen una interfaz consistente.'
  },
  {
    icon: Accessibility,
    title: 'Accesible desde la base',
    description:
      'Jerarquía semántica, foco visible y adaptación responsive forman parte del foundation.'
  }
];

export default function HomePage() {
  return (
    <FoundationLandingShell>
      <section
        aria-labelledby="foundation-title"
        className="grid w-full items-start gap-6 py-8 sm:py-12 lg:grid-cols-[minmax(0,1.35fr)_minmax(19rem,0.65fr)] lg:gap-8 lg:py-16"
      >
        <Card className="overflow-hidden border-border-strong">
          <div aria-hidden="true" className="h-1 bg-brand-900" />
          <CardHeader className="gap-6 py-8 sm:p-10 lg:p-12">
            <Badge variant="secondary">
              <CircleDotDashed aria-hidden="true" />
              Base frontend en preparación
            </Badge>

            <div className="grid max-w-3xl gap-5">
              <h1
                id="foundation-title"
                className="text-3xl leading-tight font-bold tracking-tight text-text-strong text-balance sm:text-4xl lg:text-5xl"
              >
                Credenciales verificables para trayectorias formativas
                confiables.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-text-muted sm:text-lg">
                Traza es una plataforma para emitir, reunir y comprender
                evidencia formativa. Este portal está consolidando ahora su
                base técnica y visual.
              </p>
            </div>
          </CardHeader>

          <Separator />

          <CardContent className="pt-6 sm:pt-6 lg:px-12 lg:pb-10">
            <FeedbackAlert variant="information" title="Estado del portal">
              Esta versión valida la foundation visual, la accesibilidad y el
              comportamiento responsive. Todavía no incluye login ni
              operaciones sobre credenciales.
            </FeedbackAlert>
          </CardContent>
        </Card>

        <aside aria-labelledby="foundation-principles-title">
          <Card>
            <CardHeader>
              <Badge variant="outline">Criterios activos</Badge>
              <h2
                id="foundation-principles-title"
                className="text-xl leading-7 font-semibold text-text-strong"
              >
                Una base preparada para crecer
              </h2>
            </CardHeader>

            <CardContent>
              <ul className="grid">
                {foundationPrinciples.map((principle, index) => {
                  const Icon = principle.icon;

                  return (
                    <li key={principle.title}>
                      {index > 0 ? <Separator className="my-5" /> : null}
                      <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3">
                        <span
                          aria-hidden="true"
                          className="flex size-11 items-center justify-center rounded-control border border-border-default bg-surface-muted text-brand-700"
                        >
                          <Icon className="size-5" />
                        </span>
                        <div>
                          <h3 className="font-semibold text-text-strong">
                            {principle.title}
                          </h3>
                          <p className="mt-1 text-sm leading-6 text-text-muted">
                            {principle.description}
                          </p>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        </aside>
      </section>
    </FoundationLandingShell>
  );
}
