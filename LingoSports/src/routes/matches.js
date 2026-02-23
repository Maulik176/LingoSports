import { Router } from 'express';
import { db } from '../db/db.js';
import { matches } from '../db/schema.js';
import {
  createMatchSchema,
  listMatchesQuerySchema,
  matchIdParamSchema,
  updateScoreSchema,
} from '../validation/matches.js';
import { getMatchStatus } from '../utils/match-status.js';
import { desc, eq } from 'drizzle-orm';


export const matchRouter = Router();
const MAX_LIMIT = 100;

matchRouter.get('/', async (req, res) => {
  const parsed = listMatchesQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid Payload',
      details: JSON.stringify(parsed.error),
    });
  }

  const limit = Math.min(parsed.data.limit ?? 50, MAX_LIMIT);

  try {
    const data = await db
      .select()
      .from(matches)
      .orderBy(desc(matches.createdAt))
      .limit(limit);
    return res.json({ data });
  } catch (error) {
    console.error('Failed to list matches:', error);
    const payload = { error: 'Failed to list matches' };
    const details = error?.cause?.message ?? error?.message;
    if (process.env.NODE_ENV !== 'production') payload.details = details;
    return res.status(500).json(payload);
  }
});

matchRouter.post('/', async (req, res) => {
  const parsed = createMatchSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid Payload',
      details: JSON.stringify(parsed.error),
    });
  }

  const { startTime, endTime, homeScore, awayScore } = parsed.data;

  try {
    const [event] = await db
      .insert(matches)
      .values({
        ...parsed.data,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        homeScore: homeScore ?? 0,
        awayScore: awayScore ?? 0,
        status: getMatchStatus(startTime, endTime),
      })
      .returning();

    try {
      if (res.app.locals.broadCastMatchCreated) {
        res.app.locals.broadCastMatchCreated(event);
      }
    } catch (broadcastError) {
      const logError =
        typeof res.app.locals?.logger?.error === 'function'
          ? res.app.locals.logger.error.bind(res.app.locals.logger)
          : console.error;
      logError('Failed to broadcast match creation:', broadcastError);
    }

    return res.status(201).json({ data: event });
  } catch (error) {
    console.error('Failed to create match:', error);
    const payload = { error: 'Failed to create match' };
    const details = error?.cause?.message ?? error?.message;
    if (process.env.NODE_ENV !== 'production') payload.details = details;
    return res.status(500).json(payload);
  }
});

matchRouter.patch('/:id/score', async (req, res) => {
  const parsedParams = matchIdParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(400).json({
      error: 'Invalid match id',
      details: JSON.stringify(parsedParams.error),
    });
  }

  const parsedBody = updateScoreSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: 'Invalid payload',
      details: JSON.stringify(parsedBody.error),
    });
  }

  try {
    const [event] = await db
      .update(matches)
      .set({
        homeScore: parsedBody.data.homeScore,
        awayScore: parsedBody.data.awayScore,
      })
      .where(eq(matches.id, parsedParams.data.id))
      .returning();

    if (!event) {
      return res.status(404).json({ error: 'Match not found' });
    }

    try {
      if (res.app.locals.broadCastMatchUpdated) {
        res.app.locals.broadCastMatchUpdated(event);
      }
    } catch (broadcastError) {
      const logError =
        typeof res.app.locals?.logger?.error === 'function'
          ? res.app.locals.logger.error.bind(res.app.locals.logger)
          : console.error;
      logError('Failed to broadcast score update:', broadcastError);
    }

    return res.status(200).json({ data: event });
  } catch (error) {
    console.error('Failed to update score:', error);
    const payload = { error: 'Failed to update score' };
    const details = error?.cause?.message ?? error?.message;
    if (process.env.NODE_ENV !== 'production') payload.details = details;
    return res.status(500).json(payload);
  }
});
