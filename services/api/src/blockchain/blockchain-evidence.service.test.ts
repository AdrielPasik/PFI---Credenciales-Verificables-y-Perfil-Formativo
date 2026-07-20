import assert from 'node:assert/strict';
import test from 'node:test';

import { BlockchainRecordStatus, BlockchainNetwork } from '@prisma/client';

import { BlockchainEvidenceService } from './blockchain-evidence.service';

const VALID_HASH =
  '0xaf032042c1bcfb72f9caac350eb3cb576f44ab07b1c1968f4b36264da44ff2ab';
const VALID_CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const VALID_ISSUER_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const VALID_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

test('sin BLOCKCHAIN_EVIDENCE_MODE usa mock', async () => {
  await withEnv(
    {
      BLOCKCHAIN_EVIDENCE_MODE: undefined,
      CREDENTIAL_REGISTRY_RPC_URL: undefined,
      CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: undefined,
      CREDENTIAL_REGISTRY_PRIVATE_KEY: undefined
    },
    async () => {
      const writeClient = createWriteClientMock();
      const transaction = createTransactionMock();
      const service = new BlockchainEvidenceService();
      Object.assign(service, {
        createWriteClient: () => writeClient
      });

      await service.createRecord(transaction as never, createInput());

      assert.equal(writeClient.calls.registerCredential.length, 0);
      assert.equal(transaction.calls.create.length, 1);
      assert.equal(
        transaction.calls.create[0]?.data.txHash.startsWith('0x'),
        true
      );
      assert.equal(
        transaction.calls.create[0]?.data.contractAddress,
        '0x0000000000000000000000000000000000000001'
      );
    }
  );
});

test('BLOCKCHAIN_EVIDENCE_MODE=mock usa mock', async () => {
  await withEnv(
    {
      BLOCKCHAIN_EVIDENCE_MODE: 'mock'
    },
    async () => {
      const writeClient = createWriteClientMock();
      const transaction = createTransactionMock();
      const service = new BlockchainEvidenceService();
      Object.assign(service, {
        createWriteClient: () => writeClient
      });

      await service.createRecord(transaction as never, createInput());

      assert.equal(writeClient.calls.registerCredential.length, 0);
      assert.equal(transaction.calls.create.length, 1);
      assert.equal(
        transaction.calls.create[0]?.data.status,
        BlockchainRecordStatus.registered
      );
    }
  );
});

test('BLOCKCHAIN_EVIDENCE_MODE invalido falla con error claro', async () => {
  await withEnv(
    {
      BLOCKCHAIN_EVIDENCE_MODE: 'otro_modo'
    },
    async () => {
      const service = new BlockchainEvidenceService();

      await assert.rejects(
        () =>
          service.createRecord(createTransactionMock() as never, createInput()),
        /BLOCKCHAIN_EVIDENCE_MODE invalido/
      );
    }
  );
});

test('BLOCKCHAIN_EVIDENCE_MODE=credential_registry_anvil usa write client y crea BlockchainRecord real', async () => {
  await withEnv(
    {
      BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry_anvil',
      CREDENTIAL_REGISTRY_RPC_URL: 'http://127.0.0.1:8545',
      CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: VALID_CONTRACT_ADDRESS,
      CREDENTIAL_REGISTRY_PRIVATE_KEY: VALID_PRIVATE_KEY
    },
    async () => {
      const writeClient = createWriteClientMock({
        registerResult: {
          credentialHash: VALID_HASH,
          transactionHash:
            '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          from: VALID_ISSUER_ADDRESS,
          to: VALID_CONTRACT_ADDRESS,
          status: 'success',
          blockNumber: '7'
        }
      });
      const transaction = createTransactionMock();
      const service = new BlockchainEvidenceService();
      Object.assign(service, {
        createWriteClient: () => writeClient
      });

      await service.createRecord(transaction as never, createInput());

      assert.deepEqual(writeClient.calls.registerCredential, [VALID_HASH]);
      assert.equal(transaction.calls.create.length, 1);
      assert.deepEqual(transaction.calls.create[0]?.data, {
        credentialId: 'cred-123',
        credentialHash: VALID_HASH,
        hashAlgorithm: 'sha-256',
        canonicalizationVersion: 'canon_v1',
        network: BlockchainNetwork.anvil,
        chainId: 31337,
        contractAddress: VALID_CONTRACT_ADDRESS,
        txHash:
          '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        issuerAddress: VALID_ISSUER_ADDRESS,
        registeredAt: transaction.calls.create[0]?.data.registeredAt,
        status: BlockchainRecordStatus.registered
      });
    }
  );
});

