import assert from 'node:assert/strict';
import test from 'node:test';

import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import {
  CredentialType,
  IssuerAuthorizationStatus,
  IssuerMembershipRole,
  IssuerMembershipStatus
} from '@prisma/client';

import { AuthGuard } from '../auth/auth.guard';
import { BlockchainTargetError } from '../blockchain/blockchain-target';
import { type PrismaService } from '../prisma/prisma.service';
import { IssuerTechnicalIdentityController } from './issuer-technical-identity.controller';
import {
  IssuerTechnicalIdentityService,
  type NetworkHealthProvider
} from './issuer-technical-identity.service';
import { IssuersService } from './issuers.service';

/** Decision B y endpoints de S8c9. Sin red real: providers dobles. */

const ISSUER_ID = '11111111-1111-4111-8111-111111111111';
const CONTRACT = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const ANCHOR = '0x2b5ad5c4795c026514f8317c7a215e218dccd6cf';
const ANVIL_ENV = {
  BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry',
  CREDENTIAL_REGISTRY_NETWORK: 'anvil',
  CREDENTIAL_REGISTRY_CHAIN_ID: '31337',
  CREDENTIAL_REGISTRY_RPC_URL: 'http://127.0.0.1:8545',
  CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: CONTRACT,
  CREDENTIAL_REGISTRY_DEPLOYMENT_ID: 'test-anvil-local'
};

function membershipPrisma(membership: { role: IssuerMembershipRole; status: IssuerMembershipStatus } | null) {
  const log: string[] = [];
  const prisma = {
    issuerMembership: {
      findUnique: async () => {
        log.push('membership');
        return membership;
      }
    },
    issuer: {
      findUnique: async () => {
        log.push('issuer');
        return {
          id: ISSUER_ID,
          name: 'UADE',
          authorizationStatus: IssuerAuthorizationStatus.pending,
          allowedCredentialTypes: [CredentialType.course],
          technicalIdentity: null,
          assertionKeyBindings: []
        };
      }
    },
    issuerTechnicalIdentity: {
      findUnique: async () => {
        log.push('identity');
        return { anchorSignerProfile: { address: ANCHOR } };
      },
      count: async () => 0
    }
  };
  return { prisma: prisma as unknown as PrismaService, log };
}

function build(
  membership: Parameters<typeof membershipPrisma>[0],
  deps: ConstructorParameters<typeof IssuerTechnicalIdentityService>[2] = {}
) {
  const { prisma, log } = membershipPrisma(membership);
  const issuers = new IssuersService(prisma);
  return { svc: new IssuerTechnicalIdentityService(prisma, issuers, deps), log, issuers };
}

const ADMIN = { role: IssuerMembershipRole.admin, status: IssuerMembershipStatus.active };

test('B1 admin activo de issuer NO autorizado puede leer (ve por que no esta listo)', async () => {
  const { svc } = build(ADMIN, { environment: {} });
  const dto = await svc.read(ISSUER_ID, 'user-1');
  assert.equal(dto.administrativelyAuthorized, false);
  assert.equal(dto.readyToIssue, false);
  assert.ok(dto.readinessReasons.includes('ISSUER_NOT_AUTHORIZED'));
});

test('B2 operator, viewer, admin pendiente/revocado, sin membresia: 403 antes de leer', async () => {
  for (const m of [
    { role: IssuerMembershipRole.operator, status: IssuerMembershipStatus.active },
    { role: IssuerMembershipRole.viewer, status: IssuerMembershipStatus.active },
    { role: IssuerMembershipRole.admin, status: IssuerMembershipStatus.pending },
    { role: IssuerMembershipRole.admin, status: IssuerMembershipStatus.revoked },
    null
  ]) {
    const { svc, log } = build(m);
    await assert.rejects(svc.read(ISSUER_ID, 'u'), ForbiddenException);
    await assert.rejects(svc.networkHealth(ISSUER_ID, 'u'), ForbiddenException);
    assert.deepEqual([...new Set(log)], ['membership']);
  }
});

test('B3 health sin permiso: ningun provider construido', async () => {
  let built = 0;
  const { svc } = build(null, {
    environment: ANVIL_ENV,
    createProvider: () => {
      built += 1;
      return {} as NetworkHealthProvider;
    }
  });
  await assert.rejects(svc.networkHealth(ISSUER_ID, 'u'));
  assert.equal(built, 0);
});

test('B4 DTO de lectura: allowlist, sin secretRef, rpcUrl ni ids de perfil', async () => {
  const { svc } = build(ADMIN, { environment: ANVIL_ENV });
  const dto = await svc.read(ISSUER_ID, 'u');
  const text = JSON.stringify(dto);
  for (const forbidden of ['secretRef', 'rpcUrl', '127.0.0.1', 'privateKey', 'PRIVATE_KEY']) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
  assert.equal(dto.blockchainTarget.mode, 'credential_registry');
  assert.equal(dto.blockchainTarget.chainId, 31337);
});

