import {
  CredentialType,
  IssuerAuthorizationStatus,
  IssuerTechnicalIdentityStatus,
  SignerProfilePurpose,
  SignerProfileStatus
} from '@prisma/client';
import { isAddress } from 'ethers';

import {
  type BlockchainTarget,
  type BlockchainTargetEnvironment,
  tryResolveBlockchainTarget
} from '../blockchain/blockchain-target';
import { isDidForIssuerPath } from '../identity/did-web-issuer';
import {
  type BoundAssertionProfile,
  evaluateIssuerDidPublication
} from '../identity/issuer-did-document.resolver';

/**
 * Readiness de emision -- S8c9. LA UNICA implementacion.
 *
 * ---------------------------------------------------------------------------
 * CUATRO PREGUNTAS QUE NO SE MEZCLAN
 * ---------------------------------------------------------------------------
 *
 *   administrativelyAuthorized   Scope habilito al issuer en la plataforma?
 *                                (Issuer.authorizationStatus)
 *   configurationReady           la configuracion TECNICA es coherente?
 *                                (identidad tecnica, DID, signers, target)
 *   hasCredentialCapabilities    la politica le habilita algun tipo?
 *                                (Issuer.allowedCredentialTypes)
 *   readyToIssue                 las tres a la vez.
 *
 * `configurationReady` es deliberadamente TECNICA: no mira la autorizacion
 * administrativa ni las capacidades. Un issuer tecnicamente perfecto pero no
 * autorizado tiene `configurationReady = true` y `readyToIssue = false`, y
 * colapsar eso esconderia CUAL de las preguntas falla.
 *
 * ---------------------------------------------------------------------------
 * PURA: SIN SECRETOS Y SIN RED
 * ---------------------------------------------------------------------------
 *
 * Esta evaluacion trabaja sobre un snapshot de la base ya cargado. No llama al
 * resolver de signers, no lee SSM, no construye providers y no habla con
 * ninguna cadena. `addressVerifiedAt` es la prueba durable de provisioning que
 * usan los caminos de LECTURA; las operaciones de FIRMA siguen re-derivando y
 * comparando la direccion como exige S8c2.
 *
 * Asi una caida del RPC no puede convertir `readyToIssue` de true a false en una
 * lectura de UI. La salud de la red es otra accion, explicita.
 */

/** Codigos CERRADOS. Nunca texto de excepcion, nunca valores de configuracion. */
export const ISSUER_READINESS_REASON_VALUES = [
  'ISSUER_NOT_AUTHORIZED',
  'NO_ALLOWED_CREDENTIAL_TYPES',
  'TECHNICAL_IDENTITY_MISSING',
  'TECHNICAL_IDENTITY_NOT_ACTIVE',
  'ISSUER_DID_INVALID',
  'ASSERTION_PROFILE_MISSING',
  'ASSERTION_PROFILE_WRONG_PURPOSE',
  'ASSERTION_PROFILE_NOT_ACTIVE',
  'ASSERTION_ADDRESS_UNVERIFIED',
  'ASSERTION_ADDRESS_INVALID',
  'ASSERTION_HISTORY_BINDING_MISSING',
  'ASSERTION_CONFIGURATION_INCONSISTENT',
  'ANCHOR_PROFILE_MISSING',
  'ANCHOR_PROFILE_WRONG_PURPOSE',
  'ANCHOR_PROFILE_NOT_ACTIVE',
  'ANCHOR_ADDRESS_UNVERIFIED',
  'ANCHOR_ADDRESS_INVALID',
  'BLOCKCHAIN_TARGET_UNCONFIGURED'
] as const;

export type IssuerReadinessReason =
  (typeof ISSUER_READINESS_REASON_VALUES)[number];

/** Metadata PUBLICA de un perfil vigente. Nunca `secretRef`. */
export interface ReadinessSignerProfile {
  readonly id: string;
  readonly purpose: SignerProfilePurpose;
  readonly status: SignerProfileStatus;
  readonly keyVersion: number;
  readonly address: string;
  readonly addressVerifiedAt: Date | null;
}

