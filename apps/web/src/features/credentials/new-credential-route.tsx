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
  resolveHolderRequest,
  searchAcademicProgramsRequest,
  searchCurriculumAcademicSubjectsRequest
} from '@/lib/api/credentials-api';
import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';
import { useSession } from '@/lib/session/session-provider';
import type {
  CredentialDraftFormSubmission
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

    router.replace(
      `/issuer/credentials/${encodeURIComponent(draft.credentialReference)}`
    );
  }

  return (
    <CredentialDraftForm
      issuerName={membership.issuerName}
      onResolveHolder={resolveHolder}
      onCreateDraft={createDraft}
      searchPrograms={searchPrograms}
      searchSubjects={searchSubjects}
    />
  );
}
