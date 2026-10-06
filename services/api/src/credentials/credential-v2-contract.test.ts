/**
 * Contratos compartidos credential_v2 / blockchain_record_v2 -- S8c1.
 *
 * Congela los dos JSON Schema nuevos de `packages/schemas` sin agregar ninguna
 * dependencia de validacion: las aserciones son estructurales sobre el schema
 * mismo. Lo que importa frenar aca es la deriva silenciosa del contrato, en
 * particular:
 *
 *   * que `credential_v1` siga EXACTAMENTE igual (hay artifacts historicos);
 *   * que `credential_v2` EXIJA el proof -- la columna de PostgreSQL puede ser
 *     nullable, pero un artifact que se declare v2 sin proof no es valido;
 *   * que el proof tenga EXACTAMENTE las ocho claves congeladas en S8b.1, y
 *     que `created` no vuelva a aparecer;
 *   * que `evidence_mode` sea obligatorio en blockchain_record_v2, porque es
 *     justamente la procedencia que v1 no tenia.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const SCHEMAS_DIR = join(__dirname, '..', '..', '..', '..', 'packages', 'schemas');

function loadSchema(fileName: string): Record<string, any> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, fileName), 'utf8'));
}

const credentialV1 = loadSchema('credential_v1.schema.json');
const credentialV2 = loadSchema('credential_v2.schema.json');
const recordV1 = loadSchema('blockchain_record_v1.schema.json');
const recordV2 = loadSchema('blockchain_record_v2.schema.json');

// ---------------------------------------------------------------------------
// credential_v1 INTACTO
// ---------------------------------------------------------------------------

test('credential_v1 no gano proof ni cambio su schema_version', () => {
  assert.equal(credentialV1.properties.schema_version.const, 'credential_v1');
  assert.equal(credentialV1.properties.proof, undefined);
  assert.ok(!credentialV1.required.includes('proof'));

  // Sigue aceptando draft y sigue sin exigir hash: describe artifacts
  // historicos sin autenticacion del emisor.
  assert.deepEqual(credentialV1.properties.status.enum, [
    'draft',
    'issued',
    'revoked'
  ]);
  assert.ok(!credentialV1.required.includes('canonical_hash'));
});

test('blockchain_record_v1 queda intacto: sin evidence_mode', () => {
  assert.equal(recordV1.properties.schema_version.const, 'blockchain_record_v1');
  assert.equal(recordV1.properties.evidence_mode, undefined);
  assert.equal(recordV1.properties.anchor_registrant_scope, undefined);
});

// ---------------------------------------------------------------------------
// credential_v2
// ---------------------------------------------------------------------------

test('credential_v2 declara su propia version y su propio $id', () => {
  assert.equal(credentialV2.properties.schema_version.const, 'credential_v2');
  assert.equal(credentialV2.title, 'credential_v2');
  assert.match(credentialV2.$id, /credential_v2\.schema\.json$/);
  assert.notEqual(credentialV2.$id, credentialV1.$id);
});

test('credential_v2 EXIGE proof -- nulabilidad en base no es validez de contrato', () => {
  assert.ok(credentialV2.required.includes('proof'));
  assert.ok(credentialV2.properties.proof);
});

test('credential_v2 exige tambien el hash canonico y su version', () => {
  assert.ok(credentialV2.required.includes('canonical_hash'));
  assert.ok(credentialV2.required.includes('canonicalization_version'));
  assert.ok(credentialV2.required.includes('issued_at'));
  assert.ok(credentialV2.required.includes('issuer_did'));
  assert.ok(credentialV2.required.includes('subject_did'));
});

test('credential_v2 no admite draft: un artifact v2 esta emitido por definicion', () => {
  assert.deepEqual(credentialV2.properties.status.enum, ['issued', 'revoked']);
});

test('credential_v2 exige canonicalHashText en MINUSCULA', () => {
  // credential_v1 aceptaba mayusculas; S8b.1 congelo minuscula.
  assert.equal(
    credentialV2.properties.canonical_hash.pattern,
    '^0x[0-9a-f]{64}$'
  );
  assert.equal(credentialV1.properties.canonical_hash.pattern, '^0x[a-fA-F0-9]{64}$');
});

test('credential_v2 fija canon_v2 como version de canonicalizacion', () => {
  assert.equal(credentialV2.properties.canonicalization_version.const, 'canon_v2');
});

test('credential_v2 es cerrado: additionalProperties false', () => {
  assert.equal(credentialV2.additionalProperties, false);
});

// ---------------------------------------------------------------------------
// scope-proof-v1
// ---------------------------------------------------------------------------

const proof = () => credentialV2.$defs.scopeProofV1;

const FROZEN_PROOF_KEYS = [
  'canonicalizationVersion',
  'cryptosuite',
  'hashAlgorithm',
  'profile',
  'proofPurpose',
  'proofValue',
  'type',
  'verificationMethod'
];

test('el proof tiene EXACTAMENTE las ocho claves congeladas', () => {
  assert.deepEqual(
    Object.keys(proof().properties).sort(),
    FROZEN_PROOF_KEYS
  );
  assert.deepEqual(proof().required.slice().sort(), FROZEN_PROOF_KEYS);
  assert.equal(FROZEN_PROOF_KEYS.length, 8);
});

test('proof.created NO existe y no puede reintroducirse', () => {
  assert.equal(proof().properties.created, undefined);
  assert.equal(proof().additionalProperties, false);
  assert.ok(!proof().required.includes('created'));
});

test('los campos constantes del proof son literales exactos', () => {
  assert.equal(proof().properties.type.const, 'ScopeCredentialProof2026');
  assert.equal(proof().properties.profile.const, 'scope-proof-v1');
  assert.equal(proof().properties.cryptosuite.const, 'ecdsa-secp256k1-eip191');
  assert.equal(proof().properties.proofPurpose.const, 'assertionMethod');
  assert.equal(proof().properties.canonicalizationVersion.const, 'canon_v2');
  assert.equal(proof().properties.hashAlgorithm.const, 'sha-256');
});

test('proofValue: 65 bytes, hex minuscula, 0x-prefijado', () => {
  assert.equal(proof().properties.proofValue.pattern, '^0x[0-9a-f]{130}$');

  // 0x + 130 hex = 65 bytes = r(32) + s(32) + v(1).
  const sample = `0x${'ab'.repeat(65)}`;
  assert.ok(new RegExp(proof().properties.proofValue.pattern).test(sample));
  assert.ok(
    !new RegExp(proof().properties.proofValue.pattern).test(sample.toUpperCase())
  );
  assert.ok(
    !new RegExp(proof().properties.proofValue.pattern).test(`0x${'ab'.repeat(64)}`),
    'una firma de 64 bytes (sin v) debe ser rechazada'
  );
});

test('verificationMethod exige un did:web con fragmento de version', () => {
  const pattern = new RegExp(proof().properties.verificationMethod.pattern);

  assert.ok(
    pattern.test(
      'did:web:api.scopeedu.technology:did:issuers:3f2a7c18-5b94-4e61-9d0c-8a6f21b4e5d7#assert-1'
    )
  );
  assert.ok(
    pattern.test(
      'did:web:api.scopeedu.technology%3A8443:did:issuers:3f2a7c18-5b94-4e61-9d0c-8a6f21b4e5d7#assert-12'
    ),
    'un puerto codificado como %3A sigue siendo valido'
  );
  assert.ok(
    !pattern.test('did:web:api.scopeedu.technology:did:issuers:abc'),
    'sin fragmento no sirve: el proof debe nombrar la version de la clave'
  );
  assert.ok(
    !pattern.test('did:example:issuer-demo#assert-1'),
    'did:example no resuelve a ningun DID Document'
  );
  assert.ok(
    !pattern.test('did:web:host:did:issuers:abc#assert-0'),
    'las versiones de clave empiezan en 1'
  );
});

test('el proof NO se declara como W3C VC, Data Integrity ni JWS', () => {
  const serialized = JSON.stringify(credentialV2);

  assert.doesNotMatch(serialized, /DataIntegrityProof/);
  assert.doesNotMatch(serialized, /ES256K/);
  assert.doesNotMatch(serialized, /"jws"/);
  assert.doesNotMatch(serialized, /EcdsaSecp256k1Signature2019/);
});

// ---------------------------------------------------------------------------
// blockchain_record_v2
// ---------------------------------------------------------------------------

test('blockchain_record_v2 EXIGE evidence_mode', () => {
  assert.ok(recordV2.required.includes('evidence_mode'));
  assert.deepEqual(recordV2.properties.evidence_mode.enum, [
    'mock',
    'credential_registry'
  ]);
});

test('la procedencia opcional existe pero no es obligatoria', () => {
  // Opcional a proposito: en modo mock no hay deployment ni bloque, y una fila
  // legacy no tiene ninguno de los cuatro.
  for (const field of [
    'deployment_id',
    'block_number',
    'anchor_signer_profile_id',
    'anchor_registrant_scope'
  ]) {
    assert.ok(recordV2.properties[field], `${field} debe existir`);
    assert.ok(
      !recordV2.required.includes(field),
      `${field} no debe ser obligatorio`
    );
  }
});

test('anchor_registrant_scope tiene los dos valores congelados', () => {
  assert.deepEqual(recordV2.properties.anchor_registrant_scope.enum, [
    'issuer_exclusive',
    'shared_custodial'
  ]);
});

test('blockchain_record_v2 admite pending en status', () => {
  assert.deepEqual(recordV2.properties.status.enum, [
    'pending',
    'registered',
    'revoked'
  ]);
});

test('blockchain_record_v2 soporta las tres redes del enum de Prisma', () => {
  assert.deepEqual(recordV2.properties.network.enum, [
    'anvil',
    'base-sepolia',
    'base-mainnet'
  ]);
});

test('blockchain_record_v2 es cerrado y declara su propia version', () => {
  assert.equal(recordV2.additionalProperties, false);
  assert.equal(recordV2.properties.schema_version.const, 'blockchain_record_v2');
  assert.match(recordV2.$id, /blockchain_record_v2\.schema\.json$/);
});

test('ningun schema compartido admite key material', () => {
  for (const [name, schema] of [
    ['credential_v2', credentialV2],
    ['blockchain_record_v2', recordV2]
  ] as const) {
    const serialized = JSON.stringify(schema);

    for (const forbidden of [
      'privateKey',
      'private_key',
      'mnemonic',
      'seedPhrase',
      'seed_phrase',
      'secretValue',
      'passphrase'
    ]) {
      assert.doesNotMatch(
        serialized,
        new RegExp(forbidden, 'i'),
        `${name} no debe mencionar ${forbidden}`
      );
    }
  }
});
