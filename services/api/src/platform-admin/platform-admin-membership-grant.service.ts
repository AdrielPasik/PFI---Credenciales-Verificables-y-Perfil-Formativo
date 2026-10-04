import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException
} from '@nestjs/common';
import {
  ActorType,
  IssuerMembershipRole,
  IssuerMembershipStatus,
  Prisma,
  UserStatus
} from '@prisma/client';

import { buildHolderDisplayLabel } from '../issuers/holder-display-label';
import { PrismaService } from '../prisma/prisma.service';
import { type AdminMembershipGrantResponseDto } from './dto/admin-membership-grant-response.dto';
import {
  ISSUER_MEMBERSHIP_GRANTED_ACTION,
  ISSUER_MEMBERSHIP_RESOURCE_TYPE
} from './platform-admin-audit.constants';

const ISSUER_NOT_FOUND_MESSAGE = 'No se encontro el issuer solicitado.';

/**
 * 404 UNIFORME para todo User no elegible -- inexistente, `pending`,
 * `suspended`, `archived` o sin email valido. El cliente no puede distinguir el
 * estado de una cuenta ajena. Mismo criterio y mismo mensaje que S4.
 */
const USER_NOT_FOUND_MESSAGE =
  'No se encontro un usuario elegible con el email indicado.';

const ALREADY_MEMBER_MESSAGE =
  'El usuario ya tiene una membresia para este issuer.';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const UNIQUE_CONSTRAINT_ERROR_CODE = 'P2002';

/**
 * Concesion de una IssuerMembership por un PlatformAdmin -- slice S5a.
 *
 * ES EL UNICO WRITER PRODUCTIVO DE TODO `src/platform-admin`, y el guard
 * estructural del modulo lo congela: este archivo puede usar `$transaction`,
 * `issuerMembership.create` y `auditLog.create`, y NADA MAS. Ningun otro
 * archivo del modulo puede escribir nada.
 *
 * PLANO DE PLATAFORMA, NO INSTITUCIONAL. No llama a `IssuersService`, no pide
 * que el actor tenga una `IssuerMembership` sobre el issuer de destino, y no
 * exige que el issuer este `authorized` ni que tenga DID o walletAddress: la
 * asignacion administrativa de personas a una organizacion es independiente de
 * su identidad tecnica. Eso es lo que permite que S5b cree un Issuer con
 * `did = null` / `walletAddress = null` y le de su primer admin.
 *
 * LO QUE NO HACE, NUNCA: no crea ni modifica Users, no crea AuthCredential, no
 * crea ni modifica Issuers (ni `authorizationStatus`, ni `authorizedAt`, ni
 * `did`, ni `walletAddress`, ni `metadata`, ni `name`), no lee ni escribe
 * `onboardingIntent`, no toca `PlatformAdmin`, no actualiza ni borra
 * memberships, y no toca blockchain.
 *
 * CREATE ONLY. Cualquier membership preexistente para ese par (user, issuer)
 * -- `active`, `pending` o `revoked` -- produce 409 y cero escrituras. No hay
 * reactivacion, ni update, ni upsert: si alguna vez hace falta reactivar una
 * membership revocada, sera un slice explicito con su propia auditoria.
 */
