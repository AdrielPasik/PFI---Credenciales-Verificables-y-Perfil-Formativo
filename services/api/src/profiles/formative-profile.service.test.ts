import assert from 'node:assert/strict';
import test from 'node:test';

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
    profileVersion: 'formative_profile_result_v0',
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
    'formative_profile_result_v0'
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
      hours: decimalLike('40.00'),
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
      hours: null,
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
        hours: true,
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
    };
    areas: Array<Record<string, unknown>>;
    skills: Array<Record<string, unknown>>;
    concepts: Array<Record<string, unknown>>;
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
    totalHours: 60
  });
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
    'credential_without_semantic_analysis',
    'online_course_catalog_not_completion_evidence'
  ]);
  assert.equal(
    profileJson.skills.some((skill) => skill.skill === 'invented-skill'),
    false
  );
  assert.equal(response.currentProfile?.isCurrent, true);
  assert.equal(response.currentProfile?.totalHours, 60);
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
    warnings: string[];
  };

  assert.deepEqual(profileJson.summary, {
    credentialsCount: 0,
    analyzedCredentialsCount: 0,
    totalHours: null
  });
  assert.deepEqual(profileJson.warnings, [
    'confidence_not_available',
    'no_issued_credentials',
    'no_skills_detected'
  ]);
  assert.equal(response.currentProfile?.totalHours, null);
});
