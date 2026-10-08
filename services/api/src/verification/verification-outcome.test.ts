/**
 * ESTADO y TITULAR -- S8c7, matriz 42-58.
 *
 * Funciones puras: sin Prisma, sin red, sin reloj. Los casos se recorren por
 * TABLA y se cubren TODAS las combinaciones alcanzables de los tres enums, mas
 * las defensivas que el modelo declara imposibles.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { CredentialStatus } from '@prisma/client';

import {
  BLOCKCHAIN_EVIDENCE_VALUES,
  CREDENTIAL_AUTHENTICITY_VALUES,
  VERIFICATION_CREDENTIAL_STATUS_VALUES,
  VERIFICATION_HEADLINE_VALUES,
  type BlockchainEvidence,
  type CredentialAuthenticity,
  type VerificationCredentialStatus,
  type VerificationHeadline,
  deriveCredentialStatus,
  deriveLegacyVerificationResult,
  deriveVerificationHeadline
} from './verification-outcome';

// ---------------------------------------------------------------------------
// VALORES SERIALIZADOS CONGELADOS
// ---------------------------------------------------------------------------

test('los cuatro enums publicos estan congelados', () => {
  assert.deepEqual(CREDENTIAL_AUTHENTICITY_VALUES, [
    'VERIFIED',
    'INVALID',
    'INDETERMINATE'
  ]);
  assert.deepEqual(VERIFICATION_CREDENTIAL_STATUS_VALUES, [
    'ACTIVE',
    'REVOKED',
    'UNKNOWN'
  ]);
  assert.deepEqual(BLOCKCHAIN_EVIDENCE_VALUES, [
    'REGISTERED',
    'PENDING',
    'REVOKED_ON_CHAIN',
    'NOT_FOUND',
    'UNAVAILABLE',
    'NOT_APPLICABLE_MOCK',
    'REGISTRANT_UNEXPECTED'
  ]);
  assert.deepEqual(VERIFICATION_HEADLINE_VALUES, [
    'VERIFIED',
    'VERIFIED_WITH_LIMITED_EVIDENCE',
    'INVALID',
    'REVOKED',
    'INDETERMINATE'
  ]);
});

// ---------------------------------------------------------------------------
// 42-47: ESTADO
// ---------------------------------------------------------------------------

test('42-44: `issued` es ACTIVE para toda evidencia que no sea revocacion', () => {
  for (const blockchainEvidence of BLOCKCHAIN_EVIDENCE_VALUES) {
    if (blockchainEvidence === 'REVOKED_ON_CHAIN') {
      continue;
    }

    assert.equal(
      deriveCredentialStatus({
        persistedStatus: CredentialStatus.issued,
        blockchainEvidence
      }),
      'ACTIVE',
      blockchainEvidence
    );
  }
});

test('43: una indisponibilidad del RPC NO degrada ACTIVE a UNKNOWN', () => {
  // Es la regla central: "no se pudo observar" != "no se sabe nada".
  assert.equal(
    deriveCredentialStatus({
      persistedStatus: CredentialStatus.issued,
      blockchainEvidence: 'UNAVAILABLE'
    }),
    'ACTIVE'
  );
});

test('45: una revocacion OBSERVADA en la cadena gana sobre un `issued` local', () => {
  // Monotonia: la evidencia positiva de revocacion se adopta aunque la fila
  // local todavia no se haya puesto al dia. Y no se escribe nada.
  assert.equal(
    deriveCredentialStatus({
      persistedStatus: CredentialStatus.issued,
      blockchainEvidence: 'REVOKED_ON_CHAIN'
    }),
    'REVOKED'
  );
});

test('46: `revoked` local sigue REVOKED con cualquier resultado de cadena', () => {
  // La direccion contraria no existe: una cadena que dice "no revocada" no
  // resucita una credencial que el emisor revoco.
  for (const blockchainEvidence of BLOCKCHAIN_EVIDENCE_VALUES) {
    assert.equal(
      deriveCredentialStatus({
        persistedStatus: CredentialStatus.revoked,
        blockchainEvidence
      }),
      'REVOKED',
      blockchainEvidence
    );
  }
});

test('47: un estado interno inesperado es UNKNOWN, no se adivina', () => {
  for (const blockchainEvidence of BLOCKCHAIN_EVIDENCE_VALUES) {
    if (blockchainEvidence === 'REVOKED_ON_CHAIN') {
      continue;
    }

    assert.equal(
      deriveCredentialStatus({
        persistedStatus: CredentialStatus.draft,
        blockchainEvidence
      }),
      'UNKNOWN',
      blockchainEvidence
    );

    assert.equal(
      deriveCredentialStatus({
        persistedStatus: 'futuro' as CredentialStatus,
        blockchainEvidence
      }),
      'UNKNOWN',
      blockchainEvidence
    );
  }
});

// ---------------------------------------------------------------------------
// 48-58: TITULAR, POR TABLA
// ---------------------------------------------------------------------------

type HeadlineCase = [
  string,
  CredentialAuthenticity,
  VerificationCredentialStatus,
  BlockchainEvidence,
  VerificationHeadline
];

const HEADLINE_MATRIX: HeadlineCase[] = [
  // 48-53: autenticidad verificada y credencial vigente.
  ['48', 'VERIFIED', 'ACTIVE', 'REGISTERED', 'VERIFIED'],
  ['49', 'VERIFIED', 'ACTIVE', 'PENDING', 'VERIFIED_WITH_LIMITED_EVIDENCE'],
  ['50', 'VERIFIED', 'ACTIVE', 'NOT_FOUND', 'VERIFIED_WITH_LIMITED_EVIDENCE'],
  ['51', 'VERIFIED', 'ACTIVE', 'UNAVAILABLE', 'VERIFIED_WITH_LIMITED_EVIDENCE'],
  ['52', 'VERIFIED', 'ACTIVE', 'NOT_APPLICABLE_MOCK', 'VERIFIED_WITH_LIMITED_EVIDENCE'],
  ['53', 'VERIFIED', 'ACTIVE', 'REGISTRANT_UNEXPECTED', 'INDETERMINATE'],

  // 54: revocada, con cualquier evidencia.
  ['54a', 'VERIFIED', 'REVOKED', 'REGISTERED', 'REVOKED'],
  ['54b', 'VERIFIED', 'REVOKED', 'REVOKED_ON_CHAIN', 'REVOKED'],
  ['54c', 'VERIFIED', 'REVOKED', 'UNAVAILABLE', 'REVOKED'],
  ['54d', 'VERIFIED', 'REVOKED', 'NOT_FOUND', 'REVOKED'],
  ['54e', 'VERIFIED', 'REVOKED', 'PENDING', 'REVOKED'],
  ['54f', 'VERIFIED', 'REVOKED', 'NOT_APPLICABLE_MOCK', 'REVOKED'],
  ['54g', 'VERIFIED', 'REVOKED', 'REGISTRANT_UNEXPECTED', 'REVOKED'],

  // 55: autenticidad indeterminada y credencial vigente.
  ['55a', 'INDETERMINATE', 'ACTIVE', 'REGISTERED', 'INDETERMINATE'],
  ['55b', 'INDETERMINATE', 'ACTIVE', 'PENDING', 'INDETERMINATE'],
  ['55c', 'INDETERMINATE', 'ACTIVE', 'NOT_FOUND', 'INDETERMINATE'],
  ['55d', 'INDETERMINATE', 'ACTIVE', 'UNAVAILABLE', 'INDETERMINATE'],
  ['55e', 'INDETERMINATE', 'ACTIVE', 'NOT_APPLICABLE_MOCK', 'INDETERMINATE'],
  ['55f', 'INDETERMINATE', 'ACTIVE', 'REGISTRANT_UNEXPECTED', 'INDETERMINATE'],

  // 56: indeterminada PERO revocada -> la revocacion es el titular accionable.
  ['56a', 'INDETERMINATE', 'REVOKED', 'REGISTERED', 'REVOKED'],
  ['56b', 'INDETERMINATE', 'REVOKED', 'UNAVAILABLE', 'REVOKED'],
  ['56c', 'INDETERMINATE', 'REVOKED', 'REVOKED_ON_CHAIN', 'REVOKED'],

  // 57-58: INVALID gana siempre.
  ['57', 'INVALID', 'ACTIVE', 'REGISTERED', 'INVALID'],
  ['58', 'INVALID', 'REVOKED', 'REVOKED_ON_CHAIN', 'INVALID'],
  ['58b', 'INVALID', 'UNKNOWN', 'UNAVAILABLE', 'INVALID'],
  ['58c', 'INVALID', 'ACTIVE', 'NOT_APPLICABLE_MOCK', 'INVALID'],

  // Estado desconocido con autenticidad verificada.
  ['unknown-a', 'VERIFIED', 'UNKNOWN', 'REGISTERED', 'INDETERMINATE'],
  ['unknown-b', 'VERIFIED', 'UNKNOWN', 'UNAVAILABLE', 'INDETERMINATE'],

  // DEFENSIVO: el modelo declara esta fila imposible -- `deriveCredentialStatus`
  // ya convirtio REVOKED_ON_CHAIN en REVOKED -- y aun asi no cae en "evidencia
  // limitada", que seria mentir.
  ['defensivo', 'VERIFIED', 'ACTIVE', 'REVOKED_ON_CHAIN', 'REVOKED']
];

test('48-58: la matriz de titulares es la congelada', () => {
  for (const [label, authenticity, status, blockchainEvidence, expected] of HEADLINE_MATRIX) {
    assert.equal(
      deriveVerificationHeadline({ authenticity, status, blockchainEvidence }),
      expected,
      `${label}: ${authenticity} + ${status} + ${blockchainEvidence}`
    );
  }
});

test('TODAS las combinaciones de los tres enums producen un titular valido', () => {
  // 3 x 3 x 7 = 63 combinaciones, incluidas las inalcanzables. Ninguna cae en
  // `undefined` por un `switch` incompleto.
  let combinations = 0;

  for (const authenticity of CREDENTIAL_AUTHENTICITY_VALUES) {
    for (const status of VERIFICATION_CREDENTIAL_STATUS_VALUES) {
      for (const blockchainEvidence of BLOCKCHAIN_EVIDENCE_VALUES) {
        const headline = deriveVerificationHeadline({
          authenticity,
          status,
          blockchainEvidence
        });

        assert.ok(
          VERIFICATION_HEADLINE_VALUES.includes(headline),
          `${authenticity}/${status}/${blockchainEvidence}`
        );
        combinations += 1;
      }
    }
  }

  assert.equal(combinations, 63);
});

test('la blockchain NUNCA puede producir por si sola un titular VERIFIED', () => {
  // Con autenticidad que no sea VERIFIED, ningun resultado de cadena -- ni
  // REGISTERED -- alcanza el titular pleno.
  for (const authenticity of ['INVALID', 'INDETERMINATE'] as const) {
    for (const status of VERIFICATION_CREDENTIAL_STATUS_VALUES) {
      for (const blockchainEvidence of BLOCKCHAIN_EVIDENCE_VALUES) {
        const headline = deriveVerificationHeadline({
          authenticity,
          status,
          blockchainEvidence
        });

        assert.notEqual(headline, 'VERIFIED');
        assert.notEqual(headline, 'VERIFIED_WITH_LIMITED_EVIDENCE');
      }
    }
  }
});

test('INVALID tiene la precedencia mas alta, incluso sobre una revocacion', () => {
  // Una credencial manipulada no se titula REVOKED: eso insinuaria que fue
  // valida y despues se revoco.
  for (const status of VERIFICATION_CREDENTIAL_STATUS_VALUES) {
    for (const blockchainEvidence of BLOCKCHAIN_EVIDENCE_VALUES) {
      assert.equal(
        deriveVerificationHeadline({
          authenticity: 'INVALID',
          status,
          blockchainEvidence
        }),
        'INVALID'
      );
    }
  }
});

test('un mock JAMAS produce el titular VERIFIED pleno', () => {
  assert.equal(
    deriveVerificationHeadline({
      authenticity: 'VERIFIED',
      status: 'ACTIVE',
      blockchainEvidence: 'NOT_APPLICABLE_MOCK'
    }),
    'VERIFIED_WITH_LIMITED_EVIDENCE'
  );
});

// ---------------------------------------------------------------------------
// PROYECCION DE COMPATIBILIDAD
// ---------------------------------------------------------------------------

test('60: `verification.result` es una proyeccion del TITULAR, nada mas', () => {
  assert.equal(deriveLegacyVerificationResult('REVOKED'), 'revoked');
  assert.equal(deriveLegacyVerificationResult('VERIFIED'), 'valid_issued');
  assert.equal(
    deriveLegacyVerificationResult('VERIFIED_WITH_LIMITED_EVIDENCE'),
    'valid_issued'
  );
  assert.equal(deriveLegacyVerificationResult('INVALID'), 'not_verifiable');
  assert.equal(deriveLegacyVerificationResult('INDETERMINATE'), 'not_verifiable');
});

test('la proyeccion legacy solo produce los TRES valores que el web valida', () => {
  // Un cuarto valor rompe el adaptador desplegado con IncompatiblePayloadError.
  const produced = new Set(
    VERIFICATION_HEADLINE_VALUES.map((headline) =>
      deriveLegacyVerificationResult(headline)
    )
  );

  assert.deepEqual(
    [...produced].sort(),
    ['not_verifiable', 'revoked', 'valid_issued']
  );
});

test('la proyeccion legacy es total: ningun titular queda sin mapear', () => {
  for (const headline of VERIFICATION_HEADLINE_VALUES) {
    assert.ok(
      typeof deriveLegacyVerificationResult(headline) === 'string',
      headline
    );
  }
});
