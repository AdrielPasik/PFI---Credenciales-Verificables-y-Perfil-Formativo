/**
 * Reconciliacion operativa issuer-scoped -- S8 cierre de Base Sepolia.
 *
 * Se arma con el servicio de reconciliacion REAL y solo se doblan los bordes:
 * Prisma, la autorizacion de membership, el manifest en memoria y el LECTOR de
 * la cadena. El lector es un Proxy que LANZA ante cualquier propiedad que no
 * sea una lectura (`getLogs`, `getBlock`, `getBlockNumber`): si alguna ruta
 * intentara firmar, enviar o escribir, el test falla. Ese es el cierre de
 * "reconciliar NUNCA envia una transaccion".
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA
} from '@nestjs/common/constants';
import { ForbiddenException, RequestMethod } from '@nestjs/common';
import {
  BlockchainEvidenceMode,
  BlockchainNetwork,
  BlockchainRecordStatus,
  CredentialStatus
} from '@prisma/client';

import { AuthGuard } from '../auth/auth.guard';
import { BlockchainRegistrationReconciliationService } from '../blockchain/blockchain-registration-reconciliation.service';
import { type BlockchainTargetEnvironment } from '../blockchain/blockchain-target';
import { CREDENTIAL_REGISTERED_TOPIC } from '../blockchain/credential-registry-events';
import { PUBLIC_TEST_KEY_ONE, PUBLIC_TEST_KEY_TWO } from '../signing/__fixtures__/signer-test-keys';
import { IssuerCredentialBlockchainReconciliationController } from './issuer-credential-blockchain-reconciliation.controller';
import {
  IssuerCredentialBlockchainReconciliationService,
  IssuerCredentialReconciliationError
} from './issuer-credential-blockchain-reconciliation.service';

const ISSUER_ID = 'issuer-1';
const CREDENTIAL_ID = 'credential-1';
const RECORD_ID = 'record-1';
const CONTRACT = '0xCb7401e268f61b1242B17fE141453471CFbdc6e1';
const DEPLOYMENT_ID = 'base-sepolia-84532-0xcb7401e268f61b1242b17fe141453471cfbdc6e1';
const DEPLOYMENT_BLOCK = 47934147;
const HASH = `0x${'ab'.repeat(32)}`;
const TX_HASH = `0x${'12'.repeat(32)}`;
const EVENT_BLOCK = 47934900;
const BLOCK_TIME = 1_791_000_000;
const OPERATOR = { id: 'operator-1', email: 'op@example.com', did: 'did:x', status: 'active' } as never;

const ENVIRONMENT: BlockchainTargetEnvironment = {
  BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry',
  CREDENTIAL_REGISTRY_NETWORK: 'base_sepolia',
  CREDENTIAL_REGISTRY_CHAIN_ID: '84532',
  CREDENTIAL_REGISTRY_RPC_URL: 'https://provider.example/v2/SECRET_API_KEY',
  CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: CONTRACT,
  CREDENTIAL_REGISTRY_DEPLOYMENT_ID: DEPLOYMENT_ID
};

const MANIFEST = JSON.stringify({
  schemaVersion: 'credential_registry_deployment_v1',
  deploymentId: DEPLOYMENT_ID,
  network: 'base_sepolia',
  chainId: 84532,
  contractAddress: CONTRACT,
  deploymentBlockNumber: DEPLOYMENT_BLOCK
});

function pendingRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: RECORD_ID,
    status: BlockchainRecordStatus.pending,
    evidenceMode: BlockchainEvidenceMode.credential_registry,
    credentialHash: HASH,
    network: BlockchainNetwork.base_sepolia,
    chainId: 84532,
    contractAddress: CONTRACT,
    deploymentId: DEPLOYMENT_ID,
    txHash: null,
    blockNumber: null,
    registeredAt: null,
    revokedAt: null,
    anchorSignerProfileId: 'anchor-profile-1',
    anchorSignerProfile: { address: PUBLIC_TEST_KEY_ONE.addressLowercase },
    ...overrides
  };
}

function registeredLog(registrant = PUBLIC_TEST_KEY_ONE.address) {
  return {
    address: CONTRACT,
    topics: [
      CREDENTIAL_REGISTERED_TOPIC,
      HASH,
      `0x${'0'.repeat(24)}${registrant.slice(2).toLowerCase()}`
    ],
    data: `0x${BLOCK_TIME.toString(16).padStart(64, '0')}`,
    transactionHash: TX_HASH,
    blockNumber: EVENT_BLOCK
  };
}

interface WorldOptions {
  credentialStatus?: CredentialStatus;
  records?: Array<Record<string, unknown>>;
  credentialExists?: boolean;
  membershipError?: Error;
  logs?: unknown[];
  logsError?: Error;
  head?: number;
  manifest?: string | null;
  withBlockNumber?: boolean;
  issuedAt?: Date | null;
}

function createWorld(options: WorldOptions = {}) {
  const records = options.records ?? [pendingRecord()];
  const events: string[] = [];
  const logFilters: Array<{ fromBlock: number; toBlock: unknown }> = [];
  let readerCreated = 0;
  let finalizeCalls = 0;
  const membershipChecks: Array<{ userId: string; issuerId: string }> = [];
  const credentialLookups: Array<Record<string, unknown>> = [];

  const prisma = {
    credential: {
      async findFirst(args: { where: Record<string, unknown> }) {
        credentialLookups.push(args.where);
        events.push('db:credential');
        if (options.credentialExists === false || args.where.issuerId !== ISSUER_ID) {
          return null;
        }
        return {
          id: CREDENTIAL_ID,
          status: options.credentialStatus ?? CredentialStatus.issued,
          issuedAt: options.issuedAt ?? null,
          blockchainRecords: records
        };
      }
    },
    blockchainRecord: {
      async findUnique() {
        events.push('db:record');
        return records[0] ?? null;
      }
    }
  };

  const issuersService = {
    async assertUserCanIssueCredentialForIssuer(userId: string, issuerId: string) {
      membershipChecks.push({ userId, issuerId });
      events.push('authz');
      if (options.membershipError) {
        throw options.membershipError;
      }
      return { id: 'membership-1' };
    }
  };

  // Simula la persistencia de TX corta: pending -> registered con la evidencia
  // que la CADENA mostro.
  const registrationService = {
    async finalizeRegistration(input: { evidence: Record<string, any> }) {
      finalizeCalls += 1;
      events.push('db:finalize');
      Object.assign(records[0], {
        status: BlockchainRecordStatus.registered,
        txHash: input.evidence.txHash,
        blockNumber: input.evidence.blockNumber,
        registeredAt: input.evidence.registeredAt
      });
    }
  };

  const allowedReads = new Set(['getLogs', 'getBlock', 'getBlockNumber']);
  const reader = new Proxy(
    {
      async getLogs(filter: { fromBlock: number; toBlock: unknown }) {
        events.push('chain:getLogs');
        logFilters.push({ fromBlock: filter.fromBlock, toBlock: filter.toBlock });
        if (options.logsError) {
          throw options.logsError;
        }
        const logs = options.logs ?? [];
        const from = filter.fromBlock;
        const to = filter.toBlock === 'latest' ? Number.MAX_SAFE_INTEGER : (filter.toBlock as number);
        return logs.filter((log) => {
          const block = (log as { blockNumber: number }).blockNumber;
          return block >= from && block <= to;
        });
      },
      async getBlock() {
        events.push('chain:getBlock');
        return { timestamp: BigInt(BLOCK_TIME) };
      },
      async getBlockNumber() {
        events.push('chain:getBlockNumber');
        return options.head ?? EVENT_BLOCK + 50;
      }
    } as Record<string, unknown>,
    {
      get(target, property) {
        if (typeof property === 'string' && !allowedReads.has(property) && property !== 'then') {
          throw new Error(`ESCRITURA O ACCESO NO PERMITIDO EN RECONCILIACION: ${property}`);
        }
        if (property === 'getBlockNumber' && options.withBlockNumber === false) {
          return undefined;
        }
        return target[property as string];
      }
    }
  );

  const reconciliation = new BlockchainRegistrationReconciliationService(
    prisma as never,
    registrationService as never,
    {
      createReader: () => {
        readerCreated += 1;
        return reader as never;
      },
      environment: ENVIRONMENT
    }
  );

  const manifestReads: string[] = [];
  const service = new IssuerCredentialBlockchainReconciliationService(
    prisma as never,
    issuersService as never,
    reconciliation,
    {
      manifestDirectory: '/manifests',
      readFile: (path: string) => {
        manifestReads.push(path);
        if (options.manifest === null) {
          throw new Error('ENOENT');
        }
        return options.manifest ?? MANIFEST;
      }
    }
  );

  return {
    service,
    records,
    events,
    logFilters,
    membershipChecks,
    credentialLookups,
    manifestReads,
    stats: () => ({ readerCreated, finalizeCalls })
  };
}

const NO_CHAIN_EVENTS = (events: string[]) => events.filter((event) => event.startsWith('chain:'));

// ---------------------------------------------------------------------------
// AUTORIZACION Y AISLAMIENTO
// ---------------------------------------------------------------------------

test('la ruta es POST issuers/:issuerId/credentials/:credentialId/blockchain/reconcile con AuthGuard', () => {
  const handler = IssuerCredentialBlockchainReconciliationController.prototype.reconcile;

  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, handler), [AuthGuard]);
  assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), RequestMethod.POST);
  assert.equal(Reflect.getMetadata(PATH_METADATA, handler), ':credentialId/blockchain/reconcile');
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, IssuerCredentialBlockchainReconciliationController),
    'issuers/:issuerId/credentials'
  );
});

test('sin membership admin/operator activa se rechaza ANTES de leer la base o la cadena', async () => {
  const world = createWorld({ membershipError: new ForbiddenException('no') });

  await assert.rejects(
    () => world.service.reconcileForIssuer(ISSUER_ID, CREDENTIAL_ID, OPERATOR),
    ForbiddenException
  );

  assert.deepEqual(world.events, ['authz']);
  assert.deepEqual(world.membershipChecks, [{ userId: 'operator-1', issuerId: ISSUER_ID }]);
});

test('aislamiento: una credencial de OTRO issuer es 404 y no toca la cadena', async () => {
  const world = createWorld();

  await assert.rejects(
    () => world.service.reconcileForIssuer('issuer-2', CREDENTIAL_ID, OPERATOR),
    (error: unknown) =>
      error instanceof IssuerCredentialReconciliationError &&
      error.getStatus() === 404 &&
      (error.getResponse() as { code: string }).code === 'CREDENTIAL_NOT_FOUND'
  );

  assert.deepEqual(world.credentialLookups, [{ id: CREDENTIAL_ID, issuerId: 'issuer-2' }]);
  assert.deepEqual(NO_CHAIN_EVENTS(world.events), []);
  assert.equal(world.stats().readerCreated, 0);
});

test('los estados invalidos fallan con un codigo claro y sin tocar la cadena', async () => {
  const cases: Array<[WorldOptions, string]> = [
    [{ credentialStatus: CredentialStatus.draft }, 'CREDENTIAL_NOT_ISSUED'],
    [{ records: [] }, 'BLOCKCHAIN_RECORD_MISSING'],
    [{ records: [pendingRecord(), pendingRecord({ id: 'record-2' })] }, 'BLOCKCHAIN_RECORD_AMBIGUOUS'],
    [
      { records: [pendingRecord({ evidenceMode: null })] },
      'RECONCILIATION_NOT_APPLICABLE'
    ]
  ];

  for (const [options, code] of cases) {
    const world = createWorld(options);

    await assert.rejects(
      () => world.service.reconcileForIssuer(ISSUER_ID, CREDENTIAL_ID, OPERATOR),
      (error: unknown) =>
        error instanceof IssuerCredentialReconciliationError &&
        (error.getResponse() as { code: string }).code === code
    );

    assert.deepEqual(NO_CHAIN_EVENTS(world.events), [], code);
    assert.equal(world.stats().readerCreated, 0, code);
  }
});

// ---------------------------------------------------------------------------
// RESULTADOS
// ---------------------------------------------------------------------------

test('pending -> registered cuando la cadena muestra la registracion (rango desde el manifest, solo lectura)', async () => {
  const world = createWorld({ logs: [registeredLog()] });

  const response = await world.service.reconcileForIssuer(ISSUER_ID, CREDENTIAL_ID, OPERATOR);

  assert.equal(response.result, 'registered');
  assert.equal(response.outcome, 'FINALIZED');
  assert.equal(response.blockchain.status, 'registered');
  assert.equal(response.blockchain.txHash, TX_HASH);
  assert.equal(response.blockchain.blockNumber, EVENT_BLOCK);
  assert.equal(world.stats().finalizeCalls, 1);

  // El limite inferior sale del manifest de la FILA, nunca del llamador.
  assert.deepEqual(world.manifestReads, [join('/manifests', `${DEPLOYMENT_ID}.json`)]);
  for (const filter of world.logFilters) {
    assert.ok(filter.fromBlock >= DEPLOYMENT_BLOCK);
  }
  // Solo lecturas de cadena: el Proxy habria lanzado ante cualquier escritura.
  assert.ok(NO_CHAIN_EVENTS(world.events).every((event) =>
    ['chain:getLogs', 'chain:getBlock', 'chain:getBlockNumber'].includes(event)
  ));
});

test('pending sin evidencia en la cadena sigue pending: NO reenvia y NO finaliza', async () => {
  const world = createWorld({ logs: [] });

  const response = await world.service.reconcileForIssuer(ISSUER_ID, CREDENTIAL_ID, OPERATOR);

  assert.equal(response.result, 'still_pending');
  assert.equal(response.outcome, 'CHAIN_NOT_REGISTERED');
  assert.equal(response.blockchain.status, 'pending');
  assert.equal(response.blockchain.txHash, null);
  assert.equal(world.stats().finalizeCalls, 0);
  assert.equal(world.records[0].status, BlockchainRecordStatus.pending);
});

test('una falla del RPC deja el registro pending y NO provoca ningun reenvio', async () => {
  const world = createWorld({ logsError: new Error('https://provider.example/v2/SECRET_API_KEY') });

  const response = await world.service.reconcileForIssuer(ISSUER_ID, CREDENTIAL_ID, OPERATOR);

  assert.equal(response.result, 'still_pending');
  assert.equal(response.outcome, 'CHAIN_UNAVAILABLE');
  assert.equal(JSON.stringify(response).includes('SECRET_API_KEY'), false);
  assert.equal(world.stats().finalizeCalls, 0);
});

test('ya registrada es idempotente y ni siquiera toca la cadena', async () => {
  const registered = pendingRecord({
    status: BlockchainRecordStatus.registered,
    txHash: TX_HASH,
    blockNumber: EVENT_BLOCK,
    registeredAt: new Date('2026-10-12T10:00:00Z')
  });
  const world = createWorld({ records: [registered] });

  const first = await world.service.reconcileForIssuer(ISSUER_ID, CREDENTIAL_ID, OPERATOR);
  const second = await world.service.reconcileForIssuer(ISSUER_ID, CREDENTIAL_ID, OPERATOR);

  assert.deepEqual(first, second);
  assert.equal(first.result, 'registered');
  assert.equal(first.outcome, 'ALREADY_REGISTERED');
  assert.equal(world.stats().readerCreated, 0);
  assert.equal(world.stats().finalizeCalls, 0);
  assert.deepEqual(world.manifestReads, []);
});

test('revocada nunca retrocede: ni por registro revocado ni por credencial revocada, y sin red', async () => {
  const revokedRecord = pendingRecord({
    status: BlockchainRecordStatus.revoked,
    revokedAt: new Date('2026-10-13T10:00:00Z'),
    txHash: TX_HASH
  });
  const worlds = [
    createWorld({ records: [revokedRecord], credentialStatus: CredentialStatus.revoked }),
    createWorld({
      records: [pendingRecord({ status: BlockchainRecordStatus.registered, txHash: TX_HASH })],
      credentialStatus: CredentialStatus.revoked
    })
  ];

  for (const world of worlds) {
    const response = await world.service.reconcileForIssuer(ISSUER_ID, CREDENTIAL_ID, OPERATOR);

    assert.equal(response.result, 'revoked');
    assert.equal(response.outcome, 'REVOKED');
    assert.equal(world.stats().readerCreated, 0);
    assert.equal(world.stats().finalizeCalls, 0);
  }
});

test('un registrante inesperado o evidencia en conflicto es 409 y no finaliza', async () => {
  const unexpected = createWorld({ logs: [registeredLog(PUBLIC_TEST_KEY_TWO.address)] });

  await assert.rejects(
    () => unexpected.service.reconcileForIssuer(ISSUER_ID, CREDENTIAL_ID, OPERATOR),
    (error: unknown) =>
      error instanceof IssuerCredentialReconciliationError &&
      error.getStatus() === 409 &&
      (error.getResponse() as { code: string }).code === 'REGISTRANT_UNEXPECTED'
  );
  assert.equal(unexpected.stats().finalizeCalls, 0);

  const conflicting = createWorld({
    records: [pendingRecord({ txHash: `0x${'99'.repeat(32)}` })],
    logs: [registeredLog()]
  });

  await assert.rejects(
    () => conflicting.service.reconcileForIssuer(ISSUER_ID, CREDENTIAL_ID, OPERATOR),
    (error: unknown) =>
      error instanceof IssuerCredentialReconciliationError &&
      (error.getResponse() as { code: string }).code === 'EVIDENCE_CONFLICT'
  );
  assert.equal(conflicting.stats().finalizeCalls, 0);
});

test('sin manifest valido para la fila no hay rango: 503 y la cadena no se toca', async () => {
  for (const manifest of [
    null,
    '{not json',
    JSON.stringify({ ...JSON.parse(MANIFEST), chainId: 1 }),
    JSON.stringify({ ...JSON.parse(MANIFEST), contractAddress: PUBLIC_TEST_KEY_ONE.address }),
    JSON.stringify({ ...JSON.parse(MANIFEST), deploymentBlockNumber: 0 })
  ]) {
    const world = createWorld({ manifest, logs: [registeredLog()] });

    await assert.rejects(
      () => world.service.reconcileForIssuer(ISSUER_ID, CREDENTIAL_ID, OPERATOR),
      (error: unknown) =>
        error instanceof IssuerCredentialReconciliationError &&
        error.getStatus() === 503 &&
        (error.getResponse() as { code: string }).code === 'DEPLOYMENT_MANIFEST_UNAVAILABLE'
    );

    assert.equal(world.stats().readerCreated, 0);
  }
});

test('la busqueda se parte en ventanas acotadas desde la cabeza hasta el deploy', async () => {
  const head = DEPLOYMENT_BLOCK + 25_000;
  const world = createWorld({ head, logs: [] });

  await world.service.reconcileForIssuer(ISSUER_ID, CREDENTIAL_ID, OPERATOR);

  assert.ok(world.logFilters.length >= 3);
  assert.equal(world.logFilters[0].toBlock, head);
  assert.equal(world.logFilters[world.logFilters.length - 1].fromBlock, DEPLOYMENT_BLOCK);
  for (const filter of world.logFilters) {
    assert.equal(typeof filter.toBlock, 'number');
    assert.ok((filter.toBlock as number) - filter.fromBlock + 1 <= 10_000);
  }
});

test('la edad del pendiente ESTRECHA la busqueda y el manifest sigue siendo el piso', async () => {
  const head = DEPLOYMENT_BLOCK + 5_000_000;
  const issuedAt = new Date(Date.now() - 600 * 1000); // pendiente hace 10 minutos
  const world = createWorld({ head, logs: [], issuedAt });

  await world.service.reconcileForIssuer(ISSUER_ID, CREDENTIAL_ID, OPERATOR);

  // 600 s + holgura de 3600 bloques << 5M: una o dos ventanas, no 500.
  assert.ok(world.logFilters.length <= 2, String(world.logFilters.length));
  const lowest = Math.min(...world.logFilters.map((filter) => filter.fromBlock));
  assert.ok(lowest > DEPLOYMENT_BLOCK);
  assert.ok(lowest >= head - 600 - 3_600 - 5);

  // Un pendiente mas viejo que la cadena nunca baja del bloque de deploy.
  const ancient = createWorld({
    head: DEPLOYMENT_BLOCK + 30_000,
    logs: [],
    issuedAt: new Date(0)
  });
  await ancient.service.reconcileForIssuer(ISSUER_ID, CREDENTIAL_ID, OPERATOR);
  assert.equal(
    Math.min(...ancient.logFilters.map((filter) => filter.fromBlock)),
    DEPLOYMENT_BLOCK
  );
});

test('con un lector sin getBlockNumber se mantiene UNA sola consulta (comportamiento previo)', async () => {
  const world = createWorld({ logs: [registeredLog()], withBlockNumber: false });

  await world.service.reconcileForIssuer(ISSUER_ID, CREDENTIAL_ID, OPERATOR);

  assert.equal(world.logFilters.length, 1);
  assert.equal(world.logFilters[0].fromBlock, DEPLOYMENT_BLOCK);
  assert.equal(world.logFilters[0].toBlock, 'latest');
});

// ---------------------------------------------------------------------------
// ESTRUCTURA: este camino no puede escribir en la cadena
// ---------------------------------------------------------------------------

test('estructural: el servicio y el controlador no importan ningun camino de escritura ni de firma', () => {
  for (const file of [
    'issuer-credential-blockchain-reconciliation.service.ts',
    'issuer-credential-blockchain-reconciliation.controller.ts'
  ]) {
    const source = readFileSync(join(__dirname, file), 'utf8');

    for (const forbidden of [
      'anchor-write-coordinator',
      'AnchorWriteCoordinator',
      'credential-registry-write-client',
      'CredentialRegistryWriteClient',
      'IssuerSignerResolver',
      'issuer-signer-resolver',
      'registerCredential(',
      'revokeCredential(',
      'sendTransaction',
      'signMessage',
      'executeRegistration',
      'createPendingIntent'
    ]) {
      assert.equal(source.includes(forbidden), false, `${file} no debe contener ${forbidden}`);
    }
  }
});

test('estructural: el endpoint no acepta contrato, red, bloque ni rango del llamador', () => {
  const source = readFileSync(
    join(__dirname, 'issuer-credential-blockchain-reconciliation.controller.ts'),
    'utf8'
  );

  assert.equal(source.includes('@Body'), false);
  assert.equal(source.includes('@Query'), false);
});
