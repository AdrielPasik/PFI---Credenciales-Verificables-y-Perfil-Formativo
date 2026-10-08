import { Injectable, Optional } from '@nestjs/common';
import { Contract, ZeroAddress, getAddress, isAddress } from 'ethers';

import {
  BlockchainTargetError,
  type CredentialRegistryTarget
} from './blockchain-target';
import {
  type BlockchainRecordDeploymentIdentity,
  type CredentialRegistryDeployment,
  deploymentMatchesBlockchainRecord
} from './credential-registry-deployment';
import {
  CredentialRegistryPreflight,
  type CredentialRegistryPreflightProvider,
  createCredentialRegistryProvider,
  createCredentialRegistryProviderForRpcUrl
} from './credential-registry-preflight';

/**
 * Lectura del CredentialRegistry.
 *
 * ---------------------------------------------------------------------------
 * UN SOLO PROVIDER POR EVALUACION -- S8c7, addendum B
 * ---------------------------------------------------------------------------
 *
 * Hasta S8c6 este cliente creaba DOS `JsonRpcProvider`: uno para validar
 * cadena y codigo, y otro -- dentro de `createContractReader` -- para la
 * llamada al contrato. Validar un camino y observar por otro vacia de sentido
 * la validacion.
 *
 * Ademas el segundo provider se construia con `new JsonRpcProvider(url)`
 * directo, sin el `FetchRequest` con timeout de 10 s que S8c5 fijo como UNICA
 * construccion de provider de produccion.
 *
 * Ahora hay una sola construccion por evaluacion, via
 * `createCredentialRegistryProvider` de S8c5, y ese MISMO objeto se le pasa al
 * preflight y al `Contract`.
 *
 * ---------------------------------------------------------------------------
 * LA VALIDACION DE CADENA/CODIGO NO SE DUPLICA
 * ---------------------------------------------------------------------------
 *
 * El `getNetwork` + comparacion de cadena + `getCode` + validacion de bytecode
 * son EXACTAMENTE `CredentialRegistryPreflight.assertWritable` de S8c5, que se
 * reutiliza tal cual. Su nombre dice "writable", pero su implementacion es una
 * comprobacion de ALCANZABILIDAD del target -- cadena esperada y contrato
 * presente -- y vale igual para una lectura. Escribir una segunda version aca
 * seria el fork que el addendum B prohibe, y las dos implementaciones podrian
 * divergir despues.
 */

const CREDENTIAL_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

const CREDENTIAL_REGISTRY_READ_ABI = [
  'function getCredentialStatus(bytes32 credentialHash) view returns (bool exists, bool revoked, address issuer, uint256 registeredAt, uint256 revokedAt)'
] as const;

type CredentialRegistryStatusTuple = readonly [
  boolean,
  boolean,
  string,
  bigint,
  bigint
];

type CredentialRegistryStatusStruct = {
  exists: boolean;
  revoked: boolean;
  issuer: string;
  registeredAt: bigint;
  revokedAt: bigint;
};

type RawCredentialRegistryStatus =
  | CredentialRegistryStatusTuple
  | CredentialRegistryStatusStruct;

type CredentialRegistryContractReader = {
  getCredentialStatus(
    credentialHash: string
  ): Promise<RawCredentialRegistryStatus>;
};

/**
 * Lo minimo que una lectura necesita de un provider: exactamente el contrato
 * del preflight de S8c5, mas nada. El `Contract` de ethers recibe este mismo
 * objeto como runner.
 */
export type CredentialRegistryReadProvider = CredentialRegistryPreflightProvider;

type CredentialRegistryReadClientOptions = {
  rpcUrl?: string;
  contractAddress?: string;
  contractReader?: CredentialRegistryContractReader;
  networkProvider?: CredentialRegistryReadProvider;
  /** Preflight inyectable. En produccion se usa el de S8c5. */
  preflight?: CredentialRegistryPreflight;
  /** Fabricas inyectables para probar la IDENTIDAD del provider sin red. */
  createProvider?: (target: CredentialRegistryTarget) => CredentialRegistryReadProvider;
  createContractReaderOnProvider?: (
    target: CredentialRegistryTarget,
    provider: CredentialRegistryReadProvider
  ) => CredentialRegistryContractReader;
};

