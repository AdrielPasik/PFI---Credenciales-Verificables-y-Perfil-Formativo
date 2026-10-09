import {
  DeploymentArtifactError,
  type ValidatedCredentialRegistryArtifact,
  validateCredentialRegistryArtifact
} from './deployment-artifact';
import { DeploymentOperatorError, type SafeDeploymentContext } from './deployment-errors';
import {
  DEPLOYMENT_ACCEPTANCE_CONFIRMATIONS,
  DEPLOYMENT_CONFIRMATION_TIMEOUT_MS,
  type ObservedBlock,
  type ObservedReceipt,
  type ObservedTransaction,
  type ValidatedReceipt,
  validateDeploymentReceipt,
  verifyDeployedRuntimeCode,
  verifyDeploymentBlock,
  verifyDeploymentTransaction
} from './deployment-evidence';
import { CANONICAL_DEPLOYMENT_CHAIN_ID } from './deployment-id';
import {
  type DeploymentManifest,
  DeploymentManifestError,
  buildDeploymentManifest
} from './deployment-manifest';
import {
  type PreflightBlocker,
  type PreflightEvidence,
  runPreflightGate
} from './deployment-preflight';
import {
  type GitStateReader,
  assertCleanSourceAtCommit,
  assertValidSourceCommit
} from './deployment-source-gate';
import {
  type DeploymentToolchain,
  assertArtifactMatchesReviewedHashes,
  assertForgeMatchesToolchain
} from './deployment-toolchain';
import { type ManifestStore } from './manifest-store';

/**
 * Orquestacion UNICA del deployment de CredentialRegistry -- S8c10.1.
 *
 * Es el UNICO emisor aprobado de la transaccion de creacion. Foundry compila y
 * testea; esta herramienta valida la cadena, abre el signer, envia UNA vez,
 * verifica la evidencia y produce el manifest.
 *
 * SOLO herramienta de operacion: el runtime Nest no la importa, no hay endpoint
 * que la dispare y no lee `CREDENTIAL_REGISTRY_PRIVATE_KEY`.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTE ARCHIVO GARANTIZA
 * ---------------------------------------------------------------------------
 *
 *  1. Todo lo que puede fallar ANTES de enviar falla antes de enviar: commit,
 *     arbol, toolchain, artefacto, cadena, signer, nonce, direccion CREATE,
 *     manifest preexistente, estimacion de gas.
 *  2. UN solo `sendDeployment` en todo el archivo. Sin reintento, sin bucle,
 *     sin "reenviar si el wait vence".
 *  3. Un envio sin hash confiable es AMBIGUO: no se reenvia.
 *  4. Un hash confiable es la identidad del intento: si el recibo no llega, se
 *     informa PENDING_RECONCILIATION, nunca se redeploya.
 *  5. El manifest solo se construye con evidencia OBSERVADA, despues de 5
 *     confirmaciones y de una segunda lectura consistente.
 *  6. Un fallo al escribir el manifest NO es un fallo del deployment.
 *
 * Los errores del provider/signer/FS jamas se propagan: pueden arrastrar la URL
 * del RPC (con su token) o rutas locales.
 */

// ---------------------------------------------------------------------------
// Puertos (I/O inyectable; los tests usan dobles)
// ---------------------------------------------------------------------------

export interface DeploymentProvider {
  getNetwork(): Promise<{ chainId: bigint }>;
  getTransactionCount(address: string, blockTag: 'pending' | 'latest'): Promise<number>;
  getCode(address: string): Promise<string>;
  estimateGas(request: { from: string; data: string }): Promise<bigint>;
  getFeeData(): Promise<{
    gasPrice: bigint | null;
    maxFeePerGas: bigint | null;
    maxPriorityFeePerGas: bigint | null;
  }>;
  getBalance(address: string): Promise<bigint>;
  getBlockNumber(): Promise<number>;
  getTransaction(hash: string): Promise<ObservedTransaction | null>;
  getTransactionReceipt(hash: string): Promise<ObservedReceipt | null>;
  getBlock(blockNumber: number): Promise<ObservedBlock | null>;
}

export interface SentDeployment {
  readonly hash: string;
  wait(confirmations: number, timeoutMs: number): Promise<ObservedReceipt | null>;
}

export interface DeployerSigner {
  readonly address: string;
  sendDeployment(request: {
    data: string;
    nonce: number;
    chainId: number;
  }): Promise<SentDeployment>;
}

