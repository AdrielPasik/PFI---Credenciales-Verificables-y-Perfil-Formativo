import { formatEther, getAddress } from 'ethers';

import { type ValidatedCredentialRegistryArtifact } from './deployment-artifact';
import { DeploymentOperatorError } from './deployment-errors';
import { computeExpectedCreateAddress } from './deployment-evidence';
import {
  CANONICAL_DEPLOYMENT_CHAIN_ID,
  CANONICAL_DEPLOYMENT_NETWORK,
  deriveCanonicalDeploymentId
} from './deployment-id';
import type {
  DeployerSigner,
  DeploymentProvider,
  EncryptedDeployerSignerSource
} from './deployment-operator';
import { type ManifestStore } from './manifest-store';

/**
 * Compuerta previa al envio (PREFLIGHT) -- S8c10.2. SOLO LECTURA.
 *
 * ---------------------------------------------------------------------------
 * UN SOLO CAMINO CANONICO
 * ---------------------------------------------------------------------------
 *
 * `blockchain:deploy-registry` SIN `--execute` produce TODA la evidencia sanitizada
 * que un humano necesita para autorizar el primer envio real. Con `--execute` el
 * operador ejecuta EXACTAMENTE esta misma compuerta, en el mismo proceso, con el
 * mismo provider, inmediatamente antes de su unico envio, y se niega a enviar si
 * no esta lista. No existe una herramienta de sondeo aparte ni un segundo
 * provider: todo lo observado sale del provider que valido la cadena.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTA COMPUERTA NUNCA HACE
 * ---------------------------------------------------------------------------
 *
 * Firmar, enviar, transmitir, crear un manifest, financiar una cuenta o cambiar de
 * nonce. Solo usa llamadas de LECTURA del provider: `getNetwork`,
 * `getTransactionCount`, `getCode`, `estimateGas`, `getFeeData`, `getBalance`. El
 * signer se usa unicamente para conocer la direccion PUBLICA del deployer.
 *
 * Los valores son de UN instante. Caducan: hay que releerlos antes de enviar (y
 * `--execute` lo hace).
 */

export type PreflightBlocker =
  | 'CHAIN_UNAVAILABLE'
  | 'CHAIN_MISMATCH'
  | 'DEPLOYER_HAS_PENDING_TRANSACTIONS'
  | 'EXPECTED_CREATE_ADDRESS_OCCUPIED'
  | 'FINAL_MANIFEST_COLLISION'
  | 'GAS_ESTIMATION_FAILED'
  | 'COST_ESTIMATE_UNAVAILABLE'
  | 'INSUFFICIENT_TESTNET_ETH';

/** Que cota de precio por gas respalda el costo maximo. */
export type PreflightCostBasis = 'maxFeePerGas' | 'gasPrice';

/**
 * Evidencia SANITIZADA. Allowlist cerrada: nada de clave, frase de paso,
 * keystore (contenido ni ruta), URL del RPC, token ni transaccion firmada.
 * `null` significa "no observado"; NUNCA se reemplaza por 0.
 */
export interface PreflightEvidence {
  readonly deploymentSourceCommit: string;
  readonly chainId: number | null;
  readonly deployerAddress: string | null;
  readonly latestNonce: number | null;
  readonly pendingNonce: number | null;
  /** Hay al menos una tx saliente confirmada: se informa, no se asume "wallet nueva". */
  readonly deployerHasConfirmedOutgoingTransactions: boolean | null;
  readonly expectedCreateAddress: string | null;
  readonly expectedCreateAddressCodeEmpty: boolean | null;
  /** `getTransactionCount(expectedCreateAddress, 'latest')`: debe ser 0. */
  readonly expectedCreateAddressNonce: number | null;
  readonly futureDeploymentId: string | null;
  readonly finalManifestCollision: boolean | null;
  readonly creationBytecodeHash: string;
  readonly runtimeBytecodeHash: string;
  readonly estimatedGas: string | null;
  readonly gasPriceWei: string | null;
  readonly maxFeePerGasWei: string | null;
  readonly maxPriorityFeePerGasWei: string | null;
  readonly costBasis: PreflightCostBasis | null;
  /** ESTIMACION PREVIA, no una garantia del costo final. */
  readonly estimatedMaxCostWei: string | null;
  readonly estimatedMaxCostEth: string | null;
  readonly deployerBalanceWei: string | null;
  readonly deployerBalanceEth: string | null;
  readonly balanceCoversEstimatedMaxCost: boolean | null;
  readonly blockers: readonly PreflightBlocker[];
  readonly readyForExplicitBroadcastApproval: boolean;
}

