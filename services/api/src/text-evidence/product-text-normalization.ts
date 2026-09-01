/**
 * Normalización productiva de `TextEvidence.content` — implementación única.
 *
 * Extraída de `text-evidence.validator.ts::normalizeContent` sin cambiar una
 * sola regla, para que el trust gate de F0.5 pueda validar contenido histórico
 * sin duplicar el conjunto de whitespace. Duplicarlo habría creado dos reglas
 * que pueden desincronizarse; ésta es la misma función que corre en la creación.
 *
 * SEMÁNTICA CONGELADA DEL TOKEN `PRODUCT_NFC_LINEENDINGS_TRIM`, en este orden::
 *
 *     1. Unicode NFC
 *     2. CRLF / CR  ->  LF
 *     3. ECMAScript String.prototype.trim
 *
 * La autoridad contractual es esa lista, NO "lo que esta función haga en el
 * futuro". Si la creación productiva alguna vez necesita otra regla — NFKC, por
 * ejemplo — lo correcto es un token de normalización NUEVO con su propia
 * versión, y NO reinterpretar `PRODUCT_NFC_LINEENDINGS_TRIM` con la regla nueva:
 * los artifacts históricos declaran el token viejo y su significado no puede
 * cambiar retroactivamente.
 *
 * El parity vector de F0.3 —32 casos generados ejecutando esta misma expresión y
 * contrastados contra `validateTextEvidenceBody`— está congelado en
 * `services/ai-service/tests/contracts/fixtures/source_extraction_v1/
 * text-evidence-normalization-parity-vector.json`, y un test de F0.5 lo usa para
 * fijar esta función. Si alguien la cambiara, ese test falla: es exactamente la
 * señal de "hace falta un token nuevo" que se quiere.
 */

export const PRODUCT_NORMALIZATION_TOKEN = 'PRODUCT_NFC_LINEENDINGS_TRIM';

/** NFC -> fines de línea -> trim de ECMAScript. En ese orden. */
export function productNormalizeText(value: string): string {
  return value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
}

/**
 * Si `value` ya es punto fijo de la normalización productiva.
 *
 * Es lo que debe cumplir todo `TextEvidence.content` persistido. Un contenido
 * histórico que dejara de cumplirlo indica drift entre la regla de creación y la
 * declarada por el artifact, y el trust gate lo rechaza en vez de normalizarlo:
 * normalizar acá desalinearía el `sha256` almacenado.
 */
export function isProductNormalizedText(value: string): boolean {
  return value === productNormalizeText(value);
}
