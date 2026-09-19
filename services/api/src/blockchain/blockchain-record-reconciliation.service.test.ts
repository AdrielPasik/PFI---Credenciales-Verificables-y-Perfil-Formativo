import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BlockchainNetwork,
  BlockchainRecordStatus,
  CredentialStatus
} from '@prisma/client';

import { BlockchainRecordReconciliationService } from './blockchain-record-reconciliation.service';
import {
  type BlockchainRecordDeploymentIdentity,
  type CredentialRegistryDeployment,
  type RecordBoundDeploymentResolution
} from './credential-registry-deployment';
import { type CredentialRegistryRecordBoundReader } from './credential-registry-read-client';

const VALID_HASH =
  '0xaf032042c1bcfb72f9caac350eb3cb576f44ab07b1c1968f4b36264da44ff2ab';
const VALID_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const VALID_ISSUER_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

test('clasifica issued + cadena activa sin escribir en ningun sistema', async () => {
  const result = await createService('active').classify({
    credential: createCredential(CredentialStatus.issued),
    blockchainRecord: createRecord()
  });

  assert.deepEqual(result, {
    state: 'DB_ISSUED_CHAIN_ACTIVE',
    chainRevoked: false,
    resolvedDeployment: deployment(),
    chainRevokedAt: null
  });
});

test('clasifica issued + cadena revocada para reconciliacion futura sin reenviar transaccion', async () => {
  const result = await createService('revoked').classify({
    credential: createCredential(CredentialStatus.issued),
    blockchainRecord: createRecord()
  });

  assert.deepEqual(result, {
    state: 'DB_ISSUED_CHAIN_REVOKED',
    chainRevoked: true,
    resolvedDeployment: deployment(),
    chainRevokedAt: '2'
  });
});

test('clasifica revoked + cadena revocada como estado reconciliado', async () => {
  const result = await createService('revoked').classify({
    credential: createCredential(CredentialStatus.revoked),
    blockchainRecord: createRecord({ status: BlockchainRecordStatus.revoked })
  });

  assert.deepEqual(result, {
    state: 'DB_REVOKED_CHAIN_REVOKED',
    chainRevoked: true,
    resolvedDeployment: deployment(),
    chainRevokedAt: '2'
  });
});

test('clasifica revoked + cadena activa como inconsistencia cerrada', async () => {
  const result = await createService('active').classify({
    credential: createCredential(CredentialStatus.revoked),
    blockchainRecord: createRecord()
  });

  assert.deepEqual(result, {
    state: 'DB_REVOKED_CHAIN_ACTIVE',
    chainRevoked: false,
    resolvedDeployment: deployment(),
    chainRevokedAt: null
  });
});

test('clasifica la ausencia de BlockchainRecord sin consultar la red', async () => {
  const reader = new FakeRecordBoundReader('active');
  const service = createService('active', { kind: 'resolved', deployment: deployment() }, reader);

  const result = await service.classify({
    credential: createCredential(CredentialStatus.issued),
    blockchainRecord: null
  });

  assert.deepEqual(result, {
    state: 'CHAIN_RECORD_MISSING',
    chainRevoked: null,
    resolvedDeployment: null,
    chainRevokedAt: null
  });
  assert.equal(reader.calls, 0);
});

test('clasifica mock y deployments no resueltos sin llamar al lector blockchain', async () => {
  const reader = new FakeRecordBoundReader('active');
  const mockService = createService('active', { kind: 'mock_unsupported' }, reader);
  const unresolvedService = createService(
    'active',
    { kind: 'deployment_unresolved', reason: 'contract_address_mismatch' },
    reader
  );

  assert.deepEqual(
    await mockService.classify({
      credential: createCredential(CredentialStatus.issued),
      blockchainRecord: createRecord()
    }),
    { state: 'MOCK_UNSUPPORTED', chainRevoked: null, resolvedDeployment: null, chainRevokedAt: null }
  );
  assert.deepEqual(
    await unresolvedService.classify({
      credential: createCredential(CredentialStatus.issued),
      blockchainRecord: createRecord()
    }),
    { state: 'DEPLOYMENT_UNRESOLVED', chainRevoked: null, resolvedDeployment: null, chainRevokedAt: null }
  );
  assert.equal(reader.calls, 0);
});

test('falla cerrado si la correlacion canonica local no corresponde al BlockchainRecord', async () => {
  const reader = new FakeRecordBoundReader('active');
  const service = createService('active', { kind: 'resolved', deployment: deployment() }, reader);

  const result = await service.classify({
    credential: { ...createCredential(CredentialStatus.issued), canonicalHash: null },
    blockchainRecord: createRecord()
  });

  assert.deepEqual(result, {
    state: 'CREDENTIAL_CORRELATION_FAILED',
    chainRevoked: null,
    resolvedDeployment: null,
    chainRevokedAt: null
  });
  assert.equal(reader.calls, 0);
});

test('clasifica un registro Anvil ausente como legacy no resoluble despues de un reset', async () => {
  const result = await createService('missing').classify({
    credential: createCredential(CredentialStatus.issued),
    blockchainRecord: createRecord()
  });

  assert.deepEqual(result, {
    state: 'LEGACY_UNRESOLVABLE',
    chainRevoked: null,
    resolvedDeployment: null,
    chainRevokedAt: null
  });
});

function createService(
  chain: 'active' | 'revoked' | 'missing',
  resolution: RecordBoundDeploymentResolution = {
    kind: 'resolved',
    deployment: deployment()
  },
  reader: FakeRecordBoundReader = new FakeRecordBoundReader(chain)
) {
  return new BlockchainRecordReconciliationService(
    new FakeDeploymentResolver(resolution),
    reader
  );
}

function deployment(): CredentialRegistryDeployment {
  return {
    network: BlockchainNetwork.anvil,
    chainId: 31337,
    rpcUrl: 'http://127.0.0.1:8545',
    contractAddress: VALID_ADDRESS
  };
}

function createCredential(status: CredentialStatus) {
  return {
    status,
    canonicalHash: VALID_HASH,
    canonicalizationVersion: 'canon_v1'
  };
}

function createRecord(
  overrides: Partial<{ status: BlockchainRecordStatus }> = {}
) {
  return {
    network: BlockchainNetwork.anvil,
    chainId: 31337,
    contractAddress: VALID_ADDRESS,
    credentialHash: VALID_HASH,
    issuerAddress: VALID_ISSUER_ADDRESS,
    canonicalizationVersion: 'canon_v1',
    status: BlockchainRecordStatus.registered,
    ...overrides
  };
}

class FakeDeploymentResolver {
  constructor(private readonly result: RecordBoundDeploymentResolution) {}

  resolve(_record: BlockchainRecordDeploymentIdentity): RecordBoundDeploymentResolution {
    return this.result;
  }
}

class FakeRecordBoundReader implements CredentialRegistryRecordBoundReader {
  calls = 0;

  constructor(private readonly chain: 'active' | 'revoked' | 'missing') {}

  async readRecordBoundCredentialState(input: {
    deployment: CredentialRegistryDeployment;
    record: BlockchainRecordDeploymentIdentity;
  }) {
    this.calls += 1;

    if (this.chain === 'missing') {
      return { kind: 'credential_missing' as const };
    }

    return {
      kind: 'credential_state' as const,
      status: {
        credentialHash: input.record.credentialHash,
        exists: true,
        revoked: this.chain === 'revoked',
        issuer: input.record.issuerAddress,
        registeredAt: '1',
        revokedAt: this.chain === 'revoked' ? '2' : null
      }
    };
  }
}
