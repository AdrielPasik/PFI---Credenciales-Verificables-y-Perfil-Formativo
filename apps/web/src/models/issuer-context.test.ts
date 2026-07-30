import { describe, expect, it } from 'vitest';

import {
  deriveNonOperationalIssuerReason,
  deriveIssuerContext,
  isOperationalIssuerMembership,
  type IssuerMembershipSummaryVM
} from '@/models/issuer-context';

function membership(
  overrides: Partial<IssuerMembershipSummaryVM> = {}
): IssuerMembershipSummaryVM {
  return {
    issuerReference: 'issuer-1',
    issuerName: 'Institución Uno',
    issuerDid: null,
    issuerAuthorizationStatus: 'authorized',
    issuerAuthorizationLabel: 'Autorizada',
    role: 'admin',
    roleLabel: 'Administrador',
    status: 'active',
    operational: true,
    ...overrides
  };
}

describe('issuer context derivation', () => {
  it('derives no operational context from an empty list', () => {
    expect(deriveIssuerContext([], null)).toMatchObject({
      kind: 'none',
      selectedIssuer: null,
      operationalIssuerContexts: []
    });
  });

  it('selects the only operational membership without ambiguity', () => {
    expect(deriveIssuerContext([membership()], null)).toMatchObject({
      kind: 'single',
      selectedIssuer: { issuerReference: 'issuer-1' }
    });
  });

  it('requires an explicit selection with two operational memberships', () => {
    const context = deriveIssuerContext(
      [
        membership(),
        membership({
          issuerReference: 'issuer-2',
          issuerName: 'Institución Dos'
        })
      ],
      null
    );

    expect(context.kind).toBe('selection-required');
    expect(context.selectedIssuer).toBeNull();
  });

  it.each([
    { role: 'viewer' as const },
    { issuerAuthorizationStatus: 'pending' as const },
    { issuerAuthorizationStatus: 'revoked' as const },
    { status: 'pending' as const },
    { status: 'revoked' as const }
  ])('excludes $overrides from operational contexts', (overrides) => {
    expect(
      isOperationalIssuerMembership(membership(overrides))
    ).toBe(false);
    expect(deriveIssuerContext([membership(overrides)], null).kind).toBe(
      'none'
    );
  });

  it('restores a previously selected operational issuer', () => {
    const context = deriveIssuerContext(
      [
        membership(),
        membership({
          issuerReference: 'issuer-2',
          issuerName: 'Institución Dos'
        })
      ],
      'issuer-2'
    );

    expect(context).toMatchObject({
      kind: 'selected',
      selectedIssuer: { issuerReference: 'issuer-2' }
    });
  });

  it('rejects a stale previous selection and requires selection again', () => {
    const context = deriveIssuerContext(
      [
        membership(),
        membership({
          issuerReference: 'issuer-2',
          issuerName: 'Institución Dos'
        })
      ],
      'issuer-no-longer-available'
    );

    expect(context.kind).toBe('selection-required');
    expect(context.selectedIssuer).toBeNull();
  });

  it.each([
    [
      { status: 'pending' as const },
      'membership_pending',
      'Membresía pendiente'
    ],
    [
      { status: 'revoked' as const },
      'membership_revoked',
      'Membresía revocada'
    ],
    [
      { role: 'viewer' as const },
      'role_without_issuance_permission',
      'Rol sin permisos de emisión'
    ],
    [
      { issuerAuthorizationStatus: 'pending' as const },
      'issuer_authorization_pending',
      'Institución pendiente de autorización'
    ],
    [
      { issuerAuthorizationStatus: 'revoked' as const },
      'issuer_authorization_revoked',
      'Autorización institucional revocada'
    ]
  ])(
    'derives a human non-operational reason for %o',
    (overrides, code, label) => {
      expect(
        deriveNonOperationalIssuerReason(membership(overrides))
      ).toEqual({ code, label });
    }
  );

  it('prioritizes membership state, then role, then issuer authorization', () => {
    expect(
      deriveNonOperationalIssuerReason(
        membership({
          status: 'pending',
          role: 'viewer',
          issuerAuthorizationStatus: 'revoked'
        })
      )?.code
    ).toBe('membership_pending');

    expect(
      deriveNonOperationalIssuerReason(
        membership({
          role: 'viewer',
          issuerAuthorizationStatus: 'revoked'
        })
      )?.code
    ).toBe('role_without_issuance_permission');
  });

  it('returns no non-operational reason for an operational context', () => {
    expect(deriveNonOperationalIssuerReason(membership())).toBeNull();
  });
});
