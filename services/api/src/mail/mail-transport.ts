/**
 * Transporte de correo transaccional -- interfaz minima.
 *
 * REPARTO DE RESPONSABILIDADES. El modulo que decide enviar (hoy, la
 * recuperacion de contrasena) es dueno del CONTENIDO y del CUANDO: quien recibe,
 * que dice, que enlace lleva. El transporte es dueno del COMO: llamar a un
 * proveedor, simular el envio o negarse. Quien decide no sabe como se autentica
 * ningun proveedor ni a que endpoint HTTP le habla.
 *
 * No es un servicio de notificaciones: no hay plantillas, ni colas, ni canales,
 * ni preferencias. Es UN metodo. Un proveedor real se agrega como una clase mas
 * que implemente esta interfaz, sin tocar la logica de dominio.
 */

export interface MailMessage {
  /** Direccion ya validada por el llamador. */
  to: string;
  subject: string;
  /** Alternativa en texto plano. Obligatoria: no todo cliente renderiza HTML. */
  text: string;
  html: string;
  /**
   * Identifica ESTE mensaje logico para que un proveedor pueda deduplicar un
   * reenvio del mismo mensaje (Resend: encabezado `Idempotency-Key`, ventana de 24 h).
   *
   * Reglas que el llamador debe respetar:
   *   * estable: reintentar EL MISMO mensaje reutiliza la misma clave; un mensaje
   *     nuevo usa una clave nueva. Un proveedor responde 409 si una clave se reutiliza
   *     con un contenido distinto, asi que misma clave implica mismo contenido;
   *   * opaca: un identificador interno, NUNCA un secreto (ni el token de
   *     recuperacion, ni su hash), ni el email, ni nada que identifique a la persona;
   *   * entre 1 y 256 caracteres (el limite de Resend).
   *
   * Opcional: un transporte que no deduplica (`log`, `disabled`) la ignora.
   */
  idempotencyKey?: string;
}

/**
 * Por que fallo un envio. La distincion existe porque la respuesta correcta del
 * dominio depende de ella:
 *
 *   not_sent    fallo DETERMINISTICO antes de salir (config, validacion local).
 *               El mensaje no salio. Seguro tratarlo como no entregado.
 *   rejected    el proveedor lo RECHAZO de forma explicita (4xx). El mensaje no
 *               salio. Seguro tratarlo como no entregado.
 *   ambiguous   timeout, corte de red o 5xx: el proveedor PUDO haberlo aceptado.
 *               No se sabe. Tratarlo como "no entregado" podria dejar una
 *               persona con un enlace recibido pero inutilizable.
 */
export type MailDeliveryFailureKind = 'not_sent' | 'rejected' | 'ambiguous';

/**
 * Error de entrega. NUNCA debe llevar en su mensaje el destinatario, el cuerpo,
 * un enlace ni una credencial: los consumidores solo leen `kind`, pero un
 * `message` con datos terminaria en logs.
 */
export class MailDeliveryError extends Error {
  constructor(
    readonly kind: MailDeliveryFailureKind,
    message = `mail delivery failed (${kind})`
  ) {
    super(message);
    this.name = 'MailDeliveryError';
  }
}

export interface MailTransport {
  /** Identificador estable para logs y diagnostico. */
  readonly kind: string;
  /**
   * `false` = este transporte no puede entregar nada. El dominio lo consulta
   * ANTES de emitir un token: no se crean autorizaciones que nunca podran llegar
   * a una persona.
   */
  readonly operational: boolean;
  send(message: MailMessage): Promise<void>;
}

/** Token de inyeccion de Nest. */
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');
