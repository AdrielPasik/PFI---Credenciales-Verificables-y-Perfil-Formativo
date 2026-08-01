export class AcademicProgramCatalogItemResponseDto {
  programReference!: string;
  programCode!: string;
  programName!: string;
  curriculumReference!: string;
  curriculumCode!: string;
}

export class AcademicProgramSearchResponseDto {
  items!: AcademicProgramCatalogItemResponseDto[];
}
