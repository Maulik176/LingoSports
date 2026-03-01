import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/db.js';
import { commentary, matches } from '../db/schema.js';
import { isDemoSessionActive } from '../demo/session-utils.js';
import { DEFAULT_QUALITY, DEFAULT_SOURCE_LOCALE, normalizeLocale, normalizeQuality } from '../lingo/locale-utils.js';
import { schedulePrecomputeCommentaryTranslations } from '../lingo/translate-commentary.js';

export const demoRouter = Router();

const START_SCHEMA = z.object({
  mode: z.enum(['judge', 'preview', 'dev']).optional(),
  quality: z.enum(['standard', 'fast']).optional(),
  locale: z.string().optional(),
});

const SPIKE_SCHEMA = z.object({
  count: z.coerce.number().int().min(1).max(40).optional(),
  quality: z.enum(['standard', 'fast']).optional(),
});

const parsedMatchDurationMinutes = Number.parseInt(
  process.env.SEED_MATCH_DURATION_MINUTES || '120',
  10
);
const DEFAULT_MATCH_DURATION_MINUTES =
  Number.isFinite(parsedMatchDurationMinutes) && parsedMatchDurationMinutes > 0
    ? parsedMatchDurationMinutes
    : 120;
const SEED_SCRIPT_PATH = fileURLToPath(new URL('../seed/seed.js', import.meta.url));
const DEMO_READY_DELAY_MS = 1500;

let latestSessionId = null;
let activeSeedProcess = null;
const demoSessions = new Map();

