export class CurriculumAcademicSubjectCatalogItemResponseDto {
  academicCourseReference!: string;
  code!: string;
  name!: string;
  description!: string | null;
  hours!: string | null;
  programReference!: string;
  programCode!: string;
  programName!: string;
  curriculumReference!: string;
  curriculumCode!: string;
}

export class CurriculumAcademicSubjectSearchResponseDto {
  items!: CurriculumAcademicSubjectCatalogItemResponseDto[];
}
