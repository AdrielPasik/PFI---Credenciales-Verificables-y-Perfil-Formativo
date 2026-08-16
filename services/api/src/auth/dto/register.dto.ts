// A1/A1.1: unicamente email/password/firstName/lastName. Nunca
// role/issuerId/did/status/displayName/etc -- el AuthService lee campo a
// campo (nunca hace spread del body), asi que cualquier campo extra que un
// cliente mande queda ignorado sin excepcion. displayName no se solicita
// aqui a proposito: sigue siendo un campo separado (hoy solo poblado por
// seeds/herramientas futuras), nunca escrito por el registro publico.
export class RegisterDto {
  email!: string;
  password!: string;
  firstName!: string;
  lastName!: string;
}
