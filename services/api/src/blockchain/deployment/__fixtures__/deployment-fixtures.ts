import { Wallet, keccak256 } from 'ethers';

import { EXPECTED_ABI_FRAGMENTS } from '../deployment-artifact';
import { Interface } from 'ethers';
import {
  type DeployerSigner,
  type DeploymentOperatorDependencies,
  type DeploymentProvider,
  type SentDeployment
} from '../deployment-operator';
import {
  type ObservedBlock,
  type ObservedReceipt,
  type ObservedTransaction,
  computeExpectedCreateAddress
} from '../deployment-evidence';
import { type GitStateReader } from '../deployment-source-gate';
import { type DeploymentToolchain } from '../deployment-toolchain';
import { type ManifestStore } from '../manifest-store';
import { type DeploymentManifest } from '../deployment-manifest';

/**
 * Dobles de prueba del deployment -- S8c10.1.
 *
 * TODO es sintetico: bytecode inventado, recibos y bloques inventados, signer
 * falso. Ninguna prueba abre un keystore, toca un RPC, AWS, SSM ni Base Sepolia.
 *
 * Las unicas "claves" son los escalares publicos de prueba 1 y 2 (los de siempre
 * en este repo), usados solo para derivar direcciones.
 */

export const TEST_SCALAR_ONE = `0x${'0'.repeat(63)}1`;
export const TEST_SCALAR_TWO = `0x${'0'.repeat(63)}2`;
export const DEPLOYER_ADDRESS = new Wallet(TEST_SCALAR_ONE).address;
export const OTHER_ADDRESS = new Wallet(TEST_SCALAR_TWO).address;

export const SOURCE_COMMIT = 'a'.repeat(40);
export const FORGE_OUTPUT =
  'forge Version: 1.2.3-stable\r\nCommit SHA: a813a2cee7dd4926e7c56fd8a785b54f32e0d10f\r\nBuild Timestamp: 2025-06-08T15:44:09.674540400Z (1749397449)\r\nBuild Profile: maxperf\r\n';

export const RUNTIME_BODY = '6080604052' + 'ab'.repeat(40);
export const RUNTIME_BYTECODE = `0x${RUNTIME_BODY}`;
export const CREATION_BYTECODE = `0x5f5f${RUNTIME_BODY}`;

const abiLines = EXPECTED_ABI_FRAGMENTS.map((fragment) =>
  fragment.slice(fragment.indexOf(':') + 1)
);
export const REAL_ABI = Interface.from(abiLines).fragments.map(
  (fragment) => JSON.parse(fragment.format('json')) as unknown
);

export function syntheticArtifact(
  patch: {
    creation?: string;
    runtime?: string;
    bytecodeLinkReferences?: unknown;
    deployedLinkReferences?: unknown;
    immutableReferences?: unknown;
    compilationTarget?: unknown;
    abi?: unknown;
    compilerVersion?: string;
    optimizerEnabled?: boolean;
  } = {}
) {
  return {
    abi: patch.abi ?? REAL_ABI,
    bytecode: {
      object: patch.creation ?? CREATION_BYTECODE,
      linkReferences: patch.bytecodeLinkReferences ?? {}
    },
    deployedBytecode: {
      object: patch.runtime ?? RUNTIME_BYTECODE,
      linkReferences: patch.deployedLinkReferences ?? {},
      ...(patch.immutableReferences === undefined
        ? {}
        : { immutableReferences: patch.immutableReferences })
    },
    metadata: {
      compiler: { version: patch.compilerVersion ?? '0.8.26+commit.8a97fa7a' },
      settings: {
        remappings: [],
        optimizer: { enabled: patch.optimizerEnabled ?? false, runs: 200 },
        metadata: { bytecodeHash: 'ipfs' },
        compilationTarget: patch.compilationTarget ?? {
          'src/CredentialRegistry.sol': 'CredentialRegistry'
        },
        evmVersion: 'cancun',
        libraries: {}
      }
    }
  };
}

export const CREATION_HASH = keccak256(CREATION_BYTECODE);
export const RUNTIME_HASH = keccak256(RUNTIME_BYTECODE);

export function fixtureToolchain(
  over: Partial<DeploymentToolchain> = {}
): DeploymentToolchain {
  return {
    schemaVersion: 'credential_registry_deployment_toolchain_v1',
    contractName: 'CredentialRegistry',
    network: 'base_sepolia',
    chainId: 84532,
    requiredForgeVersion: '1.2.3-stable',
    requiredForgeCommitSha: 'a813a2cee7dd4926e7c56fd8a785b54f32e0d10f',
    solcVersion: '0.8.26',
    compilerSettings: {
      optimizer: { enabled: false, runs: 200 },
      viaIR: false,
      evmVersion: 'cancun',
      bytecodeHash: 'ipfs'
    },
    reviewedArtifact: {
      creationBytecodeHash: CREATION_HASH,
      runtimeBytecodeHash: RUNTIME_HASH
    },
    ...over
  } as DeploymentToolchain;
}

