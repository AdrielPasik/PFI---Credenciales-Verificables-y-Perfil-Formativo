import assert from 'node:assert/strict';
import test from 'node:test';

import { CredentialType } from '@prisma/client';

import { FormativeProfileService } from './formative-profile.service';

function decimalLike(value: string) {
  return {
    toString() {
      return value;
    }
  };
}

function persistedProfile(overrides?: Record<string, unknown>) {
  return {
    id: 'profile-1',
    schemaVersion: 'formative_profile_v1',
    userId: 'holder-1',
    generatedAt: new Date('2026-07-24T12:00:00.000Z'),
    credentialsCount: 1,
    totalHours: decimalLike('64.00'),
    profileVersion: 'backend_formative_profile_snapshot_v0',
    isCurrent: true,
    generationMethod: 'backend_deterministic_aggregation_v0',
    areasSummary: [],
    skillsSummary: [],
    evidenceByArea: [],
    qualityFlags: [],
    profileJson: {
      summary: {
        totalHours: 64
      }
    },
    ...overrides
  };
}

test('FormativeProfileService returns null when no current profile exists', async () => {
  const findFirstCalls: Array<Record<string, unknown>> = [];
  const service = new FormativeProfileService({
    formativeProfile: {
      async findFirst(args: Record<string, unknown>) {
        findFirstCalls.push(args);
        return null;
      }
    }
  } as never);

  const response = await service.getCurrentForUser('holder-1');

  assert.deepEqual(findFirstCalls, [
    {
      where: {
        userId: 'holder-1',
        isCurrent: true
      },
      orderBy: [
        {
          generatedAt: 'desc'
        },
        {
          id: 'desc'
        }
      ]
    }
  ]);
  assert.deepEqual(response, {
    userId: 'holder-1',
    currentProfile: null
  });
});

test('FormativeProfileService returns the current persisted profile', async () => {
  const service = new FormativeProfileService({
    formativeProfile: {
      async findFirst() {
        return persistedProfile();
      }
    }
  } as never);

  const response = await service.getCurrentForUser('holder-1');

  assert.equal(response.currentProfile?.id, 'profile-1');
  assert.equal(
    response.currentProfile?.profileVersion,
    'backend_formative_profile_snapshot_v0'
  );
  assert.equal(response.currentProfile?.totalHours, 64);
});

