/**
 * Verificacion independiente -- vector GOLDEN determinista.
 *
 * Reutiliza el vector congelado de S8b.1/S8c4/S8c7 (mismo `canonicalHash`, mismo
 * `proofValue`, misma JWK). Esa es la prueba de que el CLI y el servidor
 * verifican el MISMO artefacto: si cualquiera de los dos derivara, ambos
 * conjuntos de tests fallarian a la vez.
 *
 * Ningun test abre un socket: el lector del contrato es un doble que solo
 * implementa la lectura.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { PUBLIC_TEST_KEY_ONE, PUBLIC_TEST_KEY_TWO } from '../../signing/__fixtures__/signer-test-keys';
import {
  VECTOR_CANONICAL_HASH,
  VECTOR_CREDENTIAL_ID,
  VECTOR_ISSUER_DID,
  VECTOR_SUBJECT_DID,
  vectorCredentialState,
  vectorDidDocument,
  vectorProof,
  vectorVerificationMethod
} from '../__fixtures__/verified-credential.fixture';
import {
  MaterialError,
  main,
  verifyCredentialIndependently
} from './verify-credential-independently';

const CONTRACT = '0xCb7401e268f61b1242B17fE141453471CFbdc6e1';
const RPC_URL = 'https://provider.example/v2/SECRET_API_KEY';
const REGISTRANT = PUBLIC_TEST_KEY_ONE.address;

function material(overrides: { credential?: Record<string, unknown>; [key: string]: unknown } = {}) {
  const state = vectorCredentialState();
  const { credential: credentialOverrides, ...rest } = overrides;

  return {
    schema: 'scope-independent-verification-material-v1',
    credential: {
      credentialId: VECTOR_CREDENTIAL_ID,
      type: state.type,
      title: state.title,
      description: state.description,
      hours: state.hours,
      issuedAt: state.issuedAt.toISOString(),
      credentialSubject: state.credentialSubject,
      issuerDid: VECTOR_ISSUER_DID,
      subjectDid: VECTOR_SUBJECT_DID,
      ...credentialOverrides
    },
    canonicalHash: VECTOR_CANONICAL_HASH,
    proof: vectorProof(),
    chain: {
      network: 'base_sepolia',
      chainId: 84532,
      contractAddress: CONTRACT,
      registrantAddress: REGISTRANT
    },
    ...rest
  };
}

function reader(result: { kind: string; status?: Record<string, unknown> }) {
  const calls: Array<Record<string, unknown>> = [];

  return {
    calls,
    async readTargetBoundCredentialState(input: Record<string, unknown>) {
      calls.push(input);
      return result as never;
    }
  };
}

const REGISTERED = {
  kind: 'credential_state',
  status: {
    credentialHash: VECTOR_CANONICAL_HASH,
    exists: true,
    revoked: false,
    issuer: REGISTRANT,
    registeredAt: '1790000000',
    revokedAt: null
  }
};

function verify(
  mat: unknown,
  options: { didDocument?: unknown; chain?: ReturnType<typeof reader> | null; rpcUrl?: string } = {}
) {
  return verifyCredentialIndependently(mat, {
    didDocument: options.didDocument ?? vectorDidDocument(),
    registryReader: options.chain === undefined ? reader(REGISTERED) : options.chain,
    rpcUrl: 'rpcUrl' in options ? options.rpcUrl : RPC_URL
  });
}

test('vector golden + cadena registrada = VERIFIED, con las cuatro comprobaciones', async () => {
  const chain = reader(REGISTERED);
  const report = await verify(material(), { chain });

  assert.equal(report.verdict, 'VERIFIED');
  assert.equal(report.recomputedCanonicalHash, VECTOR_CANONICAL_HASH);
  assert.deepEqual(
    report.checks.map((check) => [check.id, check.status]),
    [
      ['canonical_hash_recomputed_matches', 'PASS'],
      ['proof_signature_and_did_authorization', 'PASS'],
      ['chain_registration', 'PASS']
    ]
  );

  // La cadena se consulta con el hash RECALCULADO y el registrante declarado.
  assert.equal(chain.calls.length, 1);
  assert.equal(chain.calls[0].credentialHash, VECTOR_CANONICAL_HASH);
  assert.equal(chain.calls[0].expectedRegistrant, REGISTRANT);
});

test('sin RPC solo se verifica autoria: VERIFIED_AUTHORSHIP_ONLY, nunca VERIFIED', async () => {
  const report = await verify(material(), { chain: null, rpcUrl: undefined });

  assert.equal(report.verdict, 'VERIFIED_AUTHORSHIP_ONLY');
  assert.equal(report.checks.find((check) => check.id === 'chain_registration')?.status, 'SKIPPED');
});

test('contenido alterado: el hash reconstruido no coincide, INVALID, y NO se consulta la cadena', async () => {
  const chain = reader(REGISTERED);
  const report = await verify(
    material({ credential: { title: 'Titulo alterado' } }),
    { chain }
  );

  assert.equal(report.verdict, 'INVALID');
  assert.equal(report.recomputedCanonicalHash, null);
  assert.equal(
    report.checks.find((check) => check.id === 'canonical_hash_recomputed_matches')?.status,
    'FAIL'
  );
  assert.equal(chain.calls.length, 0);
});

test('cualquier campo del contenido canonico alterado invalida', async () => {
  for (const credential of [
    { description: 'otra descripcion' },
    { hours: 61 },
    { issuedAt: '2026-03-15T10:42:18.000Z' },
    { subjectDid: `${VECTOR_SUBJECT_DID}x` },
    { credentialId: '00000000-0000-4000-8000-000000000000' },
    { credentialSubject: { ...vectorCredentialState().credentialSubject, grade: '10' } }
  ]) {
    const report = await verify(material({ credential }));

    assert.equal(report.verdict, 'INVALID', JSON.stringify(credential));
  }
});

test('un canonicalHash declarado distinto del reconstruido es INVALID', async () => {
  const report = await verify(material({ canonicalHash: `0x${'1'.repeat(64)}` }));

  assert.equal(report.verdict, 'INVALID');
});

test('una clave que el DID Document no publica o no autoriza es INVALID', async () => {
  const otherKey = vectorVerificationMethod({
    publicKeyJwk: {
      kty: 'EC',
      crv: 'secp256k1',
      kid: 'assert-1',
      x: Buffer.from(PUBLIC_TEST_KEY_TWO.publicKeyX.slice(2), 'hex').toString('base64url'),
      y: Buffer.from(PUBLIC_TEST_KEY_TWO.publicKeyY.slice(2), 'hex').toString('base64url')
    }
  });

  for (const didDocument of [
    vectorDidDocument({ verificationMethod: [], assertionMethod: [] }),
    vectorDidDocument({ assertionMethod: [] }),
    vectorDidDocument({ verificationMethod: [otherKey] })
  ]) {
    const report = await verify(material(), { didDocument });

    assert.equal(report.verdict, 'INVALID');
    assert.notEqual(
      report.checks.find((check) => check.id === 'proof_signature_and_did_authorization')?.status,
      'PASS'
    );
  }
});

test('la cadena en conflicto o ausente es CHAIN_MISMATCH aunque la firma valga', async () => {
  for (const result of [
    { kind: 'credential_missing' },
    { kind: 'credential_issuer_mismatch' },
    { kind: 'rpc_chain_id_mismatch' },
    { kind: 'contract_code_missing' }
  ]) {
    const report = await verify(material(), { chain: reader(result) });

    assert.equal(report.verdict, 'CHAIN_MISMATCH', result.kind);
    assert.equal(
      report.checks.find((check) => check.id === 'proof_signature_and_did_authorization')?.status,
      'PASS'
    );
  }
});

test('revocada on-chain se informa como REVOCADA, no como verificada', async () => {
  const report = await verify(material(), {
    chain: reader({
      kind: 'credential_state',
      status: { ...REGISTERED.status, revoked: true, revokedAt: '1790000500' }
    })
  });

  assert.equal(report.verdict, 'REVOKED_ON_CHAIN');
});

test('RPC no disponible no invalida: queda en solo-autoria', async () => {
  for (const kind of ['rpc_unavailable', 'registry_read_failed', 'record_deployment_mismatch']) {
    const report = await verify(material(), { chain: reader({ kind }) });

    assert.equal(report.verdict, 'VERIFIED_AUTHORSHIP_ONLY', kind);
  }

  const throwing = {
    async readTargetBoundCredentialState() {
      throw new Error(RPC_URL);
    }
  };
  const report = await verify(material(), { chain: throwing as never });

  assert.equal(report.verdict, 'VERIFIED_AUTHORSHIP_ONLY');
  assert.equal(JSON.stringify(report).includes('SECRET_API_KEY'), false);
});

test('una red/chainId no soportada en el material no se consulta', async () => {
  const chain = reader(REGISTERED);
  const report = await verify(
    material({ chain: { network: 'base_sepolia', chainId: 1, contractAddress: CONTRACT, registrantAddress: REGISTRANT } }),
    { chain }
  );

  assert.equal(report.verdict, 'CHAIN_MISMATCH');
  assert.equal(chain.calls.length, 0);
});

test('el informe nunca incluye el RPC ni el material sensible', async () => {
  const report = await verify(material());
  const serialized = JSON.stringify(report);

  for (const forbidden of [RPC_URL, 'SECRET_API_KEY', 'provider.example', 'privateKey', 'secretRef']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('el material invalido se rechaza con un error claro', async () => {
  const cases: unknown[] = [
    null,
    {},
    { ...material(), schema: 'otro' },
    { ...material(), canonicalHash: '0x1234' },
    { ...material(), proof: null },
    material({ credential: { issuerDid: 'did:example:issuer' } }),
    { ...material(), chain: { network: 'base_sepolia' } },
    material({ credential: { issuedAt: 'no-es-fecha' } })
  ];

  for (const bad of cases) {
    await assert.rejects(() => verify(bad), MaterialError);
  }
});

test('el CLI exige --material', async () => {
  await assert.rejects(() => main([]), MaterialError);
  await assert.rejects(() => main(['--material']), MaterialError);
});

test('estructural: no usa base de datos, AWS, secretos ni escritura de cadena', () => {
  const source = readFileSync(join(__dirname, 'verify-credential-independently.ts'), 'utf8');

  for (const forbidden of [
    'PrismaService',
    'PrismaClient',
    '@aws-sdk',
    'SSMClient',
    'IssuerSignerResolver',
    'secretRef',
    'AnchorWriteCoordinator',
    'CredentialRegistryWriteClient',
    'sendTransaction',
    'registerCredential(',
    'revokeCredential(',
    'new Wallet',
    'PRIVATE_KEY',
    'process.env.AWS'
  ]) {
    assert.equal(source.includes(forbidden), false, `no debe contener ${forbidden}`);
  }

  // El unico env que lee es el RPC, y no se imprime.
  assert.deepEqual(source.match(/process\.env\.[A-Z_]+/g), [
    'process.env.CREDENTIAL_REGISTRY_RPC_URL'
  ]);
  assert.equal(/console\.(log|error)\([^)]*rpcUrl/i.test(source), false);
});
