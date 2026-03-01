import {
  DEFAULT_QUALITY,
  DEFAULT_SOURCE_LOCALE,
  PRECOMPUTE_LOCALES,
  TARGET_LOCALES,
  normalizeLocale,
  normalizeQuality,
} from './locale-utils.js';
import { detectLocale, translateText } from './engine.js';
import {
  findCachedTranslation,
  listCachedTranslations,
  recordTranslationEvent,
  upsertTranslation,
} from './cache.js';

const inFlightTranslations = new Map();
const NON_ASCII_REGEX = /[^\x00-\x7F]/;
const DETECT_ALL_SOURCES = process.env.LINGO_DETECT_ALL_SOURCES === '1';
const BULK_TRANSLATION_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.LINGO_BULK_TRANSLATION_CONCURRENCY || '6', 10) || 6
);
const PRECOMPUTE_TRANSLATION_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.LINGO_PRECOMPUTE_CONCURRENCY || '2', 10) || 2
);
const PRECOMPUTE_QUEUE_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.LINGO_PRECOMPUTE_QUEUE_CONCURRENCY || '1', 10) || 1
);
const PRECOMPUTE_QUEUE_MAX_PENDING = Math.max(
  10,
  Number.parseInt(process.env.LINGO_PRECOMPUTE_QUEUE_MAX_PENDING || '2000', 10) || 2000
);

const precomputeQueue = [];
let precomputeWorkers = 0;
let precomputeDropCount = 0;

function keyFor(commentaryId, targetLocale, quality) {
  return `${commentaryId}:${targetLocale}:${quality}`;
}

function buildLockedTermCandidates(commentaryRow) {
  const candidates = [commentaryRow.actor, commentaryRow.team]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  return Array.from(new Set(candidates));
}

function lockTerms(text, terms) {
  const lockMap = new Map();
  let nextText = text;

  terms.forEach((term, index) => {
    const token = `__LINGO_LOCK_${index}__`;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'g');

    if (regex.test(nextText)) {
      nextText = nextText.replace(regex, token);
      lockMap.set(token, term);
    }
  });

  return { text: nextText, lockMap };
}

function unlockTerms(text, lockMap) {
  let nextText = text;
  for (const [token, term] of lockMap.entries()) {
    nextText = nextText.replaceAll(token, term);
  }
  return nextText;
}

function buildResponsePayload(commentaryRow, {
  locale,
  quality,
  message,
  status,
  provider,
  latencyMs,
  fallbackReason,
  includeSource,
}) {
  const response = {
    ...commentaryRow,
    locale,
    quality,
    message,
    sourceLocale: commentaryRow.sourceLocale,
    translation: {
      status,
      provider,
      latencyMs,
      fallbackReason: fallbackReason ?? null,
    },
  };

  if (includeSource) {
    response.sourceMessage = commentaryRow.message;
  }

  return response;
}

async function mapWithConcurrency(items, mapper, concurrency) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const output = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return output;
}

export async function resolveCommentarySourceLocale({ message, sourceLocale }) {
  if (sourceLocale) {
    return normalizeLocale(sourceLocale, DEFAULT_SOURCE_LOCALE);
  }

  if (!DETECT_ALL_SOURCES && !NON_ASCII_REGEX.test(String(message ?? ''))) {
    return DEFAULT_SOURCE_LOCALE;
  }

  const detected = await detectLocale(message, DEFAULT_SOURCE_LOCALE);
  return normalizeLocale(detected, DEFAULT_SOURCE_LOCALE);
}

