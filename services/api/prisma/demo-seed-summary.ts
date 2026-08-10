export interface DemoSeedSummaryInput {
  academicCoursesImported: number;
  academicProgramsImported: number;
  curriculumVersionsImported: number;
  programCoursesImported: number;
}

export function buildDemoSeedSummary(input: DemoSeedSummaryInput) {
  return {
    status: 'ok' as const,
    demoIssuerReady: true,
    demoCoursePlatformIssuerReady: true,
    demoUsersReady: 3,
    academicCoursesImported: input.academicCoursesImported,
    academicProgramsImported: input.academicProgramsImported,
    curriculumVersionsImported: input.curriculumVersionsImported,
    programCoursesImported: input.programCoursesImported
  };
}
