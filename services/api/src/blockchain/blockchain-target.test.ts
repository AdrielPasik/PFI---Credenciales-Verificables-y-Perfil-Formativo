/**
 * Target de blockchain -- S8c5, matriz 1-18.
 *
 * Lo que se congela: que el MODO y la RED sean ejes independientes, que el
 * target final Base Sepolia (84532) sea expresable, y que una configuracion
 * real incompleta o contradictoria falle CERRADA en vez de degradar a mock.
 *
 * Esto ultimo es lo mas importante de todo el archivo: degradar en silencio
 * reportaria evidencia de blockchain mientras la escritura real queda apagada.
 *
 * Todo es validacion LOCAL. No se construye ningun provider, no se contacta
 * ninguna red y no existe forma de que estos tests escapen a internet.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { BlockchainNetwork } from '@prisma/client';

import {
  BlockchainTargetError,
  CREDENTIAL_REGISTRY_NETWORK_CHAIN_IDS,
  FINAL_TARGET_NETWORK,
  type BlockchainTargetEnvironment,
  type BlockchainTargetField,
  chainIdForCredentialRegistryNetwork,
  isCredentialRegistryNetwork,
  isCredentialRegistryTarget,
  resolveBlockchainTarget,
  safeBlockchainTargetMessage,
  tryResolveBlockchainTarget
} from './blockchain-target';

const CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const TEST_DEPLOYMENT_ID = 'test-deployment-local';

/**
 * URL con pinta de endpoint de proveedor con credencial en el path. Es
 * SINTETICA; sirve para probar que nunca aparece en un error.
 */
const SECRET_BEARING_RPC_URL = 'https://provider.example/v2/SECRET_API_KEY';

function anvilEnv(
  overrides: Partial<BlockchainTargetEnvironment> = {}
): BlockchainTargetEnvironment {
  return {
    BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry',
    CREDENTIAL_REGISTRY_NETWORK: BlockchainNetwork.anvil,
    CREDENTIAL_REGISTRY_CHAIN_ID: '31337',
    CREDENTIAL_REGISTRY_RPC_URL: 'http://127.0.0.1:8545',
    CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: CONTRACT_ADDRESS,
    CREDENTIAL_REGISTRY_DEPLOYMENT_ID: TEST_DEPLOYMENT_ID,
    ...overrides
  };
}

function baseSepoliaEnv(
  overrides: Partial<BlockchainTargetEnvironment> = {}
): BlockchainTargetEnvironment {
  return {
    BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry',
    CREDENTIAL_REGISTRY_NETWORK: BlockchainNetwork.base_sepolia,
    CREDENTIAL_REGISTRY_CHAIN_ID: '84532',
    CREDENTIAL_REGISTRY_RPC_URL: SECRET_BEARING_RPC_URL,
    CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: CONTRACT_ADDRESS,
    CREDENTIAL_REGISTRY_DEPLOYMENT_ID: TEST_DEPLOYMENT_ID,
    ...overrides
  };
}

function expectRejected(
  environment: BlockchainTargetEnvironment,
  field: BlockchainTargetField,
  label: string
) {
  const resolution = tryResolveBlockchainTarget(environment);

  assert.equal(resolution.ok, false, label);
  if (resolution.ok) {
    return;
  }
  assert.equal(resolution.code, 'BLOCKCHAIN_TARGET_CONFIG_INVALID', label);
  assert.equal(resolution.field, field, label);
}

// ---------------------------------------------------------------------------
// MAPEO RED <-> CHAIN ID
// ---------------------------------------------------------------------------

