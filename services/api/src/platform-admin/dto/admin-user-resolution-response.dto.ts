/**
 * Resolucion administrativa de un User por email -- slice S4, READ-ONLY.
 *
 * MINIMO DELIBERADO: dos campos. Es todo lo que la UI necesita para que un
 * Platform Admin CONFIRME visualmente a quien le va a otorgar autoridad antes
 * de ejecutar S5a.
 *
 * POR QUE NO DEVUELVE `userId`. S5a vuelve a recibir el email y resuelve el
 * User server-side por su cuenta. Si esta respuesta transportara un UUID, el
 * cliente pasaria a ser el portador de un identificador que despues podria
 * reenviar como fuente de confianza -- exactamente la autoridad que el diseno
 * le niega al cliente. No devolverlo no es una omision: es lo que mantiene a
 * S5a resolviendo su propio sujeto. El service ni siquiera le PIDE el `id` a la
 * base.
 *
 * Tampoco se exponen: `did`, `status`, `firstName`/`lastName`/`displayName`
 * crudos, `createdAt`/`updatedAt`, `issuerMemberships`, `platformAdmin`,
 * `AuthCredential`, `passwordHash`, `metadata` ni objetos Prisma completos.
 */
export interface AdminUserResolutionResponseDto {
  /**
   * El email NORMALIZADO que efectivamente resolvio (trim + lowercase), no el
   * string crudo que mando el cliente ni necesariamente el casing con el que
   * esta almacenado. Es el valor que el cliente debe reenviar a S5a.
   */
  email: string;
  /**
   * Siempre un string no vacio. Calculado con `buildHolderDisplayLabel`, la
   * unica implementacion del concepto en el repo -- nunca una segunda regla de
   * "nombre + apellido" propia de /admin.
   */
  displayLabel: string;
}
