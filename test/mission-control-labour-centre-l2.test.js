'use strict';

// Labour Centre L2 — LABOUR FORECAST + KITCHEN + FRONT OF HOUSE on /coyote/labour (replacing
// their L1 pending notes). Honesty under test:
//   • forecast net BASIS choice pinned both ways: published RC daily targets (rota_ahead_budget
//     — the site target is DUPLICATED across per-dept rows, DEDUP pinned) only when the WHOLE
//     week is published; else the revenue projection's calendar-day weekly share (the P4 method
//     via REP.computeProjection), each stated on-panel;
//   • promise pinned both ways: the FORWARD rota-review verdict's plannedTruePence (canonical,
//     incl. salaried apportionment) when its week matches, else Σ published HOURLY shifts at
//     locked rate × 1.159 — salaried/unmapped rota hours carry NO £ (stated, never estimated);
//   • five-band curve = the DERIVED view: levels are OBSERVED weekly-net quantiles of the
//     trailing 26 full weeks (hand-computed on a seeded record), never hand-set rows;
//   • eight-week outlook: an unpublished week SAYS so;
//   • forward management view: day+dept AGGREGATES only — a name seeded into
//     rota_ahead_shifts.user_name must never render on ANY tab (NO-NAMES extended);
//   • what-if slider is CLIENT-side only — no fetch, no /api/ reference on the tab;
//   • kitchen/foh mirror parity via ONE shared renderer; dept SPLH refused as dishonest
//     (dept hours + site SPLH context instead, captioned); role mix disposition = FUTURE from
//     rota_ahead_shifts (the only dept+role wire) where present, else the named gap;
//   • daily demand-vs-staffing pairing arithmetic; June-hole statements; empty-DB proof.

const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const labour = require('../mission-control/ui/pages/coyote/labour.js');

