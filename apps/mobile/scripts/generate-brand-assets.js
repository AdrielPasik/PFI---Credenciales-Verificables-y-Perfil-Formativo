#!/usr/bin/env node
/**
 * Deriva los assets de marca de la app móvil a partir de los logos APROBADOS
 * de Scope, de forma determinística y reproducible.
 *
 * Fuentes (única fuente de verdad de la marca, no se modifican):
 *
 *   apps/web/public/brand/Logo Scope 2.png          (logo principal)
 *   apps/web/public/brand/Logo Scope Invertido.png  (logo invertido)
 *
 * Ambas son 1254x1254 con canal alfa. El lockup aprobado tiene el símbolo en
 * las filas 66-898 y el wordmark "Scope" en las filas 911-1176, separados por
 * una banda transparente (899-910) que este script detecta en vez de asumir.
 *
 * Qué se genera y por qué:
 *
 *   icon.png           1024x1024  símbolo invertido sobre navy. Sólo el
 *                                 símbolo: el wordmark completo resulta
 *                                 ilegible a 48 px (sección 44 del encargo).
 *   adaptive-icon.png  1024x1024  símbolo invertido sobre transparente, al
 *                                 58% del lienzo para caer dentro de la zona
 *                                 segura circular de Android (66%).
 *   splash-icon.png     512x512   símbolo invertido sobre transparente.
 *   brand-lockup.png    padded    lockup completo (símbolo + wordmark) del
 *                                 logo principal, recortado a su bounding box
 *                                 real, para la pantalla de acceso.
 *
 * NUNCA se altera la proporción del logo: sólo se recorta a su bounding box
 * real y se escala uniformemente. No se redibuja ni se rediseña nada.
 *
 * Uso:  node scripts/generate-brand-assets.js
 */

const fs = require('fs');
const path = require('path');

const sharp = require('sharp');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const BRAND_DIR = path.join(REPO_ROOT, 'apps', 'web', 'public', 'brand');
const OUTPUT_DIR = path.resolve(__dirname, '..', 'assets');

const PRIMARY_LOGO = path.join(BRAND_DIR, 'Logo Scope 2.png');
const INVERTED_LOGO = path.join(BRAND_DIR, 'Logo Scope Invertido.png');

const SCOPE_NAVY = { r: 11, g: 29, b: 58, alpha: 1 };
const ALPHA_THRESHOLD = 24;

async function readAlphaMap(file) {
  const image = sharp(file).ensureAlpha();
  const { width, height } = await image.metadata();
  const { data } = await image.raw().toBuffer({ resolveWithObject: true });
  return { width, height, data };
}

/** Bounding box de los píxeles visibles dentro de un rango de filas. */
function boundingBox({ width, height, data }, fromRow = 0, toRow = height - 1) {
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;

  for (let y = fromRow; y <= toRow; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) throw new Error('No se encontró contenido visible.');

  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

/** Bandas contiguas de filas totalmente transparentes. */
function emptyRowBands({ width, height, data }) {
  const bands = [];
  let start = null;

  for (let y = 0; y < height; y += 1) {
    let filled = false;

    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > ALPHA_THRESHOLD) {
        filled = true;
        break;
      }
    }

    if (!filled && start === null) start = y;
    if (filled && start !== null) {
      bands.push([start, y - 1]);
      start = null;
    }
  }

  if (start !== null) bands.push([start, height - 1]);
  return bands;
}

/**
 * Separa el símbolo del wordmark usando la banda transparente interior del
 * lockup. Si el asset cambiara y esa banda desapareciera, el script falla en
 * vez de recortar a ciegas.
 */
function symbolRowRange(map) {
  const interiorBands = emptyRowBands(map).filter(
    ([from, to]) => from > 0 && to < map.height - 1
  );

  if (interiorBands.length === 0) {
    throw new Error(
      'No se detectó la separación entre símbolo y wordmark en el logo.'
    );
  }

  const [gapStart] = interiorBands[0];
  return { from: 0, to: gapStart - 1 };
}

