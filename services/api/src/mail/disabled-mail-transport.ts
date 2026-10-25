import {
  MailDeliveryError,
  type MailMessage,
  type MailTransport
} from './mail-transport';

/**
 * Transporte por defecto: no envia nada, nunca.
 *
 * Es el valor seguro. Una instalacion que no configuro correo (o que configuro
 * algo invalido, o que pidio el transporte de desarrollo en produccion) cae
 * aca, y quien consulta `operational` sabe que no debe emitir nada.
 */
export class DisabledMailTransport implements MailTransport {
  readonly kind = 'disabled';
  readonly operational = false;

  async send(_message: MailMessage): Promise<void> {
    // Defensa en profundidad: el dominio no deberia llegar hasta aca.
    throw new MailDeliveryError('not_sent', 'mail transport is disabled');
  }
}
