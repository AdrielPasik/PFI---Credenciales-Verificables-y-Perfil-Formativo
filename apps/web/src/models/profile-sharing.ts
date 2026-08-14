export interface ProfileShareLinkVM {
  sharePath: string;
  expiresAtLabel: string | null;
}

export interface PublicProfileShareVM {
  holderLabel: string | null;
  narrative: string | null;
  areas: Array<{ label: string; estimatedHoursLabel: string | null }>;
  skills: string[];
  concepts: string[];
  totalOfficialHoursLabel: string | null;
  credentialsCount: number;
  credentials: Array<{
    credentialReference: string;
    title: string;
    typeLabel: string;
    issuerName: string;
    issuedAtLabel: string | null;
  }>;
}
