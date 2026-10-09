import {
  Injectable,
  InternalServerErrorException,
  NotFoundException
} from '@nestjs/common';
import {
  ActorType,
  IssuerAuthorizationStatus,
  IssuerMembershipRole,
  IssuerMembershipStatus,
  UserStatus
} from '@prisma/client';

import { buildHolderDisplayLabel } from '../issuers/holder-display-label';
import {
  evaluateIssuerReadiness,
  resolveReadinessTarget
} from '../issuers/issuer-readiness';
import { PrismaService } from '../prisma/prisma.service';
import { projectAdminIssuerReadiness } from './admin-issuer-readiness.projection';
import { type AdminIssuerProvisionResponseDto } from './dto/admin-issuer-provision-response.dto';
import {
  ISSUER_MEMBERSHIP_GRANTED_ACTION,
  ISSUER_MEMBERSHIP_RESOURCE_TYPE,
  ISSUER_PROVISIONED_ACTION,
  ISSUER_RESOURCE_TYPE
} from './platform-admin-audit.constants';
import { type ProvisionIssuerRequest } from './provision-platform-admin-issuer.validator';

/**
 * 404 UNIFORME para todo User no elegible -- inexistente, `pending`,
 * `suspended`, `archived` o sin email valido. El cliente no puede distinguir el
 * estado de una cuenta ajena. Mismo criterio y mismo mensaje que S4 y S5a.
 */
const USER_NOT_FOUND_MESSAGE =
  'No se encontro un usuario elegible con el email indicado.';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Alta de un Issuer nuevo con su primer admin -- slice S5b.
 *
 * ES EL SEGUNDO Y ULTIMO WRITER PRODUCTIVO de `src/platform-admin`, y el guard
 * estructural del modulo lo congela: este archivo puede usar `$transaction`,
 * `issuer.create`, `issuerMembership.create` y `auditLog.create`, y NADA MAS.
 *
 * CUATRO FILAS, UNA TRANSACCION: un `Issuer`, una `IssuerMembership`
 * (`admin`/`active`) y dos `AuditLog` (`issuer_provisioned` +
 * `issuer_membership_granted`). No hay provisioning parcial posible.
 *
 * PLANO DE PLATAFORMA, NO INSTITUCIONAL. No llama a `IssuersService` y no
 * exige que el actor tenga ninguna `IssuerMembership`: no podria exigirlo, el
 * issuer no existe todavia. Eso NO es un bypass -- lo que habilita a operar la
 * institucion es la fila `IssuerMembership` que este service crea
 * explicitamente, y a partir de ahi el primer admin pasa por el camino
 * institucional normal igual que cualquier otro User. Un PlatformAdmin que se
 * ponga a si mismo como primer admin tambien termina operando POR LA
 * MEMBERSHIP, no por su capacidad de plataforma.
 *
 * `authorizationStatus = authorized` SIGNIFICA HABILITACION OPERACIONAL DENTRO
 * DE SCOPE, y nada mas. No afirma que la institucion sea real, este
 * acreditada, haya pasado un KYB ni tenga identidad confirmada. En particular
 * el issuer nace con `did = null` y `walletAddress = null`, asi que
 * `IssuersService.assertIssuerCanIssue` sigue rechazandolo: autorizado
 * operacionalmente NO es listo tecnicamente para emitir. Ese limite esta
 * verificado en `__guards__/provisioned-issuer-cannot-issue.test.ts`.
 *
 * LO QUE NO HACE, NUNCA: no crea ni modifica Users (ni su `email`, `status`,
 * `did`, `displayName` ni `onboardingIntent`), no crea `AuthCredential`, no
 * toca passwords ni tokens, no crea ni modifica `PlatformAdmin`, no actualiza
 * ni borra Issuers ni memberships, no copia catalogo academico (el issuer nace
 * academicamente vacio, a proposito), no provisiona DID ni wallet, no firma
 * nada y no toca blockchain.
 */
