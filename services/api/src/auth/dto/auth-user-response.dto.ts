import { UserStatus } from '@prisma/client';

export interface AuthUserResponseDto {
  id: string;
  email: string;
  did: string | null;
  status: UserStatus;
  // A1.1: proyeccion de presentacion segura (nunca firstName/lastName
  // crudos) -- reusa el mismo buildHolderDisplayLabel ya usado por
  // issuer-holder-resolution/issuer-credential-read/verification, nunca
  // una segunda implementacion de "nombre + apellido" con reglas propias.
  // Siempre no vacio: cae a email y luego a un fallback fijo si no hay
  // ningun dato de nombre.
  displayLabel: string;
}
