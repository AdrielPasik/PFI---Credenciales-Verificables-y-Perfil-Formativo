export interface FormativeProfileSnapshotDto {
  id: string;
  profileVersion: string;
  isCurrent: boolean;
  credentialsCount: number;
  totalHours: number | null;
  areasSummary: unknown;
  skillsSummary: unknown;
  qualityFlags: unknown;
  generatedAt: string;
  profileJson: unknown;
}

export interface CurrentProfileResponseDto {
  userId: string;
  currentProfile: FormativeProfileSnapshotDto | null;
}

export interface HolderCurrentProfileResponseDto {
  currentProfile: {
    profileVersion: string;
    credentialsCount: number;
    totalHours: number | null;
    areas: Array<{ label: string; estimatedHours: number | null }>;
    skills: Array<{ label: string; confidence: number | null }>;
    concepts: string[];
    confidence: number | null;
    qualityFlags: string[];
    generatedAt: string;
  } | null;
}
