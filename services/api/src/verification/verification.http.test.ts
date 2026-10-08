/**
 * Superficie HTTP de la verificacion publica -- S8c7, matriz 65-72.
 *
 * Levanta un servidor Nest REAL en 127.0.0.1 con puerto efimero y hace requests
 * de verdad. Es la unica forma de probar que la ruta es PUBLICA: el modulo de
 * prueba no registra AuthModule, ni AuthGuard, ni JwtModule, asi que si el
 * controller exigiera una sesion no podria responder 200.
 *
 * El doble de Prisma no expone NINGUNA operacion de escritura -- ni siquiera
 * definida -- y el cliente de cadena es un doble. No hay AWS, ni SSM, ni RPC,
 * ni base de datos real, ni blockchain.
 *
 * Lo que se congela aca y en ningun otro lado:
 *
 *   * la incertidumbre de infraestructura responde 200 con dimensiones
 *     explicitas, NO 500: un DID caido o un RPC caido no pueden volverse
 *     indistinguibles de "la credencial no existe";
 *   * `Cache-Control: no-store`, porque la respuesta lleva estado de seguridad
 *     sensible al tiempo.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { BlockchainNetwork, BlockchainRecordStatus } from '@prisma/client';

import { CredentialRegistryDeploymentResolver } from '../blockchain/credential-registry-deployment';
import { CredentialHashingService } from '../credentials/credential-hashing.service';
import { IssuerDidDocumentResolver } from '../identity/issuer-did-document.resolver';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLIC_TEST_KEY_ONE } from '../signing/__fixtures__/signer-test-keys';
import {
  VECTOR_CANONICAL_HASH,
  VECTOR_ISSUER_DID,
  VECTOR_SUBJECT_DID,
  vectorCredentialState,
  vectorDidDocument,
  vectorProof
} from './__fixtures__/verified-credential.fixture';
import { CredentialAuthenticityVerifier } from './credential-authenticity.verifier';
import { CredentialBlockchainEvidenceReader } from './credential-blockchain-evidence.reader';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

const CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const MOCK_CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000001';
const ANCHOR_ADDRESS = PUBLIC_TEST_KEY_ONE.address;
const RPC_URL = 'https://provider.example/v2/SECRET_API_KEY';

const CREDENTIAL_VERIFIED = vectorCredentialState().credentialId as string;
const CREDENTIAL_DID_DOWN = '11111111-1111-4111-8111-111111111111';
const CREDENTIAL_RPC_DOWN = '22222222-2222-4222-8222-222222222222';
const CREDENTIAL_PENDING = '33333333-3333-4333-8333-333333333333';
const CREDENTIAL_MOCK = '44444444-4444-4444-8444-444444444444';
const CREDENTIAL_DRAFT = '55555555-5555-4555-8555-555555555555';
const CREDENTIAL_MISSING = '66666666-6666-4666-8666-666666666666';

const BASE_SEPOLIA_ENV = {
  BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry',
  CREDENTIAL_REGISTRY_NETWORK: 'base_sepolia',
  CREDENTIAL_REGISTRY_CHAIN_ID: '84532',
  CREDENTIAL_REGISTRY_RPC_URL: RPC_URL,
  CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: CONTRACT_ADDRESS,
  CREDENTIAL_REGISTRY_DEPLOYMENT_ID: 'test-base-sepolia-pending-deploy'
};

/** Llamadas al cliente de cadena, para probar "cero RPC" donde corresponde. */
const chainReads: string[] = [];

function record(overrides: Record<string, unknown> = {}) {
  return {
    network: BlockchainNetwork.base_sepolia,
    chainId: 84532,
    contractAddress: CONTRACT_ADDRESS,
    credentialHash: VECTOR_CANONICAL_HASH,
    txHash: `0x${'b'.repeat(64)}`,
    status: BlockchainRecordStatus.registered,
    registeredAt: new Date('2026-03-31T23:33:20.000Z'),
    issuerAddress: ANCHOR_ADDRESS,
    anchorSignerProfileId: 'anchor-profile-1',
    anchorSignerProfile: { address: ANCHOR_ADDRESS },
    ...overrides
  };
}

/**
 * Fila de credencial para una ruta dada.
 *
 * El `id` persistido es SIEMPRE el del vector golden, porque `canon_v2`
 * incluye `credential_id`: cambiarlo haria que el hash recalculado dejara de
 * reproducir el persistido y todas estas filas saldrian INVALID por la razon
 * equivocada. El identificador de la ruta solo sirve como clave de busqueda del
 * doble.
 */