async function generateAndOptionallyPersistTranslation(
  commentaryRow,
  targetLocale,
  quality,
  priority = 'high'
) {
  const lockedTerms = buildLockedTermCandidates(commentaryRow);
  const locked = lockTerms(commentaryRow.message, lockedTerms);

  const translated = await translateText({
    text: locked.text,
    sourceLocale: commentaryRow.sourceLocale,
    targetLocale,
    quality,
    priority,
  });

  const translatedText = unlockTerms(translated.text, locked.lockMap);

  const status = translated.provider === 'lingo' ? 'translated' : 'fallback-source';

  await recordTranslationEvent({
    commentaryId: commentaryRow.id,
    sourceLocale: commentaryRow.sourceLocale,
    targetLocale,
    quality,
    status,
    latencyMs: translated.latencyMs,
    fallbackReason: translated.fallbackReason,
    errorMessage: translated.fallbackReason,
  });

  if (translated.provider !== 'lingo') {
    return {
      row: null,
      status,
      provider: translated.provider,
      text: translatedText,
      latencyMs: translated.latencyMs,
      fallbackReason: translated.fallbackReason,
    };
  }

  const row = await upsertTranslation({
    commentaryId: commentaryRow.id,
    targetLocale,
    quality,
    translatedMessage: translatedText,
    provider: translated.provider,
    latencyMs: translated.latencyMs,
  });

  return {
    row,
    status: 'on-demand',
    provider: translated.provider,
    text: translatedText,
    latencyMs: translated.latencyMs,
    fallbackReason: null,
  };
}

export async function getOrCreateTranslation(
  commentaryRow,
  targetLocale,
  quality,
  allowOnDemand = true,
  options = {}
) {
  const normalizedLocale = normalizeLocale(targetLocale, commentaryRow.sourceLocale);
  const normalizedQuality = normalizeQuality(quality, DEFAULT_QUALITY);
  const priority = options.priority === 'low' ? 'low' : 'high';

  if (normalizedLocale === commentaryRow.sourceLocale) {
    return {
      row: null,
      status: 'source',
      provider: 'source',
      text: commentaryRow.message,
      latencyMs: 0,
      fallbackReason: null,
      generated: false,
    };
  }

  const cached = await findCachedTranslation(commentaryRow.id, normalizedLocale, normalizedQuality);
  if (cached) {
    void recordTranslationEvent({
      commentaryId: commentaryRow.id,
      sourceLocale: commentaryRow.sourceLocale,
      targetLocale: normalizedLocale,
      quality: normalizedQuality,
      status: 'cache-hit',
      latencyMs: 0,
      fallbackReason: null,
      errorMessage: null,
    });

    return {
      row: cached,
      status: 'precomputed',
      provider: cached.provider,
      text: cached.translatedMessage,
      latencyMs: cached.latencyMs,
      fallbackReason: null,
      generated: false,
    };
  }

  if (!allowOnDemand) {
    return {
      row: null,
      status: 'fallback-source',
      provider: 'source',
      text: commentaryRow.message,
      latencyMs: 0,
      fallbackReason: 'not_precomputed',
      generated: false,
    };
  }

  const key = keyFor(commentaryRow.id, normalizedLocale, normalizedQuality);
  let promise = inFlightTranslations.get(key);
  if (!promise) {
    promise = generateAndOptionallyPersistTranslation(
      commentaryRow,
      normalizedLocale,
      normalizedQuality,
      priority
    ).finally(() => {
      inFlightTranslations.delete(key);
    });
    inFlightTranslations.set(key, promise);
  }

  const generated = await promise;
  return {
    ...generated,
    generated: true,
  };
}

export async function precomputeCommentaryTranslations(commentaryRow, quality = DEFAULT_QUALITY) {
  const normalizedQuality = normalizeQuality(quality, DEFAULT_QUALITY);
  const localesToTranslate = PRECOMPUTE_LOCALES.filter(
    (locale) => locale !== commentaryRow.sourceLocale
  );

  await mapWithConcurrency(
    localesToTranslate,
    async (locale) =>
      getOrCreateTranslation(commentaryRow, locale, normalizedQuality, true, { priority: 'low' }),
    PRECOMPUTE_TRANSLATION_CONCURRENCY
  );
}

function processPrecomputeQueue() {
  while (
    precomputeWorkers < PRECOMPUTE_QUEUE_CONCURRENCY &&
    precomputeQueue.length > 0
  ) {
    const nextJob = precomputeQueue.shift();
    precomputeWorkers += 1;

    void precomputeCommentaryTranslations(nextJob.commentaryRow, nextJob.quality)
      .then(() => {
        nextJob.resolve({
          queued: true,
          dropped: false,
        });
      })
      .catch((error) => {
        nextJob.reject(error);
      })
      .finally(() => {
        precomputeWorkers = Math.max(0, precomputeWorkers - 1);
        processPrecomputeQueue();
      });
  }
}

