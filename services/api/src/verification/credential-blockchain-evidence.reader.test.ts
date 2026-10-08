/**
 * EVIDENCIA DE BLOCKCHAIN en la verificacion publica -- S8c7, matriz 28-41.
 *
 * Sin red: el cliente de lectura es un doble y se cuenta cuantas veces se lo
 * llama, asi que "CERO RPC" es una afirmacion verificada y no un comentario.
 * No hay Anvil, no hay Base Sepolia, no hay provider real y no hay transaccion.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { BlockchainNetwork, BlockchainRecordStatus } from '@prisma/client';

import { CredentialRegistryDeploymentResolver } from '../blockchain/credential-registry-deployment';
import { PUBLIC_TEST_KEY_ONE, PUBLIC_TEST_KEY_TWO } from '../signing/__fixtures__/signer-test-keys';
import { CredentialBlockchainEvidenceReader } from './credential-blockchain-evidence.reader';

const CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const MOCK_CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000001';
const CREDENTIAL_HASH =
  '0x9fa83bee0aac884aed8ea28e593d08a858418ac5c4cbca608b2bd37014b1cbca';
const ANCHOR_ADDRESS = PUBLIC_TEST_KEY_ONE.address;
const DEPLOYMENT_ID = 'test-base-sepolia-pending-deploy';

/** Entorno que hace resoluble el deployment de Base Sepolia del record. */
const BASE_SEPOLIA_ENV = {
  BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry',
  CREDENTIAL_REGISTRY_NETWORK: 'base_sepolia',
  CREDENTIAL_REGISTRY_CHAIN_ID: '84532',
  CREDENTIAL_REGISTRY_RPC_URL: 'https://provider.example/v2/SECRET_API_KEY',
  CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: CONTRACT_ADDRESS,
  CREDENTIAL_REGISTRY_DEPLOYMENT_ID: DEPLOYMENT_ID
};

type ChainResult = { kind: string; status?: Record<string, unknown> };

function createReader(options: {
  chainResult?: ChainResult;
  environment?: Record<string, string>;
} = {}) {
  const reads: Array<Record<string, unknown>> = [];

  const readClient = {
    async readTargetBoundCredentialState(input: Record<string, unknown>) {
      reads.push(input);
      return (
        options.chainResult ?? {
          kind: 'credential_state',
          status: {
            credentialHash: CREDENTIAL_HASH,
            exists: true,
            revoked: false,
            issuer: ANCHOR_ADDRESS,
            registeredAt: '1775000000',
            revokedAt: null
          }
        }
      );
    }
  };

  // El resolver REAL de S8c5/S8c6, con el entorno inyectado: no se sustituye
  // la resolucion del target por un doble complaciente.
  const resolver = new (class extends CredentialRegistryDeploymentResolver {
    override resolve(record: never) {
      return super.resolve(record, options.environment ?? BASE_SEPOLIA_ENV);
    }
  })();

  return {
    reader: new CredentialBlockchainEvidenceReader(resolver, readClient as never),
    reads
  };
}

function realRecord(overrides: Record<string, unknown> = {}) {
  return {
    network: BlockchainNetwork.base_sepolia,
    chainId: 84532,
    contractAddress: CONTRACT_ADDRESS,
    credentialHash: CREDENTIAL_HASH,
    status: BlockchainRecordStatus.registered,
    issuerAddress: ANCHOR_ADDRESS,
    anchorSignerProfileId: 'anchor-profile-1',
    anchorSignerAddress: ANCHOR_ADDRESS,
    ...overrides
  };
}

function mockRecord(overrides: Record<string, unknown> = {}) {
  return {
    network: BlockchainNetwork.anvil,
    chainId: 31337,
    contractAddress: MOCK_CONTRACT_ADDRESS,
    credentialHash: CREDENTIAL_HASH,
    status: BlockchainRecordStatus.registered,
    issuerAddress: ANCHOR_ADDRESS,
    anchorSignerProfileId: null,
    anchorSignerAddress: null,
    ...overrides
  };
}

function read(
  reader: CredentialBlockchainEvidenceReader,
  records: Array<Record<string, unknown>>
) {
  return reader.read({
    credentialCanonicalHash: CREDENTIAL_HASH,
    records: records as never
  });
}