function credentialRow(_routeId: string, overrides: Record<string, unknown> = {}) {
  const canonical = vectorCredentialState();

  return {
    id: canonical.credentialId,
    status: 'issued',
    schemaVersion: 'credential_v2',
    type: canonical.type,
    title: canonical.title,
    description: canonical.description,
    hours: canonical.hours,
    credentialSubject: canonical.credentialSubject,
    issuedAt: canonical.issuedAt,
    revokedAt: null,
    revocationReason: null,
    canonicalHash: VECTOR_CANONICAL_HASH,
    canonicalizationVersion: 'canon_v2',
    proof: vectorProof(),
    issuerId: canonical.issuerId,
    issuer: {
      name: 'Institución Demo',
      did: 'did:example:issuer',
      technicalIdentity: { did: VECTOR_ISSUER_DID }
    },
    subjectUser: {
      displayName: 'Titular Demo',
      firstName: 'Titular',
      lastName: 'Demo',
      did: VECTOR_SUBJECT_DID
    },
    _count: { blockchainRecords: 1 },
    blockchainRecords: [record()],
    ...overrides
  };
}

const ROWS: Record<string, Record<string, unknown>> = {
  [CREDENTIAL_VERIFIED]: credentialRow(CREDENTIAL_VERIFIED),
  [CREDENTIAL_DID_DOWN]: credentialRow(CREDENTIAL_DID_DOWN),
  [CREDENTIAL_RPC_DOWN]: credentialRow(CREDENTIAL_RPC_DOWN),
  [CREDENTIAL_PENDING]: credentialRow(CREDENTIAL_PENDING, {
    blockchainRecords: [
      record({
        status: BlockchainRecordStatus.pending,
        txHash: null,
        registeredAt: null,
        issuerAddress: null
      })
    ]
  }),
  [CREDENTIAL_MOCK]: credentialRow(CREDENTIAL_MOCK, {
    blockchainRecords: [
      record({
        network: BlockchainNetwork.anvil,
        chainId: 31337,
        contractAddress: MOCK_CONTRACT_ADDRESS,
        anchorSignerProfileId: null,
        anchorSignerProfile: null
      })
    ]
  }),
  [CREDENTIAL_DRAFT]: credentialRow(CREDENTIAL_DRAFT, { status: 'draft' })
};

/**
 * Doble de Prisma SIN metodos de escritura: `create`, `update`, `updateMany`,
 * `delete` y `upsert` no existen. Si la verificacion intentara mutar algo, la
 * llamada seria un TypeError y el request fallaria.
 */
const prismaDouble = {
  credential: {
    async findUnique(args: { where: { id: string } }) {
      return ROWS[args.where.id] ?? null;
    }
  }
};

/** El DID resuelve salvo para la credencial que prueba la caida. */
const didResolverDouble = {
  async resolveForIssuer() {
    return { kind: 'resolved', document: vectorDidDocument() };
  }
};

@Global()
@Module({
  providers: [{ provide: PrismaService, useValue: prismaDouble }],
  exports: [PrismaService]
})
class TestPrismaModule {}

/**
 * Modulo de prueba que replica el wiring de produccion con los bordes doblados.
 *
 * DELIBERADAMENTE sin AuthModule, sin AuthGuard, sin JwtModule, sin
 * SigningModule y sin BlockchainModule: si el verificador necesitara una
 * sesion, un secreto o el coordinador de escrituras, este modulo no podria
 * servir un 200.
 */
@Module({
  imports: [TestPrismaModule],
  controllers: [VerificationController],
  providers: [
    VerificationService,
    CredentialHashingService,
    {
      provide: IssuerDidDocumentResolver,
      useValue: didResolverDouble
    },
    {
      provide: CredentialAuthenticityVerifier,
      useFactory: (hashing: CredentialHashingService) =>
        new CredentialAuthenticityVerifier(
          hashing,
          {
            async resolveForIssuer(issuerId: string) {
              // La credencial que prueba el DID caido comparte issuerId con las
              // demas, asi que el interruptor es un flag de modulo.
              return didDown
                ? { kind: 'not_resolvable' }
                : { kind: 'resolved', document: vectorDidDocument() };
            }
          } as never
        ),
      inject: [CredentialHashingService]
    },
    {
      provide: CredentialBlockchainEvidenceReader,
      useFactory: () =>
        new CredentialBlockchainEvidenceReader(
          new (class extends CredentialRegistryDeploymentResolver {
            override resolve(input: never) {
              return super.resolve(input, BASE_SEPOLIA_ENV);
            }
          })(),
          {
            async readTargetBoundCredentialState(input: {
              credentialHash: string;
            }) {
              chainReads.push(input.credentialHash);

              if (rpcDown) {
                return { kind: 'rpc_unavailable' };
              }

              if (chainMissing) {
                return { kind: 'credential_missing' };
              }

              return {
                kind: 'credential_state',
                status: { exists: true, revoked: false, issuer: ANCHOR_ADDRESS }
              };
            }
          } as never
        )
    }
  ]
})
class TestAppModule {}