test('el mapeo red -> chainId esta congelado y es la unica fuente', () => {
  assert.deepEqual(CREDENTIAL_REGISTRY_NETWORK_CHAIN_IDS, {
    anvil: 31337,
    base_sepolia: 84532
  });

  assert.equal(chainIdForCredentialRegistryNetwork(BlockchainNetwork.anvil), 31337);
  assert.equal(
    chainIdForCredentialRegistryNetwork(BlockchainNetwork.base_sepolia),
    84532
  );

  // `base_mainnet` existe en el enum de Prisma pero NO es un target soportado.
  assert.ok(!isCredentialRegistryNetwork(BlockchainNetwork.base_mainnet));
  assert.ok(isCredentialRegistryNetwork('anvil'));
  assert.ok(isCredentialRegistryNetwork('base_sepolia'));
  for (const notANetwork of ['', 'ANVIL', 'base-sepolia', 'mainnet', 'sepolia']) {
    assert.ok(!isCredentialRegistryNetwork(notANetwork), notANetwork);
  }
});

test('Base Sepolia es el target FINAL declarado', () => {
  assert.equal(FINAL_TARGET_NETWORK, BlockchainNetwork.base_sepolia);
  assert.equal(chainIdForCredentialRegistryNetwork(FINAL_TARGET_NETWORK), 84532);
});

// ---------------------------------------------------------------------------
// 1: MOCK
// ---------------------------------------------------------------------------

test('1: mock se resuelve SIN red, chainId, rpcUrl, contrato ni deployment', () => {
  // Las tres formas del modo mock: ausente, vacio y explicito.
  for (const rawMode of [undefined, '', 'mock']) {
    const target = resolveBlockchainTarget({
      BLOCKCHAIN_EVIDENCE_MODE: rawMode
    });

    assert.deepEqual(target, { evidenceMode: 'mock' }, String(rawMode));
    assert.ok(!isCredentialRegistryTarget(target), String(rawMode));

    // La union discriminada es lo que hace imposible construir un provider:
    // un target mock NO TIENE los campos que el provider necesitaria.
    assert.deepEqual(Object.keys(target), ['evidenceMode'], String(rawMode));
  }
});

test('1b: mock ignora por completo la configuracion de modo real presente', () => {
  // Aunque haya un target real mal formado al lado, mock sigue siendo mock: el
  // modo es el unico eje que decide el mecanismo.
  const target = resolveBlockchainTarget({
    BLOCKCHAIN_EVIDENCE_MODE: 'mock',
    CREDENTIAL_REGISTRY_NETWORK: 'red-inexistente',
    CREDENTIAL_REGISTRY_CHAIN_ID: 'no-es-un-numero',
    CREDENTIAL_REGISTRY_RPC_URL: 'basura',
    CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: 'tampoco',
    CREDENTIAL_REGISTRY_DEPLOYMENT_ID: ''
  });

  assert.deepEqual(target, { evidenceMode: 'mock' });
});

// ---------------------------------------------------------------------------
// 2-3: TARGETS VALIDOS
// ---------------------------------------------------------------------------

test('2: credential_registry + anvil valido se acepta', () => {
  const target = resolveBlockchainTarget(anvilEnv());

  assert.deepEqual(target, {
    evidenceMode: 'credential_registry',
    network: BlockchainNetwork.anvil,
    chainId: 31337,
    rpcUrl: 'http://127.0.0.1:8545',
    contractAddress: CONTRACT_ADDRESS,
    deploymentId: TEST_DEPLOYMENT_ID
  });
});

test('3: credential_registry + Base Sepolia 84532 se acepta', () => {
  const target = resolveBlockchainTarget(baseSepoliaEnv());

  assert.ok(isCredentialRegistryTarget(target));
  if (!isCredentialRegistryTarget(target)) {
    return;
  }

  assert.equal(target.network, BlockchainNetwork.base_sepolia);
  assert.equal(target.chainId, 84532);
  assert.equal(target.contractAddress, CONTRACT_ADDRESS);
  assert.equal(target.deploymentId, TEST_DEPLOYMENT_ID);
  // La URL se preserva EXACTAMENTE: una credencial en el path no se toca.
  assert.equal(target.rpcUrl, SECRET_BEARING_RPC_URL);
});

// ---------------------------------------------------------------------------
// 4-6: MODO Y RED
// ---------------------------------------------------------------------------