const NOW = 1784800000000; // 2026-07-23 (Thursday) → "next week" = w/c 2026-07-27 → 2026-08-02

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function makeDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sales_day (business_date TEXT PRIMARY KEY, net_sales_pence INTEGER, updated_at INTEGER);
    CREATE TABLE labour_day (business_date TEXT PRIMARY KEY, scheduled_minutes INTEGER, actual_minutes INTEGER, actual_paid_minutes INTEGER, scheduled_cost_pence INTEGER, actual_cost_pence INTEGER, salaried_cost_pence INTEGER, unmapped_scheduled_minutes INTEGER, unmapped_actual_minutes INTEGER, unmapped_names TEXT, anomalies TEXT, staff_scheduled INTEGER, staff_worked INTEGER, updated_at INTEGER);
    CREATE TABLE labour_dept (business_date TEXT, department TEXT, sched_minutes INTEGER, act_minutes INTEGER, sched_cost_rc_pence INTEGER, act_cost_rc_pence INTEGER, rc_uncosted_sched_min INTEGER, rc_uncosted_act_min INTEGER, rc_uncosted_names TEXT, updated_at INTEGER, PRIMARY KEY (business_date, department));
    CREATE TABLE labour_shifts (business_date TEXT, user_id INTEGER, user_name TEXT, sched_minutes INTEGER, act_minutes INTEGER, variance_minutes INTEGER, rate_pence INTEGER, cost_basis TEXT, updated_at INTEGER);
    CREATE TABLE labour_hourly (business_date TEXT, hour INTEGER, scheduled_minutes INTEGER, actual_minutes INTEGER, scheduled_cost_pence INTEGER, actual_cost_pence INTEGER, updated_at INTEGER);
    CREATE TABLE labour_wtr_flags (business_date TEXT, user_id INTEGER, user_name TEXT, kind TEXT, detail TEXT, created_at INTEGER, PRIMARY KEY (business_date, user_id, kind));
    CREATE TABLE labour_rate_parity (user_id INTEGER, user_name TEXT, role_id INTEGER, role_name TEXT, kind TEXT, rc_value TEXT, locked_value TEXT, checked_at INTEGER);
    CREATE TABLE rota_review_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, mode TEXT, week_monday TEXT, ran_at INTEGER, status TEXT, trigger TEXT, rota_fingerprint TEXT, report_json TEXT, report_text TEXT, error TEXT);
    CREATE TABLE labour_intraday (business_date TEXT, department TEXT, as_of_ms INTEGER, sched_minutes_full INTEGER, sched_cost_rc_full INTEGER, worked_minutes_so_far INTEGER, cost_rc_so_far INTEGER, uncosted_minutes INTEGER, clocked_in_now TEXT, no_shows TEXT, ref_date TEXT, ref_worked_minutes INTEGER, ref_net_pence INTEGER, ref_to_hour INTEGER, updated_at INTEGER, PRIMARY KEY (business_date, department));
    CREATE TABLE rota_ahead_budget (business_date TEXT, department TEXT, labour_pct REAL, revenue_target_pence INTEGER, as_of INTEGER, PRIMARY KEY (business_date, department));
    CREATE TABLE rota_ahead_shifts (business_date TEXT, rc_shift_id INTEGER, user_id INTEGER, user_name TEXT, role_id INTEGER, role_name TEXT, department TEXT, sched_start INTEGER, sched_end INTEGER, sched_break_min INTEGER, sched_minutes INTEGER, cost_basis TEXT, rate_pence INTEGER, sched_cost_true_pence INTEGER, sched_cost_rc_pence INTEGER, as_of INTEGER);
    CREATE TABLE sales_receipts_api (receipt_id TEXT, business_date TEXT, type TEXT, cancelled INTEGER, net_without_tax_pence INTEGER);
    CREATE TABLE sales_api_ingest_runs (business_date TEXT, source TEXT, status TEXT);
    CREATE VIEW v_sales_day_all AS
      SELECT business_date, net_sales_pence, NULL AS transactions,
             CASE WHEN business_date >= '2023-04-01' THEN 'current' ELSE 'previous' END AS premises
        FROM sales_day;
  `);
  // The ruled constants — canon_constants fixture (the labour page READS these from the DB;
  // the engine's schema.sql seeds the live table — ruling 2026-08-10, one home).
  db.exec(`CREATE TABLE IF NOT EXISTS canon_constants (key TEXT PRIMARY KEY, value TEXT NOT NULL, as_of TEXT NOT NULL, note TEXT);
    INSERT INTO canon_constants (key, value, as_of, note) VALUES
      ('labour.employer_burden_multiplier','1.159','2026-07-02',NULL),
      ('labour.var_rate_kitchen','0.143','2026-07-18',NULL),
      ('labour.var_rate_foh','0.081','2026-07-18',NULL),
      ('labour.combined_anchor','0.30','2026-07-18',NULL),
      ('labour.materiality_pence','4500','2026-07-18',NULL);`);
  return db;
}

function ctxFor(db, query) {
  return { q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, halt: { halted: false }, query: query || {} };
}
function renderTab(db, query) {
  const ctx = ctxFor(db, query);
  return labour.render(labour.getSection(db, ctx), ctx).body;
}

// The L1 fixture: one full Mon–Sun week (2026-07-13 → 2026-07-19): net £3,000/day, TRUE actual
// £900/day (salaried £200 inside → weekly salaried £1,400 = the forecast's salaried term),
// 50h worked/day-equivalent (3000 min).
function seedKpiWeek(db) {
  const sd = db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence) VALUES (?, 300000)`);
  const ld = db.prepare(`INSERT INTO labour_day (business_date, scheduled_minutes, actual_minutes, actual_paid_minutes, scheduled_cost_pence, actual_cost_pence, salaried_cost_pence, unmapped_names) VALUES (?, 3100, 3000, 3050, 85000, 90000, 20000, '[]')`);
  for (let i = 13; i <= 19; i++) { sd.run(`2026-07-${i}`); ld.run(`2026-07-${i}`); }
}

