import { describe, expect, it } from 'vitest';

import {
  adaptAdminIssuerList,
  adaptAdminIssuerMemberships
} from '@/lib/adapters/platform-admin.adapter';
import { IncompatiblePayloadError } from '@/lib/errors/api-error';

const issuerPayload = {
  id: 'issuer-uade',
  name: 'Universidad Argentina de la Empresa',
  legalName: 'UADE S.A.',
  authorizationStatus: 'authorized',
  technicalIdentity: {
    didConfigured: true,
    walletConfigured: true,
    readyToIssue: true
  },
  membershipCounts: { active: 3, total: 5 },
  catalogCounts: {
    academicCourses: 42,
    programs: 4,
    curriculumVersions: 6,
    programCourses: 120
  },
  createdAt: '2026-01-15T10:30:00.000Z'
};

/** El issuer que crea S5b: habilitado, pero sin identidad tecnica. */
const provisionedIssuerPayload = {
  id: 'issuer-nuevo',
  name: 'Universidad X',
  legalName: 'Universidad X',
  authorizationStatus: 'authorized',
  technicalIdentity: {
    didConfigured: false,
    walletConfigured: false,
    readyToIssue: false
  },
  membershipCounts: { active: 1, total: 1 },
  catalogCounts: {
    academicCourses: 0,
    programs: 0,
    curriculumVersions: 0,
    programCourses: 0
  },
  createdAt: '2026-10-04T12:00:00.000Z'
};

const membershipPayload = {
  userId: 'user-juan',
  email: 'juan@uade.edu.ar',
  displayLabel: 'Juan Pérez',
  role: 'admin',
  status: 'active',
  createdAt: '2026-02-01T09:00:00.000Z'
};