test('4: el modo fusionado credential_registry_anvil YA NO existe', () => {
  // No se traduce en silencio a credential_registry + anvil: esa traduccion
  // inventaria una red que el operador no declaro.
  expectRejected(
    { BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry_anvil' },
    'BLOCKCHAIN_EVIDENCE_MODE',
    'credential_registry_anvil'
  );

  // Ni siquiera con el resto del target bien configurado.
  expectRejected(
    anvilEnv({ BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry_anvil' }),
    'BLOCKCHAIN_EVIDENCE_MODE',
    'credential_registry_anvil con target completo'
  );
});

test('5: un modo desconocido falla cerrado, nunca cae a mock', () => {
  for (const rawMode of [
    'otro_modo',
    'MOCK',
    'Mock',
    'credential_registry_base_sepolia',
    'credentialregistry',
    ' mock',
    'mock '
  ]) {
    expectRejected(
      { BLOCKCHAIN_EVIDENCE_MODE: rawMode },
      'BLOCKCHAIN_EVIDENCE_MODE',
      rawMode
    );
  }
});

test('6: una red desconocida falla cerrado', () => {
  for (const network of [
    undefined,
    '',
    'base_mainnet',
    'mainnet',
    'ANVIL',
    'base-sepolia',
    ' anvil',
    'anvil '
  ]) {
    expectRejected(
      anvilEnv({ CREDENTIAL_REGISTRY_NETWORK: network }),
      'CREDENTIAL_REGISTRY_NETWORK',
      String(network)
    );
  }
});

// ---------------------------------------------------------------------------
// 7-9: CHAIN ID
// ---------------------------------------------------------------------------

test('7: base_sepolia con chainId 31337 se rechaza', () => {
  expectRejected(
    baseSepoliaEnv({ CREDENTIAL_REGISTRY_CHAIN_ID: '31337' }),
    'CREDENTIAL_REGISTRY_CHAIN_ID',
    'base_sepolia + 31337'
  );
});

test('8: anvil con chainId 84532 se rechaza', () => {
  expectRejected(
    anvilEnv({ CREDENTIAL_REGISTRY_CHAIN_ID: '84532' }),
    'CREDENTIAL_REGISTRY_CHAIN_ID',
    'anvil + 84532'
  );
});

test('8b: un chainId ajeno a las dos redes se rechaza', () => {
  for (const chainId of ['1', '8453', '11155111', '137']) {
    expectRejected(
      anvilEnv({ CREDENTIAL_REGISTRY_CHAIN_ID: chainId }),
      'CREDENTIAL_REGISTRY_CHAIN_ID',
      chainId
    );
  }
});

test('9: chainId vacio, NaN, decimal, negativo, 0 o con padding se rechaza', () => {
  const malformed = [
    undefined,
    '',
    '   ',
    'NaN',
    'abc',
    '31337.0',
    '3.14',
    '-31337',
    '0',
    '+31337',
    '0x7a69', // hex: el contrato de env es DECIMAL
    '1e5',
    'Infinity',
    '31337abc',
    '9007199254740993', // mas alla de Number.MAX_SAFE_INTEGER
    ' 31337',
    '31337 ',
    '031337'
  ];

  for (const chainId of malformed) {
    expectRejected(
      anvilEnv({ CREDENTIAL_REGISTRY_CHAIN_ID: chainId }),
      'CREDENTIAL_REGISTRY_CHAIN_ID',
      String(chainId)
    );
  }
});

// ---------------------------------------------------------------------------
// 10-11, 18: DIRECCION DEL CONTRATO
// ---------------------------------------------------------------------------

test('10: una direccion de contrato mal formada se rechaza', () => {
  for (const address of [
    undefined,
    '',
    'not-an-address',
    '0x123',
    CONTRACT_ADDRESS.slice(0, -1),
    `${CONTRACT_ADDRESS}ab`,
    '0xZZZZB2315678afecb367f032d93F642f64180aa3',
    // `isAddress` de ethers acepta 40 hex pelados; el contrato de env NO, por
    // la misma razon por la que no se recortan espacios.
    CONTRACT_ADDRESS.replace('0x', ''),
    CONTRACT_ADDRESS.replace('0x', '0X')
  ]) {
    expectRejected(
      anvilEnv({ CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: address }),
      'CREDENTIAL_REGISTRY_CONTRACT_ADDRESS',
      String(address)
    );
  }
});

test('11: la direccion cero no es un deployment', () => {
  expectRejected(
    anvilEnv({ CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: ZERO_ADDRESS }),
    'CREDENTIAL_REGISTRY_CONTRACT_ADDRESS',
    'ZeroAddress'
  );
});

test('18: una direccion con espacios alrededor se RECHAZA, no se recorta', () => {
  for (const padded of [
    ` ${CONTRACT_ADDRESS}`,
    `${CONTRACT_ADDRESS} `,
    `\t${CONTRACT_ADDRESS}`,
    `${CONTRACT_ADDRESS}\n`
  ]) {
    expectRejected(
      anvilEnv({ CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: padded }),
      'CREDENTIAL_REGISTRY_CONTRACT_ADDRESS',
      JSON.stringify(padded)
    );
  }
});

test('la direccion aceptada queda en checksum EIP-55 canonico', () => {
  const target = resolveBlockchainTarget(
    anvilEnv({
      CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: CONTRACT_ADDRESS.toLowerCase()
    })
  );

  assert.ok(isCredentialRegistryTarget(target));
  if (!isCredentialRegistryTarget(target)) {
    return;
  }
  assert.equal(target.contractAddress, CONTRACT_ADDRESS);
});

// ---------------------------------------------------------------------------
// 12-13: DEPLOYMENT ID
// ---------------------------------------------------------------------------

test('12-13: un deploymentId vacio o mal formado se rechaza', () => {
  for (const deploymentId of [
    undefined,
    '',
    '  ',
    'ab', // demasiado corto para ser un identificador deliberado
    ' test-deployment',
    'test-deployment ',
    'test deployment', // espacio interno
    '-leading-dash',
    '.leading-dot',
    'con/barra',
    'con:dospuntos',
    'con#fragmento',
    'acentuado-ñ',
    'emoji-\u{1f600}',
    'a'.repeat(65)
  ]) {
    expectRejected(
      anvilEnv({ CREDENTIAL_REGISTRY_DEPLOYMENT_ID: deploymentId }),
      'CREDENTIAL_REGISTRY_DEPLOYMENT_ID',
      JSON.stringify(deploymentId)
    );
  }
});

test('un deploymentId opaco y razonable se acepta tal cual', () => {
  for (const deploymentId of [
    'abc',
    'test-anvil-local',
    'base-sepolia-2026-04-01',
    'CredentialRegistry_v1.0.3',
    'a'.repeat(64)
  ]) {
    const target = resolveBlockchainTarget(
      anvilEnv({ CREDENTIAL_REGISTRY_DEPLOYMENT_ID: deploymentId })
    );

    assert.ok(isCredentialRegistryTarget(target), deploymentId);
    if (!isCredentialRegistryTarget(target)) {
      return;
    }
    assert.equal(target.deploymentId, deploymentId);
  }
});

test('deploymentId y red son identidades DISTINTAS', () => {
  // Varias versiones de CredentialRegistry pueden convivir en la misma cadena,
  // asi que el nombre de la red no puede identificar un deployment. Dos
  // targets con la MISMA red y distinto deployment son distintos.
  const first = resolveBlockchainTarget(
    baseSepoliaEnv({ CREDENTIAL_REGISTRY_DEPLOYMENT_ID: 'deployment-uno' })
  );
  const second = resolveBlockchainTarget(
    baseSepoliaEnv({ CREDENTIAL_REGISTRY_DEPLOYMENT_ID: 'deployment-dos' })
  );

  assert.notDeepEqual(first, second);
  assert.ok(isCredentialRegistryTarget(first) && isCredentialRegistryTarget(second));
  if (!isCredentialRegistryTarget(first) || !isCredentialRegistryTarget(second)) {
    return;
  }
  assert.equal(first.network, second.network);
  assert.equal(first.chainId, second.chainId);
  assert.notEqual(first.deploymentId, second.deploymentId);
});

// ---------------------------------------------------------------------------
// 14-17: RPC URL
// ---------------------------------------------------------------------------

test('14: una rpcUrl mal formada se rechaza', () => {
  for (const rpcUrl of [
    undefined,
    '',
    'no-es-una-url',
    '127.0.0.1:8545', // sin esquema
    '//provider.example/v2',
    'ws://127.0.0.1:8545', // WebSocket no es el transporte de este target
    'wss://provider.example',
    'ftp://provider.example',
    'file:///etc/passwd',
    'javascript:alert(1)'
  ]) {
    expectRejected(
      anvilEnv({ CREDENTIAL_REGISTRY_RPC_URL: rpcUrl }),
      'CREDENTIAL_REGISTRY_RPC_URL',
      String(rpcUrl)
    );
  }
});

test('15: Base Sepolia sobre http:// plano se rechaza', () => {
  for (const rpcUrl of [
    'http://provider.example/v2/KEY',
    'http://127.0.0.1:8545',
    'http://localhost:8545'
  ]) {
    expectRejected(
      baseSepoliaEnv({ CREDENTIAL_REGISTRY_RPC_URL: rpcUrl }),
      'CREDENTIAL_REGISTRY_RPC_URL',
      rpcUrl
    );
  }
});

test('16: el target local acepta http:// sobre loopback', () => {
  for (const rpcUrl of [
    'http://127.0.0.1:8545',
    'http://localhost:8545',
    'http://[::1]:8545'
  ]) {
    const target = resolveBlockchainTarget(
      anvilEnv({ CREDENTIAL_REGISTRY_RPC_URL: rpcUrl })
    );

    assert.ok(isCredentialRegistryTarget(target), rpcUrl);
    if (!isCredentialRegistryTarget(target)) {
      return;
    }
    assert.equal(target.rpcUrl, rpcUrl);
  }
});

test('16b: un anvil REMOTO sobre http:// plano se rechaza; por https si', () => {
  // No se exige localhost para el target local, pero HTTP plano solo se
  // admite contra loopback: un Anvil remoto tambien va cifrado.
  expectRejected(
    anvilEnv({ CREDENTIAL_REGISTRY_RPC_URL: 'http://anvil.interno.example:8545' }),
    'CREDENTIAL_REGISTRY_RPC_URL',
    'anvil remoto por http'
  );

  const target = resolveBlockchainTarget(
    anvilEnv({ CREDENTIAL_REGISTRY_RPC_URL: 'https://anvil.interno.example' })
  );
  assert.ok(isCredentialRegistryTarget(target));
});

test('17: una rpcUrl con espacios alrededor se RECHAZA, no se recorta', () => {
  for (const padded of [
    ` ${SECRET_BEARING_RPC_URL}`,
    `${SECRET_BEARING_RPC_URL} `,
    `\t${SECRET_BEARING_RPC_URL}`,
    `${SECRET_BEARING_RPC_URL}\n`,
    `  ${SECRET_BEARING_RPC_URL}  `
  ]) {
    expectRejected(
      baseSepoliaEnv({ CREDENTIAL_REGISTRY_RPC_URL: padded }),
      'CREDENTIAL_REGISTRY_RPC_URL',
      JSON.stringify(padded)
    );
  }
});

test('la rpcUrl aceptada NO se normaliza de ninguna forma', () => {
  // Pasarla a minuscula, quitarle el query o reescribir el host destruiria en
  // silencio la credencial que el proveedor espera.
  const urls = [
    'https://Provider.Example/V2/MixedCaseKey',
    'https://provider.example/v2/KEY?apiKey=SECRET123',
    'https://provider.example:8443/v2/KEY',
    'https://user:pass@provider.example/v2',
    'https://provider.example/v2/KEY#fragmento'
  ];

  for (const rpcUrl of urls) {
    const target = resolveBlockchainTarget(
      baseSepoliaEnv({ CREDENTIAL_REGISTRY_RPC_URL: rpcUrl })
    );

    assert.ok(isCredentialRegistryTarget(target), rpcUrl);
    if (!isCredentialRegistryTarget(target)) {
      return;
    }
    // Identidad de string EXACTA, no una URL reserializada.
    assert.equal(target.rpcUrl, rpcUrl);
  }
});

// ---------------------------------------------------------------------------
// LOS ERRORES NO FILTRAN LA URL DEL RPC
// ---------------------------------------------------------------------------

test('ningun error de configuracion contiene la rpcUrl ni su credencial', () => {
  const environments: BlockchainTargetEnvironment[] = [
    baseSepoliaEnv({ CREDENTIAL_REGISTRY_CHAIN_ID: '31337' }),
    baseSepoliaEnv({ CREDENTIAL_REGISTRY_NETWORK: 'red-inexistente' }),
    baseSepoliaEnv({ CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: 'invalida' }),
    baseSepoliaEnv({ CREDENTIAL_REGISTRY_DEPLOYMENT_ID: '' }),
    baseSepoliaEnv({
      CREDENTIAL_REGISTRY_RPC_URL: `${SECRET_BEARING_RPC_URL} `
    }),
    baseSepoliaEnv({
      CREDENTIAL_REGISTRY_RPC_URL: 'http://provider.example/v2/SECRET_API_KEY'
    })
  ];

  for (const environment of environments) {
    assert.throws(
      () => resolveBlockchainTarget(environment),
      (error: unknown) => {
        assert.ok(error instanceof BlockchainTargetError);
        const typed = error as BlockchainTargetError;

        assert.equal(typed.code, 'BLOCKCHAIN_TARGET_CONFIG_INVALID');
        assert.equal(
          typed.message,
          safeBlockchainTargetMessage('BLOCKCHAIN_TARGET_CONFIG_INVALID')
        );

        // Ni el mensaje ni NINGUNA propiedad enumerable del error.
        const serialized = `${typed.message} ${JSON.stringify({
          code: typed.code,
          field: typed.field,
          providerErrorName: typed.providerErrorName
        })} ${typed.stack ?? ''}`;

        for (const leak of [
          'SECRET_API_KEY',
          'SECRET123',
          'provider.example',
          'apiKey',
          CONTRACT_ADDRESS,
          '8545'
        ]) {
          assert.ok(
            !serialized.includes(leak),
            `el error no debe contener ${leak}`
          );
        }
        return true;
      }
    );
  }
});

test('el error lleva el NOMBRE de la variable, nunca su valor', () => {
  try {
    resolveBlockchainTarget(
      baseSepoliaEnv({
        CREDENTIAL_REGISTRY_RPC_URL: 'http://provider.example/v2/SECRET_API_KEY'
      })
    );
    assert.fail('deberia haber lanzado');
  } catch (error) {
    const typed = error as BlockchainTargetError;
    assert.equal(typed.field, 'CREDENTIAL_REGISTRY_RPC_URL');
    assert.equal(typed.name, 'BlockchainTargetError');
    // Nada de `cause`: Nest la serializaria en los logs.
    assert.equal((typed as { cause?: unknown }).cause, undefined);
  }
});

test('los cuatro codes tienen mensajes fijos y distintos', () => {
  const codes = [
    'BLOCKCHAIN_TARGET_CONFIG_INVALID',
    'BLOCKCHAIN_RPC_UNAVAILABLE',
    'BLOCKCHAIN_NETWORK_MISMATCH',
    'BLOCKCHAIN_CONTRACT_MISSING'
  ] as const;

  const messages = codes.map((code) => safeBlockchainTargetMessage(code));

  assert.equal(new Set(messages).size, codes.length);
  for (const message of messages) {
    assert.ok(message.length > 0);
    assert.ok(!message.includes('${'));
    assert.ok(!message.includes('undefined'));
  }
});
