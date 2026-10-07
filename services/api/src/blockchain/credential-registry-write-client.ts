import { Injectable, Optional } from '@nestjs/common';
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  getAddress,
  isAddress
} from 'ethers';

import {
  resolveCredentialRegistryConfig,
  validateCredentialHash
} from './credential-registry-read-client';
import { type CredentialRegistryDeployment } from './credential-registry-deployment';
import { type CredentialRegistryTarget } from './blockchain-target';
import {
  CredentialRegistryPreflight,
  type CredentialRegistryPreflightProvider
} from './credential-registry-preflight';

const PRIVATE_KEY_PATTERN = /^0x[a-fA-F0-9]{64}$/;

const CREDENTIAL_REGISTRY_WRITE_ABI = [
  'function registerCredential(bytes32 credentialHash)',
  'function revokeCredential(bytes32 credentialHash)'
] as const;

type MinimalTransactionReceipt = {
  status?: number | null;
  blockNumber?: number | null;
};

type MinimalTransactionResponse = {
  hash: string;
  from?: string | null;
  to?: string | null;
  wait(): Promise<MinimalTransactionReceipt | null>;
};

type CredentialRegistryContractWriter = {
  registerCredential(
    credentialHash: string
  ): Promise<MinimalTransactionResponse>;
  revokeCredential(
    credentialHash: string
  ): Promise<MinimalTransactionResponse>;
};

type CredentialRegistryWriteClientOptions = {
  rpcUrl?: string;
  contractAddress?: string;
  privateKey?: string;
  contractWriter?: CredentialRegistryContractWriter;
  /**
   * Target validado del que salio esta configuracion. Cuando esta presente, el
   * preflight de red/contrato corre ANTES de cada escritura.
   *
   * Los dos constructores de PRODUCCION (`createCredentialRegistryWriteClientForTarget`
   * y `createRecordBoundCredentialRegistryWriteClient`) lo pasan siempre. Es el
   * unico camino por el que se construye un writer real.
   */
  target?: CredentialRegistryTarget;
  preflight?: CredentialRegistryPreflight;
  /** Doble de provider para tests. Jamas se usa en produccion. */
  preflightProvider?: CredentialRegistryPreflightProvider;
};

type CredentialRegistryWriteClientConfig = {
  rpcUrl: string;
  contractAddress: string;
  privateKey: string;
};

export type NormalizedCredentialRegistryWriteResult = {
  credentialHash: string;
  transactionHash: string;
  from: string | null;
  to: string | null;
  status: 'success' | 'failed' | 'unknown';
  blockNumber: string | null;
};

export interface CredentialRegistrySignerEnvironment {
  CREDENTIAL_REGISTRY_PRIVATE_KEY?: string;
}

/**
 * Deriva la direccion del signer configurado sin exponer su clave privada.
 * Los flujos que revocan deben comparar esta identidad con el registrante
 * persistido antes de enviar una transaccion al contrato.
 */
export function resolveCredentialRegistrySignerAddress(
  environment: CredentialRegistrySignerEnvironment = process.env
): string {
  const privateKey = validateCredentialRegistryPrivateKey(
    environment.CREDENTIAL_REGISTRY_PRIVATE_KEY ?? ''
  );

  return new Wallet(privateKey).address;
}

@Injectable()
export class CredentialRegistryWriteClient {
  private readonly rpcUrl?: string;
  private readonly contractAddress?: string;
  private readonly privateKey?: string;
  private readonly contractWriter?: CredentialRegistryContractWriter;
  private readonly target?: CredentialRegistryTarget;
  private readonly preflight: CredentialRegistryPreflight;
  private readonly preflightProvider?: CredentialRegistryPreflightProvider;

  constructor(@Optional() options: CredentialRegistryWriteClientOptions = {}) {
    this.rpcUrl = options.rpcUrl ?? process.env.CREDENTIAL_REGISTRY_RPC_URL;
    this.contractAddress =
      options.contractAddress ??
      process.env.CREDENTIAL_REGISTRY_CONTRACT_ADDRESS;
    this.privateKey =
      options.privateKey ?? process.env.CREDENTIAL_REGISTRY_PRIVATE_KEY;
    this.contractWriter = options.contractWriter;
    this.target = options.target;
    this.preflight = options.preflight ?? new CredentialRegistryPreflight();
    this.preflightProvider = options.preflightProvider;
  }

  async registerCredential(
    credentialHash: string
  ): Promise<NormalizedCredentialRegistryWriteResult> {
    return this.executeWrite('registerCredential', credentialHash);
  }

  async revokeCredential(
    credentialHash: string
  ): Promise<NormalizedCredentialRegistryWriteResult> {
    return this.executeWrite('revokeCredential', credentialHash);
  }

