import { readFileSync } from 'node:fs';

import { type Provider, Wallet, isKeystoreJson } from 'ethers';

import {
  type DeployerSigner,
  type DeploymentProvider,
  type EncryptedDeployerSignerSource
} from './deployment-operator';
import { type ObservedReceipt } from './deployment-evidence';

/**
 * Fuente de signer a partir de un keystore JSON CIFRADO existente -- S8c10.1.
 *
 * SOLO herramienta de operacion. Contrato de la clave del deployer:
 *
 *   keystore cifrado (archivo externo al repo)
 *     -> se descifra EN MEMORIA con una frase de paso pedida sin eco
 *     -> signer de ethers
 *     -> firma la transaccion de creacion
 *     -> el proceso termina.
 *
 * La clave descifrada NO se loguea, NO se devuelve, NO se serializa, NO se
 * escribe en disco, NO se pasa a un proceso hijo, NO se pone en el entorno y NO
 * se pasa por argumentos. Aca no se genera ninguna clave y no se acepta ninguna
 * clave en claro: la unica entrada admitida es la RUTA de un keystore.
 *
 * ERRORES. Cada falla se reduce a un `KeystoreSignerError` con un mensaje FIJO.
 * Nunca viaja el mensaje de ethers ni el de `JSON.parse` (que puede citar un
 * fragmento del archivo), ni la ruta, ni la frase de paso, ni el contenido del
 * keystore. El archivo se lee y se valida ANTES de pedir la frase de paso: un
 * archivo ausente o corrupto no hace tipear una frase para nada.
 */

export type KeystoreSignerErrorCode =
  | 'KEYSTORE_UNREADABLE'
  | 'KEYSTORE_MALFORMED'
  | 'KEYSTORE_DECRYPTION_FAILED';

export class KeystoreSignerError extends Error {
  readonly code: KeystoreSignerErrorCode;

  constructor(code: KeystoreSignerErrorCode) {
    super(
      code === 'KEYSTORE_UNREADABLE'
        ? 'No se pudo leer el archivo de keystore.'
        : code === 'KEYSTORE_MALFORMED'
          ? 'El archivo no es un keystore JSON de Ethereum valido.'
          : 'No se pudo descifrar el keystore con la frase de paso provista.'
    );
    this.name = 'KeystoreSignerError';
    this.code = code;
  }
}

export class KeystoreSignerSource implements EncryptedDeployerSignerSource {
  constructor(
    private readonly keystorePath: string,
    private readonly readPassphrase: () => Promise<string>
  ) {}

  async load(provider: DeploymentProvider): Promise<DeployerSigner> {
    let keystoreJson: string;
    try {
      keystoreJson = readFileSync(this.keystorePath, 'utf8');
    } catch {
      throw new KeystoreSignerError('KEYSTORE_UNREADABLE');
    }

    // Se valida la forma sin que ningun error de parseo cite el contenido.
    try {
      JSON.parse(keystoreJson);
    } catch {
      throw new KeystoreSignerError('KEYSTORE_MALFORMED');
    }
    if (!isKeystoreJson(keystoreJson)) {
      throw new KeystoreSignerError('KEYSTORE_MALFORMED');
    }

    const passphrase = await this.readPassphrase();

    let wallet: Wallet;
    try {
      // `fromEncryptedJson` descifra en memoria. Una frase equivocada o un
      // keystore corrupto lanzan; se reduce a un codigo fijo.
      const decrypted = await Wallet.fromEncryptedJson(keystoreJson, passphrase);
      wallet = decrypted.connect(provider as unknown as Provider) as Wallet;
    } catch {
      throw new KeystoreSignerError('KEYSTORE_DECRYPTION_FAILED');
    }

    // La clave descifrada queda encerrada en esta clausura: el objeto devuelto
    // solo expone la direccion publica y el metodo de envio.
    return {
      address: wallet.address,
      async sendDeployment(request) {
        // Contrato de creacion: SIN `to`. El nonce y el chainId son explicitos, de
        // modo que la direccion CREATE esperada es exactamente la que se calculo.
        const response = await wallet.sendTransaction({
          data: request.data,
          nonce: request.nonce,
          chainId: request.chainId
        });

        return {
          hash: response.hash,
          wait: async (confirmations: number, timeoutMs: number) =>
            (await response.wait(confirmations, timeoutMs)) as unknown as ObservedReceipt | null
        };
      }
    };
  }
}
