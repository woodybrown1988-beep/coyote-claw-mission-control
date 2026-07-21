'use strict';

// Period navigation — the edge-honesty guarantees under adversarial pressure:
//   • weeks are CALENDAR Mon–Sun and the back arrow lands exactly one week earlier
//     (29/06–05/07 → 22/06–28/06, the operator's own example);
//   • the future is unreachable (next disabled at today) — no empty "future" periods;
//   • pre-history periods say "no record — history starts <date>", never zeros;
//   • partial current periods are LABELLED to date;
//   • closed days (captured, zero net) are CLOSED; uncaptured days are NO RECORD —
//     never conflated, never interpolated;
//   • custom ranges get a same-length PRECEDING comparator, labelled, with its own
//     thin-history honesty;
//   • malformed queries fall back to the default view (never an error page).

const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const NAVMOD = require('../mission-control/ui/period-nav.js');
const DATA = require('../mission-control/ui/data.js');
const reports = require('../mission-control/ui/pages/coyote/reports.js');

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

// ---------- rendered edge honesty ----------

function makeDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sales_day (business_date TEXT PRIMARY KEY, net_sales_pence INTEGER, gross_sales_pence INTEGER, pos_guest_count INTEGER, transactions INTEGER, taxes_pence INTEGER, refunds_pence INTEGER, voids_pence INTEGER, discounts_pence INTEGER, comps_pence INTEGER, service_charges_pence INTEGER, tips_pence INTEGER, labor_hours REAL, updated_at INTEGER);
    CREATE TABLE sales_hourly (business_date TEXT, hour INTEGER, net_sales_pence INTEGER, updated_at INTEGER);
  `);
  db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence, transactions, updated_at) VALUES ('2026-06-30', 406195, 114, 1)`).run();
  db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence, transactions, updated_at) VALUES ('2026-07-01', 280270, 82, 1)`).run();
  return db;
}
const render = (db, query) => {
  // the period-nav window survives ONLY on the pending RCC subtabs (drivers here); the nav
  // strip must preserve the tab so a period click never bounces the operator to Executive
  const ctx = { q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, halt: { halted: false }, query: Object.assign({ tab: 'drivers' }, query || {}) };
  return reports.render(reports.getSection(db, ctx), ctx).body;
};

test('pre-history period: "no record — history starts <date>", never zeros', () => {
  const body = render(makeDb(), { period: 'week', start: '2026-06-08' });
  assert.ok(body.includes('No record for this period — history starts 2026-06-30'), body.slice(0, 400));
  assert.ok(!body.includes('£0.00'), 'no zero tiles fabricated for an empty period');
  assert.ok(body.includes('never shown as zeros'), 'the rule is stated on-page');
});

test('closed vs missing: zero-net captured day = CLOSED; uncaptured day = NO RECORD', () => {
  const db = makeDb();
  db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence, transactions, updated_at) VALUES ('2026-06-29', 0, 0, 1)`).run();
  // week 06-29→07-05: rows for 29(closed),30,01; settled span 29→01 = 3 days, 0 missing
  const wk = render(db, { period: 'week' });
  assert.ok(wk.includes('1 closed day</b> (captured with zero trade — closed, not missing)'), wk.match(/closed day[\s\S]{0,90}/)?.[0]);
  // custom 06-27→07-01: rows 29,30,01 → expected 5, present 3, 1 is closed → 2 missing
  const cu = render(db, { period: 'custom', start: '2026-06-27', end: '2026-07-01' });
  assert.ok(cu.includes('2 days with no record</b> (not captured — never counted as zeros)'), cu.match(/no record<\/b>[\s\S]{0,80}/)?.[0]);
});

test('URL state: the nav strip is links (bookmarkable), tab preserved, custom form is a GET', () => {
  const body = render(makeDb(), { period: 'week' });
  assert.ok(body.includes('href="/coyote/reports?tab=drivers&amp;period=week&amp;start=2026-06-22"'), 'back arrow is a shareable URL that KEEPS the subtab');
  assert.ok(body.includes('method="GET" action="/coyote/reports"'), 'custom picker round-trips through the URL');
  assert.ok(body.includes('<input type="hidden" name="tab" value="drivers"/>'), 'the custom form round-trips the subtab too');
  assert.ok(body.includes('the future has no record'), 'disabled forward arrow explains itself');
});

test('custom comparator renders with thin-history honesty when the preceding window is empty', () => {
  const body = render(makeDb(), { period: 'custom', start: '2026-06-30', end: '2026-07-01' });
  assert.ok(body.includes('Comparator (preceding 2 days'), body.match(/Comparator[\s\S]{0,120}/)?.[0]);
  assert.ok(body.includes('no record — history starts 2026-06-30'), 'empty comparator says so, never zeros');
});
