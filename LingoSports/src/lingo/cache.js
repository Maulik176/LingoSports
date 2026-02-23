import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/db.js';
import {
  commentary,
  commentaryTranslations,
  lingoTranslationEvents,
} from '../db/schema.js';

export async function findCachedTranslation(commentaryId, targetLocale, quality) {
  const [row] = await db
    .select()
    .from(commentaryTranslations)
    .where(
      and(
        eq(commentaryTranslations.commentaryId, commentaryId),
        eq(commentaryTranslations.targetLocale, targetLocale),
        eq(commentaryTranslations.quality, quality)
      )
    )
    .limit(1);

  return row ?? null;
}

export async function listCachedTranslations(commentaryId, quality) {
  const whereClause = quality
    ? and(
        eq(commentaryTranslations.commentaryId, commentaryId),
        eq(commentaryTranslations.quality, quality)
      )
    : eq(commentaryTranslations.commentaryId, commentaryId);

  return db
    .select()
    .from(commentaryTranslations)
    .where(whereClause)
    .orderBy(desc(commentaryTranslations.createdAt));
}

export async function upsertTranslation({
  commentaryId,
  targetLocale,
  quality,
  translatedMessage,
  provider,
  latencyMs,
}) {
  const [row] = await db
    .insert(commentaryTranslations)
    .values({
      commentaryId,
      targetLocale,
      quality,
      translatedMessage,
      provider,
      latencyMs,
    })
    .onConflictDoUpdate({
      target: [
        commentaryTranslations.commentaryId,
        commentaryTranslations.targetLocale,
        commentaryTranslations.quality,
      ],
      set: {
        translatedMessage,
        provider,
        latencyMs,
        createdAt: sql`now()`,
      },
    })
    .returning();

  return row;
}

export async function recordTranslationEvent({
  commentaryId,
  sourceLocale,
  targetLocale,
  quality,
  status,
  latencyMs,
  fallbackReason,
  errorMessage,
}) {
  try {
    await db.insert(lingoTranslationEvents).values({
      commentaryId,
      sourceLocale,
      targetLocale,
      quality,
      status,
      latencyMs,
      fallbackReason,
      errorMessage,
    });
  } catch (error) {
    console.error('Failed to record translation event:', error?.message || error);
  }
}

export async function listMatchCommentaryRaw(matchId, limit) {
  return db
    .select()
    .from(commentary)
    .where(eq(commentary.matchId, matchId))
    .orderBy(desc(commentary.createdAt))
    .limit(limit);
}
