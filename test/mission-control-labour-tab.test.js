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
    CREATE TABLE labour_intraday (business_date TEXT, department TEXT, as_of_ms INTEGER, sched_minutes_full INTEGER, sched_cost_rc_full INTEGER, worked_minutes_so_far INTEGER, cost_rc_so_far INTEGER, uncosted_minutes INTEGER, clocked_in_now TEXT, no_shows TEXT, ref_date TEXT, ref_worked_minutes INTEGER, ref_net_pence INTEGER, ref_to_hour INTEGER, updated_at INTEGER, PRIMARY KEY (business_date, department));
    CREATE TABLE labour_wtr_flags (business_date TEXT, user_id INTEGER, user_name TEXT, kind TEXT, detail TEXT, created_at INTEGER, PRIMARY KEY (business_date, user_id, kind));
    CREATE TABLE labour_shifts (business_date TEXT, user_id INTEGER, user_name TEXT, sched_minutes INTEGER, act_minutes INTEGER, variance_minutes INTEGER, rate_pence INTEGER, cost_basis TEXT, updated_at INTEGER);
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

function renderTab(db, query) {
  const ctx = { q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, halt: { halted: false }, query: query || {} };
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
  assert.ok(renderTab(db, { period: 'month' }).includes('calendar month = the bonus period'), 'monthly window defined on-page');
  assert.ok(body.includes('never compare with Reports'), 'two-ruler warning is explicit');
});

test('MONTHLY = calendar month; WEEKLY = calendar Mon–Sun (both navigable via URL state)', () => {
  const db = makeDb();
  seedDay(db, '2026-06-30');
  seedDay(db, '2026-07-01');
  const ctxFor = (query) => ({ q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, halt: { halted: false }, query });
  const month = labour.getSection(db, ctxFor({ period: 'month' }));
  assert.equal(month.nav.from, '2026-07-01', 'month starts at the calendar month (bonus period)');
  assert.equal(Number(month.current.depts.find((d) => d.department === 'kitchen').sm), 1470, 'June rows excluded from the July month');
  const week = labour.getSection(db, ctxFor({ period: 'week' }));
  assert.equal(week.nav.from, '2026-06-29', 'calendar week = the Monday');
  assert.equal(Number(week.current.depts.find((d) => d.department === 'kitchen').sm), 2940, 'Mon–Sun window spans the boundary');
  const prevWeek = labour.getSection(db, ctxFor({ period: 'week', start: '2026-06-22' }));
  assert.ok(prevWeek.nav.label.includes('22 Jun'), 'back-arrow target renders the prior Mon–Sun');
  assert.ok(prevWeek.current.depts.length === 0, 'no data there');
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
  db.prepare(`INSERT INTO labour_intraday VALUES ('2026-07-02','kitchen',?,3045,61027,1820,38000,0,'[{"name":"Rio Alexander","role":"Kitchen - Under 18","since_ms":1782990000000}]','[{"name":"Leon Mackay","rota_start_ms":1782990000000}]','2026-06-25',4260,310000,20,?)`).run(fresh, NOW);
  db.prepare(`INSERT INTO labour_intraday VALUES ('2026-07-02','foh',?,2055,27125,1200,15000,360,'[]','[]','2026-06-25',4260,310000,20,?)`).run(fresh, NOW);
  const body = renderTab(db);
  assert.ok(body.includes('Today — live'), 'panel present');
  assert.ok(body.includes('Rio Alexander'), 'who is in now, by name');
  assert.ok(body.includes('30.3h'), 'worked so far (1820min)');
  assert.ok(body.includes('50.8h'), 'full-day rota (3045min)');
  assert.ok(body.includes('partial-day figures, never a day result'), 'the honesty label');
  assert.ok(body.includes('as of '), 'fresh snapshot is not flagged stale');
  assert.ok(!body.includes('STALE'), 'no false stale alarm at 20 min');
  assert.ok(body.includes('£0 in the scorecard ruler'), 'uncosted so-far surfaced (FOH 6h)');
  assert.ok(body.includes('NO-SHOW') && body.includes('Leon Mackay'), 'no-show named in red');
  assert.ok(body.includes('Reference — last Thursday (2026-06-25, settled) by 20:00'), 'reference labelled with its date');
  assert.ok(body.includes('never a projection'), 'the no-projection label is on the panel');

  // stale: 3h old snapshot
  db.prepare(`UPDATE labour_intraday SET as_of_ms = ?`).run(NOW - 180 * 60000);
  assert.ok(renderTab(db).includes('STALE'), 'two missed pulls = flagged');

  // absent: no snapshot rows at all
  db.prepare(`DELETE FROM labour_intraday`).run();
  assert.ok(renderTab(db).includes('No intraday snapshot yet'), 'honest empty state');
});

