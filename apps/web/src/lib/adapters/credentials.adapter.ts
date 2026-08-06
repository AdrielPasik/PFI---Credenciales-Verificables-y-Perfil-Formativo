import { IncompatiblePayloadError } from '@/lib/errors/api-error';
import {
  abbreviateDocumentHash,
  formatDocumentSize,
  formatDocumentUploadedAt
} from '@/lib/formatters/document-evidence';
import {
  abbreviateTextEvidenceHash,
  formatTextEvidenceCharacterCount,
  formatTextEvidenceSubmittedAt
} from '@/lib/formatters/text-evidence';
import {
  abbreviateIntegrityReference,
  formatBlockchainEvidenceStatus,
  formatBlockchainNetwork,
  formatIntegrityDate
} from '@/lib/formatters/credential-integrity';
import {
  credentialTypeLabels,
  credentialTypeOptions
} from '@/models/credentials';
import type {
  AcademicProgramSearchItemVM,
  CreatedCredentialDraftVM,
  CredentialStatus,
  CredentialType,
  CurriculumAcademicSubjectSearchItemVM,
  DocumentEvidenceKind,
  DocumentEvidenceMimeType,
  DocumentEvidenceVM,
  HolderSummaryVM,
  IssuerCredentialDetailVM,
  TextEvidenceVM
} from '@/models/credentials';

const documentEvidenceMimeTypes = new Set<DocumentEvidenceMimeType>([
  'application/pdf',
  'image/png',
  'image/jpeg'
]);
const documentHashPattern = /^[a-f0-9]{64}$/;
const textEvidenceHashPattern = /^[a-f0-9]{64}$/;
const blockchainHashPattern = /^0x[a-f0-9]{64}$/i;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new IncompatiblePayloadError();
  }

  return value as Record<string, unknown>;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new IncompatiblePayloadError();
  }

  return value.trim();
}

function nullableString(value: unknown): string | null {
  if (value === null) {
    return null;
  }

  return requiredString(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new IncompatiblePayloadError();
  }

  return value.map((entry) => requiredString(entry));
}

function isoDateTime(value: unknown): string {
  const dateTime = requiredString(value);

  if (Number.isNaN(Date.parse(dateTime))) {
    throw new IncompatiblePayloadError();
  }

  return dateTime;
}

function credentialStatus(value: unknown): CredentialStatus {
  if (value === 'draft' || value === 'issued' || value === 'revoked') {
    return value;
  }

  throw new IncompatiblePayloadError();
}

function credentialType(value: unknown): CredentialType {
  if (
    typeof value === 'string' &&
    credentialTypeOptions.includes(value as CredentialType)
  ) {
    return value as CredentialType;
  }

  throw new IncompatiblePayloadError();
}

function documentEvidenceKind(value: unknown): DocumentEvidenceKind {
  if (value === 'pdf' || value === 'image') {
    return value;
  }

  throw new IncompatiblePayloadError();
}

function documentEvidenceMimeType(
  value: unknown
): DocumentEvidenceMimeType {
  if (
    typeof value === 'string' &&
    documentEvidenceMimeTypes.has(value as DocumentEvidenceMimeType)
  ) {
    return value as DocumentEvidenceMimeType;
  }

  throw new IncompatiblePayloadError();
}

function positiveInteger(value: unknown) {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new IncompatiblePayloadError();
  }

  return value as number;
}

function nullableIsoDateTime(value: unknown): string | null {
  return value === null ? null : isoDateTime(value);
}

function adaptBlockchainEvidence(
  value: unknown
): NonNullable<IssuerCredentialDetailVM['blockchainEvidence']> {
  const evidence = asRecord(value);
  const network = requiredString(evidence.network);
  const chainId = positiveInteger(evidence.chainId);
  const txHash = requiredString(evidence.txHash);
  const status = requiredString(evidence.status);
  const registeredAt = isoDateTime(evidence.registeredAt);

  if (!blockchainHashPattern.test(txHash)) {
    throw new IncompatiblePayloadError();
  }

  return {
    network,
    networkLabel: formatBlockchainNetwork(network),
    chainId,
    txHash,
    txHashShort: abbreviateIntegrityReference(txHash),
    status,
    statusLabel: formatBlockchainEvidenceStatus(status),
    registeredAt,
    registeredAtLabel: formatIntegrityDate(registeredAt)
  };
}

