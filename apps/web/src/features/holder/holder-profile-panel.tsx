import { BrainCircuit, BookOpenCheck, Landmark, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { HolderProfileVM } from '@/models/holder';

export function HolderProfilePanel({ profile }: { profile: HolderProfileVM }) {
  const hasDeclaredInstitutionalInfo =
    profile.emittedSkills.length > 0 ||
    profile.emittedCompetencies.length > 0 ||
    profile.emittedLearningOutcomes.length > 0;

  return (
    <section aria-labelledby="holder-profile-summary-title" className="grid gap-5">
      <Card className="overflow-hidden border-brand-700 bg-brand-900 text-white shadow-sm">
        <CardHeader className="gap-4 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-control border border-white/15 bg-white/5 text-teal-100"><Sparkles aria-hidden="true" className="size-5" /></span>
            <Badge variant="secondary">Perfil disponible</Badge>
          </div>
          <div>
            <h2 id="holder-profile-summary-title" className="text-xl font-semibold">Resumen del perfil</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-brand-100/85">Reúne información de {profile.credentialsCount} credenciales{profile.totalOfficialHoursLabel ? ` y ${profile.totalOfficialHoursLabel}` : ''}. La confianza describe la fiabilidad del análisis disponible, no tu nivel de conocimiento.</p>
            {profile.totalOfficialHoursLabel ? <p className="mt-2 max-w-2xl text-xs leading-5 text-brand-100/70">Suma de horas informadas por las credenciales emitidas. No representa una distribución por área.</p> : null}
          </div>
        </CardHeader>
      </Card>

      {profile.hoursCoverageNoticeLabel || profile.semanticCoverageNoticeLabel ? (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="pt-5 text-sm leading-6 text-amber-900 sm:pt-6">
            <p className="font-semibold">Cobertura del perfil</p>
            {profile.semanticCoverageNoticeLabel ? <p className="mt-2">{profile.semanticCoverageNoticeLabel}</p> : null}
            {profile.hoursCoverageNoticeLabel ? <p className="mt-2">{profile.hoursCoverageNoticeLabel}</p> : null}
            <p className="mt-2 text-amber-800">La distribución por áreas se muestra solo cuando existe evidencia suficiente.</p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <ProfileList title="Áreas principales" icon={<BookOpenCheck aria-hidden="true" className="size-5" />} items={profile.areas.map((area) => area.estimatedHoursLabel ? `${area.label} · ${area.estimatedHoursLabel}` : area.label)} empty="Sin estimación horaria por área todavía." />
        <ProfileList title="Habilidades del perfil" icon={<BrainCircuit aria-hidden="true" className="size-5" />} items={profile.skills.map((skill) => skill.label)} empty="Todavía no hay habilidades disponibles." />
      </div>
      <ProfileList title="Conceptos relevantes" icon={<Sparkles aria-hidden="true" className="size-5" />} items={profile.concepts} empty="Todavía no hay conceptos disponibles." />
      {hasDeclaredInstitutionalInfo ? (
        <Card>
          <CardHeader className="flex-row items-center gap-3 pb-4">
            <span className="text-teal-700"><Landmark aria-hidden="true" className="size-5" /></span>
            <div>
              <h2 className="text-lg font-semibold text-text-strong">Información declarada por instituciones</h2>
              <p className="mt-1 text-sm leading-6 text-text-muted">Estos datos provienen de credenciales emitidas. No son una certificación de la IA ni reemplazan la interpretación asistida.</p>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5">
            {profile.emittedSkills.length > 0 ? <DeclaredBlock title="Habilidades declaradas" items={profile.emittedSkills} /> : null}
            {profile.emittedCompetencies.length > 0 ? <DeclaredBlock title="Competencias declaradas" items={profile.emittedCompetencies} /> : null}
            {profile.emittedLearningOutcomes.length > 0 ? <DeclaredBlock title="Resultados de aprendizaje declarados" items={profile.emittedLearningOutcomes} /> : null}
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardContent className="pt-5 text-sm leading-6 text-text-muted sm:pt-6">
          <p><strong className="text-text-strong">Cómo se construye este perfil.</strong> Resume áreas, habilidades y conceptos presentes en la información utilizada para construir el perfil.</p>
          {profile.confidenceLabel ? <p className="mt-3">Confianza del análisis: {profile.confidenceLabel}.</p> : null}
          {profile.qualityFlags.length > 0 ? <p className="mt-3">Observaciones: {profile.qualityFlags.join(', ')}.</p> : null}
          <p className="mt-3 text-text-subtle">Actualizado el {profile.generatedAtLabel}.</p>
        </CardContent>
      </Card>
    </section>
  );
}

export function HolderProfileEmptyPanel() {
  return <Card className="overflow-hidden border-border-strong"><div className="h-1 bg-amber-600" /><CardHeader><span className="flex size-11 items-center justify-center rounded-control bg-amber-100 text-amber-600"><BrainCircuit aria-hidden="true" className="size-5" /></span><div><h2 className="mt-2 text-xl font-semibold text-text-strong">Tu perfil todavía no está disponible</h2><p className="mt-2 text-sm leading-6 text-text-muted">A medida que tus credenciales cuenten con información formativa analizable, Traza podrá organizar un resumen de áreas, habilidades y conceptos.</p></div></CardHeader></Card>;
}

function ProfileList({ title, icon, items, empty }: { title: string; icon: ReactNode; items: string[]; empty: string }) {
  return <Card><CardHeader className="flex-row items-center gap-3 pb-4"><span className="text-teal-700">{icon}</span><h2 className="text-lg font-semibold text-text-strong">{title}</h2></CardHeader><CardContent>{items.length > 0 ? <ul className="flex flex-wrap gap-2">{items.map((item) => <li key={item}><Badge variant="outline">{item}</Badge></li>)}</ul> : <p className="text-sm text-text-muted">{empty}</p>}</CardContent></Card>;
}

function DeclaredBlock({ title, items }: { title: string; items: string[] }) {
  return <div><h3 className="text-sm font-semibold text-text-strong">{title}</h3><ul className="mt-2 flex flex-wrap gap-2">{items.map((item) => <li key={item}><Badge variant="outline">{item}</Badge></li>)}</ul></div>;
}
