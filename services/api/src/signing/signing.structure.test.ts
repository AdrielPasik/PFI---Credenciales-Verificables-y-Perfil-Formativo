/**
 * Guards estructurales del modulo de firma -- S8c2.
 *
 * S8c2 construye el camino de CUSTODIA y RESOLUCION. No firma, no habla con
 * ninguna red y no reemplaza todavia al signer global legacy. Estos guards
 * congelan esas tres cosas, porque son exactamente las que se podrian filtrar
 * sin que ningun test funcional se rompiera.
 *
 * Alcance acotado a `src/signing/`: no es un grep del repo entero, que fallaria
 * con documentacion y tests historicos legitimos.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { createSignerSecretStoreFromEnv } from './signer-secret-store.factory';

const SIGNING_DIR = __dirname;
const API_SRC_DIR = join(__dirname, '..');

/** Solo fuentes de PRODUCCION del modulo: sin tests, sin fixtures. */
function productionSources(): Array<{ name: string; contents: string }> {
  return readdirSync(SIGNING_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts')
    )
    .map((entry) => ({
      name: entry.name,
      contents: readFileSync(join(SIGNING_DIR, entry.name), 'utf8')
    }));
}

/** Codigo ejecutable: sin comentarios de linea ni de bloque. */
function executableCode(contents: string): string {
  return contents
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

test('el modulo tiene exactamente los archivos de produccion esperados', () => {
  assert.deepEqual(
    productionSources()
      .map((file) => file.name)
      .sort(),
    [
      'aws-ssm-signer-secret-store.ts',
      'issuer-signer-resolver.ts',
      'signer-resolution.error.ts',
      'signer-secret-store.factory.ts',
      'signer-secret-store.port.ts',
      'signing.module.ts'
    ]
  );
});

// ---------------------------------------------------------------------------
// NI PROVIDER, NI RPC, NI FIRMA
// ---------------------------------------------------------------------------

test('29: ninguna fuente de produccion construye un provider ni envia nada a una red', () => {
  const forbidden = [
    'JsonRpcProvider',
    'WebSocketProvider',
    'FallbackProvider',
    'BrowserProvider',
    'AlchemyProvider',
    'InfuraProvider',
    'getDefaultProvider',
    'new Contract',
    'ContractFactory',
    '.connect(',
    'sendTransaction',
    'broadcastTransaction',
    'signTransaction',
    'signMessage',
    'signTypedData',
    'populateTransaction',
    'estimateGas',
    'getFeeData'
  ];

  for (const file of productionSources()) {
    const code = executableCode(file.contents);
    for (const token of forbidden) {
      assert.ok(
        !code.includes(token),
        `${file.name} no debe contener ${token}`
      );
    }
  }
});

test('la unica dependencia de ethers son primitivas locales de clave y direccion', () => {
  const imports: string[] = [];

  for (const file of productionSources()) {
    const match = /import \{([^}]*)\} from 'ethers';/.exec(file.contents);
    if (match) {
      imports.push(
        ...match[1]
          .split(',')
          .map((name) => name.trim())
          .filter((name) => name.length > 0)
      );
    }
  }

  // `Wallet` desconectada, mas normalizacion de direcciones. Nada de red.
  assert.deepEqual([...new Set(imports)].sort(), [
    'Wallet',
    'getAddress',
    'isAddress'
  ]);
});

test('la Wallet se construye SIEMPRE con un solo argumento, sin provider', () => {
  const resolver = executableCode(
    readFileSync(join(SIGNING_DIR, 'issuer-signer-resolver.ts'), 'utf8')
  );

  const constructions = [...resolver.matchAll(/new Wallet\(([^)]*)\)/g)].map(
    (match) => match[1].trim()
  );

  assert.deepEqual(constructions, ['privateKey']);
  assert.ok(!resolver.includes('new Wallet(privateKey,'));
});

// ---------------------------------------------------------------------------
// CUSTODIA READ-ONLY
// ---------------------------------------------------------------------------

