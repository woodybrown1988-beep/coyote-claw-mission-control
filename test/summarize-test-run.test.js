'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  summarizeDetail,
  summarizeLeadDecision,
  summarizeTestRun
} = require('../mission-control/server.js');

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

test('summarizeDetail renders lead decision verdict and assessment without generic fallback', () => {
  const summary = summarizeDetail({
    kind: 'lead_decision',
    detail: {
      verdict: 'promote',
      assessment: 'Ready for PR after focused summary coverage.'
    }
  });

  assert.match(summary, /verdict promote/);
  assert.match(summary, /Ready for PR after focused summary coverage\./);
  assert.doesNotMatch(summary, /omitted/i);
});

test('summarizeDetail renders lead decision correction text', () => {
  const summary = summarizeDetail({
    kind: 'lead_decision',
    detail: {
      verdict: 'correct',
      correction: 'Add a direct assertion for X'
    }
  });

  assert.match(summary, /verdict correct/);
  assert.match(summary, /Add a direct assertion for X/);
});

test('summarizeDetail renders lead decision verdict-only text without generic fallback', () => {
  const summary = summarizeDetail({
    kind: 'lead_decision',
    detail: {
      verdict: 'promote'
    }
  });

  assert.equal(summary, 'verdict promote');
  assert.doesNotMatch(summary, /omitted/i);
});

test('summarizeDetail caps overlong lead decision assessments with an ellipsis', () => {
  const assessment = 'A'.repeat(240);
  const summary = summarizeDetail({
    kind: 'lead_decision',
    detail: {
      verdict: 'promote',
      assessment
    }
  });
  const full = `verdict promote · ${assessment}`;

  assert.equal(summary, `${full.slice(0, 179)}...`);
  assert.match(summary, /verdict promote/);
  assert.match(summary, /\.\.\.$/);
});

test('summarizeLeadDecision prefers assessment over correction', () => {
  const summary = summarizeLeadDecision({}, {
    verdict: 'correct',
    assessment: 'Use this assessment.',
    correction: 'Do not use this correction.'
  });

  assert.match(summary, /verdict correct/);
  assert.match(summary, /Use this assessment\./);
  assert.doesNotMatch(summary, /Do not use this correction/);
});

test('summarizeDetail preserves existing test run accept summary', () => {
  assert.equal(
    summarizeDetail({ kind: 'test_run', detail: { verdict: 'accept', passCount: 4 } }),
    'verdict accept · pass count 4'
  );
});

test('summarizeDetail preserves existing gate decision summary form', () => {
  assert.equal(
    summarizeDetail({
      kind: 'gate_decision',
      gate: 'pr',
      decision: 'approve',
      detail: { reason: 'checks passed' }
    }),
    'gate pr · decision approve · checks passed'
  );
});

test('summarizeDetail preserves generic omitted-fields fallback for unknown detail', () => {
  assert.equal(
    summarizeDetail({ kind: 'unknown', detail: { x: 1 } }),
    '1 detail field omitted'
  );
});
