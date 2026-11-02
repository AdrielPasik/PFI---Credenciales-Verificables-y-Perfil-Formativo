import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Guarda del sistema de temas: los componentes usan tokens semanticos
 * (`text-text-muted`, `bg-surface`, `text-accent`, `bg-primary`...), que el
 * tema oscuro redefine. Una clase de la paleta de Tailwind o de un tono fijo
 * de marca no cambia con el tema y queda ilegible en uno de los dos.
 *
 * Excepciones: la paleta de marca como TEXTO sobre superficies invertidas
 * (oscuras en ambos temas) y la franja decorativa ambar.
 */

const SRC = resolve(__dirname, '..', '..');

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|brand';
const RAW_COLOR = new RegExp(
  `(?<![\\w-])(?:[a-z-]+:)*(?:bg|text|border(?:-[lrtbxy])?|ring(?:-offset)?|outline|from|via|to|fill|stroke|divide|decoration|placeholder|accent|caret)-(?:${PALETTE})-\\d{2,3}(?:/\\d+)?(?![\\w-])`,
  'g'
);
const FIXED_LIGHT = /(?<![\w-])(?:[a-z-]+:)*(?:bg-white|bg-black|text-black)(?![\w/-])/g;
const ALLOWED = new Set(['text-brand-100', 'text-teal-100', 'bg-amber-600']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

describe('semantic color tokens', () => {
  it('no component uses a palette color that ignores the theme', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const match of [...source.matchAll(RAW_COLOR), ...source.matchAll(FIXED_LIGHT)]) {
        const utility = match[0].split(':').pop()!.replace(/\/\d+$/, '');
        if (!ALLOWED.has(utility)) offenders.push(`${relative(SRC, file)}: ${match[0]}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