async function writeSymbolAsset({
  source,
  crop,
  outputFile,
  canvasSize,
  symbolRatio,
  background
}) {
  const symbolSize = Math.round(canvasSize * symbolRatio);
  const scaled = await sharp(source)
    .extract(crop)
    .resize(symbolSize, symbolSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: background ?? { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: scaled, gravity: 'centre' }])
    .png()
    .toFile(outputFile);

  return outputFile;
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const invertedMap = await readAlphaMap(INVERTED_LOGO);
  const primaryMap = await readAlphaMap(PRIMARY_LOGO);

  const invertedSymbolRows = symbolRowRange(invertedMap);
  const invertedSymbolBox = boundingBox(
    invertedMap,
    invertedSymbolRows.from,
    invertedSymbolRows.to
  );

  // Lienzo cuadrado alrededor del símbolo, para que al escalarlo no se
  // deforme y quede ópticamente centrado.
  const squareSide = Math.max(invertedSymbolBox.width, invertedSymbolBox.height);
  const squareCrop = {
    left: Math.max(
      0,
      Math.round(
        invertedSymbolBox.left + invertedSymbolBox.width / 2 - squareSide / 2
      )
    ),
    top: Math.max(
      0,
      Math.round(
        invertedSymbolBox.top + invertedSymbolBox.height / 2 - squareSide / 2
      )
    ),
    width: squareSide,
    height: squareSide
  };

  const written = [];

  written.push(
    await writeSymbolAsset({
      source: INVERTED_LOGO,
      crop: squareCrop,
      outputFile: path.join(OUTPUT_DIR, 'icon.png'),
      canvasSize: 1024,
      symbolRatio: 0.68,
      background: SCOPE_NAVY
    })
  );

  written.push(
    await writeSymbolAsset({
      source: INVERTED_LOGO,
      crop: squareCrop,
      outputFile: path.join(OUTPUT_DIR, 'adaptive-icon.png'),
      canvasSize: 1024,
      // 58% queda holgadamente dentro de la zona segura del 66% que recorta
      // Android con máscaras circulares o de "squircle".
      symbolRatio: 0.58
    })
  );

  written.push(
    await writeSymbolAsset({
      source: INVERTED_LOGO,
      crop: squareCrop,
      outputFile: path.join(OUTPUT_DIR, 'splash-icon.png'),
      canvasSize: 512,
      symbolRatio: 0.82
    })
  );

  // Lockup completo (símbolo + wordmark) recortado a su bounding box real.
  const primaryBox = boundingBox(primaryMap);
  const lockupFile = path.join(OUTPUT_DIR, 'brand-lockup.png');
  await sharp(PRIMARY_LOGO)
    .extract(primaryBox)
    .resize({ width: 640, withoutEnlargement: true })
    .png()
    .toFile(lockupFile);
  written.push(lockupFile);

  const invertedLockupFile = path.join(OUTPUT_DIR, 'brand-lockup-inverse.png');
  await sharp(INVERTED_LOGO)
    .extract(boundingBox(invertedMap))
    .resize({ width: 640, withoutEnlargement: true })
    .png()
    .toFile(invertedLockupFile);
  written.push(invertedLockupFile);

  const manifest = {
    generatedBy: 'apps/mobile/scripts/generate-brand-assets.js',
    sources: {
      primary: 'apps/web/public/brand/Logo Scope 2.png',
      inverted: 'apps/web/public/brand/Logo Scope Invertido.png'
    },
    detected: {
      invertedSymbolRows,
      invertedSymbolBox,
      squareCrop,
      primaryLockupBox: primaryBox
    },
    outputs: written.map((file) => path.basename(file))
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'brand-assets.manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );

  for (const file of written) {
    const { width, height } = await sharp(file).metadata();
    process.stdout.write(
      `${path.basename(file)} ${width}x${height} ${fs.statSync(file).size} bytes\n`
    );
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
