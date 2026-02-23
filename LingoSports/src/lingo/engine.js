import { performance } from 'node:perf_hooks';
import { LingoDotDevEngine } from 'lingo.dev/sdk';
import {
  DEFAULT_SOURCE_LOCALE,
  DEFAULT_QUALITY,
  normalizeLocale,
  normalizeQuality,
} from './locale-utils.js';

let singletonEngine = null;
let engineUnavailableReason = null;
let inFlightRequests = 0;
const highPriorityWaiters = [];
const lowPriorityWaiters = [];
let consecutiveOutageFailures = 0;
let outageCooldownUntil = 0;
let logWindowStartedAt = 0;
let logCountInWindow = 0;
let suppressedLogCount = 0;

const REQUEST_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.LINGO_REQUEST_CONCURRENCY || '2', 10) || 2
);
const RETRY_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.LINGO_RETRY_ATTEMPTS || '3', 10) || 3
);
const RETRY_BASE_DELAY_MS = Math.max(
  50,
  Number.parseInt(process.env.LINGO_RETRY_BASE_DELAY_MS || '250', 10) || 250
);
const RETRY_MAX_DELAY_MS = Math.max(
  RETRY_BASE_DELAY_MS,
  Number.parseInt(process.env.LINGO_RETRY_MAX_DELAY_MS || '2000', 10) || 2000
);
const OUTAGE_FAILURE_THRESHOLD = Math.max(
  1,
  Number.parseInt(process.env.LINGO_OUTAGE_FAILURE_THRESHOLD || '6', 10) || 6
);
const OUTAGE_COOLDOWN_MS = Math.max(
  0,
  Number.parseInt(process.env.LINGO_OUTAGE_COOLDOWN_MS || '15000', 10) || 15000
);
const ERROR_LOG_WINDOW_MS = Math.max(
  1000,
  Number.parseInt(process.env.LINGO_ERROR_LOG_WINDOW_MS || '20000', 10) || 20000
);
const ERROR_LOG_MAX_PER_WINDOW = Math.max(
  1,
  Number.parseInt(process.env.LINGO_ERROR_LOG_MAX_PER_WINDOW || '8', 10) || 8
);

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractStatusCode(error) {
  const explicit = Number.parseInt(error?.statusCode || error?.status || '', 10);
  if (Number.isInteger(explicit) && explicit >= 100 && explicit <= 599) {
    return explicit;
  }

  const message = String(error?.message || '');
  const match = message.match(/\b([45]\d{2})\b/);
  if (match) {
    const status = Number.parseInt(match[1], 10);
    if (Number.isInteger(status)) return status;
  }
  return null;
}

function isRetryableError(error) {
  const status = extractStatusCode(error);
  if (status != null) {
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
  }

  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('temporar') ||
    message.includes('connection reset') ||
    message.includes('connection failure') ||
    message.includes('upstream connect error')
  );
}

function isOutageSignal(error) {
  const status = extractStatusCode(error);
  return status === 502 || status === 503 || status === 504;
}

function computeRetryDelayMs(attempt) {
  const exponential = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * (2 ** (attempt - 1)));
  const jitter = Math.floor(Math.random() * Math.max(25, Math.floor(RETRY_BASE_DELAY_MS / 2)));
  return exponential + jitter;
}

function normalizePriority(priority) {
  return priority === 'low' ? 'low' : 'high';
}

function acquireRequestSlot(priority = 'high') {
  const normalizedPriority = normalizePriority(priority);
  if (inFlightRequests < REQUEST_CONCURRENCY) {
    inFlightRequests += 1;
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    if (normalizedPriority === 'low') {
      lowPriorityWaiters.push(resolve);
    } else {
      highPriorityWaiters.push(resolve);
    }
  }).then(() => {
    inFlightRequests += 1;
  });
}

function releaseRequestSlot() {
  inFlightRequests = Math.max(0, inFlightRequests - 1);
  const next = highPriorityWaiters.shift() || lowPriorityWaiters.shift();
  if (next) next();
}

async function withRequestSlot(action, priority = 'high') {
  await acquireRequestSlot(priority);
  try {
    return await action();
  } finally {
    releaseRequestSlot();
  }
}

function markSuccess() {
  consecutiveOutageFailures = 0;
}

function markFailure(error) {
  if (!isOutageSignal(error)) {
    consecutiveOutageFailures = 0;
    return;
  }

  consecutiveOutageFailures += 1;
  if (consecutiveOutageFailures >= OUTAGE_FAILURE_THRESHOLD) {
    outageCooldownUntil = Date.now() + OUTAGE_COOLDOWN_MS;
  }
}

