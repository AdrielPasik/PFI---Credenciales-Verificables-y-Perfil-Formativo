import assert from 'node:assert/strict';
import test from 'node:test';

import { NotFoundException } from '@nestjs/common';

import { VerificationService } from './verification.service';

function createVerificationServiceTestContext(options?: {
  credentialResult?: Record<string, unknown> | null;
  latestSemanticAnalysisResponse?: Record<string, unknown>;
}) {
  const calls = {
    credentialFindUnique: [] as Array<Record<string, unknown>>,
    semanticGetLatestForCredential: [] as string[],
    credentialUpdate: 0,
    blockchainRecordCreate: 0
  };

  const prisma = {
    credential: {
      findUnique: async (args: Record<string, unknown>) => {
        calls.credentialFindUnique.push(args);
        if (options && 'credentialResult' in options) {
          return options.credentialResult;
        }

        return {
          id: 'cred-123',
          title: 'Bases de Datos I',
          status: 'issued',
          issuedAt: new Date('2026-07-14T12:00:00.000Z'),
          revokedAt: null,
          revocationReason: null,
          canonicalHash: '0xabc',
          canonicalizationVersion: 'canon_v1',
          blockchainRecords: [
            {
              id: 'blockchain-123',
              network: 'anvil',
              chainId: 31337,
              txHash: '0xtxhash',
              registeredAt: new Date('2026-07-14T12:10:00.000Z'),
              status: 'registered'
            }
          ]
        };
      },
      update: async () => {
        calls.credentialUpdate += 1;
        return null;
      }
    },
    blockchainRecord: {
      create: async () => {
        calls.blockchainRecordCreate += 1;
        return null;
      }
    }
  };

  const semanticService = {
    async getLatestForCredential(credentialId: string) {
      calls.semanticGetLatestForCredential.push(credentialId);
      return (
        options?.latestSemanticAnalysisResponse ?? {
          credentialId,
          latestSemanticAnalysis: null
        }
      );
    }
  };

  return {
    service: new VerificationService(prisma as never, semanticService as never),
    calls
  };
}

test('credential inexistente throws NotFoundException', async () => {
  const { service, calls } = createVerificationServiceTestContext({
    credentialResult: null
  });

  await assert.rejects(
    () => service.getCredentialVerification('cred-missing'),
    NotFoundException
  );

  assert.deepEqual(calls.semanticGetLatestForCredential, []);
});

test('credential issued with hash and blockchain record returns verificationStatus valid', async () => {
  const { service } = createVerificationServiceTestContext({
    latestSemanticAnalysisResponse: {
      credentialId: 'cred-123',
      latestSemanticAnalysis: {
        id: 'semantic-123',
        schemaVersion: 'semantic_analysis_v1',
        status: 'completed',
        pipelineVersion: 'unversioned_current',
        taxonomyVersion: 'unversioned_current',
        confidence: 0.98,
        areas: [],
        skills: [],
        concepts: [],
        qualityFlags: ['semantic_quality_high'],
        evidenceMap: {},
        textForEmbedding: 'text',
        analysisJson: { foo: 'bar' },
        analyzedAt: '2026-07-14T12:20:00.000Z'
      }
    }
  });

  const response = await service.getCredentialVerification('cred-123');

  assert.equal(response.verificationStatus, 'valid');
  assert.equal(response.credential.canonicalHash, '0xabc');
  assert.equal(response.credential.canonicalizationVersion, 'canon_v1');
  assert.deepEqual(response.blockchain.records, [
    {
      id: 'blockchain-123',
      network: 'anvil',
      chainId: 31337,
      transactionHash: '0xtxhash',
      recordedAt: '2026-07-14T12:10:00Z',
      status: 'registered'
    }
  ]);
  assert.deepEqual(response.semanticAnalysis.latest, {
    id: 'semantic-123',
    schemaVersion: 'semantic_analysis_v1',
    status: 'completed',
    pipelineVersion: 'unversioned_current',
    taxonomyVersion: 'unversioned_current',
    confidence: 0.98,
    areas: [],
    skills: [],
    concepts: [],
    qualityFlags: ['semantic_quality_high'],
    analyzedAt: '2026-07-14T12:20:00.000Z'
  });
});

