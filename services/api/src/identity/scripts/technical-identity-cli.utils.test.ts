import assert from 'node:assert/strict';
import test from 'node:test';

import { TechnicalProvisioningError } from '../technical-identity-provisioning.service';
import { CliUsageError, describeCliError, parseCliArgs } from './technical-identity-cli.utils';

/** CLI de operacion S8c9: banderas allowlist y salida segura. */

test('L1 set-capabilities: tipos y lista vacia', () => {
  assert.deepEqual(parseCliArgs('set-capabilities', ['--issuer', 'i', '--types', 'course,degree']), {
    kind: 'set-capabilities',
    issuerId: 'i',
    credentialTypes: ['course', 'degree']
  });
  assert.deepEqual(
    parseCliArgs('set-capabilities', ['--issuer', 'i', '--types', '']).kind === 'set-capabilities' &&
      (parseCliArgs('set-capabilities', ['--issuer', 'i', '--types', '']) as { credentialTypes: string[] }).credentialTypes,
    []
  );
});

test('L2 provision: anchor nuevo por defecto, compartido explicito', () => {
  const fresh = parseCliArgs('provision', ['--issuer', 'i', '--types', 'course']);
  assert.deepEqual((fresh as { anchor: unknown }).anchor, { kind: 'new' });
  const shared = parseCliArgs('provision', ['--issuer', 'i', '--types', '', '--shared-anchor', 'p']);
  assert.deepEqual((shared as { anchor: unknown }).anchor, { kind: 'shared', signerProfileId: 'p' });
});

test('L3 NO existe bandera para entregar claves; el valor nunca se repite', () => {
  for (const flag of ['--private-key', '--key', '--key-file', '--mnemonic', '--secret-ref', '--secret']) {
    assert.throws(
      () => parseCliArgs('provision', ['--issuer', 'i', '--types', '', flag, '0xdeadbeef']),
      (e: unknown) => e instanceof CliUsageError && !e.message.includes('deadbeef')
    );
  }
});

test('L4 banderas fuera del comando, repetidas o sin valor: error', () => {
  assert.throws(() => parseCliArgs('rotate-assertion', ['--issuer', 'i', '--types', 'course']));
  assert.throws(() => parseCliArgs('set-capabilities', ['--issuer', 'i', '--issuer', 'j', '--types', '']));
  assert.throws(() => parseCliArgs('set-capabilities', ['--issuer']));
  assert.throws(() => parseCliArgs('set-capabilities', ['--types', 'course']));
});

test('L5 salida de error: codigo + metadata segura; errores ajenos reducidos a literal', () => {
  const orphan = describeCliError(
    new TechnicalProvisioningError('ORPHAN_SIGNER_SECRET_REQUIRES_CLEANUP', {
      orphanSecretRefs: ['/scope/test/signers/x'],
      causeCode: 'P2034'
    })
  );
  assert.equal(orphan.code, 'ORPHAN_SIGNER_SECRET_REQUIRES_CLEANUP');
  assert.deepEqual(orphan.orphanSecretRefs, ['/scope/test/signers/x']);

  const foreign = describeCliError(new Error('0xac0974bec39a17e36ba4a6b4d238ff944bacb478'));
  assert.deepEqual(foreign, { ok: false, code: 'UNEXPECTED', message: 'Operacion fallida.' });
});