test('FormativeProfileService rebuilds a deterministic profile from latest semantic analyses', async () => {
  const findManyCalls: Array<Record<string, unknown>> = [];
  const updateManyCalls: Array<Record<string, unknown>> = [];
  const createCalls: Array<Record<string, unknown>> = [];
  const transactionOptions: Array<Record<string, unknown>> = [];

  const credentials = [
    {
      id: 'credential-1',
      type: CredentialType.academic_subject,
      hours: decimalLike('40.00'),
      credentialSubject: {
        skills: ['Python'],
        competencies: ['Trabajo en equipo']
      },
      semanticAnalyses: [
        {
          id: 'analysis-1',
          analyzedAt: new Date('2026-07-22T10:00:00Z'),
          confidence: decimalLike('0.8000'),
          areas: [
            {
              id: 'area_data',
              label: 'Data Engineering'
            }
          ],
          skills: [
            {
              label: 'SQL',
              confidence: 0.8
            }
          ],
          concepts: ['Normalization'],
          analysisJson: {
            sourceType: 'academic_pdf',
            hoursDistribution: [
              {
                areaId: 'area_data',
                hours: 30
              }
            ]
          }
        }
      ]
    },
    {
      id: 'credential-2',
      type: CredentialType.certification,
      hours: decimalLike('20.00'),
      semanticAnalyses: [
        {
          id: 'analysis-2',
          analyzedAt: new Date('2026-07-23T10:00:00Z'),
          confidence: decimalLike('1.0000'),
          areas: ['Data Engineering'],
          skills: [
            {
              skill: 'SQL',
              confidence: 1
            }
          ],
          concepts: [
            {
              concept: 'Normalization'
            }
          ],
          analysisJson: {
            sourceType: 'online_course_catalog'
          }
        }
      ]
    },
    {
      id: 'credential-3',
      type: CredentialType.certification,
      hours: null,
      credentialSubject: {
        skills: ['Excel'],
        learning_outcomes: ['Aplicar principios de gestión']
      },
      semanticAnalyses: []
    }
  ];

  const service = new FormativeProfileService({
    credential: {
      async findMany(args: Record<string, unknown>) {
        findManyCalls.push(args);
        return credentials;
      }
    },
    async $transaction(
      callback: (transaction: {
        formativeProfile: {
          updateMany(args: Record<string, unknown>): Promise<unknown>;
          create(args: Record<string, unknown>): Promise<unknown>;
        };
      }) => Promise<unknown>,
      options: Record<string, unknown>
    ) {
      transactionOptions.push(options);
      return callback({
        formativeProfile: {
          async updateMany(args: Record<string, unknown>) {
            updateManyCalls.push(args);
            return {
              count: 1
            };
          },
          async create(args: Record<string, unknown>) {
            createCalls.push(args);
            const data = args.data as Record<string, unknown>;
            return persistedProfile({
              generatedAt: data.generatedAt,
              credentialsCount: data.credentialsCount,
              totalHours: data.totalHours,
              areasSummary: data.areasSummary,
              skillsSummary: data.skillsSummary,
              evidenceByArea: data.evidenceByArea,
              qualityFlags: data.qualityFlags,
              profileJson: data.profileJson
            });
          }
        }
      });
    }
  } as never);

  const response = await service.rebuildForUser('holder-1');

  assert.deepEqual(findManyCalls, [
    {
      where: {
        subjectUserId: 'holder-1',
        status: 'issued'
      },
      select: {
        id: true,
        type: true,
        hours: true,
        credentialSubject: true,
        semanticAnalyses: {
          orderBy: [
            {
              analyzedAt: 'desc'
            },
            {
              id: 'desc'
            }
          ],
          take: 1,
          select: {
            id: true,
            analyzedAt: true,
            confidence: true,
            areas: true,
            skills: true,
            concepts: true,
            analysisJson: true
          }
        }
      },
      orderBy: {
        id: 'asc'
      }
    }
  ]);
  assert.deepEqual(updateManyCalls, [
    {
      where: {
        userId: 'holder-1',
        isCurrent: true
      },
      data: {
        isCurrent: false
      }
    }
  ]);
  assert.equal(createCalls.length, 1);
  assert.equal(transactionOptions[0].isolationLevel, 'Serializable');

  const createData = createCalls[0].data as Record<string, unknown>;
  const profileJson = createData.profileJson as {
    generatedFrom: {
      credentialIds: string[];
      semanticAnalysisIds: string[];
    };
    summary: {
      credentialsCount: number;
      analyzedCredentialsCount: number;
      totalHours: number | null;
      totalOfficialHours: number | null;
      credentialsWithoutHours: number;
      credentialsWithoutSemanticCoverage: number;
    };
    narrative: string | null;
    areas: Array<Record<string, unknown>>;
    skills: Array<Record<string, unknown>>;
    concepts: Array<Record<string, unknown>>;
    emittedSkills: Array<Record<string, unknown>>;
    emittedCompetencies: Array<Record<string, unknown>>;
    emittedLearningOutcomes: Array<Record<string, unknown>>;
    confidence: Record<string, unknown>;
    warnings: string[];
  };

  assert.deepEqual(profileJson.generatedFrom, {
    credentialIds: ['credential-1', 'credential-2', 'credential-3'],
    semanticAnalysisIds: ['analysis-1', 'analysis-2']
  });
  assert.deepEqual(profileJson.summary, {
    credentialsCount: 3,
    analyzedCredentialsCount: 2,
    totalHours: 60,
    totalOfficialHours: 60,
    // credential-3 no tiene hours declaradas y no tiene SemanticAnalysis.
    credentialsWithoutHours: 1,
    credentialsWithoutSemanticCoverage: 1
  });
  assert.match(
    profileJson.narrative as string,
    /^Segun las credenciales emitidas y los analisis disponibles/
  );
  assert.match(profileJson.narrative as string, /Data Engineering/);
  assert.match(profileJson.narrative as string, /cobertura semantica todavia es parcial/);
  assert.doesNotMatch(profileJson.narrative as string, /domina|experto|garantiza|certifica|apto para|nivel profesional/i);
  assert.deepEqual(profileJson.areas, [
    {
      area: 'Data Engineering',
      credentialIds: ['credential-1', 'credential-2'],
      semanticAnalysisIds: ['analysis-1', 'analysis-2'],
      evidenceCount: 2,
      estimatedHours: 30
    }
  ]);
  assert.deepEqual(profileJson.skills, [
    {
      skill: 'SQL',
      credentialIds: ['credential-1', 'credential-2'],
      semanticAnalysisIds: ['analysis-1', 'analysis-2'],
      evidenceCount: 2,
      confidence: 0.9
    }
  ]);
  assert.deepEqual(profileJson.concepts, [
    {
      concept: 'Normalization',
      credentialIds: ['credential-1', 'credential-2'],
      semanticAnalysisIds: ['analysis-1', 'analysis-2'],
      evidenceCount: 2
    }
  ]);
  assert.deepEqual(profileJson.confidence, {
    score: 0.9,
    method: 'derived'
  });
  assert.deepEqual(profileJson.warnings, [
    'area_hours_are_estimated_not_emitted',
    'credential_without_semantic_analysis',
    'credential_without_semantic_analysis_has_emitted_data',
    'online_course_catalog_not_completion_evidence',
    'profile_partially_built'
  ]);
  assert.equal(
    profileJson.skills.some((skill) => skill.skill === 'invented-skill'),
    false
  );

  // credential-3 no tiene SemanticAnalysis, pero SI tiene
  // credentialSubject.skills/.learning_outcomes: debe aportar al perfil via
  // los arrays "emitted*", nunca mezclado con "skills" (inferido por IA).
  assert.deepEqual(profileJson.emittedSkills, [
    { label: 'Excel', credentialIds: ['credential-3'], evidenceCount: 1 },
    { label: 'Python', credentialIds: ['credential-1'], evidenceCount: 1 }
  ]);
  assert.deepEqual(profileJson.emittedCompetencies, [
    {
      label: 'Trabajo en equipo',
      credentialIds: ['credential-1'],
      evidenceCount: 1
    }
  ]);
  assert.deepEqual(profileJson.emittedLearningOutcomes, [
    {
      label: 'Aplicar principios de gestión',
      credentialIds: ['credential-3'],
      evidenceCount: 1
    }
  ]);
  for (const emittedSkill of profileJson.emittedSkills) {
    assert.equal(
      'confidence' in emittedSkill,
      false,
      'emitted skills must never carry a fabricated confidence value'
    );
  }
  assert.equal(response.currentProfile?.isCurrent, true);
  assert.equal(response.currentProfile?.totalHours, 60);
});