@Injectable()
export class PlatformAdminIssuerProvisionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Da de alta el Issuer descrito por `request` y le asigna su primer admin.
   *
   * TODO OCURRE EN UNA SOLA TRANSACCION, incluida la resolucion del User.
   * Mismo criterio que S5a y mas estricto que `AuthService.register`: los
   * writes no deben quedar separados del estado que acaba de verificarse.
   *
   * ORDEN, y por que es exactamente este:
   *
   *   1. resolver el primer admin por email -- primero, para no consumir un
   *      uuid de Issuer en el caso mas probable de fallo (email que no
   *      corresponde a ningun User elegible);
   *   2. `issuer.create` -- devuelve el `id` generado, que las tres filas
   *      siguientes necesitan;
   *   3. `issuerMembership.create` -- devuelve el `id` que el segundo AuditLog
   *      usa como `resourceId`;
   *   4. `auditLog.create` del provisioning;
   *   5. `auditLog.create` del grant inicial.
   *
   * No hace falta ningun ajuste del orden por ids generados mas alla de esa
   * dependencia: cada paso consume unicamente ids ya producidos por un paso
   * anterior.
   *
   * Una `HttpException` lanzada dentro del callback aborta la transaccion, asi
   * que todos los caminos de error (404 / 500) terminan con CERO escrituras
   * persistidas: ni Issuer huerfano, ni membership sin issuer, ni auditoria de
   * un hecho que no ocurrio.
   *
   * `actorUserId` llega desde `request.user.id` (lo setea `AuthGuard` tras
   * verificar la firma y releer el User de la base). Nunca desde el body.
   */
  async provisionIssuer(
    request: ProvisionIssuerRequest,
    actorUserId: string
  ): Promise<AdminIssuerProvisionResponseDto> {
    return this.prisma.$transaction(async (transaction) => {
      // Resolucion case-insensitive con `take: 2`, igual que S4, S5a y
      // `IssuerHolderResolutionService`. El indice `@unique` de `User.email`
      // es case-SENSITIVE en PostgreSQL, asi que pueden convivir dos filas que
      // difieran solo en mayusculas: `take: 2` existe para DETECTAR esa
      // ambiguedad y abortar, nunca para elegir una.
      //
      // El `select` NO pide `onboardingIntent`: no participa de ninguna
      // decision de este flujo, y no pedirlo lo hace estructuralmente
      // imposible de usar. Un User `personal`, `institutional` o `null`
      // legacy es igualmente elegible.
      const matches = await transaction.user.findMany({
        where: {
          email: {
            equals: request.initialAdminUserEmail,
            mode: 'insensitive'
          }
        },
        select: {
          id: true,
          email: true,
          displayName: true,
          firstName: true,
          lastName: true,
          status: true
        },
        take: 2
      });

      if (matches.length > 1) {
        throw new InternalServerErrorException(
          'No se pudo resolver el usuario por una inconsistencia de datos.'
        );
      }

      const user = matches[0];

      if (!user) {
        throw new NotFoundException(USER_NOT_FOUND_MESSAGE);
      }

      const storedEmail = user.email?.trim().toLowerCase();

      if (!storedEmail || !EMAIL_PATTERN.test(storedEmail)) {
        throw new NotFoundException(USER_NOT_FOUND_MESSAGE);
      }

      if (user.status !== UserStatus.active) {
        throw new NotFoundException(USER_NOT_FOUND_MESSAGE);
      }

      // `authorizationStatus` y `authorizedAt` SIEMPRE del servidor; el
      // validador rechaza con 400 cualquier intento del cliente de
      // proponerlos. `did` y `walletAddress` se omiten del `data`: quedan en
      // su `null` por defecto del schema, que es el estado correcto de un
      // issuer sin identidad tecnica. `metadata` tampoco se escribe -- no hay
      // ningun lector productivo de ese campo en el repo.
      const issuer = await transaction.issuer.create({
        data: {
          name: request.name,
          legalName: request.legalName,
          authorizationStatus: IssuerAuthorizationStatus.authorized,
          authorizedAt: new Date()
        },
        select: {
          id: true,
          name: true,
          legalName: true,
          authorizationStatus: true,
          // S8c9: la politica de capacidades queda en su default `[]`; se lee
          // para evaluar la readiness real, no para afirmarla.
          allowedCredentialTypes: true,
          createdAt: true
        }
      });

      // `role` y `status` SIEMPRE del servidor, igual que en S5a.
      const membership = await transaction.issuerMembership.create({
        data: {
          issuerId: issuer.id,
          userId: user.id,
          role: IssuerMembershipRole.admin,
          status: IssuerMembershipStatus.active
        },
        select: {
          id: true,
          userId: true,
          role: true,
          status: true,
          createdAt: true
        }
      });

      // `actorType = system_admin`: un PlatformAdmin humano actuando por HTTP,
      // a diferencia del `system` que usa el bootstrap de S2, donde no hay
      // actor en una request.
      //
      // `metadata` registra el estado con el que NACE el issuer, que es el dato
      // que una auditoria necesita y que la fila `Issuer` ya no podra dar una
      // vez que alguien le configure DID o wallet. `initialAdminUserId` ata el
      // alta a la persona que quedo al mando. Sin email, sin nombre de la
      // persona, sin DID, sin wallet, sin onboardingIntent, sin IP y sin token.
      await transaction.auditLog.create({
        data: {
          actorId: actorUserId,
          actorType: ActorType.system_admin,
          action: ISSUER_PROVISIONED_ACTION,
          resourceType: ISSUER_RESOURCE_TYPE,
          resourceId: issuer.id,
          metadata: {
            name: issuer.name,
            authorizationStatus: IssuerAuthorizationStatus.authorized,
            didConfigured: false,
            walletConfigured: false,
            initialAdminUserId: user.id
          }
        }
      });

      // CONTRATO IDENTICO AL DE S5a, deliberadamente. El grant inicial no es
      // un hecho de otra naturaleza por ser el primero: una consulta de
      // auditoria que pregunte "quien recibio acceso a este issuer" tiene que
      // encontrar esta fila con la misma forma que las que vengan despues por
      // `POST /admin/issuers/:issuerId/memberships`.
      await transaction.auditLog.create({
        data: {
          actorId: actorUserId,
          actorType: ActorType.system_admin,
          action: ISSUER_MEMBERSHIP_GRANTED_ACTION,
          resourceType: ISSUER_MEMBERSHIP_RESOURCE_TYPE,
          resourceId: membership.id,
          metadata: {
            issuerId: issuer.id,
            userId: user.id,
            role: IssuerMembershipRole.admin,
            status: IssuerMembershipStatus.active
          }
        }
      });

      return {
        issuer: {
          id: issuer.id,
          name: issuer.name,
          legalName: issuer.legalName,
          authorizationStatus: issuer.authorizationStatus,
          // S8c9: la readiness UNICA, evaluada sobre lo que realmente quedo en
          // la fila. Un issuer recien provisionado por S5b no tiene identidad
          // tecnica ni capacidades: AUTORIZADO no es LISTO, y da `false`.
          technicalIdentity: projectAdminIssuerReadiness(
            evaluateIssuerReadiness(
              {
                issuerId: issuer.id,
                authorizationStatus: issuer.authorizationStatus,
                allowedCredentialTypes: issuer.allowedCredentialTypes,
                technicalIdentity: null,
                assertionHistory: []
              },
              resolveReadinessTarget()
            )
          ),
          createdAt: issuer.createdAt
        },
        initialAdminMembership: {
          userId: membership.userId,
          // Nullable por contrato compartido con S3/S5a, aunque en este camino
          // siempre tenga valor: la resolucion exige un email valido.
          email: storedEmail,
          displayLabel: buildHolderDisplayLabel(
            user.displayName,
            user.firstName,
            user.lastName,
            storedEmail
          ),
          role: membership.role,
          status: membership.status,
          createdAt: membership.createdAt
        }
      };
    });
  }
}

