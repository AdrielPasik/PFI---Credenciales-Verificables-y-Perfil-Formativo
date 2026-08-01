import {
  CourseStatus,
  CurriculumVersionStatus,
  IssuerAuthorizationStatus,
  IssuerMembershipRole,
  IssuerMembershipStatus,
  PrismaClient,
  ProgramStatus,
  UserStatus
} from '@prisma/client';

import { hashPassword } from '../src/auth/password-hashing';
import { loadDemoAcademicCatalog } from './demo-academic-catalog';

const prisma = new PrismaClient();

const FIXED_TIMESTAMP = new Date('2026-01-01T00:00:00.000Z');
const DEMO_ISSUER_PASSWORD = 'DemoIssuer123!';
const DEMO_HOLDER_PASSWORD = 'DemoHolder123!';
async function main() {
  const issuer = await prisma.issuer.upsert({
    where: {
      did: 'did:example:issuer-demo'
    },
    update: {
      name: 'Demo University',
      legalName: 'Demo University',
      walletAddress: '0x00000000000000000000000000000000000000aa',
      authorizationStatus: IssuerAuthorizationStatus.authorized,
      authorizedAt: FIXED_TIMESTAMP,
      revokedAt: null
    },
    create: {
      name: 'Demo University',
      legalName: 'Demo University',
      did: 'did:example:issuer-demo',
      walletAddress: '0x00000000000000000000000000000000000000aa',
      authorizationStatus: IssuerAuthorizationStatus.authorized,
      authorizedAt: FIXED_TIMESTAMP
    }
  });

  const academicCatalog = await loadDemoAcademicCatalog();

  const academicCourses = await prisma.$transaction(
    academicCatalog.courses.map((course) =>
      prisma.academicCourse.upsert({
        where: {
          issuerId_code: {
            issuerId: issuer.id,
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
          issuerId: issuer.id,
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
            issuerId: issuer.id,
            code: program.code
          }
        },
        update: {
          name: program.name,
          status: ProgramStatus.active
        },
        create: {
          issuerId: issuer.id,
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

  const issuerAdmin = await prisma.user.upsert({
    where: {
      email: 'issuer.admin@example.com'
    },
    update: {
      displayName: 'Issuer Admin',
      did: 'did:example:issuer-admin-demo',
      status: UserStatus.active
    },
    create: {
      email: 'issuer.admin@example.com',
      displayName: 'Issuer Admin',
      did: 'did:example:issuer-admin-demo',
      status: UserStatus.active
    }
  });

  await prisma.issuerMembership.upsert({
    where: {
      userId_issuerId: {
        userId: issuerAdmin.id,
        issuerId: issuer.id
      }
    },
    update: {
      role: IssuerMembershipRole.admin,
      status: IssuerMembershipStatus.active
    },
    create: {
      userId: issuerAdmin.id,
      issuerId: issuer.id,
      role: IssuerMembershipRole.admin,
      status: IssuerMembershipStatus.active
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

  await prisma.authCredential.upsert({
    where: {
      userId: issuerAdmin.id
    },
    update: {
      passwordHash: await hashPassword(DEMO_ISSUER_PASSWORD)
    },
    create: {
      userId: issuerAdmin.id,
      passwordHash: await hashPassword(DEMO_ISSUER_PASSWORD)
    }
  });

  console.log(
    JSON.stringify(
      {
        issuerId: issuer.id,
        holderUserId: holder.id,
        issuerAdminUserId: issuerAdmin.id,
        academicCoursesImported: academicCourses.length,
        academicProgramsImported: programs.length,
        curriculumVersionsImported: curriculumVersions.length,
        programCoursesImported: academicCatalog.programCourses.length,
        demoAuth: {
          issuerAdminEmail: issuerAdmin.email,
          issuerAdminPassword: DEMO_ISSUER_PASSWORD,
          holderEmail: holder.email,
          holderPassword: DEMO_HOLDER_PASSWORD
        }
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
