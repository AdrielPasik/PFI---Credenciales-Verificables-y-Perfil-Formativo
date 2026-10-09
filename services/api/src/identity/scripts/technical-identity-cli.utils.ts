import {
  type AnchorChoice,
  TechnicalProvisioningError
} from '../technical-identity-provisioning.service';

/**
 * Parsing y salida SEGURA de la CLI de operacion -- S8c9.
 *
 * Banderas ALLOWLIST. No existe ninguna bandera para entregar una clave: ni
 * clave privada, ni archivo de clave, ni mnemonic, ni ruta de secreto elegida
 * por el operador. Una bandera desconocida es un error, no se ignora.
 */

export type CliCommand =
  | { kind: 'set-capabilities'; issuerId: string; credentialTypes: string[] }
  | { kind: 'provision'; issuerId: string; credentialTypes: string[]; anchor: AnchorChoice }
  | { kind: 'rotate-assertion'; issuerId: string }
  | { kind: 'rotate-anchor'; issuerId: string; anchor: AnchorChoice };

const ALLOWED_FLAGS: Record<CliCommand['kind'], readonly string[]> = {
  'set-capabilities': ['--issuer', '--types'],
  provision: ['--issuer', '--types', '--shared-anchor'],
  'rotate-assertion': ['--issuer'],
  'rotate-anchor': ['--issuer', '--shared-anchor']
};

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

export function parseCliArgs(kind: CliCommand['kind'], argv: readonly string[]): CliCommand {
  const allowed = ALLOWED_FLAGS[kind];
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!allowed.includes(flag)) {
      // No se repite el valor recibido: podria ser material sensible.
      throw new CliUsageError('Argumento no soportado.');
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new CliUsageError(`Falta valor para ${flag}.`);
    }
    if (values.has(flag)) {
      throw new CliUsageError(`Argumento repetido: ${flag}.`);
    }
    values.set(flag, value);
    index += 1;
  }

  const issuerId = values.get('--issuer');
  if (!issuerId) {
    throw new CliUsageError('Falta el argumento --issuer.');
  }

  const types = (): string[] => {
    const raw = values.get('--types');
    if (raw === undefined) {
      throw new CliUsageError('Falta el argumento --types (usar "" para ninguno).');
    }
    return raw === '' ? [] : raw.split(',');
  };
  const anchor = (): AnchorChoice => {
    const shared = values.get('--shared-anchor');
    return shared ? { kind: 'shared', signerProfileId: shared } : { kind: 'new' };
  };

  switch (kind) {
    case 'set-capabilities':
      return { kind, issuerId, credentialTypes: types() };
    case 'provision':
      return { kind, issuerId, credentialTypes: types(), anchor: anchor() };
    case 'rotate-assertion':
      return { kind, issuerId };
    case 'rotate-anchor':
      return { kind, issuerId, anchor: anchor() };
  }
}

/**
 * Salida de error SEGURA: codigo + mensaje fijo + metadata segura. Los errores
 * que no son de dominio se reducen a un literal: nunca se imprime su mensaje.
 */
export function describeCliError(error: unknown): Record<string, unknown> {
  if (error instanceof TechnicalProvisioningError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      ...(error.orphanSecretRefs.length > 0
        ? { orphanSecretRefs: [...error.orphanSecretRefs] }
        : {}),
      ...(error.unattachedProfileIds.length > 0
        ? { unattachedProfileIds: [...error.unattachedProfileIds] }
        : {}),
      ...(error.causeCode ? { causeCode: error.causeCode } : {})
    };
  }
  if (error instanceof CliUsageError) {
    return { ok: false, code: 'USAGE', message: error.message };
  }
  if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') {
    return { ok: false, code: (error as { code: string }).code, message: 'Operacion rechazada.' };
  }
  return { ok: false, code: 'UNEXPECTED', message: 'Operacion fallida.' };
}
