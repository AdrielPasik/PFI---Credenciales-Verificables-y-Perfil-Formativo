'use client';

import { useRouter } from 'next/navigation';

import { CredentialDraftForm } from '@/features/credentials/credential-draft-form';
import { IssuerRouteBoundary } from '@/features/issuer-context/issuer-route-boundary';
import { adaptHolderResolution, adaptIssuerCredentialDetail } from '@/lib/adapters/credentials.adapter';
import {
  createCredentialDraftRequest,
  resolveHolderRequest
} from '@/lib/api/credentials-api';
import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';
import { useSession } from '@/lib/session/session-provider';
import type {
  CredentialType,
  HolderSummaryVM
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

  async function createDraft(input: {
    achievementName: string;
    credentialType: CredentialType;
    holder: HolderSummaryVM;
  }) {
    const payload = await createCredentialDraftRequest(
      requestAuthenticated,
      {
        issuerReference: membership.issuerReference,
        holderReference: input.holder.holderReference,
        achievementName: input.achievementName,
        institutionName: membership.issuerName,
        credentialType: input.credentialType
      }
    );
    const draft = adaptIssuerCredentialDetail(payload);

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
    />
  );
}
