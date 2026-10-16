/**
 * Proyeccion PUBLICA del `proof` -- S8 cierre de Base Sepolia.
 *
 * `Credential.proof` es una columna JSON. Se expone por una ALLOWLIST EXPLICITA
 * de las ocho claves del contrato `scope-proof-v1`, y solo si todas estan y son
 * texto. Nunca se serializa el JSON de la base tal cual: una clave extra que
 * alguien agregue a la columna en el futuro no puede salir por la API publica.
 *
 * Es material PUBLICO por construccion: una firma sobre un compromiso
 * canonico y los metadatos para verificarla. No lleva direccion del signer,
 * `secretRef`, material de clave ni ningun dato de la cuenta.
 */

export interface PublicVerificationProofDto {
  type: string;
  profile: string;
  cryptosuite: string;
  proofPurpose: string;
  verificationMethod: string;
  canonicalizationVersion: string;
  hashAlgorithm: string;
  proofValue: string;
}

const PUBLIC_PROOF_KEYS = [
  'type',
  'profile',
  'cryptosuite',
  'proofPurpose',
  'verificationMethod',
  'canonicalizationVersion',
  'hashAlgorithm',
  'proofValue'
] as const;

export function projectPublicProof(
  value: unknown
): PublicVerificationProofDto | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const source = value as Record<string, unknown>;
  const projected: Record<string, string> = {};

  for (const key of PUBLIC_PROOF_KEYS) {
    const entry = source[key];
    if (typeof entry !== 'string' || entry.length === 0) {
      return null;
    }
    projected[key] = entry;
  }

  return projected as unknown as PublicVerificationProofDto;
}
