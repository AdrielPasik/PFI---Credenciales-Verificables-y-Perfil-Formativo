import {
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import {
  CredentialStatus,
  Prisma,
  TextEvidenceStatus
} from '@prisma/client';

import { type AuthenticatedUser } from '../auth/auth.types';
import { IssuersService } from '../issuers/issuers.service';
import { PrismaService } from '../prisma/prisma.service';
import { TextEvidenceResponseDto } from './dto/text-evidence-response.dto';
import {
  mapTextEvidenceResponse,
  textEvidenceResponseSelect
} from './text-evidence.mapper';
import { validateTextEvidenceBody } from './text-evidence.validator';

const CREDENTIAL_NOT_FOUND_MESSAGE = 'No se encontro la credencial solicitada.';

// C2b.3: label explicito para toda TextEvidence generada por sistema desde
// datos declarados del course (achievementName/title, description,
// competencies, learningOutcomes) -- nunca se dice "cargado por el emisor",
// para no aparentar una accion manual que no ocurrio.
export const SYSTEM_GENERATED_COURSE_TEXT_EVIDENCE_LABEL =
  'Texto generado para análisis desde datos declarados del curso';

// C4x fix: mismo criterio para certification (achievementName/title,
// description, certificationCode, expirationDate, providerName, level,
// skills, competencies) -- certification no tiene learningOutcomes, ver
// buildCertificationTextAnalysisContent.
export const SYSTEM_GENERATED_CERTIFICATION_TEXT_EVIDENCE_LABEL =
  'Texto generado para análisis desde datos declarados de la certificación';

export interface EnsuredSystemTextEvidence {
  id: string;
  sha256: string;
  status: TextEvidenceStatus;
  reused: boolean;
}

@Injectable()
export class TextEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issuersService: IssuersService
  ) {}

  async submitCurrentText(
    issuerId: string,
    credentialId: string,
    currentUser: AuthenticatedUser,
    body: unknown
  ): Promise<TextEvidenceResponseDto> {
    await this.issuersService.assertUserCanSubmitTextEvidenceForIssuer(
      currentUser.id,
      issuerId
    );

    const credential = await this.prisma.credential.findFirst({
      where: {
        id: credentialId,
        issuerId
      },
      select: {
        id: true,
        status: true
      }
    });

    if (!credential) {
      throw new NotFoundException(CREDENTIAL_NOT_FOUND_MESSAGE);
    }

    if (credential.status !== CredentialStatus.draft) {
      throw new ConflictException(
        'La evidencia textual solo puede reemplazarse en un borrador.'
      );
    }

    const input = validateTextEvidenceBody(body);

    const evidence = await this.prisma.$transaction(
      async (transaction) => {
        const transactionalCredential =
          await transaction.credential.findFirst({
            where: {
              id: credentialId,
              issuerId
            },
            select: {
              id: true,
              status: true
            }
          });

        if (!transactionalCredential) {
          throw new NotFoundException(CREDENTIAL_NOT_FOUND_MESSAGE);
        }

        if (transactionalCredential.status !== CredentialStatus.draft) {
          throw new ConflictException(
            'La evidencia textual solo puede reemplazarse en un borrador.'
          );
        }

        const replacedAt = new Date();

        await transaction.textEvidence.updateMany({
          where: {
            credentialId: transactionalCredential.id,
            status: TextEvidenceStatus.current
          },
          data: {
            status: TextEvidenceStatus.replaced,
            replacedAt
          }
        });

        return transaction.textEvidence.create({
          data: {
            credentialId: transactionalCredential.id,
            submittedByUserId: currentUser.id,
            label: input.label,
            content: input.content,
            sha256: input.sha256,
            status: TextEvidenceStatus.current
          },
          select: textEvidenceResponseSelect
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      }
    );

    return mapTextEvidenceResponse(evidence);
  }

  /**
   * C2b.3: asegura una TextEvidence `current` utilizable como fuente de
   * analisis automatico para un `course` sin PDF, SIN reemplazar nunca una
   * evidencia `current` ya existente -- el schema actual no distingue
   * origen manual vs generado por sistema, asi que la regla conservadora
   * es: si ya hay una `current` (de cualquier origen), se devuelve tal
   * cual, sin tocarla; solo se genera una nueva cuando no existe ninguna.
   *
   * A diferencia de `submitCurrentText`, esto NO es draft-only por diseño:
   * se invoca DESPUES de emitir (`Credential.status === issued`), sobre
   * datos ya declarados por el emisor -- no es una edicion de contenido,
   * es una snapshot de lo que el curso ya tenia al momento de emitirse.
   *
   * `content` ya debe venir compuesto y normalizado por el caller (ver
   * `buildCourseTextAnalysisContent`); aca se revalida/renormaliza con el
   * mismo validador que usa el endpoint manual para no duplicar reglas de
   * longitud/caracteres de control.
   */
  async ensureSystemGeneratedCurrentTextEvidenceForCredential(
    credentialId: string,
    content: string,
    submittedByUserId: string,
    label: string
  ): Promise<EnsuredSystemTextEvidence> {
    return this.prisma.$transaction(
      async (transaction) => {
        const existing = await transaction.textEvidence.findFirst({
          where: {
            credentialId,
            status: TextEvidenceStatus.current
          },
          select: { id: true, sha256: true, status: true }
        });

        if (existing) {
          return { ...existing, reused: true };
        }

        const input = validateTextEvidenceBody({
          content,
          label
        });

        const created = await transaction.textEvidence.create({
          data: {
            credentialId,
            submittedByUserId,
            label: input.label,
            content: input.content,
            sha256: input.sha256,
            status: TextEvidenceStatus.current
          },
          select: { id: true, sha256: true, status: true }
        });

        return { ...created, reused: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }
}
