import { Logger, Module } from '@nestjs/common';

import { createMailTransport, type MailDowngradeReason } from './mail.config';
import { MAIL_TRANSPORT } from './mail-transport';

/**
 * Textos FIJOS: nombran la variable que hay que revisar y jamas su valor (una key
 * pegada en el campo equivocado terminaria en el log).
 */
const DOWNGRADE_MESSAGES: Record<MailDowngradeReason, string> = {
  production_forbids_log:
    'MAIL_TRANSPORT=log esta prohibido con NODE_ENV=production: el transporte de desarrollo imprimiria enlaces de recuperacion en los logs. Se usa "disabled" y la recuperacion de contrasena queda deshabilitada.',
  unsupported_value:
    'MAIL_TRANSPORT tiene un valor no soportado (validos: disabled, log, resend). Se usa "disabled" y la recuperacion de contrasena queda deshabilitada.',
  resend_missing_api_key:
    'MAIL_TRANSPORT=resend pero RESEND_API_KEY no esta definida. Se usa "disabled" y la recuperacion de contrasena queda deshabilitada.',
  resend_invalid_api_key:
    'MAIL_TRANSPORT=resend pero RESEND_API_KEY tiene un formato invalido. Se usa "disabled" y la recuperacion de contrasena queda deshabilitada.',
  resend_missing_from:
    'MAIL_TRANSPORT=resend pero MAIL_FROM no esta definida. Se usa "disabled" y la recuperacion de contrasena queda deshabilitada.',
  resend_invalid_from:
    'MAIL_TRANSPORT=resend pero MAIL_FROM no es un remitente valido ("Nombre <usuario@dominio>"). Se usa "disabled" y la recuperacion de contrasena queda deshabilitada.'
};

@Module({
  providers: [
    {
      provide: MAIL_TRANSPORT,
      useFactory: () => {
        const logger = new Logger('MailModule');

        return createMailTransport(process.env, (reason) =>
          // Texto fijo: jamas el valor recibido de la variable.
          logger.error(`mail.config_invalid (${reason}): ${DOWNGRADE_MESSAGES[reason]}`)
        );
      }
    }
  ],
  exports: [MAIL_TRANSPORT]
})
export class MailModule {}
