import { Router } from 'express';
import { db } from '../db/db.js';
import { commentary } from '../db/schema.js';
import { createCommentarySchema, listCommentaryQuerySchema } from '../validation/commentary.js';
import { matchIdParamSchema } from '../validation/matches.js';
import {
  DEFAULT_QUALITY,
  DEFAULT_SOURCE_LOCALE,
  normalizeLocale,
  normalizeQuality,
} from '../lingo/locale-utils.js';
import {
  localizeCommentaryForLocale,
  localizeCommentaryInBulk,
  schedulePrecomputeCommentaryTranslations,
  resolveCommentarySourceLocale,
  getAvailableTranslations,
  buildGlobalFanView,
} from '../lingo/translate-commentary.js';
import { listMatchCommentaryRaw } from '../lingo/cache.js';
import { enqueueCommentaryTranslationsForRows } from '../lingo/backfill-queue.js';

export const commentaryRouter = Router({ mergeParams: true });
const MAX_LIMIT = 100;

function includeSourceFlag(value) {
  return String(value ?? '0') === '1';
}

function parseCursor(queryData) {
  const hasBeforeId = Number.isInteger(queryData?.beforeId);
  const hasBeforeCreatedAt =
    queryData?.beforeCreatedAt != null && String(queryData.beforeCreatedAt).trim() !== '';

  if (!hasBeforeCreatedAt && !hasBeforeId) {
    return { cursor: null, error: null };
  }
  if (hasBeforeCreatedAt && !hasBeforeId) {
    return { cursor: null, error: 'Missing beforeId cursor value' };
  }
  if (!hasBeforeCreatedAt && hasBeforeId) {
    return { cursor: null, error: 'Missing beforeCreatedAt cursor value' };
  }

  const beforeCreatedAt = new Date(String(queryData.beforeCreatedAt || ''));
  if (Number.isNaN(beforeCreatedAt.getTime())) {
    return {
      cursor: null,
      error: 'Invalid beforeCreatedAt cursor value',
    };
  }

  return {
    cursor: {
      beforeCreatedAt,
      beforeId: queryData.beforeId,
    },
    error: null,
  };
}

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
  const locale = normalizeLocale(parsedQuery.data.locale, DEFAULT_SOURCE_LOCALE);
  const quality = normalizeQuality(parsedQuery.data.quality, DEFAULT_QUALITY);
  const includeSource = includeSourceFlag(parsedQuery.data.includeSource);
  const parsedCursor = parseCursor(parsedQuery.data);
  if (parsedCursor.error) {
    return res.status(400).json({
      error: parsedCursor.error,
    });
  }

  try {
    const { rows, hasMore, nextCursor } = await listMatchCommentaryRaw(
      parsedParams.data.id,
      limit,
      parsedCursor.cursor
    );
    const localized = await localizeCommentaryInBulk(rows, {
      locale,
      quality,
      includeSource,
      allowOnDemand: false,
    });

    const missingRows = rows.filter((row, index) => {
      const localizedEntry = localized[index];
      if (!localizedEntry) return false;
      if (locale === row.sourceLocale) return false;
      return String(localizedEntry.translation?.status || '').trim().toLowerCase() === 'fallback-source';
    });

    const responsePayload = {
      data: localized,
      meta: {
        locale,
        quality,
        includeSource,
        hasMore,
        nextCursor: nextCursor
          ? {
              beforeCreatedAt: nextCursor.beforeCreatedAt.toISOString(),
              beforeId: nextCursor.beforeId,
            }
          : null,
      },
    };

    res.status(200).json(responsePayload);

    if (missingRows.length > 0) {
      const broadCastCommentaryTranslationReady = res.app.locals.broadCastCommentaryTranslationReady;
      setImmediate(() => {
        enqueueCommentaryTranslationsForRows(missingRows, {
          matchId: parsedParams.data.id,
          locale,
          quality,
          onResolved: (payload, metadata) => {
            if (typeof broadCastCommentaryTranslationReady === 'function') {
              broadCastCommentaryTranslationReady(metadata.matchId, payload, {
                locale: metadata.locale,
                quality: metadata.quality,
              });
            }
          },
        });
      });
    }
    return;
  } catch (error) {
    console.error('Failed to list commentary:', error);
    const payload = { error: 'Failed to list commentary' };
    const details = error?.cause?.message ?? error?.message;
    if (process.env.NODE_ENV !== 'production') payload.details = details;
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

  const payload = parsedBody.data;
  const requestedQuality = normalizeQuality(payload.quality, DEFAULT_QUALITY);
  const shouldPrecompute =
    payload.precompute ?? process.env.LINGO_PRECOMPUTE_ON_INGEST !== '0';
  const includeGlobalFanView = payload.includeGlobalFanView === true;

  try {
    const sourceLocale = await resolveCommentarySourceLocale({
      message: payload.message,
      sourceLocale: payload.sourceLocale,
    });

    const [event] = await db
      .insert(commentary)
      .values({
        matchId: parsedParams.data.id,
        minute: payload.minute,
        sequence: payload.sequence,
        period: payload.period,
        eventType: payload.eventType,
        actor: payload.actor,
        team: payload.team,
        message: payload.message,
        metadata: payload.metadata,
        tags: payload.tags,
        sourceLocale,
      })
      .returning();

    if (shouldPrecompute) {
      void schedulePrecomputeCommentaryTranslations(event, requestedQuality).catch((error) => {
        console.error('Failed to precompute commentary translations:', {
          commentaryId: event.id,
          quality: requestedQuality,
          error: error?.message || error,
        });
      });
    }

    try {
      if (res.app.locals.broadCastCommentary) {
        res.app.locals.broadCastCommentary(event.matchId, event, {
          quality: requestedQuality,
        });
      }
    } catch (broadcastError) {
      console.error('Failed to broadcast commentary event', {
        matchId: event.matchId,
        event,
        error: broadcastError,
      });
    }

    const localizedForRequest = await localizeCommentaryForLocale(event, {
      locale: sourceLocale,
      quality: requestedQuality,
      includeSource: true,
      allowOnDemand: false,
    });

    const translations = await getAvailableTranslations(event.id, requestedQuality);
    const globalFanView = includeGlobalFanView
      ? await buildGlobalFanView(event, requestedQuality)
      : undefined;

    return res.status(201).json({
      data: localizedForRequest.payload,
      translations,
      ...(includeGlobalFanView ? { globalFanView } : {}),
      meta: {
        sourceLocale,
        quality: requestedQuality,
        precomputeQueued: shouldPrecompute,
      },
    });
  } catch (error) {
    console.error('Failed to create commentary:', error);
    const payload = { error: 'Failed to create commentary' };
    const details = error?.cause?.message ?? error?.message;
    if (process.env.NODE_ENV !== 'production') payload.details = details;
    return res.status(500).json(payload);
  }
});
