import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/auth/password-hashing';
import { bootstrapDemoUadeAdmin } from './seed';
import { bootstrapDemoCoursePlatformUser } from './seed-course-platform-user';

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

interface DemoIdentitiesDatabase {
  issuer: { upsert: (args: unknown) => Promise<{ id: string; name: string }> };
  user: DemoUserDatabase;
  issuerMembership: { upsert: (args: unknown) => Promise<unknown> };
  authCredential: { upsert: (args: unknown) => Promise<unknown> };
}

/**
 * Bootstrap puntual e idempotente para AMBAS identidades de emisor demo
 * (UADE y Plataforma de Cursos Demo) en una sola corrida, sin tocar
 * AcademicCourse, Program, CurriculumVersion, ProgramCourse ni el holder
 * demo. Reutiliza integramente `bootstrapDemoUadeAdmin` y
 * `bootstrapDemoCoursePlatformUser` -no reimplementa ninguna logica de
 * renombrado ni de upsert-. Pensado como el comando recomendado para
 * reparar o inicializar identidades demo contra un ambiente cloud/demo sin
 * pagar el costo (y el riesgo de corte a mitad de camino) del seed
 * completo, que ademas reseedea el catalogo academico.
 */
export async function bootstrapDemoIdentities(
  database: DemoIdentitiesDatabase,
  hashPasswordFn: (password: string) => Promise<string>
) {
  const uade = await bootstrapDemoUadeAdmin(database, hashPasswordFn);
  const course = await bootstrapDemoCoursePlatformUser(database, hashPasswordFn);

  return {
    uadeIssuerReady: uade.issuerReady,
    uadeUserReady: uade.userReady,
    uadeAuthCredentialReady: uade.authCredentialReady,
    uadeMembershipReady: uade.membershipReady,
    courseIssuerReady: course.issuerReady,
    courseUserReady: course.userReady,
    courseAuthCredentialReady: course.authCredentialReady,
    courseMembershipReady: course.membershipReady
  };
}

async function main() {
  const summary = await bootstrapDemoIdentities(prisma, hashPassword);
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main()
    .catch(() => {
      console.error(
        'El bootstrap de identidades demo (UADE + Plataforma de Cursos Demo) fallo. Revise migraciones y configuracion del ambiente.'
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
