'use strict';
// Reporting v2 Phase 1 — P1 projection + P2 channel mix. Every expected number below is
// HAND-COMPUTED in the test (explicit arithmetic / direct SQL), never re-derived through the
// module under test. Covers: the seasonality-aware method (window, weights, ratio, full-year),
// the simple YTD-YoY sanity method, the band, the premises guard, MTD handling, gap honesty
// (partial/missing months render as gaps and block the full-year figure with reasons), and the
// page rendering against a fixture DB (values match direct SQL; empty DB renders honestly).
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const REP = require('../mission-control/ui/reporting.js');
const DATA = require('../mission-control/ui/data.js');
const reports = require('../mission-control/ui/pages/coyote/reports.js');

const NOW = Date.UTC(2026, 6, 17, 12, 0); // → nowYm '2026-07'

// ---- fixture maths (pence) ----
// 2025 month nets: 1,000,000 + M×10,000. 2026 Jan–Jun = ratio × same-month 2025.
const NET_2025 = (mm) => 1000000 + mm * 10000;
const RATIOS_2026 = { 1: 1.10, 2: 1.00, 3: 0.90, 4: 1.20, 5: 1.05, 6: 0.95 };
const NET_2026 = (mm) => Math.round(RATIOS_2026[mm] * NET_2025(mm)); // all products are exact ints
const MTD_JUL = 350000;

function fixtureMonths() {
  const apiMonths = [];
  const ledgerMonths = [];
  for (let mm = 1; mm <= 12; mm++) {
    const ym = `2025-${String(mm).padStart(2, '0')}`;
    apiMonths.push({ ym, net: NET_2025(mm), txn: 100 });
    ledgerMonths.push({ ym, days: REP.calDays(ym) });
  }
  for (let mm = 1; mm <= 6; mm++) {
    const ym = `2026-${String(mm).padStart(2, '0')}`;
    apiMonths.push({ ym, net: NET_2026(mm), txn: 100 });
    ledgerMonths.push({ ym, days: REP.calDays(ym) });
  }
  apiMonths.push({ ym: '2026-07', net: MTD_JUL, txn: 30 });
  ledgerMonths.push({ ym: '2026-07', days: 10 });
  return REP.buildMonths({ apiMonths, ledgerMonths, nowYm: '2026-07' });
}

