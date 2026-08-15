import assert from 'node:assert/strict';
import test from 'node:test';

import { CredentialType } from '@prisma/client';

import { FormativeProfileService } from './formative-profile.service';

// C5b.1: suite focalizada -- consumo de una interpretacion semantica
// reutilizable aplicada (CredentialReusableSemanticInterpretation active)
// como fuente semantica del FormativeProfile, con prioridad
// issuer_reviewed > ai_inferred > ninguna, aplicada POR Credential (nunca
// global). Reutiliza el mismo patron de fake-Prisma que
// formative-profile.service.test.ts -- sin mocking library, sin DB real.

function decimalLike(value: string) {
  return {
    toString() {
      return value;
    }
  };
}

function approvedSnapshotV2(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'approved_template_semantic_snapshot_v2',
    semanticAnalysisSchema: 'semantic_analysis_v1',
    sourceSemanticAnalysisId: 'source-analysis-histórico',
    status: 'completed',
    originalSummary: {
      schema: 'approved_template_semantic_snapshot_v1',
      status: 'completed',
      areaCount: 1,
      skillCount: 1,
      conceptCount: 1,
      hasHoursDistribution: true,
      warningCount: 0,
      qualityFlagCount: 0
    },
    areas: [{ id: 'area_ux', label: 'UX', confidence: 0.9 }],
    skills: [
      { id: 'skill_research', label: 'Investigación de usuarios', confidence: 0.85 }
    ],
    concepts: [{ id: 'concept_wireframe', label: 'Wireframing', confidence: null }],
    hoursDistribution: [{ areaId: 'area_ux', hours: 15 }],
    confidence: 0.9,
    warnings: [],
    qualityFlags: [],
    review: { issuerReviewed: true, note: null },
    ...overrides
  };
}

function activeInterpretation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'interp-1',
    approvedSnapshot: approvedSnapshotV2(),
    snapshotVersion: 'approved_template_semantic_snapshot_v2',
    ...overrides
  };
}

function semanticAnalysisFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'analysis-1',
    analyzedAt: new Date('2026-07-22T10:00:00Z'),
    confidence: decimalLike('0.7000'),
    areas: [{ id: 'area_sql', label: 'Bases de datos' }],
    skills: [{ label: 'SQL', confidence: 0.7 }],
    concepts: [{ concept: 'Normalización' }],
    analysisJson: {
      sourceType: 'academic_pdf',
      hoursDistribution: [{ areaId: 'area_sql', hours: 5 }]
    },
    ...overrides
  };
}

function credentialFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'credential-1',
    type: CredentialType.course,
    hours: decimalLike('20.00'),
    credentialSubject: {},
    semanticAnalyses: [],
    reusableSemanticInterpretations: [],
    ...overrides
  };
}

async function rebuildProfileJson(
  credentials: unknown[]
): Promise<Record<string, unknown>> {
  const findManyCalls: Array<Record<string, unknown>> = [];
  let createdData: Record<string, unknown> | undefined;

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
            createdData = args.data as Record<string, unknown>;
            return {
              id: 'profile-1',
              profileVersion: createdData.profileVersion,
              schemaVersion: createdData.schemaVersion,
              isCurrent: true,
              credentialsCount: createdData.credentialsCount,
              totalHours: createdData.totalHours,
              areasSummary: createdData.areasSummary,
              skillsSummary: createdData.skillsSummary,
              qualityFlags: createdData.qualityFlags,
              generatedAt: createdData.generatedAt,
              profileJson: createdData.profileJson
            };
          }
        }
      });
    }
  } as never);

  await service.rebuildForUser('holder-1');

  assert.equal(
    (findManyCalls[0] as { where: Record<string, unknown> }).where.status,
    'issued',
    'rebuildForUser must keep selecting only issued credentials -- lifecycle rule unchanged by C5b.1'
  );

  return createdData!.profileJson as Record<string, unknown>;
}

