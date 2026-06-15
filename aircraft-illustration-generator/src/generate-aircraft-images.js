#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const projectDir = path.resolve(import.meta.dirname, '..');
const promptPath = path.resolve(projectDir, 'input', 'prompt.txt');
const csvPath = path.resolve(projectDir, 'input', 'aircrafts.csv');
const outDir = path.resolve(projectDir, 'output', 'ai_gen');
const envPath = path.resolve(projectDir, '.env');

const MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
const SIZE = process.env.OPENAI_IMAGE_SIZE || '2560x1440';
const QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'medium';
const BACKGROUND = process.env.OPENAI_IMAGE_BACKGROUND || 'opaque';
const FORMAT = (process.env.OPENAI_IMAGE_FORMAT || 'png').toLowerCase();
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || '1'));
const START_AT = Math.max(0, Number(process.env.START_AT || '0'));
const LIMIT = Math.max(0, Number(process.env.LIMIT || '0'));
const DRY_RUN = process.env.DRY_RUN === '1';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function loadEnvFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIndex = line.indexOf('=');
      if (eqIndex === -1) continue;
      const key = line.slice(0, eqIndex).trim();
      let value = line.slice(eqIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith(") && value.endsWith("))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
}

function parseCsvLine(line) {
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map(v => v.trim());
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  const valueIndex = headers.findIndex(h => h.toLowerCase() === 'value');
  const titleIndex = headers.findIndex(h => h.toLowerCase() === 'title');
  if (valueIndex === -1 || titleIndex === -1) {
    throw new Error('CSV must contain headers: value,title');
  }
  return lines.slice(1).map((line, index) => {
    const cols = parseCsvLine(line);
    return {
      row: index + 2,
      value: cols[valueIndex] || '',
      title: cols[titleIndex] || ''
    };
  }).filter(row => row.value && row.title);
}

function slugify(input) {
  return input
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

async function generateImage({ apiKey, prompt }) {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      size: SIZE,
      quality: QUALITY,
      background: BACKGROUND,
      output_format: FORMAT
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API ${response.status}: ${errorText}`);
  }
  const json = await response.json();
  const item = json.data?.[0];
  if (!item?.b64_json) {
    throw new Error(`Unexpected API response: ${JSON.stringify(json)}`);
  }
  return Buffer.from(item.b64_json, 'base64');
}

async function main() {
  await loadEnvFile(envPath);

  const [promptTemplate, csvText] = await Promise.all([
    fs.readFile(promptPath, 'utf8'),
    fs.readFile(csvPath, 'utf8')
  ]);

  const apiKey = DRY_RUN ? 'dry-run' : requireEnv('OPENAI_API_KEY');
  const airframes = parseCsv(csvText);
  const selected = LIMIT > 0 ? airframes.slice(START_AT, START_AT + LIMIT) : airframes.slice(START_AT);
  if (!selected.length) throw new Error('No aircraft rows selected from aircrafts.csv');

  await fs.mkdir(outDir, { recursive: true });
  const manifest = [];
  let cursor = 0;

  async function worker(workerId) {
    while (cursor < selected.length) {
      const currentIndex = cursor++;
      const aircraft = selected[currentIndex];
      const prompt = promptTemplate
        .replaceAll('<aircraft model>', aircraft.title)
        .replaceAll('[aircraft model]', aircraft.title)
        .replaceAll('{{aircraft_model}}', aircraft.title)
        .replaceAll('{{ aircraft_model }}', aircraft.title)
        .replaceAll('<name>', aircraft.title)
        .trim();

      const baseName = slugify(aircraft.value);
      const imagePath = path.join(outDir, `${baseName}.${FORMAT}`);
      const metaPath = path.join(outDir, `${baseName}.json`);

      console.log(`[worker ${workerId}] ${aircraft.value} -> ${aircraft.title}`);

      if (DRY_RUN) {
        await fs.writeFile(metaPath, JSON.stringify({ ...aircraft, prompt, dryRun: true }, null, 2));
        manifest.push({ ...aircraft, file: path.relative(projectDir, imagePath), promptFile: path.relative(projectDir, metaPath), status: 'dry-run' });
        continue;
      }

      const imageBuffer = await generateImage({ apiKey, prompt });
      await fs.writeFile(imagePath, imageBuffer);
      await fs.writeFile(metaPath, JSON.stringify({ ...aircraft, prompt, model: MODEL, size: SIZE, quality: QUALITY, background: BACKGROUND, format: FORMAT }, null, 2));
      manifest.push({ ...aircraft, file: path.relative(projectDir, imagePath), promptFile: path.relative(projectDir, metaPath), status: 'ok' });
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, selected.length) }, (_, i) => worker(i + 1)));
  manifest.sort((a, b) => a.value.localeCompare(b.value));
  await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`Done. Processed ${manifest.length} aircraft.`);
  console.log(`Images directory: ${outDir}`);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});