let didDown = false;
let rpcDown = false;
let chainMissing = false;
let baseUrl = '';
let application: Awaited<ReturnType<typeof NestFactory.create>> | null = null;

before(async () => {
  application = await NestFactory.create(TestAppModule, {
    abortOnError: false,
    logger: false
  });
  await application.listen(0, '127.0.0.1');
  baseUrl = (await application.getUrl()).replace('[::1]', '127.0.0.1');
});

after(async () => {
  await application?.close();
});

function verifyUrl(credentialId: string): string {
  return `${baseUrl}/verify/credentials/${credentialId}`;
}

// ---------------------------------------------------------------------------
// 65, 69: PUBLICA Y COMPLETA
// ---------------------------------------------------------------------------

test('65, 69: la ruta es publica y devuelve las cuatro dimensiones explicitas', async () => {
  didDown = false;
  rpcDown = false;
  chainMissing = false;

  const response = await fetch(verifyUrl(CREDENTIAL_VERIFIED));

  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.verification.headline, 'VERIFIED');
  assert.equal(body.verification.authenticity.result, 'VERIFIED');
  assert.equal(body.verification.credentialStatus, 'ACTIVE');
  assert.equal(body.verification.blockchainEvidence.result, 'REGISTERED');
  assert.equal(body.verification.result, 'valid_issued');
});

test('69b: un Bearer basura no cambia nada -- no hay autorizacion que mirar', async () => {
  didDown = false;
  rpcDown = false;
  chainMissing = false;

  const withGarbage = await fetch(verifyUrl(CREDENTIAL_VERIFIED), {
    headers: { Authorization: 'Bearer no-es-un-token-valido' }
  });
  assert.equal(withGarbage.status, 200);

  const withoutHeaders = await fetch(verifyUrl(CREDENTIAL_VERIFIED));
  assert.equal(withoutHeaders.status, 200);

  const [a, b] = await Promise.all([withGarbage.json(), withoutHeaders.json()]);
  // `checkedAt` es un reloj, asi que se compara todo lo demas.
  delete a.verification.checkedAt;
  delete b.verification.checkedAt;
  assert.deepEqual(a, b, 'la respuesta no depende de la identidad del solicitante');
});

// ---------------------------------------------------------------------------
// 66-67: LA INCERTIDUMBRE NO ES UN 500
// ---------------------------------------------------------------------------

test('66: un DID indisponible devuelve 200 con INDETERMINATE, nunca 500', async () => {
  didDown = true;
  rpcDown = false;
  chainMissing = false;

  const response = await fetch(verifyUrl(CREDENTIAL_DID_DOWN));

  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.verification.authenticity.result, 'INDETERMINATE');
  assert.equal(body.verification.authenticity.reason, 'ISSUER_DID_NOT_RESOLVABLE');
  assert.equal(body.verification.headline, 'INDETERMINATE');

  didDown = false;
});

test('67: un RPC indisponible devuelve 200 con UNAVAILABLE, nunca 500', async () => {
  didDown = false;
  rpcDown = true;
  chainMissing = false;

  const response = await fetch(verifyUrl(CREDENTIAL_RPC_DOWN));

  assert.equal(response.status, 200);

  const body = await response.json();
  // La autenticidad NO se ve afectada por la red.
  assert.equal(body.verification.authenticity.result, 'VERIFIED');
  assert.equal(body.verification.blockchainEvidence.result, 'UNAVAILABLE');
  assert.equal(body.verification.headline, 'VERIFIED_WITH_LIMITED_EVIDENCE');

  rpcDown = false;
});

// ---------------------------------------------------------------------------
// 68: NO ENCONTRADO
// ---------------------------------------------------------------------------

test('68: una credencial inexistente o borrador devuelve 404, no 200', async () => {
  didDown = false;
  rpcDown = false;
  chainMissing = false;

  for (const credentialId of [CREDENTIAL_MISSING, CREDENTIAL_DRAFT]) {
    const response = await fetch(verifyUrl(credentialId));
    assert.equal(response.status, 404, credentialId);
  }
});

