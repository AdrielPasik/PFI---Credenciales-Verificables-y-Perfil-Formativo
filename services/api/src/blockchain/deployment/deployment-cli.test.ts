import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  DeployCliUsageError,
  parseDeployCliArgs,
  validateDeploymentRpcUrl
} from './deployment-cli';
import { HiddenPromptError, promptHidden } from './hidden-prompt';
import { SOURCE_COMMIT } from './__fixtures__/deployment-fixtures';

/** Seguridad del operador: entrada de la CLI y prompt sin eco (30-36). */

const GOOD = ['--keystore', '/ops/keys/deployer.json', '--source-commit', SOURCE_COMMIT];

function usage(argv: string[]): DeployCliUsageError {
  try {
    parseDeployCliArgs(argv);
  } catch (error) {
    assert.ok(error instanceof DeployCliUsageError);
    return error;
  }
  assert.fail('se esperaba un error de uso');
}

test('33 la unica entrada de clave es la RUTA de un keystore; --execute es opcional', () => {
  assert.deepEqual(parseDeployCliArgs(GOOD), {
    keystorePath: '/ops/keys/deployer.json',
    deploymentSourceCommit: SOURCE_COMMIT,
    execute: false
  });
  assert.equal(parseDeployCliArgs([...GOOD, '--execute']).execute, true);
});

test('30/31/32 clave privada, mnemonic, semilla y alias de secreto se rechazan', () => {
  const secret = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const flags = [
    '--private-key',
    '--privateKey',
    '--private_key',
    '--raw-key',
    '--key',
    '--secret',
    '--secret-key',
    '--mnemonic',
    '--seed',
    '--seed-phrase',
    '--wallet',
    '--account',
    '--keyfile',
    '--sender',
    '--json',
    '--from'
  ];

  for (const flag of flags) {
    const error = usage([...GOOD, flag, secret]);
    assert.equal(error.code, 'ARGUMENT_NOT_SUPPORTED', flag);
    // El valor que se intento pasar NUNCA se refleja.
    assert.equal(error.message.includes(secret), false);
    assert.equal(error.message.includes('ac0974'), false);
  }
});

test('34 la frase de paso y la URL del RPC no son argumentos de la linea de comandos', () => {
  for (const flag of ['--passphrase', '--password', '--pass', '--rpc-url', '--rpc', '--url', '--endpoint']) {
    const error = usage([...GOOD, flag, 'hunter2-or-https://rpc.example/token']);
    assert.equal(error.code, 'ARGUMENT_NOT_SUPPORTED', flag);
    assert.equal(error.message.includes('hunter2'), false);
    assert.equal(error.message.includes('rpc.example'), false);
  }

  // La forma --flag=valor tampoco es una puerta trasera.
  for (const token of ['--private-key=0x01', '--keystore=/ops/k.json', '--passphrase=x']) {
    assert.equal(usage([...GOOD, token]).code, 'ARGUMENT_NOT_SUPPORTED');
  }
});

test('una clave en claro o un JSON en el lugar de la ruta del keystore se rechazan', () => {
  const secret = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  for (const value of [
    secret,
    secret.slice(2),
    '{"address":"7e5f4552091a69125d5dfcb7b8c2659029395bdf","crypto":{}}',
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  ]) {
    const error = usage(['--keystore', value, '--source-commit', SOURCE_COMMIT]);
    assert.equal(error.code, 'ARGUMENT_INVALID');
    assert.equal(error.message.includes(value.slice(0, 12)), false);
  }
});