test('el adaptador SSM no importa ninguna capacidad de escritura ni de enumeracion', () => {
  const store = readFileSync(
    join(SIGNING_DIR, 'aws-ssm-signer-secret-store.ts'),
    'utf8'
  );
  const code = executableCode(store);

  for (const token of [
    'PutParameterCommand',
    'DeleteParameterCommand',
    'DeleteParametersCommand',
    'GetParametersByPathCommand',
    'DescribeParametersCommand',
    'LabelParameterVersionCommand',
    'GetParametersCommand'
  ]) {
    assert.ok(!code.includes(token), `no debe usar ${token}`);
  }

  // Un solo comando importado, y es el de lectura exacta.
  const match = /import \{([^}]*)\} from '@aws-sdk\/client-ssm';/.exec(store);
  assert.ok(match, 'no se encontro el import del SDK');
  const imported = match[1]
    .split(',')
    .map((name) => name.trim().replace(/^type /, ''))
    .filter((name) => name.length > 0)
    .sort();
  assert.deepEqual(imported, ['GetParameterCommand', 'SSMClient']);
});

test('el adaptador siempre descifra: WithDecryption en true, literal', () => {
  const code = executableCode(
    readFileSync(join(SIGNING_DIR, 'aws-ssm-signer-secret-store.ts'), 'utf8')
  );

  assert.match(code, /WithDecryption:\s*true/);
  assert.ok(!code.includes('WithDecryption: false'));
});

test('ninguna fuente lee credenciales estaticas de AWS', () => {
  for (const file of productionSources()) {
    const code = executableCode(file.contents);
    assert.ok(
      !code.includes('AWS_ACCESS_KEY_ID'),
      `${file.name} no debe leer AWS_ACCESS_KEY_ID`
    );
    assert.ok(
      !code.includes('AWS_SECRET_ACCESS_KEY'),
      `${file.name} no debe leer AWS_SECRET_ACCESS_KEY`
    );
    assert.ok(!code.includes('AWS_SESSION_TOKEN'), file.name);
    assert.ok(!code.includes('credentials:'), file.name);
  }
});

// ---------------------------------------------------------------------------
// NO FILTRACION
// ---------------------------------------------------------------------------

test('ninguna fuente de produccion loguea', () => {
  for (const file of productionSources()) {
    const code = executableCode(file.contents);

    for (const token of ['console.', 'new Logger(', 'Logger.', 'process.stdout']) {
      assert.ok(
        !code.includes(token),
        `${file.name} no debe contener ${token}: no hay necesidad operativa de un log aca`
      );
    }
  }
});