describe('adaptAdminIssuerList', () => {
  it('adapta el contrato de S3 a view models', () => {
    const list = adaptAdminIssuerList({ items: [issuerPayload] });

    expect(list.items).toHaveLength(1);
    expect(list.items[0].issuerReference).toBe('issuer-uade');
    expect(list.items[0].name).toBe('Universidad Argentina de la Empresa');
    expect(list.items[0].legalName).toBe('UADE S.A.');
    expect(list.items[0].authorizationStatus).toBe('authorized');
    expect(list.items[0].technicalIdentity.readyToIssue).toBe(true);
    expect(list.items[0].membershipCounts).toMatchObject({
      active: 3,
      total: 5
    });
    expect(list.items[0].catalogCounts).toEqual({
      academicCourses: 42,
      programs: 4,
      curriculumVersions: 6,
      programCourses: 120
    });
    expect(list.items[0].createdAtLabel).toBeTruthy();
  });

  it('una lista vacia es un estado valido, no un error', () => {
    expect(adaptAdminIssuerList({ items: [] }).items).toEqual([]);
  });

  it('CONSERVA el orden determinista del backend, sin reordenar', () => {
    const list = adaptAdminIssuerList({
      items: [
        { ...issuerPayload, id: 'z', name: 'Zeta' },
        { ...issuerPayload, id: 'a', name: 'Alfa' },
        { ...issuerPayload, id: 'm', name: 'Mu' }
      ]
    });

    expect(list.items.map((issuer) => issuer.issuerReference)).toEqual([
      'z',
      'a',
      'm'
    ]);
  });

  it('NO presenta authorizationStatus como "verificada": habla de habilitación', () => {
    const labels = (['authorized', 'pending', 'revoked'] as const).map(
      (authorizationStatus) =>
        adaptAdminIssuerList({
          items: [{ ...issuerPayload, authorizationStatus }]
        }).items[0].authorizationLabel
    );

    expect(labels).toEqual([
      'Habilitada',
      'Pendiente de habilitación',
      'Habilitación revocada'
    ]);

    for (const label of labels) {
      expect(label.toLowerCase()).not.toContain('verific');
      expect(label.toLowerCase()).not.toContain('valida');
      expect(label.toLowerCase()).not.toContain('acredit');
    }
  });

  it('legalName null se conserva como null, NUNCA como ""', () => {
    const item = adaptAdminIssuerList({
      items: [{ ...issuerPayload, legalName: null }]
    }).items[0];

    expect(item.legalName).toBeNull();
  });

  it('legalName en blanco tambien resuelve null: "" no es una razón social', () => {
    const item = adaptAdminIssuerList({
      items: [{ ...issuerPayload, legalName: '   ' }]
    }).items[0];

    expect(item.legalName).toBeNull();
  });

  it('el issuer recién provisionado por S5b: habilitado y con emisión pendiente', () => {
    // Sin contradiccion y sin lenguaje de error: es un estado legitimo.
    const item = adaptAdminIssuerList({
      items: [provisionedIssuerPayload]
    }).items[0];

    expect(item.authorizationLabel).toBe('Habilitada');
    expect(item.technicalIdentity).toEqual({
      didConfigured: false,
      walletConfigured: false,
      readyToIssue: false,
      readinessLabel: 'Pendiente'
    });
    expect(item.technicalIdentity.readinessLabel.toLowerCase()).not.toContain(
      'error'
    );
  });

  it('readinessLabel es "Lista" solo cuando readyToIssue viene en true', () => {
    expect(
      adaptAdminIssuerList({ items: [issuerPayload] }).items[0]
        .technicalIdentity.readinessLabel
    ).toBe('Lista');
  });

  it('el resumen de miembros refleja los conteos, y distingue el caso sin miembros', () => {
    expect(
      adaptAdminIssuerList({ items: [issuerPayload] }).items[0]
        .membershipCounts.summaryLabel
    ).toBe('3 activos de 5');
    expect(
      adaptAdminIssuerList({
        items: [
          {
            ...issuerPayload,
            membershipCounts: { active: 0, total: 0 }
          }
        ]
      }).items[0].membershipCounts.summaryLabel
    ).toBe('Sin miembros');
  });

  it('NO expone ningún valor de DID ni de walletAddress', () => {
    // El backend no los manda; y si algún día los mandara, el adapter no los
    // proyecta -- el VM solo tiene booleanos.
    const item = adaptAdminIssuerList({
      items: [
        {
          ...issuerPayload,
          did: 'did:example:no-deberia-salir',
          walletAddress: '0xdeadbeef',
          metadata: { secreto: true },
          technicalIdentity: {
            ...issuerPayload.technicalIdentity,
            did: 'did:example:tampoco',
            walletAddress: '0xtampoco'
          }
        }
      ]
    }).items[0];

    const serialized = JSON.stringify(item);
    expect(serialized).not.toContain('did:example');
    expect(serialized).not.toContain('0xdeadbeef');
    expect(serialized).not.toContain('0xtampoco');
    expect(serialized).not.toContain('secreto');
    expect(Object.keys(item.technicalIdentity).sort()).toEqual([
      'didConfigured',
      'readinessLabel',
      'readyToIssue',
      'walletConfigured'
    ]);
  });

  it('rechaza el payload cuando el contrato no se cumple', () => {
    const invalidPayloads: unknown[] = [
      null,
      undefined,
      [],
      'texto',
      {},
      { items: null },
      { items: {} },
      { items: [{ ...issuerPayload, id: '' }] },
      { items: [{ ...issuerPayload, name: null }] },
      { items: [{ ...issuerPayload, authorizationStatus: 'verified' }] },
      { items: [{ ...issuerPayload, authorizationStatus: 'activo' }] },
      { items: [{ ...issuerPayload, technicalIdentity: null }] },
      {
        items: [
          {
            ...issuerPayload,
            technicalIdentity: {
              ...issuerPayload.technicalIdentity,
              didConfigured: 'true'
            }
          }
        ]
      },
      { items: [{ ...issuerPayload, membershipCounts: { active: -1, total: 5 } }] },
      { items: [{ ...issuerPayload, membershipCounts: { active: 1.5, total: 5 } }] },
      { items: [{ ...issuerPayload, catalogCounts: {} }] },
      { items: [{ ...issuerPayload, createdAt: 'no es una fecha' }] },
      { items: [{ ...issuerPayload, createdAt: null }] }
    ];

    for (const payload of invalidPayloads) {
      expect(
        () => adaptAdminIssuerList(payload),
        `deberia rechazar ${JSON.stringify(payload)}`
      ).toThrow(IncompatiblePayloadError);
    }
  });

  it('el error de contrato trae un diagnóstico con la ruta exacta', () => {
    try {
      adaptAdminIssuerList({
        items: [{ ...issuerPayload, membershipCounts: { active: 1 } }]
      });
      expect.unreachable('deberia haber lanzado');
    } catch (error) {
      expect(error).toBeInstanceOf(IncompatiblePayloadError);
      expect((error as IncompatiblePayloadError).diagnostic).toEqual({
        path: 'adminIssuers.items[0].membershipCounts.total',
        expected: 'non-negative integer',
        actualCategory: 'missing'
      });
    }
  });
});

