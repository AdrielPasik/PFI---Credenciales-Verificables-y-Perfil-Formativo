/**
 * ISSUANCE SAFETY de S5b: un Issuer recien provisionado NO puede emitir.
 *
 * Afirma UNA propiedad de seguridad:
 *
 *     el Issuer que crea S5b queda `authorizationStatus = authorized`, y SIN
 *     EMBARGO la regla institucional de emision existente sigue rechazandolo,
 *     porque nace con `did = null` y `walletAddress = null`
 *
 * POR QUE HACE FALTA UN TEST Y NO UN COMENTARIO. S5b es el primer lugar del
 * repo que crea un Issuer `authorized` sin pasar por `seed.ts`. Si
 * `assertIssuerCanIssue` solo comprobara `authorizationStatus` -- o si alguien
 * la "simplificara" en ese sentido mas adelante -- S5b habria abierto
 * capacidad de emision a cualquier institucion recien dada de alta, sin DID,
 * sin wallet y sin nada registrado en cadena. El fallo no se veria en los tests
 * de S5b (que no emiten) ni en los de emision (que usan issuers completos):
 * solo en la interseccion, que es exactamente lo que cubre este archivo.
 *
 * COMO SE EVITA QUE EL TEST SE DESINCRONICE. No hay fixture escrita a mano. Se
 * EJECUTA el service real de S5b contra un doble, se captura la fila `Issuer`
 * que realmente quedo persistida, y ESA fila se le pasa al
 * `IssuersService.assertIssuerCanIssue` REAL. Si manana S5b empezara a escribir
 * un `did`, o si la regla de emision dejara de exigirlo, este test lo detecta.
 *
 * NO SE MODIFICA `IssuersService`, no se cambia la semantica de
 * `assertIssuerCanIssue`, y no se crea ningun DID ni wallet de prueba.
 *
 * NOTA SOBRE LA UBICACION. Este test vive en `src/platform-admin/__guards__/`
 * porque la propiedad que defiende es de S5b, no de emision. Importa
 * `IssuersService`, que el guard de read-only prohibe en los archivos
 * PRODUCTIVOS del modulo -- ese barrido excluye los `.test.ts`, asi que no hay
 * contradiccion: lo que esta prohibido es que el plano de plataforma DEPENDA
 * de la autorizacion institucional, no que un test la observe.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CredentialType,
  type Issuer,
  IssuerAuthorizationStatus,
  IssuerTechnicalIdentityStatus,
  SignerProfilePurpose,
  SignerProfileStatus,
  UserStatus
} from '@prisma/client';

import { materialFromScalar } from '../../identity/operator/signer-material-generator';
import { IssuerReadinessError } from '../../issuers/issuer-readiness.service';
import { IssuersService } from '../../issuers/issuers.service';
import { PlatformAdminIssuerProvisionService } from '../platform-admin-issuer-provision.service';

const REQUEST = {
  name: 'Universidad X',
  legalName: 'Universidad X',
  initialAdminUserEmail: 'admin@universidadx.edu'
};

const ACTOR_ID = 'user-platform-admin';

/**
 * Doble minimo: solo lo que S5b toca, y las escrituras quedan registradas.
 *
 * Replica los defaults REALES del schema para las columnas que el service NO
 * menciona -- en particular `did` y `walletAddress`, que es justamente el punto
 * de este archivo.
 */
function createProvisionDouble() {
  const issuers: Issuer[] = [];

  const client = {
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const tx = {
        user: {
          async findMany() {
            return [
              {
                id: 'user-admin-x',
                email: 'admin@universidadx.edu',
                displayName: null,
                firstName: 'Ana',
                lastName: 'Gomez',
                status: UserStatus.active
              }
            ];
          }
        },
        issuer: {
          async create({
            data,
            select
          }: {
            data: Record<string, unknown>;
            select: Record<string, boolean>;
          }) {
            const row = {
              id: 'issuer-nuevo',
              name: '',
              legalName: null,
              did: null,
              walletAddress: null,
              // Default REAL del schema (S8c1): ninguna capacidad.
              allowedCredentialTypes: [],
              authorizationStatus: IssuerAuthorizationStatus.pending,
              authorizedAt: null,
              revokedAt: null,
              createdAt: new Date('2026-10-04T12:00:00.000Z'),
              updatedAt: new Date('2026-10-04T12:00:00.000Z'),
              metadata: null,
              ...data
            } as Issuer;

            issuers.push(row);

            const projected: Record<string, unknown> = {};
            for (const key of Object.keys(select)) {
              projected[key] = (row as unknown as Record<string, unknown>)[key];
            }
            return projected;
          }
        },
        issuerMembership: {
          async create({ select }: { select: Record<string, boolean> }) {
            const row: Record<string, unknown> = {
              id: 'membership-1',
              userId: 'user-admin-x',
              role: 'admin',
              status: 'active',
              createdAt: new Date('2026-10-04T12:00:00.000Z')
            };
            const projected: Record<string, unknown> = {};
            for (const key of Object.keys(select)) {
              projected[key] = row[key];
            }
            return projected;
          }
        },
        auditLog: {
          async create() {
            return { id: 'audit' };
          }
        }
      };

      return fn(tx);
    }
  };

  return { client, issuers };
}

