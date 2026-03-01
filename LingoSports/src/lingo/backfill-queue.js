import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
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
const BACKFILL_PERSIST_PATH = String(process.env.LINGO_BACKFILL_PERSIST_PATH || '').trim();
const BACKFILL_SHUTDOWN_TIMEOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.LINGO_BACKFILL_SHUTDOWN_TIMEOUT_MS || '8000', 10) || 8000
);

const jobQueue = [];
const queuedKeys = new Set();
let activeWorkers = 0;
let droppedJobs = 0;
let acceptingJobs = true;
let shutdownPromise = null;
let signalHandlersRegistered = false;

function buildJobKey(commentaryId, locale, quality) {
  return `${commentaryId}:${locale}:${quality}`;
}

function parseSourceLocale(commentaryRow) {
  return normalizeLocale(
    commentaryRow?.sourceLocale || commentaryRow?.source_locale || DEFAULT_SOURCE_LOCALE,
    DEFAULT_SOURCE_LOCALE
  );
}

async function persistQueueSnapshot() {
  if (!BACKFILL_PERSIST_PATH) return;
  const payload = jobQueue.map((job) => ({
    commentaryRow: job.commentaryRow,
    matchId: job.matchId,
    locale: job.locale,
    quality: job.quality,
  }));

  try {
    await mkdir(dirname(BACKFILL_PERSIST_PATH), { recursive: true });
    await writeFile(BACKFILL_PERSIST_PATH, JSON.stringify(payload), 'utf8');
  } catch (error) {
    console.error('Failed to persist backfill queue snapshot:', error?.message || error);
  }
}

async function recoverPersistedQueue() {
  if (!BACKFILL_PERSIST_PATH) return;
  try {
    const fileContent = await readFile(BACKFILL_PERSIST_PATH, 'utf8');
    const rows = JSON.parse(fileContent);
    if (!Array.isArray(rows) || rows.length === 0) return;

    for (const row of rows) {
      enqueueCommentaryTranslationJob({
        commentaryRow: row?.commentaryRow,
        matchId: row?.matchId,
        locale: row?.locale,
        quality: row?.quality,
      });
    }
    await writeFile(BACKFILL_PERSIST_PATH, '[]', 'utf8');
  } catch {
    // Ignore missing file or malformed persisted queue.
  }
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
  if (!acceptingJobs) {
    return {
      enqueued: false,
      reason: 'shutting_down',
    };
  }

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

export async function shutdownBackfillQueue(options = {}) {
  if (shutdownPromise) return shutdownPromise;
  const timeoutMs = Math.max(
    1000,
    Number.parseInt(String(options.timeoutMs ?? BACKFILL_SHUTDOWN_TIMEOUT_MS), 10) || BACKFILL_SHUTDOWN_TIMEOUT_MS
  );

  acceptingJobs = false;
  shutdownPromise = (async () => {
    await persistQueueSnapshot();
    const start = Date.now();
    while (activeWorkers > 0) {
      if (Date.now() - start >= timeoutMs) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return {
      drained: activeWorkers === 0,
      activeWorkers,
      pendingJobs: jobQueue.length,
      timeoutMs,
    };
  })();

  return shutdownPromise;
}

function registerSignalHandlers() {
  if (signalHandlersRegistered) return;
  signalHandlersRegistered = true;

  const handleSignal = (signal) => {
    void shutdownBackfillQueue({ timeoutMs: BACKFILL_SHUTDOWN_TIMEOUT_MS })
      .finally(() => {
        process.exit(signal === 'SIGINT' ? 130 : 0);
      });
  };

  process.once('SIGINT', () => handleSignal('SIGINT'));
  process.once('SIGTERM', () => handleSignal('SIGTERM'));
}

registerSignalHandlers();
void recoverPersistedQueue();
