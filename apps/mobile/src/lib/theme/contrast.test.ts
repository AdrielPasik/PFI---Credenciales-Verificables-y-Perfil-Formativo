import { darkColors, lightColors, type ScopeColors } from '@/lib/theme/tokens';

/**
 * Contraste WCAG 2.1 de los pares que la app realmente pinta.
 *
 * Texto normal: 4.5:1. Componentes no textuales (bordes de foco, íconos de
 * apoyo, el subtítulo `subtle` en tamaños de leyenda): 3:1.
 */

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channel = (i: number) => {
    const c = parseInt(value.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function textPairs(c: ScopeColors): [string, string, string][] {
  const s = c.status;
  return [
    ['text.strong / fondo', c.text.strong, c.surface.background],
    ['text.strong / tarjeta', c.text.strong, c.surface.card],
    ['text.default / tarjeta', c.text.default, c.surface.card],
    ['text.default / fondo', c.text.default, c.surface.background],
    ['text.muted / tarjeta', c.text.muted, c.surface.card],
    ['text.muted / superficie suave', c.text.muted, c.surface.muted],
    ['acento / tarjeta', c.brand.teal, c.surface.card],
    ['aviso informativo', c.brand.navyStrong, c.brand.tint],
    ['encabezado / tarjeta', c.brand.navy, c.surface.card],
    ['botón primario', c.action.onPrimary, c.action.primary],
    ['banda inversa', c.text.onInverse, c.surface.inverse],
    ['banda inversa atenuada', c.text.onInverseMuted, c.surface.inverse],
    ['cita resaltada', c.text.onHighlight, c.surface.highlight],
    ['estado emitida', s.issued, s.issuedSoft],
    ['estado análisis', s.analysis, s.analysisSoft],
    ['estado éxito', s.success, s.successSoft],
    ['estado advertencia', s.warning, s.warningSoft],
    ['estado error', s.error, s.errorSoft],
    ['estado revocada', s.revoked, s.revokedSoft],
    ['estado neutral', s.neutral, s.neutralSoft],
    ['error / tarjeta', s.error, c.surface.card],
    ['advertencia / tarjeta', s.warning, c.surface.card]
  ];
}

describe('contraste del tema oscuro', () => {
  it.each(textPairs(darkColors))('%s alcanza 4.5:1', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('el texto sutil y el acento sobre el fondo alcanzan 4.5:1', () => {
    expect(contrastRatio(darkColors.text.subtle, darkColors.surface.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(darkColors.text.subtle, darkColors.surface.card)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(darkColors.brand.teal, darkColors.surface.background)).toBeGreaterThanOrEqual(4.5);
  });

  it('el foco y el borde del botón primario se distinguen (3:1)', () => {
    expect(contrastRatio(darkColors.focusRing, darkColors.surface.background)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(darkColors.action.primaryBorder, darkColors.surface.card)).toBeGreaterThanOrEqual(3);
  });
});

/**
 * Banda de bienvenida: el texto se lee sobre los dos extremos del degradado.
 * Los halos sólo suman luz petróleo translúcida y no se cuentan acá.
 */
function bandPairs(c: ScopeColors): [string, string, string][] {
  const b = c.band;
  return [
    ['saludo / inicio de la banda', b.text, b.start],
    ['saludo / final de la banda', b.text, b.end],
    ['frase y métricas / inicio de la banda', b.muted, b.start],
    ['frase y métricas / final de la banda', b.muted, b.end],
    ['etiqueta / inicio de la banda', b.eyebrow, b.start],
    ['etiqueta / final de la banda', b.eyebrow, b.end],
    ['acción principal de la banda', b.onAction, b.action]
  ];
}

describe.each([
  ['claro', lightColors],
  ['oscuro', darkColors]
] as const)('contraste de la banda de bienvenida (%s)', (_theme, palette) => {
  it.each(bandPairs(palette))('%s alcanza 4.5:1', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('el borde de la acción principal se distingue de la banda (3:1)', () => {
    expect(contrastRatio(palette.band.actionBorder, palette.band.end)).toBeGreaterThanOrEqual(3);
  });
});

describe('contraste del tema claro', () => {
  it.each(textPairs(lightColors))('%s alcanza 4.5:1', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  // Valores heredados de la versión original, que esta PR no rediseña: el
  // texto sutil (leyendas) y el acento sobre el fondo gris quedan en 3:1.
  it('el texto sutil y el acento sobre el fondo mantienen al menos 3:1', () => {
    expect(contrastRatio(lightColors.text.subtle, lightColors.surface.background)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(lightColors.brand.teal, lightColors.surface.background)).toBeGreaterThanOrEqual(3);
  });
});

describe('paletas', () => {
  it('las dos paletas tienen exactamente los mismos roles', () => {
    const keys = (c: ScopeColors) =>
      Object.entries(c).flatMap(([group, value]) =>
        typeof value === 'string' ? [group] : Object.keys(value).map((k) => `${group}.${k}`)
      );
    expect(keys(darkColors).sort()).toEqual(keys(lightColors).sort());
  });

  it('el tema claro conserva la apariencia original', () => {
    expect(lightColors.surface).toMatchObject({
      background: '#EEF2F5',
      card: '#FFFFFF',
      muted: '#F7FAFB',
      inverse: '#0B1D3A'
    });
    expect(lightColors.action.primary).toBe('#0B1D3A');
    expect(lightColors.brand.teal).toBe('#167F89');
    expect(lightColors.text.strong).toBe('#0B1D3A');
  });

  it('el tema oscuro usa el azul tinta y el petróleo aprobados en Web', () => {
    expect(darkColors.surface.background).toBe('#0A1424');
    expect(darkColors.surface.card).toBe('#101D33');
    expect(darkColors.action.primary).toBe('#24727E');
  });
});
