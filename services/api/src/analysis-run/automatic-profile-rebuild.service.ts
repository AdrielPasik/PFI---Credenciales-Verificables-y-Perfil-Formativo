import { Injectable, Logger } from '@nestjs/common';

import { FormativeProfileService } from '../profiles/formative-profile.service';

// P1.1: 'reason' es puramente observabilidad/logging -- nunca persistido,
// nunca cambia el comportamiento de rebuildForUser ni de este servicio.
// Se agregan valores nuevos aca a medida que aparecen callers reales
// (nunca especulativos): 'post_issuance' (P1.1), 'post_automatic_analysis'
// (C2b.4, ya existia sin nombre explicito) y
// 'post_reviewed_interpretation_apply' (C5b.1, ya existia sin nombre
// explicito). No se agrega 'post_revocation' todavia -- P1.1 audito
// services/api/src completo y confirmo que NO existe hoy ningun
// endpoint/service que transicione una Credential a `revoked` (el unico
// archivo relacionado, blockchain/scripts/revoke-credential-on-registry.ts,
// es un script CLI que solo llama al contrato on-chain, nunca escribe
// Prisma) -- agregar ese reason ahora seria un valor sin ningun caller
// real. Ver p11-*-review-bundle.txt seccion sobre revocacion.
export type ProfileRebuildReason =
  | 'post_issuance'
  | 'post_automatic_analysis'
  | 'post_reviewed_interpretation_apply';

export interface AutomaticProfileRebuildInput {
  credentialId: string;
  holderUserId: string;
  analysisRunId?: string;
}

export interface RebuildBestEffortInput {
  holderUserId: string;
  credentialId?: string;
  reason: ProfileRebuildReason;
  analysisRunId?: string;
}

export type AutomaticProfileRebuildResult =
  | { status: 'rebuilt' }
  | { status: 'failed'; errorCode: 'formative_profile_rebuild_failed' };

/**
 * C2b.4/P1.1: frontera unica de rebuild best-effort de
 * `FormativeProfileService.rebuildForUser(...)`. Nunca lanza: cualquier
 * error se atrapa y se loguea de forma segura -- el evento de dominio que
 * dispara el rebuild (emision, analisis automatico completado, apply de
 * interpretacion revisada) ya quedo commiteado antes de que el caller
 * invoque este servicio; un fallo aca nunca debe poder revertirlo.
 *
 * No llama IA (delega integramente en `FormativeProfileService.
 * rebuildForUser`, que solo lee/escribe Postgres). No toca canon, hash ni
 * blockchain. No cambia la logica semantica del perfil (distribucion de
 * horas/skills/areas/concepts) -- eso es C2c, fuera de alcance aca.
 *
 * `rebuildBestEffort` es la unica implementacion real -- los metodos
 * `rebuildAfterXxx` son wrappers finos, semanticamente explicitos, que
 * fijan `reason` para observabilidad y evitan que cada caller arme el
 * input a mano. Nunca duplican el try/catch.
 */
@Injectable()
export class AutomaticProfileRebuildService {
  private readonly logger = new Logger(AutomaticProfileRebuildService.name);

  constructor(
    private readonly formativeProfileService: FormativeProfileService
  ) {}

  async rebuildBestEffort(
    input: RebuildBestEffortInput
  ): Promise<AutomaticProfileRebuildResult> {
    try {
      await this.formativeProfileService.rebuildForUser(input.holderUserId);
      return { status: 'rebuilt' };
    } catch (error: unknown) {
      this.logSafeFailure(input, error);
      return {
        status: 'failed',
        errorCode: 'formative_profile_rebuild_failed'
      };
    }
  }

  // C2b.4: dispara tras un analisis automatico (trigger=system) completado
  // con exito. Call-sites productivos: AutomaticDocumentAnalysisService,
  // AutomaticCourseTextAnalysisService.
  async rebuildAfterAutomaticAnalysis(
    input: AutomaticProfileRebuildInput
  ): Promise<AutomaticProfileRebuildResult> {
    return this.rebuildBestEffort({
      ...input,
      reason: 'post_automatic_analysis'
    });
  }

  // P1.1: dispara inmediatamente despues de que una emision termina
  // `issued` -- independiente de si algun analisis automatico llega a
  // correr o completar. Call-site productivo:
  // IssuerCredentialIssueService.issueForIssuer.
  async rebuildAfterIssuance(input: {
    credentialId: string;
    holderUserId: string;
  }): Promise<AutomaticProfileRebuildResult> {
    return this.rebuildBestEffort({ ...input, reason: 'post_issuance' });
  }

  // C5b.1: dispara tras aplicar una interpretacion semantica revisada por
  // el issuer (incluido un apply idempotente, changed:false). Call-site
  // productivo: ReusableSemanticInterpretationService.
  async rebuildAfterReviewedInterpretationApply(input: {
    credentialId: string;
    holderUserId: string;
  }): Promise<AutomaticProfileRebuildResult> {
    return this.rebuildBestEffort({
      ...input,
      reason: 'post_reviewed_interpretation_apply'
    });
  }

  private logSafeFailure(input: RebuildBestEffortInput, error: unknown): void {
    // Un mensaje de excepción puede contener una referencia interna. El
    // código estable permite diagnosticar sin registrar contenido, secretos
    // ni datos del titular.
    void error;
    this.logger.error(
      JSON.stringify({
        event: 'automatic_profile_rebuild_failed',
        errorCode: 'formative_profile_rebuild_failed',
        reason: input.reason,
        credentialId: input.credentialId ?? null,
        holderUserId: input.holderUserId,
        analysisRunId: input.analysisRunId ?? null
      })
    );
  }
}
