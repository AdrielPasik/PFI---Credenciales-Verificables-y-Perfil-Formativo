import {
  CourseStatus,
  CurriculumVersionStatus,
  IssuerMembershipRole,
  IssuerMembershipStatus,
  PrismaClient,
  ProgramStatus,
  UserStatus
} from '@prisma/client';

import { hashPassword } from '../src/auth/password-hashing';
import { loadDemoAcademicCatalog } from './demo-academic-catalog';
import {
  buildDemoIssuerUpsertArgs,
  DEMO_UADE_ISSUER_ADMIN_DID,
  DEMO_UADE_ISSUER_ADMIN_DISPLAY_NAME,
  DEMO_UADE_ISSUER_ADMIN_EMAIL,
  DEMO_UADE_ISSUER_ADMIN_PASSWORD,
  LEGACY_DEMO_UADE_ISSUER_ADMIN_EMAIL
} from './demo-issuer-seed';
import { buildDemoSeedSummary } from './demo-seed-summary';
import { bootstrapDemoCoursePlatformUser } from './seed-course-platform-user';

const prisma = new PrismaClient();

const DEMO_HOLDER_PASSWORD = 'DemoHolder123!';

interface DemoUserRecord {
  id: string;
  [key: string]: unknown;
}

interface DemoUserDatabase {
  findMany: (args: unknown) => Promise<DemoUserRecord[]>;
  update: (args: unknown) => Promise<DemoUserRecord>;
  create: (args: unknown) => Promise<DemoUserRecord>;
}

/**
 * Ubica el usuario administrador demo de UADE por su email actual o el
 * legado (`issuer.admin@example.com`) y lo renombra en el lugar
 * preservando su `id`, en vez de un upsert simple por email -que crearia
 * un usuario duplicado si el usuario viejo ya existe en el ambiente-. El
 * DID no cambia entre la identidad legada y la actual, por lo que tambien
 * sirve como ancla adicional.
 *
 * - Ningun match -> crea el usuario con la identidad nueva.
 * - Un match -> lo actualiza a la identidad nueva (mismo id).
 * - Mas de un match -> viejo y nuevo coexisten por accidente; no se borra
 *   nada automaticamente, se lanza un error claro para resolver a mano.
 */
export async function resolveDemoUadeAdminUser(
  database: DemoUserDatabase
): Promise<DemoUserRecord> {
  const candidateEmails = [
    DEMO_UADE_ISSUER_ADMIN_EMAIL,
    LEGACY_DEMO_UADE_ISSUER_ADMIN_EMAIL
  ];

  const matches = await database.findMany({
    where: {
      OR: [
        { email: { in: candidateEmails } },
        { did: DEMO_UADE_ISSUER_ADMIN_DID }
      ]
    }
  });

  if (matches.length > 1) {
    throw new Error(
      'Se encontraron multiples usuarios para la identidad demo "UADE" ' +
        '(el usuario legado y el renombrado coexisten). No se borra nada ' +
        'automaticamente: resolver manualmente antes de continuar. IDs ' +
        `en conflicto: ${matches.map((user) => user.id).join(', ')}`
    );
  }

  const identity = {
    email: DEMO_UADE_ISSUER_ADMIN_EMAIL,
    displayName: DEMO_UADE_ISSUER_ADMIN_DISPLAY_NAME,
    did: DEMO_UADE_ISSUER_ADMIN_DID,
    status: UserStatus.active
  };

  if (matches.length === 1) {
    return database.update({
      where: { id: matches[0].id },
      data: identity
    });
  }

  return database.create({ data: identity });
}

/**
 * Asegura unicamente el issuer UADE, su administrador demo (renombrado en
 * el lugar si hace falta), su IssuerMembership admin/active y su
 * AuthCredential. No toca AcademicCourse, Program, CurriculumVersion,
 * ProgramCourse ni el holder demo. Pensado para reutilizarse tanto desde
 * el seed completo (`main()`, que ademas necesita `issuerId` para el
 * catalogo academico) como desde un bootstrap puntual de identidades demo.
 */
export async function bootstrapDemoUadeAdmin(
  database: {
    issuer: { upsert: (args: unknown) => Promise<{ id: string; name: string }> };
    user: DemoUserDatabase;
    issuerMembership: { upsert: (args: unknown) => Promise<unknown> };
    authCredential: { upsert: (args: unknown) => Promise<unknown> };
  },
  hashPasswordFn: (password: string) => Promise<string>
) {
  const issuer = await database.issuer.upsert(buildDemoIssuerUpsertArgs());
  const user = await resolveDemoUadeAdminUser(database.user);

  await database.issuerMembership.upsert({
    where: {
      userId_issuerId: {
        userId: user.id,
        issuerId: issuer.id
      }
    },
    update: {
      role: IssuerMembershipRole.admin,
      status: IssuerMembershipStatus.active
    },
    create: {
      userId: user.id,
      issuerId: issuer.id,
      role: IssuerMembershipRole.admin,
      status: IssuerMembershipStatus.active
    }
  });

  await database.authCredential.upsert({
    where: {
      userId: user.id
    },
    update: {
      passwordHash: await hashPasswordFn(DEMO_UADE_ISSUER_ADMIN_PASSWORD)
    },
    create: {
      userId: user.id,
      passwordHash: await hashPasswordFn(DEMO_UADE_ISSUER_ADMIN_PASSWORD)
    }
  });

  return {
    issuerReady: true as const,
    userReady: true as const,
    authCredentialReady: true as const,
    membershipReady: true as const,
    email: DEMO_UADE_ISSUER_ADMIN_EMAIL,
    issuerName: issuer.name,
    issuerId: issuer.id
  };
}

