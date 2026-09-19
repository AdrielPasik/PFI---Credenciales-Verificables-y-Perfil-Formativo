export interface ProfileShareLinkVM {
  sharePath: string;
  expiresAtLabel: string | null;
}

export type ShareStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

/** Un enlace del holder tal como se administra. El token crudo NO esta aca:
 *  solo se muestra una vez, al crearlo. */
export interface HolderProfileShareVM {
  shareId: string;
  status: ShareStatus;
  statusLabel: string;
  createdAtLabel: string;
  expiresAtLabel: string | null;
  revokedAtLabel: string | null;
  lastUsedAtLabel: string | null;
  /** Permiso EFECTIVO: enlace vigente + politica encendida + evidencia vigente. */
  contextualVerificationEnabled: boolean;
  authorizedCredentialCount: number;
  effectiveAuthorizedCredentialCount: number;
}

export interface ShareVerificationPolicyVM {
  enabled: boolean;
  policyVersion: number;
  authorizedCredentialIds: string[];
  effectiveAuthorizedCredentialIds: string[];
}

export interface PublicProfileShareVM {
  holderLabel: string | null;
  narrative: string | null;
  areas: Array<{ label: string; estimatedHoursLabel: string | null }>;
  skills: string[];
  concepts: string[];
  totalOfficialHoursLabel: string | null;
  credentialsCount: number;
  credentials: Array<{
    credentialReference: string;
    title: string;
    typeLabel: string;
    issuerName: string;
    issuedAtLabel: string | null;
  }>;
  /** Solo dice si el holder habilito el analisis contextual. En esta version
   *  todavia no existe ningun endpoint publico que lo ejecute. */
  contextualVerificationEnabled: boolean;
}