// Published RC daily targets for a week — BOTH dept rows carry the SAME site target (the live
// duplication the DEDUP guards against).
function seedBudgetWeek(db, from, nDays, targetPence) {
  const ins = db.prepare(`INSERT INTO rota_ahead_budget (business_date, department, labour_pct, revenue_target_pence, as_of) VALUES (?, ?, 0.14, ?, 1)`);
  for (let i = 0; i < nDays; i++) {
    ins.run(addDays(from, i), 'kitchen', targetPence);
    ins.run(addDays(from, i), 'foh', targetPence);
  }
}

function seedAheadShift(db, { date, dept, role, name, mins, basis, truePence }) {
  db.prepare(`INSERT INTO rota_ahead_shifts (business_date, rc_shift_id, user_id, user_name, role_id, role_name, department, sched_start, sched_end, sched_break_min, sched_minutes, cost_basis, rate_pence, sched_cost_true_pence, sched_cost_rc_pence, as_of)
    VALUES (?, 1, 1, ?, 1, ?, ?, 0, 0, 0, ?, ?, NULL, ?, NULL, 1)`)
    .run(date, name || null, role || null, dept, mins, basis || 'hourly', truePence == null ? null : truePence);
}

// One month of the day-net canon record (revenue-of-record ruling 2026-08-10): one sales_day
// row carrying the month's net (read via v_sales_day_all) + one ok ledger day per calendar
// day (ledger-complete). Receipts are NOT the projection's value source any more.
function seedMonth(db, ym, netPence) {
  db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence) VALUES (?, ?)`)
    .run(`${ym}-15`, netPence);
  const days = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  const ins = db.prepare(`INSERT INTO sales_api_ingest_runs (business_date, source, status) VALUES (?, 'kseries-sales-daily', 'ok')`);
  for (let d = 1; d <= days; d++) ins.run(`${ym}-${String(d).padStart(2, '0')}`);
}

// ---------------- LABOUR FORECAST ----------------

test('forecast basis A — PUBLISHED: whole-week RC targets, dept rows DEDUPLICATED (never doubled); formula budget hand-computed', () => {
  const db = makeDb();
  seedKpiWeek(db); // salaried term £1,400 from the last settled week
  seedBudgetWeek(db, '2026-07-27', 7, 400000); // £4,000/day × 7 = £28,000, duplicated across depts
  const body = renderTab(db, { tab: 'forecast' });
  assert.ok(body.includes('£28,000.00'), 'basis = Σ deduplicated daily targets');
  assert.ok(!body.includes('£56,000.00'), 'the per-dept duplicate rows are NEVER double-counted (the dedup gotcha)');
  assert.ok(body.includes('deduplicated'), 'the dedup is stated on-panel');
  assert.ok(body.includes('published RC daily revenue targets'), 'the basis is named');
  // budget: salaried £1,400 + 22.4% × £28,000 = £6,272 → £7,672; K 14.3% = £4,004; F 8.1% = £2,268
  assert.ok(body.includes('£4,004.00'), 'kitchen variable = 14.3% × net');
  assert.ok(body.includes('£2,268.00'), 'FOH variable = 8.1% × net');
  assert.ok(body.includes('£1,400.00'), 'the salaried term (last settled week, day-grain constant)');
  assert.ok(body.includes('£7,672.00'), 'formula budget total');
  assert.ok(body.includes('2026-07-27') && body.includes('2026-08-02'), 'next week window named');
  assert.ok(body.includes('no published promise'), 'no rota published → the chip says so, no fabricated promise');
});

test('forecast basis B — PROJECTION weekly share (P4 method) when the week is NOT fully published; partial publication stated', () => {
  const db = makeDb();
  seedKpiWeek(db);
  // projection record: one comparable pair (2026-01 vs 2025-01 → simple YTD-YoY ×1.1) + prior-
  // year bases for Jul/Aug 2026. £31,000 × 1.1 = £34,100/mo ÷ 31 days = £1,100/day → week £7,700.
  seedMonth(db, '2025-01', 10000000);
  seedMonth(db, '2026-01', 11000000);
  seedMonth(db, '2025-07', 3100000);
  seedMonth(db, '2025-08', 3100000);
  seedBudgetWeek(db, '2026-07-27', 3, 400000); // only 3 of 7 days published — a partial week is never scaled
  const body = renderTab(db, { tab: 'forecast' });
  assert.ok(body.includes('£7,700.00'), 'weekly share = Σ day-shares of the monthly projection (spans Jul+Aug)');
  assert.ok(body.includes('calendar-day weekly share'), 'the projection basis is named');
  assert.ok(body.includes('simple YTD-YoY'), 'the P4 method promotion is named');
  assert.ok(body.includes('only 3/7 day(s) carry a published target'), 'partial publication stated, never scaled up');
  assert.ok(body.includes('override store absent'), 'the journaled-override degrade is stated (0% applied)');
  // budget: £1,400 + 22.4% × £7,700 = £1,724.80 → £3,124.80
  assert.ok(body.includes('£3,124.80'), 'formula budget on the projection basis');
});

test('forecast promise A — rota_ahead_shifts hourly TRUE (salaried hours carry no £, stated); ruled chip at the delta', () => {
  const db = makeDb();
  seedKpiWeek(db);
  seedBudgetWeek(db, '2026-07-27', 7, 400000); // budget £7,672
  seedAheadShift(db, { date: '2026-07-27', dept: 'kitchen', role: 'Chef', name: 'Rachel Rotaname', mins: 480, basis: 'hourly', truePence: 400000 });
  seedAheadShift(db, { date: '2026-07-28', dept: 'foh', role: 'Server', name: 'Rachel Rotaname', mins: 480, basis: 'hourly', truePence: 350000 });
  seedAheadShift(db, { date: '2026-07-29', dept: 'foh', role: 'Manager', name: 'Simon Salaried', mins: 480, basis: 'salaried', truePence: null });
  const body = renderTab(db, { tab: 'forecast' });
  assert.ok(body.includes('£7,500.00'), 'promise = Σ hourly sched_cost_true_pence');
  assert.ok(body.includes('locked rate × 1.159'), 'the promise costing basis is named');
  assert.ok(body.includes('8.0h salaried'), 'salaried rota hours carry no £ — hours stated, never estimated');
  assert.ok(body.includes('UNDER budget'), 'promise £7,500 vs budget £7,672 → UNDER (ruled classes)');
  assert.ok(body.includes('−£172.00'), 'the delta is a figure');
});

test('forecast promise B — the FORWARD verdict (plannedTruePence, incl. salaried) PREFERRED when its week matches', () => {
  const db = makeDb();
  seedKpiWeek(db);
  seedBudgetWeek(db, '2026-07-27', 7, 400000); // budget £7,672
  seedAheadShift(db, { date: '2026-07-27', dept: 'kitchen', role: 'Chef', name: 'Rachel Rotaname', mins: 480, basis: 'hourly', truePence: 400000 });
  db.prepare(`INSERT INTO rota_review_runs (mode, week_monday, ran_at, status, trigger, report_json) VALUES ('forward', '2026-07-27', ?, 'ok', 'thursday', ?)`)
    .run(NOW - 3600000, JSON.stringify({ weekMonday: '2026-07-27', verdicts: [{ dept: 'kitchen', plannedTruePence: 500000 }, { dept: 'foh', plannedTruePence: 280000 }], items: [], mixNotes: {}, gaps: [] }));
  const body = renderTab(db, { tab: 'forecast' });
  assert.ok(body.includes('£7,800.00'), 'promise = Σ verdict plannedTruePence (K £5,000 + F £2,800)');
  assert.ok(body.includes('FORWARD verdict'), 'the canonical source is named');
  assert.ok(body.includes('£5,000.00') && body.includes('£2,800.00'), 'per-dept promise shown');
  assert.ok(body.includes('OVER £128.00'), 'promise £7,800 vs budget £7,672 → OVER beyond the £45 materiality');
});

test('five-band curve: levels are OBSERVED weekly-net quantiles (seeded 26 full weeks, hand-computed); % falls as net rises; never hand-set', () => {
  const db = makeDb();
  // 26 full weeks 2026-01-19 → 2026-07-19; week i daily net = £3,000 + i×£100 → weekly £21,000 … £38,500
  const sd = db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence) VALUES (?, ?)`);
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 7; j++) sd.run(addDays('2026-01-19', i * 7 + j), 300000 + i * 10000);
  }
  // the salaried term: £200/day over the last settled labour week
  const ld = db.prepare(`INSERT INTO labour_day (business_date, actual_minutes, actual_cost_pence, salaried_cost_pence) VALUES (?, 3000, 90000, 20000)`);
  for (let i = 13; i <= 19; i++) ld.run(`2026-07-${i}`);
  const body = renderTab(db, { tab: 'forecast' });
  // quantiles (nearest-rank on 26 sorted weeks): min/p25/p50/p75/max
  for (const level of ['£21,000.00', '£25,200.00', '£30,100.00', '£34,300.00', '£38,500.00']) {
    assert.ok(body.includes(level), `derived band level ${level}`);
  }
  // % endpoints: (1400 + 0.224×21000)/21000 = 29.1%; (1400 + 0.224×38500)/38500 = 26.0%
  assert.ok(body.includes('29.1%'), 'Low-band % (salaried fixed → highest %)');
  assert.ok(body.includes('26.0%'), 'High-band % (the curve falls as net rises)');
  assert.ok(body.includes('observed weekly-net quantiles'), 'the derivation is captioned');
  assert.ok(body.includes('never hand-set'), 'the ruling is stated');
  assert.ok(body.includes('26 full week(s) used'), 'the week count is labelled');
});