function isDemoStartEnabled() {
  const flag = String(process.env.V2_DEMO_START_ENABLED ?? '').trim().toLowerCase();
  if (flag === '1' || flag === 'true') return true;
  if (flag === '0' || flag === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

function isSpikeEnabled() {
  const flag = String(process.env.V2_ADMIN_DASHBOARD_ENABLED ?? '').trim().toLowerCase();
  if (flag === '1' || flag === 'true') return true;
  if (flag === '0' || flag === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

function resolveApiUrl(req) {
  const configuredApiUrl = String(process.env.API_URL ?? '').trim();
  if (configuredApiUrl) return configuredApiUrl;

  const host =
    String(req.get('x-forwarded-host') ?? '').trim() ||
    String(req.get('host') ?? '').trim();
  if (!host) return '';

  const protoHeader = String(req.get('x-forwarded-proto') ?? '').trim();
  const protocol = protoHeader.split(',')[0]?.trim() || req.protocol || 'http';
  return `${protocol}://${host}`;
}

function buildLiveWindow() {
  const now = new Date();
  const durationMs = DEFAULT_MATCH_DURATION_MINUTES * 60 * 1000;
  const startTime = new Date(now.getTime() - 5 * 60 * 1000);
  const endTime = new Date(startTime.getTime() + durationMs);
  return { startTime, endTime };
}

function currentSession() {
  if (!latestSessionId) return null;
  return demoSessions.get(latestSessionId) || null;
}

function setSessionState(sessionId, patch, app) {
  const session = demoSessions.get(sessionId);
  if (!session) return null;
  const next = { ...session, ...patch, updatedAt: new Date().toISOString() };
  demoSessions.set(sessionId, next);
  if (typeof app?.locals?.broadCastDemoStatus === 'function') {
    app.locals.broadCastDemoStatus(next);
  }
  return next;
}

async function resetDemoData(app) {
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

  if (typeof app?.locals?.broadCastDataReset === 'function') {
    app.locals.broadCastDataReset({ reason: 'demo_start', scope: 'commentary' });
  }
  if (typeof app?.locals?.broadCastMatchUpdated === 'function') {
    for (const match of updatedMatches) {
      app.locals.broadCastMatchUpdated(match);
    }
  }

  return {
    before: {
      matches: Number(before.matches_count || 0),
      commentary: Number(before.commentary_count || 0),
      commentaryTranslations: Number(before.translations_count || 0),
      lingoEvents: Number(before.lingo_events_count || 0),
    },
    matchesResetToZero: updatedMatches.length,
  };
}

function spawnSeedReplay({ apiUrl, quality, app, sessionId }) {
  const env = {
    ...process.env,
    API_URL: apiUrl,
    SEED_RESET_BEFORE_RUN: '0',
    SEED_TRANSLATION_QUALITY: normalizeQuality(quality, DEFAULT_QUALITY),
  };

  const child = spawn(process.execPath, [SEED_SCRIPT_PATH], {
    env,
    stdio: 'inherit',
  });
  activeSeedProcess = child;

  child.once('error', (error) => {
    activeSeedProcess = null;
    setSessionState(
      sessionId,
      {
        status: 'failed',
        error: error?.message || 'seed_start_failed',
      },
      app
    );
  });

  child.once('exit', async (code, signal) => {
    activeSeedProcess = null;
    try {
      if (code === 0) {
        const [{ count }] = await db
          .select({ count: sql`count(*)` })
          .from(matches)
          .where(eq(matches.status, 'live'));

        setSessionState(
          sessionId,
          {
            status: 'ready',
            socketReady: true,
            activeMatches: Number(count ?? 0),
            completedAt: new Date().toISOString(),
          },
          app
        );
        return;
      }

      setSessionState(
        sessionId,
        {
          status: 'failed',
          error: `seed_exit_code_${code ?? 'null'}_${signal ?? 'none'}`,
        },
        app
      );
    } catch (error) {
      console.error('Failed handling seed replay exit:', error?.message || error);
      setSessionState(
        sessionId,
        {
          status: 'failed',
          socketReady: false,
          error: 'seed_exit_handler_failed',
          completedAt: new Date().toISOString(),
        },
        app
      );
    }
  });
}

async function countActiveMatches() {
  const [{ count }] = await db
    .select({ count: sql`count(*)` })
    .from(matches)
    .where(eq(matches.status, 'live'));
  return Number(count ?? 0);
}

demoRouter.post('/start', async (req, res) => {
  if (!isDemoStartEnabled()) {
    return res.status(403).json({
      error: 'Demo start is disabled',
      details: 'Set V2_DEMO_START_ENABLED=1 to enable demo start.',
    });
  }

  const parsed = START_SCHEMA.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid payload',
      details: JSON.stringify(parsed.error),
    });
  }

  const current = currentSession();
  if (current && isDemoSessionActive(current.status)) {
    return res.status(202).json({
      data: {
        started: false,
        sessionId: current.sessionId,
        status: current.status,
        estimatedReadyMs: DEMO_READY_DELAY_MS,
      },
    });
  }

  if (activeSeedProcess && activeSeedProcess.exitCode === null) {
    return res.status(202).json({
      data: {
        started: false,
        sessionId: current?.sessionId || null,
        status: 'seeding',
        estimatedReadyMs: DEMO_READY_DELAY_MS,
      },
    });
  }

  const apiUrl = resolveApiUrl(req);
  if (!apiUrl) {
    return res.status(500).json({
      error: 'Unable to resolve API_URL for demo seeding',
    });
  }

  const normalizedQuality = normalizeQuality(parsed.data.quality, DEFAULT_QUALITY);
  const normalizedLocale = normalizeLocale(parsed.data.locale, DEFAULT_SOURCE_LOCALE);
  const mode = parsed.data.mode || 'judge';
  const sessionId = randomUUID();
  latestSessionId = sessionId;

  const startedAt = new Date().toISOString();
  const session = {
    sessionId,
    mode,
    quality: normalizedQuality,
    locale: normalizedLocale,
    status: 'starting',
    socketReady: false,
    activeMatches: 0,
    startedAt,
    updatedAt: startedAt,
  };
  demoSessions.set(sessionId, session);
  if (typeof req.app.locals?.broadCastDemoStatus === 'function') {
    req.app.locals.broadCastDemoStatus(session);
  }

  try {
    setSessionState(sessionId, { status: 'resetting' }, req.app);
    await resetDemoData(req.app);
    setSessionState(sessionId, { status: 'seeding' }, req.app);
    spawnSeedReplay({
      apiUrl,
      quality: normalizedQuality,
      app: req.app,
      sessionId,
    });

    return res.status(202).json({
      data: {
        started: true,
        sessionId,
        status: 'starting',
        estimatedReadyMs: DEMO_READY_DELAY_MS,
      },
    });
  } catch (error) {
    setSessionState(
      sessionId,
      {
        status: 'failed',
        error: error?.message || 'demo_start_failed',
      },
      req.app
    );
    console.error('Failed to start demo session:', error);
    const payload = { error: 'Failed to start demo session' };
    const details = error?.cause?.message ?? error?.message;
    if (process.env.NODE_ENV !== 'production') payload.details = details;
    return res.status(500).json(payload);
  }
});

demoRouter.get('/status', async (req, res) => {
  const sessionId = String(req.query?.sessionId ?? '').trim() || latestSessionId;
  if (!sessionId) {
    return res.status(200).json({
      data: {
        sessionId: null,
        status: 'idle',
        activeMatches: await countActiveMatches(),
        socketReady: false,
      },
    });
  }

  const session = demoSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({
      error: 'Demo session not found',
      details: `No session found for id ${sessionId}`,
    });
  }

  const activeMatches = await countActiveMatches();
  const socketReady = session.status === 'ready' || activeMatches > 0;

  return res.status(200).json({
    data: {
      ...session,
      activeMatches,
      socketReady,
    },
  });
});

