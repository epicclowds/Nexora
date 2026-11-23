// Validates every bundled translation catalogue against the en-US reference.
// Fails (exit 1) on unsafe content, structural errors or unknown keys.
// Missing keys are reported as warnings because English is used as fallback.
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { validateCatalog, findMissingKeys, findUnknownKeys, DEFAULT_LOCALE } = require(join(root, 'dist', 'src', 'index.js'));

const localesDir = join(root, 'locales');
const reference = JSON.parse(readFileSync(join(localesDir, `${DEFAULT_LOCALE}.json`), 'utf8'));
let failed = false;

for (const file of readdirSync(localesDir).filter((f) => f.endsWith('.json'))) {
  const locale = file.replace(/\.json$/, '');
  const catalog = JSON.parse(readFileSync(join(localesDir, file), 'utf8'));
  const issues = validateCatalog(catalog);
  for (const issue of issues) console.error(`✖ ${locale}: ${issue.key} → ${issue.problem}`);
  if (issues.length) failed = true;

  if (catalog?.meta?.locale !== locale) {
    console.error(`✖ ${locale}: meta.locale must equal the file name`);
    failed = true;
  }
  const unknown = findUnknownKeys(reference, catalog);
  for (const key of unknown) console.error(`✖ ${locale}: unknown key ${key}`);
  if (unknown.length) failed = true;

  const missing = findMissingKeys(reference, catalog);
  for (const key of missing) console.warn(`⚠ ${locale}: missing key ${key} (falls back to ${DEFAULT_LOCALE})`);
  console.log(`${locale}: ${issues.length + unknown.length} error(s), ${missing.length} missing key(s)`);
}

// Minecraft plugin message files: every locale must define the same keys as en-US.
const mcDir = join(root, 'minecraft');
const keysOf = (text) =>
  text
    .split(/\r?\n/)
    .map((l) => l.match(/^([a-z0-9-]+(?:\.[a-z0-9-]+)*):\s*"/)?.[1])
    .filter(Boolean);
const mcReference = new Set(keysOf(readFileSync(join(mcDir, `${DEFAULT_LOCALE}.yml`), 'utf8')));
for (const file of readdirSync(mcDir).filter((f) => f.endsWith('.yml'))) {
  const text = readFileSync(join(mcDir, file), 'utf8');
  const keys = new Set(keysOf(text));
  const unknown = [...keys].filter((k) => !mcReference.has(k));
  for (const k of unknown) console.error(`✖ minecraft/${file}: unknown key ${k}`);
  if (unknown.length) failed = true;
  const missing = [...mcReference].filter((k) => !keys.has(k));
  for (const k of missing) console.warn(`⚠ minecraft/${file}: missing key ${k}`);
  console.log(`minecraft/${file}: ${keys.size} keys`);
}

if (failed) {
  console.error('Translation validation failed.');
  process.exit(1);
}
console.log('All translation catalogues are valid.');
