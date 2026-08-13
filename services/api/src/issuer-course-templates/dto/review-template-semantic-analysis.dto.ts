// Runtime validation stays in the service helper: this DTO only documents the
// narrow, optional body accepted by the backwards-compatible approval route.
export class ReviewTemplateSemanticAnalysisDto {
  reviewedAreas?: Array<{ label: string }>;
  reviewedSkills?: Array<{ label: string }>;
  reviewedConcepts?: Array<{ label: string }>;
  reviewNote?: string | null;
}