/** Orden estable de claves, y a la vez la allowlist de la salida. */
export const PREFLIGHT_EVIDENCE_FIELDS = [
  'deploymentSourceCommit',
  'chainId',
  'deployerAddress',
  'latestNonce',
  'pendingNonce',
  'deployerHasConfirmedOutgoingTransactions',
  'expectedCreateAddress',
  'expectedCreateAddressCodeEmpty',
  'expectedCreateAddressNonce',
  'futureDeploymentId',
  'finalManifestCollision',
  'creationBytecodeHash',
  'runtimeBytecodeHash',
  'estimatedGas',
  'gasPriceWei',
  'maxFeePerGasWei',
  'maxPriorityFeePerGasWei',
  'costBasis',
  'estimatedMaxCostWei',
  'estimatedMaxCostEth',
  'deployerBalanceWei',
  'deployerBalanceEth',
  'balanceCoversEstimatedMaxCost',
  'blockers',
  'readyForExplicitBroadcastApproval'
] as const satisfies ReadonlyArray<keyof PreflightEvidence>;

export interface PreflightGateInput {
  readonly provider: DeploymentProvider;
  readonly signerSource: EncryptedDeployerSignerSource;
  readonly manifestStore: ManifestStore;
  readonly artifact: ValidatedCredentialRegistryArtifact;
  readonly deploymentSourceCommit: string;
}

export interface PreflightGateOutcome {
  readonly evidence: PreflightEvidence;
  /** Solo para el camino `--execute`; null si la compuerta no llego al signer. */
  readonly signer: DeployerSigner | null;
  readonly pendingNonce: number | null;
  readonly expectedCreateAddress: string | null;
}

/**
 * Costo maximo previo: `estimatedGas x cota de precio por gas`.
 *
 * La cota es la que el emisor realmente usa: `wallet.sendTransaction` deja que
 * ethers complete la tx, y con fee data EIP-1559 la tx lleva `maxFeePerGas` y un
 * `gasLimit` igual a la estimacion. Sin `maxFeePerGas` cae a `gasPrice`. No hay
 * ningun multiplicador inventado.
 *
 * Una cota ausente, o igual a cero, NO es una estimacion defendible: devuelve
 * null. Un precio cero haria que "el saldo cubre el costo" fuera trivialmente
 * verdadero.
 */
export function computeMaxCost(
  estimatedGas: bigint,
  fee: { gasPrice: bigint | null; maxFeePerGas: bigint | null }
): { basis: PreflightCostBasis; perGasWei: bigint; maxCostWei: bigint } | null {
  const candidates: Array<[PreflightCostBasis, bigint | null]> = [
    ['maxFeePerGas', fee.maxFeePerGas],
    ['gasPrice', fee.gasPrice]
  ];

  for (const [basis, perGasWei] of candidates) {
    if (perGasWei !== null && perGasWei > 0n) {
      return { basis, perGasWei, maxCostWei: estimatedGas * perGasWei };
    }
  }

  return null;
}

const toDecimal = (value: bigint | null): string | null =>
  value === null ? null : value.toString(10);

