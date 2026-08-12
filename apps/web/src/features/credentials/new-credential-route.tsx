'use client';

import { useRouter } from 'next/navigation';

import { CredentialDraftForm } from '@/features/credentials/credential-draft-form';
import { IssuerRouteBoundary } from '@/features/issuer-context/issuer-route-boundary';
import {
  adaptAcademicProgramSearch,
  adaptCreatedCredentialDraft,
  adaptCurriculumAcademicSubjectSearch,
  adaptHolderResolution
} from '@/lib/adapters/credentials.adapter';
import {
  createAcademicSubjectCurricularDraftRequest,
  createManualCredentialDraftRequest,
  patchIssuerCredentialDraftRequest,
  resolveHolderRequest,
  searchAcademicProgramsRequest,
  searchCurriculumAcademicSubjectsRequest
} from '@/lib/api/credentials-api';
import { listCourseTemplates } from '@/lib/api/course-templates-api';
import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';
import { useSession } from '@/lib/session/session-provider';
import type {
  CourseTemplateSummaryVM,
  CredentialDraftFormSubmission,
  ReusableCredentialType
} from '@/models/credentials';
import type { IssuerMembershipSummaryVM } from '@/models/issuer-context';

export function NewCredentialRoute() {
  return (
    <IssuerRouteBoundary>
      {(membership) => (
        <NewCredentialController membership={membership} />
      )}
    </IssuerRouteBoundary>
  );
}

export function NewCredentialController({
  membership
}: {
  membership: IssuerMembershipSummaryVM;
}) {
  const router = useRouter();
  const { requestAuthenticated } = useSession();

  async function resolveHolder(email: string) {
    const payload = await resolveHolderRequest(requestAuthenticated, {
      issuerReference: membership.issuerReference,
      email
    });

    return adaptHolderResolution(payload);
  }

  async function searchPrograms(query: string, signal: AbortSignal) {
    const payload = await searchAcademicProgramsRequest(
      requestAuthenticated,
      {
        issuerReference: membership.issuerReference,
        query,
        limit: 20,
        signal
      }
    );

    return adaptAcademicProgramSearch(payload);
  }

  async function searchSubjects(
    curriculumReference: string,
    query: string,
    signal: AbortSignal
  ) {
    const payload = await searchCurriculumAcademicSubjectsRequest(
      requestAuthenticated,
      {
        issuerReference: membership.issuerReference,
        curriculumReference,
        query,
        limit: 20,
        signal
      }
    );

    return adaptCurriculumAcademicSubjectSearch(payload);
  }

  async function searchReusableTemplates(
    credentialType: ReusableCredentialType,
    query: string,
    signal: AbortSignal
  ) {
    return listCourseTemplates(requestAuthenticated, {
      issuerReference: membership.issuerReference,
      search: query,
      credentialType,
      signal
    });
  }

  // C3c: aplica los campos precargables de un template reutilizable
  // inmediatamente despues de crear el draft, reusando el mismo PATCH que
  // ya usa el editor de borrador existente. Best-effort: si falla, el
  // draft ya fue creado y el usuario sigue pudiendo completarlo a mano en
  // la pantalla de detalle -- nunca bloquea ni revierte la creacion.
  // Nunca copia skills/providerName/level/lastSemanticAnalysisId/datos de
  // blockchain -- eso es exactamente lo que este slice no debe hacer.
  //
  // C3c fix: devuelve si el PATCH tuvo exito o no (en vez de tragarse el
  // error en silencio) para que createDraft pueda avisarle al usuario en
  // el detalle sin bloquear ni revertir la creacion del draft.
  //
  // C4x fix: platformName ya no se envia -- el backend lo rechaza con 400
  // para cualquier tipo (ver issuer-credential-draft-subject.ts), y al ser
  // un unico body ese 400 tumbaria TODOS los campos de este PATCH (modality/
  // externalUrl/competencies/learningOutcomes incluidos), no solo platformName.
  async function applyTemplateToNewDraft(
    credentialReference: string,
    expectedUpdatedAt: string,
    template: CourseTemplateSummaryVM
  ): Promise<boolean> {
    const commonFields = {
      description: template.description,
      hours: template.hours,
      externalUrl: template.externalUrl,
      competencies: template.competencies
    };
    const typeSpecificFields =
      template.credentialType === 'course'
        ? {
            modality: template.modality,
            learningOutcomes: template.learningOutcomes
          }
        : {
            certificationCode: template.certificationCode,
            expirationDate: template.expirationDate,
            providerName: template.providerName,
            level: template.level,
            skills: template.skills
          };

    try {
      await patchIssuerCredentialDraftRequest(requestAuthenticated, {
        issuerReference: membership.issuerReference,
        credentialReference,
        expectedUpdatedAt,
        ...commonFields,
        ...typeSpecificFields
      });
      return true;
    } catch {
      // Best-effort: la creacion del draft ya se confirmo. No propagamos
      // el error para no bloquear la redireccion -- createDraft usa el
      // valor de retorno para avisarle al usuario en el detalle.
      return false;
    }
  }

  async function createDraft(input: CredentialDraftFormSubmission) {
    let payload: unknown;

    if (input.credentialType === 'academic_subject') {
      if (
        input.subject.curriculumReference !==
          input.program.curriculumReference ||
        input.subject.programReference !== input.program.programReference
      ) {
        throw new ApiError(
          'La materia seleccionada no corresponde a la carrera actual.',
          'http',
          400
        );
      }

      payload = await createAcademicSubjectCurricularDraftRequest(
        requestAuthenticated,
        {
          issuerReference: membership.issuerReference,
          holderReference: input.holder.holderReference,
          credentialType: 'academic_subject',
          academicCourseReference:
            input.subject.academicCourseReference,
          curriculumReference: input.program.curriculumReference
        }
      );
    } else {
      payload = await createManualCredentialDraftRequest(
        requestAuthenticated,
        {
          issuerReference: membership.issuerReference,
          holderReference: input.holder.holderReference,
          achievementName: input.achievementName,
          institutionName: membership.issuerName,
          credentialType: input.credentialType
        }
      );
    }

    const draft = adaptCreatedCredentialDraft(payload);

    if (draft.issuerReference !== membership.issuerReference) {
      throw new ApiError(
        'La credencial no pertenece al contexto institucional activo.',
        'http',
        403
      );
    }

    if (draft.status !== 'draft') {
      throw new IncompatiblePayloadError();
    }

    let templateApplyFailed = false;

    if (
      input.credentialType !== 'academic_subject' &&
      input.appliedTemplate
    ) {
      const applied = await applyTemplateToNewDraft(
        draft.credentialReference,
        draft.updatedAt,
        input.appliedTemplate
      );
      templateApplyFailed = !applied;
    }

    const detailPath = `/issuer/credentials/${encodeURIComponent(draft.credentialReference)}`;
    // C3c fix: nunca bloquea ni revierte la creacion del draft -- el
    // query param es la unica señal que el detalle necesita para avisar
    // al usuario que el PATCH del template no se pudo aplicar.
    router.replace(
      templateApplyFailed ? `${detailPath}?templateApply=failed` : detailPath
    );
  }

  return (
    <CredentialDraftForm
      issuerDid={membership.issuerDid}
      issuerName={membership.issuerName}
      onResolveHolder={resolveHolder}
      onCreateDraft={createDraft}
      searchPrograms={searchPrograms}
      searchReusableTemplates={searchReusableTemplates}
      searchSubjects={searchSubjects}
    />
  );
}
