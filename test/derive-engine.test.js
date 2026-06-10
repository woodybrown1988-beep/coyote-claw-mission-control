'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { deriveEngine, deriveRef } = require('../mission-control/server.js');

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

test('deriveRef reads fallback values from result JSON in precedence order', () => {
  assert.equal(deriveRef({ result: '{"prNumber":8}' }), '#8');
  assert.equal(deriveRef({ result: '{"prUrl":"https://github.com/o/r/pull/27","prNumber":27,"headSha":"abc12345"}' }), '#27');
  assert.equal(deriveRef({ result: '{"headSha":"27c86ac012bb67bb8550db36f6fd7eb34c20e896"}' }), '27c86ac0');
  assert.equal(deriveRef({ branch: 'feature-x', result: '{"prNumber":8}' }), 'feature-x');
});

test('deriveRef returns placeholder for missing unusable or malformed result JSON', () => {
  assert.equal(deriveRef({}), '—');
  assert.equal(deriveRef({ result: '{"status":"ok"}' }), '—');
  assert.equal(deriveRef({ result: '{not json' }), '—');
  assert.equal(deriveRef({ result: '' }), '—');

  const cases = [
    { result: null },
    { result: [] },
    { result: '[]' },
    { result: '"feature-x"' },
    { result: '42' },
    { result: 'true' },
    { result: '{"prNumber":"","branch":"   ","headSha":""}' }
  ];

  for (const row of cases) {
    assert.doesNotThrow(() => {
      assert.equal(deriveRef(row), '—');
    });
  }
});

test('deriveRef supports result key aliases without changing precedence', () => {
  const cases = [
    [{ result: '{"pr_number":"12"}' }, '#12'],
    [{ result: '{"number":13}' }, '#13'],
    [{ result: '{"branch":"feature-y"}' }, 'feature-y'],
    [{ result: '{"ref":"main"}' }, 'main'],
    [{ result: '{"sha":"abcdef123456"}' }, 'abcdef12'],
    [{ result: '{"commit_sha":"1234567890abcdef"}' }, '12345678']
  ];

  for (const [row, expected] of cases) {
    assert.equal(deriveRef(row), expected);
  }
});
