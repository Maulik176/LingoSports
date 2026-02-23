import { WebSocket, WebSocketServer } from 'ws';
import { isArcjetFailOpen, wsArcject } from '../arcjet.js';
import {
  DEFAULT_QUALITY,
  DEFAULT_SOURCE_LOCALE,
  normalizeLocale,
  normalizeQuality,
  isSupportedLocale,
  QUALITY_VALUES,
  SUPPORTED_LOCALES,
} from '../lingo/locale-utils.js';
import { localizeCommentaryForLocale } from '../lingo/translate-commentary.js';

const matchSubscribers = new Map();

function firstHeaderValue(headerValue) {
  if (Array.isArray(headerValue)) return headerValue[0];
  return headerValue;
}

function getClientIp(req) {
  const xForwardedFor = firstHeaderValue(req.headers?.['x-forwarded-for']);
  const forwardedIp =
    typeof xForwardedFor === 'string' ? xForwardedFor.split(',')[0]?.trim() : undefined;

  return (
    forwardedIp ||
    firstHeaderValue(req.headers?.['x-real-ip']) ||
    firstHeaderValue(req.headers?.['cf-connecting-ip']) ||
    req.socket?.remoteAddress
  );
}

function buildArcjetRequest(req) {
  const headers = { ...(req.headers || {}) };
  const userAgent = firstHeaderValue(headers['user-agent']);
  if (!userAgent) {
    headers['user-agent'] = 'lingosports-ws/unknown-client';
  }
  const ip = getClientIp(req);
  const normalizedReq = { ...req, headers };
  return ip ? { ...normalizedReq, ip } : normalizedReq;
}

function subscribe(matchId, socket) {
  if (!matchSubscribers.has(matchId)) {
    matchSubscribers.set(matchId, new Set());
  }
  matchSubscribers.get(matchId).add(socket);
}

function unsubscribe(matchId, socket) {
  const subscribers = matchSubscribers.get(matchId);
  if (!subscribers) return;

  subscribers.delete(socket);

  if (subscribers.size === 0) {
    matchSubscribers.delete(matchId);
  }
}

function cleanUpSubscriptions(socket) {
  for (const matchId of socket.subscriptions.keys()) {
    unsubscribe(matchId, socket);
  }
  socket.subscriptions.clear();
}

