import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  NotFoundException
} from '@nestjs/common';

import { VerificationService } from './verification.service';

function credentialFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'credential-public-1',
    status: 'issued',
    type: 'course',
    title: 'Curso de gestión de proyectos',
    issuedAt: new Date('2026-08-14T12:00:00.000Z'),
    revokedAt: null,
    revocationReason: null,
    canonicalHash: `0x${'a'.repeat(64)}`,
    canonicalizationVersion: 'canon_v1',
    issuer: {
      name: 'Institución Demo',
      did: 'did:example:issuer'
    },
    subjectUser: {
      displayName: 'Titular Demo',
      firstName: 'Titular',
      lastName: 'Demo',
      did: 'did:example:holder'
    },
    _count: { blockchainRecords: 1 },
    blockchainRecords: [
      {
        network: 'anvil',
        chainId: 31337,
        txHash: `0x${'b'.repeat(64)}`,
        status: 'registered',
        registeredAt: new Date('2026-08-14T12:01:00.000Z')
      }
    ],
    ...overrides
  };
}

function createContext(credential: Record<string, unknown> | null = credentialFixture()) {
  const calls = {
    findUnique: [] as Array<Record<string, unknown>>,
    updates: 0,
    creates: 0
  };
  const prisma = {
    credential: {
      async findUnique(args: Record<string, unknown>) {
        calls.findUnique.push(args);
        return credential;
      },
      async update() {
        calls.updates += 1;
      }
    },
    blockchainRecord: {
      async create() {
        calls.creates += 1;
      }
    }
  };

  return { service: new VerificationService(prisma as never), calls };
}

test('public verification is read-only, allowlisted and never queries semantic analysis', async () => {
  const { service, calls } = createContext();

  const response = await service.getCredentialVerification('credential-public-1');
  const serialized = JSON.stringify(response);

  assert.equal(response.verification.result, 'valid_issued');
  assert.equal(response.holder.displayLabel, 'Titular Demo');
  assert.equal(response.integrity.latestBlockchainRecord?.networkLabel, 'Entorno técnico/demo');
  assert.equal(calls.updates, 0);
  assert.equal(calls.creates, 0);
  assert.equal(calls.findUnique.length, 1);
  assert.deepEqual(calls.findUnique[0]?.where, { id: 'credential-public-1' });
  assert.equal('semanticAnalyses' in ((calls.findUnique[0]?.select as Record<string, unknown>) ?? {}), false);
  for (const forbidden of [
    'email',
    'rawData',
    'metadata',
    'credentialSubject',
    'analysisJson',
    'sourceRefs',
    'evidenceMap',
    'textForEmbedding',
    'storageKey',
    'passwordHash',
    'walletAddress',
    'issuerAddress',
    'contractAddress'
  ]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must not leak`);
  }
});

test('draft credentials are indistinguishable from an unknown public reference', async () => {
  const { service } = createContext(
    credentialFixture({
      status: 'draft',
      title: 'Borrador confidencial',
      canonicalHash: null,
      canonicalizationVersion: null
    })
  );

  await assert.rejects(
    () => service.getCredentialVerification('credential-draft'),
    (error: unknown) =>
      error instanceof NotFoundException &&
      error.message === 'No se encontro una credencial verificable con esa referencia.'
  );
});

test('an unknown public reference returns the same safe not-found response', async () => {
  const { service } = createContext(null);

  await assert.rejects(
    () => service.getCredentialVerification('credential-missing'),
    (error: unknown) =>
      error instanceof NotFoundException &&
      error.message === 'No se encontro una credencial verificable con esa referencia.'
  );
});

test('revoked credentials retain only safe historical verification evidence', async () => {
  const { service } = createContext(
    credentialFixture({
      status: 'revoked',
      revokedAt: new Date('2026-08-15T12:00:00.000Z'),
      revocationReason: 'Información corregida',
      blockchainRecords: [
        {
          network: 'base_sepolia',
          chainId: 84532,
          txHash: `0x${'c'.repeat(64)}`,
          status: 'revoked',
          registeredAt: new Date('2026-08-14T12:01:00.000Z')
        }
      ]
    })
  );

  const response = await service.getCredentialVerification('credential-revoked');

  assert.equal(response.status, 'revoked');
  assert.equal(response.statusLabel, 'Revocada');
  assert.equal(response.verification.result, 'revoked');
  assert.equal(response.integrity.latestBlockchainRecord?.networkLabel, 'Testnet');
  assert.equal(response.revocationReason, 'Información corregida');
});

test('issued credentials without canonical evidence remain public but are not verifiable', async () => {
  const { service } = createContext(
    credentialFixture({
      canonicalHash: null,
      canonicalizationVersion: null,
      _count: { blockchainRecords: 0 },
      blockchainRecords: []
    })
  );

  const response = await service.getCredentialVerification('credential-incomplete');

  assert.equal(response.verification.result, 'not_verifiable');
  assert.equal(response.integrity.canonicalHashPresent, false);
  assert.equal(response.integrity.latestBlockchainRecord, null);
});

test('public verification rejects a blank or oversized reference before querying', async () => {
  const { service, calls } = createContext();

  await assert.rejects(() => service.getCredentialVerification('  '), BadRequestException);
  await assert.rejects(
    () => service.getCredentialVerification('a'.repeat(201)),
    BadRequestException
  );
  assert.equal(calls.findUnique.length, 0);
});

test('public holder label never falls back to private email or an internal id', async () => {
  const { service } = createContext(
    credentialFixture({
      subjectUser: {
        displayName: ' ',
        firstName: null,
        lastName: null,
        did: null,
        email: 'must-not-leak@example.com',
        id: 'must-not-leak'
      }
    })
  );

  const response = await service.getCredentialVerification('credential-anonymous-holder');

  assert.equal(response.holder.displayLabel, null);
  assert.equal(JSON.stringify(response).includes('must-not-leak'), false);
});
