'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { eventTone, isRefusedEvent } = require('../mission-control/server.js');

test('eventTone classifies accepted test runs and merged notes as ok', () => {
  assert.equal(eventTone({ kind: 'test_run', detail: '{"verdict":"accept","passCount":12}' }), 'ok');
  assert.equal(eventTone({ kind: 'note', detail: '{"merged":true,"sha":"abc"}' }), 'ok');
  assert.equal(eventTone({ kind: 'note', detail: 'plain note detail' }), 'info');
  assert.equal(eventTone({ kind: 'test_run', detail: '{"verdict":"reject"}' }), 'bad');
  assert.equal(isRefusedEvent({ kind: 'test_run', detail: '{"verdict":"accept","passCount":12}' }), false);
  assert.equal(isRefusedEvent({ kind: 'note', detail: '{"merged":true,"sha":"abc"}' }), false);
});

test('eventTone classifies security events as bad without treating them as refused', () => {
  assert.equal(eventTone({ kind: 'security', detail: '{"flagged":true,"regateHeadMoved":true,"pinned":"a","live":"b"}' }), 'bad');
  assert.equal(eventTone({ kind: 'security', detail: '{"flagged":true,"targetRefused":true,"target":"x/y"}' }), 'bad');
  assert.equal(eventTone({ kind: 'security' }), 'bad');
  assert.equal(isRefusedEvent({ kind: 'security', detail: '{"flagged":true}' }), false);
});

test('eventTone preserves fallback behavior around accepted event branches', () => {
  assert.equal(eventTone({ kind: 'test_run', detail: '{"passCount":12}' }), 'info');
  assert.equal(eventTone({ kind: 'note', detail: '{"sha":"abc"}' }), 'info');
  assert.notEqual(eventTone({ kind: 'test_run', detail: '{"verdict":"accept","passCount":12}' }), 'info');
  assert.notEqual(eventTone({ kind: 'note', detail: '{"merged":true,"sha":"abc"}' }), 'info');
});