test('FormativeProfileService keeps skills empty (inferred) but still populates emitted arrays when no credential has SemanticAnalysis', async () => {
  const createCalls: Array<Record<string, unknown>> = [];
  const credentials = [
    {
      id: 'credential-1',
      type: CredentialType.certification,
      hours: decimalLike('12.00'),
      credentialSubject: {
        skills: ['Excel', 'excel'],
        competencies: ['Comunicación efectiva']
      },
      semanticAnalyses: []
    }
  ];

  const service = new FormativeProfileService({
    credential: {
      async findMany() {
        return credentials;
      }
    },
    async $transaction(
      callback: (transaction: {
        formativeProfile: {
          updateMany(): Promise<unknown>;
          create(args: Record<string, unknown>): Promise<unknown>;
        };
      }) => Promise<unknown>
    ) {
      return callback({
        formativeProfile: {
          async updateMany() {
            return { count: 0 };
          },
          async create(args: Record<string, unknown>) {
            createCalls.push(args);
            const data = args.data as Record<string, unknown>;
            return persistedProfile({
              generatedAt: data.generatedAt,
              credentialsCount: data.credentialsCount,
              totalHours: data.totalHours,
              qualityFlags: data.qualityFlags,
              profileJson: data.profileJson
            });
          }
        }
      });
    }
  } as never);

  await service.rebuildForUser('holder-1');
  const createData = createCalls[0].data as Record<string, unknown>;
  const profileJson = createData.profileJson as {
    skills: unknown[];
    emittedSkills: Array<Record<string, unknown>>;
    emittedCompetencies: Array<Record<string, unknown>>;
    warnings: string[];
  };

  // "Excel" y "excel" cargados dos veces en el mismo draft no deben
  // duplicarse en el perfil (misma normalizacion que el resto de accumulators).
  assert.deepEqual(profileJson.emittedSkills, [
    { label: 'Excel', credentialIds: ['credential-1'], evidenceCount: 1 }
  ]);
  assert.deepEqual(profileJson.emittedCompetencies, [
    {
      label: 'Comunicación efectiva',
      credentialIds: ['credential-1'],
      evidenceCount: 1
    }
  ]);
  // El perfil "no queda vacio": aunque no hay SemanticAnalysis, hay senal
  // emitida. skills (inferido) SI queda vacio -- no se inventa una senal IA.
  assert.deepEqual(profileJson.skills, []);
  assert.ok(profileJson.warnings.includes('credential_without_semantic_analysis'));
  assert.ok(
    profileJson.warnings.includes(
      'credential_without_semantic_analysis_has_emitted_data'
    )
  );
  assert.ok(!profileJson.warnings.includes('no_emitted_skills_available'));
});

