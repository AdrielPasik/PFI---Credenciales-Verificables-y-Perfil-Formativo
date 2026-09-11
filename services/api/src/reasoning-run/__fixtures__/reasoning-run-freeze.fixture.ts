/**
 * Doble de Prisma para el congelamiento de inputs — F3.2.
 *
 * Implementa `$transaction`, `objective.findFirst`, `credential.findMany`,
 * `analysisRunSource.findFirst` y `reasoningRun.create` con la MISMA semántica que
 * usa el servicio: filtros por status, ordenamientos explícitos y el filtro
 * `NOT { los tres null }` del bundle de extracción.
 *
 * Respetar esos filtros es lo que hace que los tests sirvan: un doble que
 * devolviera siempre la primera fila haría pasar el test justo donde importa que
 * el ordenamiento sea determinista.
 *
 * No se aplica ninguna migración y no se escribe en ninguna base.
 */

import { createHash } from 'node:crypto';

import { canonicalJson } from '../../source-extraction/canonical-json';
import { loadContractFixture } from '../../source-extraction/__fixtures__/source-extraction.fixtures';

export const OWNER_ID = 'user-holder';
export const OBJECTIVE_ID = 'obj-1';

export function objectiveDefinition(): Record<string, any> {
  return {
    schemaVersion: 'objective_definition_v1',
    objectiveType: 'EMPLOYMENT',
    objectiveContext: 'Backend Developer Junior',
    source: { inputType: 'DIRECT_STRUCTURED_INPUT', originalText: null },
    requirements: [
      {
        requirementId: 'req_01',
        order: 1,
        requirementText: 'Diseño de APIs REST',
        provenance: { kind: 'DIRECT_STRUCTURED_INPUT', sourceQuote: null },
        qualifiers: []
      }
    ]
  };
}

export interface FakeDocumentEvidence {
  id: string;
  kind: 'pdf' | 'image';
  mimeType: string;
  sha256: string;
  status: 'current' | 'replaced';
  uploadedAt: Date;
}

export interface FakeTextEvidence {
  id: string;
  sha256: string;
  status: 'current' | 'replaced';
  submittedAt: Date;
}

export interface FakeCredential {
  id: string;
  subjectUserId: string;
  status: 'draft' | 'issued' | 'revoked';
  createdAt: Date;
  documentEvidences: FakeDocumentEvidence[];
  textEvidences: FakeTextEvidence[];
}

export interface FakeAnalysisRunSource {
  id: string;
  createdAt: Date;
  sourceSha256: string;
  documentEvidenceId: string | null;
  textEvidenceId: string | null;
  extractionArtifactCanonicalJson: string | null;
  artifactBlobSha256: string | null;
  extractionDerivationTrust: string | null;
  analysisRun: { credentialId: string };
}

const SHA_A = 'a'.repeat(64);

