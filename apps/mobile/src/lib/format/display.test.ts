import {
  abbreviateTechnicalReference,
  formatBlockchainEvidenceStatus,
  formatBlockchainNetwork,
  formatBytes,
  formatConfidence,
  formatDate,
  formatNumber,
  formatQualityFlag,
  pluralCredential
} from '@/lib/format/display';
import { LONG_HASH } from '@/test/fixtures';

describe('formatDate', () => {
  it('formatea una marca temporal ISO completa', () => {
    expect(formatDate('2026-03-14T10:00:00.000Z')).toMatch(/2026/);
  });

  it('no corre el día hacia atrás en una fecha sin hora', () => {
    // El bug clásico: interpretar '2026-02-28' como UTC y mostrarlo en
    // horario de Argentina (UTC-3) daría el 27.
    expect(formatDate('2026-02-28')).toContain('28');
    expect(formatDate('2026-01-01')).toContain('1');
  });

  it('devuelve el valor original si no se puede interpretar', () => {
    expect(formatDate('no-es-una-fecha')).toBe('no-es-una-fecha');
  });
});

describe('formatNumber', () => {
  it('formatea enteros sin decimales artificiales', () => {
    expect(formatNumber(240)).toBe('240');
  });

  it('acota los decimales', () => {
    expect(formatNumber(12.3456)).toMatch(/12/);
  });
});

describe('formatBytes', () => {
  it('usa bytes por debajo de 1 KB', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('usa KB por encima', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
  });
});

describe('abbreviateTechnicalReference', () => {
  it('abrevia un hash largo conservando extremos reconocibles', () => {
    const short = abbreviateTechnicalReference(LONG_HASH);

    expect(short).toContain('...');
    expect(short.startsWith(LONG_HASH.slice(0, 10))).toBe(true);
    expect(short.endsWith(LONG_HASH.slice(-6))).toBe(true);
  });

  it('deja intactos los valores cortos', () => {
    expect(abbreviateTechnicalReference('canon_v1')).toBe('canon_v1');
  });
});

describe('etiquetas de dominio', () => {
  it('humaniza redes conocidas y deja el resto tal cual', () => {
    expect(formatBlockchainNetwork('sepolia')).toBe('Red de prueba Sepolia');
    expect(formatBlockchainNetwork('anvil')).toBe('Red de desarrollo');
    expect(formatBlockchainNetwork('red-nueva')).toBe('red-nueva');
  });

  it('humaniza el estado del registro y no inventa uno desconocido', () => {
    expect(formatBlockchainEvidenceStatus('confirmed')).toBe(
      'Registro confirmado'
    );
    expect(formatBlockchainEvidenceStatus('vaya_a_saber')).toBe(
      'Estado de registro no disponible'
    );
  });

  it('humaniza quality flags sin descartar los desconocidos', () => {
    expect(formatQualityFlag('low_evidence')).toBe('evidencia limitada');
    expect(formatQualityFlag('flag_nuevo_del_backend')).toBe(
      'flag nuevo del backend'
    );
  });

  it('expresa la confianza como porcentaje redondeado', () => {
    expect(formatConfidence(0.615)).toBe('62% de confianza');
    expect(formatConfidence(1)).toBe('100% de confianza');
  });

  it('pluraliza credencial correctamente', () => {
    expect(pluralCredential(1)).toBe('credencial');
    expect(pluralCredential(0)).toBe('credenciales');
    expect(pluralCredential(3)).toBe('credenciales');
  });
});
