'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { statusPillClass } = require('../mission-control/server.js');

test('statusPillClass maps escalated to refused styling', () => {
  assert.equal(statusPillClass('escalated'), 'p-refused');
});

test('statusPillClass preserves existing status mappings', () => {
  assert.equal(statusPillClass('failed'), 'p-refused');
  assert.equal(statusPillClass('done'), 'p-merged');
  assert.equal(statusPillClass('running'), 'p-build');
  assert.equal(statusPillClass('queued'), 'p-queued');
});

test('statusPillClass falls back to queued styling for unknown statuses', () => {
  assert.equal(statusPillClass('unknown-status'), 'p-queued');
  assert.equal(statusPillClass('preescalated'), 'p-queued');
  assert.equal(statusPillClass('escalated-later'), 'p-queued');
});