function sendJson(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

function broadCastToAll(wss, payload) {
  for (const client of wss.clients) {
    if (!client) continue;
    sendJson(client, payload);
  }
}

function parseSubscribeMessage(message) {
  if (!message || message.type !== 'subscribe' || !Number.isInteger(message.matchId)) {
    return { ok: false, error: 'Invalid subscribe payload' };
  }

  const rawLocale = message.locale;
  if (rawLocale != null && !isSupportedLocale(rawLocale)) {
    return {
      ok: false,
      error: 'Unsupported locale',
      details: { supportedLocales: SUPPORTED_LOCALES },
    };
  }

  const rawQuality = message.quality;
  if (rawQuality != null && !QUALITY_VALUES.includes(String(rawQuality).toLowerCase())) {
    return {
      ok: false,
      error: 'Unsupported quality mode',
      details: { supportedQuality: QUALITY_VALUES },
    };
  }

  const locale = normalizeLocale(rawLocale, DEFAULT_SOURCE_LOCALE);
  const quality = normalizeQuality(rawQuality, DEFAULT_QUALITY);

  return {
    ok: true,
    matchId: message.matchId,
    locale,
    quality,
  };
}

function handleMessage(socket, data) {
  let message;
  try {
    message = JSON.parse(data.toString());
  } catch {
    sendJson(socket, { type: 'error', message: 'Invalid JSON' });
    return;
  }

  if (message?.type === 'subscribe') {
    const parsed = parseSubscribeMessage(message);
    if (!parsed.ok) {
      sendJson(socket, {
        type: 'error',
        message: parsed.error,
        details: parsed.details,
      });
      return;
    }

    subscribe(parsed.matchId, socket);
    socket.subscriptions.set(parsed.matchId, {
      locale: parsed.locale,
      quality: parsed.quality,
    });

    sendJson(socket, {
      type: 'subscribed',
      matchId: parsed.matchId,
      locale: parsed.locale,
      quality: parsed.quality,
    });
    return;
  }

  if (message?.type === 'unsubscribe' && Number.isInteger(message.matchId)) {
    unsubscribe(message.matchId, socket);
    socket.subscriptions.delete(message.matchId);
    sendJson(socket, { type: 'unsubscribed', matchId: message.matchId });
    return;
  }

  sendJson(socket, { type: 'error', message: 'Unsupported message type' });
}

async function broadcastLocalizedCommentary(matchId, commentaryEntry, defaultQuality) {
  const subscribers = matchSubscribers.get(matchId);
  if (!subscribers || subscribers.size === 0) return;

  const fanoutTasks = [];
  for (const client of subscribers) {
    if (client.readyState !== WebSocket.OPEN) continue;

    const preferences = client.subscriptions.get(matchId) || {};
    const locale = normalizeLocale(preferences.locale, DEFAULT_SOURCE_LOCALE);
    const quality = normalizeQuality(preferences.quality, defaultQuality || DEFAULT_QUALITY);

    const task = (async () => {
      const localized = await localizeCommentaryForLocale(commentaryEntry, {
        locale,
        quality,
        includeSource: false,
        allowOnDemand: false,
      });

      sendJson(client, {
        type: 'commentary',
        locale,
        quality,
        data: localized.payload,
      });

      const shouldQueueOnDemand =
        localized.payload.translation.status === 'fallback-source' &&
        locale !== commentaryEntry.sourceLocale;

      if (!shouldQueueOnDemand) return;

      const generated = await localizeCommentaryForLocale(commentaryEntry, {
        locale,
        quality,
        includeSource: false,
        allowOnDemand: true,
      });

      if (!generated.generated) return;
      if (client.readyState !== WebSocket.OPEN) return;

      sendJson(client, {
        type: 'commentary_translation_ready',
        commentaryId: commentaryEntry.id,
        locale,
        quality,
        data: generated.payload,
      });
    })();

    fanoutTasks.push(task);
  }

  await Promise.allSettled(fanoutTasks);
}

export function attachWebSocketServer(server) {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 1024 * 1024,
  });

  wss.on('connection', async (socket, req) => {
    if (wsArcject) {
      try {
        const decision = await wsArcject.protect(buildArcjetRequest(req));
        if (decision.isDenied()) {
          if (isArcjetFailOpen) {
            console.warn('Arcjet denied websocket connection but fail-open is enabled');
          } else {
          const code = decision.reason.isRateLimit() ? 4001 : 4003;
          const reason = decision.reason.isRateLimit() ? 'Rate Limit Exceeded' : 'Access Denied';
          socket.close(code, reason);
          return;
          }
        }
      } catch (error) {
        if (error?.message?.includes('requested `ip` characteristic but the `ip` value was empty')) {
          console.warn('Arcjet skipped websocket check due to missing client IP');
        } else if (isArcjetFailOpen) {
          console.warn('Arcjet websocket protection error bypassed by fail-open mode:', error?.message || error);
        } else {
          console.error('ws connection error', error);
          socket.close(1011, 'Server Security Error');
          return;
        }
      }
    }

    socket.subscriptions = new Map();

    sendJson(socket, { type: 'welcome' });

    socket.on('message', (data) => {
      handleMessage(socket, data);
    });

    socket.on('error', () => {
      socket.terminate();
    });

    socket.on('close', () => {
      cleanUpSubscriptions(socket);
    });
  });

  function broadCastMatchCreated(match) {
    broadCastToAll(wss, { type: 'match_created', data: match });
  }

  function broadCastMatchUpdated(match) {
    broadCastToAll(wss, { type: 'match_updated', data: match });
  }

  function broadCastCommentary(matchId, comment, options = {}) {
    void broadcastLocalizedCommentary(matchId, comment, options.quality);
  }

  function broadCastDataReset(metadata = {}) {
    const resetScope = metadata?.scope === 'commentary' ? 'commentary' : 'all';
    if (resetScope === 'all') {
      matchSubscribers.clear();
    }

    for (const client of wss.clients) {
      if (!client) continue;
      if (resetScope === 'all' && client.subscriptions instanceof Map) {
        client.subscriptions.clear();
      }
      sendJson(client, {
        type: 'data_reset',
        data: {
          ...metadata,
          scope: resetScope,
          at: new Date().toISOString(),
        },
      });
    }
  }

  return { broadCastMatchCreated, broadCastMatchUpdated, broadCastCommentary, broadCastDataReset };
}