async function main() {
  const uadeBootstrap = await bootstrapDemoUadeAdmin(prisma, hashPassword);
  const issuerId = uadeBootstrap.issuerId;

  const academicCatalog = await loadDemoAcademicCatalog();

  const academicCourses = await prisma.$transaction(
    academicCatalog.courses.map((course) =>
      prisma.academicCourse.upsert({
        where: {
          issuerId_code: {
            issuerId: issuerId,
            code: course.code
          }
        },
        update: {
          name: course.name,
          description: null,
          hours: null,
          status: CourseStatus.active
        },
        create: {
          issuerId: issuerId,
          code: course.code,
          name: course.name,
          description: null,
          hours: null,
          status: CourseStatus.active
        }
      })
    )
  );
  const academicCourseByCode = new Map(
    academicCourses.map((course) => [course.code, course])
  );
  const programs = await prisma.$transaction(
    academicCatalog.programs.map((program) =>
      prisma.program.upsert({
        where: {
          issuerId_code: {
            issuerId: issuerId,
            code: program.code
          }
        },
        update: {
          name: program.name,
          status: ProgramStatus.active
        },
        create: {
          issuerId: issuerId,
          code: program.code,
          name: program.name,
          status: ProgramStatus.active
        }
      })
    )
  );
  const programByCode = new Map(programs.map((program) => [program.code, program]));
  const curriculumVersions = await prisma.$transaction(
    programs.map((program) =>
      prisma.curriculumVersion.upsert({
        where: {
          programId_versionLabel: {
            programId: program.id,
            versionLabel: program.code
          }
        },
        update: {
          status: CurriculumVersionStatus.active
        },
        create: {
          programId: program.id,
          versionLabel: program.code,
          status: CurriculumVersionStatus.active
        }
      })
    )
  );
  const curriculumByProgramId = new Map(
    curriculumVersions.map((curriculum) => [curriculum.programId, curriculum])
  );
  const programCourseOperations = academicCatalog.programCourses.map(
    (relation) => {
      const program = programByCode.get(relation.programCode);
      const course = academicCourseByCode.get(relation.courseCode);
      const curriculum = program
        ? curriculumByProgramId.get(program.id)
        : undefined;

      if (!program || !course || !curriculum) {
        throw new Error('El catalogo curricular validado contiene una referencia rota.');
      }

      return prisma.programCourse.upsert({
        where: {
          curriculumVersionId_academicCourseId: {
            curriculumVersionId: curriculum.id,
            academicCourseId: course.id
          }
        },
        update: {
          isRequired: true
        },
        create: {
          curriculumVersionId: curriculum.id,
          academicCourseId: course.id,
          isRequired: true
        }
      });
    }
  );

  for (let offset = 0; offset < programCourseOperations.length; offset += 200) {
    await prisma.$transaction(programCourseOperations.slice(offset, offset + 200));
  }

  const holder = await prisma.user.upsert({
    where: {
      email: 'holder.demo@example.com'
    },
    update: {
      displayName: 'Demo Holder',
      did: 'did:example:holder-demo',
      status: UserStatus.active
    },
    create: {
      email: 'holder.demo@example.com',
      displayName: 'Demo Holder',
      did: 'did:example:holder-demo',
      status: UserStatus.active
    }
  });

  await prisma.authCredential.upsert({
    where: {
      userId: holder.id
    },
    update: {
      passwordHash: await hashPassword(DEMO_HOLDER_PASSWORD)
    },
    create: {
      userId: holder.id,
      passwordHash: await hashPassword(DEMO_HOLDER_PASSWORD)
    }
  });

  await bootstrapDemoCoursePlatformUser(prisma, hashPassword);

  console.log(
    JSON.stringify(
      buildDemoSeedSummary({
        academicCoursesImported: academicCourses.length,
        academicProgramsImported: programs.length,
        curriculumVersionsImported: curriculumVersions.length,
        programCoursesImported: academicCatalog.programCourses.length
      }),
      null,
      2
    )
  );
}

if (require.main === module) {
  main()
    .catch(() => {
      console.error(
        'El seed demo fallo. Revise migraciones, catalogos y configuracion del ambiente.'
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
