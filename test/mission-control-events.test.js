'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { eventTone, isRefusedEvent, summarizeDetail } = require('../mission-control/server.js');

test('mission control event helpers are exported', () => {
  assert.equal(typeof eventTone, 'function');
  assert.equal(typeof isRefusedEvent, 'function');
  assert.equal(typeof summarizeDetail, 'function');
});

test('eventTone classifies base-form decisions and event kinds', () => {
  assert.equal(eventTone({ kind: 'gate_decision', gate: 'pr', decision: 'approve' }), 'ok');
  assert.equal(eventTone({ kind: 'gate_decision', decision: 'reject' }), 'bad');

  for (const kind of ['merged', 'passed', 'accepted', 'done']) {
    assert.equal(eventTone({ kind }), 'ok');
  }

  for (const kind of ['refused', 'failed', 'escalated']) {
    assert.equal(eventTone({ kind }), 'bad');
  }

  assert.equal(eventTone({ kind: 'correct' }), 'info');
  assert.equal(eventTone({ kind: 'neutral' }), 'info');
});

test('isRefusedEvent classifies rejected gate decisions precisely', () => {
  assert.equal(isRefusedEvent({ kind: 'gate_decision', decision: 'reject' }), true);
  assert.equal(isRefusedEvent({ kind: 'gate_decision', decision: 'approve' }), false);
});

test('summarizeDetail returns kind-specific one-line summaries', () => {
  const testRun = summarizeDetail({ kind: 'test_run', detail: '{"verdict":"accept","passCount":4}' });
  assert.match(testRun, /accept/i);
  assert.match(testRun, /\b4\b/);
  assert.doesNotMatch(testRun, /omitted/i);
  assert.doesNotMatch(testRun, /\n/);

  const gate = summarizeDetail({ kind: 'gate_decision', gate: 'pr', decision: 'approve', detail: '{"reason":"checks passed"}' });
  assert.match(gate, /pr/i);
  assert.match(gate, /approve/i);
  assert.doesNotMatch(gate, /omitted/i);

  const pr = summarizeDetail({ kind: 'pr_opened', detail: '{"number":123,"title":"Add event helpers","branch":"main"}' });
  assert.match(pr, /123/);
  assert.match(pr, /Add event helpers/);
  assert.doesNotMatch(pr, /omitted/i);

  const build = summarizeDetail({ kind: 'build_submitted', detail: '{"buildId":"b-7","branch":"main","sha":"abc123"}' });
  assert.match(build, /b-7/);
  assert.match(build, /main/);
  assert.doesNotMatch(build, /omitted/i);
});

test('mission control event helpers preserve fallback behavior', () => {
  assert.equal(eventTone({ kind: 'gate_decision' }), 'info');
  assert.equal(eventTone({ kind: 'blocked' }), 'bad');
  assert.equal(isRefusedEvent({ kind: 'correct' }), false);
  assert.equal(summarizeDetail({ kind: 'unknown', detail: '{bad json' }), 'Unstructured detail omitted');
  assert.equal(summarizeDetail({ kind: 'unknown', detail: { note: 'object detail accepted' } }), 'object detail accepted');
});
