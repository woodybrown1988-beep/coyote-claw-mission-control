'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { formatCount, formatJobAge, renderDashboard } = require('../mission-control/server.js');

test('formatJobAge formats representative age ranges', () => {
  const renderedAt = 1_700_000_000_000;

  assert.equal(formatJobAge(renderedAt - 30 * 1000, renderedAt), 'just now');
  assert.notEqual(formatJobAge(renderedAt - 30 * 1000, renderedAt), '0m');
  assert.equal(formatJobAge(renderedAt - 60 * 1000, renderedAt), '1m');
  assert.equal(formatJobAge(renderedAt - 12 * 60 * 1000, renderedAt), '12m');
  assert.equal(formatJobAge(renderedAt - 3 * 60 * 60 * 1000, renderedAt), '3h');
  assert.equal(formatJobAge(renderedAt - 9 * 24 * 60 * 60 * 1000, renderedAt), '9d');
  assert.equal(formatJobAge(renderedAt - 31 * 24 * 60 * 60 * 1000, renderedAt), '2023-10-14 22:13:20 UTC');
  assert.equal(formatJobAge(renderedAt + 1000, renderedAt), '-');
});

test('formatCount formats singular and plural count labels', () => {
  assert.equal(formatCount(1, 'job'), '1 job');
  assert.equal(formatCount(0, 'job'), '0 jobs');
  assert.equal(formatCount(3, 'job'), '3 jobs');
});

test('renderDashboard formats open gate count labels', () => {
  assert.match(renderDashboard(dashboardModelWithOpenGates(1)), />1 tap pending</);
  assert.match(renderDashboard(dashboardModelWithOpenGates(0)), />0 taps pending</);
  assert.match(renderDashboard(dashboardModelWithOpenGates(3)), />3 taps pending</);
});

function dashboardModelWithOpenGates(openGates) {
  const unavailable = { ok: false, message: 'unavailable for formatter test' };

  return {
    ok: true,
    refreshedAt: 1_700_000_000_000,
    sections: {
      kpis: {
        ok: true,
        jobsToday: 0,
        shippedToday: 0,
        activeJobs: 0,
        gatesPassed: 0,
        gatesRefused: 0,
        openGates,
        activeStage: 'idle',
        activeJob: ''
      },
      queue: unavailable,
      worker: unavailable,
      spend: unavailable,
      tokens: unavailable,
      outcomes: unavailable
    }
  };
}
