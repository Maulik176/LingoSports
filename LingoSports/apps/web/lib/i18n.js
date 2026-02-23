export const SUPPORTED_LOCALES = ['en', 'es', 'fr', 'de', 'hi', 'ar', 'ja', 'pt'];
export const DEFAULT_LOCALE = 'en';

const MESSAGE_LOADERS = {
  en: () => import('../messages/en.json').then((m) => m.default),
  es: () => import('../messages/es.json').then((m) => m.default),
  fr: () => import('../messages/fr.json').then((m) => m.default),
  de: () => import('../messages/de.json').then((m) => m.default),
  hi: () => import('../messages/hi.json').then((m) => m.default),
  ar: () => import('../messages/ar.json').then((m) => m.default),
  ja: () => import('../messages/ja.json').then((m) => m.default),
  pt: () => import('../messages/pt.json').then((m) => m.default),
};

export function normalizeLocale(locale, fallback = DEFAULT_LOCALE) {
  if (typeof locale !== 'string') return fallback;
  const normalized = locale.trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.includes(normalized) ? normalized : fallback;
}

export async function loadMessages(locale) {
  const normalized = normalizeLocale(locale);
  const loader = MESSAGE_LOADERS[normalized] || MESSAGE_LOADERS[DEFAULT_LOCALE];
  return loader();
}

export function localeHref(locale, pathname = '/') {
  const normalized = normalizeLocale(locale);
  const cleanPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `/${normalized}${cleanPath === '/' ? '' : cleanPath}`;
}
