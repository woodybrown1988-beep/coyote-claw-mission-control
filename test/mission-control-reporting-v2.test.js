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

function renderPage(db, tab) {
  const ctx = { q: (sql, params) => DATA.safeSelect(db, sql, params), now: NOW, query: tab ? { tab } : {} };
  const section = reports.getSection(db, ctx);
  return { section, html: reports.render(section, ctx).body };
}

test('forecast tab: projected figures render and match hand arithmetic + direct SQL; VOIDs excluded; method caption present', () => {
  const db = makeDb();
  const { section, html } = renderPage(db, 'forecast');
  // the projection figure — 13,095,000p hand-derived above; ESTIMATES display whole-pound
  assert.match(html, /£130,950</, 'seasonality-aware full-year KPI (whole-pound)');
  // the simple sanity figure — round(6,415,500 + (6,415,500/6,210,000)·6,570,000)/100 = £132,029
  assert.match(html, /£132,029/, 'simple YTD-YoY sanity figure in the engine card');
  assert.match(html, /seasonality-aware/, 'the method is named');
  // the operator-ruled method text, with weighting + premises handling
  assert.match(html, /newest ×3, next ×2/);
  assert.match(html, /2023-04-01 move/);
  assert.match(html, /Re-forecast at every read/);
  // monthly net (the canon source) equals direct SQL over sale receipts only — the VOID row changes nothing
  const sql = db.prepare(`SELECT SUM(net_without_tax_pence) n FROM sales_receipts_api WHERE cancelled=0 AND type NOT IN ('VOID','CANCEL','RECALL') AND business_date LIKE '2026-06%'`).get();
  assert.equal(Number(sql.n), NET_2026(6));
  assert.equal(section.rv2.months['2026-06'].netPence, NET_2026(6));
  // July is MTD → planning table marks it Current, never Actual
  assert.match(html, /July<\/td>[\s\S]{0,300}?r-tag warn">Current/);
});

test('executive tab: donut = last-28d per-receipt channel truth; QR migration detail survives as the expand', () => {
  const db = makeDb();
  const { html } = renderPage(db, 'executive');
  // window = 28d to the API max (2026-07-16, the VOID row's date) → only the July receipts land
  const rows = db.prepare(`SELECT account_profile_code c, SUM(net_without_tax_pence) n FROM sales_receipts_api WHERE cancelled=0 AND type='SALE' AND business_date BETWEEN '2026-06-19' AND '2026-07-16' GROUP BY c`).all();
  const eat = Number(rows.find((r) => r.c === 'LOCAL').n);
  const qr = Number(rows.find((r) => r.c === 'storekit_orderpay').n);
  const gbp = (p) => `£${(p / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  assert.ok(html.includes(`${gbp(eat + qr)}<small>net · 28d</small>`), 'donut centre = the window total');
  assert.ok(html.includes(gbp(eat)), 'EAT IN £ in the legend');
  assert.ok(html.includes(gbp(qr)), 'QR £ in the legend');
  assert.match(html, /window inside API-era coverage \(from 2026-06-30\)/, 'coverage boundary stated');
  // migration detail (monthly): fixture is 60/40 by construction → 40.0% QR share, MTD marked
  assert.match(html, /QR migration detail/);
  assert.match(html, /40\.0%/);
  assert.match(html, /\(MTD\)/, 'the MTD month is marked, never passed off as complete');
});

test('forecast tab: a partial month blocks the figure — record-filling KPI + the reason chip, never error-shaped', () => {
  const db = makeDb({ gapMonth: '2026-03' });
  const { html } = renderPage(db, 'forecast');
  assert.match(html, /record filling/);
  assert.match(html, /uncovered: Mar 2026/);
  assert.match(html, /partial API coverage \(10\/31 days\)/, 'the reason survives in the planning table');
  assert.doesNotMatch(html, /£130,950</, 'no figure fabricated over the gap');
  assert.doesNotMatch(html, /not computable/, 'no error-shaped lead');
});

test('forecast tab: window too thin promotes the SIMPLE method to the headline with its label', () => {
  const db = makeDb();
  // 2025 Jan–Apr ledgers go incomplete → only 2 comparable pairs (May, Jun); 2026 actuals stay complete.
  db.prepare(`DELETE FROM sales_api_ingest_runs WHERE business_date >= '2025-01-01' AND business_date <= '2025-04-30' AND business_date NOT LIKE '%-15'`).run();
  const { section, html } = renderPage(db, 'forecast');
  assert.equal(section.rv2.projection.window.length, 2);
  assert.equal(section.rv2.projection.fullYear.seasonalPence, null);
  const simple = section.rv2.projection.fullYear.simplePence;
  assert.ok(simple != null, 'simple method still covers the year');
  const whole = `£${Math.round(simple / 100).toLocaleString('en-GB')}`;
  assert.ok(html.includes(`${whole}<`), 'the simple figure IS the headline KPI (whole-pound)');
  assert.match(html, /simple YTD-YoY \(promoted — window too thin\)/, 'promoted method is labelled');
});

test('forecast tab: no pairs at all → record filling, NO hatched forecast bars invented', () => {
  const db = makeDb();
  // every 2025 month goes ledger-incomplete → zero comparable pairs, no YTD ratio
  db.prepare(`DELETE FROM sales_api_ingest_runs WHERE business_date LIKE '2025-%' AND business_date NOT LIKE '%-15'`).run();
  const { html } = renderPage(db, 'forecast');
  assert.match(html, /record filling/);
  assert.doesNotMatch(html, /r-mbar forecast/, 'no forecast bars without a computable rule');
  assert.match(html, /r-mbar y2026"/, 'the complete 2026 actual months still draw');
});

test('sparkline sparse rule: one point renders NOTHING (caller shows a value), two points render a path', () => {
  assert.equal(REP.svgSparkline({ points: [{ v: 100 }] }), '', 'a lone dot on an empty grid is noise');
  assert.match(REP.svgSparkline({ points: [{ v: 100 }, { v: 120 }] }), /<path /);
});

test('drivers tab: ~£0 integration channels never become an ATV card; the donut keeps them visible', () => {
  const db = makeDb();
  const ins = db.prepare(`INSERT INTO sales_receipts_api (receipt_id, business_date, type, cancelled, account_profile_code, net_without_tax_pence, net_with_tax_pence, tax_pence, updated_at) VALUES (?,?,?,?,?,?,?,?,1)`);
  for (let i = 0; i < 5; i++) ins.run(`NOISE-${i}`, '2026-06-20', 'SALE', 0, 'TAKEAWAY', 1, 1, 0);
  // the pending drivers tab gates on the day-grain record — one live day is enough
  db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence, gross_sales_pence, transactions, updated_at) VALUES ('2026-07-16', 100000, 120000, 10, 1)`).run();
  const { html } = renderPage(db, 'drivers');
  assert.doesNotMatch(html, /nm" title="TAKEAWAY"/, 'no ATV card for a £0.00-ATV ping channel');
  const cards = (html.match(/ATV\/txn/g) || []).length;
  assert.ok(cards >= 1 && cards <= 4, `1..4 ATV cards, got ${cards}`);
  // never invisible: the Executive donut legend lists the ping channel with its recorded £
  const { html: ex } = renderPage(db, 'executive');
  assert.match(ex, /TAKEAWAY/, 'ping channel visible in the channel legend, never cleaned invisibly');
});

test('page: empty DB renders the honest state; scraper-only DB names the missing API record', () => {
  // fully empty → honest empties, no fabricated money
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(DDL);
  const ctx = { q: (sql, params) => DATA.safeSelect(db, sql, params), now: NOW, query: {} };
  const out = reports.render(reports.getSection(db, ctx), ctx);
  assert.match(out.body, /No Lightspeed sales yet/i);
  assert.doesNotMatch(out.body, /£\d/);
  // scraper day present but NO API record yet → the per-receipt panels say so, honestly
  db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence, gross_sales_pence, transactions, updated_at) VALUES ('2026-07-16', 100000, 120000, 10, 1)`).run();
  const out2 = reports.render(reports.getSection(db, ctx), ctx);
  assert.match(out2.body, /no per-receipt API record yet/);
});