test('la clave en crudo no se retiene en ningun campo ni se serializa', () => {
  for (const file of productionSources()) {
    const code = executableCode(file.contents);

    // Nunca se guarda en el objeto.
    assert.doesNotMatch(code, /this\.privateKey/, file.name);
    assert.doesNotMatch(code, /this\.rawKey/, file.name);
    assert.doesNotMatch(code, /this\.secret\b/, file.name);
    // Nunca se serializa.
    assert.doesNotMatch(code, /JSON\.stringify\s*\(\s*privateKey/, file.name);
    // Nunca se interpola en un mensaje.
    assert.doesNotMatch(code, /\$\{privateKey\}/, file.name);
    assert.doesNotMatch(code, /\$\{secretRef\}/, file.name);
  }
});

test('la cache guarda la Wallet, nunca la cadena de la clave', () => {
  const resolver = readFileSync(
    join(SIGNING_DIR, 'issuer-signer-resolver.ts'),
    'utf8'
  );

  const entry = /interface SignerCacheEntry \{([\s\S]*?)\n\}/.exec(resolver);
  assert.ok(entry, 'no se encontro SignerCacheEntry');

  const fields = [...entry[1].matchAll(/readonly (\w+):/g)].map((m) => m[1]);

  // `secretRef` SI vive en la entrada privada: es parte de su identidad de
  // configuracion, y es metadata de infraestructura, no material secreto.
  assert.deepEqual(fields.sort(), [
    'address',
    'expiresAt',
    'keyVersion',
    'profileId',
    'purpose',
    'secretRef',
    'wallet'
  ]);

  // Lo que NUNCA puede estar es la clave en crudo o la respuesta de SSM.
  for (const forbidden of [
    'privateKey',
    'rawKey',
    'privateJwk',
    'Parameter',
    'ssmResponse'
  ]) {
    assert.ok(
      !entry[1].includes(forbidden),
      `SignerCacheEntry no debe llevar ${forbidden}`
    );
  }
});

test('secretRef vive SOLO en la entrada privada de cache, nunca en el signer resuelto', () => {
  const resolver = readFileSync(
    join(SIGNING_DIR, 'issuer-signer-resolver.ts'),
    'utf8'
  );

  const resolved = /export interface ResolvedIssuerSigner \{([\s\S]*?)\n\}/.exec(
    resolver
  );
  assert.ok(resolved, 'no se encontro ResolvedIssuerSigner');
  assert.ok(!resolved[1].includes('secretRef'));

  // Y el mapeo a la estructura devuelta no lo copia.
  const mapper = /function toResolvedSigner\(([\s\S]*?)\n\}/.exec(resolver);
  assert.ok(mapper, 'no se encontro toResolvedSigner');
  assert.ok(!mapper[1].includes('secretRef'));
  assert.ok(!mapper[1].includes('privateKey'));
});

test('hay UNA sola implementacion de consistencia criptografica', () => {
  const resolver = executableCode(
    readFileSync(join(SIGNING_DIR, 'issuer-signer-resolver.ts'), 'utf8')
  );

  // Una sola definicion...
  const definitions = [
    ...resolver.matchAll(/private validateWalletAgainstProfile\(/g)
  ];
  assert.equal(definitions.length, 1, 'una sola definicion');

  // ...y exactamente dos usos: el cache hit y el cache miss.
  const calls = [
    ...resolver.matchAll(/this\.validateWalletAgainstProfile\(/g)
  ];
  assert.equal(
    calls.length,
    2,
    'debe invocarse en el cache hit Y en el cache miss'
  );

  // No sobrevive una segunda implementacion del chequeo de clave publica.
  assert.ok(!resolver.includes('assertAssertionPublicMaterial'));
  const comparisons = [...resolver.matchAll(/profile\.publicKeyX !==/g)];
  assert.equal(comparisons.length, 1, 'un solo lugar compara el material publico');
});

test('el signer resuelto no declara secretRef ni privateKey ni custody', () => {
  const resolver = readFileSync(
    join(SIGNING_DIR, 'issuer-signer-resolver.ts'),
    'utf8'
  );

  const shape = /export interface ResolvedIssuerSigner \{([\s\S]*?)\n\}/.exec(
    resolver
  );
  assert.ok(shape, 'no se encontro ResolvedIssuerSigner');

  const fields = [...shape[1].matchAll(/readonly (\w+):/g)].map((m) => m[1]);
  assert.deepEqual(fields.sort(), [
    'address',
    'keyVersion',
    'profileId',
    'purpose',
    'wallet'
  ]);
});

test('los mensajes de error son literales fijos: nada interpolado', () => {
  const errors = readFileSync(
    join(SIGNING_DIR, 'signer-resolution.error.ts'),
    'utf8'
  );
  const code = executableCode(errors);

  // El mensaje sale siempre del mapa, nunca de una plantilla.
  assert.match(code, /super\(SAFE_MESSAGES\[code\]\)/);
  assert.ok(!code.includes('super(`'));
  assert.ok(!code.includes('${'), 'ninguna interpolacion en este archivo');
});

test('no se adjunta `cause` a ningun error del modulo', () => {
  for (const file of productionSources()) {
    const code = executableCode(file.contents);
    assert.ok(!code.includes('cause:'), `${file.name} no debe propagar cause`);
  }
});

// ---------------------------------------------------------------------------
// SEPARACION RESPECTO DEL CAMINO LEGACY
// ---------------------------------------------------------------------------

test('35: el camino nuevo NO lee CREDENTIAL_REGISTRY_PRIVATE_KEY', () => {
  // Sobre CODIGO EJECUTABLE, no sobre prosa: `signing.module.ts` documenta a
  // proposito que el camino legacy sigue siendo el activo, y mencionar ahi la
  // variable es informacion util, no un acoplamiento. Mismo criterio que los
  // tests de migration del repo.
  for (const file of productionSources()) {
    assert.ok(
      !executableCode(file.contents).includes('CREDENTIAL_REGISTRY_PRIVATE_KEY'),
      `${file.name} no debe leer el signer global legacy`
    );
  }
});

test('35: el camino nuevo no introduce ninguna variable de entorno con una clave', () => {
  for (const file of productionSources()) {
    const code = executableCode(file.contents);

    for (const token of [
      'SIGNER_PRIVATE_KEY',
      'ISSUER_PRIVATE_KEY',
      'ASSERTION_PRIVATE_KEY',
      'ANCHOR_PRIVATE_KEY'
    ]) {
      assert.ok(!code.includes(token), `${file.name} no debe declarar ${token}`);
    }
  }
});

test('35: el camino legacy sigue intacto y sigue siendo el activo', () => {
  // El signer global legacy vive en `src/blockchain/` y lo consume la
  // revocacion actual. S8c2 NO lo toca: el cutover es una slice posterior.
  const writeClient = readFileSync(
    join(API_SRC_DIR, 'blockchain', 'credential-registry-write-client.ts'),
    'utf8'
  );
  assert.ok(writeClient.includes('CREDENTIAL_REGISTRY_PRIVATE_KEY'));

  const revocation = readFileSync(
    join(API_SRC_DIR, 'credentials', 'issuer-credential-revocation.service.ts'),
    'utf8'
  );
  assert.ok(revocation.includes('resolveCredentialRegistrySignerAddress'));
});

test('36: ningun flujo existente usa todavia el resolver nuevo', () => {
  const offenders: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'signing') {
          walk(full);
        }
        continue;
      }
      if (!entry.name.endsWith('.ts')) {
        continue;
      }
      const contents = readFileSync(full, 'utf8');
      if (
        contents.includes('IssuerSignerResolver') ||
        contents.includes('resolveAssertionSignerForIssuer') ||
        contents.includes('resolveAnchorSignerForIssuer')
      ) {
        offenders.push(entry.name);
      }
    }
  };

  walk(API_SRC_DIR);

  // Solo el wiring del AppModule puede nombrar el modulo, nunca el resolver.
  assert.deepEqual(
    offenders,
    [],
    `la emision/revocacion no deben usar el resolver todavia: ${offenders.join(', ')}`
  );
});

