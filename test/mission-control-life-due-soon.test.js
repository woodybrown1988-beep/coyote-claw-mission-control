'use strict';

// DUE-SOON SAFETY NET (audit 2026-08 G-05): any live task with a deadline inside 72h — or overdue —
// must render on Today REGARDLESS of what the daily plan compiled. Statutory dues were TARGET (not
// HARD), so the priority view never lifted them and they were invisible two days out. These pin the
// render branch: present when there ARE due-soon tasks (with the right urgency chip), absent when none.
const assert = require('node:assert/strict');
const test = require('node:test');

const today = require('../mission-control/ui/pages/life/today.js');

const NOW = Date.parse('2026-08-10T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

// A valid, otherwise-empty Today section (engine ok) — the plan compiled NOTHING, so anything showing
// under "Due soon" is there by the safety net, not the plan.
function baseSection(dueSoon) {
  return {
    engine: { ok: true }, now: NOW, today: '2026-08-10', plan: null, taskOf: {}, quiet: true,
    openProposals: [], approvalRows: [], available: [], inboxCount: 0, waitingRows: [],
    activeOutcomes: [], neglectedFromWork: [], decidedToday: 0, doneToday: 0, captured24h: 0,
    dueSoon: dueSoon || [],
  };
}

test('Due soon: a deadline inside 72h renders on Today whatever the plan picked', () => {
  const { body } = today.render(baseSection([
    { id: 't-hsbc', title: 'Top up HSBC and Pleo accounts', due_at: '2026-08-12T09:00:00.000Z', due_kind: 'TARGET', status: 'READY', domain_key: 'business' },
  ]));
  assert.match(body, /Due soon/, 'the Due soon panel renders');
  assert.match(body, /Top up HSBC and Pleo accounts/, 'the due task is listed');
  assert.match(body, /in 2d|due today/, 'it carries an urgency chip');
  assert.match(body, /Start/, 'a one-tap Start action is offered');
  // It sits ABOVE the supporting-wins band (under the hero) so it can never hide below the fold.
  assert.ok(body.indexOf('Due soon') < body.indexOf('Two supporting wins'), 'Due soon is above the fold');
});

test('Due soon: an already-overdue task is marked overdue (red), not merely "soon"', () => {
  const { body } = today.render(baseSection([
    { id: 't-elec', title: 'New electricity contract', due_at: iso(NOW - 3 * 86_400_000), due_kind: 'HARD', status: 'READY', domain_key: 'business' },
  ]));
  assert.match(body, /overdue/, 'overdue is called out');
  assert.match(body, /New electricity contract/);
  assert.match(body, /var\(--rbad\)/, 'overdue row carries the red edge');
});

test('Due soon: NEGATIVE CONTROL — no due-soon tasks means no panel (no empty clutter)', () => {
  const { body } = today.render(baseSection([]));
  assert.doesNotMatch(body, /Due soon/, 'the panel is omitted when nothing is due');
});

test('Due soon: an IN_PROGRESS due task offers Open (not Start)', () => {
  const { body } = today.render(baseSection([
    { id: 't-x', title: 'Submit occasional alcohol licences', due_at: '2026-08-11T09:00:00.000Z', due_kind: 'TARGET', status: 'IN_PROGRESS', domain_key: 'business' },
  ]));
  assert.match(body, /Submit occasional alcohol licences/);
  assert.match(body, /Open/);
});
