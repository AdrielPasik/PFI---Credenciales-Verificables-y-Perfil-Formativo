/**
 * Superficie HTTP publica del DID del issuer -- S8c3.
 *
 * Levanta un servidor Nest REAL en 127.0.0.1 con un puerto efimero y hace
 * requests HTTP de verdad. Es la unica forma de probar de verdad que el
 * endpoint es PUBLICO: el modulo de prueba no registra ningun guard, ningun
 * AuthModule y ningun JWT, asi que si el controller exigiera una sesion el
 * request no podria responder 200.
 *
 * El doble de Prisma no expone ninguna operacion de escritura. No hay AWS, no
 * hay SSM, no hay secretos, no hay RPC y no hay base de datos real.
 *
 * Tambien sirve de regresion del plano de holders: la ruta de User DID se monta
 * en el mismo servidor y debe seguir devolviendo exactamente su forma anterior.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SignerProfilePurpose, SignerProfileStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { PUBLIC_TEST_KEY_ONE } from '../signing/__fixtures__/signer-test-keys';
import { IdentityModule } from './identity.module';

const ISSUER_CONFIGURED = '3f2a7c18-5b94-4e61-9d0c-8a6f21b4e5d7';
const ISSUER_COMPROMISED = '55555555-5555-4555-8555-555555555555';
const ISSUER_MISSING = '66666666-6666-4666-8666-666666666666';
const USER_WITH_DID = '11111111-1111-4111-8111-111111111111';

const DID_CONFIGURED = `did:web:api.scopeedu.technology:did:issuers:${ISSUER_CONFIGURED}`;
const DID_COMPROMISED = `did:web:api.scopeedu.technology:did:issuers:${ISSUER_COMPROMISED}`;
const USER_DID = `did:web:api.scopeedu.technology:did:users:${USER_WITH_DID}`;

const FORBIDDEN_WRITE = (name: string) => () => {
  throw new Error(`el resolver publico no debe invocar ${name}`);
};

const prismaDouble = {
  issuerTechnicalIdentity: {
    async findUnique(args: { where: { issuerId: string } }) {
      if (args.where.issuerId === ISSUER_CONFIGURED) {
        return {
          did: DID_CONFIGURED,
          assertionSignerProfile: {
            purpose: SignerProfilePurpose.assertion,
            status: SignerProfileStatus.active,
            keyVersion: 1,
            publicKeyX: PUBLIC_TEST_KEY_ONE.publicKeyX,
            publicKeyY: PUBLIC_TEST_KEY_ONE.publicKeyY,
            publicKeyCompressed: PUBLIC_TEST_KEY_ONE.publicKeyCompressed
          }
        };
      }

      if (args.where.issuerId === ISSUER_COMPROMISED) {
        return {
          did: DID_COMPROMISED,
          assertionSignerProfile: {
            purpose: SignerProfilePurpose.assertion,
            status: SignerProfileStatus.compromised,
            keyVersion: 1,
            publicKeyX: PUBLIC_TEST_KEY_ONE.publicKeyX,
            publicKeyY: PUBLIC_TEST_KEY_ONE.publicKeyY,
            publicKeyCompressed: PUBLIC_TEST_KEY_ONE.publicKeyCompressed
          }
        };
      }

      return null;
    },
    create: FORBIDDEN_WRITE('issuerTechnicalIdentity.create'),
    update: FORBIDDEN_WRITE('issuerTechnicalIdentity.update')
  },
  user: {
    async findUnique(args: { where: { id: string } }) {
      return args.where.id === USER_WITH_DID ? { did: USER_DID } : null;
    },
    create: FORBIDDEN_WRITE('user.create'),
    update: FORBIDDEN_WRITE('user.update')
  }
} as unknown as PrismaService;

@Global()
@Module({
  providers: [{ provide: PrismaService, useValue: prismaDouble }],
  exports: [PrismaService]
})
class TestPrismaModule {}

// NOTA: deliberadamente SIN AuthModule, SIN AuthGuard, SIN JwtModule y sin
// ningun otro guard. Si el controller dependiera de una sesion, de un
// PlatformAdminGuard o de un membership, este modulo no podria servir un 200.
@Module({ imports: [TestPrismaModule, IdentityModule] })
class TestAppModule {}

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

function issuerDidUrl(issuerId: string): string {
  return `${baseUrl}/did/issuers/${issuerId}/did.json`;
}

// ---------------------------------------------------------------------------
// 25-30: ES PUBLICO
// ---------------------------------------------------------------------------

test('25-26: GET sin cabecera Authorization devuelve 200', async () => {
  const response = await fetch(issuerDidUrl(ISSUER_CONFIGURED));

  assert.equal(response.status, 200);

  const document = await response.json();
  assert.equal(document.id, DID_CONFIGURED);
  assert.equal(
    document.verificationMethod[0].publicKeyJwk.x,
    'eb5mfvncu6xVoGKVzocLBwKb_NstzijZWfKBWxb4F5g'
  );
  assert.equal(
    document.verificationMethod[0].publicKeyJwk.y,
    'SDradyajxGVdpPv8DhEIqP0XtEimhVQZnEfQj_sQ1Lg'
  );
});

test('28-30: tampoco hace falta membership, PlatformAdmin ni sesion', async () => {
  // Un Bearer basura no cambia nada: el endpoint no mira la autorizacion.
  const withGarbageToken = await fetch(issuerDidUrl(ISSUER_CONFIGURED), {
    headers: { Authorization: 'Bearer no-es-un-token-valido' }
  });
  assert.equal(withGarbageToken.status, 200);

  const withoutHeaders = await fetch(issuerDidUrl(ISSUER_CONFIGURED));
  assert.equal(withoutHeaders.status, 200);

  assert.deepEqual(
    await withGarbageToken.json(),
    await withoutHeaders.json(),
    'la respuesta no depende de la identidad del solicitante'
  );
});

test('27: un issuer sin identidad tecnica devuelve 404', async () => {
  const response = await fetch(issuerDidUrl(ISSUER_MISSING));

  assert.equal(response.status, 404);

  const body = await response.json();
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /secretRef/i);
  assert.doesNotMatch(serialized, /SignerProfile/);
  assert.doesNotMatch(serialized, /prisma/i);
});

test('un issuer con la clave comprometida resuelve 200 sin verificationMethod', async () => {
  const response = await fetch(issuerDidUrl(ISSUER_COMPROMISED));

  assert.equal(response.status, 200, 'el DID sigue existiendo');

  const document = await response.json();
  assert.equal(document.id, DID_COMPROMISED);
  assert.equal(document.verificationMethod, undefined);
  assert.equal(document.assertionMethod, undefined);
  // Omitidas, nunca arrays vacios.
  assert.ok(!('verificationMethod' in document));
  assert.ok(!('assertionMethod' in document));
});

// ---------------------------------------------------------------------------
// ADDENDUM B/C: CABECERAS
// ---------------------------------------------------------------------------

test('addendum C: el media type es application/did+ld+json', async () => {
  const response = await fetch(issuerDidUrl(ISSUER_CONFIGURED));

  assert.match(
    response.headers.get('content-type') ?? '',
    /^application\/did\+ld\+json/
  );
});

test('addendum B: Cache-Control es no-store', async () => {
  const response = await fetch(issuerDidUrl(ISSUER_CONFIGURED));

  // Si un SignerProfile pasa a `compromised`, su clave tiene que dejar de
  // publicarse ya; una cache HTTP intermedia no debe poder postergarlo.
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('las cabeceras tambien aplican al documento sin clave publicable', async () => {
  const response = await fetch(issuerDidUrl(ISSUER_COMPROMISED));

  assert.match(
    response.headers.get('content-type') ?? '',
    /^application\/did\+ld\+json/
  );
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

// ---------------------------------------------------------------------------
// 31: NO FILTRA NADA
// ---------------------------------------------------------------------------

test('31: la respuesta HTTP no contiene PII, membership ni metadata de anclaje', async () => {
  const response = await fetch(issuerDidUrl(ISSUER_CONFIGURED));
  const raw = await response.text();

  for (const forbidden of [
    'email',
    'userId',
    'membership',
    'walletAddress',
    'anchor',
    'secretRef',
    'custody',
    'privateKey',
    'mnemonic',
    'contractAddress',
    'txHash',
    'chainId',
    'eip155',
    'authorizationStatus',
    'readyToIssue',
    'platformAdmin'
  ]) {
    assert.ok(
      !raw.includes(forbidden),
      `la respuesta no debe contener ${forbidden}`
    );
  }

  // Y las claves JSON de nivel superior son exactamente las esperadas.
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), [
    '@context',
    'assertionMethod',
    'id',
    'verificationMethod'
  ]);
});

// ---------------------------------------------------------------------------
// 18: REGRESION DEL PLANO DE HOLDERS
// ---------------------------------------------------------------------------

test('18: la ruta de User DID sigue devolviendo EXACTAMENTE su forma anterior', async () => {
  const response = await fetch(
    `${baseUrl}/did/users/${USER_WITH_DID}/did.json`
  );

  assert.equal(response.status, 200);

  const document = (await response.json()) as Record<string, unknown>;

  // id-only, contexto string (NO array), y NINGUNA clave nueva. El set exacto
  // de claves es la asercion fuerte: implica la ausencia de verificationMethod,
  // assertionMethod y publicKeyJwk sin tener que enumerarlas.
  assert.deepEqual(Object.keys(document).sort(), ['@context', 'id']);
  assert.equal(document['@context'], 'https://www.w3.org/ns/did/v1');
  assert.equal(document.id, USER_DID);

  for (const forbidden of [
    'verificationMethod',
    'assertionMethod',
    'publicKeyJwk'
  ]) {
    assert.ok(
      !(forbidden in document),
      `el documento de holder no debe ganar ${forbidden}`
    );
  }
});

test('18b: la ruta de User DID no hereda las cabeceras nuevas del issuer', async () => {
  const response = await fetch(
    `${baseUrl}/did/users/${USER_WITH_DID}/did.json`
  );

  // S8c3 no debe cambiar el comportamiento del plano de holders.
  assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
  assert.equal(response.headers.get('cache-control'), null);
});

test('18c: un user inexistente sigue devolviendo 404', async () => {
  const response = await fetch(
    `${baseUrl}/did/users/${ISSUER_MISSING}/did.json`
  );

  assert.equal(response.status, 404);
});

test('los dos planos no se cruzan en el router', async () => {
  // El issuerId de un issuer configurado no resuelve como user, y viceversa.
  const asUser = await fetch(
    `${baseUrl}/did/users/${ISSUER_CONFIGURED}/did.json`
  );
  assert.equal(asUser.status, 404);

  const asIssuer = await fetch(issuerDidUrl(USER_WITH_DID));
  assert.equal(asIssuer.status, 404);
});