test('el AppModule registra el modulo pero no inyecta el resolver', () => {
  const appModule = readFileSync(join(API_SRC_DIR, 'app.module.ts'), 'utf8');

  assert.ok(appModule.includes('SigningModule'));
  assert.ok(!appModule.includes('IssuerSignerResolver'));
});

// ---------------------------------------------------------------------------
// PEREZA DEL CLIENTE AWS
// ---------------------------------------------------------------------------

test('construir el almacen no envia ningun comando a AWS', () => {
  let sends = 0;
  let constructed = 0;

  const store = createSignerSecretStoreFromEnv(
    {} as NodeJS.ProcessEnv,
    {
      createSsmClient: () => {
        constructed += 1;
        return {
          send: async () => {
            sends += 1;
            return {};
          }
        } as never;
      }
    }
  );

  assert.ok(store);
  assert.equal(constructed, 1, 'el cliente se construye');
  assert.equal(sends, 0, 'pero NO se envia nada');
});

test('el factory no exige AWS_REGION ni credenciales para construirse', () => {
  const configs: unknown[] = [];

  createSignerSecretStoreFromEnv({} as NodeJS.ProcessEnv, {
    createSsmClient: (config) => {
      configs.push(config);
      return { send: async () => ({}) } as never;
    }
  });

  // Sin AWS_REGION la config va vacia y el SDK resuelve la region por su
  // cadena por defecto al enviar, no al construir.
  assert.deepEqual(configs, [{}]);
});

test('el factory propaga region y prefijo de namespace cuando estan definidos', () => {
  const configs: Array<{ region?: string }> = [];

  const store = createSignerSecretStoreFromEnv(
    {
      AWS_REGION: 'us-east-1',
      SIGNER_SECRET_REF_PREFIX: '/scope/prod/signers/'
    } as NodeJS.ProcessEnv,
    {
      createSsmClient: (config) => {
        configs.push(config as { region?: string });
        return { send: async () => ({}) } as never;
      }
    }
  );

  assert.deepEqual(configs, [{ region: 'us-east-1' }]);

  // El prefijo quedo aplicado: una referencia ajena se rechaza sin enviar.
  assert.rejects(
    () => store.getPrivateKey('/scope/prod/api/JWT_SECRET'),
    /no es admisible/
  );
});
