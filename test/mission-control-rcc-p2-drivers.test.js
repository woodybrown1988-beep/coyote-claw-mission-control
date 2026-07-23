'use strict';
// RCC Stage 2 P2 — the REVENUE DRIVERS tab. Every expected number is HAND-COMPUTED in the
// fixture comments, never re-derived through the module. Pinned here:
//   (a) KPI STRIP (28d to the per-receipt max): revenue/trading-hour = timed line net ÷
//       distinct (day, London hour) buckets, ONLINE excluded; SPLH = the cross-ruler
//       intersection (sales∩labour days only); peak hour '18:00 £X'; attachment % on the
//       DICT classes — the four ruled drink names + the pure FRYER family (a MISC DRINKS /
//       GRIDDLE-FRYER decoy must never count); covers/txn = not wired with ZERO digits;
//   (b) HEATMAP: Mon–Sun × 11:00–21:00, levels 1–6 by quantile of nonzero cells, no-data
//       cells UNCLASSED, the ONLINE-excluded £ stated, material outside-hours trade noted;
//   (c) CAPACITY: the designed empty-state — the mock's column headers, zero data rows,
//       zero digits, OpenTable named;
//   (d) SCORECARD: last-14-days rows, a missing sales day = an ABSENT row; STATUS from the
//       RULED formula (budget = salaried + 22.4%×net; OVER only beyond the £45 materiality —
//       the threshold arithmetic is pinned at the boundary); YoY premises-guarded;
//   (e) NO-MOCK-NUMBERS: an EMPTY db renders zero £-figures on the tab.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const reports = require('../mission-control/ui/pages/coyote/reports.js');

const NOW = 1783000000000; // 2026-07 (the p1p4 anchor)
const pad = (n) => String(n).padStart(2, '0');

const DDL = `
CREATE TABLE premises_regime (name TEXT PRIMARY KEY, start_date TEXT, end_date TEXT, note TEXT);
CREATE TABLE sales_day (business_date TEXT PRIMARY KEY, net_sales_pence INTEGER, gross_sales_pence INTEGER, pos_guest_count INTEGER, transactions INTEGER, taxes_pence INTEGER, refunds_pence INTEGER, voids_pence INTEGER, discounts_pence INTEGER, comps_pence INTEGER, service_charges_pence INTEGER, tips_pence INTEGER, updated_at INTEGER);
CREATE TABLE sales_day_history (business_date TEXT PRIMARY KEY, net_sales_pence INTEGER, gross_sales_pence INTEGER, pos_guest_count INTEGER, transactions INTEGER, taxes_pence INTEGER, refunds_pence INTEGER, voids_pence INTEGER, discounts_pence INTEGER, comps_pence INTEGER, service_charges_pence INTEGER, tips_pence INTEGER, updated_at INTEGER);
CREATE VIEW v_sales_day_all AS
  SELECT business_date, net_sales_pence, gross_sales_pence, pos_guest_count, transactions, taxes_pence, refunds_pence, voids_pence, discounts_pence, comps_pence, service_charges_pence, tips_pence, 'live' AS source,
         CASE WHEN business_date >= (SELECT start_date FROM premises_regime WHERE name='current') THEN 'current' ELSE 'previous' END AS premises FROM sales_day
  UNION ALL
  SELECT business_date, net_sales_pence, gross_sales_pence, pos_guest_count, transactions, taxes_pence, refunds_pence, voids_pence, discounts_pence, comps_pence, service_charges_pence, tips_pence, 'history' AS source,
         CASE WHEN business_date >= (SELECT start_date FROM premises_regime WHERE name='current') THEN 'current' ELSE 'previous' END AS premises FROM sales_day_history WHERE business_date NOT IN (SELECT business_date FROM sales_day);
CREATE TABLE sales_receipts_api (receipt_id TEXT PRIMARY KEY, business_date TEXT, type TEXT, cancelled INTEGER, account_profile_code TEXT, net_without_tax_pence INTEGER, updated_at INTEGER);
CREATE TABLE sales_receipt_lines_api (receipt_id TEXT, line_id TEXT, business_date TEXT, net_without_tax_pence INTEGER, accounting_group TEXT, time_of_sale_ms INTEGER, updated_at INTEGER, PRIMARY KEY (receipt_id, line_id));
CREATE TABLE sales_api_ingest_runs (business_date TEXT, source TEXT, status TEXT, receipts INTEGER, detail TEXT, pulled_at INTEGER, PRIMARY KEY (business_date, source));
CREATE TABLE sales_channel_map_api (account_profile_code TEXT PRIMARY KEY, profile_name TEXT, delivery_mode TEXT, channel_label TEXT, first_seen INTEGER, updated_at INTEGER, label_source TEXT);
CREATE TABLE acct_groups_api (code TEXT PRIMARY KEY, name TEXT, statistic_group TEXT, updated_at INTEGER);
CREATE TABLE labour_day (business_date TEXT PRIMARY KEY, scheduled_minutes INTEGER, actual_minutes INTEGER, actual_paid_minutes INTEGER, scheduled_cost_pence INTEGER, actual_cost_pence INTEGER, salaried_cost_pence INTEGER, unmapped_scheduled_minutes INTEGER, unmapped_actual_minutes INTEGER, unmapped_names TEXT, anomalies TEXT, staff_scheduled INTEGER, staff_worked INTEGER, updated_at INTEGER);
`;

