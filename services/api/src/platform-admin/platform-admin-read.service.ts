import { Injectable, NotFoundException } from '@nestjs/common';
import {
  IssuerAuthorizationStatus,
  IssuerMembershipStatus
} from '@prisma/client';

import { buildHolderDisplayLabel } from '../issuers/holder-display-label';
import { PrismaService } from '../prisma/prisma.service';
import {
  type AdminIssuerListResponseDto,
  type AdminIssuerSummaryDto
} from './dto/admin-issuer-summary-response.dto';
import { type AdminIssuerMembershipsResponseDto } from './dto/admin-issuer-memberships-response.dto';

const ISSUER_NOT_FOUND_MESSAGE = 'No se encontro el issuer solicitado.';

/**
 * Lecturas del PLANO DE PLATAFORMA -- slice S3. Estrictamente READ-ONLY.
 *
 * POR QUE NO PASA POR `IssuersService`. `IssuersService.assertUserCan*ForIssuer`
 * exige `IssuerMembership` activa sobre el issuer solicitado, y eso es
 * exactamente lo que un Platform Admin NO tiene ni debe necesitar para
 * OBSERVAR el inventario: si pasara por ahi, no podria ver un issuer hasta
 * volverse miembro, que es la operacion inversa a la que estos endpoints
 * existen para informar.
 *
 * Esto NO es un bypass del plano institucional, y la diferencia es
 * verificable: la autorizacion de estas lecturas la hace `PlatformAdminGuard`,
 * que consulta UNICAMENTE la tabla `PlatformAdmin`, y aplica SOLO a
 * `/admin/*`. `IssuersService` no se toca, no aprende nada de `platformAdmin`,
 * y sigue siendo la unica autoridad de todo `issuers/:issuerId/*`. Un Platform
 * Admin que quiera OPERAR un issuer sigue necesitando su propia membership,
 * igual que cualquier otro User.
 *
 * Y es READ-ONLY de verdad, no por convencion: no hay un solo `.create`,
 * `.update`, `.upsert` ni `.delete` en este archivo, y un guard estructural lo
 * congela (`__guards__/platform-admin-read-only.test.ts`).
 */