function adaptDocumentEvidence(value: unknown): DocumentEvidenceVM {
  const evidence = asRecord(value);
  const kind = documentEvidenceKind(evidence.kind);
  const mimeType = documentEvidenceMimeType(evidence.mimeType);
  const sizeBytes = positiveInteger(evidence.sizeBytes);
  const sha256 = requiredString(evidence.sha256);
  const uploadedAt = isoDateTime(evidence.uploadedAt);

  if (
    evidence.status !== 'current' ||
    !documentHashPattern.test(sha256) ||
    (kind === 'pdf' && mimeType !== 'application/pdf') ||
    (kind === 'image' && mimeType === 'application/pdf')
  ) {
    throw new IncompatiblePayloadError();
  }

  return {
    evidenceReference: requiredString(evidence.evidenceReference),
    kind,
    status: 'current',
    originalFileName: requiredString(evidence.originalFileName),
    mimeType,
    sizeBytes,
    sizeLabel: formatDocumentSize(sizeBytes),
    sha256,
    sha256Short: abbreviateDocumentHash(sha256),
    uploadedAt,
    uploadedAtLabel: formatDocumentUploadedAt(uploadedAt)
  };
}

export function adaptDocumentEvidenceResponse(
  payload: unknown
): DocumentEvidenceVM {
  return adaptDocumentEvidence(payload);
}

function adaptTextEvidence(value: unknown): TextEvidenceVM {
  const evidence = asRecord(value);
  const content = requiredString(evidence.content);
  const characterCount = positiveInteger(evidence.characterCount);
  const sha256 = requiredString(evidence.sha256);
  const submittedAt = isoDateTime(evidence.submittedAt);

  if (
    evidence.status !== 'current' ||
    characterCount !== Array.from(content).length ||
    !textEvidenceHashPattern.test(sha256)
  ) {
    throw new IncompatiblePayloadError();
  }

  return {
    textEvidenceReference: requiredString(
      evidence.textEvidenceReference
    ),
    status: 'current',
    label: nullableString(evidence.label),
    content,
    characterCount,
    characterCountLabel:
      formatTextEvidenceCharacterCount(characterCount),
    sha256,
    sha256Short: abbreviateTextEvidenceHash(sha256),
    submittedAt,
    submittedAtLabel: formatTextEvidenceSubmittedAt(submittedAt)
  };
}

export function adaptTextEvidenceResponse(payload: unknown): TextEvidenceVM {
  return adaptTextEvidence(payload);
}

function academicProgram(
  value: unknown
): AcademicProgramSearchItemVM {
  const program = asRecord(value);

  return {
    programReference: requiredString(program.programReference),
    programCode: requiredString(program.programCode),
    programName: requiredString(program.programName),
    curriculumReference: requiredString(program.curriculumReference),
    curriculumCode: requiredString(program.curriculumCode)
  };
}

function curriculumAcademicSubject(
  value: unknown
): CurriculumAcademicSubjectSearchItemVM {
  const subject = asRecord(value);

  return {
    academicCourseReference: requiredString(
      subject.academicCourseReference
    ),
    code: requiredString(subject.code),
    name: requiredString(subject.name),
    description: nullableString(subject.description),
    hours: nullableString(subject.hours),
    programReference: requiredString(subject.programReference),
    programCode: requiredString(subject.programCode),
    programName: requiredString(subject.programName),
    curriculumReference: requiredString(subject.curriculumReference),
    curriculumCode: requiredString(subject.curriculumCode)
  };
}

export function adaptAcademicProgramSearch(
  payload: unknown
): AcademicProgramSearchItemVM[] {
  const response = asRecord(payload);

  if (!Array.isArray(response.items)) {
    throw new IncompatiblePayloadError();
  }

  return response.items.map(academicProgram);
}

export function adaptCurriculumAcademicSubjectSearch(
  payload: unknown
): CurriculumAcademicSubjectSearchItemVM[] {
  const response = asRecord(payload);

  if (!Array.isArray(response.items)) {
    throw new IncompatiblePayloadError();
  }

  return response.items.map(curriculumAcademicSubject);
}

const statusLabels: Record<CredentialStatus, string> = {
  draft: 'Borrador',
  issued: 'Emitida',
  revoked: 'Revocada'
};

export function adaptHolderResolution(payload: unknown): HolderSummaryVM {
  const holder = asRecord(payload);

  return {
    holderReference: requiredString(holder.id),
    email: requiredString(holder.email).toLowerCase(),
    did: nullableString(holder.did),
    displayLabel: requiredString(holder.displayLabel)
  };
}

