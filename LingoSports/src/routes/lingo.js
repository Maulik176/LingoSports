import { Router } from 'express';
import { DEFAULT_QUALITY, normalizeQuality } from '../lingo/locale-utils.js';
import {
  getLingoLocaleStats,
  getLingoStatsSnapshot,
  listRecentTranslationEvents,
  normalizeWindowMinutes,
} from '../lingo/stats.js';

export const lingoRouter = Router();

function normalizeLimit(value, fallback = 30) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(200, parsed));
}

lingoRouter.get('/stats', async (req, res) => {
  const quality = normalizeQuality(req.query?.quality, DEFAULT_QUALITY);
  const windowMinutes = normalizeWindowMinutes(req.query?.windowMin);

  try {
    const stats = await getLingoStatsSnapshot({ quality, windowMinutes });
    return res.status(200).json({ data: stats });
  } catch (error) {
    console.error('Failed to compute lingo stats:', error);
    const payload = { error: 'Failed to compute lingo stats' };
    const details = error?.cause?.message ?? error?.message;
    if (process.env.NODE_ENV !== 'production') payload.details = details;
    return res.status(500).json(payload);
  }
});

lingoRouter.get('/stats/locales', async (req, res) => {
  const quality = normalizeQuality(req.query?.quality, DEFAULT_QUALITY);
  const windowMinutes = normalizeWindowMinutes(req.query?.windowMin);

  try {
    const stats = await getLingoLocaleStats({ quality, windowMinutes });
    return res.status(200).json({ data: stats });
  } catch (error) {
    console.error('Failed to compute locale lingo stats:', error);
    const payload = { error: 'Failed to compute locale lingo stats' };
    const details = error?.cause?.message ?? error?.message;
    if (process.env.NODE_ENV !== 'production') payload.details = details;
    return res.status(500).json(payload);
  }
});

lingoRouter.get('/events', async (req, res) => {
  const quality = normalizeQuality(req.query?.quality, DEFAULT_QUALITY);
  const limit = normalizeLimit(req.query?.limit, 30);

  try {
    const rows = await listRecentTranslationEvents({ quality, limit });
    return res.status(200).json({
      data: rows,
      meta: {
        quality,
        limit,
      },
    });
  } catch (error) {
    console.error('Failed to list lingo translation events:', error);
    const payload = { error: 'Failed to list lingo translation events' };
    const details = error?.cause?.message ?? error?.message;
    if (process.env.NODE_ENV !== 'production') payload.details = details;
    return res.status(500).json(payload);
  }
});
