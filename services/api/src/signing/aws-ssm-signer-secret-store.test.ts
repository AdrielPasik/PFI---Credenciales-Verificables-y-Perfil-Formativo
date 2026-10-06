/**
 * Adaptador SSM del almacen de secretos de firma -- S8c2.
 *
 * El cliente se inyecta como `{ send }` falso, asi que NINGUNA llamada puede
 * escaparse a AWS. No hay credenciales, no hay region real y no hay red.
 *
 * Lo que se congela aca:
 *   * se usa `GetParameter` sobre el nombre EXACTO, nunca `GetParametersByPath`;
 *   * `WithDecryption: true`;
 *   * solo un `SecureString` cuenta como custodia valida;
 *   * una excepcion cruda del SDK no se reenvia;
 *   * una referencia fuera del namespace falla ANTES de enviar el comando.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { AwsSsmSignerSecretStore } from './aws-ssm-signer-secret-store';
import { SignerResolutionError } from './signer-resolution.error';
import { PUBLIC_TEST_KEY_ONE } from './__fixtures__/signer-test-keys';

const SECRET_REF = '/scope/prod/signers/assert-uade';
const PREFIX = '/scope/prod/signers/';

interface SentCommand {
  readonly constructorName: string;
  readonly input: Record<string, unknown>;
}

function createClient(
  handler: (command: SentCommand) => unknown
): {
  client: { send: (command: unknown) => Promise<unknown> };
  sent: SentCommand[];
} {
  const sent: SentCommand[] = [];

  return {
    sent,
    client: {
      async send(command: unknown) {
        const described: SentCommand = {
          constructorName: (command as { constructor: { name: string } })
            .constructor.name,
          input: (command as { input: Record<string, unknown> }).input
        };
        sent.push(described);
        return handler(described);
      }
    }
  };
}

function secureStringResponse(value: string) {
  return { Parameter: { Name: SECRET_REF, Type: 'SecureString', Value: value } };
}

async function expectCode(
  operation: Promise<unknown>,
  code: string
): Promise<SignerResolutionError> {
  try {
    await operation;
  } catch (error) {
    assert.ok(error instanceof SignerResolutionError, String(error));
    assert.equal(error.code, code);
    return error;
  }
  throw new Error(`se esperaba que fallara con ${code}`);
}

// ---------------------------------------------------------------------------
// CAMINO FELIZ
// ---------------------------------------------------------------------------

test('30-31: usa GetParameter sobre el nombre exacto, con WithDecryption', async () => {
  const { client, sent } = createClient(() =>
    secureStringResponse(PUBLIC_TEST_KEY_ONE.privateKey)
  );
  const store = new AwsSsmSignerSecretStore(client);

  const value = await store.getPrivateKey(SECRET_REF);

  assert.equal(value, PUBLIC_TEST_KEY_ONE.privateKey);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].constructorName, 'GetParameterCommand');
  assert.deepEqual(sent[0].input, {
    Name: SECRET_REF,
    WithDecryption: true
  });
});

test('no usa GetParametersByPath ni ninguna enumeracion', async () => {
  const { client, sent } = createClient(() =>
    secureStringResponse(PUBLIC_TEST_KEY_ONE.privateKey)
  );
  const store = new AwsSsmSignerSecretStore(client);

  await store.getPrivateKey(SECRET_REF);

  for (const command of sent) {
    assert.doesNotMatch(command.constructorName, /ByPath|Describe|List/);
    assert.equal(command.input.Path, undefined);
    assert.equal(command.input.Recursive, undefined);
  }
});

test('la superficie publica del almacen es UNA sola operacion de lectura', () => {
  const { client } = createClient(() => secureStringResponse('x'));
  const store = new AwsSsmSignerSecretStore(client);

  const methods = Object.getOwnPropertyNames(
    Object.getPrototypeOf(store)
  ).filter((name) => name !== 'constructor');

  assert.deepEqual(methods.sort(), [
    'assertEligibleSecretRef',
    'getPrivateKey',
    'sendGetParameter'
  ]);

  const record = store as unknown as Record<string, unknown>;
  for (const forbidden of [
    'putPrivateKey',
    'createSecret',
    'deleteSecret',
    'rotate',
    'listSecrets'
  ]) {
    assert.equal(record[forbidden], undefined);
  }
});

// ---------------------------------------------------------------------------
// TIPO DE PARAMETRO
// ---------------------------------------------------------------------------

test('addendum D1: un parametro que NO es SecureString falla de forma segura', async () => {
  for (const type of ['String', 'StringList', undefined]) {
    const { client } = createClient(() => ({
      Parameter: { Type: type, Value: PUBLIC_TEST_KEY_ONE.privateKey }
    }));
    const store = new AwsSsmSignerSecretStore(client);

    const error = await expectCode(
      store.getPrivateKey(SECRET_REF),
      'SIGNER_SECRET_UNAVAILABLE'
    );
    // Ni el valor ni el tipo se filtran al mensaje.
    assert.ok(!error.message.includes(PUBLIC_TEST_KEY_ONE.privateKey));
  }
});

test('addendum D2: falta Parameter.Value -> falla de forma segura', async () => {
  for (const response of [
    {},
    { Parameter: {} },
    { Parameter: { Type: 'SecureString' } },
    { Parameter: { Type: 'SecureString', Value: '' } },
    { Parameter: { Type: 'SecureString', Value: 42 } },
    null
  ]) {
    const { client } = createClient(() => response);
    const store = new AwsSsmSignerSecretStore(client);

    await expectCode(
      store.getPrivateKey(SECRET_REF),
      'SIGNER_SECRET_UNAVAILABLE'
    );
  }
});

test('el almacen NO valida el formato de la clave: eso lo hace el resolver', async () => {
  // Separacion de responsabilidades: el almacen devuelve el valor del secreto;
  // juzgar si es una clave privada valida es del resolver, que es quien tiene
  // la metadata contra la que compararla.
  const { client } = createClient(() => secureStringResponse('no-es-una-clave'));
  const store = new AwsSsmSignerSecretStore(client);

  assert.equal(await store.getPrivateKey(SECRET_REF), 'no-es-una-clave');
});

// ---------------------------------------------------------------------------
// NAMESPACE (DEFENSA EN PROFUNDIDAD)
// ---------------------------------------------------------------------------

test('addendum D3: una referencia fuera del namespace falla ANTES de enviar', async () => {
  const outOfScope = [
    '/scope/prod/api/DATABASE_URL',
    '/scope/prod/api/JWT_SECRET',
    '/scope/prod/ai/OBJECTIVE_ANALYSIS_OPENAI_API_KEY',
    '/other/prod/signers/assert-uade',
    '/scope/prod/signer/assert-uade'
  ];

  for (const ref of outOfScope) {
    const { client, sent } = createClient(() =>
      secureStringResponse(PUBLIC_TEST_KEY_ONE.privateKey)
    );
    const store = new AwsSsmSignerSecretStore(client, {
      secretRefPrefix: PREFIX
    });

    const error = await expectCode(
      store.getPrivateKey(ref),
      'SIGNER_SECRET_REFERENCE_REJECTED'
    );
    assert.deepEqual(sent, [], `no debe enviar nada para ${ref}`);
    // La referencia rechazada NO se filtra: es metadata de infraestructura.
    assert.ok(!error.message.includes(ref));
  }
});

test('una referencia dentro del namespace se acepta', async () => {
  const { client, sent } = createClient(() =>
    secureStringResponse(PUBLIC_TEST_KEY_ONE.privateKey)
  );
  const store = new AwsSsmSignerSecretStore(client, {
    secretRefPrefix: PREFIX
  });

  await store.getPrivateKey(SECRET_REF);
  assert.equal(sent.length, 1);
});

test('referencias con forma invalida fallan antes de enviar, con o sin prefijo', async () => {
  const invalid = [
    '',
    '   ',
    'sin-barra-inicial',
    '/scope/prod/signers/con espacio',
    '/scope/prod/signers/*',
    '/scope/prod/signers/a?b',
    '/scope//prod/signers/a',
    '/scope/prod/signers/../api/JWT_SECRET',
    `/scope/prod/signers/${'a'.repeat(3000)}`
  ];

  for (const ref of invalid) {
    const { client, sent } = createClient(() => secureStringResponse('x'));
    const store = new AwsSsmSignerSecretStore(client);

    await expectCode(
      store.getPrivateKey(ref),
      'SIGNER_SECRET_REFERENCE_REJECTED'
    );
    assert.deepEqual(sent, [], `no debe enviar nada para ${JSON.stringify(ref)}`);
  }
});

test('sin prefijo configurado, el almacen queda neutro respecto del entorno', async () => {
  const { client, sent } = createClient(() =>
    secureStringResponse(PUBLIC_TEST_KEY_ONE.privateKey)
  );
  const store = new AwsSsmSignerSecretStore(client);

  // Un namespace de otro entorno es admisible si no se configuro prefijo: el
  // limite autoritativo es IAM.
  await store.getPrivateKey('/scope/staging/signers/assert-uade');
  assert.equal(sent.length, 1);
});

// ---------------------------------------------------------------------------
// SANEAMIENTO DE ERRORES DEL SDK
// ---------------------------------------------------------------------------

test('una excepcion cruda del SDK no se reenvia', async () => {
  const rawMessage =
    'ParameterNotFound: arn:aws:ssm:us-east-1:111122223333:parameter/scope/prod/signers/x; requestId=7f3c; endpoint=https://ssm.us-east-1.amazonaws.com';
  const { client } = createClient(() => {
    const error = new Error(rawMessage);
    error.name = 'ParameterNotFound';
    throw error;
  });
  const store = new AwsSsmSignerSecretStore(client);

  const error = await expectCode(
    store.getPrivateKey(SECRET_REF),
    'SIGNER_SECRET_UNAVAILABLE'
  );

  assert.ok(!error.message.includes(rawMessage));
  assert.doesNotMatch(error.message, /arn:aws/);
  assert.doesNotMatch(error.message, /requestId/);
  assert.doesNotMatch(error.message, /amazonaws/);
  assert.doesNotMatch(error.message, /us-east-1/);
  assert.doesNotMatch(error.message, /111122223333/);
});

test('no se adjunta `cause`: varios inspectores lo imprimen automaticamente', async () => {
  const { client } = createClient(() => {
    const error = new Error('arn:aws:ssm:eu-west-1:999988887777:parameter/x');
    error.name = 'AccessDeniedException';
    throw error;
  });
  const store = new AwsSsmSignerSecretStore(client);

  const error = await expectCode(
    store.getPrivateKey(SECRET_REF),
    'SIGNER_SECRET_UNAVAILABLE'
  );

  assert.equal((error as { cause?: unknown }).cause, undefined);

  // Ni siquiera una inspeccion profunda arrastra la metadata.
  const deep = JSON.stringify(error, Object.getOwnPropertyNames(error));
  assert.doesNotMatch(deep, /arn:aws/);
  assert.doesNotMatch(deep, /999988887777/);
});

test('se conserva SOLO el nombre de la clase de error de AWS, como identificador', async () => {
  const { client } = createClient(() => {
    const error = new Error('metadata sensible: arn:aws:...');
    error.name = 'AccessDeniedException';
    throw error;
  });
  const store = new AwsSsmSignerSecretStore(client);

  const error = await expectCode(
    store.getPrivateKey(SECRET_REF),
    'SIGNER_SECRET_UNAVAILABLE'
  );

  assert.equal(error.awsErrorName, 'AccessDeniedException');
});

test('un `name` que no parece un identificador se descarta', async () => {
  const { client } = createClient(() => {
    const error = new Error('x');
    error.name = 'arn:aws:ssm:us-east-1:111122223333:parameter/x';
    throw error;
  });
  const store = new AwsSsmSignerSecretStore(client);

  const error = await expectCode(
    store.getPrivateKey(SECRET_REF),
    'SIGNER_SECRET_UNAVAILABLE'
  );

  assert.equal(error.awsErrorName, undefined);
});

test('un rechazo que no es Error tampoco filtra nada', async () => {
  const { client } = createClient(() => {
    throw { secret: PUBLIC_TEST_KEY_ONE.privateKey };
  });
  const store = new AwsSsmSignerSecretStore(client);

  const error = await expectCode(
    store.getPrivateKey(SECRET_REF),
    'SIGNER_SECRET_UNAVAILABLE'
  );

  const deep = JSON.stringify(error, Object.getOwnPropertyNames(error));
  assert.ok(!deep.includes(PUBLIC_TEST_KEY_ONE.privateKey));
});
