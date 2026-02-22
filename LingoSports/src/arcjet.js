import 'dotenv/config';
import arcjet, { detectBot, shield, slidingWindow, tokenBucket } from '@arcjet/node';
import { isSpoofedBot } from '@arcjet/inspect';

const arcjetKey = process.env.ARCJET_KEY;
const configuredArcjetMode = process.env.ARCJET_MODE?.trim().toUpperCase();
const arcjetMode =
  configuredArcjetMode === 'LIVE' || configuredArcjetMode === 'DRY_RUN'
    ? configuredArcjetMode
    : process.env.ARCJET_ENV === 'development'
      ? 'DRY_RUN'
      : 'LIVE';

if (!arcjetKey) {
  throw new Error('ARCJET_KEY is missing');
}

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
        allow: ['CATEGORY:SEARCH_ENGINE','CATEGORY:PREVIEW'],
        
      }),
      slidingWindow({
        mode: arcjetMode,
        interval: '2s',
        max: 5,
      }),
    ],
  }) : null;

function getLogger(req) {
  return req.app?.locals?.logger ?? console;
}

export function securityMiddleware() {

    return async (req, res, next) => {
        if(!httpArcject) return next();

        try {
          const decision = await httpArcject.protect(req);
      
          if (decision.isDenied()) {
            if (decision.reason.isRateLimit()) {
              return res.status(429).json({ error: 'Too many requests' });
            }
            if (decision.reason.isBot()) {
              return res.status(403).json({ error: 'No bots allowed' });
            }
            return res.status(403).json({ error: 'Forbidden' });
          }
      
          if (decision.ip?.isHosting?.()) {
            return res.status(403).json({ error: 'Forbidden' });
          }
      
          if (Array.isArray(decision.results) && decision.results.some(isSpoofedBot)) {
            return res.status(403).json({ error: 'Forbidden' });
          }
      
          return next();
        } catch (error) {
          console.error('Arcjet protection failed:', error);
          return res.status(503).json({error: "Service Unavailable"});
        }

        // next();
    }
    
}
