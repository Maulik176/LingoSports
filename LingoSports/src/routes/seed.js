import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/db.js';
import { matches } from '../db/schema.js';

export const seedRouter = Router();
const DEFAULT_MATCH_DURATION_MINUTES = Number.parseInt(
  process.env.SEED_MATCH_DURATION_MINUTES || '120',
  10
);

function isSeedResetEnabled() {
  const flag = String(process.env.SEED_RESET_ENABLED ?? '').trim().toLowerCase();
  if (flag === '1' || flag === 'true') return true;
  if (flag === '0' || flag === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

function buildLiveWindow() {
  const now = new Date();
  const durationMs = DEFAULT_MATCH_DURATION_MINUTES * 60 * 1000;
  const startTime = new Date(now.getTime() - 5 * 60 * 1000);
  const endTime = new Date(startTime.getTime() + durationMs);
  return { startTime, endTime };
}

seedRouter.post('/reset', async (req, res) => {
  if (!isSeedResetEnabled()) {
    return res.status(403).json({
      error: 'Seed reset endpoint is disabled',
      details: 'Set SEED_RESET_ENABLED=1 to enable this endpoint.',
    });
  }

  try {
    const countsQuery = await db.execute(sql`
      select
        (select count(*)::int from matches) as matches_count,
        (select count(*)::int from commentary) as commentary_count,
        (select count(*)::int from commentary_translations) as translations_count,
        (select count(*)::int from lingo_translation_events) as lingo_events_count
    `);
    const before = countsQuery.rows?.[0] ?? {};

    const { startTime, endTime } = buildLiveWindow();

    const updatedMatches = await db.transaction(async (tx) => {
      await tx.execute(sql`
        truncate table
          lingo_translation_events,
          commentary_translations,
          commentary
        restart identity cascade
      `);

      return tx
        .update(matches)
        .set({
          homeScore: 0,
          awayScore: 0,
          status: 'live',
          startTime,
          endTime,
        })
        .returning();
    });

    try {
      if (typeof res.app.locals?.broadCastDataReset === 'function') {
        res.app.locals.broadCastDataReset({ reason: 'seed_reset', scope: 'commentary' });
      }
      if (typeof res.app.locals?.broadCastMatchUpdated === 'function') {
        for (const match of updatedMatches) {
          res.app.locals.broadCastMatchUpdated(match);
        }
      }
    } catch (broadcastError) {
      console.error('Failed to broadcast data reset event:', broadcastError);
    }

    return res.status(200).json({
      data: {
        reset: true,
        before: {
          matches: Number(before.matches_count || 0),
          commentary: Number(before.commentary_count || 0),
          commentaryTranslations: Number(before.translations_count || 0),
          lingoEvents: Number(before.lingo_events_count || 0),
        },
        matchesResetToZero: updatedMatches.length,
      },
    });
  } catch (error) {
    console.error('Failed to reset seed data:', error);
    const payload = { error: 'Failed to reset seed data' };
    const details = error?.cause?.message ?? error?.message;
    if (process.env.NODE_ENV !== 'production') payload.details = details;
    return res.status(500).json(payload);
  }
});
