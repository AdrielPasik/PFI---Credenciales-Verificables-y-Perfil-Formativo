import {
  IssuerAuthorizationStatus,
  IssuerMembershipRole,
  IssuerMembershipStatus,
  PrismaClient,
  UserStatus
} from '@prisma/client';

const prisma = new PrismaClient();

const FIXED_TIMESTAMP = new Date('2026-01-01T00:00:00.000Z');

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

  console.log(
    JSON.stringify(
      {
        issuerId: issuer.id,
        holderUserId: holder.id,
        issuerAdminUserId: issuerAdmin.id
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
