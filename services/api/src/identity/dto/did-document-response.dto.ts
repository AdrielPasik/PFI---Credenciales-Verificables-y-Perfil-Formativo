// A2.1: DID Document minimo -- id-only, sin verificationMethod. El
// chequeo normativo (W3C DID Core sec. 4, did:web Method Specification)
// confirma que verificationMethod es OPTIONAL: la unica propiedad
// requerida por el modelo de datos normativo es `id`. No se agregan
// nombre/email/perfil/lista de Credentials ni ningun otro dato --
// unicamente lo que un resolver did:web necesita para confirmar que el
// documento corresponde al DID solicitado.
export interface DidDocumentResponseDto {
  '@context': 'https://www.w3.org/ns/did/v1';
  id: string;
}