// ---------------------------------------------------------------------------
// 28-29: SIN RED
// ---------------------------------------------------------------------------

test('28: un record mock es NOT_APPLICABLE_MOCK con CERO RPC', async () => {
  const { reader, reads } = createReader();

  const result = await read(reader, [mockRecord()]);

  // Mock NO es REGISTERED: significa "a este record no le aplica atestacion
  // externa". No es un exito disfrazado.
  assert.equal(result.blockchainEvidence, 'NOT_APPLICABLE_MOCK');
  assert.equal(result.reason, 'MOCK_EVIDENCE_RECORD');
  assert.deepEqual(reads, [], 'ninguna llamada a la cadena');
});

test('29: sin ninguna fila de evidencia es NOT_FOUND con CERO RPC', async () => {
  const { reader, reads } = createReader();

  const result = await read(reader, []);

  assert.equal(result.blockchainEvidence, 'NOT_FOUND');
  assert.equal(result.reason, 'NO_BLOCKCHAIN_RECORD');
  // No se fabrica un target para buscar el hash en todas las cadenas.
  assert.deepEqual(reads, []);
});

// ---------------------------------------------------------------------------
// 62-63: MULTIPLICIDAD -- FALLA CERRADO SIN ELEGIR
// ---------------------------------------------------------------------------

test('A-D: mas de una fila es UNAVAILABLE ambiguo, sin elegir y sin RPC', async () => {
  const cases: Array<[string, Array<Record<string, unknown>>]> = [
    // A: dos registradas.
    ['dos registradas', [realRecord(), realRecord({ txHash: null })]],
    // B: registrada + pendiente -- no se prefiere ninguna.
    [
      'registrada + pendiente',
      [
        realRecord(),
        realRecord({
          status: BlockchainRecordStatus.pending,
          issuerAddress: null
        })
      ]
    ],
    // C: revocada + registrada -- no se selecciona por estado.
    [
      'revocada + registrada',
      [realRecord({ status: BlockchainRecordStatus.revoked }), realRecord()]
    ],
    // D: dos identicas -- no se deduplica en silencio.
    ['dos identicas', [realRecord(), realRecord()]],
    // Y tambien con un mock de por medio: el mock no gana por estar primero.
    ['mock + real', [mockRecord(), realRecord()]],
    ['tres filas', [realRecord(), realRecord(), mockRecord()]]
  ];

  for (const [label, records] of cases) {
    const { reader, reads } = createReader();
    const result = await read(reader, records);

    assert.equal(result.blockchainEvidence, 'UNAVAILABLE', label);
    assert.equal(result.reason, 'AMBIGUOUS_BLOCKCHAIN_RECORDS', label);
    assert.deepEqual(reads, [], `${label}: cero RPC`);
    assert.equal(result.expectedRegistrantProvenance, null, label);
  }
});

// ---------------------------------------------------------------------------
// 30: TARGET IRRESOLUBLE
// ---------------------------------------------------------------------------

test('30: un target que no se puede reconstruir es UNAVAILABLE', async () => {
  const unresolvable: Array<[string, Record<string, unknown>, Record<string, string>]> = [
    // La configuracion de hoy apunta a OTRO contrato.
    [
      'otro contrato configurado',
      realRecord(),
      {
        ...BASE_SEPOLIA_ENV,
        CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: PUBLIC_TEST_KEY_TWO.address
      }
    ],
    // La configuracion de hoy apunta a OTRA red.
    [
      'otra red configurada',
      realRecord(),
      {
        ...BASE_SEPOLIA_ENV,
        CREDENTIAL_REGISTRY_NETWORK: 'anvil',
        CREDENTIAL_REGISTRY_CHAIN_ID: '31337'
      }
    ],
    // El modo real no esta habilitado.
    [
      'modo mock',
      realRecord(),
      { ...BASE_SEPOLIA_ENV, BLOCKCHAIN_EVIDENCE_MODE: 'mock' }
    ],
    // Sin endpoint no hay conectividad.
    [
      'sin RPC configurado',
      realRecord(),
      { ...BASE_SEPOLIA_ENV, CREDENTIAL_REGISTRY_RPC_URL: '' }
    ],
    // El chainId del record no corresponde a su propia red.
    ['chainId incoherente en el record', realRecord({ chainId: 1 }), BASE_SEPOLIA_ENV]
  ];

  for (const [label, record, environment] of unresolvable) {
    const { reader, reads } = createReader({ environment });
    const result = await read(reader, [record]);

    assert.equal(result.blockchainEvidence, 'UNAVAILABLE', label);
    assert.equal(result.reason, 'DEPLOYMENT_UNRESOLVED', label);
    // Nunca se cae al deployment de hoy ni se fabrica Base Sepolia.
    assert.deepEqual(reads, [], `${label}: cero RPC`);
  }
});

