import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException
} from '@nestjs/common';
import {
  CredentialSemanticInterpretationStatus,
  CredentialStatus,
  Prisma
} from '@prisma/client';

import { AutomaticProfileRebuildService } from '../analysis-run/automatic-profile-rebuild.service';
import { type AuthenticatedUser } from '../auth/auth.types';
import {
  buildApprovedSemanticSnapshotSummary,
  resolveReusableCredentialType,
  type ApprovedSemanticSnapshotSummary
} from '../issuer-course-templates/issuer-course-templates.helpers';
import type { ReusableCredentialType } from '../issuer-course-templates/issuer-course-templates.validator';
import { buildHolderDisplayLabel } from '../issuers/holder-display-label';
import { IssuersService } from '../issuers/issuers.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApplyReusableSemanticInterpretationDto } from './dto/apply-reusable-semantic-interpretation.dto';
import { ReusableSemanticInterpretationApplyResponseDto } from './dto/reusable-semantic-interpretation-apply-response.dto';
import { ReusableSemanticInterpretationAppliedSummaryDto } from './dto/reusable-semantic-interpretation-applied-summary.dto';
import { ReusableSemanticInterpretationCandidateResponseDto } from './dto/reusable-semantic-interpretation-candidate-response.dto';
import {
  approvalRevisionMatches,
  assertTemplateApprovalIsComplete,
  computeApprovalDriftStatus,
  computeDestinationCompatibility,
  computeTemplateContentStatus,
  toApprovalRevision,
  toComparableCredentialContent,
  toComparableTemplateContent
} from './reusable-semantic-interpretation.helpers';
import { validateApplyReusableSemanticInterpretationPayload } from './reusable-semantic-interpretation.validator';

const CREDENTIAL_NOT_FOUND_MESSAGE = 'No se encontro la credencial solicitada.';
const CREDENTIAL_NOT_ISSUED_MESSAGE =
  'La credencial debe estar emitida para aplicar una interpretacion semantica reutilizable.';
const TEMPLATE_NOT_FOUND_MESSAGE =
  'No se encontro el template reutilizable solicitado.';
const TEMPLATE_TYPE_MISMATCH_MESSAGE =
  'El tipo del template no coincide con el tipo de la credencial destino.';
const TEMPLATE_NOT_APPROVED_MESSAGE =
  'Este template todavia no tiene una interpretacion semantica aprobada disponible.';
const APPROVAL_REVISION_CHANGED_MESSAGE =
  'La aprobación semántica del contenido reutilizable cambió desde que se revisó. Volvé a consultar la interpretación candidata.';
const SOURCE_CREDENTIAL_UNAVAILABLE_MESSAGE =
  'No pudimos verificar la compatibilidad semántica de esta interpretación. Revisá la credencial origen o contactá soporte.';
const DESTINATION_DRIFT_NOT_ACKNOWLEDGED_MESSAGE =
  'El contenido de esta credencial difiere del contenido que originó la interpretación aprobada. Confirmá explícitamente para aplicarla de todas formas.';
const CONCURRENCY_CONFLICT_MESSAGE =
  'No pudimos completar la aplicación por un conflicto de concurrencia. Volvé a intentar.';
const MISSING_TEMPLATE_ID_MESSAGE = 'templateId es requerido.';

// C4b.1b: retry acotado ante un conflicto real de escritura/serializacion
// bajo aislamiento Serializable -- maximo un reintento automatico, nunca un
// loop. Sin precedente distinto en el repo (ningun otro servicio reintenta
// transacciones hoy); ver bundle para la justificacion completa.
const MAX_TRANSACTION_ATTEMPTS = 2;
// Codigo documentado de Prisma para "Transaction failed due to a write
// conflict or a deadlock" bajo aislamiento Serializable.
const SERIALIZATION_CONFLICT_ERROR_CODE = 'P2034';
// Codigo de Prisma para una violacion de unique constraint -- en el
// create() de esta tabla, la unica constraint que puede dispararlo es el
// partial unique index crsi_one_active_per_credential_uq.
const UNIQUE_CONSTRAINT_ERROR_CODE = 'P2002';

const DESTINATION_CREDENTIAL_SELECT = {
  id: true,
  issuerId: true,
  status: true,
  type: true,
  title: true,
  description: true,
  hours: true,
  credentialSubject: true,
  // C5b.1: nunca expuesto en ningun DTO (todos se construyen campo a
  // campo) -- solo se usa internamente para disparar el rebuild
  // best-effort del perfil del holder despues de un apply exitoso.
  subjectUserId: true
} satisfies Prisma.CredentialSelect;

