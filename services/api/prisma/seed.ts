import {
  CourseStatus,
  IssuerAuthorizationStatus,
  IssuerMembershipRole,
  IssuerMembershipStatus,
  PrismaClient,
  UserStatus
} from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { hashPassword } from '../src/auth/password-hashing';

const prisma = new PrismaClient();

const FIXED_TIMESTAMP = new Date('2026-01-01T00:00:00.000Z');
const DEMO_ISSUER_PASSWORD = 'DemoIssuer123!';
const DEMO_HOLDER_PASSWORD = 'DemoHolder123!';
const EXPECTED_DEMO_ACADEMIC_COURSES = 617;

interface DemoAcademicCourse {
  code: string;
  name: string;
}

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

  const academicCourses = await loadDemoAcademicCourses();

  await prisma.$transaction(
    academicCourses.map((course) =>
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

async function loadDemoAcademicCourses(): Promise<DemoAcademicCourse[]> {
  const catalogPath = resolve(
    __dirname,
    '../../../data/academic_catalog/demo-academic-courses-v0.json'
  );
  const document = JSON.parse(await readFile(catalogPath, 'utf8')) as unknown;

  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('El catalogo academico demo debe ser un objeto JSON.');
  }

  const record = document as Record<string, unknown>;

  if (
    record.schemaVersion !== 'academic_course_catalog_v0' ||
    !Array.isArray(record.courses)
  ) {
    throw new Error('El contrato del catalogo academico demo es invalido.');
  }

  const courses = record.courses.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`La materia ${index} del catalogo es invalida.`);
    }

    const course = entry as Record<string, unknown>;
    const code = normalizeRequiredCatalogText(course.code, `courses[${index}].code`);
    const name = normalizeRequiredCatalogText(course.name, `courses[${index}].name`);

    if (Object.keys(course).some((key) => key !== 'code' && key !== 'name')) {
      throw new Error(`La materia ${index} contiene campos no permitidos.`);
    }

    return { code, name };
  });

  if (courses.length !== EXPECTED_DEMO_ACADEMIC_COURSES) {
    throw new Error(
      `El catalogo demo debe contener ${EXPECTED_DEMO_ACADEMIC_COURSES} materias.`
    );
  }

  const codes = new Set(courses.map((course) => course.code));

  if (codes.size !== courses.length) {
    throw new Error('El catalogo academico demo contiene codigos duplicados.');
  }

  return courses;
}

function normalizeRequiredCatalogText(value: unknown, field: string) {
  if (typeof value !== 'string') {
    throw new Error(`${field} debe ser string.`);
  }

  const normalized = value.trim().replace(/\s+/g, ' ');

  if (!normalized) {
    throw new Error(`${field} no puede estar vacio.`);
  }

  return normalized;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
