import {
  Injectable,
  InternalServerErrorException,
  NotFoundException
} from '@nestjs/common';
import { UserStatus } from '@prisma/client';

import { buildHolderDisplayLabel } from '../issuers/holder-display-label';
import { PrismaService } from '../prisma/prisma.service';
import { type AdminUserResolutionResponseDto } from './dto/admin-user-resolution-response.dto';

/**
 * 404 UNIFORME. El mismo mensaje para "no existe", "pending", "suspended",
 * "archived" y "sin email": el cliente no puede distinguir el estado de una
 * cuenta ajena. Aunque este endpoint solo lo alcanza un Platform Admin, no hay
 * razon para que la respuesta revele el ciclo de vida de una cuenta cuando lo
 * unico que se pregunto es si hay alguien elegible detras de ese email.
 *
 * Mismo criterio y mismo tono que
 * `IssuerHolderResolutionService.HOLDER_NOT_FOUND_MESSAGE`.
 */
const USER_NOT_FOUND_MESSAGE =
  'No se encontro un usuario elegible con el email indicado.';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Resolucion administrativa de un User por email -- slice S4. READ-ONLY.
 *
 * PERTENECE AL PLANO DE PLATAFORMA. No consulta `IssuerMembership`, no llama a
 * `IssuersService`, no mira el `authorizationStatus` de ningun Issuer y no
 * recibe ningun `issuerId`: un Platform Admin puede resolver un User sin tener
 * una sola membership. La autorizacion la hace `PlatformAdminGuard` sobre la
 * tabla `PlatformAdmin`, y aplica solo a `/admin/*`.
 *
 * Y es READ-ONLY de verdad: una sola lectura, sin `$transaction`, sin SQL crudo
 * y sin AuditLog -- resolver un email no cambia ninguna autoridad, asi que no
 * hay un hecho que auditar. Un guard estructural lo congela
 * (`__guards__/platform-admin-read-only.test.ts`).
 */
@Injectable()
export class PlatformAdminUserResolutionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resuelve EXACTAMENTE un User elegible, o falla.
   *
   * POR QUE `findMany` CASE-INSENSITIVE CON `take: 2` Y NO `findUnique`.
   * `User.email` es `@unique`, pero ese indice es case-SENSITIVE en PostgreSQL:
   * pueden convivir dos filas que difieran solo en mayusculas. Un `findUnique`
   * exacto podria no encontrar la cuenta real, y un `findFirst` elegiria
   * arbitrariamente una de las dos. `take: 2` existe para DETECTAR esa
   * ambiguedad y abortar con un error de integridad en vez de otorgar autoridad
   * sobre la persona equivocada en S5a. Patron tomado literalmente de
   * `IssuerHolderResolutionService.resolveHolder`.
   *
   * EL `id` NO SE PIDE. El select no incluye `id` a proposito: asi es
   * estructuralmente imposible que un userId se filtre en la respuesta (ver el
   * DTO). Lo unico que se lee es lo necesario para el email normalizado y el
   * displayLabel.
   */
  async resolveUserByEmail(
    normalizedEmail: string
  ): Promise<AdminUserResolutionResponseDto> {
    const matches = await this.prisma.user.findMany({
      where: {
        email: {
          equals: normalizedEmail,
          mode: 'insensitive'
        }
      },
      select: {
        email: true,
        displayName: true,
        firstName: true,
        lastName: true,
        status: true
      },
      take: 2
    });

    if (matches.length > 1) {
      // Inconsistencia de datos, no un problema del request: dos cuentas que
      // difieren solo en el casing del email. No se elige ninguna.
      throw new InternalServerErrorException(
        'No se pudo resolver el usuario por una inconsistencia de datos.'
      );
    }

    const user = matches[0];

    if (!user) {
      throw new NotFoundException(USER_NOT_FOUND_MESSAGE);
    }

    const storedEmail = user.email?.trim().toLowerCase();

    // `User.email` es nullable, y un valor almacenado que no valide tampoco es
    // elegible. Mismo chequeo defensivo que `normalizeStoredEmail` en
    // `issuer-holder-resolution.service.ts`.
    if (!storedEmail || !EMAIL_PATTERN.test(storedEmail)) {
      throw new NotFoundException(USER_NOT_FOUND_MESSAGE);
    }

    if (user.status !== UserStatus.active) {
      throw new NotFoundException(USER_NOT_FOUND_MESSAGE);
    }

    return {
      email: storedEmail,
      displayLabel: buildHolderDisplayLabel(
        user.displayName,
        user.firstName,
        user.lastName,
        storedEmail
      )
    };
  }
}
