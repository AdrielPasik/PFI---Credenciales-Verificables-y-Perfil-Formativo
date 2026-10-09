/**
 * Errores del operador de deployment -- S8c10.1. SOLO herramienta de operacion.
 *
 * El runtime Nest NO importa nada de este directorio.
 *
 * Todo mensaje es un literal fijo. Nunca se interpola un mensaje de provider,
 * una URL de RPC, una ruta de keystore, una frase de paso ni una clave. El
 * contexto que acompana al error es una ALLOWLIST de hechos publicos (direcciones,
 * hashes, numeros) que el operador necesita para reconciliar.
 */

export type DeploymentOperatorErrorCode =
  // --- preparacion (cero transacciones) ---
  | 'SOURCE_COMMIT_INVALID'
  | 'SOURCE_COMMIT_MISMATCH'
  | 'SOURCE_TREE_DIRTY'
  | 'TOOLCHAIN_MISMATCH'
  | 'ARTIFACT_INVALID'
  | 'CHAIN_UNAVAILABLE'
  | 'CHAIN_MISMATCH'
  | 'SIGNER_UNAVAILABLE'
  | 'CREATE_ADDRESS_OCCUPIED'
  | 'MANIFEST_ALREADY_EXISTS'
  | 'PRE_SEND_ESTIMATE_FAILED'
  | 'DEPLOYER_HAS_PENDING_TRANSACTIONS'
  | 'COST_ESTIMATE_UNAVAILABLE'
  | 'INSUFFICIENT_TESTNET_ETH'
  // --- envio ---
  | 'AMBIGUOUS_DEPLOYMENT_SEND'
  // --- despues de tener un hash confiable ---
  | 'DEPLOYMENT_PENDING_RECONCILIATION'
  | 'DEPLOYMENT_FAILED_RECEIPT'
  | 'DEPLOYMENT_RECEIPT_INVALID'
  | 'DEPLOYMENT_TRANSACTION_MISMATCH'
  | 'DEPLOYMENT_CODE_EMPTY'
  | 'DEPLOYMENT_IDENTITY_MISMATCH'
  | 'DEPLOYMENT_BLOCK_INVALID'
  | 'DEPLOYMENT_NOT_YET_CONFIRMED'
  | 'DEPLOYMENT_EVIDENCE_CONTRADICTION'
  | 'DEPLOYMENT_MANIFEST_INVALID'
  | 'DEPLOYMENT_MANIFEST_PERSISTENCE_FAILED';