test('FormativeProfileService ignores legacy course skills while preserving declared course evidence and inferred skills', async () => {
  const createCalls: Array<Record<string, unknown>> = [];
  const credentials = [
    {
      id: 'course-legacy-1',
      type: CredentialType.course,
      hours: decimalLike('10.00'),
      credentialSubject: {
        skills: ['Programming & Development'],
        competencies: ['Desarrollo de aplicaciones con Python'],
        learning_outcomes: ['Crear aplicaciones y juegos simples con Python']
      },
      semanticAnalyses: [
        {
          id: 'analysis-course-1',
          analyzedAt: new Date('2026-08-10T12:00:00Z'),
          confidence: decimalLike('0.8000'),
          areas: [],
          skills: [{ label: 'Python', confidence: 0.8 }],
          concepts: [],
          analysisJson: {}
        }
      ]
    }
  ];

  const service = new FormativeProfileService({
    credential: {
      async findMany() {
        return credentials;
      }
    },
    async $transaction(
      callback: (transaction: {
        formativeProfile: {
          updateMany(): Promise<unknown>;
          create(args: Record<string, unknown>): Promise<unknown>;
        };
      }) => Promise<unknown>
    ) {
      return callback({
        formativeProfile: {
          async updateMany() {
            return { count: 0 };
          },
          async create(args: Record<string, unknown>) {
            createCalls.push(args);
            const data = args.data as Record<string, unknown>;
            return persistedProfile({
              generatedAt: data.generatedAt,
              credentialsCount: data.credentialsCount,
              totalHours: data.totalHours,
              qualityFlags: data.qualityFlags,
              profileJson: data.profileJson
            });
          }
        }
      });
    }
  } as never);

  await service.rebuildForUser('holder-1');
  const profileJson = (createCalls[0].data as {
    profileJson: {
      skills: Array<Record<string, unknown>>;
      emittedSkills: Array<Record<string, unknown>>;
      emittedCompetencies: Array<Record<string, unknown>>;
      emittedLearningOutcomes: Array<Record<string, unknown>>;
    };
  }).profileJson;

  const emittedSkills = profileJson.emittedSkills;
  assert.equal(
    emittedSkills.some(
      (entry) => entry.label === 'Programming & Development'
    ),
    false
  );
  assert.deepEqual(emittedSkills, []);
  assert.deepEqual(profileJson.emittedCompetencies, [
    {
      label: 'Desarrollo de aplicaciones con Python',
      credentialIds: ['course-legacy-1'],
      evidenceCount: 1
    }
  ]);
  assert.deepEqual(profileJson.emittedLearningOutcomes, [
    {
      label: 'Crear aplicaciones y juegos simples con Python',
      credentialIds: ['course-legacy-1'],
      evidenceCount: 1
    }
  ]);
  assert.deepEqual(profileJson.skills, [
    {
      skill: 'Python',
      credentialIds: ['course-legacy-1'],
      semanticAnalysisIds: ['analysis-course-1'],
      evidenceCount: 1,
      confidence: 0.8
    }
  ]);
});

