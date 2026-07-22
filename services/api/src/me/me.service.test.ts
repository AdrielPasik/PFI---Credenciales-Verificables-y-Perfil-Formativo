import assert from 'node:assert/strict';
import test from 'node:test';

import { NotFoundException } from '@nestjs/common';

import { MeService } from './me.service';

function decimalLike(value: string) {
  return {
    toString() {
      return value;
    }
  };
}

test('MeService lists only holder credentials with issued/revoked status and omits rawData', async () => {
  const findManyCalls: Array<Record<string, unknown>> = [];
  const service = new MeService({
    credential: {
      async findMany(args: Record<string, unknown>) {
        findManyCalls.push(args);
        return [
          {
            id: 'cred-issued',
            title: 'Issued credential',
            type: 'academic_subject',
            status: 'issued',
            issuedAt: new Date('2026-07-22T19:00:00Z'),
            revokedAt: null,
            canonicalHash: '0x' + '1'.repeat(64),
            canonicalizationVersion: 'canon_v1',
            rawData: { hidden: true },
            issuer: {
              id: 'issuer-1',
              name: 'Demo University',
              did: 'did:example:issuer-demo'
            },
            blockchainRecords: [
              {
                id: 'record-1',
                network: 'anvil',
                chainId: 31337,
                txHash: '0x' + '2'.repeat(64),
                status: 'registered',
                registeredAt: new Date('2026-07-22T19:10:00Z')
              }
            ],
            semanticAnalyses: [
              {
                id: 'sem-1',
                status: 'completed',
                confidence: decimalLike('0.8750'),
                analyzedAt: new Date('2026-07-22T19:20:00Z')
              }
            ]
          }
        ];
      },
      async findFirst() {
        return null;
      }
    }
  } as never);

  const response = await service.listCredentialsForUser('holder-1');

  assert.deepEqual(findManyCalls, [
    {
      where: {
        subjectUserId: 'holder-1',
        status: {
          in: ['issued', 'revoked']
        }
      },
      include: {
        issuer: {
          select: {
            id: true,
            name: true,
            did: true
          }
        },
        blockchainRecords: {
          orderBy: {
            registeredAt: 'desc'
          },
          take: 1
        },
        semanticAnalyses: {
          orderBy: {
            analyzedAt: 'desc'
          },
          take: 1
        }
      },
      orderBy: [
        {
          issuedAt: 'desc'
        },
        {
          createdAt: 'desc'
        }
      ]
    }
  ]);

  assert.deepEqual(response, [
    {
      id: 'cred-issued',
      title: 'Issued credential',
      type: 'academic_subject',
      status: 'issued',
      issuer: {
        id: 'issuer-1',
        name: 'Demo University',
        did: 'did:example:issuer-demo'
      },
      issuedAt: '2026-07-22T19:00:00Z',
      revokedAt: null,
      canonicalHash: '0x' + '1'.repeat(64),
      canonicalizationVersion: 'canon_v1',
      latestBlockchainRecord: {
        id: 'record-1',
        network: 'anvil',
        chainId: 31337,
        txHash: '0x' + '2'.repeat(64),
        status: 'registered',
        registeredAt: '2026-07-22T19:10:00Z'
      },
      latestSemanticAnalysis: {
        id: 'sem-1',
        status: 'completed',
        confidence: 0.875,
        analyzedAt: '2026-07-22T19:20:00Z'
      }
    }
  ]);
  assert.equal('rawData' in response[0], false);
});

test('MeService returns an empty list for issuer admin without holder credentials', async () => {
  const service = new MeService({
    credential: {
      async findMany() {
        return [];
      },
      async findFirst() {
        return null;
      }
    }
  } as never);

  const response = await service.listCredentialsForUser('issuer-admin-user');
  assert.deepEqual(response, []);
});

