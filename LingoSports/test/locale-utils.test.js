import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_QUALITY,
  DEFAULT_SOURCE_LOCALE,
  PRECOMPUTE_LOCALES,
  TARGET_LOCALES,
  normalizeLocale,
  normalizeQuality,
  isSupportedLocale,
} from '../src/lingo/locale-utils.js';

test('normalizeLocale falls back to default when unsupported', () => {
  assert.equal(normalizeLocale('xx'), DEFAULT_SOURCE_LOCALE);
  assert.equal(normalizeLocale(undefined), DEFAULT_SOURCE_LOCALE);
});

test('normalizeLocale strips region tags', () => {
  assert.equal(normalizeLocale('en-US'), 'en');
  assert.equal(normalizeLocale('pt_BR'), 'pt');
});

test('normalizeQuality handles allowed values and fallback', () => {
  assert.equal(normalizeQuality('fast'), 'fast');
  assert.equal(normalizeQuality('STANDARD'), 'standard');
  assert.equal(normalizeQuality('unknown'), DEFAULT_QUALITY);
});

test('supported locale checks and configured locale sets', () => {
  assert.equal(isSupportedLocale('es'), true);
  assert.equal(isSupportedLocale('zz'), false);

  assert.ok(Array.isArray(TARGET_LOCALES));
  assert.ok(Array.isArray(PRECOMPUTE_LOCALES));
  assert.ok(TARGET_LOCALES.length > 0);
  assert.ok(PRECOMPUTE_LOCALES.length > 0);
});