test('FormativeProfileService flags no_emitted_skills_available when neither analysis nor emitted data exist', async () => {
  const createCalls: Array<Record<string, unknown>> = [];
  const credentials = [
    {
      id: 'credential-1',
      type: CredentialType.course,
      hours: null,
      credentialSubject: {},
      semanticAnalyses: []
    }
  ];

  const service = new FormativeProfileService({
    credential: {
      async findMany() {
        return credentials;
      }
    },
    async $transaction(
      callback: (transaction: {
        formativeProfile: {
          updateMany(): Promise<unknown>;
          create(args: Record<string, unknown>): Promise<unknown>;
        };
      }) => Promise<unknown>
    ) {
      return callback({
        formativeProfile: {
          async updateMany() {
            return { count: 0 };
          },
          async create(args: Record<string, unknown>) {
            createCalls.push(args);
            const data = args.data as Record<string, unknown>;
            return persistedProfile({
              generatedAt: data.generatedAt,
              credentialsCount: data.credentialsCount,
              totalHours: data.totalHours,
              qualityFlags: data.qualityFlags,
              profileJson: data.profileJson
            });
          }
        }
      });
    }
  } as never);

  await service.rebuildForUser('holder-1');
  const createData = createCalls[0].data as Record<string, unknown>;
  const profileJson = createData.profileJson as { warnings: string[] };

  assert.ok(profileJson.warnings.includes('no_emitted_skills_available'));
  assert.ok(profileJson.warnings.includes('total_hours_unavailable'));
  assert.ok(
    !profileJson.warnings.includes(
      'credential_without_semantic_analysis_has_emitted_data'
    )
  );
});

test('FormativeProfileService persists a valid empty snapshot when no issued credentials exist', async () => {
  const createCalls: Array<Record<string, unknown>> = [];
  const service = new FormativeProfileService({
    credential: {
      async findMany() {
        return [];
      }
    },
    async $transaction(
      callback: (transaction: {
        formativeProfile: {
          updateMany(): Promise<unknown>;
          create(args: Record<string, unknown>): Promise<unknown>;
        };
      }) => Promise<unknown>
    ) {
      return callback({
        formativeProfile: {
          async updateMany() {
            return {
              count: 0
            };
          },
          async create(args: Record<string, unknown>) {
            createCalls.push(args);
            const data = args.data as Record<string, unknown>;
            return persistedProfile({
              generatedAt: data.generatedAt,
              credentialsCount: 0,
              totalHours: data.totalHours,
              areasSummary: [],
              skillsSummary: [],
              qualityFlags: data.qualityFlags,
              profileJson: data.profileJson
            });
          }
        }
      });
    }
  } as never);

  const response = await service.rebuildForUser('holder-1');
  const createData = createCalls[0].data as Record<string, unknown>;
  const profileJson = createData.profileJson as {
    summary: Record<string, unknown>;
    narrative: string | null;
    warnings: string[];
  };

  assert.deepEqual(profileJson.summary, {
    credentialsCount: 0,
    analyzedCredentialsCount: 0,
    totalHours: null,
    totalOfficialHours: null,
    credentialsWithoutHours: 0,
    credentialsWithoutSemanticCoverage: 0
  });
  assert.equal(profileJson.narrative, null);
  assert.deepEqual(profileJson.warnings, [
    'confidence_not_available',
    'no_issued_credentials',
    'no_skills_detected'
  ]);
  assert.equal(response.currentProfile?.totalHours, null);
});