test('MeService returns detail for holder-owned issued credential and does not expose rawData', async () => {
  const findFirstCalls: Array<Record<string, unknown>> = [];
  const service = new MeService({
    credential: {
      async findMany() {
        return [];
      },
      async findFirst(args: Record<string, unknown>) {
        findFirstCalls.push(args);
        return {
          id: 'cred-1',
          schemaVersion: 'credential_v1',
          type: 'academic_subject',
          title: 'Detalle credencial',
          description: 'Descripcion demo',
          status: 'issued',
          issuedAt: new Date('2026-07-22T19:00:00Z'),
          revokedAt: null,
          revocationReason: null,
          canonicalHash: '0x' + '3'.repeat(64),
          canonicalizationVersion: 'canon_v1',
          credentialSubject: {
            achievement_name: 'Detalle credencial',
            institution_name: 'Demo University'
          },
          metadata: {
            audience: 'holder'
          },
          rawData: {
            hidden: true
          },
          issuer: {
            id: 'issuer-1',
            name: 'Demo University',
            did: 'did:example:issuer-demo'
          },
          subjectUser: {
            id: 'holder-1',
            did: 'did:example:holder-demo',
            email: 'holder.demo@example.com',
            displayName: 'Demo Holder'
          },
          blockchainRecords: [
            {
              id: 'record-1',
              network: 'anvil',
              chainId: 31337,
              contractAddress: '0x0000000000000000000000000000000000000001',
              txHash: '0x' + '4'.repeat(64),
              issuerAddress: '0x00000000000000000000000000000000000000aa',
              status: 'registered',
              registeredAt: new Date('2026-07-22T19:10:00Z'),
              revokedAt: null
            }
          ],
          semanticAnalyses: [
            {
              id: 'sem-1',
              schemaVersion: 'semantic_analysis_v1',
              status: 'completed',
              pipelineVersion: 'pipeline-v1',
              taxonomyVersion: 'taxonomy-v1',
              confidence: decimalLike('0.9200'),
              areas: [{ id: 'software_engineering' }],
              skills: [{ id: 'typescript' }],
              concepts: [{ id: 'oop' }],
              qualityFlags: ['area_assignment_confident'],
              analyzedAt: new Date('2026-07-22T19:20:00Z')
            }
          ]
        };
      }
    }
  } as never);

  const response = await service.getCredentialForUser('holder-1', 'cred-1');

  assert.deepEqual(findFirstCalls, [
    {
      where: {
        id: 'cred-1',
        subjectUserId: 'holder-1',
        status: {
          in: ['issued', 'revoked']
        }
      },
      include: {
        issuer: {
          select: {
            id: true,
            name: true,
            did: true
          }
        },
        subjectUser: {
          select: {
            id: true,
            did: true,
            email: true,
            displayName: true
          }
        },
        blockchainRecords: {
          orderBy: {
            registeredAt: 'desc'
          }
        },
        semanticAnalyses: {
          orderBy: {
            analyzedAt: 'desc'
          },
          take: 1
        }
      }
    }
  ]);

  assert.deepEqual(response, {
    id: 'cred-1',
    schemaVersion: 'credential_v1',
    type: 'academic_subject',
    title: 'Detalle credencial',
    description: 'Descripcion demo',
    status: 'issued',
    issuer: {
      id: 'issuer-1',
      name: 'Demo University',
      did: 'did:example:issuer-demo'
    },
    subject: {
      id: 'holder-1',
      did: 'did:example:holder-demo',
      email: 'holder.demo@example.com',
      displayName: 'Demo Holder'
    },
    issuedAt: '2026-07-22T19:00:00Z',
    revokedAt: null,
    revocationReason: null,
    canonicalHash: '0x' + '3'.repeat(64),
    canonicalizationVersion: 'canon_v1',
    credentialSubject: {
      achievement_name: 'Detalle credencial',
      institution_name: 'Demo University'
    },
    metadata: {
      audience: 'holder'
    },
    blockchainRecords: [
      {
        id: 'record-1',
        network: 'anvil',
        chainId: 31337,
        contractAddress: '0x0000000000000000000000000000000000000001',
        txHash: '0x' + '4'.repeat(64),
        issuerAddress: '0x00000000000000000000000000000000000000aa',
        status: 'registered',
        registeredAt: '2026-07-22T19:10:00Z',
        revokedAt: null
      }
    ],
    latestSemanticAnalysis: {
      id: 'sem-1',
      schemaVersion: 'semantic_analysis_v1',
      status: 'completed',
      pipelineVersion: 'pipeline-v1',
      taxonomyVersion: 'taxonomy-v1',
      confidence: 0.92,
      areas: [{ id: 'software_engineering' }],
      skills: [{ id: 'typescript' }],
      concepts: [{ id: 'oop' }],
      qualityFlags: ['area_assignment_confident'],
      analyzedAt: '2026-07-22T19:20:00Z'
    }
  });
  assert.equal('rawData' in response, false);
});

test('MeService returns 404 when credential does not exist or is not visible for holder', async () => {
  const service = new MeService({
    credential: {
      async findMany() {
        return [];
      },
      async findFirst() {
        return null;
      }
    }
  } as never);

  await assert.rejects(
    service.getCredentialForUser('holder-1', 'cred-missing'),
    NotFoundException
  );
});
