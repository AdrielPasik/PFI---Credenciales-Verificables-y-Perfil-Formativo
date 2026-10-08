/**
 * RESOLUCION DEL SIGNER HISTORICO -- S8c8, items 32-34, 56-58, D1-D2.
 *
 * Todo con dobles: no hay AWS, no hay SSM real, no hay provider, no hay RPC y
 * no hay base de datos. Las claves son los escalares publicos 1 y 2.
 *
 * Lo que se congela:
 *
 *   profileId EXACTO del BlockchainRecord
 *     -> SignerProfile, sin pasar por ninguna identidad tecnica
 *     -> active o retired OK, compromised PROHIBIDO antes del secreto
 *     -> secretRef -> almacen -> Wallet desconectada
 *     -> direccion derivada == direccion persistida
 *
 * y que la cache NUNCA puede saltearse la lectura fresca del estado publico.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { SignerProfilePurpose, SignerProfileStatus } from '@prisma/client';

import {
  PUBLIC_TEST_KEY_ONE,
  PUBLIC_TEST_KEY_TWO
} from './__fixtures__/signer-test-keys';
import { IssuerSignerResolver } from './issuer-signer-resolver';
import { SignerResolutionError } from './signer-resolution.error';

const ANCHOR_SECRET_REF = '/scope/test/signers/anchor-historical';
const PROFILE_ID = 'anchor-profile-historical';

interface ProfileFixture {
  id: string;
  purpose: SignerProfilePurpose;
  secretRef: string;
  address: string;
  publicKeyX: string | null;
  publicKeyY: string | null;
  publicKeyCompressed: string | null;
  keyVersion: number;
  addressVerifiedAt: Date | null;
  status: SignerProfileStatus;
}

function anchorProfile(
  overrides: Partial<ProfileFixture> = {}
): ProfileFixture {
  return {
    id: PROFILE_ID,
    purpose: SignerProfilePurpose.anchor,
    secretRef: ANCHOR_SECRET_REF,
    address: PUBLIC_TEST_KEY_ONE.addressLowercase,
    // Un anchor no necesita metadata de asercion.
    publicKeyX: null,
    publicKeyY: null,
    publicKeyCompressed: null,
    keyVersion: 1,
    addressVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    status: SignerProfileStatus.active,
    ...overrides
  };
}

function createResolver(options: { profile?: ProfileFixture | null } = {}) {
  const state = {
    profile: options.profile === undefined ? anchorProfile() : options.profile
  };

  const calls = {
    profileReads: [] as string[],
    identityReads: [] as unknown[],
    secretReads: [] as string[]
  };

  const prisma = {
    signerProfile: {
      async findUnique(args: { where: { id: string } }) {
        calls.profileReads.push(args.where.id);
        return state.profile && state.profile.id === args.where.id
          ? state.profile
          : null;
      }
    },
    issuerTechnicalIdentity: {
      async findUnique(args: unknown) {
        // Si la resolucion historica pasara por aca, el test falla: la
        // procedencia es el record, no la configuracion vigente del issuer.
        calls.identityReads.push(args);
        throw new Error(
          'la resolucion historica no debe consultar IssuerTechnicalIdentity'
        );
      }
    }
  };

  const secretStore = {
    async getPrivateKey(secretRef: string) {
      calls.secretReads.push(secretRef);
      return PUBLIC_TEST_KEY_ONE.privateKey;
    }
  };

  return {
    resolver: new IssuerSignerResolver(
      prisma as never,
      secretStore as never
    ),
    state,
    calls
  };
}

function expectResolutionCode(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof SignerResolutionError, String(error));
    assert.equal((error as SignerResolutionError).code, code);
    return true;
  };
}

// ---------------------------------------------------------------------------
// 56-57: ACTIVE Y RETIRED
// ---------------------------------------------------------------------------

test('56: un anchor historico ACTIVO resuelve', async () => {
  const { resolver, calls } = createResolver();

  const signer = await resolver.resolveHistoricalAnchorSigner(PROFILE_ID);

  assert.equal(signer.profileId, PROFILE_ID);
  assert.equal(signer.purpose, SignerProfilePurpose.anchor);
  assert.equal(signer.address, PUBLIC_TEST_KEY_ONE.address);
  // Wallet DESCONECTADA.
  assert.equal(signer.wallet.provider, null);

  // Se leyo el perfil por id EXACTO y nunca la identidad tecnica.
  assert.deepEqual(calls.profileReads, [PROFILE_ID]);
  assert.deepEqual(calls.identityReads, []);
  assert.deepEqual(calls.secretReads, [ANCHOR_SECRET_REF]);
});

test('57: un anchor historico RETIRADO tambien resuelve', async () => {
  // Es exactamente la razon por la que `retired` y `compromised` no son el
  // mismo estado: un anchor puede estar retirado porque ningun issuer lo elige
  // para registrar, y seguir siendo la unica cuenta que puede revocar lo que
  // registro.
  const { resolver, calls } = createResolver({
    profile: anchorProfile({ status: SignerProfileStatus.retired })
  });

  const signer = await resolver.resolveHistoricalAnchorSigner(PROFILE_ID);

  assert.equal(signer.address, PUBLIC_TEST_KEY_ONE.address);
  assert.deepEqual(calls.secretReads, [ANCHOR_SECRET_REF]);
});

// ---------------------------------------------------------------------------
// 58: COMPROMETIDO -> FALLA ANTES DEL SECRETO
// ---------------------------------------------------------------------------

test('58: un anchor COMPROMETIDO falla ANTES de leer el almacen de secretos', async () => {
  const { resolver, calls } = createResolver({
    profile: anchorProfile({ status: SignerProfileStatus.compromised })
  });

  await assert.rejects(
    resolver.resolveHistoricalAnchorSigner(PROFILE_ID),
    expectResolutionCode('SIGNER_PROFILE_COMPROMISED')
  );

  // CERO lecturas del secreto: no se trae una clave que no se va a poder usar.
  assert.deepEqual(calls.secretReads, []);
});

// ---------------------------------------------------------------------------
// 32-34: PRECONDICIONES
// ---------------------------------------------------------------------------

test('32-33: un perfil ausente o de otro proposito falla cerrado', async () => {
  const missing = createResolver({ profile: null });
  await assert.rejects(
    missing.resolver.resolveHistoricalAnchorSigner(PROFILE_ID),
    expectResolutionCode('SIGNER_PROFILE_NOT_CONFIGURED')
  );
  assert.deepEqual(missing.calls.secretReads, []);

  // Una clave de ASERCION jamas firma una transaccion.
  const wrongPurpose = createResolver({
    profile: anchorProfile({ purpose: SignerProfilePurpose.assertion })
  });
  await assert.rejects(
    wrongPurpose.resolver.resolveHistoricalAnchorSigner(PROFILE_ID),
    expectResolutionCode('SIGNER_PURPOSE_MISMATCH')
  );
  assert.deepEqual(wrongPurpose.calls.secretReads, []);
});

test('la direccion sin verificar o mal formada falla antes del secreto', async () => {
  const unverified = createResolver({
    profile: anchorProfile({ addressVerifiedAt: null })
  });
  await assert.rejects(
    unverified.resolver.resolveHistoricalAnchorSigner(PROFILE_ID),
    expectResolutionCode('SIGNER_ADDRESS_NOT_VERIFIED')
  );
  assert.deepEqual(unverified.calls.secretReads, []);

  const malformed = createResolver({
    profile: anchorProfile({ address: 'no-es-una-direccion' })
  });
  await assert.rejects(
    malformed.resolver.resolveHistoricalAnchorSigner(PROFILE_ID),
    expectResolutionCode('SIGNER_ADDRESS_MISMATCH')
  );
  assert.deepEqual(malformed.calls.secretReads, []);
});

test('34: si la clave no deriva la direccion persistida, falla cerrado', async () => {
  // La direccion persistida es la del escalar 2, pero el almacen devuelve la
  // clave del escalar 1.
  const { resolver, calls } = createResolver({
    profile: anchorProfile({ address: PUBLIC_TEST_KEY_TWO.addressLowercase })
  });

  await assert.rejects(
    resolver.resolveHistoricalAnchorSigner(PROFILE_ID),
    expectResolutionCode('SIGNER_ADDRESS_MISMATCH')
  );

  // Aqui SI se leyo el secreto -- la discrepancia solo se puede ver derivando
  // -- pero el resultado es un error tipado y ninguna Wallet sale del resolver.
  assert.deepEqual(calls.secretReads, [ANCHOR_SECRET_REF]);
});

// ---------------------------------------------------------------------------
// D1-D2: LA CACHE NO PUEDE SALTEARSE EL ESTADO PUBLICO
// ---------------------------------------------------------------------------

test('D1: un perfil cacheado que pasa a COMPROMETIDO deja de resolver', async () => {
  const { resolver, state, calls } = createResolver();

  // Primera resolucion: entra en cache.
  await resolver.resolveHistoricalAnchorSigner(PROFILE_ID);
  assert.equal(calls.secretReads.length, 1);

  // El perfil se marca comprometido fuera de banda.
  state.profile = anchorProfile({ status: SignerProfileStatus.compromised });

  await assert.rejects(
    resolver.resolveHistoricalAnchorSigner(PROFILE_ID),
    expectResolutionCode('SIGNER_PROFILE_COMPROMISED')
  );

  // La cache NO enmascaro el cambio -- el estado se lee fresco SIEMPRE -- y no
  // hubo una segunda lectura del secreto.
  assert.equal(calls.profileReads.length, 2);
  assert.equal(calls.secretReads.length, 1);
});

test('D2: un perfil cacheado que pasa a RETIRADO sigue resolviendo', async () => {
  const { resolver, state, calls } = createResolver();

  await resolver.resolveHistoricalAnchorSigner(PROFILE_ID);

  state.profile = anchorProfile({ status: SignerProfileStatus.retired });

  const signer = await resolver.resolveHistoricalAnchorSigner(PROFILE_ID);

  assert.equal(signer.address, PUBLIC_TEST_KEY_ONE.address);
  // Un cache hit evita la segunda lectura del secreto, no la del estado.
  assert.equal(calls.profileReads.length, 2);
  assert.equal(calls.secretReads.length, 1);
});

test('la cache se descarta si el perfil apunta a OTRO secreto', async () => {
  const { resolver, state, calls } = createResolver();

  await resolver.resolveHistoricalAnchorSigner(PROFILE_ID);

  // Cambio de `secretRef`: la entrada ya no describe la configuracion vigente.
  state.profile = anchorProfile({ secretRef: '/scope/test/signers/otro' });

  await resolver.resolveHistoricalAnchorSigner(PROFILE_ID);

  assert.deepEqual(calls.secretReads, [
    ANCHOR_SECRET_REF,
    '/scope/test/signers/otro'
  ]);
});

// ---------------------------------------------------------------------------
// NI ESTADO DESCONOCIDO NI FUGAS
// ---------------------------------------------------------------------------

test('un estado futuro desconocido no se asume utilizable', async () => {
  const { resolver, calls } = createResolver({
    profile: anchorProfile({
      status: 'suspendido' as SignerProfileStatus
    })
  });

  await assert.rejects(
    resolver.resolveHistoricalAnchorSigner(PROFILE_ID),
    expectResolutionCode('SIGNER_PROFILE_INACTIVE')
  );
  assert.deepEqual(calls.secretReads, []);
});

test('el signer historico resuelto no expone secretRef ni clave privada', async () => {
  const { resolver } = createResolver();

  const signer = await resolver.resolveHistoricalAnchorSigner(PROFILE_ID);
  const keys = Object.keys(signer).sort();

  assert.deepEqual(keys, [
    'address',
    'keyVersion',
    'profileId',
    'purpose',
    'wallet'
  ]);
  assert.ok(!keys.includes('secretRef'));
  assert.ok(!keys.includes('privateKey'));
});

test('ningun error de resolucion historica interpola el secretRef', async () => {
  for (const profile of [
    null,
    anchorProfile({ purpose: SignerProfilePurpose.assertion }),
    anchorProfile({ status: SignerProfileStatus.compromised }),
    anchorProfile({ addressVerifiedAt: null })
  ]) {
    const { resolver } = createResolver({ profile });

    const error = await resolver
      .resolveHistoricalAnchorSigner(PROFILE_ID)
      .then(() => null)
      .catch((caught: unknown) => caught);

    assert.ok(error instanceof SignerResolutionError);
    assert.ok(!error.message.includes(ANCHOR_SECRET_REF));
    assert.ok(!error.message.includes(PUBLIC_TEST_KEY_ONE.privateKey));
    assert.ok(!error.message.includes(PROFILE_ID));
  }
});