test('eight-week outlook: published week vs the rest — an unpublished week SAYS so, never a zero', () => {
  const db = makeDb();
  seedKpiWeek(db);
  seedBudgetWeek(db, '2026-07-27', 7, 400000);
  seedAheadShift(db, { date: '2026-07-27', dept: 'kitchen', role: 'Chef', name: 'Rachel Rotaname', mins: 480, basis: 'hourly', truePence: 400000 });
  const body = renderTab(db, { tab: 'forecast' });
  assert.ok(body.includes('w/c 2026-07-27') && body.includes('w/c 2026-08-03'), 'weeks named');
  assert.ok(body.includes('rota not published'), 'unpublished weeks say so');
  assert.ok(body.includes('never a zero, never an estimate'), 'the honesty pledge is on-panel');
});

test('forward management view: day+dept AGGREGATES (hours + hourly TRUE £; salaried = uncosted hours, stated)', () => {
  const db = makeDb();
  seedAheadShift(db, { date: '2026-07-24', dept: 'kitchen', role: 'Chef', name: 'Rachel Rotaname', mins: 480, basis: 'hourly', truePence: 55632 });
  seedAheadShift(db, { date: '2026-07-24', dept: 'kitchen', role: 'Chef', name: 'Rachel Rotaname', mins: 480, basis: 'hourly', truePence: 55632 });
  seedAheadShift(db, { date: '2026-07-24', dept: 'foh', role: 'Manager', name: 'Simon Salaried', mins: 480, basis: 'salaried', truePence: null });
  const body = renderTab(db, { tab: 'forecast' });
  assert.ok(body.includes('16.0h'), 'kitchen hours aggregated (2 × 8h)');
  assert.ok(body.includes('£1,112.64'), 'kitchen £ = Σ hourly sched_cost_true_pence');
  assert.ok(body.includes('8.0h'), 'FOH salaried hours render');
  assert.ok(body.includes('uncosted'), 'salaried/unmapped hours are UNCOSTED, stated — never estimated');
  assert.ok(body.includes('NO NAMES') || body.includes('NO names'), 'the surveillance boundary is named on-panel');
});