@Injectable()
export class PlatformAdminMembershipGrantService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Asigna el User identificado por `normalizedEmail` al issuer `issuerId` como
   * `admin`/`active`, y audita el hecho.
   *
   * TODO OCURRE EN UNA SOLA TRANSACCION, incluidas las lecturas. Es deliberado
   * y es mas estricto que el patron de `AuthService.register` (que resuelve
   * antes de abrir la suya): aca el write critico no debe quedar separado del
   * estado que acaba de verificarse. En particular, el chequeo de membership
   * preexistente y el `create` viven en la misma transaccion, asi que entre
   * "no existe" y "la creo" no hay una ventana en la que otra sesion pueda
   * colarse sin que el unique lo detecte.
   *
   * Una `HttpException` lanzada dentro del callback aborta la transaccion, asi
   * que todos los caminos de error (404 / 409 / 500) terminan con CERO
   * escrituras persistidas.
   *
   * `actorUserId` llega desde `request.user.id` (lo setea `AuthGuard` tras
   * verificar la firma y releer el User de la base). Nunca desde el body.
   */
  async grantMembership(
    issuerId: string,
    normalizedEmail: string,
    actorUserId: string
  ): Promise<AdminMembershipGrantResponseDto> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const issuer = await transaction.issuer.findUnique({
          where: { id: issuerId },
          select: { id: true, name: true }
        });

        if (!issuer) {
          throw new NotFoundException(ISSUER_NOT_FOUND_MESSAGE);
        }

        // Resolucion case-insensitive con `take: 2`, igual que S4 y que
        // `IssuerHolderResolutionService`. El indice `@unique` de `User.email`
        // es case-SENSITIVE en PostgreSQL, asi que pueden convivir dos filas
        // que difieran solo en mayusculas: `take: 2` existe para DETECTAR esa
        // ambiguedad y abortar, nunca para elegir una.
        //
        // A diferencia de S4, aca SI se pide el `id`: hace falta para crear la
        // membership. S4 no lo pedia justamente para que no pudiera filtrarse
        // en su respuesta.
        const matches = await transaction.user.findMany({
          where: {
            email: { equals: normalizedEmail, mode: 'insensitive' }
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

        // CUALQUIER membership preexistente cuenta: active, pending o revoked.
        // El unique del schema es `@@unique([userId, issuerId])`, sin status,
        // asi que una fila revocada ocupa el par y no puede duplicarse.
        const existing = await transaction.issuerMembership.findUnique({
          where: { userId_issuerId: { userId: user.id, issuerId: issuer.id } },
          select: { id: true }
        });

        if (existing) {
          throw new ConflictException(ALREADY_MEMBER_MESSAGE);
        }

        // `role` y `status` SIEMPRE del servidor. El validador rechaza con 400
        // cualquier intento del cliente de proponerlos.
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

        // `actorType = system_admin`: un PlatformAdmin humano actuando por
        // HTTP, a diferencia del `system` que usa el bootstrap de S2, donde no
        // hay actor en una request.
        //
        // `metadata` lleva issuerId/userId porque `resourceId` es el id de la
        // MEMBERSHIP, y esa fila cae en CASCADE si se borra el User o el
        // Issuer: sin esto la fila de auditoria sobreviviente no podria decir a
        // quien se le dio acceso a que. Sin email, sin nombre, sin DID, sin
        // wallet, sin onboardingIntent, sin IP y sin token.
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
          issuer: { id: issuer.id, name: issuer.name },
          membership: {
            userId: membership.userId,
            // Nullable por contrato compartido con S3, aunque en este camino
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
    } catch (error) {
      // Carrera esperable: dos requests equivalentes pasan el chequeo y el
      // unique detiene al segundo. Es un conflicto de dominio, no un 500.
      if (isIssuerMembershipUniqueViolation(error)) {
        throw new ConflictException(ALREADY_MEMBER_MESSAGE);
      }

      throw error;
    }
  }
}

/**
 * ¿Es este error la violacion del unique `IssuerMembership(userId, issuerId)`?
 *
 * NO se mapea cualquier P2002 a 409. La transaccion hace exactamente dos
 * escrituras, y `AuditLog` no tiene ningun unique propio mas que su PK, asi que
 * un P2002 casi con certeza viene del par (userId, issuerId) -- pero "casi" no
 * alcanza: una colision de PK uuid, aunque astronomicamente improbable, seria
 * un fallo real y enmascararla como 409 mentiria.
 *
 * Por eso, cuando Prisma informa `meta.target` (el conjunto de campos o el
 * nombre del indice), se EXIGE que corresponda a este constraint; si no
 * corresponde, el error se propaga tal cual. Prisma no garantiza `meta` en
 * todos los casos, asi que cuando no viene se acepta, apoyandose en el
 * argumento estructural de arriba -- que el guard estructural del modulo
 * sostiene al congelar que este service solo puede hacer esas dos escrituras.
 *
 * Nadie mas en el repo inspecciona `meta.target` todavia; el patron base
 * (`instanceof Prisma.PrismaClientKnownRequestError` + `code`) es el de
 * `auth.service.ts` y `verification-request.service.ts`.
 */
function isIssuerMembershipUniqueViolation(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== UNIQUE_CONSTRAINT_ERROR_CODE
  ) {
    return false;
  }

  const target = (error.meta as { target?: unknown } | undefined)?.target;

  if (target === undefined || target === null) {
    return true;
  }

  const fields = (Array.isArray(target) ? target : [target])
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.toLowerCase());

  if (fields.length === 0) {
    return true;
  }

  // Prisma informa o bien los campos (`['userId', 'issuerId']`) o bien el
  // nombre del indice (`IssuerMembership_userId_issuerId_key`).
  const mentionsBothFields =
    fields.some((field) => field.includes('userid')) &&
    fields.some((field) => field.includes('issuerid'));
  const mentionsIndexName = fields.some(
    (field) => field.includes('userid') && field.includes('issuerid')
  );

  return mentionsBothFields || mentionsIndexName;
}
