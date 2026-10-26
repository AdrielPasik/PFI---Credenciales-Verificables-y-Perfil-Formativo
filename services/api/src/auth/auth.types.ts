import { UserStatus } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  // Generacion de sesion con la que se emitio el token (`AuthCredential.
  // sessionVersion`). Es un claim INTERNO de autenticacion: viaja unicamente
  // dentro del JWT y nunca en un DTO publico.
  //
  // Opcional en el TIPO porque los tokens emitidos antes de que existiera el
  // claim no lo traen. Ausente significa version 0 -- y SOLO ausente: un `sv`
  // presente pero mal formado se rechaza, nunca se interpreta como 0. Todo token
  // NUEVO lo lleva siempre (ver `AuthService.signAccessToken`).
  sv?: number;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  did: string | null;
  status: UserStatus;
}

export interface AuthenticatedRequest {
  headers: {
    authorization?: string;
  };
  user?: AuthenticatedUser;
}
