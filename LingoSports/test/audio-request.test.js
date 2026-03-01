import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSpeechRequestSchema,
  createVoiceAgentSessionSchema,
} from '../src/validation/audio.js';

test('speech request schema accepts hype request payload', () => {
  const parsed = createSpeechRequestSchema.safeParse({
    input: 'Goal! Stunning strike from outside the box.',
    locale: 'es',
    rate: 1.25,
    style: 'hype commentator',
  });

  assert.equal(parsed.success, true);
});

test('speech request schema rejects empty input', () => {
  const parsed = createSpeechRequestSchema.safeParse({
    input: '   ',
    locale: 'en',
  });

  assert.equal(parsed.success, false);
});

test('voice-agent session schema accepts SDP payload', () => {
  const parsed = createVoiceAgentSessionSchema.safeParse({
    offerSdp: 'v=0\no=- 46117331 2 IN IP4 127.0.0.1\ns=-\nt=0 0\nm=audio 9 UDP/TLS/RTP/SAVPF 111\n',
    locale: 'es',
    style: 'hype commentator',
  });

  assert.equal(parsed.success, true);
});
