#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const projectDir = path.resolve(import.meta.dirname, '..');
const inDir = path.resolve(projectDir, 'output', 'transparent');
const outDir = path.resolve(projectDir, 'output', 'postprocess');

const AVIF_QUALITY = clampInt(process.env.AVIF_QUALITY, 50, 0, 100);
const WEBP_QUALITY = clampInt(process.env.WEBP_QUALITY, 82, 0, 100);
const AVIF_EFFORT = clampInt(process.env.AVIF_EFFORT, 4, 0, 9);

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

const VARIANTS = [
  { suffix: 'icon-64x36', width: 64, height: 36 },
  { suffix: 'icon-128x72', width: 128, height: 72 },
  { suffix: '600x338', width: 600, height: 338 },
  { suffix: '1200x675', width: 1200, height: 675 },
  { suffix: '1800x1013', width: 1800, height: 1013 }
];

const ENCODERS = [
  { ext: 'avif', encode: image => image.avif({ quality: AVIF_QUALITY, effort: AVIF_EFFORT }) },
  { ext: 'webp', encode: image => image.webp({ quality: WEBP_QUALITY, alphaQuality: 100 }) },
  { ext: 'png', encode: image => image.png({ compressionLevel: 9 }) }
];

function clampInt(value, fallback, min, max) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function postprocess(file) {
  const base = file.slice(0, file.length - path.extname(file).length);
  const input = await fs.readFile(path.join(inDir, file));
  const source = sharp(input);
  const variantDir = path.join(outDir, base);
  await fs.mkdir(variantDir, { recursive: true });

  const tasks = [];
  for (const variant of VARIANTS) {
    const resized = source.clone().resize(variant.width, variant.height, {
      fit: 'contain',
      background: TRANSPARENT,
      kernel: 'lanczos3'
    });
    for (const encoder of ENCODERS) {
      const outName = `${base}-${variant.suffix}.${encoder.ext}`;
      tasks.push(encoder.encode(resized.clone()).toFile(path.join(variantDir, outName)));
    }
  }
  await Promise.all(tasks);
  return tasks.length;
}

async function main() {
  const args = process.argv.slice(2);
  await fs.mkdir(outDir, { recursive: true });

  const entries = await fs.readdir(inDir);
  let files = entries.filter(name => name.toLowerCase().endsWith('.png'));
  if (args.length) {
    const wanted = new Set(args.map(arg => path.basename(arg)));
    files = files.filter(name => wanted.has(name));
  }
  if (!files.length) throw new Error(`No PNG files to process in ${inDir}`);
  files.sort();

  let ok = 0;
  let failed = 0;
  for (const file of files) {
    try {
      const count = await postprocess(file);
      ok += 1;
      console.log(`ok    ${file} -> ${count} files`);
    } catch (error) {
      failed += 1;
      console.error(`fail  ${file}: ${error.message || error}`);
    }
  }

  console.log(`Done. ${ok} ok, ${failed} failed. Output: ${outDir}`);
  if (failed) process.exit(1);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
