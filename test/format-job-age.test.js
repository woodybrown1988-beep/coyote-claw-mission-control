'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { formatJobAge } = require('../mission-control/server.js');

test('formatJobAge formats representative age ranges', () => {
  const renderedAt = 1_700_000_000_000;

  assert.equal(formatJobAge(renderedAt - 30 * 1000, renderedAt), '0m');
  assert.equal(formatJobAge(renderedAt - 12 * 60 * 1000, renderedAt), '12m');
  assert.equal(formatJobAge(renderedAt - 3 * 60 * 60 * 1000, renderedAt), '3h');
  assert.equal(formatJobAge(renderedAt - 9 * 24 * 60 * 60 * 1000, renderedAt), '9d');
});
