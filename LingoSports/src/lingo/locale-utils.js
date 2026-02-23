const FALLBACK_SOURCE_LOCALE = 'en';
const FALLBACK_QUALITY = 'standard';

export const SUPPORTED_LOCALES = Object.freeze([
  'en',
  'es',
  'fr',
  'de',
  'hi',
  'ar',
  'ja',
  'pt',
]);

export const QUALITY_VALUES = Object.freeze(['fast', 'standard']);

function stripRegionTag(locale) {
  if (typeof locale !== 'string') return '';
  const trimmed = locale.trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed.split(/[-_]/)[0];
}

export function normalizeLocale(locale, fallback = FALLBACK_SOURCE_LOCALE) {
  const shortCode = stripRegionTag(locale);
  if (SUPPORTED_LOCALES.includes(shortCode)) {
    return shortCode;
  }
  const fallbackCode = stripRegionTag(fallback);
  return SUPPORTED_LOCALES.includes(fallbackCode) ? fallbackCode : FALLBACK_SOURCE_LOCALE;
}

export function isSupportedLocale(locale) {
  return SUPPORTED_LOCALES.includes(stripRegionTag(locale));
}

export function normalizeQuality(quality, fallback = FALLBACK_QUALITY) {
  if (typeof quality === 'string') {
    const value = quality.trim().toLowerCase();
    if (QUALITY_VALUES.includes(value)) return value;
  }
  if (QUALITY_VALUES.includes(fallback)) return fallback;
  return FALLBACK_QUALITY;
}

function parseLocaleList(value) {
  if (typeof value !== 'string') return [];
  const unique = new Set();

  for (const item of value.split(',')) {
    const normalized = normalizeLocale(item, '');
    if (normalized) unique.add(normalized);
  }

  return Array.from(unique);
}

export const DEFAULT_SOURCE_LOCALE = normalizeLocale(
  process.env.LINGO_SOURCE_LOCALE,
  FALLBACK_SOURCE_LOCALE
);

export const TARGET_LOCALES = Object.freeze(
  (() => {
    const fromEnv = parseLocaleList(process.env.LINGO_TARGET_LOCALES);
    if (fromEnv.length) return fromEnv;
    return SUPPORTED_LOCALES.filter((locale) => locale !== DEFAULT_SOURCE_LOCALE);
  })()
);

export const PRECOMPUTE_LOCALES = Object.freeze(
  (() => {
    const fromEnv = parseLocaleList(process.env.LINGO_PRECOMPUTE_LOCALES);
    if (fromEnv.length) return fromEnv;
    return [...TARGET_LOCALES];
  })()
);

export const DEFAULT_QUALITY = normalizeQuality(process.env.LINGO_TRANSLATION_QUALITY);

export function shouldDetectLocale(sourceLocale) {
  return !sourceLocale || !isSupportedLocale(sourceLocale);
}