type CredentialRegistryReadClientConfig = {
  rpcUrl: string;
  contractAddress: string;
};

export type NormalizedCredentialRegistryStatus = {
  credentialHash: string;
  exists: boolean;
  revoked: boolean;
  issuer: string | null;
  registeredAt: string | null;
  revokedAt: string | null;
};

export interface CredentialRegistryStatusReader {
  getCredentialStatus(
    credentialHash: string
  ): Promise<NormalizedCredentialRegistryStatus>;
}

export type RecordBoundCredentialRegistryReadResult =
  | {
      kind: 'credential_state';
      status: NormalizedCredentialRegistryStatus;
    }
  | {
      kind:
        | 'record_deployment_mismatch'
        /** El nodo responde otra cadena que la esperada por el deployment. */
        | 'rpc_chain_id_mismatch'
        /** No hay bytecode en la direccion configurada. */
        | 'contract_code_missing'
        /**
         * El provider no se pudo consultar: timeout, transporte, DNS. S8c7 lo
         * separa de los dos de arriba, que son respuestas NEGATIVAS del nodo y
         * no indisponibilidad. Antes un `getNetwork` que lanzaba se reportaba
         * como desajuste de cadena, que es una afirmacion que no se tenia.
         */
        | 'rpc_unavailable'
        | 'registry_read_failed'
        | 'credential_missing'
        | 'credential_issuer_mismatch';
    };

export interface CredentialRegistryRecordBoundReader {
  readRecordBoundCredentialState(input: {
    deployment: CredentialRegistryDeployment;
    record: BlockchainRecordDeploymentIdentity;
  }): Promise<RecordBoundCredentialRegistryReadResult>;
}

/**
 * Lectura ligada a un target con el registrante ESPERADO explicito.
 *
 * El registrante esperado NO sale de este cliente: lo decide quien conoce la
 * procedencia del record (S8c6 -> `anchorSignerProfile.address`; legacy ->
 * `issuerAddress`). Este cliente no consulta Prisma y no elige identidades.
 */
export interface CredentialRegistryTargetBoundReader {
  readTargetBoundCredentialState(input: {
    target: CredentialRegistryTarget;
    credentialHash: string;
    expectedRegistrant: string;
  }): Promise<RecordBoundCredentialRegistryReadResult>;
}

