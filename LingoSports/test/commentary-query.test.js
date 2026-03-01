import test from 'node:test';
import assert from 'node:assert/strict';
import { listCommentaryQuerySchema } from '../src/validation/commentary.js';

test('commentary query cursor requires beforeCreatedAt and beforeId together', () => {
  const missingBeforeId = listCommentaryQuerySchema.safeParse({
    beforeCreatedAt: '2026-03-01T12:00:00.000Z',
  });
  assert.equal(missingBeforeId.success, false);

  const missingBeforeCreatedAt = listCommentaryQuerySchema.safeParse({
    beforeId: '42',
  });
  assert.equal(missingBeforeCreatedAt.success, false);
});

test('commentary query cursor accepts valid paired values', () => {
  const parsed = listCommentaryQuerySchema.safeParse({
    limit: '25',
    locale: 'es',
    quality: 'fast',
    beforeCreatedAt: '2026-03-01T12:00:00.000Z',
    beforeId: '42',
    includeSource: '1',
  });

  assert.equal(parsed.success, true);
  assert.equal(parsed.data.limit, 25);
  assert.equal(parsed.data.beforeId, 42);
});
