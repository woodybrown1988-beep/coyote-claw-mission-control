'use strict';

// Labour centre — the COVERAGE & PEOPLE holding pen + page-wide honesty. The old labour page's
// un-absorbed panels (staffing shape · today-live intraday · U18 WTR guard · rate parity) HOLD
// on ?tab=coverage until their L2 home is built; this file pins them there. The absorbed panels
// (hero, 8-week spark, dept scorecard, cross-ruler block, clock drift, blended rate, period nav)
// left the page — their pins live in mission-control-labour-centre-l1.test.js against their new
// homes (Executive + Rota vs Actual).

const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const labour = require('../mission-control/ui/pages/coyote/labour.js');

const NOW = 1783000000000;

function makeDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sales_day (business_date TEXT PRIMARY KEY, net_sales_pence INTEGER, updated_at INTEGER);
    CREATE TABLE labour_day (business_date TEXT PRIMARY KEY, scheduled_minutes INTEGER, actual_minutes INTEGER, actual_paid_minutes INTEGER, scheduled_cost_pence INTEGER, actual_cost_pence INTEGER, salaried_cost_pence INTEGER, unmapped_scheduled_minutes INTEGER, unmapped_actual_minutes INTEGER, unmapped_names TEXT, anomalies TEXT, staff_scheduled INTEGER, staff_worked INTEGER, updated_at INTEGER);
    CREATE TABLE labour_dept (business_date TEXT, department TEXT, sched_minutes INTEGER, act_minutes INTEGER, sched_cost_rc_pence INTEGER, act_cost_rc_pence INTEGER, rc_uncosted_sched_min INTEGER, rc_uncosted_act_min INTEGER, rc_uncosted_names TEXT, updated_at INTEGER, PRIMARY KEY (business_date, department));
    CREATE TABLE labour_rate_parity (user_id INTEGER, user_name TEXT, role_id INTEGER, role_name TEXT, kind TEXT, rc_value TEXT, locked_value TEXT, checked_at INTEGER);
    CREATE TABLE labour_intraday (business_date TEXT, department TEXT, as_of_ms INTEGER, sched_minutes_full INTEGER, sched_cost_rc_full INTEGER, worked_minutes_so_far INTEGER, cost_rc_so_far INTEGER, uncosted_minutes INTEGER, clocked_in_now TEXT, no_shows TEXT, ref_date TEXT, ref_worked_minutes INTEGER, ref_net_pence INTEGER, ref_to_hour INTEGER, updated_at INTEGER, PRIMARY KEY (business_date, department));
    CREATE TABLE labour_wtr_flags (business_date TEXT, user_id INTEGER, user_name TEXT, kind TEXT, detail TEXT, created_at INTEGER, PRIMARY KEY (business_date, user_id, kind));
    CREATE TABLE labour_shifts (business_date TEXT, user_id INTEGER, user_name TEXT, sched_minutes INTEGER, act_minutes INTEGER, variance_minutes INTEGER, rate_pence INTEGER, cost_basis TEXT, updated_at INTEGER);
    CREATE TABLE labour_hourly (business_date TEXT, hour INTEGER, scheduled_minutes INTEGER, actual_minutes INTEGER, scheduled_cost_pence INTEGER, actual_cost_pence INTEGER, updated_at INTEGER);
  `);
  return db;
}

function renderTab(db, query) {
  const ctx = { q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, halt: { halted: false }, query: query || {} };
  return labour.render(labour.getSection(db, ctx), ctx).body;
}

test('empty DB (no tables at all): every tab renders an honest state, never throws', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  for (const tab of ['executive', 'forecast', 'rota', 'kitchen', 'foh', 'coverage']) {
    const body = renderTab(db, { tab });
    assert.ok(body.length > 0, `${tab} renders`);
    assert.ok(!/NaN|Infinity|undefined/.test(body), `${tab} carries no fabricated value`);
  }
  assert.ok(renderTab(db).includes('No settled labour-day record yet'), 'executive names the missing wire');
});

test('coverage: rate parity — discrepancies named with the unfair banner; clean state says so', () => {
  const db = makeDb();
  db.prepare(`INSERT INTO labour_rate_parity VALUES (1666909, 'Ciaran Elder', 216379, 'FOH Assistant', 'role_rate_mismatch', '£12.25/h', '£12.75/h', ?)`).run(NOW);
  const body = renderTab(db, { tab: 'coverage' });
  assert.ok(body.includes('1 rate discrepancy'), body.match(/rate discrepanc[\s\S]{0,80}/)?.[0]);
  assert.ok(body.includes('unfair until fixed'), 'the consequence is stated');
  assert.ok(body.includes('Ciaran Elder') && body.includes('£12.25/h') && body.includes('£12.75/h'), 'named with both values');

  db.prepare(`DELETE FROM labour_rate_parity`).run();
  assert.ok(renderTab(db, { tab: 'coverage' }).includes('Rate parity ✓'), 'clean state affirms the check ran');
});

test('coverage: TODAY-live held panel — names + as-of + so-far vs full-day rota; stale flagged; absent = honest hint', () => {
  const db = makeDb();
  const fresh = NOW - 20 * 60000; // 20 min ago
  db.prepare(`INSERT INTO labour_intraday VALUES ('2026-07-02','kitchen',?,3045,61027,1820,38000,0,'[{"name":"Rio Alexander","role":"Kitchen - Under 18","since_ms":1782990000000}]','[{"name":"Leon Mackay","rota_start_ms":1782990000000}]','2026-06-25',4260,310000,20,?)`).run(fresh, NOW);
  db.prepare(`INSERT INTO labour_intraday VALUES ('2026-07-02','foh',?,2055,27125,1200,15000,360,'[]','[]','2026-06-25',4260,310000,20,?)`).run(fresh, NOW);
  const body = renderTab(db, { tab: 'coverage' });
  assert.ok(body.includes('Today — live'), 'panel present');
  assert.ok(body.includes('Rio Alexander'), 'who is in now, by name');
  assert.ok(body.includes('30.3h'), 'worked so far (1820min)');
  assert.ok(body.includes('50.8h'), 'full-day rota (3045min)');
  assert.ok(body.includes('partial-day figures, never a day result'), 'the honesty label');
  assert.ok(body.includes('as of '), 'fresh snapshot is not flagged stale');
  assert.ok(!body.includes('STALE'), 'no false stale alarm at 20 min');
  assert.ok(body.includes('£0 in the RC-screen ruler'), 'uncosted so-far surfaced (FOH 6h)');
  assert.ok(body.includes('NO-SHOW') && body.includes('Leon Mackay'), 'no-show named in red');
  assert.ok(body.includes('Reference — last Thursday (2026-06-25, settled) by 20:00'), 'reference labelled with its date');
  assert.ok(body.includes('never a projection'), 'the no-projection label is on the panel');

  // stale: 3h old snapshot
  db.prepare(`UPDATE labour_intraday SET as_of_ms = ?`).run(NOW - 180 * 60000);
  assert.ok(renderTab(db, { tab: 'coverage' }).includes('STALE'), 'two missed pulls = flagged');

  // absent: no snapshot rows at all
  db.prepare(`DELETE FROM labour_intraday`).run();
  assert.ok(renderTab(db, { tab: 'coverage' }).includes('No intraday snapshot yet'), 'honest empty state');
});

test('coverage: U18 guard — flags named with citations; clean state affirms the check', () => {
  const db = makeDb();
  assert.ok(renderTab(db, { tab: 'coverage' }).includes('U18 working-time ✓'), 'clean state');
  db.prepare(`INSERT INTO labour_wtr_flags VALUES ('2026-07-01', 1735963, 'Rio Alexander', 'day_over_8h', '9.5h worked — under-18 daily maximum is 8h (gov.uk/maximum-weekly-working-hours, no averaging)', 1)`).run();
  const body = renderTab(db, { tab: 'coverage' });
  assert.ok(body.includes('1 U18 working-time flag'), 'banner');
  assert.ok(body.includes('Rio Alexander') && body.includes('gov.uk'), 'named + cited');
});

test('coverage: WTR aggregate — per-person breach counts, hard-limit total, systemic story', () => {
  const db = makeDb();
  const ins = db.prepare(`INSERT INTO labour_wtr_flags VALUES (?,?,?,?,?,?)`);
  // Rio: 91 over-8h, 131 past-22:00 ; Leon: 118 over-8h — the real backfill shape
  for (let i = 0; i < 91; i++) ins.run('2026-0' + (1 + (i % 5)) + '-0' + (1 + (i % 9)) + 'x' + i, 1735963, 'Rio Alexander', 'day_over_8h', 'd', 1);
  for (let i = 0; i < 131; i++) ins.run('2026-0' + (1 + (i % 5)) + '-1' + (i % 9) + 'y' + i, 1735963, 'Rio Alexander', 'night_22_24', 'n', 1);
  for (let i = 0; i < 118; i++) ins.run('2026-0' + (1 + (i % 5)) + '-2' + (i % 8) + 'z' + i, 1705145, 'Leon Mackay', 'day_over_8h', 'd', 1);
  const body = renderTab(db, { tab: 'coverage' });
  assert.ok(body.includes('U18 working-time flag'), 'aggregate banner');
  assert.ok(/Rio Alexander[\s\S]{0,120}91/.test(body), 'per-person over-8h count surfaced (was hidden in a 20-row tail)');
  assert.ok(/Leon Mackay[\s\S]{0,120}118/.test(body), 'Leon 118 over-8h days');
  assert.ok(body.includes('HARD legal limits'), 'the actionable hard-limit framing');
  assert.ok(body.includes('gov.uk'), 'citations retained');
  assert.ok(body.includes('rota-policy action items'), 'points at the fix');
});

test('coverage: staffing shape holds (hourly worked bars, ruler-free); thin record = honest note', () => {
  const db = makeDb();
  for (const h of [11, 12, 13, 18, 19, 20]) db.prepare(`INSERT INTO labour_hourly (business_date, hour, actual_minutes) VALUES ('2026-07-01', ?, ?)`).run(h, 300 + h * 5);
  const body = renderTab(db, { tab: 'coverage' });
  assert.ok(body.includes('Staffing shape'), 'held section present');
  assert.ok(body.includes('lb-bar'), 'staffing bars rendered');
  assert.ok(body.includes('ruler-free'), 'minute grain declared');

  db.prepare(`DELETE FROM labour_hourly`).run();
  assert.ok(renderTab(db, { tab: 'coverage' }).includes('No hourly staffing record yet'), 'honest empty state');
});

test('coverage: the pending banner names the holding-pen deal + the EXCLUDED-BY-RULING People queue', () => {
  const db = makeDb();
  const body = renderTab(db, { tab: 'coverage' });
  assert.ok(body.includes('PENDING'), 'pending note present');
  assert.ok(body.includes('EXCLUDED BY RULING'), 'the People exception queue is named excluded, not empty-stated');
  assert.ok(!body.includes('People exception queue</h'), 'and no such panel renders');
});