/**
 * Fuente del signer. La implementacion real abre un keystore JSON CIFRADO y
 * existente; la clave descifrada vive solo en memoria de este proceso.
 */
export interface EncryptedDeployerSignerSource {
  load(provider: DeploymentProvider): Promise<DeployerSigner>;
}

export interface DeploymentOperatorDependencies {
  readonly toolchain: DeploymentToolchain;
  readForgeVersion(): string;
  readonly git: GitStateReader;
  /** Contenido JSON ya parseado del artefacto de Foundry. */
  readArtifact(): unknown;
  /** EL provider. Se crea UNA vez afuera y no se recrea. */
  readonly provider: DeploymentProvider;
  readonly signerSource: EncryptedDeployerSignerSource;
  readonly manifestStore: ManifestStore;
}

export interface DeploymentRunOptions {
  readonly deploymentSourceCommit: string;
  /** `preflight` hace TODA la compuerta previa y se detiene antes de enviar. */
  readonly mode: 'preflight' | 'execute';
}

export type DeploymentRunResult =
  | {
      /**
       * Compuerta previa de SOLO LECTURA. `blockers` vacio y
       * `readyForExplicitBroadcastApproval` verdadero NO autorizan nada: un humano
       * aprueba el `--execute`, que vuelve a correr esta compuerta.
       */
      readonly kind: 'preflight';
      readonly evidence: PreflightEvidence;
    }
  | {
      readonly kind: 'finalized';
      readonly manifest: DeploymentManifest;
      readonly manifestPath: string;
    };

// ---------------------------------------------------------------------------

