import {
  BlockchainNetwork,
  BlockchainRecordStatus,
  CredentialSourceType,
  CredentialStatus,
  CredentialType,
  Prisma
} from '@prisma/client';

import { buildHolderDisplayLabel } from '../issuers/holder-display-label';
import {
  documentEvidenceResponseSelect,
  type DocumentEvidenceResponseRecord,
  mapDocumentEvidenceResponse
} from '../document-evidence/document-evidence.mapper';
import { IssuerCredentialDetailResponseDto } from './dto/issuer-credential-detail-response.dto';
import {
  mapTextEvidenceResponse,
  textEvidenceResponseSelect,
  type TextEvidenceResponseRecord
} from '../text-evidence/text-evidence.mapper';

export const issuerCredentialReadSelect = {
  id: true,
  status: true,
  type: true,
  title: true,
  description: true,
  hours: true,
  sourceType: true,
  credentialSubject: true,
  createdAt: true,
  updatedAt: true,
  issuedAt: true,
  canonicalHash: true,
  canonicalizationVersion: true,
  issuer: {
    select: {
      name: true,
      did: true
    }
  },
  subjectUser: {
    select: {
      email: true,
      did: true,
      displayName: true,
      firstName: true,
      lastName: true
    }
  },
  academicCourse: {
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      hours: true
    }
  },
  programCourse: {
    select: {
      academicCourseId: true,
      curriculumVersion: {
        select: {
          id: true,
          versionLabel: true,
          program: {
            select: {
              id: true,
              code: true,
              name: true
            }
          }
        }
      }
    }
  },
  documentEvidences: {
    where: {
      status: 'current'
    },
    orderBy: {
      uploadedAt: 'desc'
    },
    take: 1,
    select: documentEvidenceResponseSelect
  },
  textEvidences: {
    where: {
      status: 'current'
    },
    orderBy: {
      submittedAt: 'desc'
    },
    take: 1,
    select: textEvidenceResponseSelect
  },
  blockchainRecords: {
    orderBy: [
      { registeredAt: 'desc' },
      { id: 'desc' }
    ] as Prisma.BlockchainRecordOrderByWithRelationInput[],
    take: 1,
    select: {
      network: true,
      chainId: true,
      txHash: true,
      status: true,
      registeredAt: true
    }
  }
} as const;

export interface IssuerCredentialReadRecord {
  id: string;
  status: CredentialStatus;
  type: CredentialType;
  title: string;
  description: string | null;
  hours: {
    toFixed: (fractionDigits?: number) => string;
    toString: () => string;
  } | null;
  sourceType: CredentialSourceType;
  credentialSubject: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
  issuedAt: Date | null;
  canonicalHash: string | null;
  canonicalizationVersion: string | null;
  issuer: {
    name: string;
    did: string | null;
  };
  subjectUser: {
    email: string | null;
    did: string | null;
    displayName: string | null;
    firstName: string | null;
    lastName: string | null;
  };
  academicCourse: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    hours: {
      toFixed: (fractionDigits?: number) => string;
    } | null;
  } | null;
  programCourse: {
    academicCourseId: string;
    curriculumVersion: {
      id: string;
      versionLabel: string;
      program: {
        id: string;
        code: string;
        name: string;
      };
    };
  } | null;
  documentEvidences: DocumentEvidenceResponseRecord[];
  textEvidences: TextEvidenceResponseRecord[];
  blockchainRecords: Array<{
    network: BlockchainNetwork;
    chainId: number;
    txHash: string;
    status: BlockchainRecordStatus;
    registeredAt: Date;
  }>;
}