test('E1 health en mock: NOT_APPLICABLE_MOCK, sin provider', async () => {
  let built = 0;
  const { svc } = build(ADMIN, {
    environment: {},
    createProvider: () => {
      built += 1;
      return {} as NetworkHealthProvider;
    }
  });
  const r = await svc.networkHealth(ISSUER_ID, 'u');
  assert.equal(r.status, 'NOT_APPLICABLE_MOCK');
  assert.equal(built, 0);
});

test('E2 target invalido: UNAVAILABLE / TARGET_UNCONFIGURED', async () => {
  const { svc } = build(ADMIN, { environment: { BLOCKCHAIN_EVIDENCE_MODE: 'nope' } });
  const r = await svc.networkHealth(ISSUER_ID, 'u');
  assert.equal(r.status, 'UNAVAILABLE');
  assert.deepEqual(r.reasons, ['TARGET_UNCONFIGURED']);
});

function provider(over: Partial<NetworkHealthProvider> = {}): NetworkHealthProvider {
  return {
    getNetwork: async () => ({ chainId: 31337n }),
    getCode: async () => '0x6080',
    getBlockNumber: async () => 42,
    getBalance: async () => 10n,
    ...over
  } as NetworkHealthProvider;
}

async function health(p: NetworkHealthProvider) {
  let built = 0;
  const { svc } = build(ADMIN, {
    environment: ANVIL_ENV,
    createProvider: () => {
      built += 1;
      return p;
    }
  });
  const r = await svc.networkHealth(ISSUER_ID, 'u');
  assert.equal(built, 1, 'UN solo provider');
  return r;
}

test('E3 HEALTHY con un solo provider', async () => {
  const r = await health(provider());
  assert.equal(r.status, 'HEALTHY');
  assert.equal(r.latestBlockNumber, 42);
  assert.equal(r.anchorBalanceWei, '10');
  assert.equal(JSON.stringify(r).includes('127.0.0.1'), false);
});

test('E4 RPC caido / chain mismatch / sin codigo: UNAVAILABLE', async () => {
  const down = await health(provider({ getNetwork: async () => { throw new Error('ECONNREFUSED'); } }));
  assert.deepEqual([down.status, down.reasons], ['UNAVAILABLE', ['RPC_UNAVAILABLE']]);

  const mismatch = await health(provider({ getNetwork: async () => ({ chainId: 1n }) } as never));
  assert.deepEqual([mismatch.status, mismatch.reasons, mismatch.chainMatched], ['UNAVAILABLE', ['CHAIN_MISMATCH'], false]);

  const noCode = await health(provider({ getCode: async () => '0x' }));
  assert.deepEqual([noCode.status, noCode.reasons, noCode.contractCodePresent], ['UNAVAILABLE', ['CONTRACT_CODE_MISSING'], false]);
});

test('E5 DEGRADED: bloque no disponible, saldo cero, saldo no disponible', async () => {
  const block = await health(provider({ getBlockNumber: async () => { throw new Error('x'); } }));
  assert.deepEqual([block.status, block.reasons], ['DEGRADED', ['LATEST_BLOCK_UNAVAILABLE']]);
  const zero = await health(provider({ getBalance: async () => 0n }));
  assert.deepEqual([zero.status, zero.reasons, zero.anchorFunded], ['DEGRADED', ['ANCHOR_UNFUNDED'], false]);
  const bal = await health(provider({ getBalance: async () => { throw new Error('x'); } }));
  assert.deepEqual([bal.status, bal.reasons], ['DEGRADED', ['ANCHOR_BALANCE_UNAVAILABLE']]);
});

test('E6 los errores del provider no filtran mensajes', async () => {
  const r = await health(provider({ getNetwork: async () => { throw new BlockchainTargetError('BLOCKCHAIN_RPC_UNAVAILABLE'); } }));
  assert.equal(JSON.stringify(r).includes('ECONN'), false);
});

test('E7 controller: ruta, AuthGuard, solo GET y POST network-health', () => {
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, IssuerTechnicalIdentityController),
    'issuers/:issuerId/technical-identity'
  );
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, IssuerTechnicalIdentityController), [AuthGuard]);
  const methods = Object.getOwnPropertyNames(IssuerTechnicalIdentityController.prototype).filter(
    (name) => name !== 'constructor'
  );
  const paths = methods.map((m) =>
    Reflect.getMetadata(PATH_METADATA, (IssuerTechnicalIdentityController.prototype as never)[m])
  );
  assert.deepEqual(paths.sort(), ['/', 'network-health']);
});