@Injectable()
export class PlatformAdminReadService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inventario completo de Issuers con sus contadores.
   *
   * ESTRATEGIA DE QUERIES -- cuatro consultas, CONSTANTES en la cantidad de
   * issuers (nunca una por issuer):
   *
   *   1. `issuer.findMany` con `_count` de las dos relaciones DIRECTAS del
   *      modelo (`academicCourses`, `programs`). Prisma las resuelve en la
   *      misma consulta, asi que son gratis.
   *
   *   2. `issuerMembership.groupBy({ by: ['issuerId', 'status'] })`. Una sola
   *      consulta devuelve, para todos los issuers a la vez, el conteo por
   *      status: `active` sale directo y `total` es la suma de los status. Se
   *      hace asi, y no con dos `_count` filtrados, porque Prisma no permite
   *      pedir la MISMA relacion dos veces con filtros distintos dentro de un
   *      `_count` (no hay alias de relation count).
   *
   *   3. `program.findMany` con `_count.curriculumVersions`. `CurriculumVersion`
   *      NO es relacion directa de `Issuer` (cuelga de `Program`), asi que
   *      `_count` del paso 1 no la alcanza. Devuelve una fila por Program y se
   *      agrega por `issuerId` en memoria.
   *
   *   4. `curriculumVersion.findMany` con `_count.programCourses`. Dos niveles
   *      abajo de `Issuer` (`Issuer -> Program -> CurriculumVersion ->
   *      ProgramCourse`), por el mismo motivo. Una fila por CurriculumVersion,
   *      agregada por `issuerId` en memoria.
   *
   * Los pasos 3 y 4 devuelven una fila por Program / CurriculumVersion, no por
   * ProgramCourse: para el catalogo canonico del repo son 22 y 22 filas
   * respectivamente (contra 977 ProgramCourse), asi que la agregacion en
   * memoria es barata y evita por completo el N+1. No se usa `$queryRaw` con
   * GROUP BY -- que seria una sola consulta -- porque el repo no tiene ningun
   * precedente de SQL crudo y una lectura administrativa no justifica abrir ese
   * camino.
   */
  async listIssuers(): Promise<AdminIssuerListResponseDto> {
    const [issuers, membershipGroups, programRows, curriculumRows] =
      await Promise.all([
        this.prisma.issuer.findMany({
          select: {
            id: true,
            name: true,
            legalName: true,
            authorizationStatus: true,
            // Se leen para DERIVAR booleanos; el valor nunca sale en la
            // respuesta (ver el mapeo mas abajo y los DTOs).
            did: true,
            walletAddress: true,
            createdAt: true,
            _count: {
              select: {
                academicCourses: true,
                programs: true
              }
            }
          },
          // Determinismo explicito: `name` es lo que el operador lee, `id`
          // desempata nombres iguales (recordar que `Issuer.name` NO es unique).
          // Misma forma que `academic-catalog.service.ts`, que ordena por campo
          // legible y cierra con el id.
          orderBy: [{ name: 'asc' }, { id: 'asc' }]
        }),
        this.prisma.issuerMembership.groupBy({
          by: ['issuerId', 'status'],
          _count: {
            _all: true
          }
        }),
        this.prisma.program.findMany({
          select: {
            issuerId: true,
            _count: {
              select: {
                curriculumVersions: true
              }
            }
          }
        }),
        this.prisma.curriculumVersion.findMany({
          select: {
            program: {
              select: {
                issuerId: true
              }
            },
            _count: {
              select: {
                programCourses: true
              }
            }
          }
        })
      ]);

    const activeMemberships = new Map<string, number>();
    const totalMemberships = new Map<string, number>();

    for (const group of membershipGroups) {
      const count = group._count._all;
      totalMemberships.set(
        group.issuerId,
        (totalMemberships.get(group.issuerId) ?? 0) + count
      );

      if (group.status === IssuerMembershipStatus.active) {
        activeMemberships.set(
          group.issuerId,
          (activeMemberships.get(group.issuerId) ?? 0) + count
        );
      }
    }

    const curriculumVersions = new Map<string, number>();

    for (const program of programRows) {
      curriculumVersions.set(
        program.issuerId,
        (curriculumVersions.get(program.issuerId) ?? 0) +
          program._count.curriculumVersions
      );
    }

    const programCourses = new Map<string, number>();

    for (const curriculum of curriculumRows) {
      const issuerId = curriculum.program.issuerId;
      programCourses.set(
        issuerId,
        (programCourses.get(issuerId) ?? 0) + curriculum._count.programCourses
      );
    }

    const items: AdminIssuerSummaryDto[] = issuers.map((issuer) => {
      const didConfigured = issuer.did !== null;
      const walletConfigured = issuer.walletAddress !== null;

      return {
        id: issuer.id,
        name: issuer.name,
        legalName: issuer.legalName,
        authorizationStatus: issuer.authorizationStatus,
        technicalIdentity: {
          didConfigured,
          walletConfigured,
          // Misma precondicion que `IssuersService.assertIssuerCanIssue`:
          // authorized + walletAddress + did. Derivada, nunca persistida.
          readyToIssue:
            issuer.authorizationStatus ===
              IssuerAuthorizationStatus.authorized &&
            didConfigured &&
            walletConfigured
        },
        membershipCounts: {
          active: activeMemberships.get(issuer.id) ?? 0,
          total: totalMemberships.get(issuer.id) ?? 0
        },
        catalogCounts: {
          academicCourses: issuer._count.academicCourses,
          programs: issuer._count.programs,
          curriculumVersions: curriculumVersions.get(issuer.id) ?? 0,
          programCourses: programCourses.get(issuer.id) ?? 0
        },
        createdAt: issuer.createdAt
      };
    });

    return { items };
  }

  /**
   * Memberships de UN issuer.
   *
   * Una sola consulta: el issuer con sus memberships anidadas. Si el issuer no
   * existe, `findUnique` devuelve `null` y se responde 404 -- no hace falta una
   * consulta previa de existencia.
   *
   * ORDEN: `user.email asc`, desempatando por `userId asc`. Se elige este y no
   * un orden por `role` porque (a) replica exactamente la convencion que ya usa
   * `/auth/me` para ordenar memberships -- campo legible por humanos primero,
   * id estable como desempate -- y (b) un `orderBy: { role: 'asc' }` dependeria
   * del orden de DECLARACION del enum en PostgreSQL (`admin, operator,
   * viewer`), que es una propiedad implicita del schema: hoy coincide con el
   * orden de privilegio, pero reordenar el enum cambiaria la presentacion sin
   * que nada lo advierta. El email es ademas el identificador con el que el
   * Platform Admin busca a una persona.
   */
  async listIssuerMemberships(
    issuerId: string
  ): Promise<AdminIssuerMembershipsResponseDto> {
    const issuer = await this.prisma.issuer.findUnique({
      where: {
        id: issuerId
      },
      select: {
        id: true,
        name: true,
        memberships: {
          select: {
            userId: true,
            role: true,
            status: true,
            createdAt: true,
            user: {
              select: {
                email: true,
                displayName: true,
                firstName: true,
                lastName: true
              }
            }
          },
          orderBy: [{ user: { email: 'asc' } }, { userId: 'asc' }]
        }
      }
    });

    if (!issuer) {
      throw new NotFoundException(ISSUER_NOT_FOUND_MESSAGE);
    }

    return {
      issuer: {
        id: issuer.id,
        name: issuer.name
      },
      items: issuer.memberships.map((membership) => ({
        userId: membership.userId,
        // `User.email` es nullable en el schema y se proyecta TAL CUAL. No se
        // normaliza a `''`: "sin email" y "email vacio" son estados distintos,
        // y `''` no es un email valido. La membership no se oculta por esto.
        email: membership.user.email,
        // Unica implementacion del concepto en el repo. Nunca se exponen
        // firstName/lastName crudos.
        displayLabel: buildHolderDisplayLabel(
          membership.user.displayName,
          membership.user.firstName,
          membership.user.lastName,
          membership.user.email
        ),
        role: membership.role,
        status: membership.status,
        createdAt: membership.createdAt
      }))
    };
  }
}