function makeDb({ premisesStart = '2023-04-01' } = {}) {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(DDL);
  db.prepare(`INSERT INTO premises_regime VALUES ('previous','2022-02-20',?,''),('current',?,NULL,'moved')`)
    .run(premisesStart, premisesStart);
  db.prepare(`INSERT INTO sales_channel_map_api VALUES
    ('LOCAL','Local','NONE','EAT IN',1,1,'operator'),
    ('storekit_orderpay','Storekit','NONE','STOREKIT ORDER & PAY',1,1,'operator'),
    ('online','Online','DELIVERY','ONLINE ORDER',1,1,'operator')`).run();
  // the dict — the four ruled drink classes, the pure FRYER family, and the DECOYS that a
  // sloppy filter would swallow: MISC DRINKS (name-LIKE drink, not a ruled class),
  // GRIDDLE FRYER MELTS (FRYER+GRIDDLE = a main) and FRYER BUN ROLLS (FRYER+BUN = a main).
  db.prepare(`INSERT INTO acct_groups_api VALUES
    ('26','HOT DRINKS',NULL,1),('27','SOFT DRINKS',NULL,1),('28','ALCOHOL',NULL,1),('29','SHAKES',NULL,1),
    ('10','FRYER SIDES',NULL,1),('11','FRYER LOADED',NULL,1),('12','FRYER EXTRAS',NULL,1),
    ('13','GRIDDLE FRYER MELTS',NULL,1),('14','FRYER BUN ROLLS',NULL,1),
    ('17','MAINS',NULL,1),('30','MISC DRINKS',NULL,1)`).run();
  return db;
}

/** Drivers world. Per-receipt max = 2026-07-11 → 28d window 2026-06-14..07-11 (prior window
 *  2026-05-17..06-13). London is BST (UTC+1) throughout.
 *
 *  Timed non-ONLINE line buckets (net pence → heat cell):
 *    Fri 07-10 18:00  £400.00 (F1: £250 MAINS + £150 SOFT DRINKS)   → top cell
 *    Fri 07-10 19:00  £300.00 (F2)
 *    Thu 07-09 18:00  £200.00 (T1, HOT DRINKS)
 *    Mon 07-06 12:00  £150.00 (M1 £100 FRYER SIDES + M2 £50 FRYER LOADED, one UTC bucket)
 *    Sat 07-11 22:00  £100.00 (S1) — OUTSIDE the 11–21 grid (material: 8.7% > 2%)
 *  → timed net £1,150.00 over 5 distinct (day, hour) buckets → £230/trading hour;
 *    peak hour 18:00 = £400 + £200 = £600; quantile levels over the 4 grid cells
 *    [150,200,300,400] → l2 / l3 / l5 / l6.
 *  ONLINE: OO1 £50.00 at 18:00 — excluded from every hour figure, stated in the caption.
 *
 *  Attachment (10 sale receipts in the window: F1 F2 T1 M1 M2 S1 G1 D3 D4 OO1):
 *    drink = F1,T1,D3,D4 → 40.0% (F2's MISC DRINKS line must NOT count — 50.0% = the bug);
 *    side  = M1,M2      → 20.0% (G1's GRIDDLE FRYER line must NOT count — 30.0% = the bug);
 *    prior window (5 receipts on 06-01): drink 1/5 = 20% → ▲ 20.0 pp; side 2/5 = 40% → ▼ 20.0 pp.
 */