type DestinationCredentialRecord = Prisma.CredentialGetPayload<{
  select: typeof DESTINATION_CREDENTIAL_SELECT;
}>;

const TEMPLATE_SELECT = {
  id: true,
  issuerId: true,
  credentialType: true,
  title: true,
  description: true,
  hours: true,
  competencies: true,
  learningOutcomes: true,
  skills: true,
  approvedSemanticSnapshot: true,
  approvedSemanticAnalysisId: true,
  approvedSemanticSourceCredentialId: true,
  approvedSemanticApprovedByUserId: true,
  approvedSemanticApprovedAt: true,
  approvedSemanticPipelineVersion: true,
  approvedSemanticTaxonomyVersion: true
} satisfies Prisma.IssuerCourseTemplateSelect;

type TemplateRecord = Prisma.IssuerCourseTemplateGetPayload<{
  select: typeof TEMPLATE_SELECT;
}>;

const ACTIVE_ROW_SELECT = {
  id: true,
  credentialId: true,
  templateId: true,
  sourceSemanticAnalysisId: true,
  sourceCredentialId: true,
  sourceApprovedByUserId: true,
  sourceApprovedAt: true,
  sourcePipelineVersion: true,
  sourceTaxonomyVersion: true,
  approvedSnapshot: true,
  snapshotVersion: true,
  appliedByUserId: true,
  appliedAt: true,
  status: true
} satisfies Prisma.CredentialReusableSemanticInterpretationSelect;

type ActiveRowRecord = Prisma.CredentialReusableSemanticInterpretationGetPayload<{
  select: typeof ACTIVE_ROW_SELECT;
}>;

interface ApplyOutcome {
  row: ActiveRowRecord;
  changed: boolean;
  superseded: boolean;
  destination: DestinationCredentialRecord;
}