export async function runCredentialRegistryDeployment(
  dependencies: DeploymentOperatorDependencies,
  options: DeploymentRunOptions
): Promise<DeploymentRunResult> {
  const { provider } = dependencies;

  // ===== A. PREPARACION (cero transacciones) ================================

  const deploymentSourceCommit = assertValidSourceCommit(options.deploymentSourceCommit);

  let forgeVersion: string;
  try {
    forgeVersion = assertForgeMatchesToolchain(
      dependencies.readForgeVersion(),
      dependencies.toolchain
    ).version;
  } catch (error) {
    throw asOperatorError(error, 'TOOLCHAIN_MISMATCH');
  }

  try {
    assertCleanSourceAtCommit(dependencies.git, deploymentSourceCommit);
  } catch (error) {
    throw asOperatorError(error, 'SOURCE_COMMIT_MISMATCH');
  }

  const artifact = loadArtifact(dependencies);

  // ===== B. COMPUERTA PREVIA AL ENVIO (SOLO LECTURA) ========================
  //
  // La misma compuerta sirve al preflight y a `--execute`: un solo camino, un solo
  // provider. Ver `deployment-preflight.ts`.
  const gate = await runPreflightGate({
    provider,
    signerSource: dependencies.signerSource,
    manifestStore: dependencies.manifestStore,
    artifact,
    deploymentSourceCommit
  });
  const { evidence } = gate;

  if (options.mode === 'preflight') {
    return { kind: 'preflight', evidence };
  }

  // `--execute`: se envia SOLO si la compuerta, releida ahora mismo, esta lista.
  // Lo observado en un preflight anterior no vale: caduca.
  const attempt: SafeDeploymentContext = {
    deployerAddress: evidence.deployerAddress ?? undefined,
    nonce: evidence.pendingNonce ?? undefined,
    expectedCreateAddress: evidence.expectedCreateAddress ?? undefined,
    chainId: evidence.chainId ?? undefined,
    creationBytecodeHash: artifact.creationBytecodeHash,
    runtimeBytecodeHash: artifact.runtimeBytecodeHash,
    deploymentSourceCommit
  };

  if (!evidence.readyForExplicitBroadcastApproval) {
    throw new DeploymentOperatorError(errorCodeForBlocker(evidence.blockers[0]), {
      context: attempt,
      reasons: evidence.blockers
    });
  }

  const { signer, pendingNonce: nonce, expectedCreateAddress } = gate;
  const deployerAddress = evidence.deployerAddress as string;
  if (signer === null || nonce === null || expectedCreateAddress === null) {
    throw new DeploymentOperatorError('CHAIN_UNAVAILABLE', { context: attempt });
  }

  // ===== C. MUTACION: UN SOLO ENVIO =========================================

  let sent: SentDeployment;
  try {
    sent = await signer.sendDeployment({
      data: artifact.creationBytecode,
      nonce,
      chainId: CANONICAL_DEPLOYMENT_CHAIN_ID
    });
  } catch {
    throw new DeploymentOperatorError('AMBIGUOUS_DEPLOYMENT_SEND', { context: attempt });
  }

  if (!sent || typeof sent.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(sent.hash)) {
    throw new DeploymentOperatorError('AMBIGUOUS_DEPLOYMENT_SEND', { context: attempt });
  }

  // Desde aca el hash ES la identidad del intento.
  const transactionHash = sent.hash.toLowerCase();
  const sentContext: SafeDeploymentContext = { ...attempt, transactionHash };

  // ===== D. POST-ENVIO ======================================================

  let waitedReceipt: ObservedReceipt | null;
  try {
    waitedReceipt = await sent.wait(
      DEPLOYMENT_ACCEPTANCE_CONFIRMATIONS,
      DEPLOYMENT_CONFIRMATION_TIMEOUT_MS
    );
  } catch {
    throw new DeploymentOperatorError('DEPLOYMENT_PENDING_RECONCILIATION', {
      context: sentContext
    });
  }
  if (!waitedReceipt) {
    throw new DeploymentOperatorError('DEPLOYMENT_PENDING_RECONCILIATION', {
      context: sentContext
    });
  }

  const expectations = {
    transactionHash,
    deployerAddress,
    expectedCreateAddress,
    context: sentContext
  };

  // Pasada A: lo que se observo al alcanzar las confirmaciones.
  const first = await observeEvidence(provider, waitedReceipt, artifact, expectations);

  // Umbral de aceptacion medido de forma INDEPENDIENTE del wait del signer.
  let latestBlock: number;
  try {
    latestBlock = await provider.getBlockNumber();
  } catch {
    throw new DeploymentOperatorError('DEPLOYMENT_PENDING_RECONCILIATION', {
      context: sentContext
    });
  }
  if (latestBlock - first.receipt.blockNumber + 1 < DEPLOYMENT_ACCEPTANCE_CONFIRMATIONS) {
    throw new DeploymentOperatorError('DEPLOYMENT_NOT_YET_CONFIRMED', {
      context: { ...sentContext, blockNumber: first.receipt.blockNumber }
    });
  }

  // Pasada B: se RELEE todo despues del umbral. Si algo cambio, no se finaliza.
  let rereadReceipt: ObservedReceipt | null;
  try {
    rereadReceipt = await provider.getTransactionReceipt(transactionHash);
  } catch {
    throw new DeploymentOperatorError('DEPLOYMENT_PENDING_RECONCILIATION', {
      context: sentContext
    });
  }
  const second = await observeEvidence(provider, rereadReceipt, artifact, expectations);

  if (
    second.receipt.blockNumber !== first.receipt.blockNumber ||
    second.receipt.blockHash !== first.receipt.blockHash ||
    second.receipt.contractAddress !== first.receipt.contractAddress ||
    second.deploymentTimestamp !== first.deploymentTimestamp
  ) {
    throw new DeploymentOperatorError('DEPLOYMENT_EVIDENCE_CONTRADICTION', {
      context: sentContext
    });
  }

  // ===== E. FINALIZACION ====================================================

  let manifest: DeploymentManifest;
  try {
    manifest = buildDeploymentManifest({
      contractAddress: second.receipt.contractAddress,
      deploymentTransactionHash: second.receipt.transactionHash,
      deploymentBlockNumber: second.receipt.blockNumber,
      deploymentBlockHash: second.receipt.blockHash,
      deploymentTimestamp: second.deploymentTimestamp,
      deployerAddress,
      deploymentSourceCommit,
      foundryVersion: forgeVersion,
      creationBytecodeHash: artifact.creationBytecodeHash,
      runtimeBytecodeHash: artifact.runtimeBytecodeHash
    });
  } catch (error) {
    throw new DeploymentOperatorError('DEPLOYMENT_MANIFEST_INVALID', {
      context: sentContext,
      reasons: error instanceof DeploymentManifestError ? error.reasons : []
    });
  }

  const reconstruction: SafeDeploymentContext = {
    ...sentContext,
    contractAddress: manifest.contractAddress,
    blockNumber: manifest.deploymentBlockNumber,
    deploymentId: manifest.deploymentId
  };

  let manifestPath: string;
  try {
    manifestPath = await dependencies.manifestStore.writeNew(manifest);
  } catch {
    // El contrato YA existe on-chain. Nunca se trata como fallo del deployment
    // y nunca dispara otro envio: esta rama termina la ejecucion.
    throw new DeploymentOperatorError('DEPLOYMENT_MANIFEST_PERSISTENCE_FAILED', {
      context: reconstruction
    });
  }

  return { kind: 'finalized', manifest, manifestPath };
}

