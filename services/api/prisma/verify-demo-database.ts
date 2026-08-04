import {
  IssuerAuthorizationStatus,
  IssuerMembershipRole,
  IssuerMembershipStatus,
  PrismaClient,
  UserStatus
} from '@prisma/client';

import {
  EXPECTED_DEMO_ACADEMIC_COURSES,
  EXPECTED_DEMO_ACADEMIC_PROGRAMS,
  EXPECTED_DEMO_PROGRAM_COURSES
} from './demo-academic-catalog';
import { DEMO_ISSUER_DID } from './demo-issuer-seed';

const DEMO_HOLDER_DID = 'did:example:holder-demo';
const DEMO_ISSUER_ADMIN_DID = 'did:example:issuer-admin-demo';
const DEMO_COMPUTING_PROGRAM_CODE = '3824';

export interface DemoDatabaseVerificationSummary {
  status: 'ok';
  connection: 'ok';
  demoIssuer: {
    authorized: true;
  };
  demoUsers: {
    expected: 2;
    active: 2;
    withEmail: 2;
    withAuthCredential: 2;
  };
  issuerAdminMembership: {
    active: true;
    role: 'admin';
  };
  catalog: {
    academicCourses: number;
    programs: number;
    curriculumVersions: number;
    programCourses: number;
    stableProgramPresent: true;
  };
  recentModels: {
    documentEvidenceReadable: true;
    textEvidenceReadable: true;
  };
}

export async function verifyDemoDatabase(
  database: PrismaClient
): Promise<DemoDatabaseVerificationSummary> {
  const issuer = await database.issuer.findUnique({
    where: { did: DEMO_ISSUER_DID },
    select: { id: true, authorizationStatus: true }
  });

  assertCondition(issuer, 'No se encontro el issuer demo esperado.');
  assertCondition(
    issuer.authorizationStatus === IssuerAuthorizationStatus.authorized,
    'El issuer demo no esta autorizado.'
  );

  const users = await database.user.findMany({
    where: {
      did: { in: [DEMO_ISSUER_ADMIN_DID, DEMO_HOLDER_DID] }
    },
    select: {
      id: true,
      did: true,
      email: true,
      status: true,
      authCredential: { select: { id: true } }
    }
  });
  const issuerAdmin = users.find(
    (user) => user.did === DEMO_ISSUER_ADMIN_DID
  );
  const holder = users.find((user) => user.did === DEMO_HOLDER_DID);

  assertCondition(
    users.length === 2 && issuerAdmin && holder,
    'Faltan usuarios demo requeridos.'
  );
  assertCondition(
    users.every((user) => user.status === UserStatus.active),
    'Los usuarios demo deben estar activos.'
  );
  assertCondition(
    users.every((user) => Boolean(user.email)),
    'Los usuarios demo deben tener email configurado.'
  );
  assertCondition(
    users.every((user) => Boolean(user.authCredential)),
    'Los usuarios demo deben tener credenciales de autenticacion.'
  );

  const membership = await database.issuerMembership.findUnique({
    where: {
      userId_issuerId: {
        userId: issuerAdmin.id,
        issuerId: issuer.id
      }
    },
    select: { role: true, status: true }
  });
  assertCondition(
    membership?.status === IssuerMembershipStatus.active &&
      membership.role === IssuerMembershipRole.admin,
    'La membership del administrador demo no esta activa con rol admin.'
  );

  const [
    academicCourses,
    programs,
    curriculumVersions,
    programCourses,
    stableProgram,
    documentEvidenceCount,
    textEvidenceCount
  ] = await Promise.all([
    database.academicCourse.count({ where: { issuerId: issuer.id } }),
    database.program.count({ where: { issuerId: issuer.id } }),
    database.curriculumVersion.count({
      where: { program: { issuerId: issuer.id } }
    }),
    database.programCourse.count({
      where: {
        curriculumVersion: { program: { issuerId: issuer.id } }
      }
    }),
    database.program.findUnique({
      where: {
        issuerId_code: {
          issuerId: issuer.id,
          code: DEMO_COMPUTING_PROGRAM_CODE
        }
      },
      select: { id: true }
    }),
    database.documentEvidence.count(),
    database.textEvidence.count()
  ]);

  assertExactCount(
    academicCourses,
    EXPECTED_DEMO_ACADEMIC_COURSES,
    'AcademicCourse'
  );
  assertExactCount(programs, EXPECTED_DEMO_ACADEMIC_PROGRAMS, 'Program');
  assertExactCount(
    curriculumVersions,
    EXPECTED_DEMO_ACADEMIC_PROGRAMS,
    'CurriculumVersion'
  );
  assertExactCount(
    programCourses,
    EXPECTED_DEMO_PROGRAM_COURSES,
    'ProgramCourse'
  );
  assertCondition(
    stableProgram,
    'No se encontro el programa demo esperado por su codigo estable.'
  );
  assertCondition(
    Number.isInteger(documentEvidenceCount) &&
      Number.isInteger(textEvidenceCount),
    'No se pudieron consultar los modelos de evidencia recientes.'
  );

  return {
    status: 'ok',
    connection: 'ok',
    demoIssuer: { authorized: true },
    demoUsers: {
      expected: 2,
      active: 2,
      withEmail: 2,
      withAuthCredential: 2
    },
    issuerAdminMembership: {
      active: true,
      role: 'admin'
    },
    catalog: {
      academicCourses,
      programs,
      curriculumVersions,
      programCourses,
      stableProgramPresent: true
    },
    recentModels: {
      documentEvidenceReadable: true,
      textEvidenceReadable: true
    }
  };
}

function assertExactCount(actual: number, expected: number, model: string) {
  assertCondition(
    actual === expected,
    `El conteo demo de ${model} no coincide con el esperado.`
  );
}

function assertCondition<T>(
  condition: T,
  message: string
): asserts condition is NonNullable<T> {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const database = new PrismaClient();

  try {
    const summary = await verifyDemoDatabase(database);
    console.log(JSON.stringify(summary, null, 2));
  } catch {
    console.error(
      'La verificacion sanitaria de la base demo fallo. Revise migraciones, seed y configuracion del ambiente.'
    );
    process.exitCode = 1;
  } finally {
    await database.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