// ---------------------------------------------------------------------------

export const NONCE = 7;
export const EXPECTED_CREATE_ADDRESS = computeExpectedCreateAddress(
  DEPLOYER_ADDRESS,
  NONCE
);
export const TX_HASH = `0x${'c'.repeat(64)}`;
export const BLOCK_HASH = `0x${'d'.repeat(64)}`;
export const BLOCK_NUMBER = 1000;
export const BLOCK_TIMESTAMP = 1_790_000_000; // 2026-09-21T13:33:20Z

export interface HarnessOptions {
  chainId?: bigint;
  getNetworkError?: boolean;
  forgeOutput?: string;
  head?: string;
  dirty?: string[];
  artifact?: unknown;
  toolchain?: DeploymentToolchain;
  signerLoadError?: boolean;
  /** Se invoca en CADA lectura de recibo (n = 1, 2, ...). Devuelve el recibo. */
  receiptAt?: (n: number) => ObservedReceipt | null;
  codeAt?: (address: string, n: number) => string;
  transaction?: ObservedTransaction | null;
  blockAt?: (n: number) => ObservedBlock | null;
  latestBlock?: number;
  estimateError?: boolean;
  sendError?: boolean;
  sendHash?: string | null;
  waitError?: boolean;
  waitReceipt?: ObservedReceipt | null;
  manifestExists?: boolean;
  writeError?: boolean;
  occupied?: boolean;
  // S8c10.2: lecturas del preflight.
  latestNonce?: number;
  pendingNonce?: number;
  /** `getTransactionCount(expectedCreateAddress, 'latest')`. Default 0. */
  createAddressNonce?: number;
  fee?: { gasPrice: bigint | null; maxFeePerGas: bigint | null; maxPriorityFeePerGas: bigint | null };
  feeError?: boolean;
  balance?: bigint;
  balanceError?: boolean;
  /** Mensaje crudo con una URL y un token: jamas debe reflejarse. */
  poisonedProviderErrors?: boolean;
  estimatedGas?: bigint;
  /** Se invoca en cada llamada al signer que no sea `address`/`sendDeployment`. */
  signerTrap?: boolean;
}

export function goodReceipt(over: Partial<ObservedReceipt> = {}): ObservedReceipt {
  return {
    hash: TX_HASH,
    status: 1,
    to: null,
    from: DEPLOYER_ADDRESS,
    blockNumber: BLOCK_NUMBER,
    blockHash: BLOCK_HASH,
    contractAddress: EXPECTED_CREATE_ADDRESS,
    ...over
  };
}

export function goodBlock(over: Partial<ObservedBlock> = {}): ObservedBlock {
  return {
    number: BLOCK_NUMBER,
    hash: BLOCK_HASH,
    timestamp: BLOCK_TIMESTAMP,
    ...over
  };
}

