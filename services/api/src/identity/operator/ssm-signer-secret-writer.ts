import { PutParameterCommand, type SSMClient } from '@aws-sdk/client-ssm';

import { type SignerSecretWriter } from '../technical-identity-provisioning.service';

/**
 * Escritor de secretos de firma -- S8c9. SOLO herramienta de operacion.
 *
 * El runtime Nest NO importa este archivo: alli no existe PutParameter ni
 * DeleteParameter. Crea SecureStrings NUEVOS con `Overwrite: false`; si el
 * parametro ya existe, falla. No hay metodo de sobrescritura ni de borrado.
 */
export class SsmSignerSecretWriter implements SignerSecretWriter {
  constructor(
    private readonly client: Pick<SSMClient, 'send'>,
    private readonly kmsKeyId?: string
  ) {}

  async createSecureString(secretRef: string, value: string): Promise<void> {
    await this.client.send(
      new PutParameterCommand({
        Name: secretRef,
        Value: value,
        Type: 'SecureString',
        Overwrite: false,
        ...(this.kmsKeyId ? { KeyId: this.kmsKeyId } : {})
      })
    );
  }
}