export function schedulePrecomputeCommentaryTranslations(commentaryRow, quality = DEFAULT_QUALITY) {
  const normalizedQuality = normalizeQuality(quality, DEFAULT_QUALITY);

  if (precomputeQueue.length >= PRECOMPUTE_QUEUE_MAX_PENDING) {
    precomputeDropCount += 1;
    if (precomputeDropCount % 50 === 1) {
      console.warn('Dropping precompute translation jobs due to queue pressure', {
        queueSize: precomputeQueue.length,
        dropped: precomputeDropCount,
      });
    }
    return Promise.resolve({
      queued: false,
      dropped: true,
    });
  }

  return new Promise((resolve, reject) => {
    precomputeQueue.push({
      commentaryRow,
      quality: normalizedQuality,
      resolve,
      reject,
    });
    processPrecomputeQueue();
  });
}

export function getPrecomputeQueueStats() {
  return {
    queueSize: precomputeQueue.length,
    workers: precomputeWorkers,
    dropped: precomputeDropCount,
    queueMaxPending: PRECOMPUTE_QUEUE_MAX_PENDING,
    queueConcurrency: PRECOMPUTE_QUEUE_CONCURRENCY,
    precomputeConcurrency: PRECOMPUTE_TRANSLATION_CONCURRENCY,
  };
}

export async function localizeCommentaryForLocale(commentaryRow, {
  locale,
  quality = DEFAULT_QUALITY,
  includeSource = false,
  allowOnDemand = true,
}) {
  const normalizedLocale = normalizeLocale(locale, DEFAULT_SOURCE_LOCALE);
  const normalizedQuality = normalizeQuality(quality, DEFAULT_QUALITY);

  const translation = await getOrCreateTranslation(
    commentaryRow,
    normalizedLocale,
    normalizedQuality,
    allowOnDemand
  );

  return {
    payload: buildResponsePayload(commentaryRow, {
      locale: normalizedLocale,
      quality: normalizedQuality,
      message: translation.text,
      status: translation.status,
      provider: translation.provider,
      latencyMs: translation.latencyMs,
      fallbackReason: translation.fallbackReason,
      includeSource,
    }),
    generated: Boolean(translation.generated),
  };
}

export async function localizeCommentaryInBulk(commentaryRows, {
  locale,
  quality = DEFAULT_QUALITY,
  includeSource = false,
  allowOnDemand = true,
}) {
  return mapWithConcurrency(
    commentaryRows,
    async (row) => {
      const localized = await localizeCommentaryForLocale(row, {
        locale,
        quality,
        includeSource,
        allowOnDemand,
      });
      return localized.payload;
    },
    BULK_TRANSLATION_CONCURRENCY
  );
}

export async function buildGlobalFanView(commentaryRow, quality = DEFAULT_QUALITY) {
  const locales = [DEFAULT_SOURCE_LOCALE, ...TARGET_LOCALES];
  const items = [];

  for (const locale of locales) {
    const localized = await localizeCommentaryForLocale(commentaryRow, {
      locale,
      quality,
      includeSource: false,
      allowOnDemand: true,
    });

    items.push({
      locale,
      message: localized.payload.message,
      status: localized.payload.translation.status,
      provider: localized.payload.translation.provider,
    });
  }

  return items;
}

export async function getTranslationCoverageStats(quality = DEFAULT_QUALITY) {
  const normalizedQuality = normalizeQuality(quality, DEFAULT_QUALITY);
  return {
    quality: normalizedQuality,
    targetLocales: TARGET_LOCALES,
    precomputeLocales: PRECOMPUTE_LOCALES,
  };
}

export async function getAvailableTranslations(commentaryId, quality = DEFAULT_QUALITY) {
  const rows = await listCachedTranslations(commentaryId, normalizeQuality(quality, DEFAULT_QUALITY));
  return rows.reduce((acc, row) => {
    acc[row.targetLocale] = {
      message: row.translatedMessage,
      provider: row.provider,
      latencyMs: row.latencyMs,
      createdAt: row.createdAt,
    };
    return acc;
  }, {});
}
