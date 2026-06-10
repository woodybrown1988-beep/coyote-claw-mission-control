'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { deriveEngine } = require('../mission-control/server.js');

test('deriveEngine reads engine from result JSON when row engine columns are absent', () => {
  assert.equal(deriveEngine({ result: "{\"engine\":\"codex\"}" }), 'codex');
});

test('deriveEngine preserves explicit row-level engine model provider precedence', () => {
  assert.equal(deriveEngine({
    provider: 'claude',
    model: 'sonnet',
    result: "{\"engine\":\"codex\"}"
  }), 'claude');
});

test('deriveEngine returns unknown when row and result sources are unusable', () => {
  assert.equal(deriveEngine({}), 'unknown');
  assert.equal(deriveEngine({ result: "{\"engine\":\"\",\"model\":\"   \"}" }), 'unknown');
});

test('deriveEngine returns unknown for malformed result JSON without throwing', () => {
  assert.doesNotThrow(() => {
    assert.equal(deriveEngine({ result: "{\"engine\":" }), 'unknown');
  });
});

test('deriveEngine returns unknown for empty result JSON or value without throwing', () => {
  const cases = [
    { result: '{}' },
    { result: '' },
    { result: '   ' },
    { result: null }
  ];

  for (const row of cases) {
    assert.doesNotThrow(() => {
      assert.equal(deriveEngine(row), 'unknown');
    });
  }
});

test('deriveEngine fails row-column-only mutants by using result JSON as the only valid source', () => {
  assert.equal(deriveEngine({
    engine: '',
    worker_engine: '   ',
    model_provider: null,
    provider: '',
    model: '',
    type: 'claude worker',
    status: 'running',
    result: "{\"model\":\"gpt-5\"}"
  }), 'gpt-5');
});
