import { HttpException, Injectable, Logger } from '@nestjs/common';

import { FormativeProfileService } from '../profiles/formative-profile.service';

export interface AutomaticProfileRebuildInput {
  credentialId: string;
  holderUserId: string;
  analysisRunId?: string;
}

/**
 * C2b.4: dispara `FormativeProfileService.rebuildForUser(...)` de forma
 * best-effort despues de que un analisis automatico (documental o
 * textual) termina `completed` y ya persistio un `SemanticAnalysis`.
 *
 * Nunca lanza: cualquier error se atrapa y se loguea de forma segura. El
 * `AnalysisRun` ya quedo `completed` antes de que el caller invoque este
 * servicio -- un fallo aca nunca debe poder revertir eso ni la emision.
 *
 * No llama IA (delega integramente en `FormativeProfileService.
 * rebuildForUser`, que solo lee/escribe Postgres). No toca canon, hash ni
 * blockchain. No cambia la logica semantica del perfil (distribucion de
 * horas/skills/areas/concepts) -- eso es C2c, fuera de alcance aca.
 */
@Injectable()
export class AutomaticProfileRebuildService {
  private readonly logger = new Logger(AutomaticProfileRebuildService.name);

  constructor(
    private readonly formativeProfileService: FormativeProfileService
  ) {}

  async rebuildAfterAutomaticAnalysis(
    input: AutomaticProfileRebuildInput
  ): Promise<void> {
    try {
      await this.formativeProfileService.rebuildForUser(input.holderUserId);
    } catch (error: unknown) {
      this.logSafeFailure(input, error);
    }
  }

  private logSafeFailure(
    input: AutomaticProfileRebuildInput,
    error: unknown
  ): void {
    // Igual criterio que AutomaticCourseTextAnalysisService.logSafeFailure:
    // solo el .message de una HttpException ya curada por otra capa (nunca
    // texto de analisis, PDF/storage path ni tokens), o un literal generico
    // para cualquier otro error no controlado.
    const reason =
      error instanceof HttpException ? error.message : 'unexpected_error';
    this.logger.error(
      JSON.stringify({
        event: 'automatic_profile_rebuild_failed',
        credentialId: input.credentialId,
        holderUserId: input.holderUserId,
        analysisRunId: input.analysisRunId ?? null,
        reason
      })
    );
  }
}
