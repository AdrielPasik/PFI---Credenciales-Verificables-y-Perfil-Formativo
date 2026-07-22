import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException
} from '@nestjs/common';
import {
  CredentialStatus,
  UserStatus
} from '@prisma/client';

import { CredentialsService } from './credentials.service';

const currentUser = {
  id: 'issuer-user-1',
  email: 'issuer.admin@example.com',
  did: 'did:example:issuer-admin-demo',
  status: UserStatus.active
} as const;

function createCredentialFixture(overrides?: Partial<CredentialFixture>) {
  return {
    id: 'cred-123',
    schemaVersion: 'credential_v1',
    type: 'academic_subject',
    issuerId: 'issuer-1',
    subjectUserId: 'holder-1',
    title: 'Algoritmos y Estructuras de Datos',
    description: 'Asignatura aprobada',
    sourceType: 'manual_issuer',
    status: CredentialStatus.draft,
    hours: {
      toFixed() {
        return '96.00';
      }
    },
    issuedAt: null,
    revokedAt: null,
    canonicalHash: null,
    canonicalizationVersion: null,
    credentialSubject: {
      achievement_name: 'Algoritmos y Estructuras de Datos',
      institution_name: 'Demo University',
      skills: ['algoritmos', 'programacion']
    },
    academicCourseId: null,
    externalCourseId: null,
    metadata: null,
    rawData: null,
    createdAt: new Date('2026-07-22T17:00:00Z'),
    updatedAt: new Date('2026-07-22T17:00:00Z'),
    issuer: {
      id: 'issuer-1',
      did: 'did:example:issuer-demo',
      walletAddress: '0x00000000000000000000000000000000000000aa',
      authorizationStatus: 'authorized'
    },
    subjectUser: {
      id: 'holder-1',
      did: 'did:example:holder-demo'
    },
    ...overrides
  } satisfies CredentialFixture;
}

type CredentialFixture = {
  id: string;
  schemaVersion: string;
  type: string;
  issuerId: string;
  subjectUserId: string;
  title: string;
  description: string | null;
  sourceType: string;
  status: CredentialStatus;
  hours: { toFixed: () => string } | null;
  issuedAt: Date | null;
  revokedAt: Date | null;
  canonicalHash: string | null;
  canonicalizationVersion: string | null;
  credentialSubject: Record<string, unknown>;
  academicCourseId: string | null;
  externalCourseId: string | null;
  metadata: Record<string, unknown> | null;
  rawData: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  issuer: {
    id: string;
    did: string | null;
    walletAddress: string | null;
    authorizationStatus: string;
  };
  subjectUser: {
    id: string;
    did: string | null;
  };
};

function createService(options?: {
  credential?: CredentialFixture | null;
  assertUserCanIssueForIssuer?: (
    userId: string,
    issuerId: string
  ) => Promise<unknown>;
  assertIssuerCanIssue?: (issuer: CredentialFixture['issuer']) => void;
}) {
  const credential = options?.credential ?? createCredentialFixture();
  const issueMembershipCalls: Array<Record<string, unknown>> = [];
  const issuerEligibilityCalls: Array<Record<string, unknown>> = [];
  const hashCalls: Array<Record<string, unknown>> = [];
  const blockchainCalls: Array<Record<string, unknown>> = [];

  const prisma = {
    credential: {
      async findUnique() {
        return credential;
      }
    },
    $transaction: async (
      callback: (transaction: {
        credential: {
          update(args: Record<string, unknown>): Promise<Record<string, unknown>>;
        };
      }) => Promise<unknown>
    ) =>
      callback({
        credential: {
          async update(args: Record<string, unknown>) {
            return {
              ...(credential as CredentialFixture),
              status: CredentialStatus.issued,
              issuedAt: (args.data as Record<string, unknown>).issuedAt as Date,
              canonicalHash: (args.data as Record<string, unknown>).canonicalHash,
              canonicalizationVersion: (args.data as Record<string, unknown>)
                .canonicalizationVersion
            };
          }
        }
      })
  };

  const issuersService = {
    async assertUserCanIssueForIssuer(userId: string, issuerId: string) {
      issueMembershipCalls.push({ userId, issuerId });
      if (options?.assertUserCanIssueForIssuer) {
        return options.assertUserCanIssueForIssuer(userId, issuerId);
      }

      return {
        id: 'membership-1'
      };
    },
    assertIssuerCanIssue(issuer: CredentialFixture['issuer']) {
      issuerEligibilityCalls.push({ issuer });
      options?.assertIssuerCanIssue?.(issuer);
    }
  };

  const blockchainEvidenceService = {
    async createRecord(
      _transaction: unknown,
      payload: Record<string, unknown>
    ) {
      blockchainCalls.push(payload);
      return {
        id: 'blockchain-record-1',
        network: 'anvil',
        chainId: 31337,
        status: 'registered',
        credentialHash: payload.credentialHash,
        hashAlgorithm: 'sha-256',
        canonicalizationVersion: payload.canonicalizationVersion,
        contractAddress: '0x0000000000000000000000000000000000000001',
        txHash: '0x' + '1'.repeat(64),
        issuerAddress: payload.issuerAddress,
        registeredAt: new Date('2026-07-22T18:00:00Z')
      };
    }
  };

  const credentialHashingService = {
    createCanonicalHash(input: Record<string, unknown>) {
      hashCalls.push(input);
      return {
        canonicalHash: '0x' + 'a'.repeat(64),
        canonicalizationVersion: 'canon_v1',
        canonicalJson: '{"mock":"canonical"}'
      };
    }
  };

  return {
    service: new CredentialsService(
      prisma as never,
      issuersService as never,
      blockchainEvidenceService as never,
      credentialHashingService as never
    ),
    issueMembershipCalls,
    issuerEligibilityCalls,
    hashCalls,
    blockchainCalls
  };
}