@Injectable()
export class CredentialRegistryReadClient
  implements
    CredentialRegistryStatusReader,
    CredentialRegistryRecordBoundReader,
    CredentialRegistryTargetBoundReader
{
  private readonly rpcUrl?: string;
  private readonly contractAddress?: string;
  private readonly contractReader?: CredentialRegistryContractReader;
  private readonly networkProvider?: CredentialRegistryReadProvider;
  private readonly preflight: CredentialRegistryPreflight;
  private readonly providerFactory?: CredentialRegistryReadClientOptions['createProvider'];
  private readonly contractReaderFactory?: CredentialRegistryReadClientOptions['createContractReaderOnProvider'];

  constructor(@Optional() options: CredentialRegistryReadClientOptions = {}) {
    this.rpcUrl = options.rpcUrl ?? process.env.CREDENTIAL_REGISTRY_RPC_URL;
    this.contractAddress =
      options.contractAddress ??
      process.env.CREDENTIAL_REGISTRY_CONTRACT_ADDRESS;
    this.contractReader = options.contractReader;
    this.networkProvider = options.networkProvider;
    this.preflight = options.preflight ?? new CredentialRegistryPreflight();
    this.providerFactory = options.createProvider;
    this.contractReaderFactory = options.createContractReaderOnProvider;
  }

  async getCredentialStatus(
    credentialHash: string
  ): Promise<NormalizedCredentialRegistryStatus> {
    const normalizedHash = validateCredentialHash(credentialHash);
    const reader =
      this.contractReader ?? this.createConfiguredContractReader();
    const rawStatus = await reader.getCredentialStatus(normalizedHash);

    return normalizeCredentialRegistryStatus(normalizedHash, rawStatus);
  }

  /**
   * Compatibilidad: el registrante esperado es el `issuerAddress` PERSISTIDO.
   *
   * Es la semantica historica de este metodo y la unica disponible para filas
   * previas a `anchorSignerProfileId`. Los consumidores nuevos usan
   * `readTargetBoundCredentialState` y deciden la procedencia ellos.
   */
  async readRecordBoundCredentialState(input: {
    deployment: CredentialRegistryDeployment;
    record: BlockchainRecordDeploymentIdentity;
  }): Promise<RecordBoundCredentialRegistryReadResult> {
    if (!deploymentMatchesBlockchainRecord(input.deployment, input.record)) {
      return { kind: 'record_deployment_mismatch' };
    }

    return this.readTargetBoundCredentialState({
      target: input.deployment,
      credentialHash: input.record.credentialHash,
      expectedRegistrant: input.record.issuerAddress
    });
  }

  async readTargetBoundCredentialState(input: {
    target: CredentialRegistryTarget;
    credentialHash: string;
    expectedRegistrant: string;
  }): Promise<RecordBoundCredentialRegistryReadResult> {
    // UN SOLO provider para esta evaluacion.
    const provider = this.resolveProvider(input.target);

    // Cadena esperada + contrato presente, con la implementacion de S8c5.
    try {
      await this.preflight.assertWritable(input.target, provider);
    } catch (error) {
      return { kind: preflightFailureKind(error) };
    }

    let status: NormalizedCredentialRegistryStatus;
    try {
      // El MISMO provider que acaba de autorizarse.
      const reader = this.resolveContractReader(input.target, provider);
      const normalizedHash = validateCredentialHash(input.credentialHash);
      const rawStatus = await reader.getCredentialStatus(normalizedHash);
      status = normalizeCredentialRegistryStatus(normalizedHash, rawStatus);
    } catch {
      return { kind: 'registry_read_failed' };
    }

    if (!status.exists) {
      return { kind: 'credential_missing' };
    }

    if (!addressesMatch(status.issuer, input.expectedRegistrant)) {
      return { kind: 'credential_issuer_mismatch' };
    }

    return { kind: 'credential_state', status };
  }

  /**
   * Lectura por CONFIGURACION de entorno, sin record ni target: la usa el
   * script de operacion `blockchain:status`. No hace preflight -- el operador
   * pide explicitamente una consulta puntual -- pero si construye el provider
   * por la via de S8c5, con su timeout.
   */
  private createConfiguredContractReader(): CredentialRegistryContractReader {
    const config = resolveCredentialRegistryConfig({
      rpcUrl: this.rpcUrl,
      contractAddress: this.contractAddress
    });
    const contract = new Contract(
      config.contractAddress,
      CREDENTIAL_REGISTRY_READ_ABI,
      createCredentialRegistryProviderForRpcUrl(config.rpcUrl)
    );

    return {
      async getCredentialStatus(credentialHash: string) {
        return (await contract.getCredentialStatus(
          credentialHash
        )) as RawCredentialRegistryStatus;
      }
    };
  }

  private resolveProvider(
    target: CredentialRegistryTarget
  ): CredentialRegistryReadProvider {
    if (this.networkProvider) {
      return this.networkProvider;
    }

    if (this.providerFactory) {
      return this.providerFactory(target);
    }

    // UNICA construccion de produccion: la de S8c5, con su FetchRequest y su
    // timeout. No hay un segundo `new JsonRpcProvider` en este archivo.
    return createCredentialRegistryProvider(target);
  }

  private resolveContractReader(
    target: CredentialRegistryTarget,
    provider: CredentialRegistryReadProvider
  ): CredentialRegistryContractReader {
    if (this.contractReader) {
      return this.contractReader;
    }

    if (this.contractReaderFactory) {
      return this.contractReaderFactory(target, provider);
    }

    const contract = new Contract(
      getAddress(target.contractAddress),
      CREDENTIAL_REGISTRY_READ_ABI,
      // El provider YA validado. Nunca uno nuevo.
      provider as never
    );

    return {
      async getCredentialStatus(credentialHash: string) {
        return (await contract.getCredentialStatus(
          credentialHash
        )) as RawCredentialRegistryStatus;
      }
    };
  }
}