function summaryOf(profileJson: Record<string, unknown>) {
  return profileJson.summary as Record<string, unknown>;
}

function generatedFromOf(profileJson: Record<string, unknown>) {
  return profileJson.generatedFrom as Record<string, unknown>;
}

function skillsOf(profileJson: Record<string, unknown>) {
  return profileJson.skills as Array<Record<string, unknown>>;
}

function areasOf(profileJson: Record<string, unknown>) {
  return profileJson.areas as Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// SELECTION
// ---------------------------------------------------------------------------

test('A: a Credential with an active reusable interpretation AND a SemanticAnalysis uses the reusable one, never the SemanticAnalysis', async () => {
  const credential = credentialFixture({
    reusableSemanticInterpretations: [activeInterpretation()],
    semanticAnalyses: [semanticAnalysisFixture()]
  });
  const profileJson = await rebuildProfileJson([credential]);
  const skills = skillsOf(profileJson);

  assert.deepEqual(
    skills.map((skill) => skill.skill),
    ['Investigación de usuarios']
  );
  assert.equal(
    skills.some((skill) => skill.skill === 'SQL'),
    false,
    'the SemanticAnalysis-only skill must never appear once a reusable interpretation is active'
  );
});

test('B: a Credential without a reusable interpretation but with a SemanticAnalysis uses ai_inferred', async () => {
  const credential = credentialFixture({
    semanticAnalyses: [semanticAnalysisFixture()]
  });
  const profileJson = await rebuildProfileJson([credential]);
  const skills = skillsOf(profileJson);

  assert.deepEqual(skills[0].sources, [
    { credentialId: 'credential-1', provenance: 'ai_inferred', semanticAnalysisId: 'analysis-1' }
  ]);
});

test('C: a Credential with neither a reusable interpretation nor a SemanticAnalysis contributes only declared/emitted data', async () => {
  const credential = credentialFixture({
    credentialSubject: { competencies: ['Trabajo en equipo'] }
  });
  const profileJson = await rebuildProfileJson([credential]);

  assert.deepEqual(skillsOf(profileJson), []);
  assert.equal(summaryOf(profileJson).credentialsWithoutSemanticCoverage, 1);
  assert.deepEqual(
    (profileJson.emittedCompetencies as Array<{ label: string }>).map(
      (entry) => entry.label
    ),
    ['Trabajo en equipo']
  );
});

// ---------------------------------------------------------------------------
// FROZEN
// ---------------------------------------------------------------------------

test('D: the profile consumes only active.approvedSnapshot -- it never queries IssuerCourseTemplate at all', async () => {
  // No hay ningun mock de issuerCourseTemplate en el fake Prisma de este
  // archivo: si el servicio intentara leerlo (para "reinterpretar" una
  // re-aprobacion posterior del template), esta prueba fallaria con un
  // TypeError al no encontrar ese delegate. El hecho de que el rebuild
  // complete con exito ya demuestra que nunca se toca esa relacion --
  // ver ademas la ausencia de "issuerCourseTemplate" en
  // formative-profile.service.ts.
  const credential = credentialFixture({
    reusableSemanticInterpretations: [
      activeInterpretation({
        approvedSnapshot: approvedSnapshotV2({
          areas: [{ id: 'area_ux', label: 'UX (congelado)', confidence: null }]
        })
      })
    ]
  });

  const profileJson = await rebuildProfileJson([credential]);

  assert.deepEqual(
    areasOf(profileJson).map((area) => area.area),
    ['UX (congelado)']
  );
});

// ---------------------------------------------------------------------------
// SUPERSEDED
// ---------------------------------------------------------------------------

test('E: only the queried active row participates -- superseded exclusion is enforced by the query where clause, never re-decided here', async () => {
  // rebuildForUser pide reusableSemanticInterpretations con
  // where: { status: 'active' } y take: 1 -- una fila superseded nunca
  // llega a este array (verificado en la seleccion de la query, y contra
  // Postgres real en C4b.1a-V/C4b.1b). Este fixture representa exactamente
  // lo que esa query devuelve cuando existen ambas: solo la activa.
  const credential = credentialFixture({
    reusableSemanticInterpretations: [
      activeInterpretation({ id: 'interp-active-only' })
    ]
  });

  const profileJson = await rebuildProfileJson([credential]);

  assert.deepEqual(generatedFromOf(profileJson).reusableSemanticInterpretationIds, [
    'interp-active-only'
  ]);
});

// ---------------------------------------------------------------------------
// MERGE
// ---------------------------------------------------------------------------

test('F: the same skill contributed by two Credentials with different provenance merges into one aggregate with two sources', async () => {
  const credentialA = credentialFixture({
    id: 'credential-a',
    reusableSemanticInterpretations: [
      activeInterpretation({
        id: 'interp-a',
        approvedSnapshot: approvedSnapshotV2({
          skills: [{ id: 'skill_pm', label: 'Gestión de proyectos', confidence: 0.9 }]
        })
      })
    ]
  });
  const credentialB = credentialFixture({
    id: 'credential-b',
    semanticAnalyses: [
      semanticAnalysisFixture({
        id: 'analysis-b',
        skills: [{ label: 'Gestión de proyectos', confidence: 0.6 }]
      })
    ]
  });

  const profileJson = await rebuildProfileJson([credentialA, credentialB]);
  const skills = skillsOf(profileJson);

  assert.equal(skills.length, 1, 'must be a single aggregated skill, never duplicated');
  assert.equal(skills[0].skill, 'Gestión de proyectos');
  assert.deepEqual(skills[0].sources, [
    { credentialId: 'credential-a', provenance: 'issuer_reviewed', reusableInterpretationId: 'interp-a' },
    { credentialId: 'credential-b', provenance: 'ai_inferred', semanticAnalysisId: 'analysis-b' }
  ]);
  assert.deepEqual(skills[0].provenanceSummary, {
    issuerReviewedCount: 1,
    aiInferredCount: 1
  });
  assert.deepEqual(skills[0].credentialIds, ['credential-a', 'credential-b']);
});

// ---------------------------------------------------------------------------
// IDS
// ---------------------------------------------------------------------------

test('G: semanticAnalysisIds never contains the frozen sourceSemanticAnalysisId of an applied interpretation', async () => {
  const credential = credentialFixture({
    reusableSemanticInterpretations: [
      activeInterpretation({
        approvedSnapshot: approvedSnapshotV2({
          sourceSemanticAnalysisId: 'source-analysis-should-never-leak'
        })
      })
    ]
  });

  const profileJson = await rebuildProfileJson([credential]);
  const serialized = JSON.stringify(profileJson);

  assert.ok(!serialized.includes('source-analysis-should-never-leak'));
  assert.deepEqual(generatedFromOf(profileJson).semanticAnalysisIds, []);
});

test('H: generatedFrom.reusableSemanticInterpretationIds contains active.id', async () => {
  const credential = credentialFixture({
    reusableSemanticInterpretations: [activeInterpretation({ id: 'interp-h' })]
  });
  const profileJson = await rebuildProfileJson([credential]);

  assert.deepEqual(generatedFromOf(profileJson).reusableSemanticInterpretationIds, [
    'interp-h'
  ]);
});

test('I: generatedFrom.semanticAnalysisIds contains only actually-consumed AI analyses (never one shadowed by an active interpretation)', async () => {
  const reviewed = credentialFixture({
    id: 'credential-reviewed',
    reusableSemanticInterpretations: [activeInterpretation({ id: 'interp-i' })],
    semanticAnalyses: [semanticAnalysisFixture({ id: 'analysis-shadowed' })]
  });
  const aiOnly = credentialFixture({
    id: 'credential-ai-only',
    semanticAnalyses: [semanticAnalysisFixture({ id: 'analysis-real' })]
  });

  const profileJson = await rebuildProfileJson([reviewed, aiOnly]);

  assert.deepEqual(generatedFromOf(profileJson).semanticAnalysisIds, ['analysis-real']);
});

// ---------------------------------------------------------------------------
// COUNTERS
// ---------------------------------------------------------------------------

test('J: analyzedCredentialsCount includes both reviewed and AI-analyzed credentials', async () => {
  const reviewed = credentialFixture({
    id: 'credential-reviewed',
    reusableSemanticInterpretations: [activeInterpretation()]
  });
  const aiOnly = credentialFixture({
    id: 'credential-ai',
    semanticAnalyses: [semanticAnalysisFixture()]
  });
  const none = credentialFixture({ id: 'credential-none' });

  const profileJson = await rebuildProfileJson([reviewed, aiOnly, none]);
  const summary = summaryOf(profileJson);

  assert.equal(summary.analyzedCredentialsCount, 2);
  assert.equal(summary.credentialsWithoutSemanticCoverage, 1);
  assert.equal(
    (summary.analyzedCredentialsCount as number) +
      (summary.credentialsWithoutSemanticCoverage as number),
    3
  );
});

test('K: credentialsWithoutSemanticCoverage also counts a Credential whose active interpretation has an unsupported snapshot', async () => {
  const unsupported = credentialFixture({
    id: 'credential-unsupported',
    reusableSemanticInterpretations: [
      activeInterpretation({ snapshotVersion: 'approved_template_semantic_snapshot_v99' })
    ]
  });
  const none = credentialFixture({ id: 'credential-none' });

  const profileJson = await rebuildProfileJson([unsupported, none]);

  assert.equal(summaryOf(profileJson).credentialsWithoutSemanticCoverage, 2);
});

test('L: credentialsWithReviewedInterpretation counts only credentials whose chosen source was issuer_reviewed', async () => {
  const reviewedOne = credentialFixture({
    id: 'credential-reviewed-1',
    reusableSemanticInterpretations: [activeInterpretation({ id: 'interp-1' })]
  });
  const reviewedTwo = credentialFixture({
    id: 'credential-reviewed-2',
    reusableSemanticInterpretations: [activeInterpretation({ id: 'interp-2' })]
  });
  const aiOnly = credentialFixture({
    id: 'credential-ai',
    semanticAnalyses: [semanticAnalysisFixture()]
  });

  const profileJson = await rebuildProfileJson([reviewedOne, reviewedTwo, aiOnly]);

  assert.equal(summaryOf(profileJson).credentialsWithReviewedInterpretation, 2);
});

// ---------------------------------------------------------------------------
// HOURS
// ---------------------------------------------------------------------------

test('M: totalOfficialHours never changes because a Credential uses a reusable interpretation -- it always comes from Credential.hours', async () => {
  const credential = credentialFixture({
    hours: decimalLike('20.00'),
    reusableSemanticInterpretations: [
      activeInterpretation({
        approvedSnapshot: approvedSnapshotV2({
          hoursDistribution: [{ areaId: 'area_ux', hours: 999 }]
        })
      })
    ]
  });

  const profileJson = await rebuildProfileJson([credential]);
  const summary = summaryOf(profileJson);

  assert.equal(summary.totalOfficialHours, 20);
  assert.equal(summary.totalHours, 20);
});

test('N: hoursDistribution from the approvedSnapshot does populate estimatedHours on the matching area', async () => {
  const credential = credentialFixture({
    reusableSemanticInterpretations: [activeInterpretation()]
  });

  const profileJson = await rebuildProfileJson([credential]);
  const areas = areasOf(profileJson);

  assert.equal(areas.length, 1);
  assert.equal(areas[0].area, 'UX');
  assert.equal(areas[0].estimatedHours, 15);
});

// ---------------------------------------------------------------------------
// CONFIDENCE
// ---------------------------------------------------------------------------

test('O: confidence from a reviewed snapshot participates in the same derived aggregation as ai_inferred confidence', async () => {
  const reviewed = credentialFixture({
    id: 'credential-reviewed',
    reusableSemanticInterpretations: [
      activeInterpretation({
        approvedSnapshot: approvedSnapshotV2({ confidence: 1 })
      })
    ]
  });
  const aiOnly = credentialFixture({
    id: 'credential-ai',
    semanticAnalyses: [semanticAnalysisFixture({ confidence: decimalLike('0.0000') })]
  });

  const profileJson = await rebuildProfileJson([reviewed, aiOnly]);
  const confidence = profileJson.confidence as { score: number; method: string };

  // Promedio derivado de [1, 0] -- el mismo algoritmo ya usado para
  // ai_inferred, nunca una semantica distinta ("revision humana") para
  // issuer_reviewed.
  assert.equal(confidence.score, 0.5);
  assert.equal(confidence.method, 'derived');
});

// ---------------------------------------------------------------------------
// CORRUPT/UNKNOWN SNAPSHOT
// ---------------------------------------------------------------------------

test('P: an active row with an unsupported snapshot version never falls back to that Credential\'s own SemanticAnalysis', async () => {
  const credential = credentialFixture({
    reusableSemanticInterpretations: [
      activeInterpretation({ snapshotVersion: 'approved_template_semantic_snapshot_v1' })
    ],
    semanticAnalyses: [
      semanticAnalysisFixture({ skills: [{ label: 'nunca-debe-aparecer' }] })
    ]
  });

  const profileJson = await rebuildProfileJson([credential]);

  assert.deepEqual(skillsOf(profileJson), []);
  assert.equal(summaryOf(profileJson).credentialsWithoutSemanticCoverage, 1);
  assert.ok(
    (profileJson.warnings as string[]).includes(
      'reusable_interpretation_snapshot_unsupported'
    )
  );
  assert.ok(
    (profileJson.warnings as string[]).includes('credential_without_semantic_analysis')
  );
});

test('P2: an active row with a structurally malformed snapshot (missing schema/status) is treated the same way -- fail-safe, not a crash', async () => {
  const credential = credentialFixture({
    reusableSemanticInterpretations: [
      activeInterpretation({ approvedSnapshot: { areas: 'not-an-array' } })
    ],
    semanticAnalyses: [semanticAnalysisFixture()]
  });

  const profileJson = await rebuildProfileJson([credential]);

  assert.deepEqual(skillsOf(profileJson), []);
  assert.equal(summaryOf(profileJson).credentialsWithoutSemanticCoverage, 1);
});

// ---------------------------------------------------------------------------
// STRICT VALIDATION (C5b.1-R): buildApprovedSemanticSnapshotSummary
// (issuer-course-templates.helpers.ts) es TOLERANTE por diseno -- exige
// solo `schema` no vacio + `status` valido, y usa
// `Array.isArray(x) ? x : []` unicamente para CONTAR elementos en un
// resumen de UI, sin validar el shape de cada uno. Ese helper nunca se
// modifica (lo siguen usando C4a/C4b tal cual). Estos tests demuestran
// que el perfil usa una validacion ESTRICTA propia
// (parseReviewedApprovedTemplateSemanticSnapshot) que ningun caso
// superficial (solo schema/status) puede satisfacer por si solo -- y que,
// en TODOS los casos invalidos, un SemanticAnalysis "decoy" de la MISMA
// Credential nunca participa (nunca hay fallback silencioso a ai_inferred).
// ---------------------------------------------------------------------------

const DECOY_SKILL_LABEL = 'decoy-skill-nunca-debe-aparecer';

function decoySemanticAnalysis(overrides: Record<string, unknown> = {}) {
  return semanticAnalysisFixture({
    id: 'analysis-decoy',
    skills: [{ label: DECOY_SKILL_LABEL, confidence: 0.99 }],
    ...overrides
  });
}

async function assertSnapshotUnsupported(approvedSnapshot: unknown) {
  const credential = credentialFixture({
    reusableSemanticInterpretations: [
      activeInterpretation({ approvedSnapshot })
    ],
    semanticAnalyses: [decoySemanticAnalysis()]
  });

  const profileJson = await rebuildProfileJson([credential]);

  assert.deepEqual(skillsOf(profileJson), []);
  assert.equal(
    skillsOf(profileJson).some((skill) => skill.skill === DECOY_SKILL_LABEL),
    false,
    'a decoy SemanticAnalysis from the same Credential must never participate when the active snapshot is invalid'
  );
  assert.equal(summaryOf(profileJson).credentialsWithoutSemanticCoverage, 1);
  assert.equal(summaryOf(profileJson).credentialsWithReviewedInterpretation, 0);
  assert.ok(
    (profileJson.warnings as string[]).includes(
      'reusable_interpretation_snapshot_unsupported'
    )
  );
}

test('SV-A: snapshotVersion=v2 but approvedSnapshot.schema is a different string -> unsupported, no AI fallback', async () => {
  await assertSnapshotUnsupported(
    approvedSnapshotV2({ schema: 'otro_schema' })
  );
});

test('SV-B: schema/status valid but areas is not an array -> unsupported', async () => {
  await assertSnapshotUnsupported(
    approvedSnapshotV2({ areas: 'not-an-array' })
  );
});

test('SV-C: areas contains a structurally invalid descriptor (empty label) -> unsupported, never partial salvage', async () => {
  await assertSnapshotUnsupported(
    approvedSnapshotV2({
      areas: [
        { id: 'area_ux', label: 'UX', confidence: 0.9 },
        { id: 'area_bad', label: '   ', confidence: 0.5 }
      ]
    })
  );
});

test('SV-D1: skills contains a structurally invalid descriptor (missing id/label) -> unsupported', async () => {
  await assertSnapshotUnsupported(
    approvedSnapshotV2({ skills: [{ confidence: 0.5 }] })
  );
});

test('SV-D2: concepts contains a structurally invalid descriptor (non-record entry) -> unsupported', async () => {
  await assertSnapshotUnsupported(
    approvedSnapshotV2({ concepts: ['just-a-string-not-a-descriptor'] })
  );
});

test('SV-E: hoursDistribution contains an invalid item (hours as a non-finite value) -> unsupported', async () => {
  await assertSnapshotUnsupported(
    approvedSnapshotV2({
      hoursDistribution: [{ areaId: 'area_ux', hours: Number.NaN }]
    })
  );
});

test('SV-E2: hoursDistribution item missing areaId -> unsupported', async () => {
  await assertSnapshotUnsupported(
    approvedSnapshotV2({ hoursDistribution: [{ hours: 10 }] })
  );
});

test('SV-F: top-level confidence has an invalid type (string) -> unsupported', async () => {
  await assertSnapshotUnsupported(approvedSnapshotV2({ confidence: '0.9' }));
});

test('SV-F2: top-level confidence out of the real [0,1] range -> unsupported', async () => {
  await assertSnapshotUnsupported(approvedSnapshotV2({ confidence: 1.5 }));
});

test('SV-F3: top-level confidence is NaN/Infinity -> unsupported', async () => {
  await assertSnapshotUnsupported(
    approvedSnapshotV2({ confidence: Number.POSITIVE_INFINITY })
  );
});

test('SV-G: review.issuerReviewed missing -> unsupported (the literal marker the real builder always writes)', async () => {
  await assertSnapshotUnsupported(
    approvedSnapshotV2({ review: { note: null } })
  );
});

test('SV-G2: review.issuerReviewed === false -> unsupported', async () => {
  await assertSnapshotUnsupported(
    approvedSnapshotV2({ review: { issuerReviewed: false, note: null } })
  );
});

test('SV-H: a fully valid v2 snapshot with status=completed keeps working end-to-end', async () => {
  const credential = credentialFixture({
    reusableSemanticInterpretations: [
      activeInterpretation({
        approvedSnapshot: approvedSnapshotV2({ status: 'completed' })
      })
    ]
  });

  const profileJson = await rebuildProfileJson([credential]);

  assert.deepEqual(
    skillsOf(profileJson).map((skill) => skill.skill),
    ['Investigación de usuarios']
  );
  assert.equal(summaryOf(profileJson).credentialsWithReviewedInterpretation, 1);
});

test('SV-I: a fully valid v2 snapshot with status=partial keeps working end-to-end (partial is a legitimate reviewed status, never rejected for that alone)', async () => {
  const credential = credentialFixture({
    reusableSemanticInterpretations: [
      activeInterpretation({
        approvedSnapshot: approvedSnapshotV2({ status: 'partial' })
      })
    ]
  });

  const profileJson = await rebuildProfileJson([credential]);

  assert.deepEqual(
    skillsOf(profileJson).map((skill) => skill.skill),
    ['Investigación de usuarios']
  );
  assert.equal(summaryOf(profileJson).credentialsWithReviewedInterpretation, 1);
});

test('SV-J: descriptor confidence (area/skill/concept) accepts a finite number outside [0,1] -- only the TOP-LEVEL snapshot confidence is clamped, matching the real builder (readDescriptorArray uses readFiniteNumber, never readConfidenceValue)', async () => {
  // Documenta explicitamente la asimetria real entre readDescriptorArray
  // (sin clamp) y readConfidenceValue (clamp [0,1], solo para
  // snapshot.confidence de nivel superior) -- para no inventar una
  // restriccion mas estricta que la que el builder real aplica.
  const credential = credentialFixture({
    reusableSemanticInterpretations: [
      activeInterpretation({
        approvedSnapshot: approvedSnapshotV2({
          areas: [{ id: 'area_ux', label: 'UX', confidence: 42 }]
        })
      })
    ]
  });

  const profileJson = await rebuildProfileJson([credential]);

  assert.deepEqual(
    areasOf(profileJson).map((area) => area.area),
    ['UX']
  );
});

// ---------------------------------------------------------------------------
// REVOKED / LIFECYCLE
// ---------------------------------------------------------------------------

test('Q: rebuildForUser keeps selecting Credential.status = issued only -- a revoked Credential (and any interpretation tied to it) never enters the profile', async () => {
  // rebuildProfileJson() ya afirma where.status === 'issued' en cada
  // corrida (ver helper). Una fila CredentialReusableSemanticInterpretation
  // de una Credential revoked nunca puede llegar a este array porque la
  // relacion es anidada DENTRO del mismo query ya filtrado por Credential
  // issued -- no existe una consulta global de interpretations aparte que
  // pudiera "olvidarse" de filtrar por lifecycle.
  const profileJson = await rebuildProfileJson([]);

  assert.deepEqual(generatedFromOf(profileJson).reusableSemanticInterpretationIds, []);
  assert.equal(summaryOf(profileJson).credentialsCount, 0);
});

// ---------------------------------------------------------------------------
// DETERMINISM
// ---------------------------------------------------------------------------

test('determinism: the same Credentials/sources produce the same semantic profileJson regardless of input order', async () => {
  const credentialA = credentialFixture({
    id: 'credential-a',
    reusableSemanticInterpretations: [
      activeInterpretation({
        id: 'interp-a',
        approvedSnapshot: approvedSnapshotV2({
          skills: [{ id: 'skill_pm', label: 'Gestión de proyectos', confidence: 0.9 }]
        })
      })
    ]
  });
  const credentialB = credentialFixture({
    id: 'credential-b',
    semanticAnalyses: [
      semanticAnalysisFixture({
        id: 'analysis-b',
        skills: [{ label: 'Gestión de proyectos', confidence: 0.6 }]
      })
    ]
  });

  const forward = await rebuildProfileJson([credentialA, credentialB]);
  const reversed = await rebuildProfileJson([credentialB, credentialA]);

  assert.deepEqual(skillsOf(forward), skillsOf(reversed));
  assert.deepEqual(areasOf(forward), areasOf(reversed));
});