/**
 * Da de alta un Issuer con el service REAL de S5b y devuelve la fila `Issuer`
 * tal como quedo persistida.
 */
async function provisionAndCaptureIssuer(): Promise<Issuer> {
  const { client, issuers } = createProvisionDouble();
  const service = new PlatformAdminIssuerProvisionService(client as never);

  await service.provisionIssuer(REQUEST, ACTOR_ID);

  assert.equal(issuers.length, 1, 'S5b deberia crear exactamente un Issuer');
  return issuers[0];
}

/**
 * S8c9 -- `assertIssuerCanIssue(issuerId, tipo)` pasa por la READINESS, que lee
 * la base (snapshot publico, sin secretos ni red). El doble devuelve la fila
 * REAL que S5b persistio, con la forma de la consulta de readiness.
 *
 * Este archivo SUPERSEDE la version S5b que afirmaba "falla por walletAddress /
 * por DID": esos campos legacy dejaron de ser autoridad. La PROPIEDAD de
 * seguridad se conserva intacta -- el issuer recien provisionado sigue sin
 * poder emitir -- pero ahora por las razones del modelo nuevo.
 */
function createIssuersService(
  issuer: Issuer,
  technical: { technicalIdentity: unknown; assertionKeyBindings: unknown[] } = {
    technicalIdentity: null,
    assertionKeyBindings: []
  }
): IssuersService {
  const prisma = {
    issuer: {
      async findUnique() {
        return {
          id: issuer.id,
          authorizationStatus: issuer.authorizationStatus,
          allowedCredentialTypes: issuer.allowedCredentialTypes,
          ...technical
        };
      }
    }
  };

  return new IssuersService(prisma as never);
}

const ALL_TYPES = Object.values(CredentialType);

// ---------------------------------------------------------------------------
// El estado con el que nace el issuer
// ---------------------------------------------------------------------------

test('el Issuer provisionado por S5b nace authorized pero SIN identidad tecnica ni capacidades', async () => {
  const issuer = await provisionAndCaptureIssuer();

  assert.equal(
    issuer.authorizationStatus,
    IssuerAuthorizationStatus.authorized
  );
  assert.equal(issuer.did, null);
  assert.equal(issuer.walletAddress, null);
  assert.deepEqual(issuer.allowedCredentialTypes, []);
});

// ---------------------------------------------------------------------------
// LA PROPIEDAD DE SEGURIDAD
// ---------------------------------------------------------------------------

test('REGRESION: la regla de emision REAL sigue rechazando al issuer de S5b, para los cuatro tipos', async () => {
  const issuer = await provisionAndCaptureIssuer();
  const issuersService = createIssuersService(issuer);

  for (const type of ALL_TYPES) {
    await assert.rejects(
      issuersService.assertIssuerCanIssue(issuer.id, type),
      (error: unknown) => {
        assert.ok(error instanceof IssuerReadinessError, 'deberia fallar closed');
        assert.equal(error.getStatus(), 400);
        assert.equal(error.code, 'ISSUER_NOT_READY');
        return true;
      }
    );
  }
});

test('REGRESION: did/walletAddress LEGACY puestos a mano NO habilitan la emision', async () => {
  const issuer = await provisionAndCaptureIssuer();
  const issuersService = createIssuersService({
    ...issuer,
    did: 'did:example:issuer-completo',
    walletAddress: '0x00000000000000000000000000000000000000aa',
    allowedCredentialTypes: ALL_TYPES
  });

  await assert.rejects(
    issuersService.assertIssuerCanIssue(issuer.id, CredentialType.course),
    (error: unknown) =>
      error instanceof IssuerReadinessError && error.code === 'ISSUER_NOT_READY'
  );
});