test('NO-NAMES extended: a name seeded into rota_ahead_shifts.user_name never renders on ANY tab', () => {
  const db = makeDb();
  seedKpiWeek(db);
  seedBudgetWeek(db, '2026-07-27', 7, 400000);
  seedAheadShift(db, { date: '2026-07-24', dept: 'kitchen', role: 'Chef', name: 'Rachel Rotaname', mins: 480, basis: 'hourly', truePence: 55632 });
  seedAheadShift(db, { date: '2026-07-28', dept: 'foh', role: 'Manager', name: 'Simon Salaried', mins: 480, basis: 'salaried', truePence: null });
  for (const tabKey of ['executive', 'forecast', 'rota', 'kitchen', 'foh', 'coverage']) {
    const body = renderTab(db, { tab: tabKey });
    for (const name of ['Rachel Rotaname', 'Simon Salaried']) {
      assert.ok(!body.includes(name), `${tabKey}: rota_ahead_shifts name "${name}" must never render`);
    }
  }
});

test('what-if slider is CLIENT-side only: no fetch, no /api/ reference, nothing stored — captioned', () => {
  const db = makeDb();
  seedKpiWeek(db);
  seedBudgetWeek(db, '2026-07-27', 7, 400000);
  const body = renderTab(db, { tab: 'forecast' });
  assert.ok(body.includes('wf-range') && body.includes('data-net="2800000"'), 'the slider carries its basis as data');
  assert.ok(body.includes('what-if only, nothing stored'), 'the pledge is captioned');
  assert.ok(body.includes('textContent'), 'the script mutates textContent only (stated)');
  assert.ok(!body.includes('fetch('), 'no network call in the page script');
  assert.ok(!body.includes('/api/'), 'no /api/ reference anywhere on the forecast tab');
  assert.ok(!body.includes('POST'), 'no POST path');
});