/** Todo lo que la evaluacion necesita, ya cargado. */
export interface IssuerReadinessSnapshot {
  readonly issuerId: string;
  readonly authorizationStatus: IssuerAuthorizationStatus;
  readonly allowedCredentialTypes: readonly CredentialType[];
  readonly technicalIdentity: {
    readonly status: IssuerTechnicalIdentityStatus;
    readonly did: string;
    readonly assertionSignerProfileId: string;
    readonly assertionSignerProfile: ReadinessSignerProfile | null;
    readonly anchorSignerProfile: ReadinessSignerProfile | null;
  } | null;
  /** Historia completa de asercion del issuer, metadata publica. */
  readonly assertionHistory: readonly BoundAssertionProfile[];
}

export interface IssuerReadinessResult {
  readonly issuerId: string;
  readonly administrativelyAuthorized: boolean;
  readonly configurationReady: boolean;
  readonly hasCredentialCapabilities: boolean;
  readonly readyToIssue: boolean;
  /** Bloqueantes en orden estable. Vacio <=> readyToIssue. */
  readonly reasons: readonly IssuerReadinessReason[];
  /**
   * Proyecciones de COMPATIBILIDAD para los campos legacy del panel de admin.
   * Salen del modelo tecnico; NUNCA de `Issuer.did` ni `Issuer.walletAddress`.
   */
  readonly compatibility: {
    /** Hay identidad tecnica y su DID es un did:web de ESTE issuer. */
    readonly didConfigured: boolean;
    /**
     * Nombre historico para "la cuenta de ANCLAJE vigente esta configurada
     * estructuralmente": existe, es anchor, esta activa, verificada y con
     * direccion valida. NO lee `Issuer.walletAddress`.
     */
    readonly walletConfigured: boolean;
  };
}

/**
 * Evaluacion PURA. Recibe el target ya resuelto para que una sola llamada al
 * parser del entorno sirva a muchos issuers.
 */
export function evaluateIssuerReadiness(
  snapshot: IssuerReadinessSnapshot,
  targetResolution: ReturnType<typeof tryResolveBlockchainTarget>
): IssuerReadinessResult {
  const administrativelyAuthorized =
    snapshot.authorizationStatus === IssuerAuthorizationStatus.authorized;
  const hasCredentialCapabilities = snapshot.allowedCredentialTypes.length > 0;

  const technical = evaluateTechnicalConfiguration(snapshot, targetResolution);

  const reasons: IssuerReadinessReason[] = [];
  if (!administrativelyAuthorized) {
    reasons.push('ISSUER_NOT_AUTHORIZED');
  }
  if (!hasCredentialCapabilities) {
    reasons.push('NO_ALLOWED_CREDENTIAL_TYPES');
  }
  reasons.push(...technical.reasons);

  const configurationReady = technical.reasons.length === 0;

  return {
    issuerId: snapshot.issuerId,
    administrativelyAuthorized,
    configurationReady,
    hasCredentialCapabilities,
    readyToIssue:
      administrativelyAuthorized && configurationReady && hasCredentialCapabilities,
    reasons,
    compatibility: {
      didConfigured: technical.didValid,
      walletConfigured: technical.anchorHealthy
    }
  };
}

/** `readyToIssue(T)`: ademas de lo general, T tiene que estar habilitado. */
export function isReadyToIssueType(
  result: IssuerReadinessResult,
  allowedCredentialTypes: readonly CredentialType[],
  credentialType: CredentialType
): boolean {
  return (
    result.administrativelyAuthorized &&
    result.configurationReady &&
    allowedCredentialTypes.includes(credentialType)
  );
}

