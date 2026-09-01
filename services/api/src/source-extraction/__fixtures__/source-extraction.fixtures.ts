/**
 * Carga de fixtures congeladas para los tests de F0.4.
 *
 * Se consumen dos corpus distintos, y la diferencia importa:
 *
 *   - el corpus CONTRACTUAL de F0.1, escrito a mano, que ejercita casos limite
 *     que un productor real quiza nunca emita;
 *   - el corpus del PRODUCTOR, generado una vez por las implementaciones reales
 *     de F0.2/F0.3 y congelado en disco.
 *
 * El primero prueba fidelidad al contrato; el segundo prueba compatibilidad
 * cross-runtime real. Ninguno de los dos invoca Python en tiempo de test: son
 * archivos JSON estaticos.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const HERE = __dirname;

/** Corpus contractual de F0.1, en el arbol de AI Service. */
const CONTRACT_FIXTURES = join(
  HERE,
  '..',
  '..',
  '..',
  '..',
  'ai-service',
  'tests',
  'contracts',
  'fixtures',
  'source_extraction_v1'
);

const PRODUCER_CORPUS = join(HERE, 'producer-corpus');

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function names(folder: string): string[] {
  return readdirSync(join(CONTRACT_FIXTURES, folder))
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.replace(/\.json$/, ''))
    .sort();
}

export function loadContractFixture(folder: string, name: string): unknown {
  return readJson(join(CONTRACT_FIXTURES, folder, `${name}.json`));
}

export const VALID_FIXTURE_NAMES = names('valid');
export const INVALID_SCHEMA_FIXTURE_NAMES = names('invalid-schema');
export const INVALID_INVARIANT_FIXTURE_NAMES = names('invalid-invariant');

export interface CanonicalJsonGoldenVector {
  canonicalization: string;
  payload: unknown;
  canonicalJson: string;
  preimageByteLength: number;
  sha256: string;
  rejectedUppercaseVariant: { canonicalJson: string; sha256: string };
}

export function loadCanonicalJsonGoldenVector(): CanonicalJsonGoldenVector {
  return readJson(
    join(CONTRACT_FIXTURES, 'canonical-json-golden-vector.json')
  ) as CanonicalJsonGoldenVector;
}

export interface NormalizationParityVector {
  token: string;
  frozenSemantics: string[];
  cases: {
    name: string;
    rawCodePoints: number[];
    expectedCodePoints: number[];
    isNormalizedFixedPoint: boolean;
  }[];
}

export function loadNormalizationParityVector(): NormalizationParityVector {
  return readJson(
    join(CONTRACT_FIXTURES, 'text-evidence-normalization-parity-vector.json')
  ) as NormalizationParityVector;
}

export interface ProducerCorpusEntry {
  name: string;
  producer: string;
  sourceType: 'PDF_DOCUMENT' | 'TEXT';
  sourceFixture: string | null;
  sourceSha256: string;
  extractionIdentity: Record<string, string>;
  coverageStatus: string;
  artifactContentFingerprint: string;
  pageCount: number;
  segmentCount: number;
  diagnosticCodes: string[];
}

export interface ProducerCorpusManifest {
  fixture: string;
  schemaVersion: string;
  generatedBySlice: string;
  caseCount: number;
  cases: ProducerCorpusEntry[];
}

export function loadProducerCorpusManifest(): ProducerCorpusManifest {
  return readJson(
    join(PRODUCER_CORPUS, 'producer-corpus-manifest.json')
  ) as ProducerCorpusManifest;
}

/** Artifact del corpus del productor. Se relee de disco en cada llamada, para
 * que un test que lo mute no pueda contaminar a otro. */
export function loadProducerArtifact(name: string): unknown {
  return readJson(join(PRODUCER_CORPUS, `${name}.json`));
}

/** Bytes reales de una source fixture de F0, para los tests de autoridad de F0.5. */
export function loadSourceBytes(fileName: string): Buffer {
  return readFileSync(join(CONTRACT_FIXTURES, 'sources', fileName));
}

/** Copia profunda por serializacion, para construir casos negativos mutados sin
 * volver a preguntarle nada al productor. */
export function cloneArtifact<T>(artifact: T): T {
  return JSON.parse(JSON.stringify(artifact)) as T;
}
