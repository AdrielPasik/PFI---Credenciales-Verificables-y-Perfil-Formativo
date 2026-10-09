import { CredentialType, type Prisma } from '@prisma/client';

/**
 * Politica de CAPACIDADES del issuer -- S8c9.
 *
 * `Issuer.allowedCredentialTypes` es politica de PLATAFORMA: que tipos de
 * credencial permite Scope que este issuer emita. No es identidad criptografica.
 *
 * Por eso cambiarla NO genera claves, NO rota signers, NO reescribe el DID, NO
 * toca `IssuerTechnicalIdentity` ni `SignerProfile` ni la historia de asercion,
 * y NO habla con ninguna red. Toca exactamente una columna.
 *
 * No hay ninguna ruta HTTP que la mute: ni del issuer, ni de PlatformAdmin. El
 * unico escritor es esta primitiva, invocada desde herramienta de operacion (y,
 * por conveniencia, desde el provisioning inicial, que reutiliza esta misma
 * validacion).
 */

const CREDENTIAL_TYPE_VALUES = Object.values(CredentialType) as string[];

/** Orden canonico persistido: el del enum. Determinista, sin semantica extra. */
const CANONICAL_ORDER = new Map(
  CREDENTIAL_TYPE_VALUES.map((value, index) => [value, index])
);

export class CapabilityPolicyError extends Error {
  readonly code: 'ISSUER_NOT_FOUND' | 'INVALID_CREDENTIAL_TYPE';

  constructor(code: 'ISSUER_NOT_FOUND' | 'INVALID_CREDENTIAL_TYPE') {
    super(
      code === 'ISSUER_NOT_FOUND'
        ? 'No se encontro el emisor solicitado.'
        : 'La lista contiene un tipo de credencial desconocido.'
    );
    this.name = 'CapabilityPolicyError';
    this.code = code;
  }
}

/**
 * Validacion y normalizacion UNICAS de la politica.
 *
 * - cada valor tiene que ser EXACTAMENTE un `CredentialType` (sin trim, sin
 *   mayusculas tolerantes);
 * - los duplicados se colapsan;
 * - el orden persistido es el del enum;
 * - `[]` es VALIDO y significa "ningun tipo habilitado".
 */
export function normalizeCredentialTypePolicy(
  input: readonly unknown[]
): CredentialType[] {
  const unique = new Set<string>();

  for (const value of input) {
    if (typeof value !== 'string' || !CREDENTIAL_TYPE_VALUES.includes(value)) {
      throw new CapabilityPolicyError('INVALID_CREDENTIAL_TYPE');
    }
    unique.add(value);
  }

  return [...unique].sort(
    (left, right) => CANONICAL_ORDER.get(left)! - CANONICAL_ORDER.get(right)!
  ) as CredentialType[];
}

/** Lo minimo que la primitiva necesita de la base. */
export interface CapabilityPolicyClient {
  issuer: Pick<Prisma.IssuerDelegate, 'findUnique' | 'update'>;
}

/**
 * Fija la politica de capacidades. Independiente del estado del issuer: se
 * puede aplicar autorizado o no, configurado o no, en `rotation_required` o
 * `disabled`.
 */
export async function setAllowedCredentialTypes(
  client: CapabilityPolicyClient,
  input: { issuerId: string; credentialTypes: readonly unknown[] }
): Promise<{ issuerId: string; allowedCredentialTypes: CredentialType[] }> {
  const credentialTypes = normalizeCredentialTypePolicy(input.credentialTypes);

  const issuer = await client.issuer.findUnique({
    where: { id: input.issuerId },
    select: { id: true }
  });

  if (!issuer) {
    throw new CapabilityPolicyError('ISSUER_NOT_FOUND');
  }

  const updated = await client.issuer.update({
    where: { id: input.issuerId },
    data: { allowedCredentialTypes: credentialTypes },
    select: { id: true, allowedCredentialTypes: true }
  });

  return {
    issuerId: updated.id,
    allowedCredentialTypes: updated.allowedCredentialTypes
  };
}