// ---------------------------------------------------------------------------

interface ObservedPass {
  readonly receipt: ValidatedReceipt;
  readonly deploymentTimestamp: string;
}

/**
 * Una pasada de observacion: recibo, transaccion, codigo y bloque, SIEMPRE por
 * el mismo provider. Un fallo de transporte despues de tener un hash confiable
 * es "pendiente de reconciliacion", no un fallo del deployment.
 */
async function observeEvidence(
  provider: DeploymentProvider,
  rawReceipt: ObservedReceipt | null,
  artifact: ValidatedCredentialRegistryArtifact,
  expectations: {
    transactionHash: string;
    deployerAddress: string;
    expectedCreateAddress: string;
    context: SafeDeploymentContext;
  }
): Promise<ObservedPass> {
  const { context } = expectations;

  const receipt = validateDeploymentReceipt(rawReceipt, expectations);

  const transport = async <T>(read: () => Promise<T>): Promise<T> => {
    try {
      return await read();
    } catch {
      throw new DeploymentOperatorError('DEPLOYMENT_PENDING_RECONCILIATION', { context });
    }
  };

  const code = await transport(() => provider.getCode(receipt.contractAddress));
  verifyDeployedRuntimeCode(code, artifact, context);

  const transaction = await transport(() =>
    provider.getTransaction(expectations.transactionHash)
  );
  verifyDeploymentTransaction(transaction, {
    deployerAddress: expectations.deployerAddress,
    artifact,
    context
  });

  const block = await transport(() => provider.getBlock(receipt.blockNumber));
  const { deploymentTimestamp } = verifyDeploymentBlock(block, receipt, context);

  return { receipt, deploymentTimestamp };
}

function loadArtifact(
  dependencies: DeploymentOperatorDependencies
): ValidatedCredentialRegistryArtifact {
  try {
    const artifact = validateCredentialRegistryArtifact(dependencies.readArtifact());
    assertArtifactMatchesReviewedHashes(artifact, dependencies.toolchain);
    return artifact;
  } catch (error) {
    if (error instanceof DeploymentOperatorError) {
      throw error;
    }
    throw new DeploymentOperatorError('ARTIFACT_INVALID', {
      reasons: error instanceof DeploymentArtifactError ? error.reasons : []
    });
  }
}

/** Bloqueante del preflight -> codigo de error de `--execute` (que no envia). */
function errorCodeForBlocker(
  blocker: PreflightBlocker | undefined
): ConstructorParameters<typeof DeploymentOperatorError>[0] {
  switch (blocker) {
    case 'CHAIN_MISMATCH':
      return 'CHAIN_MISMATCH';
    case 'DEPLOYER_HAS_PENDING_TRANSACTIONS':
      return 'DEPLOYER_HAS_PENDING_TRANSACTIONS';
    case 'EXPECTED_CREATE_ADDRESS_OCCUPIED':
      return 'CREATE_ADDRESS_OCCUPIED';
    case 'FINAL_MANIFEST_COLLISION':
      return 'MANIFEST_ALREADY_EXISTS';
    case 'GAS_ESTIMATION_FAILED':
      return 'PRE_SEND_ESTIMATE_FAILED';
    case 'COST_ESTIMATE_UNAVAILABLE':
      return 'COST_ESTIMATE_UNAVAILABLE';
    case 'INSUFFICIENT_TESTNET_ETH':
      return 'INSUFFICIENT_TESTNET_ETH';
    case 'CHAIN_UNAVAILABLE':
    default:
      return 'CHAIN_UNAVAILABLE';
  }
}

/** Deja pasar un error de dominio y reduce cualquier otro a un codigo fijo. */
function asOperatorError(
  error: unknown,
  fallback: ConstructorParameters<typeof DeploymentOperatorError>[0],
  context?: SafeDeploymentContext
): DeploymentOperatorError {
  return error instanceof DeploymentOperatorError
    ? error
    : new DeploymentOperatorError(fallback, { ...(context ? { context } : {}) });
}