/**
 * Traduce el fallo del preflight de S8c5 al resultado de lectura.
 *
 * `BLOCKCHAIN_RPC_UNAVAILABLE` se mapea a `rpc_unavailable` -- indisponibilidad
 * -- y NO a desajuste de cadena ni a contrato ausente, que son afirmaciones
 * positivas sobre el nodo que un timeout no autoriza a hacer.
 */
function preflightFailureKind(
  error: unknown
): 'rpc_chain_id_mismatch' | 'contract_code_missing' | 'rpc_unavailable' {
  if (error instanceof BlockchainTargetError) {
    if (error.code === 'BLOCKCHAIN_NETWORK_MISMATCH') {
      return 'rpc_chain_id_mismatch';
    }

    if (error.code === 'BLOCKCHAIN_CONTRACT_MISSING') {
      return 'contract_code_missing';
    }
  }

  return 'rpc_unavailable';
}

export function validateCredentialHash(credentialHash: string) {
  if (!credentialHash) {
    throw new Error('credentialHash es requerido.');
  }

  if (!CREDENTIAL_HASH_PATTERN.test(credentialHash)) {
    throw new Error(
      'credentialHash debe tener formato 0x seguido por 64 caracteres hexadecimales.'
    );
  }

  return credentialHash.toLowerCase();
}

export function resolveCredentialRegistryConfig(
  input: Partial<CredentialRegistryReadClientConfig>
): CredentialRegistryReadClientConfig {
  if (!input.rpcUrl) {
    throw new Error('CREDENTIAL_REGISTRY_RPC_URL es requerido.');
  }

  if (!input.contractAddress) {
    throw new Error('CREDENTIAL_REGISTRY_CONTRACT_ADDRESS es requerido.');
  }

  if (!isAddress(input.contractAddress)) {
    throw new Error(
      'CREDENTIAL_REGISTRY_CONTRACT_ADDRESS debe ser una direccion Ethereum valida.'
    );
  }

  return {
    rpcUrl: input.rpcUrl,
    contractAddress: getAddress(input.contractAddress)
  };
}

export function normalizeCredentialRegistryStatus(
  credentialHash: string,
  rawStatus: RawCredentialRegistryStatus
): NormalizedCredentialRegistryStatus {
  const status = toCredentialRegistryStatusStruct(rawStatus);

  return {
    credentialHash,
    exists: status.exists,
    revoked: status.revoked,
    issuer:
      status.issuer && status.issuer !== ZeroAddress
        ? getAddress(status.issuer)
        : null,
    registeredAt: normalizeTimestamp(status.registeredAt),
    revokedAt: normalizeTimestamp(status.revokedAt)
  };
}

function toCredentialRegistryStatusStruct(
  rawStatus: RawCredentialRegistryStatus
): CredentialRegistryStatusStruct {
  if (Array.isArray(rawStatus)) {
    const [exists, revoked, issuer, registeredAt, revokedAt] = rawStatus;

    return {
      exists,
      revoked,
      issuer,
      registeredAt,
      revokedAt
    };
  }

  const status = rawStatus as CredentialRegistryStatusStruct;

  return {
    exists: status.exists,
    revoked: status.revoked,
    issuer: status.issuer,
    registeredAt: status.registeredAt,
    revokedAt: status.revokedAt
  };
}

function normalizeTimestamp(value: bigint) {
  return value > 0n ? value.toString(10) : null;
}

function addressesMatch(
  onChainAddress: string | null,
  persistedAddress: string
): boolean {
  if (!onChainAddress || !isAddress(persistedAddress)) {
    return false;
  }

  return onChainAddress === getAddress(persistedAddress);
}
