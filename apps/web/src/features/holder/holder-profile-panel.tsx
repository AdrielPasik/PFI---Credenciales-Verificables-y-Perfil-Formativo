import { BrainCircuit, BookOpenCheck, ChevronDown, Landmark, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { HolderDeclaredTextList } from '@/features/holder/holder-content-lists';
import type { HolderProfileProvenanceVM, HolderProfileVM } from '@/models/holder';

const PRIMARY_AREAS_LIMIT = 6;
const PRIMARY_SKILLS_LIMIT = 12;

/**
 * Resumen del perfil para la banda de bienvenida del titular (superficie
 * invertida): narrativa, aclaraciones prudentes y metricas principales.
 */
export function HolderProfileIntro({ profile }: { profile: HolderProfileVM }) {
  return (
    <div className="grid gap-2">
      {profile.narrative ? <p className="max-w-[var(--traza-holder-narrative-width)] leading-7 text-brand-100">{profile.narrative}</p> : null}
      <p className="max-w-[var(--traza-holder-narrative-width)] text-sm leading-6 text-brand-100/90">Reúne información de {profile.credentialsCount} credenciales{profile.totalOfficialHoursLabel ? ` y ${profile.totalOfficialHoursLabel}` : ''}. La confianza describe la fiabilidad del análisis disponible, no tu nivel de conocimiento.</p>
    </div>
  );
}

export function HolderProfileMetrics({ profile }: { profile: HolderProfileVM }) {
  return (
    <div className="grid gap-3">
      <dl className="flex flex-wrap gap-x-10 gap-y-4">
        <Metric label="Credenciales" value={String(profile.credentialsCount)} />
        {profile.totalOfficialHoursLabel ? <Metric label="Horas oficiales declaradas" value={profile.totalOfficialHoursValue ? `${profile.totalOfficialHoursValue} h` : profile.totalOfficialHoursLabel} /> : null}
        {profile.areas.length > 0 ? <Metric label="Áreas del perfil" value={String(profile.areas.length)} /> : null}
      </dl>
      {profile.totalOfficialHoursLabel ? <p className="text-xs leading-5 text-brand-100/90">Suma de horas informadas por las credenciales emitidas. No representa una distribución por área.</p> : null}
    </div>
  );
}

export function HolderProfileCoverageNotice({ profile }: { profile: HolderProfileVM }) {
  if (!profile.hoursCoverageNoticeLabel && !profile.semanticCoverageNoticeLabel) return null;
  return (
    <aside className="grid min-w-0 gap-2 rounded-control border border-status-warning/40 bg-status-warning-soft px-4 py-3.5 text-sm leading-6 text-status-warning shadow-card sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-4">
      <p className="font-semibold">Cobertura del perfil</p>
      <div className="min-w-0">
        {profile.semanticCoverageNoticeLabel ? <p>{profile.semanticCoverageNoticeLabel}</p> : null}
        {profile.hoursCoverageNoticeLabel ? <p className={profile.semanticCoverageNoticeLabel ? 'mt-1' : ''}>{profile.hoursCoverageNoticeLabel}</p> : null}
        <p className="mt-1 text-status-warning">La distribución por áreas se muestra solo cuando existe evidencia suficiente.</p>
      </div>
    </aside>
  );
}

export function HolderProfileDetails({ profile }: { profile: HolderProfileVM }) {
  const hasDeclaredInstitutionalInfo = profile.emittedSkills.length > 0 || profile.emittedCompetencies.length > 0 || profile.emittedLearningOutcomes.length > 0;
  const hasVisibleProvenance = profile.areas.some((area) => area.provenance) || profile.skills.some((skill) => skill.provenance);
  const areas = profile.areas.map((area) => ({ key: area.label, label: area.label, metadata: area.estimatedHoursLabel, provenance: area.provenance ?? null }));
  const skills = profile.skills.map((skill) => ({ key: skill.label, label: skill.label, provenance: skill.provenance ?? null }));
  const concepts = profile.concepts.map((concept) => ({ key: concept, label: concept, provenance: null }));

  return (
    <section aria-labelledby="holder-profile-detail-title" className="rule-accent grid min-w-0 gap-6 border-t border-border-default pt-8">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold text-accent">Tu trayectoria en detalle</p>
        <h2 id="holder-profile-detail-title" className="mt-1 text-2xl font-bold tracking-tight text-text-strong">Áreas y habilidades</h2>
        <p className="mt-2 text-sm leading-6 text-text-muted">Una vista resumida de los contenidos que aparecen en las credenciales y análisis disponibles.</p>
      </div>
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <ProfileList title="Áreas principales" icon={<BookOpenCheck aria-hidden="true" className="size-5" />} items={areas} limit={PRIMARY_AREAS_LIMIT} empty="Sin estimación horaria por área todavía." />
        <ProfileList title="Habilidades identificadas" icon={<BrainCircuit aria-hidden="true" className="size-5" />} items={skills} limit={PRIMARY_SKILLS_LIMIT} empty="Todavía no hay habilidades disponibles." />
      </div>
      {hasVisibleProvenance ? <p className="-mt-2 text-xs leading-5 text-text-muted">En las áreas y habilidades, <strong className="font-semibold text-text-strong">Emisor</strong> indica una interpretación revisada por el emisor, e <strong className="font-semibold text-text-strong">IA</strong> indica una interpretación realizada con inteligencia artificial.</p> : null}

      <details className="group min-w-0 rounded-card border border-border-default bg-surface shadow-xs">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring sm:px-6">
          Explorar el detalle del perfil
          <ChevronDown aria-hidden="true" className="size-4 text-text-muted transition group-open:rotate-180" />
        </summary>
        <div className="grid min-w-0 gap-6 border-t border-border-default px-5 py-5 sm:px-6 sm:py-6">
          {profile.areas.length > PRIMARY_AREAS_LIMIT ? <ProfileList title="Más áreas" icon={<BookOpenCheck aria-hidden="true" className="size-5" />} items={areas.slice(PRIMARY_AREAS_LIMIT)} empty="Sin áreas disponibles." /> : null}
          {profile.skills.length > PRIMARY_SKILLS_LIMIT ? <ProfileList title="Más habilidades" icon={<BrainCircuit aria-hidden="true" className="size-5" />} items={skills.slice(PRIMARY_SKILLS_LIMIT)} empty="Sin habilidades disponibles." /> : null}
          <ProfileList title="Conceptos relacionados" icon={<Sparkles aria-hidden="true" className="size-5" />} items={concepts} empty="Todavía no hay conceptos disponibles." />

          {hasDeclaredInstitutionalInfo ? (
            <details className="min-w-0 rounded-control border border-border-default bg-surface-muted">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">Información declarada por instituciones</summary>
              <div className="grid min-w-0 gap-5 border-t border-border-default px-4 py-4">
                <p className="text-sm leading-6 text-text-muted">Estos datos provienen de credenciales emitidas. No son una certificación de la IA ni reemplazan la interpretación asistida.</p>
                <HolderDeclaredTextList title="Habilidades declaradas" items={profile.emittedSkills} />
                <HolderDeclaredTextList title="Competencias declaradas" items={profile.emittedCompetencies} />
                <HolderDeclaredTextList title="Contenido adicional declarado" items={profile.emittedLearningOutcomes} />
              </div>
            </details>
          ) : null}

          <details className="min-w-0 rounded-control border border-border-default bg-surface-muted">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">Acerca de este perfil</summary>
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
  return <Card className="overflow-hidden border-border-strong"><div className="h-1 bg-amber-600" /><CardHeader><span className="flex size-11 items-center justify-center rounded-control bg-status-warning-soft text-status-warning"><BrainCircuit aria-hidden="true" className="size-5" /></span><div><h2 className="mt-2 text-xl font-semibold text-text-strong">Tu perfil todavía no está disponible</h2><p className="mt-2 text-sm leading-6 text-text-muted">Scope construye tu perfil a partir de las credenciales que te emiten. El análisis semántico lo enriquece con áreas, habilidades y conceptos cuando está disponible.</p>{action ? <div className="mt-4">{action}</div> : null}</div></CardHeader></Card>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-col-reverse"><dt className="text-xs font-semibold tracking-wide text-brand-100/90 uppercase">{label}</dt><dd className="break-words text-2xl font-bold text-white sm:text-3xl">{value}</dd></div>;
}

interface ProfileListItem { key: string; label: string; metadata?: string | null; provenance: HolderProfileProvenanceVM | null; }

function ProfileList({ title, icon, items, limit, empty }: { title: string; icon: ReactNode; items: ProfileListItem[]; limit?: number; empty: string }) {
  const visibleItems = limit === undefined ? items : items.slice(0, limit);
  const remaining = items.length - visibleItems.length;
  return <Card className="min-w-0"><CardHeader className="flex-row items-center gap-3 border-b border-border-default pb-4"><span className="shrink-0 text-accent">{icon}</span><h3 className="min-w-0 text-lg font-semibold text-text-strong">{title}</h3></CardHeader><CardContent className="min-w-0 pt-5">{visibleItems.length > 0 ? <><ul className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-3">{visibleItems.map((item) => <li key={item.key} className="flex min-w-0 max-w-full flex-wrap items-center gap-2"><Badge variant="outline" className="max-w-full whitespace-normal break-words px-3 py-1.5 text-left">{item.label}{item.provenance ? <ProvenanceIndicator provenance={item.provenance} /> : null}</Badge>{item.metadata ? <span className="min-w-0 break-words text-xs leading-5 text-text-muted">{item.metadata}</span> : null}</li>)}</ul>{remaining > 0 ? <p className="mt-4 text-xs text-text-muted">+ {remaining} más en el detalle del perfil.</p> : null}</> : <p className="text-sm text-text-muted">{empty}</p>}</CardContent></Card>;
}

function ProvenanceIndicator({ provenance }: { provenance: HolderProfileProvenanceVM }) {
  return <>{provenance.issuerReviewedLabel ? <span className="ml-1 inline-flex items-center gap-0.5 rounded-pill bg-link/10 px-1.5 py-0.5 text-[10px] font-semibold text-link" title={provenance.issuerReviewedLabel}><Landmark aria-hidden="true" className="size-2.5" />Emisor</span> : null}{provenance.aiInferredLabel ? <span className="ml-1 inline-flex items-center gap-0.5 rounded-pill bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent" title={provenance.aiInferredLabel}><BrainCircuit aria-hidden="true" className="size-2.5" />IA</span> : null}</>;
}