describe('adaptAdminIssuerMemberships', () => {
  it('adapta el contrato de S3 a view models', () => {
    const response = adaptAdminIssuerMemberships({
      issuer: { id: 'issuer-uade', name: 'UADE' },
      items: [membershipPayload]
    });

    expect(response.issuer).toEqual({
      issuerReference: 'issuer-uade',
      name: 'UADE'
    });
    expect(response.items[0]).toEqual({
      userReference: 'user-juan',
      email: 'juan@uade.edu.ar',
      displayLabel: 'Juan Pérez',
      role: 'admin',
      roleLabel: 'Administrador',
      status: 'active',
      statusLabel: 'Activa',
      createdAtLabel: response.items[0].createdAtLabel
    });
    expect(response.items[0].createdAtLabel).toBeTruthy();
  });

  it('un issuer sin memberships es un estado valido', () => {
    const response = adaptAdminIssuerMemberships({
      issuer: { id: 'issuer-nuevo', name: 'Universidad X' },
      items: []
    });

    expect(response.items).toEqual([]);
  });

  it('email null se conserva como null, NUNCA como ""', () => {
    const response = adaptAdminIssuerMemberships({
      issuer: { id: 'issuer-uade', name: 'UADE' },
      items: [{ ...membershipPayload, email: null }]
    });

    expect(response.items[0].email).toBeNull();
    expect(response.items[0].email).not.toBe('');
    // El displayLabel sigue estando: la membership nunca se oculta por esto.
    expect(response.items[0].displayLabel).toBe('Juan Pérez');
  });

  it('email en blanco tambien resuelve null', () => {
    const response = adaptAdminIssuerMemberships({
      issuer: { id: 'issuer-uade', name: 'UADE' },
      items: [{ ...membershipPayload, email: '  ' }]
    });

    expect(response.items[0].email).toBeNull();
  });

  it('cubre los tres roles y los tres estados reales del enum', () => {
    const response = adaptAdminIssuerMemberships({
      issuer: { id: 'issuer-uade', name: 'UADE' },
      items: [
        { ...membershipPayload, userId: 'u1', role: 'admin', status: 'active' },
        {
          ...membershipPayload,
          userId: 'u2',
          role: 'operator',
          status: 'pending'
        },
        {
          ...membershipPayload,
          userId: 'u3',
          role: 'viewer',
          status: 'revoked'
        }
      ]
    });

    expect(
      response.items.map((item) => [item.roleLabel, item.statusLabel])
    ).toEqual([
      ['Administrador', 'Activa'],
      ['Operador', 'Pendiente'],
      ['Solo lectura', 'Revocada']
    ]);
  });

  it('CONSERVA el orden del backend', () => {
    const response = adaptAdminIssuerMemberships({
      issuer: { id: 'issuer-uade', name: 'UADE' },
      items: [
        { ...membershipPayload, userId: 'z', email: 'zeta@uade.edu.ar' },
        { ...membershipPayload, userId: 'a', email: 'alfa@uade.edu.ar' }
      ]
    });

    expect(response.items.map((item) => item.userReference)).toEqual(['z', 'a']);
  });

  it('un rol o estado desconocido RECHAZA el payload: es un contrato de autorización', () => {
    for (const override of [
      { role: 'superadmin' },
      { role: 'Admin' },
      { role: null },
      { status: 'suspended' },
      { status: 'inactive' },
      { status: null }
    ]) {
      expect(() =>
        adaptAdminIssuerMemberships({
          issuer: { id: 'issuer-uade', name: 'UADE' },
          items: [{ ...membershipPayload, ...override }]
        })
      ).toThrow(IncompatiblePayloadError);
    }
  });

  it('rechaza el payload cuando el contrato no se cumple', () => {
    const invalidPayloads: unknown[] = [
      null,
      [],
      {},
      { items: [membershipPayload] },
      { issuer: null, items: [] },
      { issuer: { id: 'x' }, items: [] },
      { issuer: { id: 'issuer-uade', name: 'UADE' }, items: null },
      {
        issuer: { id: 'issuer-uade', name: 'UADE' },
        items: [{ ...membershipPayload, userId: '' }]
      },
      {
        issuer: { id: 'issuer-uade', name: 'UADE' },
        items: [{ ...membershipPayload, displayLabel: null }]
      },
      {
        issuer: { id: 'issuer-uade', name: 'UADE' },
        items: [{ ...membershipPayload, createdAt: 'ayer' }]
      }
    ];

    for (const payload of invalidPayloads) {
      expect(
        () => adaptAdminIssuerMemberships(payload),
        `deberia rechazar ${JSON.stringify(payload)}`
      ).toThrow(IncompatiblePayloadError);
    }
  });

  it('NO proyecta passwordHash, did del usuario ni onboardingIntent', () => {
    const response = adaptAdminIssuerMemberships({
      issuer: { id: 'issuer-uade', name: 'UADE' },
      items: [
        {
          ...membershipPayload,
          passwordHash: 'NO-DEBE-SALIR',
          did: 'did:web:no-deberia-salir',
          onboardingIntent: 'institutional',
          firstName: 'Juan',
          lastName: 'Pérez'
        }
      ]
    });

    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain('NO-DEBE-SALIR');
    expect(serialized).not.toContain('did:web');
    expect(serialized).not.toContain('onboardingIntent');
    expect(serialized).not.toContain('institutional');
    expect(Object.keys(response.items[0]).sort()).toEqual([
      'createdAtLabel',
      'displayLabel',
      'email',
      'role',
      'roleLabel',
      'status',
      'statusLabel',
      'userReference'
    ]);
  });
});
