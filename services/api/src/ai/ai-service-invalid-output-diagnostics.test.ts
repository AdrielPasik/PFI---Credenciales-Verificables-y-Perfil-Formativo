/**
 * Recuperacion allowlisted del subcodigo de salida invalida — P2.4 OBS.
 *
 * El riesgo real de este modulo no es equivocarse de subcodigo: es convertirse
 * en un canal por el que texto del otro lado —prompt, respuesta del proveedor,
 * contenido del holder— termine en un log. Por eso la mitad de los tests son
 * intentos de meter basura por `message`.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  F3_DIAGNOSTIC_STAGES,
  INVALID_OUTPUT_SUBCODES,
  UNKNOWN_INVALID_OUTPUT_SUBCODE,
  readInvalidOutputSubcode,
  type F3DiagnosticStage
} from './ai-service-invalid-output-diagnostics';

const envelope = (message: unknown) => ({
  schemaVersion: 'ai_service_error_v1',
  code: 'PROVIDER_INVALID_OUTPUT',
  ...(message === undefined ? {} : { message })
});

// ---------------------------------------------------------------------------
// Camino feliz
// ---------------------------------------------------------------------------

test('recupera el subcodigo exacto de cada etapa', () => {
  for (const stage of F3_DIAGNOSTIC_STAGES) {
    for (const subcode of INVALID_OUTPUT_SUBCODES[stage]) {
      const body = envelope(`${stage}_invalid_provider_output:${subcode}`);
      assert.equal(readInvalidOutputSubcode(stage, body), subcode, `${stage}/${subcode}`);
    }
  }
});

test('el subcodigo del smoke fallido es recuperable', () => {
  // El caso que motivo la slice: una salida no conforme de razonamiento
  // contextual. Antes de esto, este dato se perdia.
  const body = envelope(
    'contextual_reasoning_invalid_provider_output:provider_output_unexpected_keys'
  );
  assert.equal(
    readInvalidOutputSubcode('contextual_reasoning', body),
    'provider_output_unexpected_keys'
  );
});

// ---------------------------------------------------------------------------
// Todo lo demas es centinela
// ---------------------------------------------------------------------------

test('un subcodigo desconocido NO se registra crudo', () => {
  const body = envelope('contextual_reasoning_invalid_provider_output:subcodigo_nuevo');
  assert.equal(
    readInvalidOutputSubcode('contextual_reasoning', body),
    UNKNOWN_INVALID_OUTPUT_SUBCODE
  );
});

test('el prefijo de OTRA etapa no se acepta', () => {
  // Un envelope de otra etapa en esta respuesta es incoherencia, no informacion.
  const body = envelope(
    'objective_analysis_invalid_provider_output:provider_body_not_json'
  );
  assert.equal(
    readInvalidOutputSubcode('contextual_reasoning', body),
    UNKNOWN_INVALID_OUTPUT_SUBCODE
  );
});

test('un subcodigo valido de OTRA etapa tampoco pasa', () => {
  // `contextual_requirement_id_mismatch` no pertenece a evidence_units.
  const body = envelope(
    'evidence_units_invalid_provider_output:contextual_requirement_id_mismatch'
  );
  assert.equal(
    readInvalidOutputSubcode('evidence_units', body),
    UNKNOWN_INVALID_OUTPUT_SUBCODE
  );
});

test('no alcanza con CONTENER un subcodigo valido', () => {
  // Un `includes` dejaria pasar cualquier cosa concatenada alrededor del token.
  for (const message of [
    'contextual_reasoning_invalid_provider_output:provider_output_unexpected_keys y ademas SECRETO',
    'contextual_reasoning_invalid_provider_output: provider_output_unexpected_keys',
    'contextual_reasoning_invalid_provider_output:provider_output_unexpected_keys\nSECRETO'
  ]) {
    assert.equal(
      readInvalidOutputSubcode('contextual_reasoning', envelope(message)),
      UNKNOWN_INVALID_OUTPUT_SUBCODE,
      message
    );
  }
});

test('cuerpos malformados no rompen nada y dan centinela', () => {
  const stage: F3DiagnosticStage = 'contextual_reasoning';
  for (const body of [
    null,
    undefined,
    'texto plano',
    42,
    [],
    ['contextual_reasoning_invalid_provider_output:provider_body_not_json'],
    {},
    envelope(undefined),
    envelope(123),
    envelope(null),
    envelope({ nested: 'x' }),
    { schemaVersion: 'otra_cosa', message: 'x' }
  ]) {
    assert.equal(
      readInvalidOutputSubcode(stage, body),
      UNKNOWN_INVALID_OUTPUT_SUBCODE,
      JSON.stringify(body)
    );
  }
});

test('NUNCA devuelve contenido libre, por muy sugerente que venga', () => {
  const sentinels = [
    'SECRET_API_KEY_SENTINEL',
    'REQUIREMENT_TEXT_SENTINEL',
    'EVIDENCE_TEXT_SENTINEL',
    'RAW_PROVIDER_OUTPUT_SENTINEL'
  ];
  for (const sentinel of sentinels) {
    for (const message of [
      sentinel,
      `contextual_reasoning_invalid_provider_output:${sentinel}`,
      `contextual_reasoning_invalid_provider_output:provider_output_not_json ${sentinel}`
    ]) {
      const value = readInvalidOutputSubcode('contextual_reasoning', envelope(message));
      assert.ok(!value.includes(sentinel), `filtro ${sentinel}`);
      assert.equal(value, UNKNOWN_INVALID_OUTPUT_SUBCODE);
    }
  }
});

// ---------------------------------------------------------------------------
// Guard de deriva contra el ai-service
// ---------------------------------------------------------------------------

/**
 * La allowlist se copio del codigo Python. Si el ai-service agrega un subcodigo
 * y esta lista no se actualiza, ese subcodigo se degrada EN SILENCIO a
 * `UNKNOWN_OR_UNPARSEABLE` — justo el agujero que la slice cierra. El guard
 * vuelve a derivarla del fuente y falla si divergen.
 */
test('la allowlist coincide con el vocabulario del ai-service', () => {
  const aiSrc = join(
    __dirname,
    '..',
    '..',
    '..',
    'ai-service',
    'src',
    'api'
  );

  for (const stage of F3_DIAGNOSTIC_STAGES) {
    const sources = [
      'provider.py',
      'service.py',
      'validation.py',
      // P2.4: el anclaje determinista tambien levanta subcodigos de salida
      // invalida, asi que forma parte del vocabulario de la etapa.
      'requirement_anchoring.py'
    ]
      .map((file) => {
        try {
          return readFileSync(join(aiSrc, stage, file), 'utf8');
        } catch {
          return '';
        }
      })
      .join('\n');

    assert.ok(sources.length > 0, `no se pudo leer el fuente de ${stage}`);

    const derived = new Set<string>();
    for (const pattern of [
      /ProviderInvalidOutputError\("([a-z0-9_]+)"\)/g,
      /_fail\("([a-z0-9_]+)"\)/g
    ]) {
      for (const match of sources.matchAll(pattern)) derived.add(match[1]);
    }

    const declared = new Set(INVALID_OUTPUT_SUBCODES[stage]);
    const missing = [...derived].filter((code) => !declared.has(code)).sort();
    const extra = [...declared].filter((code) => !derived.has(code)).sort();

    assert.deepEqual(missing, [], `${stage}: faltan en la allowlist`);
    assert.deepEqual(extra, [], `${stage}: sobran en la allowlist`);
  }
});