test('projection: window + weights + weighted ratio are exactly the ruled method', () => {
  const months = fixtureMonths();
  const P = REP.computeProjection({ months, year: 2026, nowYm: '2026-07', boundaryDate: '2023-04-01' });
  assert.deepEqual(P.window.map((w) => w.ym), ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']);
  assert.deepEqual(P.window.map((w) => w.weight), [1, 1, 1, 1, 2, 3], 'newest ×3, second-newest ×2, rest ×1');
  // r = (1.10+1.00+0.90+1.20 + 2·1.05 + 3·0.95) / 9 = 9.15/9
  assert.ok(Math.abs(P.ratio - 9.15 / 9) < 1e-9, `ratio ${P.ratio}`);
  assert.ok(Math.abs(P.ratioMin - 0.90) < 1e-9 && Math.abs(P.ratioMax - 1.20) < 1e-9, 'band = min/max window ratio');
});

test('projection: full-year figures match hand arithmetic (seasonal, band, simple)', () => {
  const months = fixtureMonths();
  const P = REP.computeProjection({ months, year: 2026, nowYm: '2026-07', boundaryDate: '2023-04-01' });
  // Σ actual Jan–Jun 2026 = 6,415,500 (hand-summed); Σ 2025 Jul–Dec = 6,570,000.
  const actSum = 1111000 + 1020000 + 927000 + 1248000 + 1102500 + 1007000;
  assert.equal(actSum, 6415500, 'the hand sum itself');
  const lyRemaining = 1070000 + 1080000 + 1090000 + 1100000 + 1110000 + 1120000;
  assert.equal(lyRemaining, 6570000);
  // seasonal = 6,415,500 + (9.15/9)·6,570,000 = 6,415,500 + 6,679,500 = 13,095,000
  assert.ok(Math.abs(P.fullYear.seasonalPence - 13095000) < 1, `seasonal ${P.fullYear.seasonalPence}`);
  // band: low = +0.90·6,570,000 = 12,328,500 · high = +1.20·6,570,000 = 14,299,500
  assert.ok(Math.abs(P.fullYear.lowPence - 12328500) < 1);
  assert.ok(Math.abs(P.fullYear.highPence - 14299500) < 1);
  // simple: ytdRatio = 6,415,500 / 6,210,000; full year = 6,415,500 + ratio·6,570,000
  const ytd = 6415500 / 6210000;
  assert.ok(Math.abs(P.ytdRatio - ytd) < 1e-9);
  assert.ok(Math.abs(P.fullYear.simplePence - (6415500 + ytd * 6570000)) < 1);
  assert.deepEqual(P.fullYear.missing, []);
  // per-month forecast spot-check: Nov = (9.15/9)·1,110,000 = 1,128,500 exactly
  const nov = P.forecast.find((f) => f.ym === '2026-11');
  assert.ok(Math.abs(nov.seasonalPence - 1128500) < 1e-6);
  // MTD is reported separately, never a solid actual
  assert.equal(P.mtdPence, MTD_JUL);
  assert.equal(P.actuals.find((a) => a.ym === '2026-07').kind, 'mtd');
});

test('gap honesty: a partial past month and a missing prior-year month both block the figure with reasons', () => {
  const months = fixtureMonths();
  // 2026-03 becomes a PARTIAL month (10/31 ledger days) → not an actual, listed missing.
  months['2026-03'].okDays = 10;
  months['2026-03'].complete = false;
  // 2025-09 loses its record entirely → Sep 2026 unforecastable.
  delete months['2025-09'];
  const P = REP.computeProjection({ months, year: 2026, nowYm: '2026-07', boundaryDate: '2023-04-01' });
  const mar = P.actuals.find((a) => a.ym === '2026-03');
  assert.equal(mar.kind, 'gap');
  assert.match(mar.reason, /partial API coverage \(10\/31 days\)/);
  const sep = P.forecast.find((f) => f.ym === '2026-09');
  assert.equal(sep.seasonalPence, null);
  assert.match(sep.reason, /no prior-year API record/);
  assert.equal(P.fullYear.seasonalPence, null, 'full-year figure refuses when any month is uncovered');
  assert.deepEqual(P.fullYear.missing, ['2026-03', '2026-09']);
  // the window shrinks to the remaining 5 pairs and re-weights (newest still ×3)
  assert.deepEqual(P.window.map((w) => w.ym), ['2026-01', '2026-02', '2026-04', '2026-05', '2026-06']);
  assert.deepEqual(P.window.map((w) => w.weight), [1, 1, 1, 2, 3]);
});

test('premises guard: pre-move months are never actuals nor prior-year bases; mid-month move shifts the guard', () => {
  assert.equal(REP.firstPremisesYm('2023-04-01'), '2023-04');
  assert.equal(REP.firstPremisesYm('2023-04-15'), '2023-05', 'a mid-month move month is mixed-premises → unusable');
  // Year 2024 vs a 2023 prior year that starts at the move: Jan–Mar 2023 are pre-move.
  const apiMonths = [];
  const ledgerMonths = [];
  for (let mm = 1; mm <= 12; mm++) {
    for (const y of [2023, 2024]) {
      const ym = `${y}-${String(mm).padStart(2, '0')}`;
      apiMonths.push({ ym, net: 500000 + mm * 1000, txn: 50 });
      ledgerMonths.push({ ym, days: REP.calDays(ym) });
    }
  }
  const months = REP.buildMonths({ apiMonths, ledgerMonths, nowYm: '2024-07' });
  const P = REP.computeProjection({ months, year: 2024, nowYm: '2024-07', boundaryDate: '2023-04-01' });
  // pairs start at Apr (Jan–Mar 2023 pre-move → unusable prior years)
  assert.deepEqual(P.window.map((w) => w.ym), ['2024-04', '2024-05', '2024-06']);
  // and a pre-guard month of the TARGET year is a gap, not an actual
  const P23 = REP.computeProjection({ months, year: 2023, nowYm: '2024-07', boundaryDate: '2023-04-01' });
  const jan23 = P23.actuals.find((a) => a.ym === '2023-01');
  assert.equal(jan23.kind, 'gap');
  assert.match(jan23.reason, /previous premises/);
});

test('buildMonths: completeness = every calendar day ledger-ok AND a fully elapsed month', () => {
  const months = REP.buildMonths({
    apiMonths: [{ ym: '2026-05', net: 100, txn: 1 }, { ym: '2026-07', net: 50, txn: 1 }],
    ledgerMonths: [{ ym: '2026-05', days: 31 }, { ym: '2026-06', days: 29 }, { ym: '2026-07', days: 31 }],
    nowYm: '2026-07',
  });
  assert.equal(months['2026-05'].complete, true);
  assert.equal(months['2026-06'].complete, false, '29/30 days is NOT complete');
  assert.equal(months['2026-07'].complete, false, 'the wall-clock month is MTD, never complete');
  assert.equal(months['2026-07'].mtd, true);
  assert.equal(months['2026-06'].netPence, 0, 'ledger-only month exists with zero net (closed-days month)');
});

test('chart builders: gaps are drawn as ABSENCE (split paths), never bridged', () => {
  const svg = REP.svgMonthlyLines({
    series: [{ label: 'x', color: '#fff', points: [{ i: 0, v: 100 }, { i: 1, v: 110 }, { i: 2, v: null }, { i: 3, v: 120 }, { i: 4, v: 130 }] }],
    yFmt: (v) => String(v),
  });
  const paths = svg.match(/<path /g) || [];
  assert.equal(paths.length, 2, 'two runs → two separate paths around the null');
  // a single isolated point renders as a dot, not an invisible path
  const svg2 = REP.svgMonthlyLines({ series: [{ label: 'x', color: '#fff', points: [{ i: 5, v: 10 }] }], yFmt: (v) => String(v) });
  assert.match(svg2, /<circle /);
});

// ---------------- page-level: fixture DB, values vs direct SQL ----------------

const DDL = `
CREATE TABLE sales_receipts_api (receipt_id TEXT PRIMARY KEY, business_date TEXT NOT NULL, account_reference TEXT, type TEXT, cancelled INTEGER, dine_in INTEGER, account_profile_code TEXT, delivery_mode TEXT, external_reference TEXT, table_name TEXT, pos_guest_count INTEGER, time_opening_ms INTEGER, time_closed_ms INTEGER, wall_clock_date TEXT, boundary_flag TEXT, net_with_tax_pence INTEGER, net_without_tax_pence INTEGER, tax_pence INTEGER, discount_pence INTEGER, service_charge_pence INTEGER, updated_at INTEGER);
CREATE TABLE sales_api_ingest_runs (business_date TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, receipts INTEGER, detail TEXT, pulled_at INTEGER NOT NULL, PRIMARY KEY (business_date, source));
CREATE TABLE sales_channel_map_api (account_profile_code TEXT PRIMARY KEY, profile_name TEXT, delivery_mode TEXT, channel_label TEXT, first_seen INTEGER, updated_at INTEGER, label_source TEXT);
CREATE TABLE premises_regime (name TEXT PRIMARY KEY, start_date TEXT NOT NULL, end_date TEXT, note TEXT);
CREATE TABLE sales_day (business_date TEXT PRIMARY KEY, net_sales_pence INTEGER, gross_sales_pence INTEGER, pos_guest_count INTEGER, transactions INTEGER, taxes_pence INTEGER, refunds_pence INTEGER, voids_pence INTEGER, discounts_pence INTEGER, comps_pence INTEGER, service_charges_pence INTEGER, tips_pence INTEGER, labor_hours REAL, updated_at INTEGER);
`;

function isoDaysOf(ym) {
  const n = REP.calDays(ym);
  return Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`);
}

function makeDb({ gapMonth = null } = {}) {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(DDL);
  db.prepare(`INSERT INTO premises_regime VALUES ('current','2023-04-01',NULL,'the move'), ('previous','2022-02-20','2023-03-31',NULL)`).run();
  db.prepare(`INSERT INTO sales_channel_map_api VALUES ('LOCAL','Local','NONE','EAT IN',1,1,'operator'), ('storekit_orderpay','Storekit','NONE','STOREKIT ORDER & PAY',1,1,'operator')`).run();
  const insR = db.prepare(`INSERT INTO sales_receipts_api (receipt_id, business_date, type, cancelled, account_profile_code, net_without_tax_pence, net_with_tax_pence, tax_pence, updated_at) VALUES (?,?,?,?,?,?,?,?,1)`);
  const insL = db.prepare(`INSERT INTO sales_api_ingest_runs VALUES (?,?,?,?,?,1)`);
  const addMonth = (ym, net, ledgerDays) => {
    const eat = Math.round(net * 0.6);
    const qr = net - eat;
    insR.run(`R-${ym}-A`, `${ym}-15`, 'SALE', 0, 'LOCAL', eat, Math.round(eat * 1.2), Math.round(eat * 0.2));
    insR.run(`R-${ym}-B`, `${ym}-15`, 'SALE', 0, 'storekit_orderpay', qr, Math.round(qr * 1.2), Math.round(qr * 0.2));
    // a VOID must never count anywhere
    insR.run(`R-${ym}-V`, `${ym}-16`, 'VOID', 0, 'LOCAL', 99999, 119999, 20000);
    const days = ledgerDays == null ? isoDaysOf(ym) : isoDaysOf(ym).slice(0, ledgerDays);
    for (const d of days) insL.run(d, 'kseries-sales-daily', 'ok', 2, 'net=x');
  };
  for (let mm = 1; mm <= 12; mm++) addMonth(`2025-${String(mm).padStart(2, '0')}`, NET_2025(mm), null);
  for (let mm = 1; mm <= 6; mm++) {
    const ym = `2026-${String(mm).padStart(2, '0')}`;
    addMonth(ym, NET_2026(mm), gapMonth === ym ? 10 : null);
  }
  addMonth('2026-07', MTD_JUL, 10);
  return db;
}

function renderPage(db) {
  const ctx = { q: (sql, params) => DATA.safeSelect(db, sql, params), now: NOW, query: {} };
  const section = reports.getSection(db, ctx);
  return { section, html: reports.render(section, ctx).body };
}

test('page: projected figures render and match hand arithmetic + direct SQL; VOIDs excluded; caption present', () => {
  const db = makeDb();
  const { section, html } = renderPage(db);
  // the projection figure — £130,950.00 exactly (13,095,000p, hand-derived above)
  assert.match(html, /£130,950\.00/, 'seasonality-aware full-year figure');
  // the simple sanity figure — round(6,415,500 + (6,415,500/6,210,000)·6,570,000) = 13,202,913p
  assert.match(html, /£132,029\.13/, 'simple YTD-YoY full-year figure');
  // the operator-ruled caption line, with method + weighting + premises handling
  assert.match(html, /Projection basis: seasonality-aware/);
  assert.match(html, /newest ×3, next ×2/);
  assert.match(html, /move 2023-04-01/);
  // monthly net (P1 source) equals direct SQL over sale receipts only — the VOID row changes nothing
  const sql = db.prepare(`SELECT SUM(net_without_tax_pence) n FROM sales_receipts_api WHERE cancelled=0 AND type NOT IN ('VOID','CANCEL','RECALL') AND business_date LIKE '2026-06%'`).get();
  assert.equal(Number(sql.n), NET_2026(6));
  assert.equal(section.rv2.months['2026-06'].netPence, NET_2026(6));
  // MTD stated separately
  assert.match(html, /£3,500\.00 <span class="rv2-gap">MTD<\/span>/);
});

test('page: channel mix matches direct SQL; QR share correct; MTD month marked', () => {
  const db = makeDb();
  const { html } = renderPage(db);
  // Jun 2026 channel split via direct SQL
  const rows = db.prepare(`SELECT account_profile_code c, SUM(net_without_tax_pence) n FROM sales_receipts_api WHERE cancelled=0 AND type='SALE' AND business_date LIKE '2026-06%' GROUP BY c`).all();
  const eat = Number(rows.find((r) => r.c === 'LOCAL').n);
  const qr = Number(rows.find((r) => r.c === 'storekit_orderpay').n);
  assert.equal(eat + qr, NET_2026(6));
  const gbp = (p) => `£${(p / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  assert.ok(html.includes(gbp(eat)), 'EAT IN Jun net in the migration table');
  assert.ok(html.includes(gbp(qr)), 'QR Jun net in the migration table');
  // QR share of the dine-in unit = qr/(eat+qr): fixture is 60/40 by construction
  assert.ok(Math.abs(qr / (eat + qr) - 0.4) < 0.001);
  assert.match(html, /40\.0%/);
  assert.match(html, /£38 target/);
  assert.match(html, /\(MTD\)/, 'the MTD month is marked, never passed off as complete');
});

test('page: a partial month renders as a gap with its reason and blocks the full-year figure', () => {
  const db = makeDb({ gapMonth: '2026-03' });
  const { html } = renderPage(db);
  assert.match(html, /not computable/);
  assert.match(html, /Mar 2026/);
  assert.match(html, /partial API coverage \(10\/31 days\)/);
  assert.doesNotMatch(html, /£130,950\.00/, 'no figure fabricated over the gap');
});

test('page: empty DB renders the plain honest banner; scraper-only DB renders the v2 no-record banner', () => {
  // fully empty → the original honest banner, no v2 scaffolding, no zeros
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(DDL);
  const ctx = { q: (sql, params) => DATA.safeSelect(db, sql, params), now: NOW, query: {} };
  const out = reports.render(reports.getSection(db, ctx), ctx);
  assert.match(out.body, /No Lightspeed sales yet/i);
  assert.doesNotMatch(out.body, /Projected/);
  assert.doesNotMatch(out.body, /£0\.00/);
  // scraper day present but NO API record yet → the v2 panels say so, honestly, above the flash
  db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence, gross_sales_pence, transactions, updated_at) VALUES ('2026-07-16', 100000, 120000, 10, 1)`).run();
  const out2 = reports.render(reports.getSection(db, ctx), ctx);
  assert.match(out2.body, /no per-receipt API record yet/);
});