demoRouter.post('/simulate-spike', async (req, res) => {
  if (!isSpikeEnabled()) {
    return res.status(403).json({
      error: 'Spike simulation is disabled',
      details: 'Set V2_ADMIN_DASHBOARD_ENABLED=1 to enable spike simulation.',
    });
  }

  const parsed = SPIKE_SCHEMA.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid payload',
      details: JSON.stringify(parsed.error),
    });
  }

  const count = parsed.data.count ?? 10;
  const quality = normalizeQuality(parsed.data.quality, DEFAULT_QUALITY);
  const [targetMatch] = await db
    .select()
    .from(matches)
    .where(and(eq(matches.status, 'live')))
    .orderBy(desc(matches.createdAt))
    .limit(1);

  if (!targetMatch) {
    return res.status(404).json({
      error: 'No live match available for spike simulation',
    });
  }

  try {
    const now = new Date();
    const events = [];
    for (let index = 0; index < count; index += 1) {
      const minute = 45 + index;
      const [row] = await db
        .insert(commentary)
        .values({
          matchId: targetMatch.id,
          minute,
          sequence: minute,
          period: '2H',
          eventType: 'update',
          actor: targetMatch.homeTeam,
          team: targetMatch.homeTeam,
          message: `Spike update ${index + 1}: pressure building in the final third.`,
          sourceLocale: DEFAULT_SOURCE_LOCALE,
          metadata: { spike: true, index: index + 1 },
          tags: ['spike', 'demo'],
        })
        .returning();
      events.push(row);
    }

    for (const event of events) {
      void schedulePrecomputeCommentaryTranslations(event, quality).catch(() => {});
      if (typeof req.app.locals?.broadCastCommentary === 'function') {
        req.app.locals.broadCastCommentary(event.matchId, event, { quality });
      }
    }

    return res.status(200).json({
      data: {
        simulated: true,
        inserted: events.length,
        matchId: targetMatch.id,
      },
    });
  } catch (error) {
    console.error('Failed to simulate spike events:', error);
    const payload = { error: 'Failed to simulate spike events' };
    const details = error?.cause?.message ?? error?.message;
    if (process.env.NODE_ENV !== 'production') payload.details = details;
    return res.status(500).json(payload);
  }
});
