import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db/db.js';
import { lingoTranslationEvents } from '../db/schema.js';
import { getLingoAvailability } from './engine.js';
import { DEFAULT_QUALITY, PRECOMPUTE_LOCALES, TARGET_LOCALES, normalizeQuality } from './locale-utils.js';
import { getPrecomputeQueueStats } from './translate-commentary.js';
import { getBackfillQueueStats } from './backfill-queue.js';

const DEFAULT_WINDOW_MINUTES = 15;
const MIN_WINDOW_MINUTES = 1;
const MAX_WINDOW_MINUTES = 24 * 60;

export function normalizeWindowMinutes(value) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_WINDOW_MINUTES), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_WINDOW_MINUTES;
  return Math.max(MIN_WINDOW_MINUTES, Math.min(MAX_WINDOW_MINUTES, parsed));
}

function toFixedNumber(value, digits = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(digits));
}

function getFirstExecuteRow(result) {
  if (Array.isArray(result)) return result[0] ?? {};
  if (Array.isArray(result?.rows)) return result.rows[0] ?? {};
  return {};
}

export async function getLingoStatsSnapshot({
  quality = DEFAULT_QUALITY,
  windowMinutes = DEFAULT_WINDOW_MINUTES,
} = {}) {
  const normalizedQuality = normalizeQuality(quality, DEFAULT_QUALITY);
  const normalizedWindow = normalizeWindowMinutes(windowMinutes);
  const windowStart = new Date(Date.now() - normalizedWindow * 60 * 1000);

  const countsQuery = await db.execute(sql`
    select
      (select count(*)::int from commentary) as commentary_count,
      (
        select count(*)::int
        from commentary_translations ct
        where ct.quality = ${normalizedQuality}
      ) as translation_count,
      (
        select count(*)::int
        from lingo_translation_events lte
        where lte.quality = ${normalizedQuality}
          and lte.status = 'cache-hit'
      ) as cache_hit_count,
      (
        select count(*)::int
        from lingo_translation_events lte
        where lte.quality = ${normalizedQuality}
          and lte.status = 'translated'
      ) as generated_count,
      (
        select count(*)::int
        from lingo_translation_events lte
        where lte.quality = ${normalizedQuality}
          and lte.status = 'fallback-source'
      ) as fallback_count
  `);
  const countsRow = getFirstExecuteRow(countsQuery);

  const commentaryCount = Number(countsRow?.commentary_count ?? 0);
  const translationCount = Number(countsRow?.translation_count ?? 0);
  const cacheHitCount = Number(countsRow?.cache_hit_count ?? 0);
  const generatedCount = Number(countsRow?.generated_count ?? 0);
  const fallbackCount = Number(countsRow?.fallback_count ?? 0);

  const [latencyRow] = await db
    .select({
      avgLatency: sql`avg(${lingoTranslationEvents.latencyMs})`,
      p95Latency: sql`percentile_cont(0.95) within group (order by ${lingoTranslationEvents.latencyMs})`,
    })
    .from(lingoTranslationEvents)
    .where(
      and(
        eq(lingoTranslationEvents.quality, normalizedQuality),
        sql`${lingoTranslationEvents.latencyMs} is not null`
      )
    );

  const [windowLatencyRow] = await db
    .select({
      avgLatency: sql`avg(${lingoTranslationEvents.latencyMs})`,
      p95Latency: sql`percentile_cont(0.95) within group (order by ${lingoTranslationEvents.latencyMs})`,
    })
    .from(lingoTranslationEvents)
    .where(
      and(
        eq(lingoTranslationEvents.quality, normalizedQuality),
        gte(lingoTranslationEvents.createdAt, windowStart),
        sql`${lingoTranslationEvents.latencyMs} is not null`
      )
    );

  const [windowCountRow] = await db
    .select({
      translated: sql`count(*) filter (where ${lingoTranslationEvents.status} = 'translated')`,
      cacheHit: sql`count(*) filter (where ${lingoTranslationEvents.status} = 'cache-hit')`,
      fallback: sql`count(*) filter (where ${lingoTranslationEvents.status} = 'fallback-source')`,
    })
    .from(lingoTranslationEvents)
    .where(
      and(
        eq(lingoTranslationEvents.quality, normalizedQuality),
        gte(lingoTranslationEvents.createdAt, windowStart)
      )
    );

  const expectedTranslations = commentaryCount * TARGET_LOCALES.length;
  const coveragePercent =
    expectedTranslations > 0 ? Math.min(100, (translationCount / expectedTranslations) * 100) : 100;
  const cacheHitRatio =
    generatedCount + cacheHitCount > 0 ? (cacheHitCount / (generatedCount + cacheHitCount)) * 100 : 0;

  const totalWithFallback = generatedCount + cacheHitCount + fallbackCount;
  const fallbackRatePercent =
    totalWithFallback > 0 ? (fallbackCount / totalWithFallback) * 100 : 0;

  const windowTranslated = Number(windowCountRow?.translated ?? 0);
  const windowCacheHit = Number(windowCountRow?.cacheHit ?? 0);
  const windowFallback = Number(windowCountRow?.fallback ?? 0);
  const windowTotal = windowTranslated + windowCacheHit + windowFallback;
  const windowFallbackRatePercent = windowTotal > 0 ? (windowFallback / windowTotal) * 100 : 0;

  return {
    quality: normalizedQuality,
    windowMinutes: normalizedWindow,
    windowStartedAt: windowStart.toISOString(),
    availability: getLingoAvailability(),
    commentaryCount,
    translationCount,
    expectedTranslations,
    coveragePercent: toFixedNumber(coveragePercent),
    cacheHitRatio: toFixedNumber(cacheHitRatio),
    avgLatencyMs: toFixedNumber(latencyRow?.avgLatency ?? 0),
    p95LatencyMs: toFixedNumber(latencyRow?.p95Latency ?? 0),
    fallbackCount,
    fallbackRatePercent: toFixedNumber(fallbackRatePercent),
    window: {
      translated: windowTranslated,
      cacheHit: windowCacheHit,
      fallback: windowFallback,
      fallbackRatePercent: toFixedNumber(windowFallbackRatePercent),
      avgLatencyMs: toFixedNumber(windowLatencyRow?.avgLatency ?? 0),
      p95LatencyMs: toFixedNumber(windowLatencyRow?.p95Latency ?? 0),
    },
    targetLocales: TARGET_LOCALES,
    precomputeLocales: PRECOMPUTE_LOCALES,
    precomputeQueue: getPrecomputeQueueStats(),
    backfillQueue: getBackfillQueueStats(),
  };
}

