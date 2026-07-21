'use strict';

// Period navigation — the module's edge-honesty guarantees under adversarial pressure:
//   • weeks are CALENDAR Mon–Sun and the back arrow lands exactly one week earlier
//     (29/06–05/07 → 22/06–28/06, the operator's own example);
//   • the future is unreachable (next disabled at today) — no empty "future" periods;
//   • partial current periods are LABELLED to date;
//   • custom ranges get a same-length PRECEDING comparator, labelled;
//   • malformed queries fall back to the default view (never an error page).
// HOME NOTE (RCC P5): reports left the period-nav world entirely — every reports subtab is
// BUILT and window-anchored, so the old reports-rendered pins (pre-history / closed-vs-missing
// / tab-preserving strip) left WITH the deleted pending machinery. The module's ONE remaining
// consumer is /coyote/labour (mission-control-labour-tab.test.js exercises the rendered strip).

const assert = require('node:assert/strict');
const test = require('node:test');

const NAVMOD = require('../mission-control/ui/period-nav.js');

const NOW = Date.UTC(2026, 6, 2, 20, 0); // London Thu 2026-07-02 21:00
const MAX = '2026-07-01';

const nav = (query) => NAVMOD.resolveNav(query, MAX, NOW, '/reports');

test('week arrows: calendar Mon–Sun, back lands 22/06–28/06 from 29/06–05/07 (the spec example)', () => {
  const w = nav({ period: 'week' });
  assert.equal(w.from, '2026-06-29');
  assert.ok(w.label.includes('Mon 29 Jun') && w.label.includes('Sun 5 Jul'));
  assert.ok(w.partial && w.label.includes('week to date'), 'current week is labelled partial');
  assert.equal(w.prev, '/reports?period=week&start=2026-06-22');
  const back = nav({ period: 'week', start: '2026-06-22' });
  assert.equal(back.from, '2026-06-22');
  assert.ok(back.label.includes('Mon 22 Jun') && back.label.includes('Sun 28 Jun'));
  assert.equal(back.partial, false, 'a fully-past week is not partial');
});

test('day/month/year arrows; the future is unreachable', () => {
  const d = nav({ period: 'day' });
  assert.equal(d.from, MAX);
  assert.equal(d.prev, '/reports?period=day&start=2026-06-30');
  assert.equal(d.next, '/reports?period=day&start=2026-07-02', 'today itself is reachable');
  assert.equal(nav({ period: 'day', start: '2026-07-02' }).next, null, 'beyond today: nothing');
  assert.equal(nav({ period: 'day', start: '2026-09-09' }).from, '2026-07-02', 'a future start clamps to today');

  const mo = nav({ period: 'month', start: '2026-01-15' });
  assert.equal(mo.from, '2026-01-01');
  assert.equal(mo.prev, '/reports?period=month&start=2025-12-01', 'month back crosses the year boundary');
  const y = nav({ period: 'year' });
  assert.ok(y.label.includes('2026 (year to date)'));
  assert.equal(y.next, null, 'next year does not exist yet');
});

test('custom range: same-length PRECEDING comparator, labelled; malformed/oversized falls back', () => {
  const c = nav({ period: 'custom', start: '2026-06-01', end: '2026-06-14' });
  assert.equal(c.comparator.from, '2026-05-18');
  assert.equal(c.comparator.to, '2026-05-31');
  assert.ok(c.comparator.label.includes('preceding 14 days'), c.comparator.label);
  assert.equal(nav({ period: 'custom', start: '2026-06-14', end: '2026-06-01' }).period, 'day', 'inverted range → default view');
  assert.equal(nav({ period: 'custom', start: '2020-01-01', end: '2026-01-01' }).period, 'day', 'oversized range → default view');
  assert.equal(nav({ period: 'nonsense' }).period, 'day', 'unknown period → default view');
  assert.equal(nav({ period: 'day', start: 'DROP TABLE' }).from, MAX, 'garbage dates ignored');
});
