/**
 * Puerto de acceso al material de firma -- S8c2.
 *
 * Deliberadamente minimo: una sola operacion de LECTURA de un secreto exacto.
 * No expone, ni debe exponer nunca:
 *
 *   - creacion de secretos (PutParameter);
 *   - borrado (DeleteParameter);
 *   - enumeracion (GetParametersByPath / DescribeParameters);
 *   - rotacion.
 *
 * La custodia en runtime de la API es READ-ONLY. Aprovisionar y rotar es una
 * operacion fuera de banda del operador, nunca del proceso que sirve requests.
 *
 * `secretRef` es un LOCALIZADOR opaco, no material secreto: la implementacion
 * no lo deriva, no lo reescribe y no lo construye a partir de otros datos. Un
 * `SignerProfile` representa UNA version inmutable de clave, asi que su
 * `secretRef` debe seguir resolviendo a ESE mismo material mientras el perfil
 * exista. Rotar es crear un perfil nuevo con un `secretRef` nuevo, nunca
 * sobrescribir el valor del secreto existente.
 *
 * La abstraccion existe para que un futuro firmante remoto (KMS u otro) pueda
 * reemplazarla sin tocar el dominio. NO se generaliza mas alla de eso: hoy solo
 * hace falta recuperar una clave privada en crudo desde SSM.
 */
/** Token de inyeccion, mismo patron que `DOCUMENT_STORAGE_PORT`. */
export const SIGNER_SECRET_STORE = Symbol('SIGNER_SECRET_STORE');

export interface SignerSecretStore {
  /**
   * Devuelve el material de clave privada referenciado por `secretRef`.
   *
   * El valor devuelto es un string efimero: el llamador construye el signer y
   * no debe retener una referencia separada a esta cadena.
   *
   * Falla cerrado -- nunca devuelve un valor por defecto ni un placeholder.
   */
  getPrivateKey(secretRef: string): Promise<string>;
}