test('CredentialsService rejects issuerId mismatches from the request body', async () => {
  const { service } = createService();

  await assert.rejects(
    service.issueCredential(
      'cred-123',
      {
        issuerId: 'issuer-other',
        issuedAt: '2026-07-22T18:00:00Z'
      },
      currentUser
    ),
    BadRequestException
  );
});

test('CredentialsService rejects users without issuer membership', async () => {
  const { service, hashCalls, blockchainCalls } = createService({
    async assertUserCanIssueForIssuer() {
      throw new ForbiddenException(
        'El usuario issuer-user-1 no tiene membresia para emitir sobre el issuer issuer-1.'
      );
    }
  });

  await assert.rejects(
    service.issueCredential(
      'cred-123',
      {
        issuerId: 'issuer-1',
        issuedAt: '2026-07-22T18:00:00Z'
      },
      currentUser
    ),
    ForbiddenException
  );

  assert.equal(hashCalls.length, 0);
  assert.equal(blockchainCalls.length, 0);
});

test('CredentialsService rejects inactive issuer memberships', async () => {
  const { service, hashCalls, blockchainCalls } = createService({
    async assertUserCanIssueForIssuer() {
      throw new ForbiddenException(
        'La membresia del usuario issuer-user-1 para el issuer issuer-1 no esta activa.'
      );
    }
  });

  await assert.rejects(
    service.issueCredential(
      'cred-123',
      {
        issuerId: 'issuer-1',
        issuedAt: '2026-07-22T18:00:00Z'
      },
      currentUser
    ),
    ForbiddenException
  );

  assert.equal(hashCalls.length, 0);
  assert.equal(blockchainCalls.length, 0);
});

test('CredentialsService rejects issuer memberships with non-emitting roles', async () => {
  const { service, hashCalls, blockchainCalls } = createService({
    async assertUserCanIssueForIssuer() {
      throw new ForbiddenException(
        'El rol viewer no tiene permisos para emitir sobre el issuer issuer-1.'
      );
    }
  });

  await assert.rejects(
    service.issueCredential(
      'cred-123',
      {
        issuerId: 'issuer-1',
        issuedAt: '2026-07-22T18:00:00Z'
      },
      currentUser
    ),
    ForbiddenException
  );

  assert.equal(hashCalls.length, 0);
  assert.equal(blockchainCalls.length, 0);
});

test('CredentialsService allows an active issuer admin and preserves hashing/blockchain flow', async () => {
  const { service, issueMembershipCalls, issuerEligibilityCalls, hashCalls, blockchainCalls } =
    createService();

  const response = await service.issueCredential(
    'cred-123',
    {
      issuerId: 'issuer-1',
      issuedAt: '2026-07-22T18:00:00.456Z'
    },
    currentUser
  );

  assert.deepEqual(issueMembershipCalls, [
    {
      userId: 'issuer-user-1',
      issuerId: 'issuer-1'
    }
  ]);
  assert.equal(issuerEligibilityCalls.length, 1);
  assert.equal(hashCalls.length, 1);
  assert.equal(blockchainCalls.length, 1);
  assert.equal(hashCalls[0].issuerDid, 'did:example:issuer-demo');
  assert.equal(hashCalls[0].subjectDid, 'did:example:holder-demo');
  assert.equal(hashCalls[0].title, 'Algoritmos y Estructuras de Datos');
  assert.equal(
    (hashCalls[0].issuedAt as Date).toISOString(),
    '2026-07-22T18:00:00.000Z'
  );
  assert.deepEqual(blockchainCalls[0], {
    credentialId: 'cred-123',
    credentialHash: '0x' + 'a'.repeat(64),
    canonicalizationVersion: 'canon_v1',
    issuerAddress: '0x00000000000000000000000000000000000000aa'
  });
  assert.equal(response.status, 'issued');
  assert.equal(response.canonicalHash, '0x' + 'a'.repeat(64));
  assert.equal(response.canonicalizationVersion, 'canon_v1');
  assert.equal(response.latestBlockchainRecord?.status, 'registered');
});

test('CredentialsService still rejects credentials that are not in draft', async () => {
  const { service } = createService({
    credential: createCredentialFixture({
      status: CredentialStatus.issued
    })
  });

  await assert.rejects(
    service.issueCredential(
      'cred-123',
      {
        issuerId: 'issuer-1',
        issuedAt: '2026-07-22T18:00:00Z'
      },
      currentUser
    ),
    ConflictException
  );
});