// ---------------- KITCHEN / FRONT OF HOUSE (mirror) ----------------

// Dept fixture on top of the KPI week: kitchen £400/day RC (£450 on the 19th), 25h/day;
// FOH £200/day RC, 11.67h/day.
function seedDeptWeek(db) {
  const ld = db.prepare(`INSERT INTO labour_dept (business_date, department, sched_minutes, act_minutes, sched_cost_rc_pence, act_cost_rc_pence, rc_uncosted_sched_min, rc_uncosted_act_min, rc_uncosted_names) VALUES (?,?,?,?,?,?,0,0,'[]')`);
  for (let i = 13; i <= 19; i++) {
    ld.run(`2026-07-${i}`, 'kitchen', 1500, 1500, 40000, i === 19 ? 45000 : 40000);
    ld.run(`2026-07-${i}`, 'foh', 700, 700, 20000, 20000);
  }
}

test('kitchen day performance: variable TRUE (RC × 1.159) vs 14.3% × net, £45-classed; dept SPLH REFUSED — dept hours + site SPLH context', () => {
  const db = makeDb();
  seedKpiWeek(db);
  seedDeptWeek(db);
  const body = renderTab(db, { tab: 'kitchen' });
  assert.ok(body.includes('£463.60'), 'kitchen variable TRUE = £400 RC × 1.159');
  assert.ok(body.includes('£429.00'), 'variable budget = 14.3% × £3,000 net');
  assert.ok(body.includes('+£34.60'), 'the daily delta is a figure');
  assert.ok(body.includes('On budget'), 'delta £34.60 ≤ £45 materiality → on budget');
  assert.ok(body.includes('Over £92.55'), 'the 19th: £450 × 1.159 − £429 = £92.55 → OVER beyond £45');
  assert.ok(body.includes('25.0h'), 'dept hours column (labour_dept minute grain)');
  assert.ok(body.includes('£60.00'), 'site SPLH context = £3,000 ÷ 50 site hours');
  assert.ok(body.includes('would be dishonest'), 'the dept-SPLH refusal is captioned, not silent');
  assert.ok(body.includes('cancels'), 'the salaried-cancels basis (L1 dept-control discipline) is captioned');
  assert.ok(body.includes('no Kitchen dept record'), 'days without a dept row say so — never zeros');
});