test('el hash del record tiene que ser el canonicalHash de la credential', async () => {
  const { reader, reads } = createReader();

  const result = await reader.read({
    credentialCanonicalHash: `0x${'b'.repeat(64)}`,
    records: [realRecord()] as never
  });

  assert.equal(result.blockchainEvidence, 'UNAVAILABLE');
  assert.equal(result.reason, 'RECORD_HASH_CORRELATION_FAILED');
  assert.deepEqual(reads, []);
});

// ---------------------------------------------------------------------------
// 31: INDISPONIBILIDAD
// ---------------------------------------------------------------------------

test('31: cualquier fallo de lectura de la cadena es UNAVAILABLE', async () => {
  for (const kind of [
    'rpc_unavailable',
    'rpc_chain_id_mismatch',
    'contract_code_missing',
    'registry_read_failed'
  ]) {
    const { reader, reads } = createReader({ chainResult: { kind } });
    const result = await read(reader, [realRecord()]);

    assert.equal(result.blockchainEvidence, 'UNAVAILABLE', kind);
    assert.equal(result.reason, 'RPC_UNAVAILABLE', kind);
    assert.equal(reads.length, 1, kind);
  }
});

test('31b: un desajuste de deployment detectado por el cliente es UNAVAILABLE', async () => {
  const { reader } = createReader({
    chainResult: { kind: 'record_deployment_mismatch' }
  });

  const result = await read(reader, [realRecord()]);

  assert.equal(result.blockchainEvidence, 'UNAVAILABLE');
  assert.equal(result.reason, 'DEPLOYMENT_UNRESOLVED');
});

// ---------------------------------------------------------------------------
// 32-35: FILA PENDIENTE
// ---------------------------------------------------------------------------

const pendingRecord = () =>
  realRecord({
    status: BlockchainRecordStatus.pending,
    // S8c6: los tres hechos de cadena son NULL mientras esta pendiente.
    issuerAddress: null,
    txHash: null,
    registeredAt: null
  });

test('32: pendiente + lectura exitosa que dice "no esta" es PENDING', async () => {
  // No es NOT_FOUND: el intent sigue pendiente y S8c6 se niega a reenviar
  // automaticamente.
  const { reader } = createReader({ chainResult: { kind: 'credential_missing' } });

  const result = await read(reader, [pendingRecord()]);

  assert.equal(result.blockchainEvidence, 'PENDING');
  assert.equal(result.reason, 'PENDING_INTENT_NOT_YET_ON_CHAIN');
});

test('33: pendiente + la cadena SI lo tiene es REGISTERED, sin escribir', async () => {
  // TX #2 pudo fallar o el proceso pudo morir antes de finalizar. La
  // verificacion reporta lo OBSERVADO; adoptar la evidencia en la base es
  // trabajo de la reconciliacion, no de un GET.
  const { reader } = createReader();

  const result = await read(reader, [pendingRecord()]);

  assert.equal(result.blockchainEvidence, 'REGISTERED');
  assert.equal(result.reason, 'CHAIN_STATE_OBSERVED');
  assert.equal(result.expectedRegistrantProvenance, 'anchor_signer_profile');
});

test('34: pendiente + la cadena dice revocada es REVOKED_ON_CHAIN', async () => {
  const { reader } = createReader({
    chainResult: {
      kind: 'credential_state',
      status: { exists: true, revoked: true, issuer: ANCHOR_ADDRESS }
    }
  });

  const result = await read(reader, [pendingRecord()]);

  assert.equal(result.blockchainEvidence, 'REVOKED_ON_CHAIN');
});

