import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Movimiento ambiental: solo capas decorativas, solo `transform`/`opacity`, y
 * quieto con `prefers-reduced-motion`. La interfaz no se desplaza al hover.
 */

const SRC = resolve(__dirname, '..', '..');
const css = readFileSync(resolve(SRC, 'app', 'globals.css'), 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

function keyframes(name: string) {
  const start = css.indexOf(`@keyframes ${name}`);
  expect(start, name).toBeGreaterThan(-1);
  let depth = 0;
  for (let index = css.indexOf('{', start); index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') depth -= 1;
    if (depth === 0) return css.slice(start, index + 1);
  }
  throw new Error(`keyframes ${name} sin cerrar`);
}

describe('ambient motion', () => {
  it('only animates transform and opacity', () => {
    for (const name of ['ambient-drift', 'ambient-drift-reverse']) {
      const properties = [...keyframes(name).matchAll(/([a-z-]+)\s*:/g)].map(([, property]) => property);
      expect(properties.length).toBeGreaterThan(0);
      expect(properties.every((property) => property === 'transform' || property === 'opacity')).toBe(true);
    }
  });

  it('uses the approved slow durations', () => {
    expect(css).toMatch(/animation: ambient-drift 44s ease-in-out infinite alternate/);
    expect(css).toMatch(/animation: ambient-drift-reverse 61s ease-in-out infinite alternate/);
  });

  it('stops the ambient light when the user prefers reduced motion', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.ambient-light::before,\s*\.ambient-light::after \{\s*animation: none;/
    );
  });

  it('no component moves or scales on hover', () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/hover:-?(?:translate|scale|rotate)[\w-[\]./]*/g)].map(
        ([match]) => `${relative(SRC, file)}: ${match}`
      )
    );
    expect(offenders).toEqual([]);
  });
});