/*
 * DUPLICADOS Y P2002: QUE CONSTRAINTS REALES HAY, Y POR QUE NO SE MAPEA NINGUN
 * CONFLICTO A 409.
 *
 * Constraints que el schema realmente declara sobre `Issuer` (verificado en
 * `prisma/schema.prisma` y en `migrations/20260709135135_init/migration.sql`):
 *
 *   - `Issuer_pkey` sobre `id`;
 *   - `Issuer_did_key` sobre `did`;
 *   - `Issuer_walletAddress_key` sobre `walletAddress`;
 *   - `@@index([authorizationStatus])`, que NO es unique.
 *
 * NO EXISTE NINGUN UNIQUE SOBRE `name` NI SOBRE `legalName`. La base no impide
 * dos Issuers llamados "Universidad X", y S5b TAMPOCO lo impide.
 *
 * Por que no se agrega una comprobacion application-level
 * (`findFirst` por nombre -> 409):
 *
 *   1. no seria integridad, seria estetica: entre el `findFirst` y el `create`
 *      hay una ventana real, asi que dos requests concurrentes seguirian
 *      creando los dos; y
 *   2. asumiria que dos nombres iguales son necesariamente la misma entidad,
 *      que es falso -- hay instituciones homonimas en jurisdicciones
 *      distintas.
 *
 * La identidad institucional fuerte queda explicitamente FUERA de este slice.
 * Si alguna vez hace falta, sera un mecanismo propio y explicito (un
 * identificador fiscal o de registro, con su unique y su migration), no un
 * efecto colateral de este endpoint. S5b no agrega migration ni constraint.
 *
 * Y por que NO se captura `P2002` en ningun lado, a diferencia de S5a:
 *
 *   - `issuer.create` escribe `did = null` y `walletAddress = null` por
 *     omision, y PostgreSQL admite ILIMITADOS `NULL` en un indice unique: esas
 *     dos constraints no pueden violarse por esta via;
 *   - `issuerMembership.create` podria violar
 *     `IssuerMembership_userId_issuerId_key`, pero el `issuerId` es el de una
 *     fila creada en ESTA MISMA transaccion con un uuid fresco, asi que no
 *     puede existir una membership previa para ese par. A diferencia de S5a,
 *     donde el issuer PREEXISTE y dos grants concurrentes del mismo email son
 *     una carrera perfectamente alcanzable, aca no hay carrera que perder;
 *   - `AuditLog` no tiene ningun unique propio mas que su PK.
 *
 * O sea: el unico P2002 que esta transaccion podria producir seria una colision
 * de PK uuid, que es un fallo real y no un conflicto de dominio. Convertirlo en
 * 409 le mentiria al cliente ("ya existe") sobre un bug de infraestructura. Se
 * deja propagar como 500. No se sobre-ingenieriza una carrera imposible.
 */