test('35: pendiente + registrante inesperado es REGISTRANT_UNEXPECTED', async () => {
  const { reader } = createReader({
    chainResult: { kind: 'credential_issuer_mismatch' }
  });

  const result = await read(reader, [pendingRecord()]);

  assert.equal(result.blockchainEvidence, 'REGISTRANT_UNEXPECTED');
  assert.equal(result.reason, 'REGISTRANT_MISMATCH');
});

test('una fila pendiente sin RPC es UNAVAILABLE, no PENDING', async () => {
  // La dimension pregunta que se puede OBSERVAR ahora. Si no se puede observar
  // nada, lo honesto es decirlo; que el intent exista viaja como metadata.
  const { reader } = createReader({ chainResult: { kind: 'rpc_unavailable' } });

  const result = await read(reader, [pendingRecord()]);

  assert.equal(result.blockchainEvidence, 'UNAVAILABLE');
  assert.equal(result.reason, 'RPC_UNAVAILABLE');
});

// ---------------------------------------------------------------------------
// 36-39: FILA REGISTRADA
// ---------------------------------------------------------------------------

test('36: registrada + la cadena la confirma es REGISTERED', async () => {
  const { reader, reads } = createReader();

  const result = await read(reader, [realRecord()]);

  assert.equal(result.blockchainEvidence, 'REGISTERED');
  // El hash consultado es el del record, sobre el target reconstruido del
  // record y con el registrante esperado explicito.
  assert.equal(reads.length, 1);
  assert.equal(reads[0].credentialHash, CREDENTIAL_HASH);
  assert.equal(reads[0].expectedRegistrant, ANCHOR_ADDRESS);
  assert.deepEqual((reads[0].target as Record<string, unknown>).network, 'base_sepolia');
  assert.equal((reads[0].target as Record<string, unknown>).chainId, 84532);
  assert.equal(
    (reads[0].target as Record<string, unknown>).contractAddress,
    CONTRACT_ADDRESS
  );
});

test('37: registrada + la cadena dice que NO esta es NOT_FOUND', async () => {
  // Evidencia externa NEGATIVA concreta. No se reporta REGISTERED solo porque
  // la base lo dijo una vez: eso es exactamente la brecha que S8a encontro.
  const { reader } = createReader({ chainResult: { kind: 'credential_missing' } });

  const result = await read(reader, [realRecord()]);

  assert.equal(result.blockchainEvidence, 'NOT_FOUND');
  assert.equal(result.reason, 'CHAIN_NOT_REGISTERED');
});

test('38: registrada + RPC caido es UNAVAILABLE, no REGISTERED', async () => {
  const { reader } = createReader({ chainResult: { kind: 'rpc_unavailable' } });

  const result = await read(reader, [realRecord()]);

  assert.equal(result.blockchainEvidence, 'UNAVAILABLE');
  assert.notEqual(result.blockchainEvidence, 'REGISTERED');
});

test('39: registrada + registrante distinto es REGISTRANT_UNEXPECTED', async () => {
  const { reader } = createReader({
    chainResult: { kind: 'credential_issuer_mismatch' }
  });

  const result = await read(reader, [realRecord()]);

  assert.equal(result.blockchainEvidence, 'REGISTRANT_UNEXPECTED');
});

test('una fila revocada en la base + cadena revocada es REVOKED_ON_CHAIN', async () => {
  const { reader } = createReader({
    chainResult: {
      kind: 'credential_state',
      status: { exists: true, revoked: true, issuer: ANCHOR_ADDRESS }
    }
  });

  const result = await read(reader, [
    realRecord({ status: BlockchainRecordStatus.revoked })
  ]);

  assert.equal(result.blockchainEvidence, 'REVOKED_ON_CHAIN');
});

// ---------------------------------------------------------------------------
// 40 + 66: PROCEDENCIA DEL REGISTRANTE ESPERADO
// ---------------------------------------------------------------------------

