import {
  type SemanticAnalysisArtifact,
  type SemanticAnalysisArtifactMappingResult
} from './semantic-analysis-artifact.types';
import { validateSemanticAnalysisArtifact } from './semantic-analysis-artifact.validator';

export function mapSemanticAnalysisArtifact(
  input: unknown
): SemanticAnalysisArtifactMappingResult {
  const artifact = validateSemanticAnalysisArtifact(input);

  return createSemanticAnalysisArtifactMapping(artifact);
}

export function createSemanticAnalysisArtifactMapping(
  artifact: SemanticAnalysisArtifact
): SemanticAnalysisArtifactMappingResult {
  return {
    status: artifact.status,
    schemaVersion: artifact.schemaVersion,
    pipelineVersion: artifact.pipelineVersion,
    taxonomyVersion: artifact.taxonomyVersion,
    areas: cloneJsonLike(artifact.areas),
    skills: cloneJsonLike(artifact.skills),
    concepts: cloneJsonLike(artifact.concepts),
    evidenceMap: cloneJsonLike(artifact.evidenceMap),
    confidence: cloneJsonLike(artifact.confidence),
    qualityFlags: cloneJsonLike(artifact.qualityFlags),
    textForEmbedding: artifact.textForEmbedding,
    warnings: cloneJsonLike(artifact.warnings),
    partialReasons: cloneJsonLike(artifact.partialReasons),
    metadata: {
      schemaVersion: artifact.schemaVersion,
      pipelineVersion: artifact.pipelineVersion,
      taxonomyVersion: artifact.taxonomyVersion,
      sourceType: artifact.sourceType,
      sourceRefs: cloneJsonLike(artifact.sourceRefs),
      hoursDistribution: cloneJsonLike(artifact.hoursDistribution)
    }
  };
}

function cloneJsonLike<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
