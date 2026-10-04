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

import { BadRequestException } from '@nestjs/common';
import {
  type Issuer,
  IssuerAuthorizationStatus,
  UserStatus
} from '@prisma/client';

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
 * `IssuersService` real. `assertIssuerCanIssue` es puro -- no toca Prisma --
 * asi que un cliente que lanza ante cualquier uso es el doble correcto: si la
 * regla empezara a consultar la base, este test lo delataria en vez de
 * pasarlo por alto.
 */
function createIssuersService(): IssuersService {
  const prisma = new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(
          `assertIssuerCanIssue no deberia tocar Prisma (se accedio a ${String(property)})`
        );
      }
    }
  );

  return new IssuersService(prisma as never);
}

// ---------------------------------------------------------------------------
// El estado con el que nace el issuer
// ---------------------------------------------------------------------------

test('el Issuer provisionado por S5b nace authorized pero SIN identidad tecnica', async () => {
  const issuer = await provisionAndCaptureIssuer();

  assert.equal(
    issuer.authorizationStatus,
    IssuerAuthorizationStatus.authorized
  );
  assert.equal(issuer.did, null);
  assert.equal(issuer.walletAddress, null);
});

// ---------------------------------------------------------------------------
// LA PROPIEDAD DE SEGURIDAD
// ---------------------------------------------------------------------------

test('REGRESION: la regla de emision REAL sigue rechazando al issuer de S5b', async () => {
  const issuer = await provisionAndCaptureIssuer();
  const issuersService = createIssuersService();

  assert.throws(
    () => issuersService.assertIssuerCanIssue(issuer),
    (error: unknown) => {
      assert.ok(
        error instanceof BadRequestException,
        'deberia fallar closed con 400, no pasar'
      );
      // Falla por la WALLET, que es la primera precondicion tecnica que
      // `assertIssuerCanIssue` comprueba tras `authorized`.
      assert.match(
        (error as Error).message,
        /no tiene walletAddress configurado/
      );
      return true;
    }
  );
});

test('REGRESION: tambien falta el DID -- no alcanza con configurar la wallet', async () => {
  // Se comprueba la segunda precondicion por separado, porque si alguien
  // configurara solo la wallet el issuer SEGUIRIA sin poder emitir. Es el
  // mismo issuer de S5b con una wallet puesta a mano SOLO para este test; no
  // se crea ninguna identidad real ni se toca cadena.
  const issuer = await provisionAndCaptureIssuer();
  const issuersService = createIssuersService();

  assert.throws(
    () =>
      issuersService.assertIssuerCanIssue({
        ...issuer,
        walletAddress: '0x0000000000000000000000000000000000000000'
      }),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.match((error as Error).message, /no tiene DID configurado/);
      return true;
    }
  );
});

test('la regla NO se satisface con authorizationStatus solo: eso es el bug que se previene', async () => {
  // Control negativo del test mismo. Si `assertIssuerCanIssue` se redujera a
  // comprobar `authorized`, este caso pasaria y los dos de arriba fallarian:
  // el issuer de S5b ya es `authorized`.
  const issuer = await provisionAndCaptureIssuer();
  const issuersService = createIssuersService();

  assert.equal(
    issuer.authorizationStatus,
    IssuerAuthorizationStatus.authorized,
    'la habilitacion operacional SI esta'
  );
  assert.throws(
    () => issuersService.assertIssuerCanIssue(issuer),
    BadRequestException,
    'y pese a eso la emision sigue cerrada'
  );
});

test('un issuer COMPLETO si pasa: la regla no esta simplemente siempre rota', async () => {
  // Sin este control, los tests de arriba pasarian incluso si
  // `assertIssuerCanIssue` lanzara siempre, y no probarian nada sobre S5b.
  const issuer = await provisionAndCaptureIssuer();
  const issuersService = createIssuersService();

  assert.doesNotThrow(() =>
    issuersService.assertIssuerCanIssue({
      ...issuer,
      did: 'did:example:issuer-completo',
      walletAddress: '0x00000000000000000000000000000000000000aa'
    })
  );
});

test('la respuesta de S5b ya lo anuncia: readyToIssue = false', async () => {
  // El contrato HTTP no miente sobre esto: el cliente no tiene que descubrir
  // por un 400 que el issuer no puede emitir todavia.
  const { client } = createProvisionDouble();
  const service = new PlatformAdminIssuerProvisionService(client as never);

  const response = await service.provisionIssuer(REQUEST, ACTOR_ID);

  assert.equal(response.issuer.authorizationStatus, 'authorized');
  assert.deepEqual(response.issuer.technicalIdentity, {
    didConfigured: false,
    walletConfigured: false,
    readyToIssue: false
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