test('40: una fila legacy sin perfil de ancla usa su issuerAddress persistido', async () => {
  // Compatibilidad: para filas previas a `anchorSignerProfileId` el unico
  // registrante historico disponible es el OBSERVADO en su momento. Se usa como
  // expectativa y se marca LEGACY. No convierte a `issuerAddress` en una nueva
  // fuente de autoridad de firma.
  const { reader, reads } = createReader();

  const result = await read(reader, [
    realRecord({ anchorSignerProfileId: null, anchorSignerAddress: null })
  ]);

  assert.equal(result.blockchainEvidence, 'REGISTERED');
  assert.equal(result.expectedRegistrantProvenance, 'legacy_issuer_address');
  assert.equal(reads[0].expectedRegistrant, ANCHOR_ADDRESS);
});

test('66: el perfil de ancla manda sobre el issuerAddress observado', async () => {
  // Con perfil de ancla presente, la expectativa sale de su direccion PUBLICA.
  // Si se usara `issuerAddress` la comparacion seria circular: se compararia la
  // cadena contra lo que la cadena dijo.
  const { reader, reads } = createReader();

  await read(reader, [
    realRecord({
      anchorSignerProfileId: 'anchor-profile-1',
      anchorSignerAddress: ANCHOR_ADDRESS,
      issuerAddress: PUBLIC_TEST_KEY_TWO.address
    })
  ]);

  assert.equal(reads[0].expectedRegistrant, ANCHOR_ADDRESS);
  assert.notEqual(reads[0].expectedRegistrant, PUBLIC_TEST_KEY_TWO.address);
});

test('66b: sin expectativa confiable es UNAVAILABLE, nunca REGISTRANT_UNEXPECTED', async () => {
  // REGISTRANT_UNEXPECTED exige que EXISTA una expectativa y que la cadena
  // reporte positivamente otra. Sin expectativa no se puede afirmar conflicto.
  const cases: Array<[string, Record<string, unknown>]> = [
    [
      'perfil de ancla sin direccion',
      { anchorSignerProfileId: 'anchor-profile-1', anchorSignerAddress: null }
    ],
    [
      'perfil de ancla con direccion mal formada',
      { anchorSignerProfileId: 'anchor-profile-1', anchorSignerAddress: '0xabc' }
    ],
    [
      'legacy sin issuerAddress',
      { anchorSignerProfileId: null, anchorSignerAddress: null, issuerAddress: null }
    ],
    [
      'legacy con issuerAddress mal formada',
      { anchorSignerProfileId: null, anchorSignerAddress: null, issuerAddress: 'nada' }
    ]
  ];

  for (const [label, override] of cases) {
    const { reader, reads } = createReader();
    const result = await read(reader, [realRecord(override)]);

    assert.equal(result.blockchainEvidence, 'UNAVAILABLE', label);
    assert.equal(result.reason, 'EXPECTED_REGISTRANT_UNRESOLVED', label);
    assert.notEqual(result.blockchainEvidence, 'REGISTRANT_UNEXPECTED', label);
    assert.deepEqual(reads, [], `${label}: cero RPC`);
  }
});

test('con perfil de ancla NO se cae al issuerAddress observado', async () => {
  // Sustituir en silencio la procedencia declarada por el valor observado haria
  // circular la comparacion.
  const { reader, reads } = createReader();

  const result = await read(reader, [
    realRecord({
      anchorSignerProfileId: 'anchor-profile-1',
      anchorSignerAddress: null,
      issuerAddress: ANCHOR_ADDRESS
    })
  ]);

  assert.equal(result.reason, 'EXPECTED_REGISTRANT_UNRESOLVED');
  assert.deepEqual(reads, []);
});

// ---------------------------------------------------------------------------
// 41: NI ESCRITURAS NI CLAVES
// ---------------------------------------------------------------------------

test('41: el lector no recibe ni pide nada que permita escribir o firmar', async () => {
  const { reader, reads } = createReader();

  await read(reader, [realRecord()]);

  // Lo UNICO que viaja al cliente de lectura es target + hash + expectativa.
  assert.deepEqual(Object.keys(reads[0]).sort(), [
    'credentialHash',
    'expectedRegistrant',
    'target'
  ]);
});
