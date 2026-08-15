// A1: unicamente email/password. Nunca role/issuerId/did/status/etc -- el
// AuthService lee campo a campo (nunca hace spread del body), asi que
// cualquier campo extra que un cliente mande queda ignorado sin excepcion.
export class RegisterDto {
  email!: string;
  password!: string;
}
