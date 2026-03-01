if (process.env.APMINSIGHT_ENABLED === '1') {
  try {
    const { default: AgentAPI } = await import('apminsight');
    AgentAPI.config();
  } catch (error) {
    console.warn('APM Insight is enabled but package is unavailable:', error?.message);
  }
}

import express from 'express';
import http from 'http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchRouter } from './routes/matches.js';
import { commentaryRouter } from './routes/commentary.js';
import { lingoRouter } from './routes/lingo.js';
import { seedRouter } from './routes/seed.js';
import { demoRouter } from './routes/demo.js';
import { audioRouter } from './routes/audio.js';
import { attachWebSocketServer } from './ws/server.js';
import { securityMiddleware } from './arcjet.js';
import { preloadMatchesFromSeedData } from './seed/preload-matches.js';
import { getLingoStatsSnapshot } from './lingo/stats.js';
import { envBoolEnabled } from './utils/env.js';

const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || '0.0.0.0';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, './frontend');
const app = express();
const server = http.createServer(app);
const corsOrigins = new Set(
  String(
    process.env.CORS_ORIGINS ??
      'http://localhost:3000,http://127.0.0.1:3000'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

app.set('trust proxy', true);
app.use(express.json()); //middleware

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && corsOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
});

app.use(express.static(frontendDir));

app.get('/', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use(securityMiddleware());

app.use('/matches', matchRouter);
app.use('/matches/:id/commentary', commentaryRouter);
app.use('/lingo', lingoRouter);
app.use('/seed', seedRouter);
app.use('/demo', demoRouter);
app.use('/audio', audioRouter);

const {
  broadCastMatchCreated,
  broadCastMatchUpdated,
  broadCastCommentary,
  broadCastCommentaryTranslationReady,
  broadCastDataReset,
  broadCastDemoStatus,
  broadCastTranslationHealth,
} =
  attachWebSocketServer(server);
app.locals.broadCastMatchCreated = broadCastMatchCreated;
app.locals.broadCastMatchUpdated = broadCastMatchUpdated;
app.locals.broadCastCommentary = broadCastCommentary;
app.locals.broadCastCommentaryTranslationReady = broadCastCommentaryTranslationReady;
app.locals.broadCastDataReset = broadCastDataReset;
app.locals.broadCastDemoStatus = broadCastDemoStatus;
app.locals.broadCastTranslationHealth = broadCastTranslationHealth;

const translationHealthIntervalMs = Math.max(
  5000,
  Number.parseInt(process.env.V2_TRANSLATION_HEALTH_INTERVAL_MS || '15000', 10) || 15000
);
const isAdminDashboardEnabled = envBoolEnabled(process.env.V2_ADMIN_DASHBOARD_ENABLED, true);

if (isAdminDashboardEnabled) {
  setInterval(async () => {
    if (typeof app.locals.broadCastTranslationHealth !== 'function') return;
    try {
      const stats = await getLingoStatsSnapshot({
        quality: process.env.LINGO_TRANSLATION_QUALITY || 'standard',
        windowMinutes: Number.parseInt(process.env.V2_TRANSLATION_HEALTH_WINDOW_MIN || '15', 10) || 15,
      });

      app.locals.broadCastTranslationHealth({
        quality: stats.quality,
        availability: stats.availability,
        cacheHitRatio: stats.cacheHitRatio,
        coveragePercent: stats.coveragePercent,
        p95LatencyMs: stats.p95LatencyMs,
        fallbackRatePercent: stats.fallbackRatePercent,
        window: stats.window,
        precomputeQueue: stats.precomputeQueue,
      });
    } catch (error) {
      console.error('Failed to broadcast translation health snapshot:', error?.message || error);
    }
  }, translationHealthIntervalMs).unref();
}

try {
  const preloadResult = await preloadMatchesFromSeedData();
  console.log(
    `Preloaded matches: inserted=${preloadResult.inserted}, existing=${preloadResult.existing}, pruned=${preloadResult.pruned || 0}, resetToZero=${preloadResult.resetToZero || 0}, total=${preloadResult.totalSeedMatches}`
  );
} catch (error) {
  console.error('Failed to preload default matches:', error);
}

server.listen(PORT, HOST, () => {
  const baseUrl = HOST === '0.0.0.0' ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;
  console.log(`Server is running on ${baseUrl}`);
  console.log(`WebSocket Server is running on ${baseUrl.replace('http', 'ws')}/ws`);
});