const SAFE_MESSAGES: Record<DeploymentOperatorErrorCode, string> = {
  SOURCE_COMMIT_INVALID:
    'El commit fuente del deployment no es un SHA completo de 40 caracteres hexadecimales.',
  SOURCE_COMMIT_MISMATCH:
    'HEAD no coincide con el commit fuente del deployment. No se envio ninguna transaccion.',
  SOURCE_TREE_DIRTY:
    'El arbol de fuentes relevante para el deployment tiene cambios. No se envio ninguna transaccion.',
  TOOLCHAIN_MISMATCH:
    'La version de Foundry instalada no coincide con la toolchain revisada. No se envio ninguna transaccion.',
  ARTIFACT_INVALID:
    'El artefacto compilado de CredentialRegistry no cumple el contrato revisado. No se envio ninguna transaccion.',
  CHAIN_UNAVAILABLE:
    'No se pudo contactar el endpoint de la red. No se envio ninguna transaccion.',
  CHAIN_MISMATCH:
    'La red observada no es la cadena de deployment canonica (Base Sepolia). No se envio ninguna transaccion.',
  SIGNER_UNAVAILABLE:
    'No se pudo abrir el keystore cifrado del deployer. No se envio ninguna transaccion.',
  CREATE_ADDRESS_OCCUPIED:
    'Ya hay codigo en la direccion CREATE esperada. No se envio ninguna transaccion.',
  MANIFEST_ALREADY_EXISTS:
    'Ya existe un manifest para la direccion CREATE esperada. No se envio ninguna transaccion.',
  PRE_SEND_ESTIMATE_FAILED:
    'La estimacion de gas previa al envio fallo. No se envio ninguna transaccion.',
  DEPLOYER_HAS_PENDING_TRANSACTIONS:
    'El deployer tiene transacciones pendientes (nonce pending distinto de latest). No se reemplaza ni se sustituye ningun nonce. No se envio ninguna transaccion.',
  COST_ESTIMATE_UNAVAILABLE:
    'No hay fee data defendible para estimar el costo maximo. No se envio ninguna transaccion.',
  INSUFFICIENT_TESTNET_ETH:
    'El saldo publico del deployer no cubre el costo maximo estimado. No se envio ninguna transaccion.',
  AMBIGUOUS_DEPLOYMENT_SEND:
    'El envio del deployment termino sin un hash de transaccion confiable. NO reenviar: reconciliar primero el nonce del deployer y la direccion CREATE esperada.',
  DEPLOYMENT_PENDING_RECONCILIATION:
    'La transaccion de deployment fue transmitida pero no hay recibo confirmado. NO reenviar: inspeccionar esa transaccion.',
  DEPLOYMENT_FAILED_RECEIPT:
    'El recibo del deployment indica fallo. No hay deployment valido.',
  DEPLOYMENT_RECEIPT_INVALID:
    'El recibo del deployment no cumple la evidencia requerida. No se genera manifest.',
  DEPLOYMENT_TRANSACTION_MISMATCH:
    'La transaccion observada no coincide con el artefacto revisado. No se genera manifest.',
  DEPLOYMENT_CODE_EMPTY:
    'No hay codigo en la direccion del contrato desplegado. La evidencia es invalida.',
  DEPLOYMENT_IDENTITY_MISMATCH:
    'El bytecode runtime on-chain no es el del artefacto revisado. Bloqueo de seguridad.',
  DEPLOYMENT_BLOCK_INVALID:
    'El bloque del deployment no es consistente con el recibo. No se genera manifest.',
  DEPLOYMENT_NOT_YET_CONFIRMED:
    'El deployment no alcanzo las confirmaciones requeridas. No se genera manifest.',
  DEPLOYMENT_EVIDENCE_CONTRADICTION:
    'La evidencia releida tras las confirmaciones contradice la original. No se genera manifest.',
  DEPLOYMENT_MANIFEST_INVALID:
    'El manifest construido no supera la validacion. No se escribe.',
  DEPLOYMENT_MANIFEST_PERSISTENCE_FAILED:
    'El deployment ocurrio on-chain pero el manifest no pudo escribirse. NO redeployar: reconstruirlo desde la transaccion.'
};

/** Hechos publicos permitidos en el contexto de un error. Nada mas. */
export interface SafeDeploymentContext {
  deployerAddress?: string;
  nonce?: number;
  expectedCreateAddress?: string;
  chainId?: number;
  creationBytecodeHash?: string;
  runtimeBytecodeHash?: string;
  deploymentSourceCommit?: string;
  transactionHash?: string;
  contractAddress?: string;
  blockNumber?: number;
  deploymentId?: string;
}

const CONTEXT_KEYS: readonly (keyof SafeDeploymentContext)[] = [
  'deployerAddress',
  'nonce',
  'expectedCreateAddress',
  'chainId',
  'creationBytecodeHash',
  'runtimeBytecodeHash',
  'deploymentSourceCommit',
  'transactionHash',
  'contractAddress',
  'blockNumber',
  'deploymentId'
];

export class DeploymentOperatorError extends Error {
  readonly code: DeploymentOperatorErrorCode;
  readonly context: Readonly<SafeDeploymentContext>;
  /** Codigos de razon estables (nunca texto de excepcion). */
  readonly reasons: readonly string[];

  constructor(
    code: DeploymentOperatorErrorCode,
    options: { context?: SafeDeploymentContext; reasons?: readonly string[] } = {}
  ) {
    super(SAFE_MESSAGES[code]);
    this.name = 'DeploymentOperatorError';
    this.code = code;
    this.reasons = options.reasons ?? [];

    // Se copia SOLO la allowlist, y solo strings/numeros: un objeto de error
    // arbitrario que se colara en el contexto no llega a la salida.
    const safe: SafeDeploymentContext = {};
    for (const key of CONTEXT_KEYS) {
      const value = options.context?.[key];
      if (typeof value === 'string' || typeof value === 'number') {
        (safe as Record<string, string | number>)[key] = value;
      }
    }
    this.context = Object.freeze(safe);
  }
}

/** Salida SEGURA para el operador. */
export function describeDeploymentError(error: unknown): Record<string, unknown> {
  if (error instanceof DeploymentOperatorError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      ...(error.reasons.length > 0 ? { reasons: [...error.reasons] } : {}),
      ...(Object.keys(error.context).length > 0 ? { context: { ...error.context } } : {})
    };
  }

  return {
    ok: false,
    code: 'UNEXPECTED',
    message: 'La operacion fallo por un error no clasificado.'
  };
}
