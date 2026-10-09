import { assertValidSourceCommit } from './deployment-source-gate';
import { DeploymentOperatorError } from './deployment-errors';

/**
 * Argumentos de la CLI de deployment -- S8c10.1. SOLO herramienta de operacion.
 *
 * ALLOWLIST estricta. Los unicos argumentos son:
 *
 *   --keystore <ruta>          ruta de un keystore JSON cifrado existente
 *   --source-commit <sha>      commit fuente completo (40 hex)
 *   --execute                  sin esto solo corre la compuerta previa (nada se envia)
 *
 * Todo lo demas se rechaza. En particular NO existe, y por lo tanto se rechaza,
 * cualquier forma de entregar una clave, una semilla, una frase de paso o la URL
 * del RPC por la linea de comandos: todos terminarian en el historial del shell
 * y en la lista de procesos.
 *
 *   - la clave descifrada sale de un keystore cifrado;
 *   - la frase de paso se pide por un prompt sin eco;
 *   - la URL del RPC (lleva su token) se toma del entorno o se pide por el mismo
 *     prompt sin eco.
 *
 * El valor de un argumento rechazado NUNCA se repite en el error: podria ser
 * justamente el secreto que se intento pasar.
 */

export interface DeployCliOptions {
  readonly keystorePath: string;
  readonly deploymentSourceCommit: string;
  readonly execute: boolean;
}

export class DeployCliUsageError extends Error {
  readonly code: 'ARGUMENT_NOT_SUPPORTED' | 'ARGUMENT_MISSING' | 'ARGUMENT_INVALID';

  constructor(code: DeployCliUsageError['code']) {
    super(
      code === 'ARGUMENT_NOT_SUPPORTED'
        ? 'Argumento no soportado. Solo se admiten --keystore, --source-commit y --execute.'
        : code === 'ARGUMENT_MISSING'
          ? 'Falta un argumento obligatorio (--keystore y --source-commit).'
          : 'Un argumento tiene un valor invalido.'
    );
    this.name = 'DeployCliUsageError';
    this.code = code;
  }
}

const VALUE_FLAGS = new Set(['--keystore', '--source-commit']);
const BOOLEAN_FLAGS = new Set(['--execute']);

export function parseDeployCliArgs(argv: readonly string[]): DeployCliOptions {
  const values = new Map<string, string>();
  let execute = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (BOOLEAN_FLAGS.has(token)) {
      execute = true;
      continue;
    }

    if (!VALUE_FLAGS.has(token)) {
      throw new DeployCliUsageError('ARGUMENT_NOT_SUPPORTED');
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--') || values.has(token)) {
      throw new DeployCliUsageError('ARGUMENT_INVALID');
    }
    values.set(token, value);
    index += 1;
  }

  const keystorePath = values.get('--keystore');
  const sourceCommit = values.get('--source-commit');

  if (!keystorePath || !sourceCommit) {
    throw new DeployCliUsageError('ARGUMENT_MISSING');
  }

  // Una ruta de keystore no es una clave: si el valor parece una clave en claro o
  // un payload JSON, es un intento (o un error) de pasar el secreto por aca.
  if (
    /^(0x)?[0-9a-fA-F]{64}$/.test(keystorePath) ||
    keystorePath.trimStart().startsWith('{') ||
    keystorePath.trim().split(/\s+/).length >= 12
  ) {
    throw new DeployCliUsageError('ARGUMENT_INVALID');
  }

  try {
    assertValidSourceCommit(sourceCommit);
  } catch (error) {
    if (error instanceof DeploymentOperatorError) {
      throw new DeployCliUsageError('ARGUMENT_INVALID');
    }
    throw error;
  }

  return { keystorePath, deploymentSourceCommit: sourceCommit, execute };
}

/**
 * URL del RPC del deployment. HTTPS obligatorio: Base Sepolia es publica y el
 * proveedor suele llevar su credencial en el path o el query. Se devuelve el
 * string ORIGINAL sin normalizar (reescribirlo podria destruir esa credencial).
 * Nunca se refleja en un error.
 */
export function validateDeploymentRpcUrl(raw: string | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw !== raw.trim()) {
    return null;
  }
  try {
    return new URL(raw).protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
}