test('la regla NO se satisface con authorizationStatus solo: eso es el bug que se previene', async () => {
  const issuer = await provisionAndCaptureIssuer();

  assert.equal(issuer.authorizationStatus, IssuerAuthorizationStatus.authorized);
  await assert.rejects(
    createIssuersService(issuer).assertIssuerCanIssue(issuer.id, CredentialType.course)
  );
});

test('un issuer COMPLETO en el modelo nuevo si pasa, y solo para tipos habilitados', async () => {
  // Control positivo: sin el, los tests de arriba pasarian aunque la regla
  // lanzara siempre. Claves: SOLO escalares publicos de test 1 y 2.
  const issuer = await provisionAndCaptureIssuer();
  const assertion = materialFromScalar(`0x${'0'.repeat(63)}1`);
  const anchor = materialFromScalar(`0x${'0'.repeat(63)}2`);
  const issuerId = '11111111-1111-4111-8111-111111111111';
  const verifiedAt = new Date('2026-10-01T00:00:00.000Z');
  const issuersService = createIssuersService(
    { ...issuer, id: issuerId, allowedCredentialTypes: [CredentialType.course] },
    {
      technicalIdentity: {
        status: IssuerTechnicalIdentityStatus.active,
        did: `did:web:scope.example:did:issuers:${issuerId}`,
        assertionSignerProfileId: 'assert-1',
        assertionSignerProfile: {
          id: 'assert-1',
          purpose: SignerProfilePurpose.assertion,
          status: SignerProfileStatus.active,
          keyVersion: 1,
          address: assertion.address.toLowerCase(),
          addressVerifiedAt: verifiedAt
        },
        anchorSignerProfile: {
          id: 'anchor-1',
          purpose: SignerProfilePurpose.anchor,
          status: SignerProfileStatus.active,
          keyVersion: 1,
          address: anchor.address.toLowerCase(),
          addressVerifiedAt: verifiedAt
        }
      },
      assertionKeyBindings: [
        {
          signerProfile: {
            id: 'assert-1',
            purpose: SignerProfilePurpose.assertion,
            status: SignerProfileStatus.active,
            keyVersion: 1,
            publicKeyX: assertion.publicKeyX,
            publicKeyY: assertion.publicKeyY,
            publicKeyCompressed: assertion.publicKeyCompressed
          }
        }
      ]
    }
  );

  await assert.doesNotReject(
    issuersService.assertIssuerCanIssue(issuerId, CredentialType.course)
  );
  await assert.rejects(
    issuersService.assertIssuerCanIssue(issuerId, CredentialType.degree),
    (error: unknown) =>
      error instanceof IssuerReadinessError && error.code === 'CREDENTIAL_TYPE_NOT_ENABLED'
  );
});

test('la respuesta de S5b ya lo anuncia: readyToIssue = false, con las preguntas separadas', async () => {
  const { client } = createProvisionDouble();
  const service = new PlatformAdminIssuerProvisionService(client as never);

  const response = await service.provisionIssuer(REQUEST, ACTOR_ID);

  assert.equal(response.issuer.authorizationStatus, 'authorized');
  assert.deepEqual(response.issuer.technicalIdentity, {
    didConfigured: false,
    walletConfigured: false,
    readyToIssue: false,
    administrativelyAuthorized: true,
    configurationReady: false,
    hasCredentialCapabilities: false
  });
});

// ---------------------------------------------------------------------------
// Y la autorizacion institucional tampoco se relaja
// ---------------------------------------------------------------------------

test('S5b no toca la semantica de `authorized`: sigue siendo habilitacion operacional', async () => {
  // Lo que `authorized` NO significa, hecho explicito: el issuer de S5b no
  // tiene ningun campo que afirme verificacion institucional, KYB,
  // acreditacion ni identidad confirmada -- porque esos campos no existen en
  // el modelo, y S5b no los inventa.
  const issuer = await provisionAndCaptureIssuer();

  for (const inventado of [
    'verificationStatus',
    'verified',
    'kyb',
    'kybStatus',
    'accredited',
    'institutionVerified'
  ]) {
    assert.equal(
      inventado in issuer,
      false,
      `S5b no debe introducir ${inventado}`
    );
  }

  // Y el unico campo de habilitacion sigue siendo el enum existente.
  assert.ok(
    Object.values(IssuerAuthorizationStatus).includes(
      issuer.authorizationStatus
    )
  );
});
