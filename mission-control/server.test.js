import test from 'node:test';
import assert from 'node:assert/strict';

import { formatJobAge } from './server.js';

test('formatJobAge returns minute-scale ages', () => {
  const renderedAt = Date.UTC(2026, 0, 1, 12, 0, 0);
  const createdAt = renderedAt - (15 * 60 * 1000);

  assert.equal(formatJobAge(createdAt, renderedAt), '15m');
});

test('formatJobAge returns hour-scale ages', () => {
  const renderedAt = Date.UTC(2026, 0, 1, 12, 0, 0);
  const createdAt = renderedAt - (3 * 60 * 60 * 1000);

  assert.equal(formatJobAge(createdAt, renderedAt), '3h');
});

test('formatJobAge returns day-scale ages', () => {
  const renderedAt = Date.UTC(2026, 0, 15, 12, 0, 0);
  const createdAt = renderedAt - (7 * 24 * 60 * 60 * 1000);

  assert.equal(formatJobAge(createdAt, renderedAt), '7d');
});

test('formatJobAge returns fallback for a missing timestamp', () => {
  const renderedAt = Date.UTC(2026, 0, 1, 12, 0, 0);

  assert.equal(formatJobAge(null, renderedAt), '-');
});

test('formatJobAge returns fallback for an invalid timestamp', () => {
  const renderedAt = Date.UTC(2026, 0, 1, 12, 0, 0);

  assert.equal(formatJobAge('not-a-timestamp', renderedAt), '-');
});
