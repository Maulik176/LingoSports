import { Router } from 'express';
import { normalizeLocale } from '../lingo/locale-utils.js';
import {
  createSpeechRequestSchema,
  createVoiceAgentSessionSchema,
} from '../validation/audio.js';

const OPENAI_SPEECH_ENDPOINT = 'https://api.openai.com/v1/audio/speech';
const OPENAI_REALTIME_CALLS_ENDPOINT = 'https://api.openai.com/v1/realtime/calls';
const DEFAULT_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const DEFAULT_VOICE = process.env.OPENAI_TTS_VOICE || 'marin';
const DEFAULT_VOICE_AGENT_MODEL = process.env.OPENAI_VOICE_AGENT_MODEL || 'gpt-realtime';
const DEFAULT_VOICE_AGENT_VOICE =
  process.env.OPENAI_VOICE_AGENT_VOICE || process.env.OPENAI_TTS_VOICE || 'alloy';
const REQUEST_TIMEOUT_MS = Math.max(
  3000,
  Number.parseInt(process.env.OPENAI_TTS_TIMEOUT_MS || '12000', 10) || 12000
);
const VOICE_AGENT_TIMEOUT_MS = Math.max(
  3000,
  Number.parseInt(process.env.OPENAI_VOICE_AGENT_TIMEOUT_MS || '15000', 10) || 15000
);

const HYPE_STYLE_INSTRUCTIONS = [
  'Speak as an energetic sports commentator with high excitement and sharp clarity.',
  'Use short punchy sentences, fast tempo, and rising intensity on key moments.',
  'Sound natural and human, not robotic. Keep pronunciation clean for player/team names.',
  'Do not imitate or reference any specific real person.',
].join(' ');

export const audioRouter = Router();

function isOpenAiTtsEnabled() {
  const raw = String(process.env.OPENAI_TTS_ENABLED ?? '0').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

function isOpenAiVoiceAgentEnabled() {
  const raw = String(process.env.OPENAI_VOICE_AGENT_ENABLED ?? '0').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

function resolveInstructions(style, locale) {
  const normalizedStyle = String(style || '').trim().toLowerCase();
  const localeHint = `Target language locale is ${locale}.`;
  if (normalizedStyle === 'hype' || normalizedStyle === 'hype commentator') {
    return `${HYPE_STYLE_INSTRUCTIONS} ${localeHint}`;
  }
  return `${process.env.OPENAI_TTS_INSTRUCTIONS || HYPE_STYLE_INSTRUCTIONS} ${localeHint}`;
}

function resolveVoiceAgentInstructions(style, locale) {
  const normalizedStyle = String(style || '').trim().toLowerCase();
  const baseInstructions = normalizedStyle === 'hype' || normalizedStyle === 'hype commentator'
    ? HYPE_STYLE_INSTRUCTIONS
    : (process.env.OPENAI_TTS_INSTRUCTIONS || HYPE_STYLE_INSTRUCTIONS);

  return [
    baseInstructions,
    `Target language locale is ${locale}.`,
    'Read only the latest user message.',
    'Do not add extra facts, names, or analysis.',
    'Keep it concise and vivid like live sports radio.',
    'Never imitate or reference real public personalities.',
  ].join(' ');
}

audioRouter.post('/speech', async (req, res) => {
  if (!isOpenAiTtsEnabled()) {
    return res.status(503).json({ error: 'OpenAI TTS is disabled' });
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return res.status(503).json({ error: 'Missing OPENAI_API_KEY' });
  }

  const parsed = createSpeechRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid speech request',
      details: JSON.stringify(parsed.error),
    });
  }

  const locale = normalizeLocale(parsed.data.locale, 'en');
  const voice = String(process.env.OPENAI_TTS_VOICE || DEFAULT_VOICE).trim() || DEFAULT_VOICE;
  const model = String(process.env.OPENAI_TTS_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const instructions = resolveInstructions(parsed.data.style, locale);

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(OPENAI_SPEECH_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        voice,
        input: parsed.data.input,
        instructions,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(502).json({
        error: 'OpenAI TTS request failed',
        details: text.slice(0, 600),
      });
    }

    const contentType = response.headers.get('content-type') || 'audio/mpeg';
    const audioBuffer = Buffer.from(await response.arrayBuffer());
    res.setHeader('content-type', contentType);
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-audio-provider', 'openai');
    return res.status(200).send(audioBuffer);
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'OpenAI TTS request timed out'
      : (error?.message || 'OpenAI TTS request failed');
    return res.status(502).json({ error: message });
  } finally {
    clearTimeout(timeout);
  }
});

audioRouter.post('/agent/session', async (req, res) => {
  if (!isOpenAiVoiceAgentEnabled()) {
    return res.status(503).json({ error: 'OpenAI voice agent is disabled' });
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return res.status(503).json({ error: 'Missing OPENAI_API_KEY' });
  }

  const parsed = createVoiceAgentSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid voice-agent session request',
      details: JSON.stringify(parsed.error),
    });
  }

  const locale = normalizeLocale(parsed.data.locale, 'en');
  const model = String(process.env.OPENAI_VOICE_AGENT_MODEL || DEFAULT_VOICE_AGENT_MODEL).trim()
    || DEFAULT_VOICE_AGENT_MODEL;
  const voice = String(process.env.OPENAI_VOICE_AGENT_VOICE || DEFAULT_VOICE_AGENT_VOICE).trim()
    || DEFAULT_VOICE_AGENT_VOICE;
  const instructions = resolveVoiceAgentInstructions(parsed.data.style, locale);

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, VOICE_AGENT_TIMEOUT_MS);

  try {
    const response = await fetch(OPENAI_REALTIME_CALLS_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'openai-beta': 'realtime=v1',
      },
      body: JSON.stringify({
        type: 'offer',
        sdp: parsed.data.offerSdp,
        session: {
          type: 'realtime',
          model,
          modalities: ['audio', 'text'],
          instructions,
          audio: {
            output: {
              voice,
            },
          },
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(502).json({
        error: 'OpenAI voice-agent session request failed',
        details: text.slice(0, 800),
      });
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    let answerSdp = '';
    let callId = null;
    let rawResponse = null;

    if (contentType.includes('application/json')) {
      const payload = await response.json();
      rawResponse = payload;
      callId = payload?.id || null;
      answerSdp =
        String(payload?.answer?.sdp || '').trim()
        || String(payload?.sdp || '').trim()
        || String(payload?.answer || '').trim();
    } else {
      answerSdp = String(await response.text()).trim();
    }

    if (!answerSdp) {
      return res.status(502).json({
        error: 'OpenAI voice-agent session response missing SDP answer',
        details: rawResponse ? JSON.stringify(rawResponse).slice(0, 800) : '',
      });
    }

    return res.status(200).json({
      data: {
        answerSdp,
        callId,
        model,
        voice,
        provider: 'openai-realtime',
      },
    });
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'OpenAI voice-agent request timed out'
      : (error?.message || 'OpenAI voice-agent request failed');
    return res.status(502).json({ error: message });
  } finally {
    clearTimeout(timeout);
  }
});
