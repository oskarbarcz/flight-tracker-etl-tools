#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const projectDir = path.resolve(import.meta.dirname, '..');
const inDir = path.resolve(projectDir, 'output', 'ai_gen');
const outDir = path.resolve(projectDir, 'output', 'transparent');

const THRESHOLD = clamp(Math.round(Number(process.env.BG_THRESHOLD || '240')), 0, 255);
const FEATHER_BAND = Math.max(0, Number(process.env.BG_FEATHER_BAND || '40'));

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(filtered, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filterType = filtered[pos];
    pos += 1;
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;
    for (let x = 0; x < stride; x += 1) {
      const filt = filtered[pos];
      pos += 1;
      const a = x >= bpp ? out[rowStart + x - bpp] : 0;
      const b = y > 0 ? out[prevStart + x] : 0;
      const c = x >= bpp && y > 0 ? out[prevStart + x - bpp] : 0;
      let value;
      switch (filterType) {
        case 0: value = filt; break;
        case 1: value = filt + a; break;
        case 2: value = filt + b; break;
        case 3: value = filt + ((a + b) >> 1); break;
        case 4: value = filt + paeth(a, b, c); break;
        default: throw new Error(`Unknown PNG filter type ${filterType}`);
      }
      out[rowStart + x] = value & 0xff;
    }
  }
  return out;
}

function toRgba(raw, width, height, colorType) {
  const pixels = width * height;
  if (colorType === 6) return Buffer.from(raw);
  const rgba = Buffer.alloc(pixels * 4);
  if (colorType === 2) {
    for (let i = 0; i < pixels; i += 1) {
      rgba[i * 4] = raw[i * 3];
      rgba[i * 4 + 1] = raw[i * 3 + 1];
      rgba[i * 4 + 2] = raw[i * 3 + 2];
      rgba[i * 4 + 3] = 255;
    }
    return rgba;
  }
  throw new Error(`Unsupported color type ${colorType} (only RGB/RGBA)`);
}

function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Not a PNG file');
  let offset = 8;
  let header = null;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12]
      };
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (!header) throw new Error('Missing IHDR chunk');
  if (header.bitDepth !== 8) throw new Error(`Only 8-bit PNGs are supported (got ${header.bitDepth})`);
  if (header.interlace !== 0) throw new Error('Interlaced PNGs are not supported');
  const bpp = header.colorType === 6 ? 4 : header.colorType === 2 ? 3 : 0;
  if (!bpp) throw new Error(`Unsupported color type ${header.colorType} (only RGB/RGBA)`);
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const raw = unfilter(inflated, header.width, header.height, bpp);
  return {
    width: header.width,
    height: header.height,
    rgba: toRgba(raw, header.width, header.height, header.colorType)
  };
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function featherEdges(width, height, rgba, threshold, band) {
  const total = width * height;
  for (let idx = 0; idx < total; idx += 1) {
    const o = idx * 4;
    if (rgba[o + 3] === 0) continue;
    const x = idx % width;
    const y = (idx / width) | 0;
    const touchesTransparent =
      (x > 0 && rgba[(idx - 1) * 4 + 3] === 0) ||
      (x < width - 1 && rgba[(idx + 1) * 4 + 3] === 0) ||
      (y > 0 && rgba[(idx - width) * 4 + 3] === 0) ||
      (y < height - 1 && rgba[(idx + width) * 4 + 3] === 0);
    if (!touchesTransparent) continue;
    const lum = (rgba[o] + rgba[o + 1] + rgba[o + 2]) / 3;
    const alpha = Math.round(clamp((threshold - lum) / band, 0, 1) * 255);
    if (alpha < rgba[o + 3]) rgba[o + 3] = alpha;
  }
}

function removeBackground(width, height, rgba, threshold, band) {
  const total = width * height;
  const visited = new Uint8Array(total);
  const stack = [];

  const pushIf = idx => {
    if (!visited[idx]) stack.push(idx);
  };
  const isBackground = idx => {
    const o = idx * 4;
    return Math.min(rgba[o], rgba[o + 1], rgba[o + 2]) >= threshold;
  };

  for (let x = 0; x < width; x += 1) {
    pushIf(x);
    pushIf((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    pushIf(y * width);
    pushIf(y * width + width - 1);
  }

  while (stack.length) {
    const idx = stack.pop();
    if (visited[idx]) continue;
    visited[idx] = 1;
    if (!isBackground(idx)) continue;
    rgba[idx * 4 + 3] = 0;
    const x = idx % width;
    const y = (idx / width) | 0;
    if (x > 0) pushIf(idx - 1);
    if (x < width - 1) pushIf(idx + 1);
    if (y > 0) pushIf(idx - width);
    if (y < height - 1) pushIf(idx + width);
  }

  if (band > 0) featherEdges(width, height, rgba, threshold, band);
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
      const buffer = await fs.readFile(path.join(inDir, file));
      const { width, height, rgba } = decodePng(buffer);
      removeBackground(width, height, rgba, THRESHOLD, FEATHER_BAND);
      await fs.writeFile(path.join(outDir, file), encodePng(width, height, rgba));
      ok += 1;
      console.log(`ok    ${file}`);
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
