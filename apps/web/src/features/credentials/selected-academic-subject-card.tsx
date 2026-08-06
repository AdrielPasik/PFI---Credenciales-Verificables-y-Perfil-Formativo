import { BookOpenCheck, GraduationCap } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

interface SelectedAcademicSubjectCardProps {
  code: string;
  description: string | null;
  hours: string | null;
  name: string;
  programCode?: string | null;
  programName: string | null;
  state: 'persisted' | 'pending' | 'creation';
}

export function SelectedAcademicSubjectCard({
  code,
  description,
  hours,
  name,
  programCode,
  programName,
  state
}: SelectedAcademicSubjectCardProps) {
  const highlighted = state === 'pending' || state === 'creation';
  const stateLabel =
    state === 'persisted'
      ? 'Selección guardada'
      : state === 'pending'
        ? 'Selección pendiente'
        : 'Materia seleccionada';

  return (
    <Card className={highlighted ? 'border-teal-600 bg-teal-100/45 shadow-none' : 'border-border-strong shadow-none'}>
      <CardContent className="grid gap-4 pt-5 sm:pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Badge variant="outline" className={highlighted ? 'border-teal-600/30 bg-surface text-teal-700' : undefined}>
              {stateLabel}
            </Badge>
            <h4 className="mt-3 text-lg font-semibold text-text-strong">{name}</h4>
            <p className="mt-1 text-sm font-semibold text-text-muted">Código {code}</p>
          </div>
          <BookOpenCheck aria-hidden="true" className="size-6 shrink-0 text-teal-700" />
        </div>

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="flex items-center gap-2 font-semibold text-text-muted">
              <GraduationCap aria-hidden="true" className="size-4" />
              Carrera seleccionada
            </dt>
            <dd className="mt-1 text-text-strong">
              {programName ?? 'No disponible'}
              {programCode ? (
                <span className="mt-1 block text-xs font-semibold text-text-muted">
                  Código {programCode}
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-text-muted">Horas oficiales</dt>
            <dd className="mt-1 text-text-strong">{hours ?? 'No disponible en el catálogo'}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="font-semibold text-text-muted">Descripción oficial</dt>
            <dd className="mt-1 leading-6 text-text-strong">{description ?? 'No disponible en el catálogo'}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