function evaluateTechnicalConfiguration(
  snapshot: IssuerReadinessSnapshot,
  targetResolution: ReturnType<typeof tryResolveBlockchainTarget>
): {
  reasons: IssuerReadinessReason[];
  didValid: boolean;
  anchorHealthy: boolean;
} {
  const reasons: IssuerReadinessReason[] = [];
  const identity = snapshot.technicalIdentity;

  if (!targetResolution.ok) {
    reasons.push('BLOCKCHAIN_TARGET_UNCONFIGURED');
  }

  if (!identity) {
    reasons.push('TECHNICAL_IDENTITY_MISSING');
    return { reasons, didValid: false, anchorHealthy: false };
  }

  // S8c8 reconcilia el ciclo de vida. Aca solo se OBSERVA: una lectura nunca
  // cambia `identity.status`.
  if (identity.status !== IssuerTechnicalIdentityStatus.active) {
    reasons.push('TECHNICAL_IDENTITY_NOT_ACTIVE');
  }

  // Validacion EXACTA de ruta, la misma del endpoint publico. No un prefijo.
  const didValid = isDidForIssuerPath(identity.did, snapshot.issuerId);
  if (!didValid) {
    reasons.push('ISSUER_DID_INVALID');
  }

  // --- CLAVE DE ASERCION VIGENTE --------------------------------------------
  const assertion = identity.assertionSignerProfile;
  if (!assertion) {
    reasons.push('ASSERTION_PROFILE_MISSING');
  } else {
    reasons.push(
      ...evaluateSignerProfile(assertion, SignerProfilePurpose.assertion, {
        wrongPurpose: 'ASSERTION_PROFILE_WRONG_PURPOSE',
        notActive: 'ASSERTION_PROFILE_NOT_ACTIVE',
        unverified: 'ASSERTION_ADDRESS_UNVERIFIED',
        invalidAddress: 'ASSERTION_ADDRESS_INVALID'
      })
    );

    // Historia + publicabilidad: se REUSA el evaluador del DID publico, para
    // que "listo para emitir" no pueda divergir de "el DID publica esta clave".
    if (didValid) {
      const publication = evaluateIssuerDidPublication({
        issuerId: snapshot.issuerId,
        did: identity.did,
        currentProfileId: identity.assertionSignerProfileId,
        bound: snapshot.assertionHistory
      });

      if (publication.kind === 'inconsistent_configuration') {
        reasons.push(
          // Historia vacia o puntero vigente fuera de la historia: falta el
          // binding del vigente. Cualquier otro problema es inconsistencia.
          snapshot.assertionHistory.length === 0 ||
            publication.code === 'CURRENT_ASSERTION_NOT_BOUND'
            ? 'ASSERTION_HISTORY_BINDING_MISSING'
            : 'ASSERTION_CONFIGURATION_INCONSISTENT'
        );
      } else if (publication.kind === 'not_resolvable') {
        reasons.push('ISSUER_DID_INVALID');
      }
    }
  }

  // --- CUENTA DE ANCLAJE VIGENTE --------------------------------------------
  const anchor = identity.anchorSignerProfile;
  let anchorHealthy = false;
  if (!anchor) {
    reasons.push('ANCHOR_PROFILE_MISSING');
  } else {
    const anchorReasons = evaluateSignerProfile(
      anchor,
      SignerProfilePurpose.anchor,
      {
        wrongPurpose: 'ANCHOR_PROFILE_WRONG_PURPOSE',
        notActive: 'ANCHOR_PROFILE_NOT_ACTIVE',
        unverified: 'ANCHOR_ADDRESS_UNVERIFIED',
        invalidAddress: 'ANCHOR_ADDRESS_INVALID'
      }
    );
    anchorHealthy = anchorReasons.length === 0;
    reasons.push(...anchorReasons);
  }

  return { reasons: dedupe(reasons), didValid, anchorHealthy };
}

function evaluateSignerProfile(
  profile: ReadinessSignerProfile,
  purpose: SignerProfilePurpose,
  codes: {
    wrongPurpose: IssuerReadinessReason;
    notActive: IssuerReadinessReason;
    unverified: IssuerReadinessReason;
    invalidAddress: IssuerReadinessReason;
  }
): IssuerReadinessReason[] {
  const reasons: IssuerReadinessReason[] = [];

  if (profile.purpose !== purpose) {
    reasons.push(codes.wrongPurpose);
  }
  // `retired` y `compromised` no firman nada nuevo.
  if (profile.status !== SignerProfileStatus.active) {
    reasons.push(codes.notActive);
  }
  if (profile.addressVerifiedAt === null) {
    reasons.push(codes.unverified);
  }
  // Cierra el hueco L-3: no alcanza con que la direccion sea "truthy".
  if (!isValidEthereumAddress(profile.address)) {
    reasons.push(codes.invalidAddress);
  }

  return reasons;
}

export function isValidEthereumAddress(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^0x[0-9a-fA-F]{40}$/.test(value) &&
    isAddress(value)
  );
}

function dedupe(reasons: IssuerReadinessReason[]): IssuerReadinessReason[] {
  return [...new Set(reasons)];
}

/** Resolucion del target del entorno ACTUAL. Pura: no construye provider. */
export function resolveReadinessTarget(
  environment: BlockchainTargetEnvironment = process.env
): ReturnType<typeof tryResolveBlockchainTarget> {
  return tryResolveBlockchainTarget(environment);
}

export type { BlockchainTarget };
