import {
  IssuerMembershipRole,
  IssuerMembershipStatus,
  PrismaClient,
  UserStatus
} from '@prisma/client';

import { hashPassword } from '../src/auth/password-hashing';
import {
  buildDemoCoursePlatformIssuerUpsertArgs,
  DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DID,
  DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DISPLAY_NAME,
  DEMO_COURSE_PLATFORM_ISSUER_ADMIN_EMAIL,
  DEMO_COURSE_PLATFORM_ISSUER_ADMIN_PASSWORD,
  LEGACY_DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DID,
  LEGACY_DEMO_COURSE_PLATFORM_ISSUER_ADMIN_EMAIL
} from './demo-course-platform-issuer-seed';

const prisma = new PrismaClient();

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
 * Ubica el usuario demo de este issuer por cualquiera de sus emails/DIDs
 * (actual o legado) y lo renombra en el lugar preservando su `id`, en vez
 * de un upsert simple por email -que crearia un usuario duplicado si el
 * email cambio y el usuario viejo ya existe en el ambiente-.
 *
 * - Ningun match -> crea el usuario con la identidad nueva.
 * - Un match -> lo actualiza a la identidad nueva (mismo id, cero
 *   duplicados), sea que ya tuviera el email nuevo o el legado.
 * - Mas de un match -> viejo y nuevo coexisten por accidente; no se borra
 *   nada automaticamente, se lanza un error claro para resolver a mano.
 */
export async function resolveDemoCoursePlatformAdminUser(
  database: DemoUserDatabase
): Promise<DemoUserRecord> {
  const candidateEmails = [
    DEMO_COURSE_PLATFORM_ISSUER_ADMIN_EMAIL,
    LEGACY_DEMO_COURSE_PLATFORM_ISSUER_ADMIN_EMAIL
  ];
  const candidateDids = [
    DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DID,
    LEGACY_DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DID
  ];

  const matches = await database.findMany({
    where: {
      OR: [
        { email: { in: candidateEmails } },
        { did: { in: candidateDids } }
      ]
    }
  });

  if (matches.length > 1) {
    throw new Error(
      'Se encontraron multiples usuarios para la identidad demo "Cursos ' +
        'Online" (el usuario legado y el renombrado coexisten). No se ' +
        'borra nada automaticamente: resolver manualmente antes de ' +
        `continuar. IDs en conflicto: ${matches.map((user) => user.id).join(', ')}`
    );
  }

  const identity = {
    email: DEMO_COURSE_PLATFORM_ISSUER_ADMIN_EMAIL,
    displayName: DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DISPLAY_NAME,
    did: DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DID,
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
 * Bootstrap puntual e idempotente: crea/asegura unicamente el issuer demo
 * de plataforma de cursos, su usuario administrador, su AuthCredential y
 * su IssuerMembership. No toca AcademicCourse, Program, CurriculumVersion,
 * ProgramCourse ni ningun otro dato del seed principal. Pensado para
 * reparar un ambiente (demo/cloud) donde el issuer ya existe pero el
 * usuario/membership/authCredential no llegaron a crearse, o donde el
 * usuario existe con la identidad demo anterior y debe renombrarse sin
 * duplicarse.
 */
export async function bootstrapDemoCoursePlatformUser(
  database: {
    issuer: { upsert: (args: unknown) => Promise<{ id: string; name: string }> };
    user: DemoUserDatabase;
    issuerMembership: { upsert: (args: unknown) => Promise<unknown> };
    authCredential: { upsert: (args: unknown) => Promise<unknown> };
  },
  hashPasswordFn: (password: string) => Promise<string>
) {
  const issuer = await database.issuer.upsert(
    buildDemoCoursePlatformIssuerUpsertArgs()
  );

  const user = await resolveDemoCoursePlatformAdminUser(database.user);

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
      passwordHash: await hashPasswordFn(
        DEMO_COURSE_PLATFORM_ISSUER_ADMIN_PASSWORD
      )
    },
    create: {
      userId: user.id,
      passwordHash: await hashPasswordFn(
        DEMO_COURSE_PLATFORM_ISSUER_ADMIN_PASSWORD
      )
    }
  });

  return {
    issuerReady: true as const,
    userReady: true as const,
    authCredentialReady: true as const,
    membershipReady: true as const,
    email: DEMO_COURSE_PLATFORM_ISSUER_ADMIN_EMAIL,
    issuerName: issuer.name
  };
}

async function main() {
  const summary = await bootstrapDemoCoursePlatformUser(prisma, hashPassword);
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main()
    .catch(() => {
      console.error(
        'El bootstrap del emisor demo de plataforma de cursos fallo. Revise migraciones y configuracion del ambiente.'
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