test('credential issued with hash and canon but without blockchain record returns verificationStatus incomplete', async () => {
  const { service } = createVerificationServiceTestContext({
    credentialResult: {
      id: 'cred-issued-no-chain',
      title: 'Materia emitida sin blockchain',
      status: 'issued',
      issuedAt: new Date('2026-07-14T12:00:00.000Z'),
      revokedAt: null,
      revocationReason: null,
      canonicalHash: '0xabc',
      canonicalizationVersion: 'canon_v1',
      blockchainRecords: []
    }
  });

  const response = await service.getCredentialVerification(
    'cred-issued-no-chain'
  );

  assert.equal(response.verificationStatus, 'incomplete');
});

test('credential draft returns verificationStatus draft', async () => {
  const { service } = createVerificationServiceTestContext({
    credentialResult: {
      id: 'cred-draft',
      title: 'Materia draft',
      status: 'draft',
      issuedAt: null,
      revokedAt: null,
      revocationReason: null,
      canonicalHash: null,
      canonicalizationVersion: null,
      blockchainRecords: []
    }
  });

  const response = await service.getCredentialVerification('cred-draft');

  assert.equal(response.verificationStatus, 'draft');
});

test('credential revoked returns verificationStatus revoked', async () => {
  const { service } = createVerificationServiceTestContext({
    credentialResult: {
      id: 'cred-revoked',
      title: 'Materia revocada',
      status: 'revoked',
      issuedAt: new Date('2026-07-14T12:00:00.000Z'),
      revokedAt: new Date('2026-07-15T10:00:00.000Z'),
      revocationReason: 'error',
      canonicalHash: '0xabc',
      canonicalizationVersion: 'canon_v1',
      blockchainRecords: []
    }
  });

  const response = await service.getCredentialVerification('cred-revoked');

  assert.equal(response.verificationStatus, 'revoked');
});

test('credential issued without hash or canonicalizationVersion returns verificationStatus incomplete', async () => {
  const { service } = createVerificationServiceTestContext({
    credentialResult: {
      id: 'cred-incomplete',
      title: 'Materia incompleta',
      status: 'issued',
      issuedAt: new Date('2026-07-14T12:00:00.000Z'),
      revokedAt: null,
      revocationReason: null,
      canonicalHash: null,
      canonicalizationVersion: null,
      blockchainRecords: []
    }
  });

  const response = await service.getCredentialVerification('cred-incomplete');

  assert.equal(response.verificationStatus, 'incomplete');
});

test('credential issued with non-registered blockchain records returns verificationStatus incomplete', async () => {
  const { service } = createVerificationServiceTestContext({
    credentialResult: {
      id: 'cred-issued-revoked-chain',
      title: 'Materia con evidencia no valida',
      status: 'issued',
      issuedAt: new Date('2026-07-14T12:00:00.000Z'),
      revokedAt: null,
      revocationReason: null,
      canonicalHash: '0xabc',
      canonicalizationVersion: 'canon_v1',
      blockchainRecords: [
        {
          id: 'blockchain-revoked',
          network: 'anvil',
          chainId: 31337,
          txHash: '0xtxhashrevoked',
          registeredAt: new Date('2026-07-14T12:10:00.000Z'),
          status: 'revoked'
        }
      ]
    }
  });

  const response = await service.getCredentialVerification(
    'cred-issued-revoked-chain'
  );

  assert.equal(response.verificationStatus, 'incomplete');
});

test('when there is no semantic analysis latest returns null', async () => {
  const { service } = createVerificationServiceTestContext({
    latestSemanticAnalysisResponse: {
      credentialId: 'cred-123',
      latestSemanticAnalysis: null
    }
  });

  const response = await service.getCredentialVerification('cred-123');

  assert.equal(response.semanticAnalysis.latest, null);
});

test('service does not modify credential, create blockchain record or recalculate hash', async () => {
  const { service, calls } = createVerificationServiceTestContext();

  const response = await service.getCredentialVerification('cred-123');

  assert.equal(calls.credentialUpdate, 0);
  assert.equal(calls.blockchainRecordCreate, 0);
  assert.equal(response.credential.canonicalHash, '0xabc');
  assert.equal(response.credential.canonicalizationVersion, 'canon_v1');
});
