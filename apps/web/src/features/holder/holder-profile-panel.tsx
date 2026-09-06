import { BrainCircuit, BookOpenCheck, Landmark, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { HolderDeclaredTextList } from '@/features/holder/holder-content-lists';
import type { HolderProfileProvenanceVM, HolderProfileVM } from '@/models/holder';

export function HolderProfilePanel({ profile }: { profile: HolderProfileVM }) {
  const hasDeclaredInstitutionalInfo =
    profile.emittedSkills.length > 0 ||
    profile.emittedCompetencies.length > 0 ||
    profile.emittedLearningOutcomes.length > 0;
  // C5b.2-R: la leyenda solo se muestra cuando hay al menos un indicador de
  // procedencia visible -- nunca "sin procedencia" para un perfil sin
  // provenance (seccion 8 del diseno).
  const hasVisibleProvenance =
    profile.areas.some((area) => area.provenance) ||
    profile.skills.some((skill) => skill.provenance);

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
            <div><dt className="text-xs font-semibold tracking-wide text-brand-100/70 uppercase">Credenciales</dt><dd className="mt-1 text-2xl font-bold text-white">{profile.credentialsCount}</dd></div>
            {profile.totalOfficialHoursLabel ? <div><dt className="text-xs font-semibold tracking-wide text-brand-100/70 uppercase">Horas oficiales declaradas</dt><dd className="mt-1 break-words font-semibold text-white">{profile.totalOfficialHoursLabel}</dd></div> : null}
            {profile.confidenceLabel ? <div><dt className="text-xs font-semibold tracking-wide text-brand-100/70 uppercase">Contexto del análisis</dt><dd className="mt-1 break-words text-brand-100">{profile.confidenceLabel}</dd></div> : null}
          </dl>
        </CardHeader>
      </Card>

      {profile.hoursCoverageNoticeLabel || profile.semanticCoverageNoticeLabel ? (
        <aside className="grid min-w-0 gap-2 rounded-control border border-amber-300 bg-amber-50 px-4 py-3.5 text-sm leading-6 text-amber-900 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-4">
          <p className="font-semibold">Cobertura del perfil</p>
          <div className="min-w-0"><>{profile.semanticCoverageNoticeLabel ? <p>{profile.semanticCoverageNoticeLabel}</p> : null}{profile.hoursCoverageNoticeLabel ? <p className={profile.semanticCoverageNoticeLabel ? 'mt-1' : ''}>{profile.hoursCoverageNoticeLabel}</p> : null}</><p className="mt-1 text-amber-800">La distribución por áreas se muestra solo cuando existe evidencia suficiente.</p></div>
        </aside>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <ProfileList
          title="Áreas principales"
          icon={<BookOpenCheck aria-hidden="true" className="size-5" />}
          items={profile.areas.map((area) => ({
            key: area.label,
            label: area.label,
            metadata: area.estimatedHoursLabel,
            provenance: area.provenance ?? null
          }))}
          empty="Sin estimación horaria por área todavía."
        />
        <ProfileList
          title="Habilidades del perfil"
          icon={<BrainCircuit aria-hidden="true" className="size-5" />}
          items={profile.skills.map((skill) => ({ key: skill.label, label: skill.label, provenance: skill.provenance ?? null }))}
          empty="Todavía no hay habilidades disponibles."
        />
      </div>
      {hasVisibleProvenance ? (
        <p className="-mt-2 text-xs leading-5 text-text-muted">
          En las áreas y habilidades, <strong className="font-semibold text-text-strong">Emisor</strong> indica una interpretación revisada por el emisor, e <strong className="font-semibold text-text-strong">IA</strong> indica una interpretación realizada con inteligencia artificial.
        </p>
      ) : null}
      <ProfileList
        title="Conceptos relevantes"
        icon={<Sparkles aria-hidden="true" className="size-5" />}
        items={profile.concepts.map((concept) => ({ key: concept, label: concept, provenance: null }))}
        empty="Todavía no hay conceptos disponibles."
      />
      {hasDeclaredInstitutionalInfo ? (
        <section className="min-w-0 rounded-card border border-border-default bg-surface shadow-xs">
          <div className="flex min-w-0 items-start gap-3 border-b border-border-default px-5 py-5 sm:px-7">
            <span className="text-teal-700"><Landmark aria-hidden="true" className="size-5" /></span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-text-strong">Información declarada por instituciones</h2>
              <p className="mt-1 text-sm leading-6 text-text-muted">Estos datos provienen de credenciales emitidas. No son una certificación de la IA ni reemplazan la interpretación asistida.</p>
            </div>
          </div>
          <div className="grid min-w-0 gap-5 px-5 py-5 sm:px-7 sm:py-6">
            <HolderDeclaredTextList title="Habilidades declaradas" items={profile.emittedSkills} />
            <HolderDeclaredTextList title="Competencias declaradas" items={profile.emittedCompetencies} />
            <HolderDeclaredTextList title="Contenido adicional declarado" items={profile.emittedLearningOutcomes} />
          </div>
        </section>
      ) : null}
      <Card>
        <CardContent className="pt-5 text-sm leading-6 text-text-muted sm:pt-6">
          <p><strong className="text-text-strong">Cómo se construye este perfil.</strong> Resume áreas, habilidades y conceptos presentes en la información utilizada para construir el perfil.</p>
          {profile.reviewedInterpretationNoticeLabel ? <p className="mt-3">{profile.reviewedInterpretationNoticeLabel}</p> : null}
          {profile.confidenceLabel ? <p className="mt-3">Confianza del análisis: {profile.confidenceLabel}.</p> : null}
          {profile.qualityFlags.length > 0 ? <p className="mt-3">Observaciones: {profile.qualityFlags.join(', ')}.</p> : null}
          <p className="mt-3 text-text-subtle">Actualizado el {profile.generatedAtLabel}.</p>
        </CardContent>
      </Card>
    </section>
  );
}

// P1.1: el copy anterior implicaba que el perfil esperaba "informacion
// analizable" para existir -- la auditoria P1 confirmo que eso es
// enganoso: una credencial emitida sin analisis YA puede formar parte de
// un perfil (ver domain-rules-v0.md seccion 27/28). El nuevo copy explica
// el mecanismo real: credenciales emitidas primero, analisis semantico
// como enriquecimiento posterior -- sin prometer que la IA siempre este
// disponible ni que el perfil quede "completo".
export function HolderProfileEmptyPanel({
  action
}: {
  // P1.1/seccion 24: solo se pasa cuando el holder YA tiene credenciales
  // issued (recuperacion del fallback manual) -- un holder sin ninguna
  // credencial no recibe accion, el empty state alcanza.
  action?: ReactNode;
}) {
  return <Card className="overflow-hidden border-border-strong"><div className="h-1 bg-amber-600" /><CardHeader><span className="flex size-11 items-center justify-center rounded-control bg-amber-100 text-amber-600"><BrainCircuit aria-hidden="true" className="size-5" /></span><div><h2 className="mt-2 text-xl font-semibold text-text-strong">Tu perfil todavía no está disponible</h2><p className="mt-2 text-sm leading-6 text-text-muted">Scope construye tu perfil a partir de las credenciales que te emiten. El análisis semántico lo enriquece con áreas, habilidades y conceptos cuando está disponible.</p>{action ? <div className="mt-4">{action}</div> : null}</div></CardHeader></Card>;
}

interface ProfileListItem {
  key: string;
  label: string;
  metadata?: string | null;
  provenance: HolderProfileProvenanceVM | null;
}

// C5b.2/seccion 9 del diseno: la provenance es secundaria en la jerarquia
// visual (1. label; 2. dato principal ya incluido en label; 3. provenance).
// Se muestra como un indicador chico dentro del mismo Badge -- nunca una
// tarjeta propia por item, para que no domine cuando hay muchas skills.
function ProfileList({ title, icon, items, empty }: { title: string; icon: ReactNode; items: ProfileListItem[]; empty: string }) {
  return <Card className="min-w-0 shadow-xs"><CardHeader className="flex-row items-center gap-3 border-b border-border-default pb-4"><span className="shrink-0 text-teal-700">{icon}</span><h2 className="min-w-0 text-lg font-semibold text-text-strong">{title}</h2></CardHeader><CardContent className="min-w-0 pt-5">{items.length > 0 ? <ul className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-3">{items.map((item) => <li key={item.key} className="flex min-w-0 max-w-full flex-wrap items-center gap-2"><Badge variant="outline" className="max-w-full whitespace-normal break-words px-3 py-1.5 text-left">{item.label}{item.provenance ? <ProvenanceIndicator provenance={item.provenance} /> : null}</Badge>{item.metadata ? <span className="min-w-0 break-words text-xs leading-5 text-text-muted">{item.metadata}</span> : null}</li>)}</ul> : <p className="text-sm text-text-muted">{empty}</p>}</CardContent></Card>;
}

// C5b.2-R: la procedencia debe poder comprenderse SIN hover/tooltip (mobile/
// touch no tiene hover). Cada pill lleva texto visible ("Emisor"/"IA") en el
// DOM, no solo un icono aria-hidden -- el icono es un refuerzo visual, nunca
// la unica pista. El detalle completo (con conteo, ej. "2 aportes revisados
// por el emisor") queda en `title` como complemento opcional para desktop,
// nunca como la unica explicacion (la leyenda de HolderProfilePanel ya
// define "Emisor"/"IA" de forma visible y persistente). No usa "verificado"
// -- esa palabra ya significa autenticidad/integridad de credencial en
// Scope.
function ProvenanceIndicator({ provenance }: { provenance: HolderProfileProvenanceVM }) {
  return (
    <>
      {provenance.issuerReviewedLabel ? (
        <span
          className="ml-1 inline-flex items-center gap-0.5 rounded-pill bg-brand-700/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700"
          title={provenance.issuerReviewedLabel}
        >
          <Landmark aria-hidden="true" className="size-2.5" />
          Emisor
        </span>
      ) : null}
      {provenance.aiInferredLabel ? (
        <span
          className="ml-1 inline-flex items-center gap-0.5 rounded-pill bg-teal-700/10 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700"
          title={provenance.aiInferredLabel}
        >
          <BrainCircuit aria-hidden="true" className="size-2.5" />
          IA
        </span>
      ) : null}
    </>
  );
}