export async function getLingoLocaleStats({
  quality = DEFAULT_QUALITY,
  windowMinutes = DEFAULT_WINDOW_MINUTES,
} = {}) {
  const normalizedQuality = normalizeQuality(quality, DEFAULT_QUALITY);
  const normalizedWindow = normalizeWindowMinutes(windowMinutes);
  const windowStart = new Date(Date.now() - normalizedWindow * 60 * 1000);

  const rows = await db
    .select({
      targetLocale: lingoTranslationEvents.targetLocale,
      translated: sql`count(*) filter (where ${lingoTranslationEvents.status} = 'translated')`,
      cacheHit: sql`count(*) filter (where ${lingoTranslationEvents.status} = 'cache-hit')`,
      fallback: sql`count(*) filter (where ${lingoTranslationEvents.status} = 'fallback-source')`,
      avgLatency: sql`avg(${lingoTranslationEvents.latencyMs})`,
      p95Latency: sql`percentile_cont(0.95) within group (order by ${lingoTranslationEvents.latencyMs})`,
    })
    .from(lingoTranslationEvents)
    .where(
      and(
        eq(lingoTranslationEvents.quality, normalizedQuality),
        gte(lingoTranslationEvents.createdAt, windowStart)
      )
    )
    .groupBy(lingoTranslationEvents.targetLocale);

  const localeStats = {};
  for (const locale of TARGET_LOCALES) {
    localeStats[locale] = {
      translated: 0,
      cacheHit: 0,
      fallback: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
    };
  }

  for (const row of rows) {
    const locale = String(row.targetLocale || '').trim().toLowerCase();
    if (!localeStats[locale]) {
      localeStats[locale] = {
        translated: 0,
        cacheHit: 0,
        fallback: 0,
        avgLatencyMs: 0,
        p95LatencyMs: 0,
      };
    }

    localeStats[locale] = {
      translated: Number(row.translated ?? 0),
      cacheHit: Number(row.cacheHit ?? 0),
      fallback: Number(row.fallback ?? 0),
      avgLatencyMs: toFixedNumber(row.avgLatency ?? 0),
      p95LatencyMs: toFixedNumber(row.p95Latency ?? 0),
    };
  }

  return {
    quality: normalizedQuality,
    windowMinutes: normalizedWindow,
    windowStartedAt: windowStart.toISOString(),
    locales: localeStats,
  };
}

export async function listRecentTranslationEvents({
  quality = DEFAULT_QUALITY,
  limit = 30,
} = {}) {
  const normalizedQuality = normalizeQuality(quality, DEFAULT_QUALITY);
  const safeLimit = Math.max(1, Math.min(200, Number.parseInt(String(limit), 10) || 30));

  return db
    .select()
    .from(lingoTranslationEvents)
    .where(eq(lingoTranslationEvents.quality, normalizedQuality))
    .orderBy(desc(lingoTranslationEvents.createdAt))
    .limit(safeLimit);
}
