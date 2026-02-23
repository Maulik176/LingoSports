import 'dotenv/config';
import arcjet, { detectBot, shield, slidingWindow } from '@arcjet/node';
import { isSpoofedBot } from '@arcjet/inspect';

const arcjetKey = process.env.ARCJET_KEY;
const configuredArcjetMode = process.env.ARCJET_MODE?.trim().toUpperCase();
const arcjetMode =
  configuredArcjetMode === 'LIVE' || configuredArcjetMode === 'DRY_RUN'
    ? configuredArcjetMode
    : process.env.ARCJET_ENV === 'development'
      ? 'DRY_RUN'
      : 'LIVE';
const configuredFailOpen = process.env.ARCJET_FAIL_OPEN?.trim();
export const isArcjetFailOpen =
  configuredFailOpen == null ? arcjetMode === 'DRY_RUN' : configuredFailOpen !== '0';

export const httpArcject = arcjetKey ? arcjet({
  key: arcjetKey,
  rules: [
    shield({ mode: arcjetMode }),
    detectBot({
      mode: arcjetMode,
      allow: ['CATEGORY:SEARCH_ENGINE','CATEGORY:PREVIEW'],
    }),
    slidingWindow({
      mode: arcjetMode,
      interval: '10s',
      max: 50,
    }),
  ],
}): null;
export const wsArcject = arcjetKey ? arcjet({
  key: arcjetKey,
  rules: [
    shield({ mode: arcjetMode }),
    detectBot({
      mode: arcjetMode,
      allow: ['CATEGORY:SEARCH_ENGINE', 'CATEGORY:PREVIEW'],
    }),
    slidingWindow({
      mode: arcjetMode,
      interval: '2s',
      max: 5,
    }),
  ],
}) : null;

function firstHeaderValue(headerValue) {
  if (Array.isArray(headerValue)) return headerValue[0];
  return headerValue;
}

function getClientIp(req) {
  const xForwardedFor = firstHeaderValue(req.headers?.['x-forwarded-for']);
  const forwardedIp = typeof xForwardedFor === 'string'
    ? xForwardedFor.split(',')[0]?.trim()
    : undefined;

  return (
    req.ip ||
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
    headers['user-agent'] = 'lingosports-http/unknown-client';
  }
  const ip = getClientIp(req);
  const normalizedReq = { ...req, headers };
  return ip ? { ...normalizedReq, ip } : normalizedReq;
}

export function securityMiddleware() {
  return async (req, res, next) => {
    if (!httpArcject) return next();

    try {
      const decision = await httpArcject.protect(buildArcjetRequest(req));

      if (decision.isDenied()) {
        if (isArcjetFailOpen) {
          console.warn('Arcjet denied HTTP request but fail-open is enabled', {
            path: req.path,
            method: req.method,
          });
          return next();
        }
        if (decision.reason.isRateLimit()) {
          return res.status(429).json({ error: 'Too many requests' });
        }
        if (decision.reason.isBot()) {
          return res.status(403).json({ error: 'No bots allowed' });
        }
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (decision.ip?.isHosting?.()) {
        if (isArcjetFailOpen) {
          console.warn('Arcjet hosting-ip block bypassed by fail-open mode', {
            path: req.path,
            method: req.method,
          });
          return next();
        }
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (Array.isArray(decision.results) && decision.results.some(isSpoofedBot)) {
        if (isArcjetFailOpen) {
          console.warn('Arcjet spoofed-bot block bypassed by fail-open mode', {
            path: req.path,
            method: req.method,
          });
          return next();
        }
        return res.status(403).json({ error: 'Forbidden' });
      }

      return next();
    } catch (error) {
      if (error?.message?.includes('requested `ip` characteristic but the `ip` value was empty')) {
        console.warn('Arcjet skipped request due to missing client IP');
        return next();
      }
      if (isArcjetFailOpen) {
        console.warn('Arcjet protection error bypassed by fail-open mode:', error?.message || error);
        return next();
      }
      console.error('Arcjet protection failed:', error);
      return res.status(503).json({ error: 'Service Unavailable' });
    }
  };
}
