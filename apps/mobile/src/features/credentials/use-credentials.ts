import { useQuery } from '@tanstack/react-query';

import {
  getMyCredentialRequest,
  getMyCredentialsRequest
} from '@/lib/api/scope-api';
import { useAuthenticatedRequest } from '@/lib/auth/session-provider';
import { queryKeys } from '@/lib/query/query-client';
import type {
  HolderCredentialDetailVM,
  HolderCredentialListItemVM
} from '@/types/holder';

export function useCredentials() {
  const request = useAuthenticatedRequest();

  return useQuery<HolderCredentialListItemVM[]>({
    queryKey: queryKeys.credentials,
    queryFn: () => getMyCredentialsRequest(request)
  });
}

export function useCredentialDetail(credentialReference: string) {
  const request = useAuthenticatedRequest();

  return useQuery<HolderCredentialDetailVM>({
    queryKey: queryKeys.credential(credentialReference),
    queryFn: () => getMyCredentialRequest(request, credentialReference),
    enabled: credentialReference.trim().length > 0
  });
}
