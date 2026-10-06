import { SSMClient, type SSMClientConfig } from '@aws-sdk/client-ssm';

import { AwsSsmSignerSecretStore } from './aws-ssm-signer-secret-store';
import { type SignerSecretStore } from './signer-secret-store.port';

/**
 * Construccion del almacen de secretos de firma -- S8c2.
 *
 * Mismo patron que `createDocumentStorageAdapterFromEnv`.
 *
 * NO HAY LLAMADA A AWS AQUI. Construir un cliente del SDK v3 no abre
 * conexiones, no resuelve credenciales y no consulta la region: todo eso ocurre
 * recien al enviar un comando, es decir unicamente cuando alguien invoca
 * `getPrivateKey`. Por eso el arranque de la aplicacion sigue funcionando en
 * local y en tests sin credenciales de AWS.
 *
 * CREDENCIALES: cadena por defecto del SDK, o sea el task role de ECS. A
 * diferencia del factory de S3, aca NO se leen `AWS_ACCESS_KEY_ID` ni
 * `AWS_SECRET_ACCESS_KEY`: el material de firma no debe ser alcanzable con
 * credenciales estaticas de larga vida.
 */

export interface SignerSecretStoreFactoryDependencies {
  createSsmClient?: (config: SSMClientConfig) => SSMClient;
}

export function createSignerSecretStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: SignerSecretStoreFactoryDependencies = {}
): SignerSecretStore {
  const region = env.AWS_REGION?.trim();

  // Namespace de referencias admitidas. Defensa en profundidad y OPCIONAL: si
  // no esta definido, solo se valida la forma de la referencia. El limite
  // autoritativo es IAM. La clase queda neutra respecto del entorno; cablear
  // este valor en Terraform pertenece a la slice que active el camino.
  const secretRefPrefix = env.SIGNER_SECRET_REF_PREFIX?.trim();

  const createSsmClient =
    dependencies.createSsmClient ?? ((config) => new SSMClient(config));

  const client = createSsmClient({
    ...(region ? { region } : {})
  });

  return new AwsSsmSignerSecretStore(client, {
    ...(secretRefPrefix ? { secretRefPrefix } : {})
  });
}