test('contract mode con tx failed falla y no crea record', async () => {
  await withEnv(
    {
      BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry_anvil',
      CREDENTIAL_REGISTRY_RPC_URL: 'http://127.0.0.1:8545',
      CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: VALID_CONTRACT_ADDRESS,
      CREDENTIAL_REGISTRY_PRIVATE_KEY: VALID_PRIVATE_KEY
    },
    async () => {
      const writeClient = createWriteClientMock({
        registerResult: {
          credentialHash: VALID_HASH,
          transactionHash:
            '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          from: VALID_ISSUER_ADDRESS,
          to: VALID_CONTRACT_ADDRESS,
          status: 'failed',
          blockNumber: '8'
        }
      });
      const transaction = createTransactionMock();
      const service = new BlockchainEvidenceService();
      Object.assign(service, {
        createWriteClient: () => writeClient
      });

      await assert.rejects(
        () => service.createRecord(transaction as never, createInput()),
        /no fue exitosa/
      );

      assert.equal(transaction.calls.create.length, 0);
    }
  );
});

test('contract mode con config faltante falla con error claro', async () => {
  await withEnv(
    {
      BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry_anvil',
      CREDENTIAL_REGISTRY_RPC_URL: undefined,
      CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: VALID_CONTRACT_ADDRESS,
      CREDENTIAL_REGISTRY_PRIVATE_KEY: VALID_PRIVATE_KEY
    },
    async () => {
      const transaction = createTransactionMock();
      const service = new BlockchainEvidenceService();

      await assert.rejects(
        () => service.createRecord(transaction as never, createInput()),
        /CREDENTIAL_REGISTRY_RPC_URL/
      );

      assert.equal(transaction.calls.create.length, 0);
    }
  );
});

test('contract mode propaga error claro si falla registerCredential', async () => {
  await withEnv(
    {
      BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry_anvil',
      CREDENTIAL_REGISTRY_RPC_URL: 'http://127.0.0.1:8545',
      CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: VALID_CONTRACT_ADDRESS,
      CREDENTIAL_REGISTRY_PRIVATE_KEY: VALID_PRIVATE_KEY
    },
    async () => {
      const transaction = createTransactionMock();
      const writeClient = createWriteClientMock({
        registerError: new Error('execution reverted: CredentialAlreadyRegistered')
      });
      const service = new BlockchainEvidenceService();
      Object.assign(service, {
        createWriteClient: () => writeClient
      });

      await assert.rejects(
        () => service.createRecord(transaction as never, createInput()),
        /No se pudo registrar el hash on-chain/
      );

      assert.equal(transaction.calls.create.length, 0);
    }
  );
});

function createInput() {
  return {
    credentialId: 'cred-123',
    credentialHash: VALID_HASH,
    canonicalizationVersion: 'canon_v1',
    issuerAddress: VALID_ISSUER_ADDRESS
  };
}

function createTransactionMock() {
  type BlockchainRecordCreateData = {
    credentialId: string;
    credentialHash: string;
    hashAlgorithm: string;
    canonicalizationVersion: string;
    network: BlockchainNetwork;
    chainId: number;
    contractAddress: string;
    txHash: string;
    issuerAddress: string;
    registeredAt: Date;
    status: BlockchainRecordStatus;
  };

  const calls: Array<{ data: BlockchainRecordCreateData }> = [];

  return {
    calls: {
      create: calls
    },
    blockchainRecord: {
      async create(input: { data: BlockchainRecordCreateData }) {
        calls.push(input);
        return {
          id: 'blockchain-record-123',
          ...input.data
        };
      }
    }
  };
}

function createWriteClientMock(options?: {
  registerResult?: {
    credentialHash: string;
    transactionHash: string;
    from: string | null;
    to: string | null;
    status: 'success' | 'failed' | 'unknown';
    blockNumber: string | null;
  };
  registerError?: Error;
}) {
  const calls = {
    registerCredential: [] as string[]
  };

  return {
    calls,
    async registerCredential(credentialHash: string) {
      calls.registerCredential.push(credentialHash);

      if (options?.registerError) {
        throw options.registerError;
      }

      return (
        options?.registerResult ?? {
          credentialHash,
          transactionHash:
            '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          from: VALID_ISSUER_ADDRESS,
          to: VALID_CONTRACT_ADDRESS,
          status: 'success' as const,
          blockNumber: '5'
        }
      );
    }
  };
}

async function withEnv(
  overrides: Record<string, string | undefined>,
  run: () => Promise<void>
) {
  const previousValues = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    previousValues.set(key, process.env[key]);

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    await run();
  } finally {
    for (const [key, value] of previousValues.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
