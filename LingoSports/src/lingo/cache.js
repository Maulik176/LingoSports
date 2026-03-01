import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
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

export async function listMatchCommentaryRaw(matchId, limit, cursor = null) {
  const safeLimit = Math.max(1, Math.min(100, Number.parseInt(String(limit), 10) || 100));
  const hasCursor = cursor
    && cursor.beforeCreatedAt instanceof Date
    && !Number.isNaN(cursor.beforeCreatedAt.getTime())
    && Number.isInteger(cursor.beforeId);

  let whereClause = eq(commentary.matchId, matchId);
  if (hasCursor) {
    whereClause = and(
      whereClause,
      or(
        lt(commentary.createdAt, cursor.beforeCreatedAt),
        and(
          eq(commentary.createdAt, cursor.beforeCreatedAt),
          lt(commentary.id, cursor.beforeId)
        )
      )
    );
  }

  const rows = await db
    .select()
    .from(commentary)
    .where(whereClause)
    .orderBy(desc(commentary.createdAt), desc(commentary.id))
    .limit(safeLimit + 1);

  const hasMore = rows.length > safeLimit;
  const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;
  const lastRow = pageRows[pageRows.length - 1] || null;
  const nextCursor = hasMore && lastRow
    ? {
        beforeCreatedAt: lastRow.createdAt,
        beforeId: lastRow.id,
      }
    : null;

  return {
    rows: pageRows,
    hasMore,
    nextCursor,
  };
}
