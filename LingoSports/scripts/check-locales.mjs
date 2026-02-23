import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const MESSAGE_DIR = path.join(ROOT, 'apps', 'web', 'messages');
const SOURCE_LOCALE = 'en';
const TARGET_LOCALES = ['es', 'fr', 'de', 'hi', 'ar', 'ja', 'pt'];
const MAX_MISSING_KEYS = Number.parseInt(process.env.MAX_MISSING_TRANSLATION_KEYS || '0', 10);

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function listMissingKeys(source, target) {
  const missing = [];
  for (const key of Object.keys(source)) {
    if (!(key in target) || target[key] == null || String(target[key]).trim() === '') {
      missing.push(key);
    }
  }
  return missing;
}

async function main() {
  const sourceFile = path.join(MESSAGE_DIR, `${SOURCE_LOCALE}.json`);
  const source = await readJson(sourceFile);

  let hasFailures = false;

  for (const locale of TARGET_LOCALES) {
    const localeFile = path.join(MESSAGE_DIR, `${locale}.json`);

    try {
      await fs.access(localeFile);
    } catch {
      console.error(`Missing locale file: ${localeFile}`);
      hasFailures = true;
      continue;
    }

    const target = await readJson(localeFile);
    const missing = listMissingKeys(source, target);

    if (missing.length > MAX_MISSING_KEYS) {
      hasFailures = true;
      console.error(`Locale ${locale} has ${missing.length} missing keys (max allowed: ${MAX_MISSING_KEYS}).`);
      console.error(`Missing keys: ${missing.join(', ')}`);
    } else {
      console.log(`Locale ${locale}: ${Object.keys(source).length - missing.length}/${Object.keys(source).length} keys translated.`);
    }
  }

  if (hasFailures) {
    process.exit(1);
  }

  console.log('Locale completeness check passed.');
}

main().catch((error) => {
  console.error('Locale check failed:', error);
  process.exit(1);
});
