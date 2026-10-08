import { Controller, Get, Header, Param } from '@nestjs/common';

import { VerifyCredentialResponseDto } from './dto/verify-credential-response.dto';
import { VerificationService } from './verification.service';

@Controller('verify/credentials')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @Get(':credentialId')
  // `no-store` -- S8c7.
  //
  // La respuesta contiene estado de seguridad SENSIBLE AL TIEMPO: que claves
  // autoriza el DID del emisor, si la credencial fue revocada y que evidencia
  // se observa en la cadena. Cualquiera de los tres puede cambiar de un minuto
  // al siguiente: una clave puede marcarse comprometida, un emisor puede
  // revocar, un intent `pending` puede pasar a registrado, y la conectividad
  // con el RPC puede recuperarse o caerse.
  //
  // Una cache HTTP o un CDN intermedio podria servir una verificacion favorable
  // despues de que la clave dejo de estar autorizada. Es el mismo criterio -- y
  // por la misma razon -- que `GET /did/issuers/:issuerId/did.json` de S8c3.
  //
  // Se aplica al 200 y tambien al 404, para que una respuesta negativa no
  // quede cacheada tapando una credencial que despues si exista.
  @Header('Cache-Control', 'no-store')
  getCredentialVerification(
    @Param('credentialId') credentialId: string
  ): Promise<VerifyCredentialResponseDto> {
    return this.verificationService.getCredentialVerification(credentialId);
  }
}
