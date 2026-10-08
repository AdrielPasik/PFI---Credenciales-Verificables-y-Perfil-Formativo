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

test('S8c6: el servicio de evidencia YA NO escribe en la cadena', async () => {
  // Hasta S8c5 este servicio hacia la escritura real ADENTRO de la transaccion
  // interactiva que recibe por parametro. Esa era la deuda que S8a encontro.
  // Ahora el camino `credential_registry` vive en el ciclo de vida de
  // registracion, con intent PENDING durable y escritura despues del commit.
  await withEnv({ ...ANVIL_TARGET_ENV }, async () => {
    const transaction = createTransactionMock();
    const service = new BlockchainEvidenceService();

    await assert.rejects(
      () => service.createRecord(transaction as never, createInput()),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(
          (error as Error).message,
          /ciclo de vida de registracion/
        );
        return true;
      }
    );

    // Y no deja ninguna fila a medio hacer.
    assert.equal(transaction.calls.create.length, 0);
  });
});

test('S8c6: el target se puede inyectar para no resolverlo dos veces', async () => {
  const transaction = createTransactionMock();
  const service = new BlockchainEvidenceService();

  // El llamador resuelve la configuracion UNA vez y decide la forma del ciclo
  // de vida; pasarsela evita dos resoluciones que podrian divergir.
  await service.createRecord(transaction as never, createInput(), {
    evidenceMode: 'mock'
  });

  assert.equal(transaction.calls.create.length, 1);
  assert.equal(
    transaction.calls.create[0]?.data.evidenceMode,
    BlockchainEvidenceMode.mock
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
