export type IssuerAuthorizationStatus =
  | 'authorized'
  | 'pending'
  | 'revoked';

export type IssuerMembershipRole = 'admin' | 'operator' | 'viewer';
export type IssuerMembershipStatus = 'active' | 'pending' | 'revoked';

export type NonOperationalIssuerReasonCode =
  | 'membership_pending'
  | 'membership_revoked'
  | 'role_without_issuance_permission'
  | 'issuer_authorization_pending'
  | 'issuer_authorization_revoked';

export interface NonOperationalIssuerReason {
  code: NonOperationalIssuerReasonCode;
  label: string;
}

export interface IssuerMembershipSummaryVM {
  issuerReference: string;
  issuerName: string;
  issuerDid: string | null;
  issuerAuthorizationStatus: IssuerAuthorizationStatus;
  issuerAuthorizationLabel: string;
  role: IssuerMembershipRole;
  roleLabel: string;
  status: IssuerMembershipStatus;
  operational: boolean;
}

interface IssuerContextBase {
  issuerContexts: IssuerMembershipSummaryVM[];
  operationalIssuerContexts: IssuerMembershipSummaryVM[];
}

export type IssuerContextState =
  | (IssuerContextBase & {
      kind: 'none';
      selectedIssuer: null;
    })
  | (IssuerContextBase & {
      kind: 'single';
      selectedIssuer: IssuerMembershipSummaryVM;
    })
  | (IssuerContextBase & {
      kind: 'selection-required';
      selectedIssuer: null;
    })
  | (IssuerContextBase & {
      kind: 'selected';
      selectedIssuer: IssuerMembershipSummaryVM;
    });

export function isOperationalIssuerMembership(
  membership: Pick<
    IssuerMembershipSummaryVM,
    'issuerAuthorizationStatus' | 'role' | 'status'
  >
) {
  return (
    membership.status === 'active' &&
    (membership.role === 'admin' || membership.role === 'operator') &&
    membership.issuerAuthorizationStatus === 'authorized'
  );
}

export function deriveNonOperationalIssuerReason(
  membership: Pick<
    IssuerMembershipSummaryVM,
    'issuerAuthorizationStatus' | 'role' | 'status'
  >
): NonOperationalIssuerReason | null {
  // Membership state takes precedence, followed by role and issuer state.
  if (membership.status === 'pending') {
    return {
      code: 'membership_pending',
      label: 'Membresía pendiente'
    };
  }

  if (membership.status === 'revoked') {
    return {
      code: 'membership_revoked',
      label: 'Membresía revocada'
    };
  }

  if (membership.role === 'viewer') {
    return {
      code: 'role_without_issuance_permission',
      label: 'Rol sin permisos de emisión'
    };
  }

  if (membership.issuerAuthorizationStatus === 'pending') {
    return {
      code: 'issuer_authorization_pending',
      label: 'Institución pendiente de autorización'
    };
  }

  if (membership.issuerAuthorizationStatus === 'revoked') {
    return {
      code: 'issuer_authorization_revoked',
      label: 'Autorización institucional revocada'
    };
  }

  return null;
}

export function deriveIssuerContext(
  issuerContexts: IssuerMembershipSummaryVM[],
  selectedIssuerReference: string | null
): IssuerContextState {
  const normalizedContexts = issuerContexts.map((membership) => ({
    ...membership,
    operational: isOperationalIssuerMembership(membership)
  }));
  const operationalIssuerContexts = normalizedContexts.filter(
    (membership) => membership.operational
  );
  const base = {
    issuerContexts: normalizedContexts,
    operationalIssuerContexts
  };

  if (operationalIssuerContexts.length === 0) {
    return {
      ...base,
      kind: 'none',
      selectedIssuer: null
    };
  }

  if (operationalIssuerContexts.length === 1) {
    return {
      ...base,
      kind: 'single',
      selectedIssuer: operationalIssuerContexts[0]
    };
  }

  const selectedIssuer = selectedIssuerReference
    ? operationalIssuerContexts.find(
        (membership) =>
          membership.issuerReference === selectedIssuerReference
      )
    : undefined;

  if (!selectedIssuer) {
    return {
      ...base,
      kind: 'selection-required',
      selectedIssuer: null
    };
  }

  return {
    ...base,
    kind: 'selected',
    selectedIssuer
  };
}