// ─── C2c: totalOfficialHours, credentialsWithoutHours, credentialsWithoutSemanticCoverage ───

test('C2c: rebuildForUser never selects Credential.title/achievementName -- area/skill/concept labels can only come from SemanticAnalysis or credentialSubject, never from the credential name', async () => {
  const findManyCalls: Array<Record<string, unknown>> = [];
  const service = new FormativeProfileService({
    credential: {
      async findMany(args: Record<string, unknown>) {
        findManyCalls.push(args);
        return [];
      }
    },
    async $transaction(
      callback: (transaction: {
        formativeProfile: {
          updateMany(): Promise<unknown>;
          create(args: Record<string, unknown>): Promise<unknown>;
        };
      }) => Promise<unknown>
    ) {
      return callback({
        formativeProfile: {
          async updateMany() {
            return { count: 0 };
          },
          async create(args: Record<string, unknown>) {
            const data = args.data as Record<string, unknown>;
            return persistedProfile({ profileJson: data.profileJson });
          }
        }
      });
    }
  } as never);

  await service.rebuildForUser('holder-1');

  const select = (findManyCalls[0] as { select: Record<string, unknown> }).select;
  assert.equal('title' in select, false);
  assert.equal('achievementName' in select, false);
});

test('C2c: a course credential named after an area-like title does not turn that title into an area/skill', async () => {
  const createCalls: Array<Record<string, unknown>> = [];
  const credentials = [
    {
      id: 'course-1',
      type: CredentialType.course,
      hours: decimalLike('36.00'),
      credentialSubject: {},
      // El nombre de la credencial (fuera de este objeto, ni siquiera se
      // selecciona -- ver test anterior) es "Algoritmos y Estructuras de
      // Datos". La unica fuente real de areas/skills es SemanticAnalysis.
      semanticAnalyses: [
        {
          id: 'analysis-course-1',
          analyzedAt: new Date('2026-08-10T12:00:00Z'),
          confidence: decimalLike('0.4500'),
          areas: [],
          skills: [{ label: 'Python', confidence: 0.45 }],
          concepts: [],
          analysisJson: { sourceType: 'text' }
        }
      ]
    }
  ];

  const service = new FormativeProfileService({
    credential: {
      async findMany() {
        return credentials;
      }
    },
    async $transaction(
      callback: (transaction: {
        formativeProfile: {
          updateMany(): Promise<unknown>;
          create(args: Record<string, unknown>): Promise<unknown>;
        };
      }) => Promise<unknown>
    ) {
      return callback({
        formativeProfile: {
          async updateMany() {
            return { count: 0 };
          },
          async create(args: Record<string, unknown>) {
            createCalls.push(args);
            const data = args.data as Record<string, unknown>;
            return persistedProfile({ profileJson: data.profileJson });
          }
        }
      });
    }
  } as never);

  await service.rebuildForUser('holder-1');
  const profileJson = (createCalls[0].data as {
    profileJson: {
      areas: Array<Record<string, unknown>>;
      skills: Array<Record<string, unknown>>;
    };
  }).profileJson;

  assert.deepEqual(profileJson.areas, []);
  assert.equal(
    profileJson.skills.some(
      (skill) => skill.skill === 'Algoritmos y Estructuras de Datos'
    ),
    false
  );
  assert.deepEqual(
    profileJson.skills.map((skill) => skill.skill),
    ['Python']
  );
});