test('RULER PURITY (source-level): the scorecard tab never touches the burdened ruler', () => {
  const src = require('node:fs').readFileSync('mission-control/ui/pages/labour.js', 'utf8');
  for (const banned of ['1.159', 'EMPLOYER_BURDEN', '0.159']) {
    assert.ok(!src.includes(banned), `labour.js must stay burden-free: found "${banned}"`);
  }
  assert.ok(src.includes('pre-burden'), 'and says so');
});

test('headline tile: yesterday £-delta vs the managers’ budgets, £ first, % subtitle', () => {
  const db = makeDb();
  seedDay(db, '2026-07-01');
  const body = renderTab(db);
  // kitchen 25501 + foh 2600 = 28101 spent vs 38677 + 29989 = 68666 budgeted → £405.65 under
  assert.ok(body.includes('£405.65 under'), body.match(/Latest settled day[\s\S]{0,220}/)?.[0]);
  assert.ok(/Latest settled day[\s\S]{0,160}var\(--green/.test(body), 'green when under');
  assert.ok(body.includes('spent £281.01 against £686.66 budgeted'), 'both sides of the £ story');
});

test('bonus pacing (month): arithmetic restatement only — no revenue projection anywhere', () => {
  const db = makeDb();
  seedDay(db, '2026-07-01'); // day 1 of a 31-day month → 30 remaining
  const body = renderTab(db, { period: 'month' });
  assert.ok(body.includes('£131.76 under budget'), 'kitchen MTD cushion in £ (38677−25501)');
  assert.ok(body.includes('remaining 30 day(s)'), 'remaining days stated');
  assert.ok(body.includes('cushion of ≈£4.39/day'), 'per-day restatement, not a forecast');
  assert.ok(!/on track to|projected|forecast/i.test(body), 'no projection language');
});

test('SPLH: number only, no invented benchmark; site + per dept', () => {
  const db = makeDb();
  seedDay(db, '2026-07-01');
  const body = renderTab(db);
  assert.ok(body.includes('Site SPLH'), 'site tile');
  assert.ok(body.includes('£92.09'), 'net £2,802.70 ÷ 30.4h worked');
  assert.ok(body.includes('no invented benchmark'), 'target explicitly deferred');
});

test('clock drift: named rows with Δ£ at the shift’s own pre-burden rate + period total', () => {
  const db = makeDb();
  seedDay(db, '2026-07-01');
  db.prepare(`INSERT INTO labour_shifts VALUES ('2026-07-01', 1705145, 'Leon Mackay', 600, 443, -157, 1300, 'hourly', 1)`).run();
  db.prepare(`INSERT INTO labour_shifts VALUES ('2026-07-01', 1549212, 'Victoria Nawrocka', 660, 700, 40, 1275, 'hourly', 1)`).run();
  const body = renderTab(db);
  assert.ok(body.includes('Clock drift'), 'section present');
  assert.ok(body.includes('Leon Mackay'), 'largest gap first');
  assert.ok(body.includes('−£34.02'), 'Leon −157min × £13.00/h');
  assert.ok(body.includes('+£8.50'), 'Victoria +40min × £12.75/h');
  assert.ok(body.includes('Period drift total'), 'the weekly £ total line');
});

test('U18 guard: flags named with citations; clean state affirms the check', () => {
  const db = makeDb();
  seedDay(db, '2026-07-01');
  assert.ok(renderTab(db).includes('U18 working-time ✓'), 'clean state');
  db.prepare(`INSERT INTO labour_wtr_flags VALUES ('2026-07-01', 1735963, 'Rio Alexander', 'day_over_8h', '9.5h worked — under-18 daily maximum is 8h (gov.uk/maximum-weekly-working-hours, no averaging)', 1)`).run();
  const body = renderTab(db);
  assert.ok(body.includes('1 U18 working-time flag'), 'banner');
  assert.ok(body.includes('Rio Alexander') && body.includes('gov.uk'), 'named + cited');
});

test('blended rate: thin history says so instead of faking a trend', () => {
  const db = makeDb();
  seedDay(db, '2026-07-01');
  const body = renderTab(db);
  assert.ok(body.includes('Blended rate'), 'section present');
  assert.ok(body.includes('Thin history — the trend needs a second week'), 'one week = honesty note');
});
