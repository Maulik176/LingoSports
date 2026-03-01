import {
  DEFAULT_QUALITY,
  DEFAULT_SOURCE_LOCALE,
  normalizeLocale,
  normalizeQuality,
} from './locale-utils.js';
import { localizeCommentaryForLocale } from './translate-commentary.js';

const BACKFILL_WORKER_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.LINGO_BACKFILL_WORKER_CONCURRENCY || '2', 10) || 2
);
const BACKFILL_QUEUE_MAX_PENDING = Math.max(
  50,
  Number.parseInt(process.env.LINGO_BACKFILL_QUEUE_MAX_PENDING || '4000', 10) || 4000
);

const jobQueue = [];
const queuedKeys = new Set();
let activeWorkers = 0;
let droppedJobs = 0;

function buildJobKey(commentaryId, locale, quality) {
  return `${commentaryId}:${locale}:${quality}`;
}

function parseSourceLocale(commentaryRow) {
  return normalizeLocale(
    commentaryRow?.sourceLocale || commentaryRow?.source_locale || DEFAULT_SOURCE_LOCALE,
    DEFAULT_SOURCE_LOCALE
  );
}

async function processJob(job) {
  try {
    const localized = await localizeCommentaryForLocale(job.commentaryRow, {
      locale: job.locale,
      quality: job.quality,
      includeSource: false,
      allowOnDemand: true,
    });

    if (typeof job.onResolved === 'function') {
      job.onResolved(localized.payload, {
        generated: localized.generated,
        commentaryId: job.commentaryRow.id,
        matchId: job.matchId,
        locale: job.locale,
        quality: job.quality,
      });
    }
  } catch (error) {
    console.error('Failed to process translation backfill job:', {
      commentaryId: job.commentaryRow?.id,
      matchId: job.matchId,
      locale: job.locale,
      quality: job.quality,
      error: error?.message || error,
    });

    if (typeof job.onError === 'function') {
      job.onError(error, {
        commentaryId: job.commentaryRow?.id,
        matchId: job.matchId,
        locale: job.locale,
        quality: job.quality,
      });
    }
  }
}

function drainQueue() {
  while (activeWorkers < BACKFILL_WORKER_CONCURRENCY && jobQueue.length > 0) {
    const job = jobQueue.shift();
    activeWorkers += 1;

    void processJob(job)
      .finally(() => {
        activeWorkers = Math.max(0, activeWorkers - 1);
        queuedKeys.delete(job.key);
        drainQueue();
      });
  }
}

export function enqueueCommentaryTranslationJob({
  commentaryRow,
  matchId,
  locale,
  quality = DEFAULT_QUALITY,
  onResolved,
  onError,
}) {
  if (!commentaryRow || !Number.isInteger(commentaryRow.id)) {
    return {
      enqueued: false,
      reason: 'invalid_commentary_row',
    };
  }

  const sourceLocale = parseSourceLocale(commentaryRow);
  const targetLocale = normalizeLocale(locale, sourceLocale);
  const targetQuality = normalizeQuality(quality, DEFAULT_QUALITY);

  if (targetLocale === sourceLocale) {
    return {
      enqueued: false,
      reason: 'same_locale',
    };
  }

  const key = buildJobKey(commentaryRow.id, targetLocale, targetQuality);
  if (queuedKeys.has(key)) {
    return {
      enqueued: false,
      reason: 'already_queued',
    };
  }

  if (jobQueue.length >= BACKFILL_QUEUE_MAX_PENDING) {
    droppedJobs += 1;
    return {
      enqueued: false,
      reason: 'queue_overflow',
    };
  }

  queuedKeys.add(key);
  jobQueue.push({
    key,
    commentaryRow,
    matchId,
    locale: targetLocale,
    quality: targetQuality,
    onResolved,
    onError,
  });
  drainQueue();

  return {
    enqueued: true,
    key,
  };
}

export function enqueueCommentaryTranslationsForRows(rows, options = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  let enqueued = 0;

  for (const row of safeRows) {
    const result = enqueueCommentaryTranslationJob({
      ...options,
      commentaryRow: row,
    });
    if (result.enqueued) {
      enqueued += 1;
    }
  }

  return enqueued;
}

export function getBackfillQueueStats() {
  return {
    queueSize: jobQueue.length,
    workers: activeWorkers,
    dropped: droppedJobs,
    queueMaxPending: BACKFILL_QUEUE_MAX_PENDING,
    workerConcurrency: BACKFILL_WORKER_CONCURRENCY,
  };
}