test('argumentos faltantes, repetidos o sin valor, y commit malformado, se rechazan', () => {
  assert.equal(usage([]).code, 'ARGUMENT_MISSING');
  assert.equal(usage(['--keystore', '/k.json']).code, 'ARGUMENT_MISSING');
  assert.equal(usage(['--source-commit', SOURCE_COMMIT]).code, 'ARGUMENT_MISSING');
  assert.equal(usage(['--keystore']).code, 'ARGUMENT_INVALID');
  assert.equal(usage(['--keystore', '--source-commit', SOURCE_COMMIT]).code, 'ARGUMENT_INVALID');
  assert.equal(usage([...GOOD, '--keystore', '/other.json']).code, 'ARGUMENT_INVALID');
  assert.equal(usage(['--keystore', '/k.json', '--source-commit', 'main']).code, 'ARGUMENT_INVALID');
  assert.equal(usage(['--keystore', '/k.json', '--source-commit', 'a'.repeat(7)]).code, 'ARGUMENT_INVALID');
  assert.equal(usage([...GOOD, 'stray']).code, 'ARGUMENT_NOT_SUPPORTED');
});

test('la URL del RPC: HTTPS obligatorio, sin recortes y nunca reflejada', () => {
  assert.equal(
    validateDeploymentRpcUrl('https://base-sepolia.example/v2/KEY?x=1'),
    'https://base-sepolia.example/v2/KEY?x=1'
  );
  for (const bad of [undefined, '', ' https://x.example', 'https://x.example ', 'http://x.example', 'http://127.0.0.1:8545', 'ws://x.example', 'not a url', 'ftp://x.example']) {
    assert.equal(validateDeploymentRpcUrl(bad), null, String(bad));
  }
});

// ---------------------------------------------------------------------------
// Prompt sin eco
// ---------------------------------------------------------------------------

class FakeTty extends EventEmitter {
  isTTY = true;
  rawMode: boolean[] = [];
  paused = false;

  setRawMode(mode: boolean) {
    this.rawMode.push(mode);
    return this;
  }
  resume() {
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
  type(text: string) {
    this.emit('data', Buffer.from(text, 'utf8'));
  }
}

function fakeOutput() {
  const written: string[] = [];
  return { written, write: (text: string) => written.push(text) };
}

test('35 la frase se lee sin eco: solo se escribe el rotulo y el salto de linea', async () => {
  const input = new FakeTty();
  const output = fakeOutput();

  const pending = promptHidden('Passphrase: ', { input, output });
  input.type('co');
  input.type('rrect horse');
  input.type('\u007fX\r');

  assert.equal(await pending, 'correct horsX'); // el borrado quito la 'e'
  assert.deepEqual(output.written, ['Passphrase: ', '\n']);
  assert.equal(output.written.join('').includes('correct'), false);
  assert.deepEqual(input.rawMode, [true, false]);
  assert.equal(input.paused, true);
  assert.equal(input.listenerCount('data'), 0);
});

test('Ctrl+C cancela y restaura la terminal; una entrada vacia se rechaza', async () => {
  const cancelled = new FakeTty();
  const pending = promptHidden('P: ', { input: cancelled, output: fakeOutput() });
  cancelled.type('abc\u0003');
  await assert.rejects(pending, (e: unknown) => e instanceof HiddenPromptError && e.code === 'PROMPT_CANCELLED');
  assert.deepEqual(cancelled.rawMode, [true, false]);

  const empty = new FakeTty();
  const emptyPending = promptHidden('P: ', { input: empty, output: fakeOutput() });
  empty.type('\r');
  await assert.rejects(emptyPending, (e: unknown) => e instanceof HiddenPromptError && e.code === 'PROMPT_EMPTY');
});

test('sin TTY FALLA CERRADO: no hay fallback que haga eco', async () => {
  const notTty = new FakeTty();
  notTty.isTTY = false;
  const output = fakeOutput();

  await assert.rejects(
    promptHidden('P: ', { input: notTty, output }),
    (e: unknown) => e instanceof HiddenPromptError && e.code === 'PROMPT_UNAVAILABLE'
  );
  assert.deepEqual(output.written, []);
  assert.deepEqual(notTty.rawMode, []);

  const noRawMode = { isTTY: true, resume() {}, pause() {}, on() {}, removeListener() {} };
  await assert.rejects(
    promptHidden('P: ', { input: noRawMode as never, output: fakeOutput() }),
    (e: unknown) => e instanceof HiddenPromptError && e.code === 'PROMPT_UNAVAILABLE'
  );
});