export function sha(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

/**
 * Artifact `source_extraction_v1` VALIDO, tomado del corpus contractual congelado
 * de F0.1.
 *
 * No se fabrica uno a mano: la mitad de este slice consiste en distinguir un
 * artifact que verifica de uno que no, asi que el "que verifica" tiene que ser
 * uno real. `coverageStatus` se elige por nombre de fixture, no mutando el JSON
 * -- mutarlo romperia su `artifactContentFingerprint` y lo volveria invalido por
 * el motivo equivocado.
 */
export function validExtractionArtifact(
  coverageStatus: 'FULL' | 'PARTIAL' | 'FAILED' = 'FULL'
): unknown {
  const name =
    coverageStatus === 'FULL'
      ? 'pdf-full'
      : coverageStatus === 'PARTIAL'
        ? 'pdf-partial-failed-page'
        : 'pdf-failed-fully-scanned';
  return loadContractFixture('valid', name);
}

/** Bundle de slot PRESENTE y coherente con su artifact. */
export function presentSlot(artifact: unknown): {
  extractionArtifactCanonicalJson: string;
  artifactBlobSha256: string;
  extractionDerivationTrust: string;
} {
  const canonical = canonicalJson(artifact);
  return {
    extractionArtifactCanonicalJson: canonical,
    artifactBlobSha256: createHash('sha256')
      .update(Buffer.from(canonical, 'utf8'))
      .digest('hex'),
    extractionDerivationTrust: 'AUTHORITATIVE_CONTENT_MATCHED'
  };
}

export interface CreatedRun {
  id: string;
  ownerUserId: string;
  objectiveId: string;
  objectiveDefinitionSnapshot: unknown;
  objectiveTitleSnapshot: string;
  status: string;
  failureCode: string | null;
  failedAt: Date | null;
  inventory: Array<Record<string, any>>;
}

export function fakePrisma(options: {
  objective?: { id: string; ownerUserId: string; definition: unknown; title: string } | null;
  credentials?: FakeCredential[];
  analysisRunSources?: FakeAnalysisRunSource[];
  onCreate?: () => void;
} = {}) {
  const objective =
    options.objective === undefined
      ? {
          id: OBJECTIVE_ID,
          ownerUserId: OWNER_ID,
          definition: objectiveDefinition(),
          title: 'Backend Developer Junior'
        }
      : options.objective;
  const credentials = options.credentials ?? [];
  const sources = options.analysisRunSources ?? [];
  const created: CreatedRun[] = [];

  function bySelect<T extends Record<string, any>>(
    row: T,
    select: Record<string, any>
  ): Record<string, any> {
    const out: Record<string, any> = {};
    for (const key of Object.keys(select)) out[key] = (row as any)[key];
    return out;
  }

  const prisma = {
    $transaction: async (fn: (tx: any) => Promise<unknown>, _options?: unknown) =>
      fn(prisma),

    objective: {
      findFirst: async ({ where }: any) => {
        if (!objective) return null;
        if (objective.id !== where.id) return null;
        if (objective.ownerUserId !== where.ownerUserId) return null;
        return { definition: objective.definition, title: objective.title };
      }
    },

    credential: {
      findMany: async ({ where, orderBy }: any) => {
        void orderBy;
        return credentials
          .filter((credential) => credential.subjectUserId === where.subjectUserId)
          .slice()
          .sort(
            (left, right) =>
              left.createdAt.getTime() - right.createdAt.getTime() ||
              left.id.localeCompare(right.id)
          )
          .map((credential) => ({
            id: credential.id,
            status: credential.status,
            documentEvidences: credential.documentEvidences
              .slice()
              .sort(
                (left, right) =>
                  left.uploadedAt.getTime() - right.uploadedAt.getTime() ||
                  left.id.localeCompare(right.id)
              ),
            textEvidences: credential.textEvidences
              .slice()
              .sort(
                (left, right) =>
                  left.submittedAt.getTime() - right.submittedAt.getTime() ||
                  left.id.localeCompare(right.id)
              )
          }));
      }
    },

    analysisRunSource: {
      findFirst: async ({ where, orderBy, select }: any) => {
        void orderBy;
        const matches = sources.filter((source) => {
          if (source.documentEvidenceId !== where.documentEvidenceId) return false;
          if (source.textEvidenceId !== where.textEvidenceId) return false;
          // El filtro real es `NOT { los tres null }`: al menos uno no nulo.
          const allNull =
            source.extractionArtifactCanonicalJson === null &&
            source.artifactBlobSha256 === null &&
            source.extractionDerivationTrust === null;
          return !allNull;
        });
        if (matches.length === 0) return null;
        // createdAt DESC, id DESC
        matches.sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime() ||
            right.id.localeCompare(left.id)
        );
        return bySelect(matches[0] as any, select);
      }
    },

    reasoningRun: {
      create: async ({ data, select }: any) => {
        options.onCreate?.();
        const run: CreatedRun = {
          id: `run-${created.length + 1}`,
          ownerUserId: data.ownerUserId,
          objectiveId: data.objectiveId,
          objectiveDefinitionSnapshot: data.objectiveDefinitionSnapshot,
          objectiveTitleSnapshot: data.objectiveTitleSnapshot,
          status: data.status,
          failureCode: data.failureCode,
          failedAt: data.failedAt,
          inventory: data.inventory.create
        };
        created.push(run);
        return bySelect(run as any, select);
      }
    }
  };

  return { prisma, created };
}