test('la incertidumbre de infraestructura NO es indistinguible de un 404', async () => {
  didDown = true;
  rpcDown = true;
  chainMissing = false;

  const uncertain = await fetch(verifyUrl(CREDENTIAL_DID_DOWN));
  const missing = await fetch(verifyUrl(CREDENTIAL_MISSING));

  assert.equal(uncertain.status, 200);
  assert.equal(missing.status, 404);
  assert.notEqual(uncertain.status, missing.status);

  didDown = false;
  rpcDown = false;
});

// ---------------------------------------------------------------------------
// 71-72: PENDIENTE Y MOCK
// ---------------------------------------------------------------------------

test('71: un record PENDIENTE serializa sus campos nulos sobre HTTP', async () => {
  didDown = false;
  rpcDown = false;
  chainMissing = true;

  const response = await fetch(verifyUrl(CREDENTIAL_PENDING));
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.integrity.latestBlockchainRecord.txHash, null);
  assert.equal(body.integrity.latestBlockchainRecord.txHashShort, null);
  assert.equal(body.integrity.latestBlockchainRecord.registeredAt, null);
  assert.equal(body.verification.blockchainEvidence.result, 'PENDING');
  assert.equal(body.verification.headline, 'VERIFIED_WITH_LIMITED_EVIDENCE');

  chainMissing = false;
});

test('72: un record mock responde sin construir ningun provider', async () => {
  didDown = false;
  rpcDown = false;
  chainMissing = false;
  chainReads.length = 0;

  const response = await fetch(verifyUrl(CREDENTIAL_MOCK));
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(
    body.verification.blockchainEvidence.result,
    'NOT_APPLICABLE_MOCK'
  );
  assert.equal(body.verification.headline, 'VERIFIED_WITH_LIMITED_EVIDENCE');
  assert.deepEqual(chainReads, [], 'cero lecturas de cadena');
});

// ---------------------------------------------------------------------------
// ADDENDUM D: CACHE
// ---------------------------------------------------------------------------

test('addendum D: la verificacion publica responde Cache-Control: no-store', async () => {
  didDown = false;
  rpcDown = false;
  chainMissing = false;

  // La respuesta lleva estado de seguridad sensible al tiempo: autorizacion de
  // claves en el DID, revocacion y evidencia de cadena. Un CDN intermedio no
  // debe poder servir una verificacion favorable despues de que la clave dejo
  // de estar autorizada.
  const ok = await fetch(verifyUrl(CREDENTIAL_VERIFIED));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'no-store');

  // Tambien en la respuesta negativa, para que no quede cacheada tapando una
  // credencial que despues si exista.
  const notFound = await fetch(verifyUrl(CREDENTIAL_MISSING));
  assert.equal(notFound.status, 404);
  assert.equal(notFound.headers.get('cache-control'), 'no-store');
});

// ---------------------------------------------------------------------------
// 70: SIN FILTRACIONES
// ---------------------------------------------------------------------------

test('70: ninguna respuesta filtra el endpoint RPC, su clave ni secretos', async () => {
  didDown = false;
  chainMissing = false;

  for (const rpcState of [false, true]) {
    rpcDown = rpcState;

    const body = await (await fetch(verifyUrl(CREDENTIAL_VERIFIED))).text();

    for (const forbidden of [
      RPC_URL,
      'SECRET_API_KEY',
      'provider.example',
      'rpcUrl',
      'secretRef',
      'privateKey',
      PUBLIC_TEST_KEY_ONE.privateKey,
      'anchor-profile-1'
    ]) {
      assert.ok(!body.includes(forbidden), `${forbidden} (rpcDown=${rpcState})`);
    }
  }

  rpcDown = false;
});

test('la respuesta no expone el DID propio por una llamada HTTP a si misma', async () => {
  // No hay forma de que el verificador haya hecho un GET a su propio
  // /did/issuers/...: este servidor de prueba NO monta IdentityModule, asi que
  // esa ruta no existe y aun asi la verificacion responde VERIFIED.
  didDown = false;
  rpcDown = false;
  chainMissing = false;

  const didRoute = await fetch(
    `${baseUrl}/did/issuers/${vectorCredentialState().issuerId}/did.json`
  );
  assert.equal(didRoute.status, 404, 'la ruta de DID no esta montada');

  const verification = await fetch(verifyUrl(CREDENTIAL_VERIFIED));
  assert.equal(verification.status, 200);
  assert.equal((await verification.json()).verification.headline, 'VERIFIED');
});
