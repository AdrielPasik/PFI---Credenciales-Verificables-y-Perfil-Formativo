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
