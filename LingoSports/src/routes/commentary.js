import { Router } from 'express';
import { db } from '../db/db.js';
import { commentary } from '../db/schema.js';
import { createCommentarySchema, listCommentaryQuerySchema } from '../validation/commentary.js';
import { matchIdParamSchema } from '../validation/matches.js';
import { desc, eq } from 'drizzle-orm';

export const commentaryRouter = Router({ mergeParams: true });
const MAX_LIMIT = 100;

commentaryRouter.get('/', async (req, res) => {
  const parsedParams = matchIdParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(400).json({
      error: 'Invalid match id',
      details: JSON.stringify(parsedParams.error),
    });
  }

  const parsedQuery = listCommentaryQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({
      error: 'Invalid query',
      details: JSON.stringify(parsedQuery.error),
    });
  }

  const limit = Math.min(parsedQuery.data.limit ?? 100, MAX_LIMIT);

  try {
    const data = await db
      .select()
      .from(commentary)
      .where(eq(commentary.matchId, parsedParams.data.id))
      .orderBy(desc(commentary.createdAt))
      .limit(limit);

    return res.status(200).json({ data });
  } catch (error) {
    console.error('Failed to list commentary:', error);
    const payload = { error: 'Failed to list commentary' };
    if (process.env.NODE_ENV !== 'production') payload.details = error?.message;
    return res.status(500).json(payload);
  }
});

commentaryRouter.post('/', async (req, res) => {

  const parsedParams = matchIdParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(400).json({
      error: 'Invalid match id',
      details: JSON.stringify(parsedParams.error),
    });
  }

  const parsedBody = createCommentarySchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: 'Invalid payload',
      details: JSON.stringify(parsedBody.error),
    });
  }

  try {
    const [event] = await db
      .insert(commentary)
      .values({
        matchId: parsedParams.data.id,
        ...parsedBody.data,
      })
      .returning();

    try {
      if (res.app.locals.broadCastCommentary) {
        res.app.locals.broadCastCommentary(event.matchId, event);
      }
    } catch (broadcastError) {
      console.error('Failed to broadcast commentary event', {
        matchId: event.matchId,
        event,
        error: broadcastError,
      });
    }

    return res.status(201).json({ data: event });
  } catch (error) {
    console.error('Failed to create commentary:', error);
    const payload = { error: 'Failed to create commentary' };
    if (process.env.NODE_ENV !== 'production') payload.details = error?.message;
    return res.status(500).json(payload);
  }
});