test('dept mirror parity: kitchen and FOH share ONE structure (day performance · role mix · demand vs staffing · decision ratios) with the ruled dept splits', () => {
  const db = makeDb();
  seedKpiWeek(db);
  seedDeptWeek(db);
  const kitchen = renderTab(db, { tab: 'kitchen' });
  const foh = renderTab(db, { tab: 'foh' });
  for (const [body, name, rate] of [[kitchen, 'Kitchen', '14.3%'], [foh, 'Front of House', '8.1%']]) {
    assert.ok(body.includes(`Day performance — ${name}`), `${name}: day performance panel`);
    assert.ok(body.includes(`Role mix — ${name}`), `${name}: role mix panel`);
    assert.ok(body.includes(`Demand vs staffing — ${name}`), `${name}: demand panel`);
    assert.ok(body.includes(`Decision ratios — ${name}`), `${name}: ratios panel`);
    assert.ok(body.includes(rate), `${name}: the ruled ${rate} variable split`);
  }
  assert.ok(!kitchen.includes('8.1%') || kitchen.includes('14.3%'), 'kitchen leads with its own split');
});

test('role mix disposition: FUTURE role mix from rota_ahead_shifts (dept+role live there) where present; the named gap otherwise', () => {
  const db = makeDb();
  seedKpiWeek(db);
  // kitchen HAS a published forward rota with roles; FOH has none
  seedAheadShift(db, { date: '2026-07-24', dept: 'kitchen', role: 'Chef', name: 'Rachel Rotaname', mins: 480, basis: 'hourly', truePence: 55632 });
  seedAheadShift(db, { date: '2026-07-25', dept: 'kitchen', role: 'Chef', name: 'Rachel Rotaname', mins: 480, basis: 'hourly', truePence: 55632 });
  seedAheadShift(db, { date: '2026-07-25', dept: 'kitchen', role: 'KP', name: 'Rachel Rotaname', mins: 480, basis: 'hourly', truePence: 40000 });
  const kitchen = renderTab(db, { tab: 'kitchen' });
  assert.ok(kitchen.includes('Chef') && kitchen.includes('16.0h · 2 shift(s)'), 'role hours aggregated');
  assert.ok(kitchen.includes('KP') && kitchen.includes('8.0h · 1 shift(s)'), 'second role');
  assert.ok(kitchen.includes('published rota, forward-looking'), 'the forward-only basis is captioned');
  assert.ok(kitchen.includes('NO department key (checked)'), 'the settled-wire gap is stated');
  const foh = renderTab(db, { tab: 'foh' });
  assert.ok(foh.includes('RotaCloud role export decision'), 'FOH (no forward rota): the designed gap names its unlock');
  assert.ok(foh.includes('not wired'), 'the gap renders as the designed empty state, no mock numbers');
});

test('demand vs staffing: DAILY pairing (site net vs dept hours, two scales) — the hourly overlay is named as needing dept-keyed hourly grain', () => {
  const db = makeDb();
  seedKpiWeek(db);
  seedDeptWeek(db);
  const body = renderTab(db, { tab: 'kitchen' });
  assert.ok(body.includes('£3,000.00 net · 25.0h Kitchen'), 'the pairing tooltip carries both sides, hand-checked');
  assert.ok(body.includes('two independent scales'), 'a pairing, not a ratio — stated');
  assert.ok(body.includes('demand is SITE-wide'), 'no dept-keyed demand exists — stated');
  assert.ok(body.includes('labour_hourly carries no department key (checked)'), 'the hourly staffing gap is named');
  assert.ok(body.includes('ONLINE excluded'), 'the no-true-hour ruling is named for the future hourly version');
});