export function makeHarness(options: HarnessOptions = {}) {
  const counters = {
    send: 0,
    signerLoads: 0,
    getNetwork: 0,
    receiptReads: 0,
    codeReads: 0,
    waits: [] as Array<{ confirmations: number; timeoutMs: number }>,
    manifestWrites: [] as DeploymentManifest[],
    providerCalls: [] as string[],
    signerTouches: [] as string[],
    sentRequests: [] as Array<{ data: string; nonce: number; chainId: number }>
  };

  const provider: DeploymentProvider = {
    async getNetwork() {
      counters.getNetwork += 1;
      counters.providerCalls.push('getNetwork');
      if (options.getNetworkError) {
        throw new Error('ECONNREFUSED https://rpc.example/secret-token');
      }
      return { chainId: options.chainId ?? 84532n };
    },
    async getTransactionCount(address: string, blockTag: 'pending' | 'latest') {
      counters.providerCalls.push(`getTransactionCount:${blockTag}`);
      if (address === EXPECTED_CREATE_ADDRESS && blockTag === 'latest' && counters.send === 0) {
        return options.createAddressNonce ?? 0;
      }
      return blockTag === 'latest'
        ? (options.latestNonce ?? NONCE)
        : (options.pendingNonce ?? NONCE);
    },
    async getFeeData() {
      counters.providerCalls.push('getFeeData');
      if (options.feeError) {
        throw new Error(
          options.poisonedProviderErrors
            ? 'fee fetch failed https://base-sepolia.example/v2/SECRET-TOKEN'
            : 'fee fetch failed'
        );
      }
      return (
        options.fee ?? {
          gasPrice: 1_000_000n,
          maxFeePerGas: 2_000_000n,
          maxPriorityFeePerGas: 1_000n
        }
      );
    },
    async getBalance() {
      counters.providerCalls.push('getBalance');
      if (options.balanceError) {
        throw new Error(
          options.poisonedProviderErrors
            ? 'balance failed https://base-sepolia.example/v2/SECRET-TOKEN'
            : 'balance failed'
        );
      }
      return options.balance ?? 10n ** 18n;
    },
    async getCode(address: string) {
      counters.codeReads += 1;
      counters.providerCalls.push('getCode');
      if (options.codeAt) {
        return options.codeAt(address, counters.codeReads);
      }
      if (address === EXPECTED_CREATE_ADDRESS) {
        // Antes de enviar: vacio (o "ocupado"); despues: el runtime desplegado.
        if (counters.send === 0) {
          return options.occupied ? RUNTIME_BYTECODE : '0x';
        }
        return RUNTIME_BYTECODE;
      }
      return '0x';
    },
    async estimateGas() {
      counters.providerCalls.push('estimateGas');
      if (options.estimateError) {
        throw new Error('execution reverted');
      }
      return options.estimatedGas ?? 600_000n;
    },
    async getBlockNumber() {
      counters.providerCalls.push('getBlockNumber');
      return options.latestBlock ?? BLOCK_NUMBER + 5;
    },
    async getTransaction() {
      counters.providerCalls.push('getTransaction');
      return options.transaction === undefined
        ? {
            hash: TX_HASH,
            to: null,
            from: DEPLOYER_ADDRESS,
            data: CREATION_BYTECODE,
            chainId: 84532n
          }
        : options.transaction;
    },
    async getTransactionReceipt() {
      counters.receiptReads += 1;
      counters.providerCalls.push('getTransactionReceipt');
      return options.receiptAt ? options.receiptAt(counters.receiptReads) : goodReceipt();
    },
    async getBlock() {
      counters.providerCalls.push('getBlock');
      return options.blockAt ? options.blockAt(counters.receiptReads) : goodBlock();
    }
  };

  const signer: DeployerSigner = {
    address: DEPLOYER_ADDRESS,
    async sendDeployment(request) {
      counters.send += 1;
      counters.sentRequests.push({ ...request });
      if (options.sendError) {
        throw new Error('replacement transaction underpriced');
      }
      const sent: SentDeployment = {
        hash: options.sendHash === undefined ? TX_HASH : (options.sendHash as string),
        async wait(confirmations, timeoutMs) {
          counters.waits.push({ confirmations, timeoutMs });
          if (options.waitError) {
            throw new Error('timeout');
          }
          return options.waitReceipt === undefined ? goodReceipt() : options.waitReceipt;
        }
      };
      return sent;
    }
  };

  const git: GitStateReader = {
    headSha: () => options.head ?? SOURCE_COMMIT,
    dirtyPaths: () => options.dirty ?? []
  };

  const manifestStore: ManifestStore = {
    async exists() {
      return options.manifestExists === true;
    },
    async writeNew(manifest) {
      if (options.writeError) {
        throw new Error('EACCES: /home/operator/secret-path');
      }
      counters.manifestWrites.push(manifest);
      return `/tmp/${manifest.deploymentId}.json`;
    }
  };

  const dependencies: DeploymentOperatorDependencies = {
    toolchain: options.toolchain ?? fixtureToolchain(),
    readForgeVersion: () => options.forgeOutput ?? FORGE_OUTPUT,
    git,
    readArtifact: () => options.artifact ?? syntheticArtifact(),
    provider,
    signerSource: {
      async load() {
        counters.signerLoads += 1;
        counters.providerCalls.push('signerLoad');
        if (options.signerLoadError) {
          throw new Error('invalid password for /home/operator/keystore.json');
        }
        if (options.signerTrap) {
          // Cualquier acceso que no sea la direccion PUBLICA delata un intento de
          // firmar o enviar. El preflight no debe tocar nada mas.
          return new Proxy(signer, {
            get(target, property) {
              if (property === 'address') {
                return target.address;
              }
              // `await` consulta `.then` para asimilar promesas: no es un uso del signer.
              if (property === 'then') {
                return undefined;
              }
              counters.signerTouches.push(String(property));
              throw new Error('signer tocado por el preflight');
            }
          });
        }
        return signer;
      }
    },
    manifestStore
  };

  return { dependencies, counters };
}