@Injectable()
export class ReusableSemanticInterpretationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issuersService: IssuersService,
    private readonly profileRebuildService: AutomaticProfileRebuildService
  ) {}

  async getCandidateForIssuer(
    issuerId: string,
    credentialId: string,
    templateIdRaw: unknown,
    currentUser: AuthenticatedUser
  ): Promise<ReusableSemanticInterpretationCandidateResponseDto> {
    await this.issuersService.assertUserCanApplyReusableSemanticInterpretationForIssuer(
      currentUser.id,
      issuerId
    );

    const templateId = normalizeTemplateIdQueryParam(templateIdRaw);
    const destination = await this.resolveDestinationCredential(
      this.prisma,
      issuerId,
      credentialId
    );
    const { template, snapshotSummary } = await this.resolveTemplate(
      this.prisma,
      issuerId,
      templateId,
      destination.type as ReusableCredentialType
    );

    const sourceCredential = await this.resolveSourceCredential(
      this.prisma,
      issuerId,
      template.approvedSemanticSourceCredentialId as string
    );
    const destinationContent = toComparableCredentialContent(destination);
    const sourceContent = sourceCredential
      ? toComparableCredentialContent(sourceCredential)
      : null;
    const credentialType = destination.type as ReusableCredentialType;

    const templateContentStatus = computeTemplateContentStatus(
      toComparableTemplateContent(template),
      sourceContent,
      credentialType
    );
    const { status: destinationCompatibility, changedFields } =
      computeDestinationCompatibility(destinationContent, sourceContent, credentialType);

    const currentActive = await this.prisma.credentialReusableSemanticInterpretation.findFirst(
      {
        where: { credentialId, status: CredentialSemanticInterpretationStatus.active },
        select: ACTIVE_ROW_SELECT
      }
    );
    const approvalDriftStatus = computeApprovalDriftStatus(
      currentActive
        ? {
            sourceSemanticAnalysisId: currentActive.sourceSemanticAnalysisId,
            sourceApprovedAt: currentActive.sourceApprovedAt
          }
        : null,
      {
        approvedSemanticAnalysisId: template.approvedSemanticAnalysisId as string,
        approvedSemanticApprovedAt: template.approvedSemanticApprovedAt as Date
      }
    );

    const approvedByDisplayLabel = await this.resolveDisplayLabel(
      this.prisma,
      template.approvedSemanticApprovedByUserId as string
    );
    const currentApplication = currentActive
      ? await this.buildAppliedSummary(this.prisma, currentActive, destination, issuerId)
      : null;

    return {
      templateId: template.id,
      templateTitle: template.title,
      snapshotSummary,
      approvedAt: (template.approvedSemanticApprovedAt as Date).toISOString(),
      approvedByDisplayLabel,
      approvalRevision: toApprovalRevision(template.approvedSemanticApprovedAt as Date),
      approvalDriftStatus,
      templateContentStatus,
      destinationCompatibility,
      changedFields,
      currentApplication
    };
  }

  async getActiveForIssuer(
    issuerId: string,
    credentialId: string,
    currentUser: AuthenticatedUser
  ): Promise<ReusableSemanticInterpretationAppliedSummaryDto | null> {
    await this.issuersService.assertUserCanApplyReusableSemanticInterpretationForIssuer(
      currentUser.id,
      issuerId
    );

    // Lectura permisiva (solo existencia, sin exigir issued/tipo): una
    // interpretacion ya aplicada debe seguir siendo legible aunque la
    // credencial cambie de estado despues (ej. revoked) -- mismo criterio
    // que IssuerAnalysisRunReadService.
    const credential = await this.prisma.credential.findFirst({
      where: { id: credentialId, issuerId },
      select: DESTINATION_CREDENTIAL_SELECT
    });
    if (!credential) {
      throw new NotFoundException(CREDENTIAL_NOT_FOUND_MESSAGE);
    }

    const active = await this.prisma.credentialReusableSemanticInterpretation.findFirst({
      where: { credentialId, status: CredentialSemanticInterpretationStatus.active },
      select: ACTIVE_ROW_SELECT
    });

    if (!active) {
      return null;
    }

    return this.buildAppliedSummary(this.prisma, active, credential, issuerId);
  }

  async applyForIssuer(
    issuerId: string,
    credentialId: string,
    currentUser: AuthenticatedUser,
    body: unknown
  ): Promise<ReusableSemanticInterpretationApplyResponseDto> {
    await this.issuersService.assertUserCanApplyReusableSemanticInterpretationForIssuer(
      currentUser.id,
      issuerId
    );
    const input = validateApplyReusableSemanticInterpretationPayload(body);

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        const outcome = await this.prisma.$transaction(
          (tx) => this.performApply(tx, issuerId, credentialId, currentUser, input),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
        return this.toApplyResponse(outcome, issuerId);
      } catch (error) {
        if (error instanceof HttpException) {
          // Rechazo de negocio (404/400/409/422): nunca se reintenta, nunca
          // se confunde con un conflicto de infraestructura.
          throw error;
        }

        if (isSerializationConflict(error)) {
          lastError = error;
          if (attempt < MAX_TRANSACTION_ATTEMPTS) {
            continue;
          }
          throw new ConflictException(CONCURRENCY_CONFLICT_MESSAGE);
        }

        if (isUniqueActiveConflict(error)) {
          // Otra transaccion gano la carrera del partial unique index entre
          // que leimos y que escribimos. Nunca se filtra el error de
          // Postgres/Prisma -- se relee el estado y se decide de forma
          // segura (seccion 13 del diseno).
          return this.reconcileConcurrentApply(issuerId, credentialId, input);
        }

        throw error;
      }
    }

    // Inalcanzable en la practica (el loop siempre retorna o lanza), pero
    // TypeScript no puede probarlo -- misma respuesta segura que el ultimo
    // intento de conflicto de serializacion.
    void lastError;
    throw new ConflictException(CONCURRENCY_CONFLICT_MESSAGE);
  }

  private async performApply(
    tx: Prisma.TransactionClient,
    issuerId: string,
    credentialId: string,
    currentUser: AuthenticatedUser,
    input: ReturnType<typeof validateApplyReusableSemanticInterpretationPayload>
  ): Promise<ApplyOutcome> {
    // Todo se relee fresco dentro de la transaccion -- nunca se confia en
    // ningun estado leido antes de entrar aca (ni siquiera el de un
    // candidate reciente).
    const destination = await this.resolveDestinationCredential(
      tx,
      issuerId,
      credentialId
    );
    const credentialType = destination.type as ReusableCredentialType;
    const { template } = await this.resolveTemplate(
      tx,
      issuerId,
      input.templateId,
      credentialType
    );

    if (
      !approvalRevisionMatches(
        template.approvedSemanticApprovedAt as Date,
        input.approvalRevision
      )
    ) {
      // TOCTOU: la aprobacion cambio entre candidate y apply. Nunca se
      // aplica la aprobacion nueva silenciosamente -- nunca se escribe
      // nada, se obliga a volver a candidate.
      throw new ConflictException(APPROVAL_REVISION_CHANGED_MESSAGE);
    }

    const sourceCredential = await this.resolveSourceCredential(
      tx,
      issuerId,
      template.approvedSemanticSourceCredentialId as string
    );
    if (!sourceCredential) {
      // unknown siempre bloquea apply -- nunca hay acknowledgment posible.
      throw new UnprocessableEntityException(SOURCE_CREDENTIAL_UNAVAILABLE_MESSAGE);
    }

    const destinationContent = toComparableCredentialContent(destination);
    const sourceContent = toComparableCredentialContent(sourceCredential);
    const { status: destinationCompatibility } = computeDestinationCompatibility(
      destinationContent,
      sourceContent,
      credentialType
    );

    if (
      destinationCompatibility === 'modified' &&
      !input.acknowledgeDestinationDrift
    ) {
      throw new UnprocessableEntityException(DESTINATION_DRIFT_NOT_ACKNOWLEDGED_MESSAGE);
    }

    const currentActive = await tx.credentialReusableSemanticInterpretation.findFirst({
      where: { credentialId, status: CredentialSemanticInterpretationStatus.active },
      select: ACTIVE_ROW_SELECT
    });

    const sameIdentity = Boolean(
      currentActive &&
        currentActive.sourceSemanticAnalysisId === template.approvedSemanticAnalysisId &&
        currentActive.sourceApprovedAt.getTime() ===
          (template.approvedSemanticApprovedAt as Date).getTime()
    );

    if (currentActive && sameIdentity) {
      // Idempotente: la misma aprobacion ya esta aplicada. Nunca se
      // escribe nada, appliedAt/appliedByUserId originales se preservan.
      return { row: currentActive, changed: false, superseded: false, destination };
    }

    if (currentActive) {
      await tx.credentialReusableSemanticInterpretation.updateMany({
        where: { id: currentActive.id },
        data: {
          status: CredentialSemanticInterpretationStatus.superseded,
          supersededAt: new Date(),
          supersededByUserId: currentUser.id
        }
      });
    }

    const created = await tx.credentialReusableSemanticInterpretation.create({
      data: {
        credentialId,
        templateId: template.id,
        sourceSemanticAnalysisId: template.approvedSemanticAnalysisId as string,
        sourceCredentialId: template.approvedSemanticSourceCredentialId as string,
        sourceApprovedByUserId: template.approvedSemanticApprovedByUserId as string,
        sourceApprovedAt: template.approvedSemanticApprovedAt as Date,
        sourcePipelineVersion: template.approvedSemanticPipelineVersion as string,
        sourceTaxonomyVersion: template.approvedSemanticTaxonomyVersion as string,
        // Copia tal cual el snapshot YA revisado/saneado del template --
        // nunca se reconstruye desde SemanticAnalysis, nunca se inventa.
        approvedSnapshot: template.approvedSemanticSnapshot as Prisma.InputJsonValue,
        snapshotVersion: readSnapshotSchema(template.approvedSemanticSnapshot),
        appliedByUserId: currentUser.id
      },
      select: ACTIVE_ROW_SELECT
    });

    return {
      row: created,
      changed: true,
      superseded: Boolean(currentActive),
      destination
    };
  }

  // Solo-lectura: se invoca despues de un P2002 en el create() de arriba,
  // FUERA de cualquier transaccion nueva (la que fallo ya se revirtio por
  // completo). Nunca vuelve a escribir -- si la fila active resultante
  // coincide con la aprobacion que este request queria aplicar, se
  // devuelve como resultado idempotente; si no, se informa un conflicto
  // real sin filtrar detalle interno.
  private async reconcileConcurrentApply(
    issuerId: string,
    credentialId: string,
    input: ReturnType<typeof validateApplyReusableSemanticInterpretationPayload>
  ): Promise<ReusableSemanticInterpretationApplyResponseDto> {
    const destination = await this.resolveDestinationCredential(
      this.prisma,
      issuerId,
      credentialId
    );
    const { template } = await this.resolveTemplate(
      this.prisma,
      issuerId,
      input.templateId,
      destination.type as ReusableCredentialType
    );
    const currentActive = await this.prisma.credentialReusableSemanticInterpretation.findFirst(
      {
        where: { credentialId, status: CredentialSemanticInterpretationStatus.active },
        select: ACTIVE_ROW_SELECT
      }
    );

    const sameIdentity = Boolean(
      currentActive &&
        currentActive.sourceSemanticAnalysisId === template.approvedSemanticAnalysisId &&
        currentActive.sourceApprovedAt.getTime() ===
          (template.approvedSemanticApprovedAt as Date).getTime()
    );

    if (currentActive && sameIdentity) {
      return this.toApplyResponse(
        { row: currentActive, changed: false, superseded: false, destination },
        issuerId
      );
    }

    throw new ConflictException(CONCURRENCY_CONFLICT_MESSAGE);
  }

  private async toApplyResponse(
    outcome: ApplyOutcome,
    issuerId: string
  ): Promise<ReusableSemanticInterpretationApplyResponseDto> {
    const application = await this.buildAppliedSummary(
      this.prisma,
      outcome.row,
      outcome.destination,
      issuerId
    );

    // C5b.1: rebuild best-effort del perfil del holder DESPUES de que el
    // apply ya quedo persistido (nunca dentro de la transaccion de
    // arriba). Se intenta para TODO resultado exitoso, incluido
    // changed:false (idempotente) -- un apply idempotente puede servir
    // como reintento del rebuild si el anterior fallo, y nunca crea una
    // fila de interpretacion nueva por esto. Nunca revierte ni invalida el
    // apply si el rebuild falla -- mismo contrato best-effort ya usado por
    // AutomaticProfileRebuildService en el resto del repo (nunca lanza).
    await this.profileRebuildService.rebuildAfterReviewedInterpretationApply({
      credentialId: outcome.row.credentialId,
      holderUserId: outcome.destination.subjectUserId
    });

    return {
      changed: outcome.changed,
      supersededPreviousApplication: outcome.superseded,
      application
    };
  }

  private async buildAppliedSummary(
    client: Prisma.TransactionClient,
    active: ActiveRowRecord,
    destination: DestinationCredentialRecord,
    issuerId: string
  ): Promise<ReusableSemanticInterpretationAppliedSummaryDto> {
    const template = await client.issuerCourseTemplate.findFirst({
      where: { id: active.templateId, issuerId },
      select: TEMPLATE_SELECT
    });

    const sourceCredential = await this.resolveSourceCredential(
      client,
      issuerId,
      active.sourceCredentialId
    );
    const destinationContent = toComparableCredentialContent(destination);
    const sourceContent = sourceCredential
      ? toComparableCredentialContent(sourceCredential)
      : null;
    const credentialType = destination.type as ReusableCredentialType;

    // template deberia siempre poder resolverse (templateId -> Restrict
    // impide borrarlo mientras haya interpretaciones aplicadas) -- el
    // fallback defensivo nunca deberia alcanzarse en la practica.
    const templateContentStatus = template
      ? computeTemplateContentStatus(
          toComparableTemplateContent(template),
          sourceContent,
          credentialType
        )
      : 'unknown';
    const approvalDriftStatus =
      template && template.approvedSemanticAnalysisId && template.approvedSemanticApprovedAt
        ? computeApprovalDriftStatus(
            {
              sourceSemanticAnalysisId: active.sourceSemanticAnalysisId,
              sourceApprovedAt: active.sourceApprovedAt
            },
            {
              approvedSemanticAnalysisId: template.approvedSemanticAnalysisId,
              approvedSemanticApprovedAt: template.approvedSemanticApprovedAt
            }
          )
        : 'different_approval_available';
    const { status: destinationCompatibility, changedFields } =
      computeDestinationCompatibility(destinationContent, sourceContent, credentialType);

    const appliedByDisplayLabel = await this.resolveDisplayLabel(
      client,
      active.appliedByUserId
    );

    return {
      templateId: active.templateId,
      templateTitle: template?.title ?? 'Contenido reutilizable no disponible',
      snapshotSummary: buildApprovedSemanticSnapshotSummary(active.approvedSnapshot),
      appliedAt: active.appliedAt.toISOString(),
      appliedByDisplayLabel,
      approvalDriftStatus,
      templateContentStatus,
      destinationCompatibility,
      changedFields
    };
  }

  private async resolveDestinationCredential(
    client: Prisma.TransactionClient,
    issuerId: string,
    credentialId: string
  ): Promise<DestinationCredentialRecord> {
    const credential = await client.credential.findFirst({
      where: { id: credentialId, issuerId },
      select: DESTINATION_CREDENTIAL_SELECT
    });

    if (!credential) {
      throw new NotFoundException(CREDENTIAL_NOT_FOUND_MESSAGE);
    }
    if (credential.status !== CredentialStatus.issued) {
      throw new BadRequestException(CREDENTIAL_NOT_ISSUED_MESSAGE);
    }
    // Rechaza academic_subject/degree con el mismo 400 ya usado en el resto
    // del dominio reutilizable (C3a.2) -- nunca duplica el mensaje.
    resolveReusableCredentialType(credential.type);

    return credential;
  }

  private async resolveTemplate(
    client: Prisma.TransactionClient,
    issuerId: string,
    templateId: string,
    expectedType: ReusableCredentialType
  ): Promise<{ template: TemplateRecord; snapshotSummary: ApprovedSemanticSnapshotSummary }> {
    const template = await client.issuerCourseTemplate.findFirst({
      where: { id: templateId, issuerId },
      select: TEMPLATE_SELECT
    });

    if (!template) {
      throw new NotFoundException(TEMPLATE_NOT_FOUND_MESSAGE);
    }
    if (template.credentialType !== expectedType) {
      throw new BadRequestException(TEMPLATE_TYPE_MISMATCH_MESSAGE);
    }
    if (!template.approvedSemanticSnapshot) {
      throw new UnprocessableEntityException(TEMPLATE_NOT_APPROVED_MESSAGE);
    }
    // Nunca fabrica provenance: si falta cualquiera de los 6 campos,
    // rechaza explicitamente (seccion 16 del diseno).
    assertTemplateApprovalIsComplete(template);

    const snapshotSummary = buildApprovedSemanticSnapshotSummary(
      template.approvedSemanticSnapshot
    );
    if (!snapshotSummary) {
      throw new UnprocessableEntityException(TEMPLATE_NOT_APPROVED_MESSAGE);
    }

    return { template, snapshotSummary };
  }

  // Nunca lanza: una source Credential no disponible es un estado
  // esperado (seccion 3/11.1 del diseno), nunca un error duro en
  // candidate. Nunca filtra por status -- una source Credential revoked
  // sigue siendo fuente historica valida porque su contenido declarativo
  // permanece intacto tras revocar (revocar solo agrega revokedAt/
  // revocationReason, nunca modifica title/description/credentialSubject).
  private async resolveSourceCredential(
    client: Prisma.TransactionClient,
    issuerId: string,
    sourceCredentialId: string
  ): Promise<DestinationCredentialRecord | null> {
    return client.credential.findFirst({
      where: { id: sourceCredentialId, issuerId },
      select: DESTINATION_CREDENTIAL_SELECT
    });
  }

  private async resolveDisplayLabel(
    client: Prisma.TransactionClient,
    userId: string
  ): Promise<string> {
    const user = await client.user.findUnique({
      where: { id: userId },
      select: { displayName: true, firstName: true, lastName: true, email: true }
    });
    if (!user) {
      return 'Usuario no disponible';
    }
    return buildHolderDisplayLabel(
      user.displayName,
      user.firstName,
      user.lastName,
      user.email
    );
  }
}

function normalizeTemplateIdQueryParam(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(MISSING_TEMPLATE_ID_MESSAGE);
  }
  return value.trim();
}

function readSnapshotSchema(snapshot: Prisma.JsonValue): string {
  const summary = buildApprovedSemanticSnapshotSummary(snapshot);
  // resolveTemplate ya garantizo que el summary es no nulo antes de que
  // este punto sea alcanzable.
  return summary!.schema;
}

function isPrismaKnownRequestError(
  error: unknown
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

function isSerializationConflict(error: unknown): boolean {
  return (
    isPrismaKnownRequestError(error) &&
    error.code === SERIALIZATION_CONFLICT_ERROR_CODE
  );
}

function isUniqueActiveConflict(error: unknown): boolean {
  return (
    isPrismaKnownRequestError(error) && error.code === UNIQUE_CONSTRAINT_ERROR_CODE
  );
}
