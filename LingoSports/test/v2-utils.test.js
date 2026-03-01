import test from 'node:test';
import assert from 'node:assert/strict';
import { isDemoSessionActive } from '../src/demo/session-utils.js';
import { normalizeWindowMinutes } from '../src/lingo/stats.js';

test('isDemoSessionActive matches lifecycle states', () => {
  assert.equal(isDemoSessionActive('starting'), true);
  assert.equal(isDemoSessionActive('resetting'), true);
  assert.equal(isDemoSessionActive('seeding'), true);
  assert.equal(isDemoSessionActive('ready'), false);
  assert.equal(isDemoSessionActive('failed'), false);
});

test('normalizeWindowMinutes bounds and defaults', () => {
  assert.equal(normalizeWindowMinutes(undefined), 15);
  assert.equal(normalizeWindowMinutes('5'), 5);
  assert.equal(normalizeWindowMinutes('0'), 1);
  assert.equal(normalizeWindowMinutes('-8'), 1);
  assert.equal(normalizeWindowMinutes('99999'), 24 * 60);
  assert.equal(normalizeWindowMinutes('nope'), 15);
});

