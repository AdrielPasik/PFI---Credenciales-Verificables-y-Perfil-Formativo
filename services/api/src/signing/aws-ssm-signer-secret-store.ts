import { GetParameterCommand, type SSMClient } from '@aws-sdk/client-ssm';

import {
  SignerResolutionError,
  type SignerResolutionErrorCode
} from './signer-resolution.error';
import { type SignerSecretStore } from './signer-secret-store.port';

/**
 * Implementacion SSM del puerto de secretos -- S8c2.
 *
 * Usa `GetParameter` sobre el nombre EXACTO que trae el `SignerProfile`, con
 * `WithDecryption: true`. No usa `GetParametersByPath` justamente porque la
 * resolucion ya conoce un unico secreto concreto: enumerar seria una capacidad
 * que no necesitamos y que ampliaria el permiso IAM.
 *
 * CREDENCIALES AWS: cadena por defecto del SDK, es decir el task role de ECS.
 * La clase NO acepta, lee ni conoce `AWS_ACCESS_KEY_ID` /
 * `AWS_SECRET_ACCESS_KEY`. El cliente se inyecta ya construido, asi que esta
 * clase tampoco decide region ni endpoint.
 *
 * El cliente llega como `Pick<SSMClient, 'send'>` -- mismo patron que
 * `S3DocumentStorageAdapter` -- para que los tests inyecten un `send` falso y
 * sea IMPOSIBLE que una llamada se escape a AWS.
 */

/** Caracteres admitidos en un nombre jerarquico de parametro SSM. */
const SECRET_REF_PATTERN = /^\/[A-Za-z0-9_.\-/]+$/;
const MAX_SECRET_REF_LENGTH = 2048;

export interface AwsSsmSignerSecretStoreOptions {
  /**
   * Namespace exigido para cualquier `secretRef`. Defensa en profundidad: una
   * referencia claramente fuera del namespace falla ANTES de enviar el comando.
   *
   * Opcional a proposito, para que la clase quede neutra respecto del entorno.
   * El limite AUTORITATIVO es IAM (`ssm:GetParameter` restringido al prefijo de
   * signers); esto solo evita que un dato mal aprovisionado llegue a salir.
   */
  secretRefPrefix?: string;
}

export class AwsSsmSignerSecretStore implements SignerSecretStore {
  private readonly secretRefPrefix?: string;

  constructor(
    private readonly client: Pick<SSMClient, 'send'>,
    options: AwsSsmSignerSecretStoreOptions = {}
  ) {
    const prefix = options.secretRefPrefix?.trim();
    if (prefix) {
      this.secretRefPrefix = prefix;
    }
  }

  async getPrivateKey(secretRef: string): Promise<string> {
    this.assertEligibleSecretRef(secretRef);

    let response: Awaited<ReturnType<typeof this.sendGetParameter>>;
    try {
      response = await this.sendGetParameter(secretRef);
    } catch (error) {
      // Frontera de saneamiento: una excepcion del SDK puede arrastrar
      // metadata de infraestructura en su mensaje. Se conserva UNICAMENTE el
      // nombre de la clase de error, que es un identificador estable y no
      // sensible, y se descarta todo lo demas -- no se adjunta `cause`, porque
      // varios inspectores y loggers lo imprimen de forma automatica.
      throw unavailable('SIGNER_SECRET_UNAVAILABLE', error);
    }

    const parameter = response?.Parameter;

    // Un `String` o `StringList` que contenga algo con forma de clave NO es
    // custodia equivalente: no esta cifrado en reposo. Falla cerrado.
    if (parameter?.Type !== 'SecureString') {
      throw new SignerResolutionError('SIGNER_SECRET_UNAVAILABLE');
    }

    const value = parameter.Value;
    if (typeof value !== 'string' || value.length === 0) {
      throw new SignerResolutionError('SIGNER_SECRET_UNAVAILABLE');
    }

    return value;
  }

  private sendGetParameter(secretRef: string) {
    return this.client.send(
      new GetParameterCommand({
        Name: secretRef,
        WithDecryption: true
      })
    ) as Promise<{
      Parameter?: { Type?: string; Value?: string };
    }>;
  }

  /**
   * Valida la referencia ANTES de cualquier llamada al SDK.
   *
   * La referencia rechazada NUNCA se incluye en el error: es metadata interna
   * de infraestructura.
   */
  private assertEligibleSecretRef(secretRef: string): void {
    if (
      typeof secretRef !== 'string' ||
      secretRef.length === 0 ||
      secretRef.length > MAX_SECRET_REF_LENGTH ||
      !SECRET_REF_PATTERN.test(secretRef) ||
      secretRef.includes('//') ||
      secretRef.includes('..')
    ) {
      throw new SignerResolutionError('SIGNER_SECRET_REFERENCE_REJECTED');
    }

    if (this.secretRefPrefix && !secretRef.startsWith(this.secretRefPrefix)) {
      throw new SignerResolutionError('SIGNER_SECRET_REFERENCE_REJECTED');
    }
  }
}

function unavailable(
  code: SignerResolutionErrorCode,
  error: unknown
): SignerResolutionError {
  return new SignerResolutionError(code, {
    awsErrorName: safeErrorName(error)
  });
}

/**
 * Solo el nombre de la clase, y solo si tiene forma de identificador. Nada de
 * mensajes, request ids, ARNs ni cuerpos de respuesta.
 */
function safeErrorName(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    typeof (error as { name?: unknown }).name === 'string'
  ) {
    const name = (error as { name: string }).name;
    return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : undefined;
  }

  return undefined;
}
