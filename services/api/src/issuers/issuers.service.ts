import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import {
  CredentialType,
  IssuerAuthorizationStatus,
  IssuerMembershipRole,
  IssuerMembershipStatus
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { type IssuerReadinessResult } from './issuer-readiness';
import { IssuerReadinessService } from './issuer-readiness.service';

@Injectable()
export class IssuersService {
  /**
   * S8c9: la readiness se evalua por la UNICA implementacion, sobre el mismo
   * `PrismaService`. Se construye aca en vez de inyectarse para no cambiar la
   * firma de un servicio que muchos modulos construyen.
   */
  private readonly readiness: IssuerReadinessService;

  constructor(private readonly prisma: PrismaService) {
    this.readiness = new IssuerReadinessService(prisma);
  }

  async assertUserCanCreateDraftForIssuer(userId: string, issuerId: string) {
    return this.assertUserCanOperateAuthorizedIssuer(
      userId,
      issuerId,
      'crear borradores'
    );
  }

  async assertUserCanResolveHolderForIssuer(userId: string, issuerId: string) {
    return this.assertUserCanOperateAuthorizedIssuer(
      userId,
      issuerId,
      'resolver titulares'
    );
  }

  async assertUserCanReadCredentialsForIssuer(userId: string, issuerId: string) {
    return this.assertUserCanOperateAuthorizedIssuer(
      userId,
      issuerId,
      'consultar credenciales'
    );
  }

  async assertUserCanUpdateDraftForIssuer(userId: string, issuerId: string) {
    return this.assertUserCanOperateAuthorizedIssuer(
      userId,
      issuerId,
      'actualizar borradores'
    );
  }

  async assertUserCanSearchAcademicCatalogForIssuer(
    userId: string,
    issuerId: string
  ) {
    return this.assertUserCanOperateAuthorizedIssuer(
      userId,
      issuerId,
      'consultar el catalogo academico'
    );
  }

  async assertUserCanAttachDocumentEvidenceForIssuer(
    userId: string,
    issuerId: string
  ) {
    return this.assertUserCanOperateAuthorizedIssuer(
      userId,
      issuerId,
      'adjuntar evidencia documental'
    );
  }

  async assertUserCanSubmitTextEvidenceForIssuer(
    userId: string,
    issuerId: string
  ) {
    return this.assertUserCanOperateAuthorizedIssuer(
      userId,
      issuerId,
      'registrar evidencia textual'
    );
  }

  async assertUserCanRunDocumentAnalysisForIssuer(
    userId: string,
    issuerId: string
  ) {
    return this.assertUserCanOperateAuthorizedIssuer(
      userId,
      issuerId,
      'ejecutar analisis documentales'
    );
  }

  async assertUserCanIssueCredentialForIssuer(
    userId: string,
    issuerId: string
  ) {
    return this.assertUserCanOperateAuthorizedIssuer(
      userId,
      issuerId,
      'emitir credenciales'
    );
  }

  async assertUserCanManageCourseTemplatesForIssuer(
    userId: string,
    issuerId: string
  ) {
    return this.assertUserCanOperateAuthorizedIssuer(
      userId,
      issuerId,
      'gestionar el catalogo de cursos reutilizables'
    );
  }

  // C4b.1b: mismo permiso para candidate/apply/read de la interpretacion
  // semantica reutilizable aplicada a una credencial -- mismo criterio que
  // C4a.1/C4a.2 (una sola operacion cubre lectura y escritura de esta
  // funcionalidad).
  async assertUserCanApplyReusableSemanticInterpretationForIssuer(
    userId: string,
    issuerId: string
  ) {
    return this.assertUserCanOperateAuthorizedIssuer(
      userId,
      issuerId,
      'aplicar interpretaciones semanticas reutilizables'
    );
  }

  private async assertUserCanOperateAuthorizedIssuer(
    userId: string,
    issuerId: string,
    operation: string
  ) {
    const membership = await this.prisma.issuerMembership.findUnique({
      where: {
        userId_issuerId: {
          userId,
          issuerId
        }
      },
      select: {
        id: true,
        userId: true,
        issuerId: true,
        role: true,
        status: true,
        issuer: {
          select: {
            authorizationStatus: true
          }
        }
      }
    });

    if (!membership) {
      throw new ForbiddenException(
        `El usuario no tiene permisos para ${operation} para el issuer solicitado.`
      );
    }

    if (membership.status !== IssuerMembershipStatus.active) {
      throw new ForbiddenException(
        `La membresia para ${operation} no esta activa.`
      );
    }

    if (
      membership.role !== IssuerMembershipRole.admin &&
      membership.role !== IssuerMembershipRole.operator
    ) {
      throw new ForbiddenException(
        `El rol ${membership.role} no tiene permisos para ${operation}.`
      );
    }

    if (
      membership.issuer.authorizationStatus !==
      IssuerAuthorizationStatus.authorized
    ) {
      throw new ForbiddenException(
        `El issuer solicitado no esta habilitado para ${operation}.`
      );
    }

    return membership;
  }

  async getIssuerOrThrow(issuerId: string) {
    const issuer = await this.prisma.issuer.findUnique({
      where: {
        id: issuerId
      }
    });

    if (!issuer) {
      throw new NotFoundException(`Issuer ${issuerId} no existe.`);
    }

    return issuer;
  }

  async assertUserCanIssueForIssuer(userId: string, issuerId: string) {
    const membership = await this.prisma.issuerMembership.findUnique({
      where: {
        userId_issuerId: {
          userId,
          issuerId
        }
      }
    });

    if (!membership) {
      throw new ForbiddenException(
        `El usuario ${userId} no tiene membresia para emitir sobre el issuer ${issuerId}.`
      );
    }

    if (membership.status !== IssuerMembershipStatus.active) {
      throw new ForbiddenException(
        `La membresia del usuario ${userId} para el issuer ${issuerId} no esta activa.`
      );
    }

    if (
      membership.role !== IssuerMembershipRole.admin &&
      membership.role !== IssuerMembershipRole.operator
    ) {
      throw new ForbiddenException(
        `El rol ${membership.role} no tiene permisos para emitir sobre el issuer ${issuerId}.`
      );
    }

    return membership;
  }

  /**
   * Precondicion de emision v2 -- S8c9.
   *
   * Antes: `authorizationStatus` + truthiness de `Issuer.walletAddress` +
   * truthiness de `Issuer.did`. Esos dos campos legacy ya NO son autoridad.
   *
   * Ahora: la readiness unica (autorizado + configuracion tecnica coherente) y
   * la capacidad para ESTE tipo. La membresia del usuario se sigue evaluando
   * aparte -- "puede este usuario actuar por el issuer?" es otra pregunta.
   *
   * Sin signers, sin SSM, sin red.
   */
  async assertIssuerCanIssue(
    issuerId: string,
    credentialType: CredentialType
  ): Promise<IssuerReadinessResult> {
    return this.readiness.assertIssuerCanIssueType(issuerId, credentialType);
  }

  /**
   * Lectura de la configuracion TECNICA y diagnostico explicito -- S8c9.
   *
   * Deliberadamente distinto de los helpers operativos: NO exige que el issuer
   * este autorizado, porque la pagina existe justamente para que un admin vea
   * POR QUE no lo esta. Exige membresia activa con rol `admin`: operator y
   * viewer quedan afuera. Ningun PlatformAdmin la saltea.
   *
   * No reemplaza ni debilita `assertUserCanOperateAuthorizedIssuer`.
   */
  async assertUserCanReadTechnicalIdentityForIssuer(
    userId: string,
    issuerId: string
  ) {
    const membership = await this.prisma.issuerMembership.findUnique({
      where: { userId_issuerId: { userId, issuerId } },
      select: { role: true, status: true }
    });

    if (
      !membership ||
      membership.status !== IssuerMembershipStatus.active ||
      membership.role !== IssuerMembershipRole.admin
    ) {
      throw new ForbiddenException(
        'El usuario no tiene permisos para consultar la configuracion tecnica del issuer solicitado.'
      );
    }

    return membership;
  }
}
