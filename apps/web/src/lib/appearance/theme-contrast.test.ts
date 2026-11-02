import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Contraste WCAG 2.x de los pares de tokens que la interfaz combina, en ambos
 * temas, leidos de `globals.css` (la unica fuente de los valores).
 * Texto: 4.5:1 (AA). Componentes y foco: 3:1 (1.4.11).
 */

const css = readFileSync(path.resolve(__dirname, '..', '..', 'app', 'globals.css'), 'utf8');

function tokensIn(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No se encontro ${selector} en globals.css`);
  const body = css.slice(start, css.indexOf('}', start));
  const tokens: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/--traza-([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    tokens[name] = value.toLowerCase();
  }
  return tokens;
}

const light = tokensIn(':root');
const themes = {
  light,
  dark: { ...light, ...tokensIn(':root[data-theme="dark"]') }
};

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

const STATUSES = [
  'issued',
  'analysis',
  'valid',
  'evidence',
  'warning',
  'error',
  'revoked',
  'draft',
  'analysis-partial',
  'unknown'
];
const SURFACES = ['canvas', 'surface', 'surface-muted'];

type Pair = [foreground: string, background: string, minimum: number];

const PAIRS: Pair[] = [
  ...['text-strong', 'text-default', 'text-muted', 'link', 'accent'].flatMap((text) =>
    SURFACES.map((surface): Pair => [text, surface, 4.5])
  ),
  ['text-subtle', 'surface', 4.5],
  ...STATUSES.flatMap((status): Pair[] => [
    [`status-${status}`, 'surface', 4.5],
    [`status-${status}`, `status-${status}-soft`, 4.5]
  ]),
  ['feedback-information', 'feedback-information-soft', 4.5],
  ['on-primary', 'primary', 4.5],
  ['on-primary', 'primary-hover', 4.5],
  ['on-primary', 'primary-active', 4.5],
  ['on-destructive', 'status-error', 4.5],
  ['accent', 'accent-tint', 4.5],
  ['accent', 'accent-soft', 4.5],
  ['link', 'highlight', 4.5],
  ['text-strong', 'highlight', 4.5],
  ['selection-text', 'selection', 4.5],
  // Superficies invertidas (header, paneles destacados): texto de marca fijo.
  ['brand-100', 'inverse', 4.5],
  ['teal-100', 'inverse', 4.5],
  // No texto: bordes de campos, anillo de foco y relleno del boton principal.
  ['border-control', 'surface', 3],
  ['focus-ring', 'canvas', 3],
  ['focus-ring', 'surface', 3],
  ['primary', 'surface', 3]
];

describe.each(Object.entries(themes))('tema %s', (_name, tokens) => {
  it.each(PAIRS)('%s sobre %s >= %s:1', (foreground, background, minimum) => {
    const fg = tokens[foreground];
    const bg = tokens[background];
    expect(fg, `--traza-${foreground}`).toMatch(/^#/);
    expect(bg, `--traza-${background}`).toMatch(/^#/);
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(minimum);
  });

  it('white text on the inverse surface', () => {
    expect(contrast('#ffffff', tokens.inverse)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('dark theme identity', () => {
  it('uses the approved petrol accent, not the bright turquoise', () => {
    expect(themes.dark.primary).toBe('#24727e');
    expect(themes.dark['primary-hover']).toBe('#2a7884');
    expect(themes.dark['primary-active']).toBe('#1f6b77');
    expect(themes.dark.link).toBe('#82bcc4');
    expect(themes.dark['focus-ring']).toBe('#8fb8d8');
  });

  it('keeps the light palette for print (dark tokens only on screen)', () => {
    const darkBlock = css.indexOf(':root[data-theme="dark"]');
    expect(css.lastIndexOf('@media screen', darkBlock)).toBeGreaterThan(-1);
    expect(css.slice(css.lastIndexOf('@media', darkBlock), darkBlock)).toContain('@media screen');
  });
});