export function adaptIssuerCredentialDetail(
  payload: unknown
): IssuerCredentialDetailVM {
  const credential = asRecord(payload);
  const status = credentialStatus(credential.status);
  const type = credentialType(credential.type);
  const credentialSubject = asRecord(credential.credentialSubject);
  const issuer = asRecord(credential.issuer);
  const holder = asRecord(credential.holder);
  const documentEvidence = asRecord(credential.documentEvidence);
  const textEvidence = asRecord(credential.textEvidence);
  const createdAt = isoDateTime(credential.createdAt);
  const updatedAt = isoDateTime(credential.updatedAt);
  const issuedAt = nullableIsoDateTime(credential.issuedAt);
  const canonicalHash = nullableString(credential.canonicalHash);

  if (canonicalHash !== null && !blockchainHashPattern.test(canonicalHash)) {
    throw new IncompatiblePayloadError();
  }

  return {
    credentialReference: requiredString(credential.id),
    title: requiredString(credential.title),
    description: nullableString(credential.description),
    hours: nullableString(credential.hours),
    type,
    typeLabel: credentialTypeLabels[type],
    status,
    statusLabel: statusLabels[status],
    issuer: {
      displayName: requiredString(issuer.displayName),
      did: nullableString(issuer.did)
    },
    credentialSubject: {
      achievementName: nullableString(
        credentialSubject.achievement_name
      ),
      institutionName: nullableString(
        credentialSubject.institution_name
      ),
      completionDate: nullableString(
        credentialSubject.completion_date
      ),
      academicPeriod: nullableString(
        credentialSubject.academic_period
      ),
      programName: nullableString(credentialSubject.program_name),
      grade: nullableString(credentialSubject.grade),
      providerName: nullableString(credentialSubject.provider_name),
      platformName: nullableString(credentialSubject.platform_name),
      modality: nullableString(credentialSubject.modality),
      level: nullableString(credentialSubject.level),
      certificationCode: nullableString(
        credentialSubject.certification_code
      ),
      expirationDate: nullableString(
        credentialSubject.expiration_date
      ),
      externalUrl: nullableString(credentialSubject.external_url),
      skills: stringArray(credentialSubject.skills),
      competencies: stringArray(credentialSubject.competencies),
      learningOutcomes: stringArray(
        credentialSubject.learning_outcomes
      )
    },
    holder: {
      displayLabel: requiredString(holder.displayLabel),
      email: nullableString(holder.email)?.toLowerCase() ?? null,
      did: nullableString(holder.did)
    },
    academicCourse:
      credential.academicCourse === null
        ? null
        : adaptDetailAcademicCourse(credential.academicCourse),
    documentEvidence: {
      currentDocument:
        documentEvidence.currentDocument === null
          ? null
          : adaptDocumentEvidence(documentEvidence.currentDocument)
    },
    textEvidence: {
      currentText:
        textEvidence.currentText === null
          ? null
          : adaptTextEvidence(textEvidence.currentText)
    },
    issuedAt,
    issuedAtLabel: issuedAt ? formatIntegrityDate(issuedAt) : null,
    canonicalHash,
    canonicalHashShort: canonicalHash
      ? abbreviateIntegrityReference(canonicalHash)
      : null,
    canonicalizationVersion: nullableString(
      credential.canonicalizationVersion
    ),
    blockchainEvidence:
      credential.blockchainEvidence === null
        ? null
        : adaptBlockchainEvidence(credential.blockchainEvidence),
    createdAt,
    updatedAt
  };
}

function adaptDetailAcademicCourse(
  value: unknown
): NonNullable<IssuerCredentialDetailVM['academicCourse']> {
  const course = asRecord(value);

  return {
    academicCourseReference: requiredString(
      course.academicCourseReference
    ),
    code: requiredString(course.code),
    name: requiredString(course.name),
    description: nullableString(course.description),
    hours: nullableString(course.hours),
    program:
      course.program === null ? null : academicProgram(course.program)
  };
}

export function adaptCreatedCredentialDraft(
  payload: unknown
): CreatedCredentialDraftVM {
  const credential = asRecord(payload);

  return {
    credentialReference: requiredString(credential.id),
    issuerReference: requiredString(credential.issuerId),
    status: credentialStatus(credential.status)
  };
}