export function mapIssuerCredentialReadModel(
  credential: IssuerCredentialReadRecord
): IssuerCredentialDetailResponseDto {
  const credentialSubject = toJsonObject(credential.credentialSubject);
  const holderEmail = normalizeOptionalText(
    credential.subjectUser.email
  )?.toLowerCase() ?? null;

  return {
    id: credential.id,
    status: credential.status,
    type: credential.type,
    title: credential.title,
    description: normalizeOptionalText(credential.description),
    hours: credential.hours?.toFixed(2) ?? null,
    sourceType: credential.sourceType,
    credentialSubject: {
      achievement_name: readAllowedText(
        credentialSubject,
        'achievement_name'
      ),
      institution_name: readAllowedText(
        credentialSubject,
        'institution_name'
      ),
      completion_date: readAllowedText(
        credentialSubject,
        'completion_date'
      ),
      academic_period: readAllowedText(
        credentialSubject,
        'academic_period'
      ),
      program_name: readAllowedText(credentialSubject, 'program_name'),
      grade: readAllowedText(credentialSubject, 'grade'),
      provider_name: readAllowedText(credentialSubject, 'provider_name'),
      platform_name: readAllowedText(credentialSubject, 'platform_name'),
      modality: readAllowedText(credentialSubject, 'modality'),
      level: readAllowedText(credentialSubject, 'level'),
      certification_code: readAllowedText(
        credentialSubject,
        'certification_code'
      ),
      expiration_date: readAllowedText(
        credentialSubject,
        'expiration_date'
      ),
      external_url: readAllowedText(credentialSubject, 'external_url'),
      skills: readAllowedStringArray(credentialSubject, 'skills'),
      competencies: readAllowedStringArray(
        credentialSubject,
        'competencies'
      ),
      learning_outcomes: readAllowedStringArray(
        credentialSubject,
        'learning_outcomes'
      )
    },
    createdAt: credential.createdAt.toISOString(),
    updatedAt: credential.updatedAt.toISOString(),
    issuedAt: credential.issuedAt?.toISOString() ?? null,
    canonicalHash: normalizeOptionalText(credential.canonicalHash),
    canonicalizationVersion: normalizeOptionalText(
      credential.canonicalizationVersion
    ),
    blockchainEvidence: credential.blockchainRecords[0]
      ? {
          network: credential.blockchainRecords[0].network,
          chainId: credential.blockchainRecords[0].chainId,
          txHash: credential.blockchainRecords[0].txHash,
          status: credential.blockchainRecords[0].status,
          registeredAt:
            credential.blockchainRecords[0].registeredAt.toISOString()
        }
      : null,
    issuer: {
      displayName: credential.issuer.name,
      did: normalizeOptionalText(credential.issuer.did)
    },
    holder: {
      displayLabel: buildHolderDisplayLabel(
        credential.subjectUser.displayName,
        credential.subjectUser.firstName,
        credential.subjectUser.lastName,
        holderEmail
      ),
      email: holderEmail,
      did: normalizeOptionalText(credential.subjectUser.did)
    },
    academicCourse: credential.academicCourse
      ? {
          academicCourseReference: credential.academicCourse.id,
          code: credential.academicCourse.code,
          name: credential.academicCourse.name,
          description: normalizeOptionalText(
            credential.academicCourse.description
          ),
          hours: credential.academicCourse.hours?.toFixed(2) ?? null,
          program:
            credential.programCourse?.academicCourseId ===
            credential.academicCourse.id
              ? {
                  programReference:
                    credential.programCourse.curriculumVersion.program.id,
                  programCode:
                    credential.programCourse.curriculumVersion.program.code,
                  programName:
                    credential.programCourse.curriculumVersion.program.name,
                  curriculumReference:
                    credential.programCourse.curriculumVersion.id,
                  curriculumCode:
                    credential.programCourse.curriculumVersion.versionLabel
                }
              : null
        }
      : null,
    documentEvidence: {
      currentDocument: credential.documentEvidences?.[0]
        ? mapDocumentEvidenceResponse(credential.documentEvidences[0])
        : null
    },
    textEvidence: {
      currentText: credential.textEvidences?.[0]
        ? mapTextEvidenceResponse(credential.textEvidences[0])
        : null
    }
  };
}

function toJsonObject(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, Prisma.JsonValue>;
}

function readAllowedText(
  source: Record<string, Prisma.JsonValue>,
  key:
    | 'achievement_name'
    | 'institution_name'
    | 'completion_date'
    | 'academic_period'
    | 'program_name'
    | 'grade'
    | 'provider_name'
    | 'platform_name'
    | 'modality'
    | 'level'
    | 'certification_code'
    | 'expiration_date'
    | 'external_url'
): string | null {
  const value = source[key];
  return typeof value === 'string' ? normalizeOptionalText(value) : null;
}

function readAllowedStringArray(
  source: Record<string, Prisma.JsonValue>,
  key: 'skills' | 'competencies' | 'learning_outcomes'
) {
  const value = source[key];

  if (!Array.isArray(value)) {
    return [];
  }

  const result: string[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }

    const normalized = entry.trim().replace(/\s+/g, ' ');
    const comparisonKey = normalized.toLocaleLowerCase('en-US');

    if (normalized && !seen.has(comparisonKey)) {
      seen.add(comparisonKey);
      result.push(normalized);
    }
  }

  return result;
}

function normalizeOptionalText(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}
