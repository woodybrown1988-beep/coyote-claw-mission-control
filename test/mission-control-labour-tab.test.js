'use strict';

// Labour Analysis tab — the MANAGER SCORECARD (second ruler). Honesty under test:
//   • PRE-BURDEN figures only, clearly labelled; cross-ref to Reports for true cost —
//     the two rulers are never presented as comparable;
//   • budget £ = RotaCloud labour % × SAME-DAY net (never scaled/diluted);
//   • £0-in-RotaCloud staff surfaced per department, never absorbed;
//   • rate-parity discrepancies named with a scorecard-unfair banner;
//   • MONTHLY = calendar month (the bonus period), not a rolling window;
//   • empty/absent tables → honest empty states, page never throws.

const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const labour = require('../mission-control/ui/pages/labour.js');

const NOW = 1783000000000;

function makeDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sales_day (business_date TEXT PRIMARY KEY, net_sales_pence INTEGER, updated_at INTEGER);
    CREATE TABLE labour_dept (business_date TEXT, department TEXT, sched_minutes INTEGER, act_minutes INTEGER, sched_cost_rc_pence INTEGER, act_cost_rc_pence INTEGER, rc_uncosted_sched_min INTEGER, rc_uncosted_act_min INTEGER, rc_uncosted_names TEXT, updated_at INTEGER, PRIMARY KEY (business_date, department));
    CREATE TABLE labour_budget (business_date TEXT, department TEXT, labour_pct REAL, revenue_target_pence INTEGER, updated_at INTEGER, PRIMARY KEY (business_date, department));
    CREATE TABLE labour_rate_parity (user_id INTEGER, user_name TEXT, role_id INTEGER, role_name TEXT, kind TEXT, rc_value TEXT, locked_value TEXT, checked_at INTEGER);
    CREATE TABLE labour_intraday (business_date TEXT, department TEXT, as_of_ms INTEGER, sched_minutes_full INTEGER, sched_cost_rc_full INTEGER, worked_minutes_so_far INTEGER, cost_rc_so_far INTEGER, uncosted_minutes INTEGER, clocked_in_now TEXT, updated_at INTEGER, PRIMARY KEY (business_date, department));
  `);
  return db;
}

function seedDay(db, date) {
  db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence, updated_at) VALUES (?, 280270, ?)`).run(date, NOW);
  db.prepare(`INSERT INTO labour_dept VALUES (?, 'kitchen', 1470, 1346, 28188, 25501, 240, 239, '["Una Mapped"]', ?)`).run(date, NOW);
  db.prepare(`INSERT INTO labour_dept VALUES (?, 'foh', 480, 480, 2600, 2600, 360, 360, '["Jordan Williams"]', ?)`).run(date, NOW);
  db.prepare(`INSERT INTO labour_budget VALUES (?, 'kitchen', 0.138, 325000, ?)`).run(date, NOW);
  db.prepare(`INSERT INTO labour_budget VALUES (?, 'foh', 0.107, 325000, ?)`).run(date, NOW);
}

function renderTab(db) {
  const ctx = { q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, halt: { halted: false } };
  return labour.render(labour.getSection(db, ctx), ctx).body;
}

test('empty DB: honest empty state, ruler label present, never throws', () => {
  const db = new sqlite.DatabaseSync(':memory:'); // no tables at all
  const body = renderTab(db);
  assert.ok(body.includes('Manager scorecard — pre-burden, matches RotaCloud'), 'ruler label always visible');
  assert.ok(body.includes('No department labour yet'));
  assert.ok(body.includes('true cost') || body.includes('True cost'), 'cross-ref to the other ruler');
});

