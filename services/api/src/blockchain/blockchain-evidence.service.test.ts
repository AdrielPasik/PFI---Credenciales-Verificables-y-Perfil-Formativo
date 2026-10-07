import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BlockchainEvidenceMode,
  BlockchainRecordStatus,
  BlockchainNetwork
} from '@prisma/client';

import { BlockchainEvidenceService } from './blockchain-evidence.service';
import {
  BlockchainTargetError,
  safeBlockchainTargetMessage
} from './blockchain-target';

const VALID_HASH =
  '0xaf032042c1bcfb72f9caac350eb3cb576f44ab07b1c1968f4b36264da44ff2ab';
const VALID_CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const VALID_ISSUER_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const VALID_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_DEPLOYMENT_ID = 'test-anvil-local';

// S8c5: el modo dejo de llevar la red adentro. Antes alcanzaba
// BLOCKCHAIN_EVIDENCE_MODE=credential_registry_anvil; ahora hay que declarar
// red, chainId y deployment explicitamente.
const ANVIL_TARGET_ENV = {
  BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry',
  CREDENTIAL_REGISTRY_NETWORK: BlockchainNetwork.anvil,
  CREDENTIAL_REGISTRY_CHAIN_ID: '31337',
  CREDENTIAL_REGISTRY_RPC_URL: 'http://127.0.0.1:8545',
  CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: VALID_CONTRACT_ADDRESS,
  CREDENTIAL_REGISTRY_DEPLOYMENT_ID: TEST_DEPLOYMENT_ID,
  CREDENTIAL_REGISTRY_PRIVATE_KEY: VALID_PRIVATE_KEY
} as const;

test('sin BLOCKCHAIN_EVIDENCE_MODE usa mock', async () => {
  await withEnv(
    {
      BLOCKCHAIN_EVIDENCE_MODE: undefined,
      CREDENTIAL_REGISTRY_NETWORK: undefined,
      CREDENTIAL_REGISTRY_CHAIN_ID: undefined,
      CREDENTIAL_REGISTRY_RPC_URL: undefined,
      CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: undefined,
      CREDENTIAL_REGISTRY_DEPLOYMENT_ID: undefined,
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
      // S8c5: la procedencia mock pasa a ser EXPLICITA, no solo implicita en
      // el triple (anvil, 31337, 0x..01).
      assert.equal(
        transaction.calls.create[0]?.data.evidenceMode,
        BlockchainEvidenceMode.mock
      );
      assert.equal(transaction.calls.create[0]?.data.deploymentId, undefined);
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

test('BLOCKCHAIN_EVIDENCE_MODE invalido falla cerrado, sin degradar a mock', async () => {
  for (const rawMode of ['otro_modo', 'credential_registry_anvil', 'MOCK']) {
    await withEnv(
      {
        BLOCKCHAIN_EVIDENCE_MODE: rawMode
      },
      async () => {
        const transaction = createTransactionMock();
        const service = new BlockchainEvidenceService();

        await assert.rejects(
          () => service.createRecord(transaction as never, createInput()),
          (error: unknown) => {
            assert.ok(error instanceof BlockchainTargetError, rawMode);
            const typed = error as BlockchainTargetError;
            assert.equal(typed.code, 'BLOCKCHAIN_TARGET_CONFIG_INVALID');
            assert.equal(typed.field, 'BLOCKCHAIN_EVIDENCE_MODE');
            return true;
          },
          rawMode
        );

        // Lo critico: NO se creo un record mock. Degradar en silencio
        // reportaria evidencia de blockchain con la escritura real apagada.
        assert.equal(transaction.calls.create.length, 0, rawMode);
      }
    );
  }
});

test('credential_registry + anvil usa write client y crea BlockchainRecord real', async () => {
  await withEnv(
    { ...ANVIL_TARGET_ENV },
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
        status: BlockchainRecordStatus.registered,
        // Procedencia desde el target VALIDADO, no desde literales.
        evidenceMode: BlockchainEvidenceMode.credential_registry,
        deploymentId: TEST_DEPLOYMENT_ID
      });
    }
  );
});

test('contract mode con tx failed falla y no crea record', async () => {
  await withEnv(
    {
      ...ANVIL_TARGET_ENV
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

test('contract mode con config faltante falla cerrado y sin filtrar valores', async () => {
  await withEnv(
    {
      ...ANVIL_TARGET_ENV,
      CREDENTIAL_REGISTRY_RPC_URL: undefined
    },
    async () => {
      const transaction = createTransactionMock();
      const service = new BlockchainEvidenceService();

      await assert.rejects(
        () => service.createRecord(transaction as never, createInput()),
        (error: unknown) => {
          assert.ok(error instanceof BlockchainTargetError);
          const typed = error as BlockchainTargetError;
          assert.equal(typed.code, 'BLOCKCHAIN_TARGET_CONFIG_INVALID');
          // El NOMBRE de la variable que falta si viaja; ningun VALOR lo hace.
          assert.equal(typed.field, 'CREDENTIAL_REGISTRY_RPC_URL');
          assert.equal(
            typed.message,
            safeBlockchainTargetMessage('BLOCKCHAIN_TARGET_CONFIG_INVALID')
          );
          return true;
        }
      );

      assert.equal(transaction.calls.create.length, 0);
    }
  );
});

test('contract mode propaga error claro si falla registerCredential', async () => {
  await withEnv(
    {
      ...ANVIL_TARGET_ENV
    },
    async () => {
      const transaction = createTransactionMock();
      const writeClient = createWriteClientMock({
        registerError: new Error(
          'execution reverted at https://provider.example/v2/SECRET_API_KEY'
        )
      });
      const service = new BlockchainEvidenceService();
      Object.assign(service, {
        createWriteClient: () => writeClient
      });

      await assert.rejects(
        () => service.createRecord(transaction as never, createInput()),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          const message = (error as Error).message;
          assert.match(message, /No se pudo registrar el hash on-chain/);
          // El error crudo del provider NO se propaga: podia traer la URL del
          // RPC con su credencial adentro.
          assert.ok(!message.includes('SECRET_API_KEY'));
          assert.ok(!message.includes('provider.example'));
          assert.ok(!message.includes('execution reverted'));
          return true;
        }
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
    evidenceMode?: BlockchainEvidenceMode;
    deploymentId?: string;
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
