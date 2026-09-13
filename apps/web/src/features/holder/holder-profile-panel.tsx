import { BrainCircuit, BookOpenCheck, ChevronDown, Landmark, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { HolderDeclaredTextList } from '@/features/holder/holder-content-lists';
import type { HolderProfileProvenanceVM, HolderProfileVM } from '@/models/holder';

const PRIMARY_AREAS_LIMIT = 6;
const PRIMARY_SKILLS_LIMIT = 12;

/** Kept for focused consumers; the wallet composes summary and detail separately. */
export function HolderProfilePanel({ profile }: { profile: HolderProfileVM }) {
  return (
    <section aria-labelledby="holder-profile-summary-title" className="grid min-w-0 gap-8">
      <HolderProfileSummary profile={profile} />
      <HolderProfileDetails profile={profile} />
    </section>
  );
}

export function HolderProfileSummary({ profile }: { profile: HolderProfileVM }) {
  return (
    <section aria-labelledby="holder-profile-summary-title" className="grid min-w-0 gap-6">
      <Card className="min-w-0 overflow-hidden border-brand-700 bg-brand-900 text-white shadow-sm">
        <div aria-hidden="true" className="h-1 bg-teal-600" />
        <CardHeader className="grid min-w-0 gap-8 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.42fr)] lg:items-end">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-4 lg:justify-start">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-control border border-white/15 bg-white/5 text-teal-100"><Sparkles aria-hidden="true" className="size-5" /></span>
              <Badge variant="secondary">Perfil disponible</Badge>
            </div>
            <h2 id="holder-profile-summary-title" className="mt-5 text-xl font-semibold">Resumen del perfil</h2>
            <p className="mt-3 max-w-[var(--traza-holder-narrative-width)] text-sm leading-6 text-brand-100/85">Reúne información de {profile.credentialsCount} credenciales{profile.totalOfficialHoursLabel ? ` y ${profile.totalOfficialHoursLabel}` : ''}. La confianza describe la fiabilidad del análisis disponible, no tu nivel de conocimiento.</p>
            {profile.narrative ? <p className="mt-4 max-w-[var(--traza-holder-narrative-width)] text-sm leading-6 text-brand-100">{profile.narrative}</p> : null}
            {profile.totalOfficialHoursLabel ? <p className="mt-2 max-w-[var(--traza-holder-narrative-width)] text-xs leading-5 text-brand-100/70">Suma de horas informadas por las credenciales emitidas. No representa una distribución por área.</p> : null}
          </div>
          <dl className="grid min-w-0 gap-4 border-t border-white/15 pt-5 text-sm lg:border-t-0 lg:border-l lg:pl-7 lg:pt-0">
            <Metric label="Credenciales" value={String(profile.credentialsCount)} />
            {profile.totalOfficialHoursLabel ? <Metric label="Horas oficiales declaradas" value={profile.totalOfficialHoursLabel} /> : null}
            {profile.confidenceLabel ? <Metric label="Contexto del análisis" value={profile.confidenceLabel} /> : null}
          </dl>
        </CardHeader>
      </Card>

      {profile.hoursCoverageNoticeLabel || profile.semanticCoverageNoticeLabel ? (
        <aside className="grid min-w-0 gap-2 rounded-control border border-amber-300 bg-amber-50 px-4 py-3.5 text-sm leading-6 text-amber-900 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-4">
          <p className="font-semibold">Cobertura del perfil</p>
          <div className="min-w-0">
            {profile.semanticCoverageNoticeLabel ? <p>{profile.semanticCoverageNoticeLabel}</p> : null}
            {profile.hoursCoverageNoticeLabel ? <p className={profile.semanticCoverageNoticeLabel ? 'mt-1' : ''}>{profile.hoursCoverageNoticeLabel}</p> : null}
            <p className="mt-1 text-amber-800">La distribución por áreas se muestra solo cuando existe evidencia suficiente.</p>
          </div>
        </aside>
      ) : null}
    </section>
  );
}

export function HolderProfileDetails({ profile }: { profile: HolderProfileVM }) {
  const hasDeclaredInstitutionalInfo = profile.emittedSkills.length > 0 || profile.emittedCompetencies.length > 0 || profile.emittedLearningOutcomes.length > 0;
  const hasVisibleProvenance = profile.areas.some((area) => area.provenance) || profile.skills.some((skill) => skill.provenance);
  const areas = profile.areas.map((area) => ({ key: area.label, label: area.label, metadata: area.estimatedHoursLabel, provenance: area.provenance ?? null }));
  const skills = profile.skills.map((skill) => ({ key: skill.label, label: skill.label, provenance: skill.provenance ?? null }));
  const concepts = profile.concepts.map((concept) => ({ key: concept, label: concept, provenance: null }));

  return (
    <section aria-labelledby="holder-profile-detail-title" className="grid min-w-0 gap-6 border-t border-border-default pt-8">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold text-teal-700">Tu trayectoria en detalle</p>
        <h2 id="holder-profile-detail-title" className="mt-1 text-2xl font-bold tracking-tight text-text-strong">Áreas y capacidades</h2>
        <p className="mt-2 text-sm leading-6 text-text-muted">Una vista resumida de los contenidos que aparecen en las credenciales y análisis disponibles.</p>
      </div>
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <ProfileList title="Áreas principales" icon={<BookOpenCheck aria-hidden="true" className="size-5" />} items={areas} limit={PRIMARY_AREAS_LIMIT} empty="Sin estimación horaria por área todavía." />
        <ProfileList title="Capacidades destacadas" icon={<BrainCircuit aria-hidden="true" className="size-5" />} items={skills} limit={PRIMARY_SKILLS_LIMIT} empty="Todavía no hay habilidades disponibles." />
      </div>
      {hasVisibleProvenance ? <p className="-mt-2 text-xs leading-5 text-text-muted">En las áreas y capacidades, <strong className="font-semibold text-text-strong">Emisor</strong> indica una interpretación revisada por el emisor, e <strong className="font-semibold text-text-strong">IA</strong> indica una interpretación realizada con inteligencia artificial.</p> : null}

      <details className="group min-w-0 rounded-card border border-border-default bg-surface shadow-xs">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 sm:px-6">
          Explorar el detalle del perfil
          <ChevronDown aria-hidden="true" className="size-4 text-text-muted transition group-open:rotate-180" />
        </summary>
        <div className="grid min-w-0 gap-6 border-t border-border-default px-5 py-5 sm:px-6 sm:py-6">
          {profile.areas.length > PRIMARY_AREAS_LIMIT ? <ProfileList title="Más áreas" icon={<BookOpenCheck aria-hidden="true" className="size-5" />} items={areas.slice(PRIMARY_AREAS_LIMIT)} empty="Sin áreas disponibles." /> : null}
          {profile.skills.length > PRIMARY_SKILLS_LIMIT ? <ProfileList title="Más capacidades" icon={<BrainCircuit aria-hidden="true" className="size-5" />} items={skills.slice(PRIMARY_SKILLS_LIMIT)} empty="Sin capacidades disponibles." /> : null}
          <ProfileList title="Conceptos relacionados" icon={<Sparkles aria-hidden="true" className="size-5" />} items={concepts} empty="Todavía no hay conceptos disponibles." />

          {hasDeclaredInstitutionalInfo ? (
            <details className="min-w-0 rounded-control border border-border-default bg-surface-muted">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">Información declarada por instituciones</summary>
              <div className="grid min-w-0 gap-5 border-t border-border-default px-4 py-4">
                <p className="text-sm leading-6 text-text-muted">Estos datos provienen de credenciales emitidas. No son una certificación de la IA ni reemplazan la interpretación asistida.</p>
                <HolderDeclaredTextList title="Habilidades declaradas" items={profile.emittedSkills} />
                <HolderDeclaredTextList title="Competencias declaradas" items={profile.emittedCompetencies} />
                <HolderDeclaredTextList title="Contenido adicional declarado" items={profile.emittedLearningOutcomes} />
              </div>
            </details>
          ) : null}

          <details className="min-w-0 rounded-control border border-border-default bg-surface-muted">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">Acerca de este perfil</summary>
            <div className="grid gap-3 border-t border-border-default px-4 py-4 text-sm leading-6 text-text-muted">
              <p>Resume áreas, habilidades y conceptos presentes en la información utilizada para construir el perfil.</p>
              {profile.reviewedInterpretationNoticeLabel ? <p>{profile.reviewedInterpretationNoticeLabel}</p> : null}
              {profile.confidenceLabel ? <p>Confianza del análisis: {profile.confidenceLabel}.</p> : null}
              {profile.qualityFlags.length > 0 ? <p>Observaciones: {profile.qualityFlags.join(', ')}.</p> : null}
              <p className="text-text-subtle">Actualizado el {profile.generatedAtLabel}.</p>
            </div>
          </details>
        </div>
      </details>
    </section>
  );
}

export function HolderProfileEmptyPanel({ action }: { action?: ReactNode }) {
  return <Card className="overflow-hidden border-border-strong"><div className="h-1 bg-amber-600" /><CardHeader><span className="flex size-11 items-center justify-center rounded-control bg-amber-100 text-amber-600"><BrainCircuit aria-hidden="true" className="size-5" /></span><div><h2 className="mt-2 text-xl font-semibold text-text-strong">Tu perfil todavía no está disponible</h2><p className="mt-2 text-sm leading-6 text-text-muted">Scope construye tu perfil a partir de las credenciales que te emiten. El análisis semántico lo enriquece con áreas, habilidades y conceptos cuando está disponible.</p>{action ? <div className="mt-4">{action}</div> : null}</div></CardHeader></Card>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-semibold tracking-wide text-brand-100/70 uppercase">{label}</dt><dd className="mt-1 break-words text-2xl font-bold text-white">{value}</dd></div>;
}

interface ProfileListItem { key: string; label: string; metadata?: string | null; provenance: HolderProfileProvenanceVM | null; }

function ProfileList({ title, icon, items, limit, empty }: { title: string; icon: ReactNode; items: ProfileListItem[]; limit?: number; empty: string }) {
  const visibleItems = limit === undefined ? items : items.slice(0, limit);
  const remaining = items.length - visibleItems.length;
  return <Card className="min-w-0 shadow-xs"><CardHeader className="flex-row items-center gap-3 border-b border-border-default pb-4"><span className="shrink-0 text-teal-700">{icon}</span><h3 className="min-w-0 text-lg font-semibold text-text-strong">{title}</h3></CardHeader><CardContent className="min-w-0 pt-5">{visibleItems.length > 0 ? <><ul className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-3">{visibleItems.map((item) => <li key={item.key} className="flex min-w-0 max-w-full flex-wrap items-center gap-2"><Badge variant="outline" className="max-w-full whitespace-normal break-words px-3 py-1.5 text-left">{item.label}{item.provenance ? <ProvenanceIndicator provenance={item.provenance} /> : null}</Badge>{item.metadata ? <span className="min-w-0 break-words text-xs leading-5 text-text-muted">{item.metadata}</span> : null}</li>)}</ul>{remaining > 0 ? <p className="mt-4 text-xs text-text-muted">+ {remaining} más en el detalle del perfil.</p> : null}</> : <p className="text-sm text-text-muted">{empty}</p>}</CardContent></Card>;
}

function ProvenanceIndicator({ provenance }: { provenance: HolderProfileProvenanceVM }) {
  return <>{provenance.issuerReviewedLabel ? <span className="ml-1 inline-flex items-center gap-0.5 rounded-pill bg-brand-700/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700" title={provenance.issuerReviewedLabel}><Landmark aria-hidden="true" className="size-2.5" />Emisor</span> : null}{provenance.aiInferredLabel ? <span className="ml-1 inline-flex items-center gap-0.5 rounded-pill bg-teal-700/10 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700" title={provenance.aiInferredLabel}><BrainCircuit aria-hidden="true" className="size-2.5" />IA</span> : null}</>;
}