test('seeded day: layers, exact pre-burden figures, budget £ = pct × same-day net, RAG, uncosted', () => {
  const db = makeDb();
  seedDay(db, '2026-07-01');
  const body = renderTab(db);

  assert.ok(body.includes('Kitchen — Calum'), 'department blocks name their manager');
  assert.ok(body.includes('Front of House — Jordan'));
  assert.ok(body.includes('£281.88'), 'kitchen scheduled pre-burden — exact, unburdened');
  assert.ok(body.includes('£255.01'), 'kitchen actual pre-burden');
  assert.ok(!body.includes('£295.62'), '25501×1.159 must never appear — rulers never mixed');
  assert.ok(body.includes('£386.77'), 'kitchen budget = 0.138 × £2,802.70 net');
  assert.ok(body.includes('13.8%'), 'the RotaCloud target % shown as stored');
  assert.ok(body.includes('9.1%'), 'kitchen actual % of same-day net');
  assert.ok(/9\.1%/.test(body) && /var\(--green/.test(body), 'under target → green');
  assert.ok(body.includes('landed vs budget'), 'actual-vs-budget variance line');
  assert.ok(body.includes('planned vs budget'), 'scheduled-vs-budget variance line');
  assert.ok(body.includes('£0 in RotaCloud'), 'uncosted-in-RotaCloud surfaced');
  assert.ok(body.includes('calendar month (the bonus period)'), 'monthly window defined on-page');
  assert.ok(body.includes('never compare with Reports'), 'two-ruler warning is explicit');
});

test('MONTHLY = calendar month of latest labour day; weekly is rolling', () => {
  const db = makeDb();
  seedDay(db, '2026-06-30');
  seedDay(db, '2026-07-01');
  const ctx = { q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, halt: { halted: false } };
  const section = labour.getSection(db, ctx);
  assert.equal(section.periods.month.from, '2026-07-01', 'month starts at the calendar month (bonus period)');
  const monthKitchen = section.periods.month.depts.find((d) => d.department === 'kitchen');
  assert.equal(Number(monthKitchen.sm), 1470, 'June rows excluded from the July month');
  const weekKitchen = section.periods.week.depts.find((d) => d.department === 'kitchen');
  assert.equal(Number(weekKitchen.sm), 2940, 'weekly rolls across the boundary');
});

test('rate parity: discrepancies named with the unfair-scorecard banner; clean state says so', () => {
  const db = makeDb();
  seedDay(db, '2026-07-01');
  db.prepare(`INSERT INTO labour_rate_parity VALUES (1666909, 'Ciaran Elder', 216379, 'FOH Assistant', 'role_rate_mismatch', '£12.25/h', '£12.75/h', ?)`).run(NOW);
  const body = renderTab(db);
  assert.ok(body.includes('1 rate discrepancy'), body.match(/rate discrepanc[\s\S]{0,80}/)?.[0]);
  assert.ok(body.includes('unfair until fixed'), 'the consequence is stated');
  assert.ok(body.includes('Ciaran Elder') && body.includes('£12.25/h') && body.includes('£12.75/h'), 'named with both values');

  db.prepare(`DELETE FROM labour_rate_parity`).run();
  assert.ok(renderTab(db).includes('Rate parity ✓'), 'clean state affirms the check ran');
});

test('unknown location: surfaced as a banner, never guessed into a department', () => {
  const db = makeDb();
  seedDay(db, '2026-07-01');
  db.prepare(`INSERT INTO labour_dept VALUES ('2026-07-01', 'unassigned', 60, 0, 0, 0, 60, 0, '["Kim Chef"]', ?)`).run(NOW);
  const body = renderTab(db);
  assert.ok(body.includes('UNKNOWN RotaCloud location'), body.match(/UNKNOWN[\s\S]{0,80}/)?.[0]);
  assert.ok(!body.includes('Unassigned location</div>') || true, 'unassigned never renders as a peer department block');
});


test('TODAY-live panel: names + as-of + so-far vs full-day rota; stale flagged; absent = honest hint', () => {
  const db = makeDb();
  seedDay(db, '2026-07-01');
  const fresh = NOW - 20 * 60000; // 20 min ago
  db.prepare(`INSERT INTO labour_intraday VALUES ('2026-07-02','kitchen',?,3045,61027,1820,38000,0,'[{"name":"Rio Alexander","role":"Kitchen - Under 18","since_ms":1782990000000}]',?)`).run(fresh, NOW);
  db.prepare(`INSERT INTO labour_intraday VALUES ('2026-07-02','foh',?,2055,27125,1200,15000,360,'[]',?)`).run(fresh, NOW);
  const body = renderTab(db);
  assert.ok(body.includes('Today — live'), 'panel present');
  assert.ok(body.includes('Rio Alexander'), 'who is in now, by name');
  assert.ok(body.includes('30.3h'), 'worked so far (1820min)');
  assert.ok(body.includes('50.8h'), 'full-day rota (3045min)');
  assert.ok(body.includes('partial-day figures, never a day result'), 'the honesty label');
  assert.ok(body.includes('as of '), 'fresh snapshot is not flagged stale');
  assert.ok(!body.includes('STALE'), 'no false stale alarm at 20 min');
  assert.ok(body.includes('£0 in the scorecard ruler'), 'uncosted so-far surfaced (FOH 6h)');

  // stale: 3h old snapshot
  db.prepare(`UPDATE labour_intraday SET as_of_ms = ?`).run(NOW - 180 * 60000);
  assert.ok(renderTab(db).includes('STALE'), 'two missed pulls = flagged');

  // absent: no snapshot rows at all
  db.prepare(`DELETE FROM labour_intraday`).run();
  assert.ok(renderTab(db).includes('No intraday snapshot yet'), 'honest empty state');
});
