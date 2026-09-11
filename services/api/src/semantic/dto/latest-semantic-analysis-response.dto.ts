/**
 * Respuesta de `GET /credentials/:id/semantic-analysis/latest`.
 *
 * ALLOWLIST EXPLICITA — F1.5. Lo que sale por aca es solamente el RESUMEN
 * revisable de un `SemanticAnalysis`, no la fila.
 *
 * Tres campos se quitaron deliberadamente en F1.5, y ninguno tenia consumidor
 * productivo (`apps/web/src/` no llama a esta ruta; el unico llamador real es el
 * script de demo, que usa `id` y `schemaVersion`):
 *
 *   analysisJson      el artifact `semantic_analysis_v1` CRUDO del pipeline IA.
 *                     Devolverlo contradice el principio que el propio modulo ya
 *                     declaraba: "el backend no debe consumir outputs crudos del
 *                     pipeline IA" (ver README.md de este modulo).
 *   textForEmbedding  texto derivado de la fuente, concatenado para embeddings.
 *                     Es material de la fuente, no un descriptor.
 *   evidenceMap       estructura interna de evidencia del pipeline.
 *
 * El handoff de frontend ya los listaba como "campos a descartar en el adapter"
 * (`docs/frontend/frontend-data-and-view-models-v0.md`), asi que dejarlos fuera
 * del backend alinea la API con el contrato de UI que ya existia, en vez de
 * confiar en que cada consumidor recuerde tirarlos.
 *
 * Cuando F2+ diseñe explicitamente una API de excerpts/citas para explicacion,
 * ese contrato se define alli. F1 no lo anticipa.
 */
export interface SemanticAnalysisLatestItemDto {
  id: string;
  schemaVersion: string;
  status: string;
  pipelineVersion: string;
  taxonomyVersion: string;
  confidence: number | null;
  /** Descriptores de taxonomia: `{ id, label, confidence }`. No llevan texto fuente. */
  areas: unknown[];
  skills: unknown[];
  concepts: unknown[];
  qualityFlags: string[];
  analyzedAt: string;
}

export interface CredentialLatestSemanticAnalysisResponseDto {
  credentialId: string;
  latestSemanticAnalysis: SemanticAnalysisLatestItemDto | null;
}
