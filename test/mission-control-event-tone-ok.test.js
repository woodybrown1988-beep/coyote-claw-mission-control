'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { eventTone, isRefusedEvent } = require('../mission-control/server.js');

test('eventTone classifies accepted test runs and merged notes as ok', () => {
  assert.equal(eventTone({ kind: 'test_run', detail: '{"verdict":"accept","passCount":12}' }), 'ok');
  assert.equal(eventTone({ kind: 'note', detail: '{"merged":true,"sha":"abc"}' }), 'ok');
  assert.equal(eventTone({ kind: 'test_run', detail: '{"verdict":"reject"}' }), 'bad');
  assert.equal(isRefusedEvent({ kind: 'test_run', detail: '{"verdict":"accept","passCount":12}' }), false);
  assert.equal(isRefusedEvent({ kind: 'note', detail: '{"merged":true,"sha":"abc"}' }), false);
});

test('eventTone preserves fallback behavior around accepted event branches', () => {
  assert.equal(eventTone({ kind: 'test_run', detail: '{"passCount":12}' }), 'info');
  assert.equal(eventTone({ kind: 'note', detail: '{"sha":"abc"}' }), 'info');
  assert.notEqual(eventTone({ kind: 'test_run', detail: '{"verdict":"accept","passCount":12}' }), 'info');
  assert.notEqual(eventTone({ kind: 'note', detail: '{"merged":true,"sha":"abc"}' }), 'info');
});
