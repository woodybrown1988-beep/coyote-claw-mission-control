'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { summarizeTestRun } = require('../mission-control/server.js');

test('summarizeTestRun marks theatre runs as proving nothing while preserving existing fields', () => {
  const summary = summarizeTestRun({}, { verdict: 'theatre', passCount: 4 });

  assert.match(summary, /verdict theatre/);
  assert.match(summary, /pass count 4/);
  assert.match(summary, /theatre/i);
  assert.match(summary, /proves-nothing/i);
});

test('summarizeTestRun marks accepted runs with the exact killed mutant function count', () => {
  const summary = summarizeTestRun({}, {
    verdict: 'accept',
    passCount: 9,
    perFunction: [
      { name: 'one', caughtByMutant: true },
      { name: 'two', caughtByMutant: true },
      { name: 'three', caughtByMutant: false },
      { name: 'four', caughtByMutant: true }
    ]
  });

  assert.match(summary, /verdict accept/);
  assert.match(summary, /pass count 9/);
  assert.match(summary, /mutant-killed \(3 fns\)/);
});

test('summarizeTestRun does not render mutant-killed for missing empty or uncaught perFunction data', () => {
  const cases = [
    { verdict: 'accept', passCount: 1 },
    { verdict: 'accept', passCount: 1, perFunction: null },
    { verdict: 'accept', passCount: 1, perFunction: [] },
    { verdict: 'accept', passCount: 1, perFunction: [{ caughtByMutant: false }, { caughtByMutant: 'true' }] },
    { verdict: 'accept', passCount: 1, perFunction: { caughtByMutant: true } }
  ];

  for (const detail of cases) {
    assert.doesNotMatch(summarizeTestRun({}, detail), /mutant-killed/i);
  }
});

test('summarizeTestRun leaves old non-integrity summaries unmarked', () => {
  const summary = summarizeTestRun({}, { verdict: 'reject', passCount: 2 });

  assert.match(summary, /verdict reject/);
  assert.match(summary, /pass count 2/);
  assert.doesNotMatch(summary, /theatre|mutant|killed/i);
});