  private async executeWrite(
    method: keyof CredentialRegistryContractWriter,
    credentialHash: string
  ) {
    const normalizedHash = validateCredentialHash(credentialHash);

    // PREFLIGHT, dentro del cliente y no en cada llamador: `registerCredential`
    // y `revokeCredential` pasan los dos por aca, asi que comparten UN solo
    // contrato de validacion y no pueden derivar uno del otro. Corre en CADA
    // escritura: no hay cache.
    //
    // Si falla, se lanza ANTES de pedirle una transaccion al contrato.
    if (this.target) {
      await this.preflight.assertWritable(this.target, this.preflightProvider);
    }

    const writer = this.contractWriter ?? this.createContractWriter();
    const transaction = await writer[method](normalizedHash);
    const receipt = await transaction.wait();

    // SIN reintentos. Una escritura que expiro puede haber llegado igual a la
    // red, y reintentar a ciegas duplicaria la transaccion o rompería el nonce.
    // La recuperacion es S8c6.
    return normalizeCredentialRegistryWriteResult(
      normalizedHash,
      transaction,
      receipt
    );
  }

  private createContractWriter(): CredentialRegistryContractWriter {
    const config = resolveCredentialRegistryWriteConfig({
      rpcUrl: this.rpcUrl,
      contractAddress: this.contractAddress,
      privateKey: this.privateKey
    });
    const provider = new JsonRpcProvider(config.rpcUrl);
    const wallet = new Wallet(config.privateKey, provider);
    const contract = new Contract(
      config.contractAddress,
      CREDENTIAL_REGISTRY_WRITE_ABI,
      wallet
    );

    return {
      async registerCredential(credentialHash: string) {
        return (await contract.registerCredential(
          credentialHash
        )) as MinimalTransactionResponse;
      },
      async revokeCredential(credentialHash: string) {
        return (await contract.revokeCredential(
          credentialHash
        )) as MinimalTransactionResponse;
      }
    };
  }
}

/**
 * UNICO constructor de produccion a partir de un target validado.
 *
 * El signer sigue siendo configuracion del SERVIDOR: la clave privada global
 * legacy se lee aca y en ningun otro lado. S8c5 no la reemplaza por el anchor
 * `SignerProfile` por issuer -- ese cutover es S8c6 -- pero ya quita la
 * suposicion de que el signer determine la red, el chainId o el contrato: todo
 * eso viene del target.
 */
export function createCredentialRegistryWriteClientForTarget(
  target: CredentialRegistryTarget,
  environment: CredentialRegistrySignerEnvironment = process.env,
  overrides: {
    preflight?: CredentialRegistryPreflight;
    preflightProvider?: CredentialRegistryPreflightProvider;
    contractWriter?: CredentialRegistryContractWriter;
  } = {}
): CredentialRegistryWriteClient {
  const privateKey = validateCredentialRegistryPrivateKey(
    environment.CREDENTIAL_REGISTRY_PRIVATE_KEY ?? ''
  );

  return new CredentialRegistryWriteClient({
    rpcUrl: target.rpcUrl,
    contractAddress: target.contractAddress,
    privateKey,
    target,
    preflight: overrides.preflight,
    preflightProvider: overrides.preflightProvider,
    contractWriter: overrides.contractWriter
  });
}

/**
 * Construye un cliente de escritura a partir de un deployment ya resuelto por
 * identidad de record. Un deployment resuelto ES un target validado (S8c5), asi
 * que la revocacion obtiene el MISMO preflight que la registracion.
 */
export function createRecordBoundCredentialRegistryWriteClient(
  deployment: CredentialRegistryDeployment,
  environment: CredentialRegistrySignerEnvironment = process.env
): CredentialRegistryWriteClient {
  return createCredentialRegistryWriteClientForTarget(deployment, environment);
}

export function validateCredentialRegistryPrivateKey(privateKey: string) {
  if (!privateKey) {
    throw new Error('CREDENTIAL_REGISTRY_PRIVATE_KEY es requerida.');
  }

  if (!PRIVATE_KEY_PATTERN.test(privateKey)) {
    throw new Error(
      'CREDENTIAL_REGISTRY_PRIVATE_KEY debe tener formato 0x seguido por 64 caracteres hexadecimales.'
    );
  }

  return privateKey;
}

export function resolveCredentialRegistryWriteConfig(
  input: Partial<CredentialRegistryWriteClientConfig>
): CredentialRegistryWriteClientConfig {
  const registryConfig = resolveCredentialRegistryConfig({
    rpcUrl: input.rpcUrl,
    contractAddress: input.contractAddress
  });
  const privateKey = validateCredentialRegistryPrivateKey(
    input.privateKey ?? ''
  );

  return {
    rpcUrl: registryConfig.rpcUrl,
    contractAddress: registryConfig.contractAddress,
    privateKey
  };
}

export function normalizeCredentialRegistryWriteResult(
  credentialHash: string,
  transaction: Pick<MinimalTransactionResponse, 'hash' | 'from' | 'to'>,
  receipt: MinimalTransactionReceipt | null
): NormalizedCredentialRegistryWriteResult {
  return {
    credentialHash,
    transactionHash: transaction.hash,
    from: normalizeAddress(transaction.from),
    to: normalizeAddress(transaction.to),
    status: normalizeReceiptStatus(receipt?.status),
    blockNumber:
      typeof receipt?.blockNumber === 'number'
        ? receipt.blockNumber.toString(10)
        : null
  };
}

function normalizeAddress(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  if (!isAddress(value)) {
    return null;
  }

  return getAddress(value);
}

function normalizeReceiptStatus(status: number | null | undefined) {
  if (status === 1) {
    return 'success' as const;
  }

  if (status === 0) {
    return 'failed' as const;
  }

  return 'unknown' as const;
}
