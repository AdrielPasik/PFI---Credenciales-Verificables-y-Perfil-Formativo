import assert from 'node:assert/strict';
import test from 'node:test';

import { CredentialType, IssuerAuthorizationStatus } from '@prisma/client';

import { type PrismaService } from '../prisma/prisma.service';
import {
  CapabilityPolicyError,
  normalizeCredentialTypePolicy,
  setAllowedCredentialTypes
} from './issuer-capability-policy';
import {
  IssuerReadinessError,
  IssuerReadinessService,
  assertCredentialTypeAllowed
} from './issuer-readiness.service';

/** Decision A/C de S8c9: capacidades y su unico escritor. */

test('C1 normaliza: dedupe, orden del enum, [] valido', () => {
  assert.deepEqual(
    normalizeCredentialTypePolicy(['certification', 'course', 'course']),
    [CredentialType.course, CredentialType.certification]
  );
  assert.deepEqual(normalizeCredentialTypePolicy([]), []);
});

test('C2 rechaza valores no exactos', () => {
  for (const bad of ['COURSE', ' course', 'course ', 'X', 1, null, undefined]) {
    assert.throws(
      () => normalizeCredentialTypePolicy([bad]),
      (e: unknown) => e instanceof CapabilityPolicyError && e.code === 'INVALID_CREDENTIAL_TYPE'
    );
  }
});

function policyClient(exists = true) {
  const calls: { op: string; args: unknown }[] = [];
  const client = {
    issuer: {
      findUnique: async (args: unknown) => {
        calls.push({ op: 'findUnique', args });
        return exists ? { id: 'issuer-1' } : null;
      },
      update: async (args: { data: { allowedCredentialTypes: CredentialType[] } }) => {
        calls.push({ op: 'update', args });
        return { id: 'issuer-1', allowedCredentialTypes: args.data.allowedCredentialTypes };
      }
    }
  };
  return { client, calls };
}

test('C3 escritor: toca SOLO allowedCredentialTypes', async () => {
  const { client, calls } = policyClient();
  const result = await setAllowedCredentialTypes(client as never, {
    issuerId: 'issuer-1',
    credentialTypes: ['degree', 'course']
  });
  assert.deepEqual(result.allowedCredentialTypes, ['course', 'degree']);
  const update = calls.find((c) => c.op === 'update')!.args as { data: object };
  assert.deepEqual(Object.keys(update.data), ['allowedCredentialTypes']);
});

test('C4 escritor: [] valido; issuer inexistente -> ISSUER_NOT_FOUND sin update', async () => {
  const ok = policyClient();
  const r = await setAllowedCredentialTypes(ok.client as never, {
    issuerId: 'issuer-1',
    credentialTypes: []
  });
  assert.deepEqual(r.allowedCredentialTypes, []);

  const missing = policyClient(false);
  await assert.rejects(
    setAllowedCredentialTypes(missing.client as never, { issuerId: 'x', credentialTypes: [] }),
    (e: unknown) => e instanceof CapabilityPolicyError && e.code === 'ISSUER_NOT_FOUND'
  );
  assert.equal(missing.calls.some((c) => c.op === 'update'), false);
});

test('C5 tipo invalido falla ANTES de leer la base', async () => {
  const { client, calls } = policyClient();
  await assert.rejects(
    setAllowedCredentialTypes(client as never, { issuerId: 'issuer-1', credentialTypes: ['X'] })
  );
  assert.equal(calls.length, 0);
});

test('A1 los CUATRO tipos siguen la misma politica, mensaje neutral', () => {
  for (const type of Object.values(CredentialType)) {
    assert.doesNotThrow(() => assertCredentialTypeAllowed([type], type));
    assert.throws(
      () => assertCredentialTypeAllowed([], type),
      (e: unknown) =>
        e instanceof IssuerReadinessError &&
        e.code === 'CREDENTIAL_TYPE_NOT_ENABLED' &&
        e.getStatus() === 400 &&
        e.message === 'Este emisor no tiene habilitado este tipo de credencial.'
    );
  }
});

function readinessPrisma(rows: unknown[]) {
  const calls = { findUnique: 0, findMany: 0 };
  const prisma = {
    issuer: {
      findUnique: async () => {
        calls.findUnique += 1;
        return rows[0] ?? null;
      },
      findMany: async () => {
        calls.findMany += 1;
        return rows;
      }
    }
  };
  return { prisma: prisma as unknown as PrismaService, calls };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'issuer-1',
    authorizationStatus: IssuerAuthorizationStatus.authorized,
    allowedCredentialTypes: [CredentialType.course],
    technicalIdentity: null,
    assertionKeyBindings: [],
    ...overrides
  };
}

test('A2 precondicion: no autorizado -> ISSUER_NOT_READY', async () => {
  const { prisma } = readinessPrisma([
    row({ authorizationStatus: IssuerAuthorizationStatus.pending })
  ]);
  await assert.rejects(
    new IssuerReadinessService(prisma).assertIssuerCanIssueType('issuer-1', CredentialType.course),
    (e: unknown) => e instanceof IssuerReadinessError && e.code === 'ISSUER_NOT_READY'
  );
});

test('A3 precondicion: issuer inexistente -> ISSUER_NOT_FOUND 404', async () => {
  const { prisma } = readinessPrisma([]);
  await assert.rejects(
    new IssuerReadinessService(prisma).assertIssuerCanIssueType('x', CredentialType.course),
    (e: unknown) =>
      e instanceof IssuerReadinessError && e.code === 'ISSUER_NOT_FOUND' && e.getStatus() === 404
  );
});

test('A4 sin identidad tecnica (legacy did/wallet no cuentan) -> ISSUER_NOT_READY', async () => {
  const { prisma } = readinessPrisma([
    row({ did: 'did:example:issuer-demo', walletAddress: '0xabc' })
  ]);
  await assert.rejects(
    new IssuerReadinessService(prisma).assertIssuerCanIssueType('issuer-1', CredentialType.course),
    (e: unknown) => e instanceof IssuerReadinessError && e.code === 'ISSUER_NOT_READY'
  );
});

test('D1 evaluateMany: UNA consulta para N issuers; [] no consulta', async () => {
  const { prisma, calls } = readinessPrisma([row(), row({ id: 'issuer-2' }), row({ id: 'issuer-3' })]);
  const service = new IssuerReadinessService(prisma);
  const result = await service.evaluateMany(['issuer-1', 'issuer-2', 'issuer-3']);
  assert.equal(result.size, 3);
  assert.equal(calls.findMany, 1);
  assert.equal(calls.findUnique, 0);

  const empty = readinessPrisma([]);
  await new IssuerReadinessService(empty.prisma).evaluateMany([]);
  assert.equal(empty.calls.findMany, 0);
});
