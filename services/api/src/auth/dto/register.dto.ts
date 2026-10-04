import { UserOnboardingIntent } from '@prisma/client';

// A1/A1.1: unicamente email/password/firstName/lastName. Nunca
// role/issuerId/did/status/displayName/etc -- el AuthService lee campo a
// campo (nunca hace spread del body), asi que cualquier campo extra que un
// cliente mande queda ignorado sin excepcion. displayName no se solicita
// aqui a proposito: sigue siendo un campo separado (hoy solo poblado por
// seeds/herramientas futuras), nunca escrito por el registro publico.
//
// O1: mas `onboardingIntent`, OPCIONAL a nivel API. Es intencion de uso, no
// autorizacion: no habilita /admin, ni /issuer, ni una IssuerMembership, ni
// PlatformAdmin. Lo unico que decide es a donde aterriza la persona cuando no
// tiene ningun contexto institucional operativo.
//
// POR QUE OPCIONAL Y NO REQUERIDO. El frontend nuevo siempre lo manda, pero
// web (Vercel) y API (ECS) se despliegan por separado: si fuera requerido, la
// ventana en la que el frontend anterior apunta a la API nueva romperia el
// signup entero. Ausente se persiste como `null`, que significa exactamente
// "esta cuenta se creo antes de que Scope preguntara esto" y conserva el
// comportamiento actual. El servidor NUNCA asume `personal` por defecto: eso
// afirmaria una eleccion que nadie hizo.
export class RegisterDto {
  email!: string;
  password!: string;
  firstName!: string;
  lastName!: string;
  onboardingIntent?: UserOnboardingIntent;
}
