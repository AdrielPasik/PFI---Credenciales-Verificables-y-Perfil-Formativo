import { Logger } from '@nestjs/common';

import type { MailMessage, MailTransport } from './mail-transport';

/** Cuantos mensajes recuerda `outbox`. Acotado: es una ayuda de desarrollo. */
const OUTBOX_LIMIT = 20;

export interface LogMailTransportOptions {
  /**
   * Destino de las lineas. Por defecto, el logger de Nest. Los tests inyectan un
   * sumidero para recuperar el enlace sin tocar la consola.
   */
  write?: (line: string) => void;
  /**
   * Gancho previo al "envio", para simular fallos en tests: lanzar un
   * `MailDeliveryError` de cualquier `kind`, o demorar. No es una perilla de
   * produccion ni de entorno.
   */
  beforeSend?: (message: MailMessage) => void | Promise<void>;
}

/**
 * Transporte de DESARROLLO LOCAL. No envia nada: escribe el mensaje, ENLACE
 * INCLUIDO, en la consola, para poder recorrer el flujo de recuperacion sin un
 * proveedor.
 *
 * ES UNA EXCEPCION DELIBERADA a la regla de no escribir enlaces ni tokens en logs,
 * y por eso nunca puede correr en produccion: `mail.config.ts` lo rechaza cuando
 * `NODE_ENV=production`, y hay un test que lo congela. Si imprimiera el enlace en
 * un log de produccion, cualquiera con acceso a los logs podria tomar la cuenta.
 */
export class LogMailTransport implements MailTransport {
  readonly kind = 'log';
  readonly operational = true;

  /** Ultimos mensajes "enviados", mas reciente al final. Solo para desarrollo. */
  readonly outbox: MailMessage[] = [];

  private readonly logger = new Logger('MailTransport(log)');
  private readonly write: (line: string) => void;
  private readonly beforeSend?: (message: MailMessage) => void | Promise<void>;

  constructor(options: LogMailTransportOptions = {}) {
    this.write = options.write ?? ((line) => this.logger.warn(line));
    this.beforeSend = options.beforeSend;
  }

  async send(message: MailMessage): Promise<void> {
    await this.beforeSend?.(message);

    this.outbox.push(message);
    if (this.outbox.length > OUTBOX_LIMIT) {
      this.outbox.shift();
    }

    this.write(
      [
        '[DEV ONLY -- este mensaje NO se envio por correo]',
        `Para:    ${message.to}`,
        `Asunto:  ${message.subject}`,
        '',
        message.text
      ].join('\n')
    );
  }
}
