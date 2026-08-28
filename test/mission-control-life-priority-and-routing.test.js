// TWO THINGS THE INTERFACE WAS THROWING AWAY (audit 2026-08-28).
//
// 1. THE RANKING. v_life_available_work scores every task — importance x10, consequence x7, a
//    time-weighted urgency curve, +15 for an outcome link, -3 for a quick win — and the Tasks
//    page ordered by updated_at and rendered 165 "Ready" rows at identical weight.
// 2. THE ROUTING GAP. A task with no execution_mode can never be dispatched; 75 of 187 open
//    tasks had never been routed, so the fleet's candidate pool was 3 already-attempted tasks
//    and it had dispatched nothing for nine days. Routing was a required step with no prompt.
//
// Plus the date helper both now use. Dates are where off-by-one lives, so the boundaries are
// pinned explicitly — including the one that matters here: London, not UTC.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const LIFE = require('../mission-control/ui/pages/life/life-lib.js');

const NOW = Date.parse('2026-08-28T10:00:00Z');

test('duePhrase speaks in days a person can act on, and refuses to guess', () => {
  assert.equal(LIFE.duePhrase('2026-08-24T09:00:00Z', NOW), '4 days overdue');
  assert.equal(LIFE.duePhrase('2026-08-27T09:00:00Z', NOW), '1 day overdue', 'singular, not "1 days"');
  // 22:00Z is still the 28th in London (BST); 23:00Z would already be the 29th — the boundary
  // is asserted properly in the London test below, so keep this one unambiguous.
  assert.equal(LIFE.duePhrase('2026-08-28T22:00:00Z', NOW), 'due today');
  assert.equal(LIFE.duePhrase('2026-08-29T12:00:00Z', NOW), 'due tomorrow');
  assert.equal(LIFE.duePhrase('2026-09-03T09:00:00Z', NOW), 'due in 6 days');
  // Past a fortnight a relative count stops carrying meaning — a date reads better.
  assert.match(LIFE.duePhrase('2026-09-20T09:00:00Z', NOW), /^due 20 Sep/);
  // A bad or absent date prints NOTHING. "NaN days overdue" on a real board is worse than silence.
  for (const bad of ['not-a-date', '', null, undefined]) {
    assert.equal(LIFE.duePhrase(bad, NOW), '', `refused: ${JSON.stringify(bad)}`);
  }
});

test('the day boundary is LONDON — a UTC one calls things overdue an hour early', () => {
  // 2026-08-28T23:30Z is already the 29th in London (BST, UTC+1). A task due on the 29th must
  // read "due today" then, not "due tomorrow" — this is the exact off-by-one a UTC-based
  // implementation ships with and nobody notices until an evening.
  const lateEvening = Date.parse('2026-08-28T23:30:00Z');
  assert.equal(LIFE.duePhrase('2026-08-29T09:00:00Z', lateEvening), 'due today');
  assert.equal(LIFE.dueSeverity('2026-08-29T09:00:00Z', lateEvening), 'crit');
  // and the same instant, a day earlier by London reckoning
  assert.equal(LIFE.duePhrase('2026-08-28T09:00:00Z', lateEvening), '1 day overdue');
});

test('dueSeverity sorts into three bands, and colour is never the only channel', () => {
  assert.equal(LIFE.dueSeverity('2026-08-20T09:00:00Z', NOW), 'crit', 'overdue');
  assert.equal(LIFE.dueSeverity('2026-08-28T09:00:00Z', NOW), 'crit', 'due today is critical too');
  assert.equal(LIFE.dueSeverity('2026-08-31T09:00:00Z', NOW), 'soon', 'inside three days');
  assert.equal(LIFE.dueSeverity('2026-09-10T09:00:00Z', NOW), 'ok');
  assert.equal(LIFE.dueSeverity(null, NOW), 'none', 'no date is not an urgency');
  // The words carry the fact independently of the rail's colour — an accessibility floor, and
  // the reason duePhrase exists rather than a bare coloured dot.
  assert.match(LIFE.duePhrase('2026-08-20T09:00:00Z', NOW), /overdue/);
});

test('the routing strip only exists while there is something to route', () => {
  // A strip that greets a cleared queue with "0 tasks need routing" teaches the reader to skip
  // the top of the page — which is how the credential warning under a permanently-red banner
  // went unread once before. Absent at zero, by construction.
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'mission-control', 'ui', 'pages', 'life', 'today.js'), 'utf8');
  assert.match(src, /if \(!routeRows\.length\) return '';/, 'no rows, no strip');
  assert.match(src, /execution_mode IS NULL/, 'it asks for exactly the unrouted');
  assert.match(src, /ORDER BY calculated_priority DESC/, 'and offers the ones worth deciding first');
  // Every offered lane must be one the writer will actually accept.
  for (const mode of ['SELF', 'AI', 'HYBRID']) {
    assert.ok(src.includes(`'${mode}'`), `offers ${mode}`);
  }
  const relay = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'mission-control', 'ui', 'life-command-lib.js'), 'utf8');
  assert.match(relay, /set_route: \(p\) =>.*'SELF', 'AI', 'DELEGATE', 'HYBRID'/,
    'the relay validates the modes the strip sends');
});

test('the Tasks page spends the ranking instead of throwing it away', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'mission-control', 'ui', 'pages', 'life', 'tasks.js'), 'utf8');
  assert.match(src, /FROM v_life_available_work ORDER BY calculated_priority DESC/,
    'the top panel reads the score the database already computes');
  assert.match(src, /lt-rail-\$\{sev\}/, 'and encodes urgency as form, not only as text');
  assert.ok(!/· due \$\{LIFE\.esc\(String\(t\.due_at\)\.slice\(0, 10\)\)\}/.test(src),
    'no raw ISO date survives in the row meta — that was the thing being fixed');
});
