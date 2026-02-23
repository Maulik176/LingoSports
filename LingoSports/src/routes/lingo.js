import { Router } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/db.js';
import {
  commentary,
  commentaryTranslations,
  lingoTranslationEvents,
} from '../db/schema.js';
import {
  DEFAULT_QUALITY,
  PRECOMPUTE_LOCALES,
  TARGET_LOCALES,
  normalizeQuality,
} from '../lingo/locale-utils.js';

export const lingoRouter = Router();

async function countQuery(query) {
  const [row] = await query;
  return Number(row?.count ?? 0);
}

lingoRouter.get('/stats', async (req, res) => {
  const quality = normalizeQuality(req.query?.quality, DEFAULT_QUALITY);

  try {
    const commentaryCount = await countQuery(
      db
        .select({ count: sql`count(*)` })
        .from(commentary)
    );

    const translationCount = await countQuery(
      db
        .select({ count: sql`count(*)` })
        .from(commentaryTranslations)
        .where(eq(commentaryTranslations.quality, quality))
    );

    const cacheHitCount = await countQuery(
      db
        .select({ count: sql`count(*)` })
        .from(lingoTranslationEvents)
        .where(
          and(
            eq(lingoTranslationEvents.quality, quality),
            eq(lingoTranslationEvents.status, 'cache-hit')
          )
        )
    );

    const generatedCount = await countQuery(
      db
        .select({ count: sql`count(*)` })
        .from(lingoTranslationEvents)
        .where(
          and(
            eq(lingoTranslationEvents.quality, quality),
            eq(lingoTranslationEvents.status, 'translated')
          )
        )
    );

    const fallbackCount = await countQuery(
      db
        .select({ count: sql`count(*)` })
        .from(lingoTranslationEvents)
        .where(
          and(
            eq(lingoTranslationEvents.quality, quality),
            eq(lingoTranslationEvents.status, 'fallback-source')
          )
        )
    );

    const [latencyRow] = await db
      .select({ avgLatency: sql`avg(${lingoTranslationEvents.latencyMs})` })
      .from(lingoTranslationEvents)
      .where(eq(lingoTranslationEvents.quality, quality));

    const expectedTranslations = commentaryCount * TARGET_LOCALES.length;
    const coveragePercent = expectedTranslations > 0
      ? Math.min(100, (translationCount / expectedTranslations) * 100)
      : 100;

    const cacheHitRatio = generatedCount + cacheHitCount > 0
      ? (cacheHitCount / (generatedCount + cacheHitCount)) * 100
      : 0;

    return res.status(200).json({
      data: {
        quality,
        commentaryCount,
        translationCount,
        expectedTranslations,
        coveragePercent: Number(coveragePercent.toFixed(2)),
        cacheHitRatio: Number(cacheHitRatio.toFixed(2)),
        avgLatencyMs: latencyRow?.avgLatency != null
          ? Number(Number(latencyRow.avgLatency).toFixed(2))
          : 0,
        fallbackCount,
        targetLocales: TARGET_LOCALES,
        precomputeLocales: PRECOMPUTE_LOCALES,
      },
    });
  } catch (error) {
    console.error('Failed to compute lingo stats:', error);
    const payload = { error: 'Failed to compute lingo stats' };
    const details = error?.cause?.message ?? error?.message;
    if (process.env.NODE_ENV !== 'production') payload.details = details;
    return res.status(500).json(payload);
  }
});
