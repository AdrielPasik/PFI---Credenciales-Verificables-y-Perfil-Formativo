/**
 * Contrato interno congelado de Profile Embedding V1.
 *
 * Estas constantes describen solamente el artefacto de fuente. La composicion
 * de perfiles es una fase posterior y no se representa ni se calcula aca.
 */
export const PROFILE_EMBEDDING_REQUEST_SCHEMA_VERSION =
  'profile_embedding_source_request_v1';
export const PROFILE_EMBEDDING_RESPONSE_SCHEMA_VERSION =
  'profile_embedding_source_response_v1';
export const PROFILE_EMBEDDING_DEPENDENCY_FINGERPRINT_VERSION =
  'profile_embedding_dependency_fingerprint_v1';
export const PROFILE_EMBEDDING_COMPOSITION_POLICY_VERSION =
  'profile_embedding_composition_v1';

export const PROFILE_EMBEDDING_MODEL_ID = 'intfloat/multilingual-e5-small';
export const PROFILE_EMBEDDING_MODEL_REVISION =
  'fd1525a9fd15316a2d503bf26ab031a61d056e98';
export const PROFILE_EMBEDDING_DIMENSION = 384;
export const PROFILE_EMBEDDING_SOURCE_POLICY_VERSION = 'profile_embedding_source_v1';
export const PROFILE_EMBEDDING_LONG_TEXT_POLICY_VERSION =
  'area_embedding_long_text_policy_v1';
export const PROFILE_EMBEDDING_LONG_TEXT_POLICY_SHA256 =
  '1319e903ae818b2a0290dc3b952e7f4ca89a15621c4dc176b27fd0c7197f4cc1';
export const PROFILE_EMBEDDING_MAX_SOURCE_CHARACTERS = 30_000;

/**
 * Product flag shared by source generation and profile composition. Empty and
 * absent values are deliberately disabled so an undeclared runtime setting
 * cannot create embeddings or alter a structured profile rebuild.
 */
export function profileEmbeddingsEnabled(
  configured: string | undefined = process.env.PROFILE_EMBEDDINGS_ENABLED
): boolean {
  return configured?.trim().toLowerCase() === 'true';
}

export interface ProfileEmbeddingSourceResponse {
  readonly schemaVersion: typeof PROFILE_EMBEDDING_RESPONSE_SCHEMA_VERSION;
  readonly vector: readonly number[];
  readonly modelId: typeof PROFILE_EMBEDDING_MODEL_ID;
  readonly modelRevision: typeof PROFILE_EMBEDDING_MODEL_REVISION;
  readonly embeddingDimension: typeof PROFILE_EMBEDDING_DIMENSION;
  readonly sourcePolicyVersion: typeof PROFILE_EMBEDDING_SOURCE_POLICY_VERSION;
  readonly longTextPolicyVersion: typeof PROFILE_EMBEDDING_LONG_TEXT_POLICY_VERSION;
  readonly longTextPolicySha256: typeof PROFILE_EMBEDDING_LONG_TEXT_POLICY_SHA256;
}