test('C2c: a course analyzed from text conserves official hours separately from estimated hours when the artifact has no hoursDistribution', async () => {
  const createCalls: Array<Record<string, unknown>> = [];
  const credentials = [
    {
      id: 'course-text-1',
      type: CredentialType.course,
      hours: decimalLike('22.00'),
      credentialSubject: {},
      semanticAnalyses: [
        {
          id: 'analysis-text-1',
          analyzedAt: new Date('2026-08-10T12:00:00Z'),
          confidence: decimalLike('0.4500'),
          areas: [],
          skills: [{ label: 'Python', confidence: 0.45 }],
          concepts: [],
          // C2b.1/C2b.2: texto corto sin evidencia fuerte de area -> el AI
          // Service no envia hoursDistribution en absoluto.
          analysisJson: { sourceType: 'text' }
        }
      ]
    }
  ];

  const service = new FormativeProfileService({
    credential: {
      async findMany() {
        return credentials;
      }
    },
    async $transaction(
      callback: (transaction: {
        formativeProfile: {
          updateMany(): Promise<unknown>;
          create(args: Record<string, unknown>): Promise<unknown>;
        };
      }) => Promise<unknown>
    ) {
      return callback({
        formativeProfile: {
          async updateMany() {
            return { count: 0 };
          },
          async create(args: Record<string, unknown>) {
            createCalls.push(args);
            const data = args.data as Record<string, unknown>;
            return persistedProfile({
              totalHours: data.totalHours,
              profileJson: data.profileJson
            });
          }
        }
      });
    }
  } as never);

  const response = await service.rebuildForUser('holder-1');
  const profileJson = (createCalls[0].data as {
    profileJson: {
      summary: Record<string, unknown>;
      areas: Array<Record<string, unknown>>;
    };
  }).profileJson;

  assert.deepEqual(profileJson.summary, {
    credentialsCount: 1,
    analyzedCredentialsCount: 1,
    totalHours: 22,
    totalOfficialHours: 22,
    credentialsWithoutHours: 0,
    credentialsWithoutSemanticCoverage: 0
  });
  // Sin hoursDistribution en el artifact, no hay areas con estimatedHours --
  // nunca se inventa una distribucion a partir de las 22 horas oficiales.
  assert.deepEqual(profileJson.areas, []);
  assert.equal(response.currentProfile?.totalHours, 22);
});

test('C2c: credentialsWithoutHours counts credentials with hours === null, regardless of analysis coverage', async () => {
  const createCalls: Array<Record<string, unknown>> = [];
  const credentials = [
    {
      id: 'credential-with-hours',
      type: CredentialType.certification,
      hours: decimalLike('10.00'),
      credentialSubject: {},
      semanticAnalyses: []
    },
    {
      id: 'credential-without-hours-a',
      type: CredentialType.certification,
      hours: null,
      credentialSubject: {},
      semanticAnalyses: [
        {
          id: 'analysis-b',
          analyzedAt: new Date('2026-08-10T12:00:00Z'),
          confidence: decimalLike('0.9000'),
          areas: [],
          skills: [],
          concepts: [],
          analysisJson: {}
        }
      ]
    },
    {
      id: 'credential-without-hours-b',
      type: CredentialType.certification,
      hours: null,
      credentialSubject: {},
      semanticAnalyses: []
    }
  ];

  const service = new FormativeProfileService({
    credential: {
      async findMany() {
        return credentials;
      }
    },
    async $transaction(
      callback: (transaction: {
        formativeProfile: {
          updateMany(): Promise<unknown>;
          create(args: Record<string, unknown>): Promise<unknown>;
        };
      }) => Promise<unknown>
    ) {
      return callback({
        formativeProfile: {
          async updateMany() {
            return { count: 0 };
          },
          async create(args: Record<string, unknown>) {
            createCalls.push(args);
            const data = args.data as Record<string, unknown>;
            return persistedProfile({ profileJson: data.profileJson });
          }
        }
      });
    }
  } as never);

  await service.rebuildForUser('holder-1');
  const profileJson = (createCalls[0].data as {
    profileJson: { summary: Record<string, unknown> };
  }).profileJson;

  assert.equal(profileJson.summary.credentialsWithoutHours, 2);
  // credential-without-hours-a SI tiene SemanticAnalysis; credential-with-hours
  // y credential-without-hours-b no tienen ninguna -- dos credenciales sin
  // cobertura semantica, independientemente de si tienen horas o no (los
  // dos contadores son independientes entre si).
  assert.equal(profileJson.summary.credentialsWithoutSemanticCoverage, 2);
});