test('decision ratios: variable % vs the ruled target, hours share, MIX note VERBATIM, covers OpenTable-gated at zero digits', () => {
  const db = makeDb();
  seedKpiWeek(db);
  seedDeptWeek(db);
  db.prepare(`INSERT INTO rota_review_runs (mode, week_monday, ran_at, status, trigger, report_json) VALUES ('forward', '2026-07-20', ?, 'ok', 'thursday', ?)`)
    .run(NOW - 3600000, JSON.stringify({ weekMonday: '2026-07-20', verdicts: [], items: [], mixNotes: { kitchen: 'senior-heavy Sat PM — 3 of 4 line seniors on together' }, gaps: [] }));
  const kitchen = renderTab(db, { tab: 'kitchen' });
  // kitchen var: (6×£400 + £450) × 1.159 = £3,303.15 ÷ £21,000 = 15.7%
  assert.ok(kitchen.includes('15.7%'), 'kitchen variable % of net (intersection days)');
  assert.ok(kitchen.includes('7 intersection day(s)'), 'the day-count is labelled (cross-ruler discipline)');
  assert.ok(kitchen.includes('68.2%'), 'kitchen share of labour hours = 10,500 ÷ 15,400 min');
  assert.ok(kitchen.includes('senior-heavy Sat PM — 3 of 4 line seniors on together'), 'the MIX note renders VERBATIM');
  assert.ok(kitchen.includes('OpenTable-gated'), 'covers-per-hour stays gated');
  assert.ok(!/Covers per labour hour[\s\S]{0,80}\d/.test(kitchen), 'covers card carries ZERO digits');
  const foh = renderTab(db, { tab: 'foh' });
  // FOH var: 7×£200 × 1.159 = £1,622.60 ÷ £21,000 = 7.7%
  assert.ok(foh.includes('7.7%'), 'FOH variable % of net');
  assert.ok(foh.includes('MIX foh: —'), 'no MIX note for FOH → an honest dash, never invented');
});

test('June hole: a dept window crossing June STATES the hole with its blocker, never bridges', () => {
  const db = makeDb();
  db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence) VALUES ('2026-07-02', 100000)`).run();
  db.prepare(`INSERT INTO labour_day (business_date, actual_minutes, actual_cost_pence, salaried_cost_pence) VALUES ('2026-07-02', 600, 30000, 0)`).run();
  db.prepare(`INSERT INTO labour_dept (business_date, department, sched_minutes, act_minutes, sched_cost_rc_pence, act_cost_rc_pence, rc_uncosted_sched_min, rc_uncosted_act_min, rc_uncosted_names) VALUES ('2026-07-02','kitchen',300,300,10000,10000,0,0,'[]')`).run();
  const body = renderTab(db, { tab: 'kitchen' });
  assert.ok(body.includes('June 2026 hole'), 'the hole is named');
  assert.ok(body.includes('Leon Mackay'), 'with its blocker');
  assert.ok(body.includes('never zero'), 'absent days are absent, not zeros');
});

test('empty DB (all tables present, zero rows): honest states on all three L2 tabs, zero £ data values, no throw', () => {
  const db = makeDb();
  for (const tabKey of ['forecast', 'kitchen', 'foh']) {
    const body = renderTab(db, { tab: tabKey });
    assert.ok(!/NaN|Infinity|undefined/.test(body), `${tabKey}: no fabricated value`);
    assert.ok(!/£\d[\d,]*\.\d{2}/.test(body), `${tabKey}: no £ data value invented from an empty DB`);
  }
  const fc = renderTab(db, { tab: 'forecast' });
  assert.ok(fc.includes('no net basis for next week'), 'forecast: the basis blocker is named');
  assert.ok(fc.includes('never hand-set'), 'forecast: the band ruling still stated (canon, not data)');
  assert.ok(fc.includes('no published forward rota'), 'forecast: forward view says why it is empty');
  const kt = renderTab(db, { tab: 'kitchen' });
  assert.ok(kt.includes('not wired'), 'kitchen: designed empty states, no mock numbers');
});
