import { describe, expect, it } from 'vitest';

import {
  formatAnalysisConfidence,
  formatAnalysisDate,
  formatAnalysisInputMode,
  formatAnalysisRunStatus,
  formatAnalysisSource,
  formatQualityFlag
} from '@/lib/formatters/analysis-runs';

describe('analysis run formatters', () => {
  it('formats confidence without converting null to zero', () => {
    expect(formatAnalysisConfidence(null)).toBe('No informada');
    expect(formatAnalysisConfidence(0)).toMatch(/^0\s?%$/);
    expect(formatAnalysisConfidence(0.75)).toMatch(/^75\s?%$/);
    expect(formatAnalysisConfidence(1)).toMatch(/^100\s?%$/);
  });

  it('uses es-AR dates and stable domain labels', () => {
    expect(formatAnalysisDate('2026-08-05T12:00:00.000Z')).toContain('2026');
    expect(formatAnalysisRunStatus('running')).toBe('Analizando documento');
    expect(formatAnalysisInputMode('combined')).toBe('Documento y texto');
    expect(formatAnalysisSource('document_evidence')).toBe(
      'Evidencia documental'
    );
  });

  it('humanizes known and unknown safe flags', () => {
    expect(formatQualityFlag('low_coverage')).toBe('Cobertura limitada');
    expect(formatQualityFlag('future-quality_flag')).toBe(
      'Future quality flag'
    );
  });
});