export async function runPreflightGate(
  input: PreflightGateInput
): Promise<PreflightGateOutcome> {
  const { provider, artifact, deploymentSourceCommit } = input;
  const blockers: PreflightBlocker[] = [];

  const observed: {
    -readonly [K in keyof PreflightEvidence]?: PreflightEvidence[K];
  } = {};
  const block = (blocker: PreflightBlocker) => {
    if (!blockers.includes(blocker)) {
      blockers.push(blocker);
    }
  };

  const finish = (
    signer: DeployerSigner | null,
    pendingNonce: number | null,
    expectedCreateAddress: string | null
  ): PreflightGateOutcome => {
    const evidence: PreflightEvidence = {
      deploymentSourceCommit,
      chainId: observed.chainId ?? null,
      deployerAddress: observed.deployerAddress ?? null,
      latestNonce: observed.latestNonce ?? null,
      pendingNonce: observed.pendingNonce ?? null,
      deployerHasConfirmedOutgoingTransactions:
        observed.deployerHasConfirmedOutgoingTransactions ?? null,
      expectedCreateAddress: observed.expectedCreateAddress ?? null,
      expectedCreateAddressCodeEmpty: observed.expectedCreateAddressCodeEmpty ?? null,
      expectedCreateAddressNonce: observed.expectedCreateAddressNonce ?? null,
      futureDeploymentId: observed.futureDeploymentId ?? null,
      finalManifestCollision: observed.finalManifestCollision ?? null,
      creationBytecodeHash: artifact.creationBytecodeHash,
      runtimeBytecodeHash: artifact.runtimeBytecodeHash,
      estimatedGas: observed.estimatedGas ?? null,
      gasPriceWei: observed.gasPriceWei ?? null,
      maxFeePerGasWei: observed.maxFeePerGasWei ?? null,
      maxPriorityFeePerGasWei: observed.maxPriorityFeePerGasWei ?? null,
      costBasis: observed.costBasis ?? null,
      estimatedMaxCostWei: observed.estimatedMaxCostWei ?? null,
      estimatedMaxCostEth: observed.estimatedMaxCostEth ?? null,
      deployerBalanceWei: observed.deployerBalanceWei ?? null,
      deployerBalanceEth: observed.deployerBalanceEth ?? null,
      balanceCoversEstimatedMaxCost: observed.balanceCoversEstimatedMaxCost ?? null,
      blockers: [...blockers],
      // TRUE solo sin ningun bloqueante Y con cada dato requerido realmente observado.
      readyForExplicitBroadcastApproval:
        blockers.length === 0 &&
        observed.chainId === CANONICAL_DEPLOYMENT_CHAIN_ID &&
        observed.deployerAddress != null &&
        observed.latestNonce != null &&
        observed.latestNonce === observed.pendingNonce &&
        observed.expectedCreateAddressCodeEmpty === true &&
        observed.expectedCreateAddressNonce === 0 &&
        observed.finalManifestCollision === false &&
        observed.estimatedGas != null &&
        observed.estimatedMaxCostWei != null &&
        observed.balanceCoversEstimatedMaxCost === true
    };

    return { evidence, signer, pendingNonce, expectedCreateAddress };
  };

  // ---- 1. cadena PRIMERO, con el unico provider ----------------------------
  let observedChainId: bigint;
  try {
    observedChainId = (await provider.getNetwork()).chainId;
  } catch {
    block('CHAIN_UNAVAILABLE');
    return finish(null, null, null);
  }
  if (observedChainId !== BigInt(CANONICAL_DEPLOYMENT_CHAIN_ID)) {
    // El chainId observado no viaja en la salida y el keystore NO se abre.
    block('CHAIN_MISMATCH');
    return finish(null, null, null);
  }
  observed.chainId = CANONICAL_DEPLOYMENT_CHAIN_ID;

  // ---- 2. signer: SOLO para la direccion publica ---------------------------
  let signer: DeployerSigner;
  try {
    signer = await input.signerSource.load(provider);
  } catch {
    throw new DeploymentOperatorError('SIGNER_UNAVAILABLE');
  }

  const deployerAddress = getAddress(signer.address);
  if (/^0x0+$/.test(deployerAddress)) {
    throw new DeploymentOperatorError('SIGNER_UNAVAILABLE');
  }
  observed.deployerAddress = deployerAddress;

  // Una lectura que falla se informa como CHAIN_UNAVAILABLE, sin el error crudo
  // (que puede llevar la URL del RPC con su token).
  const read = async <T>(action: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await action();
    } catch {
      block('CHAIN_UNAVAILABLE');
      return undefined;
    }
  };

  // ---- 3. nonces: pending es la verdad; latest solo contrasta --------------
  const pending = await read(() => provider.getTransactionCount(deployerAddress, 'pending'));
  const latest = await read(() => provider.getTransactionCount(deployerAddress, 'latest'));
  if (pending === undefined) {
    return finish(signer, null, null);
  }
  observed.pendingNonce = pending;
  if (latest !== undefined) {
    observed.latestNonce = latest;
    observed.deployerHasConfirmedOutgoingTransactions = latest > 0;
    if (latest !== pending) {
      // Una tx del deployer sigue sin resolver: sin sustituir nonce ni reemplazar nada.
      block('DEPLOYER_HAS_PENDING_TRANSACTIONS');
    }
  }

  // ---- 4. direccion CREATE esperada y su vacancia --------------------------
  const expectedCreateAddress = computeExpectedCreateAddress(deployerAddress, pending);
  observed.expectedCreateAddress = expectedCreateAddress;
  observed.futureDeploymentId = deriveCanonicalDeploymentId({
    network: CANONICAL_DEPLOYMENT_NETWORK,
    chainId: CANONICAL_DEPLOYMENT_CHAIN_ID,
    contractAddress: expectedCreateAddress
  });

  const code = await read(() => provider.getCode(expectedCreateAddress));
  const createNonce = await read(() =>
    provider.getTransactionCount(expectedCreateAddress, 'latest')
  );
  if (code !== undefined) {
    observed.expectedCreateAddressCodeEmpty = code === '0x' || code === '';
  }
  if (createNonce !== undefined) {
    observed.expectedCreateAddressNonce = createNonce;
  }
  // CREATE vacia exige AMBAS cosas: sin codigo y con nonce 0. Sin codigo no basta.
  if (
    (code !== undefined && !(code === '0x' || code === '')) ||
    (createNonce !== undefined && createNonce !== 0)
  ) {
    block('EXPECTED_CREATE_ADDRESS_OCCUPIED');
  }

  // ---- 5. el manifest final de ese id no puede existir ---------------------
  try {
    observed.finalManifestCollision = await input.manifestStore.exists(
      observed.futureDeploymentId
    );
  } catch {
    // No poder comprobarlo cuenta como colision: falla cerrado.
    observed.finalManifestCollision = true;
  }
  if (observed.finalManifestCollision) {
    block('FINAL_MANIFEST_COLLISION');
  }

  // ---- 6. gas, fee data, costo y saldo -------------------------------------
  let estimatedGas: bigint | undefined;
  try {
    estimatedGas = await provider.estimateGas({
      from: deployerAddress,
      data: artifact.creationBytecode
    });
  } catch {
    block('GAS_ESTIMATION_FAILED');
  }
  if (estimatedGas !== undefined && estimatedGas <= 0n) {
    estimatedGas = undefined;
    block('GAS_ESTIMATION_FAILED');
  }
  if (estimatedGas !== undefined) {
    observed.estimatedGas = estimatedGas.toString(10);
  }

  const fee = await read(() => provider.getFeeData());
  if (fee !== undefined) {
    // Un campo ausente es `null`, distinto de `"0"`.
    observed.gasPriceWei = toDecimal(fee.gasPrice) ?? undefined;
    observed.maxFeePerGasWei = toDecimal(fee.maxFeePerGas) ?? undefined;
    observed.maxPriorityFeePerGasWei = toDecimal(fee.maxPriorityFeePerGas) ?? undefined;
  }

  const balance = await read(() => provider.getBalance(deployerAddress));
  if (balance !== undefined) {
    observed.deployerBalanceWei = balance.toString(10);
    observed.deployerBalanceEth = formatEther(balance);
  }

  if (estimatedGas !== undefined && fee !== undefined) {
    const cost = computeMaxCost(estimatedGas, fee);
    if (cost === null) {
      block('COST_ESTIMATE_UNAVAILABLE');
    } else {
      observed.costBasis = cost.basis;
      observed.estimatedMaxCostWei = cost.maxCostWei.toString(10);
      observed.estimatedMaxCostEth = formatEther(cost.maxCostWei);

      if (balance !== undefined) {
        observed.balanceCoversEstimatedMaxCost = balance >= cost.maxCostWei;
        if (!observed.balanceCoversEstimatedMaxCost) {
          block('INSUFFICIENT_TESTNET_ETH');
        }
      }
    }
  }

  return finish(signer, pending, expectedCreateAddress);
}