function seedDrivers(db) {
  const insR = db.prepare(`INSERT INTO sales_receipts_api VALUES (?,?,?,0,?,?,1)`);
  const insL = db.prepare(`INSERT INTO sales_receipt_lines_api VALUES (?,?,?,?,?,?,1)`);
  insR.run('F1', '2026-07-10', 'SALE', 'LOCAL', 40000);
  insL.run('F1', 'l1', '2026-07-10', 25000, '17', Date.UTC(2026, 6, 10, 17, 30)); // 18:30 London
  insL.run('F1', 'l2', '2026-07-10', 15000, '27', Date.UTC(2026, 6, 10, 17, 30));
  insR.run('F2', '2026-07-10', 'SALE', 'LOCAL', 30100);
  insL.run('F2', 'l1', '2026-07-10', 30000, '17', Date.UTC(2026, 6, 10, 18, 15)); // 19:15 London
  insL.run('F2', 'l2', '2026-07-10', 100, '30', 0); // MISC DRINKS decoy, untimed
  insR.run('T1', '2026-07-09', 'SALE', 'LOCAL', 20000);
  insL.run('T1', 'l1', '2026-07-09', 20000, '26', Date.UTC(2026, 6, 9, 17, 45)); // 18:45 London
  insR.run('M1', '2026-07-06', 'SALE', 'LOCAL', 10000);
  insL.run('M1', 'l1', '2026-07-06', 10000, '10', Date.UTC(2026, 6, 6, 11, 30)); // 12:30 London
  insR.run('M2', '2026-07-06', 'SALE', 'LOCAL', 5000);
  insL.run('M2', 'l1', '2026-07-06', 5000, '11', Date.UTC(2026, 6, 6, 11, 40)); // 12:40 London
  insR.run('S1', '2026-07-11', 'SALE', 'LOCAL', 10000);
  insL.run('S1', 'l1', '2026-07-11', 10000, '17', Date.UTC(2026, 6, 11, 21, 20)); // 22:20 London
  insR.run('G1', '2026-07-10', 'SALE', 'LOCAL', 8000);
  insL.run('G1', 'l1', '2026-07-10', 8000, '13', 0); // GRIDDLE FRYER decoy, untimed
  insR.run('D3', '2026-07-08', 'SALE', 'LOCAL', 1000);
  insL.run('D3', 'l1', '2026-07-08', 1000, '29', 0);
  insR.run('D4', '2026-07-07', 'SALE', 'LOCAL', 1000);
  insL.run('D4', 'l1', '2026-07-07', 1000, '28', 0);
  insR.run('OO1', '2026-07-10', 'SALE', 'online', 5000);
  insL.run('OO1', 'l1', '2026-07-10', 5000, '17', Date.UTC(2026, 6, 10, 17, 0)); // ONLINE — excluded
  // prior 28d window (2026-05-17..06-13): 5 receipts, 1 drink, 2 sides (code 12 pins FRYER EXTRAS)
  const prior = [['P1', '27'], ['P2', '12'], ['P3', '10'], ['P4', '17'], ['P5', '17']];
  for (const [id, grp] of prior) {
    insR.run(id, '2026-06-01', 'SALE', 'LOCAL', 1000);
    insL.run(id, 'l1', '2026-06-01', 1000, grp, 0);
  }

  /** Scorecard world: sales_day 2026-06-29..07-12 (maxDate 07-12 → 14-day window is exactly
   *  06-29..07-12), £1,000.00 net + £20.00 discounts (2.0%) each day — EXCEPT 2026-07-01,
   *  deliberately absent → the row must be ABSENT, never zeros.
   *  Labour (budget = salaried £200 + 22.4% × £1,000 = £424.00; materiality £45):
   *    07-09: actual £469.00 = budget + £45.00 EXACTLY → NOT over (strict >) → On formula
   *    07-10: actual £500.00 = budget + £76.00 > £45  → Over £76.00 (bad)
   *    07-11: actual £300.00 ≤ budget                 → Under formula (good)
   *    every other day: no labour_day row             → 'no labour' neutral chip
   *  SPLH (28d window 06-14..07-11 ∩ labour): days 09/10/11 → £3,000.00 net ÷ 27h = £111.11.
   *  YoY: history 2025-07-11 £800.00 = the −364d twin of 2026-07-10 → +25.0%; others '—'. */
  const day = db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence, discounts_pence, transactions, updated_at) VALUES (?,?,?,50,1)`);
  for (let d = 29; d <= 30; d++) day.run(`2026-06-${pad(d)}`, 100000, 2000);
  for (let d = 2; d <= 12; d++) day.run(`2026-07-${pad(d)}`, 100000, 2000);
  db.prepare(`INSERT INTO sales_day_history (business_date, net_sales_pence, updated_at) VALUES ('2025-07-11', 80000, 1)`).run();
  const lab = db.prepare(`INSERT INTO labour_day (business_date, actual_minutes, actual_cost_pence, salaried_cost_pence, updated_at) VALUES (?,?,?,20000,1)`);
  lab.run('2026-07-09', 540, 46900);
  lab.run('2026-07-10', 600, 50000);
  lab.run('2026-07-11', 480, 30000);
}

const render = (db) => {
  const ctx = { q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, query: { tab: 'drivers' } };
  return reports.render(reports.getSection(db, ctx), ctx).body;
};

// ---------------- (a) the KPI strip ----------------

test('KPI strip: rev/trading-hour, SPLH intersection, peak hour — hand-computed, sources captioned', () => {
  const db = makeDb();
  seedDrivers(db);
  const body = render(db);
  // £1,150.00 timed non-ONLINE net ÷ 5 distinct (day, hour) buckets = £230/trading hour
  assert.match(body, /Revenue \/ trading hour<\/div><div class="r-kpi-value">£230</, 'the hand-computed figure');
  assert.match(body, /5 observed \(day, hour\) buckets · ONLINE excluded/, 'the basis is captioned');
  // SPLH: £3,000.00 ÷ (1620/60 = 27h) = £111.11 — intersection days ONLY (06-29..07-08 hold
  // sales but no labour and must NOT dilute the figure)
  assert.match(body, /Sales \/ labour hour<\/div><div class="r-kpi-value">£111\.11</, 'intersection arithmetic');
  assert.match(body, /cross-ruler intersection days only · 3 day\(s\)/, 'the discipline is captioned');
  // peak: 18:00 = £400 + £200 = £600
  assert.match(body, /Peak revenue hour<\/div><div class="r-kpi-value">18:00 £600</);
  // window + line-grain source named once for the strip
  assert.match(body, /28d to 2026-07-11 \(per-receipt max\) · line grain \(sales_receipt_lines_api\)/);
  db.close();
});

test('attachment %: dict-class filter pinned — decoys never count; deltas vs prior 28d in pp', () => {
  const db = makeDb();
  seedDrivers(db);
  const body = render(db);
  // drink 4/10 = 40.0% (MISC DRINKS would make it 50.0% — the bug); prior 1/5 = 20% → ▲ 20.0 pp
  assert.match(body, /Drink attachment<\/div><div class="r-kpi-value">40\.0%</);
  assert.match(body, /r-delta r-up">▲ 20\.0 pp/, 'drink delta vs prior 28d');
  assert.doesNotMatch(body, /50\.0%/, 'a name-LIKE drink filter would swallow MISC DRINKS');
  // side 2/10 = 20.0% (GRIDDLE FRYER MELTS would make it 30.0%); prior 2/5 = 40% → ▼ 20.0 pp
  assert.match(body, /Side attachment<\/div><div class="r-kpi-value">20\.0%</);
  assert.match(body, /r-delta r-down">▼ 20\.0 pp/, 'side delta vs prior 28d');
  assert.doesNotMatch(body, /30\.0%/, 'the FRYER-but-GRIDDLE hybrid is a main, never a side');
  // the caption names the dict classes actually used — the ruled basis, stated
  assert.match(body, /drink classes: HOT DRINKS \+ SOFT DRINKS \+ ALCOHOL \+ SHAKES/);
  assert.match(body, /sides = FRYER-station classes: FRYER SIDES \+ FRYER LOADED \+ FRYER EXTRAS/);
  db.close();
});

test('covers / transaction: honest fallback with no covers rows, OpenTable named, ZERO digits in the tile', () => {
  const db = makeDb();
  seedDrivers(db);
  const body = render(db);
  // this fixture holds no covers_day rows → the sanity tile is honest ('—'); the WIRED ~1.9-2.0
  // value is proven in mission-control-covers-wire.test.js.
  const tile = body.match(/<div class="r-kpi-label">Covers \/ transaction<\/div>[\s\S]*?<\/div><\/div>/);
  assert.ok(tile, 'the tile renders');
  assert.match(tile[0], /no covers in the window/);
  assert.match(tile[0], /OpenTable/);
  assert.doesNotMatch(tile[0], /\d/, 'POS guest-count is never covers — no digits at all');
  db.close();
});

// ---------------- (b) the heatmap ----------------

test('heatmap: quantile levels on nonzero cells, no-data cells UNCLASSED, ONLINE £ + outside-hours note', () => {
  const db = makeDb();
  seedDrivers(db);
  const body = render(db);
  // 4 grid cells [150,200,300,400] → quantile levels l2/l3/l5/l6 (ceil(rank/n × 6))
  assert.ok(body.includes('<div class="r-cell r-l6" data-tip="Fri 18:00 — £400.00">'), 'top cell = l6');
  assert.ok(body.includes('<div class="r-cell r-l5" data-tip="Fri 19:00 — £300.00">'), '3rd quartile = l5');
  assert.ok(body.includes('<div class="r-cell r-l3" data-tip="Thu 18:00 — £200.00">'), 'median = l3');
  assert.ok(body.includes('<div class="r-cell r-l2" data-tip="Mon 12:00 — £150.00">'), 'bottom cell = l2, two lines merged into one bucket');
  // 7 dow × 11 hours = 77 cells; exactly 4 carry a level — a no-data cell is UNCLASSED, never l1
  assert.equal((body.match(/class="r-cell/g) || []).length, 77, 'the full Mon–Sun × 11:00–21:00 grid');
  assert.equal((body.match(/r-cell r-l/g) || []).length, 4, 'only observed cells are shaded');
  assert.match(body, /shade = revenue density/, 'the ramp is named, not implied');
  // the £50.00 ONLINE order is excluded from hour attribution and STATED
  assert.match(body, /£50\.00 ONLINE excluded — no true hour/);
  // Sat 22:20 (£100 = 8.7% of the window, > 2%) is outside the grid → honest note, never silence
  assert.match(body, /£100\.00 traded outside the 11:00–21:00 grid/);
  db.close();
});

// ---------------- (c) capacity — the designed not-wired state ----------------

test('capacity and demand conversion: the mock headers render with ZERO data rows and ZERO digits', () => {
  const db = makeDb();
  seedDrivers(db);
  const body = render(db);
  const start = body.indexOf('Capacity and demand conversion');
  const end = body.indexOf('Daily trading scorecard');
  assert.ok(start >= 0 && end > start, 'the panel renders before the scorecard');
  const panel = body.slice(start, end);
  assert.match(panel, /<th>Window<\/th>/);
  assert.match(panel, /<th class="r-num">Seat use<\/th>/);
  assert.match(panel, /<th class="r-num">RevPASH<\/th>/);
  assert.match(panel, /<th class="r-num">Wait \/ lost<\/th>/);
  assert.match(panel, /<th>Decision<\/th>/);
  assert.doesNotMatch(panel, /<tbody>/, 'zero data rows');
  assert.match(panel, /OpenTable email wire/, 'the blocker is named');
  assert.doesNotMatch(panel.replace(/<[^>]*>/g, ''), /\d/, 'a designed empty-state never SHOWS a digit');
  db.close();
});

// ---------------- (d) the scorecard ----------------

test('scorecard: STATUS chips from the RULED formula — the £45 threshold arithmetic pinned at the boundary', () => {
  const db = makeDb();
  seedDrivers(db);
  const body = render(db);
  // budget = £200 salaried + 22.4% × £1,000 = £424.00; materiality £45:
  //   07-10 actual £500.00 → over by £76.00 > £45 → bad chip carrying its £
  assert.ok(body.includes('<span class="r-tag bad">Over £76.00</span>'), 'OVER beyond materiality');
  //   07-09 actual £469.00 → over by EXACTLY £45.00 → NOT material (strict >) → good chip
  assert.ok(body.includes('<span class="r-tag good">On formula</span>'), 'the boundary day is not OVER');
  //   07-11 actual £300.00 ≤ budget → good
  assert.ok(body.includes('<span class="r-tag good">Under formula</span>'));
  //   a day with sales but no labour_day row → neutral chip, never a fabricated verdict
  assert.ok(body.includes('<span class="r-tag">no labour</span>'));
  assert.match(body, /banded formula, rota-review spec/, 'the ruling is cited');
  assert.match(body, /£45 materiality/);
  db.close();
});

test('scorecard rows: 14-day window, missing day ABSENT, YoY twin, labour hrs / day-SPLH / discount %', () => {
  const db = makeDb();
  seedDrivers(db);
  const body = render(db);
  assert.match(body, /Mon 2026-06-29/, 'the window opens 14 days back from maxDate');
  assert.match(body, /Sun 2026-07-12/, 'maxDate closes the window');
  assert.doesNotMatch(body, /2026-07-01/, 'the missing sales day is an ABSENT row, never zeros');
  // YoY: 2026-07-10 £1,000.00 vs its −364d twin 2025-07-11 £800.00 → +25.0%; a day without a
  // twin says why in the tooltip instead of inventing a %
  assert.match(body, /rp-yoy-up">\+25\.0%/);
  assert.match(body, /title="no LY record \(−364d twin\)"/);
  // labour hrs 600min → 10.0h; day SPLH £1,000 ÷ 10h = £100.00; discounts £20/£1,000 = 2.0%
  assert.match(body, /10\.0h/);
  assert.match(body, /£100\.00/);
  assert.match(body, /2\.0%/);
  // covers + spend/cover stay '—' (not wired); the mock's columns all present
  for (const h of ['Net revenue', 'YoY', 'Covers', 'Spend / cover', 'Labour hrs', 'Sales / labour hr', 'Discount %', 'Status']) {
    assert.ok(body.includes(`>${h}</th>`), `column ${h}`);
  }
  db.close();
});

test('scorecard YoY premises guard: a previous-premises twin renders — with its reason, never a raw %', () => {
  const db = makeDb({ premisesStart: '2025-07-15' }); // the twin lands BEFORE the move
  db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence, discounts_pence, transactions, updated_at) VALUES ('2026-07-10', 100000, 0, 50, 1)`).run();
  db.prepare(`INSERT INTO sales_day_history (business_date, net_sales_pence, updated_at) VALUES ('2025-07-11', 80000, 1)`).run();
  const body = render(db);
  assert.match(body, /title="premises break — no raw YoY"/, 'the guard states its reason');
  assert.doesNotMatch(body, /\+25\.0%/, 'no cross-site % ever renders');
  db.close();
});

// ---------------- (e) no mock numbers ----------------

test('NO-MOCK-NUMBERS: an EMPTY db renders ZERO £-figures on the drivers tab', () => {
  const db = makeDb(); // tables exist, no rows — the honest-empty worst case
  const body = render(db);
  assert.doesNotMatch(body, /£\d/, 'no £-figure may render from an empty box');
  assert.match(body, /not wired|no [a-z-]* ?record|record filling|pending/i, 'honest empty states name themselves');
  assert.match(body, /No per-receipt API record yet/, 'the KPI strip names its blocker');
  db.close();
});
