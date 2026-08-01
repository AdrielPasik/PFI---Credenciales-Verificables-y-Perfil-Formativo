export class AcademicCatalogItemResponseDto {
  academicCourseReference!: string;
  code!: string;
  name!: string;
  description!: string | null;
  hours!: string | null;
}

export class AcademicCatalogSearchResponseDto {
  items!: AcademicCatalogItemResponseDto[];
}
