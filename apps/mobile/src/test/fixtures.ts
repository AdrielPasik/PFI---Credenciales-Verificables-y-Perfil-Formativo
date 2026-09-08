/**
 * Fixtures representativas de los contratos reales del titular.
 *
 * Están centralizadas a propósito: repetir payloads gigantes en veinte tests
 * garantiza que se desincronicen. Cada helper devuelve una copia nueva, así
 * un test puede mutarla sin contaminar a los demás.
 *
 * Incluye los casos límite que Holder Web ya tuvo que soportar en runtime
 * (sección 51 del encargo): 500 caracteres declarados, hashes y DIDs largos,
 * descriptores semánticos como objeto, evidencia opcional ausente y alias
 * vigente/histórico.
 */

export const LONG_TEXT_500 = `A${'a'.repeat(498)}Z`;
export const LONG_HASH = `0x${'a1b2c3d4'.repeat(8)}`;
export const LONG_DIGEST = 'f'.repeat(64);
export const LONG_DID =
  'did:web:credenciales.institucion-educativa-de-nombre-muy-largo.example.org:usuarios:0c8d1f2a-4b6e-4d7c-9a1b-2c3d4e5f6a7b';

export interface JsonObject {
  [key: string]: unknown;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function credentialSummaryPayload(
  overrides: JsonObject = {}
): JsonObject {
  return {
    id: 'cred-001',
    title: 'Sistemas Operativos',
    type: 'academic_subject',
    status: 'issued',
    issuerName: 'Universidad Nacional Ejemplo',
    issuedAt: '2026-03-14T10:00:00.000Z',
    hasIntegrityEvidence: true,
    hasAnalysis: true,
    ...overrides
  };
}

export function credentialListPayload(): JsonObject[] {
  return [
    credentialSummaryPayload(),
    credentialSummaryPayload({
      id: 'cred-002',
      title: 'Introducción a Redes',
      type: 'course',
      status: 'revoked',
      issuedAt: '2025-11-02T10:00:00.000Z',
      hasIntegrityEvidence: false,
      hasAnalysis: false
    }),
    credentialSummaryPayload({
      id: 'cred-003',
      title: 'Certificación en Ciberseguridad',
      type: 'certification',
      issuedAt: null
    }),
    credentialSummaryPayload({
      id: 'cred-004',
      title: 'Licenciatura en Sistemas',
      type: 'degree'
    })
  ];
}

export function credentialDetailPayload(
  overrides: JsonObject = {}
): JsonObject {
  return clone({
    id: 'cred-001',
    type: 'academic_subject',
    title: 'Sistemas Operativos',
    description: 'Asignatura troncal del ciclo superior.',
    hours: 96,
    status: 'issued',
    issuer: {
      name: 'Universidad Nacional Ejemplo',
      did: LONG_DID
    },
    subject: {
      did: 'did:web:scope.example.org:usuarios:holder-1',
      email: 'Titular@Example.com',
      displayName: 'Ada Lovelace',
      displayLabel: 'Ada Lovelace'
    },
    issuedAt: '2026-03-14T10:00:00.000Z',
    revokedAt: null,
    revocationReason: null,
    canonicalHash: LONG_HASH,
    canonicalizationVersion: 'canon_v1',
    credentialSubject: {
      achievementName: 'Sistemas Operativos',
      institutionName: 'Universidad Nacional Ejemplo',
      completionDate: '2026-02-28',
      academicPeriod: '2025 - 2do cuatrimestre',
      programName: 'Licenciatura en Sistemas',
      grade: '9',
      providerName: null,
      platformName: null,
      modality: null,
      level: 'Grado',
      externalUrl: null,
      skills: ['Administración de sistemas'],
      competencies: [LONG_TEXT_500],
      learningOutcomes: [LONG_TEXT_500, 'Comprende la gestión de memoria.']
    },
    documentEvidence: {
      originalFileName: 'programa-sistemas-operativos.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 254_113,
      sha256: LONG_DIGEST,
      uploadedAt: '2026-03-10T09:30:00.000Z'
    },
    textEvidence: {
      label: 'Programa de la asignatura',
      preview: 'Contenidos mínimos aprobados por el consejo académico.',
      characterCount: 1820,
      sha256: LONG_DIGEST,
      submittedAt: '2026-03-11T09:30:00.000Z'
    },
    blockchainRecords: [
      {
        network: 'sepolia',
        chainId: 11_155_111,
        txHash: LONG_HASH,
        status: 'confirmed',
        registeredAt: '2026-03-14T10:05:00.000Z',
        revokedAt: null
      }
    ],
    latestSemanticAnalysis: {
      status: 'partial',
      confidence: 0.62,
      areas: ['Infraestructura'],
      skills: ['Administración de sistemas'],
      concepts: ['Planificación de procesos', 'Gestión de memoria'],
      qualityFlags: ['low_evidence'],
      analyzedAt: '2026-03-15T12:00:00.000Z'
    },
    ...overrides
  });
}

/**
 * Variante "tortura": descriptores semánticos como objeto, alias históricos
 * en `credentialSubject` y toda la evidencia opcional ausente (no `null`:
 * directamente ausente del payload).
 */
export function credentialDetailTorturePayload(): JsonObject {
  const payload = credentialDetailPayload({
    credentialSubject: {
      achievement_name: 'Introducción a Redes',
      institution_name: 'Instituto Ejemplo',
      completion_date: '2025-10-30',
      academic_period: '2025',
      program_name: 'Tecnicatura en Redes',
      grade: null,
      provider_name: 'Proveedor Ejemplo',
      platform_name: 'Plataforma Ejemplo',
      modality: 'Virtual',
      level: null,
      external_url: 'https://cursos.example.org/redes',
      skills: ['Se ignora en cursos'],
      competencies: [LONG_TEXT_500],
      learning_outcomes: [LONG_TEXT_500]
    },
    type: 'course',
    latestSemanticAnalysis: {
      status: 'completed',
      confidence: null,
      areas: [{ area: 'Redes de computadoras' }],
      skills: [{ skill_label: 'Configuración de routers' }],
      concepts: [{ name: 'Modelo OSI' }, 'Direccionamiento IP'],
      qualityFlags: [],
      analyzedAt: '2025-11-01T12:00:00.000Z'
    }
  });

  delete payload.documentEvidence;
  delete payload.textEvidence;

  return payload;
}

export function currentProfilePayload(
  overrides: JsonObject = {}
): JsonObject {
  return clone({
    currentProfile: {
      profileVersion: 'formative_profile_v1',
      credentialsCount: 4,
      totalHours: 240,
      totalOfficialHours: 240,
      credentialsWithoutHours: 1,
      credentialsWithoutSemanticCoverage: 2,
      credentialsWithReviewedInterpretation: 1,
      narrative:
        'Tu trayectoria combina fundamentos de infraestructura con práctica en redes.',
      areas: [
        {
          label: 'Infraestructura',
          estimatedHours: 120,
          provenanceSummary: { issuerReviewedCount: 1, aiInferredCount: 2 }
        },
        {
          label: 'Redes de computadoras',
          estimatedHours: null,
          provenanceSummary: null
        }
      ],
      skills: [
        {
          label: 'Administración de sistemas',
          confidence: 0.71,
          provenanceSummary: { issuerReviewedCount: 0, aiInferredCount: 1 }
        }
      ],
      concepts: ['Planificación de procesos', 'Modelo OSI'],
      emittedSkills: ['Administración de sistemas'],
      emittedCompetencies: [LONG_TEXT_500],
      emittedLearningOutcomes: [LONG_TEXT_500],
      confidence: 0.66,
      qualityFlags: ['low_evidence'],
      generatedAt: '2026-03-16T08:00:00.000Z',
      ...overrides
    }
  });
}

/**
 * Perfil generado por una versión anterior del backend: sin
 * `totalOfficialHours`, sin contadores de cobertura, con `areasSummary` /
 * `skillsSummary` y con narrativa y conceptos dentro de `profileJson`.
 */
export function legacyProfilePayload(): JsonObject {
  return clone({
    currentProfile: {
      profileVersion: 'formative_profile_v0',
      credentialsCount: 2,
      totalHours: 80,
      areasSummary: [{ name: 'Infraestructura', estimatedHours: 80 }],
      skillsSummary: [{ skill: 'Administración de sistemas', confidence: 0.5 }],
      qualityFlags: [],
      generatedAt: '2025-06-01T08:00:00.000Z',
      profileJson: {
        narrative: 'Perfil generado por una versión anterior.',
        concepts: [{ concept: 'Sistemas operativos' }],
        emittedCompetencies: [{ label: LONG_TEXT_500 }],
        confidence: { score: 0.4 }
      }
    }
  });
}

export function loginResponsePayload(overrides: JsonObject = {}): JsonObject {
  return {
    accessToken: 'header.payload.signature',
    user: {
      id: 'user-1',
      email: 'titular@example.com',
      did: 'did:web:scope.example.org:usuarios:holder-1',
      displayLabel: 'Ada Lovelace',
      status: 'active'
    },
    ...overrides
  };
}

export function currentUserPayload(overrides: JsonObject = {}): JsonObject {
  return {
    id: 'user-1',
    email: 'titular@example.com',
    did: 'did:web:scope.example.org:usuarios:holder-1',
    displayLabel: 'Ada Lovelace',
    status: 'active',
    issuerMemberships: [],
    ...overrides
  };
}

export function profileSharePayload(overrides: JsonObject = {}): JsonObject {
  return {
    sharePath: `/share/profile/${'t'.repeat(43)}`,
    expiresAt: '2026-04-16T08:00:00.000Z',
    ...overrides
  };
}