function shouldSkipDueToCooldown() {
  if (outageCooldownUntil <= 0) return false;
  return Date.now() < outageCooldownUntil;
}

function getCooldownReason() {
  const remaining = Math.max(0, outageCooldownUntil - Date.now());
  return `temporary_outage_cooldown_${remaining}ms`;
}

function logTranslationFailureWithThrottle(payload) {
  const now = Date.now();
  if (now - logWindowStartedAt >= ERROR_LOG_WINDOW_MS) {
    if (suppressedLogCount > 0) {
      console.warn(
        `Lingo translation failures suppressed: ${suppressedLogCount} additional errors in last window`
      );
    }
    logWindowStartedAt = now;
    logCountInWindow = 0;
    suppressedLogCount = 0;
  }

  if (logCountInWindow < ERROR_LOG_MAX_PER_WINDOW) {
    logCountInWindow += 1;
    console.error('Lingo translation failed:', payload);
    return;
  }

  suppressedLogCount += 1;
}

function buildEngine() {
  if (singletonEngine || engineUnavailableReason) {
    return singletonEngine;
  }

  const apiKey = process.env.LINGO_API_KEY?.trim();
  if (!apiKey) {
    engineUnavailableReason = 'missing_api_key';
    return null;
  }

  try {
    singletonEngine = new LingoDotDevEngine({ apiKey });
    return singletonEngine;
  } catch (error) {
    engineUnavailableReason = error?.message || 'engine_init_failed';
    console.error('Failed to initialize LingoDotDevEngine:', error);
    return null;
  }
}

export function getLingoAvailability() {
  const engine = buildEngine();
  if (engine) {
    return { available: true, reason: null };
  }
  return { available: false, reason: engineUnavailableReason || 'unknown' };
}

export async function detectLocale(text, fallbackLocale = DEFAULT_SOURCE_LOCALE) {
  const fallback = normalizeLocale(fallbackLocale, DEFAULT_SOURCE_LOCALE);
  const engine = buildEngine();

  if (!engine || typeof text !== 'string' || !text.trim()) {
    return fallback;
  }

  try {
    const locale = await engine.recognizeLocale(text);
    return normalizeLocale(locale, fallback);
  } catch (error) {
    console.warn('Lingo locale detection failed:', error?.message || error);
    return fallback;
  }
}

export async function translateText({
  text,
  sourceLocale,
  targetLocale,
  quality,
  priority = 'high',
}) {
  const source = normalizeLocale(sourceLocale, DEFAULT_SOURCE_LOCALE);
  const target = normalizeLocale(targetLocale, source);
  const mode = normalizeQuality(quality, DEFAULT_QUALITY);

  if (target === source) {
    return {
      text,
      sourceLocale: source,
      targetLocale: target,
      quality: mode,
      provider: 'source',
      latencyMs: 0,
      fallbackReason: null,
    };
  }

  const started = performance.now();
  const engine = buildEngine();

  if (!engine) {
    return {
      text,
      sourceLocale: source,
      targetLocale: target,
      quality: mode,
      provider: 'source',
      latencyMs: Math.round(performance.now() - started),
      fallbackReason: engineUnavailableReason || 'engine_unavailable',
    };
  }

  if (shouldSkipDueToCooldown()) {
    return {
      text,
      sourceLocale: source,
      targetLocale: target,
      quality: mode,
      provider: 'source',
      latencyMs: Math.round(performance.now() - started),
      fallbackReason: getCooldownReason(),
    };
  }

  try {
    let translated = null;
    let lastError = null;

    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
      try {
        translated = await withRequestSlot(
          async () =>
            engine.localizeText(String(text ?? ''), {
              sourceLocale: source,
              targetLocale: target,
              fast: mode === 'fast',
            }),
          priority
        );
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        const canRetry = attempt < RETRY_ATTEMPTS && isRetryableError(error);
        if (!canRetry) {
          throw error;
        }
        await wait(computeRetryDelayMs(attempt));
      }
    }

    if (translated == null && lastError) {
      throw lastError;
    }

    markSuccess();

    return {
      text: translated,
      sourceLocale: source,
      targetLocale: target,
      quality: mode,
      provider: 'lingo',
      latencyMs: Math.round(performance.now() - started),
      fallbackReason: null,
    };
  } catch (error) {
    markFailure(error);
    logTranslationFailureWithThrottle({
      source,
      target,
      quality: mode,
      error: error?.message || error,
    });

    return {
      text,
      sourceLocale: source,
      targetLocale: target,
      quality: mode,
      provider: 'source',
      latencyMs: Math.round(performance.now() - started),
      fallbackReason: error?.message || 'translate_error',
    };
  }
}
