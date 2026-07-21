'use strict';
// FORECAST tab (RCC P4) — the ONE home for the year-scale facts (the old long-range/YoY panels
// were absorbed here). Pinned honesty:
//   • monthly clustered columns render THREE years (2024/2025 day-net canon, 2026 per-receipt
//     ledger-complete actuals) + HATCHED forecast bars for current+future months — never a solid
//     "actual" bar for a forecast;
//   • the planning table carries status chips (Actual / Current / Forecast) and a REASON chip
//     for an unforecastable month, never a number;
//   • YoY facts surface in the KPI strip (YTD vs LY, carry-forward, forecast vs LY) from real
//     complete-month pairs only;
//   • an empty DB renders honestly (no £-figures, no throw).
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const REP = require('../mission-control/ui/reporting.js');
const reports = require('../mission-control/ui/pages/coyote/reports.js');

// The real boundary-safe views (mirror src/schema.sql in coyote-claw) over minimal base tables,
// + the per-receipt record the projection reads, + the override journal (cc #86 schema).
const DDL = `
CREATE TABLE sales_day (business_date TEXT PRIMARY KEY, net_sales_pence INTEGER, gross_sales_pence INTEGER, pos_guest_count INTEGER, transactions INTEGER, taxes_pence INTEGER, refunds_pence INTEGER, voids_pence INTEGER, discounts_pence INTEGER, comps_pence INTEGER, service_charges_pence INTEGER, tips_pence INTEGER, labor_hours REAL, updated_at INTEGER);
CREATE TABLE sales_day_history (business_date TEXT PRIMARY KEY, net_sales_pence INTEGER, gross_sales_pence INTEGER, total_pence INTEGER, pos_guest_count INTEGER, transactions INTEGER, taxes_pence INTEGER, refunds_pence INTEGER, voids_pence INTEGER, discounts_pence INTEGER, comps_pence INTEGER, losses_pence INTEGER, service_charges_pence INTEGER, tips_pence INTEGER, source_file TEXT, updated_at INTEGER);
CREATE TABLE premises_regime (name TEXT PRIMARY KEY, start_date TEXT NOT NULL, end_date TEXT, note TEXT);
CREATE VIEW v_sales_day_all AS
  SELECT business_date, net_sales_pence, gross_sales_pence, pos_guest_count, transactions, taxes_pence, refunds_pence, voids_pence, discounts_pence, comps_pence, service_charges_pence, tips_pence, 'live' AS source,
         CASE WHEN business_date >= (SELECT start_date FROM premises_regime WHERE name='current') THEN 'current' ELSE 'previous' END AS premises FROM sales_day
  UNION ALL
  SELECT business_date, net_sales_pence, gross_sales_pence, pos_guest_count, transactions, taxes_pence, refunds_pence, voids_pence, discounts_pence, comps_pence, service_charges_pence, tips_pence, 'history' AS source,
         CASE WHEN business_date >= (SELECT start_date FROM premises_regime WHERE name='current') THEN 'current' ELSE 'previous' END AS premises FROM sales_day_history WHERE business_date NOT IN (SELECT business_date FROM sales_day);
CREATE VIEW v_sales_month AS WITH g AS (
  SELECT substr(business_date,1,7) AS month, COUNT(*) AS days, SUM(net_sales_pence>0) AS open_days, SUM(net_sales_pence) AS net_pence, SUM(gross_sales_pence) AS gross_pence, SUM(transactions) AS transactions, SUM(pos_guest_count) AS pos_guest_count FROM v_sales_day_all GROUP BY month)
  SELECT month, CASE WHEN month >= (SELECT substr(start_date,1,7) FROM premises_regime WHERE name='current') THEN 'current' ELSE 'previous' END AS premises, days,
         CAST(julianday(month||'-01','+1 month') - julianday(month||'-01') AS INT) AS cal_days,
         (days >= CAST(julianday(month||'-01','+1 month') - julianday(month||'-01') AS INT)) AS complete, open_days, net_pence, gross_pence, transactions, pos_guest_count FROM g;
CREATE TABLE sales_receipts_api (receipt_id TEXT PRIMARY KEY, business_date TEXT NOT NULL, account_reference TEXT, type TEXT, cancelled INTEGER, dine_in INTEGER, account_profile_code TEXT, delivery_mode TEXT, external_reference TEXT, table_name TEXT, pos_guest_count INTEGER, time_opening_ms INTEGER, time_closed_ms INTEGER, wall_clock_date TEXT, boundary_flag TEXT, net_with_tax_pence INTEGER, net_without_tax_pence INTEGER, tax_pence INTEGER, discount_pence INTEGER, service_charge_pence INTEGER, updated_at INTEGER);
CREATE TABLE sales_api_ingest_runs (business_date TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, receipts INTEGER, detail TEXT, pulled_at INTEGER NOT NULL, PRIMARY KEY (business_date, source));
CREATE TABLE sales_channel_map_api (account_profile_code TEXT PRIMARY KEY, profile_name TEXT, delivery_mode TEXT, channel_label TEXT, first_seen INTEGER, updated_at INTEGER, label_source TEXT);
CREATE TABLE forecast_overrides (id INTEGER PRIMARY KEY AUTOINCREMENT, pct REAL NOT NULL CHECK (pct BETWEEN -50 AND 50), reason TEXT NOT NULL, created_at INTEGER NOT NULL);
`;

const NOW = Date.UTC(2026, 4, 15, 12, 0); // → nowYm '2026-05'; maxDate 2026-05-14
const pad = (n) => String(n).padStart(2, '0');

/** Seed one month on BOTH bases: day rows (live or history) at perDay net, ONE per-receipt row
 *  summing the same total, and 'ok' ledger rows for `ledgerDays` (default: every calendar day). */
function seedMonth(db, ym, perDay, { live = false, days = null, ledgerDays = null } = {}) {
  const cal = REP.calDays(ym);
  const n = days == null ? cal : days;
  const ins = live
    ? db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence, gross_sales_pence, transactions, updated_at) VALUES (?,?,?,?,0)`)
    : db.prepare(`INSERT INTO sales_day_history (business_date, net_sales_pence, gross_sales_pence, total_pence, transactions, updated_at) VALUES (?,?,?,?,?,0)`);
  for (let d = 1; d <= n; d++) {
    if (live) ins.run(`${ym}-${pad(d)}`, perDay, Math.round(perDay * 1.2), 40);
    else ins.run(`${ym}-${pad(d)}`, perDay, Math.round(perDay * 1.2), perDay, 40);
  }
  db.prepare(`INSERT INTO sales_receipts_api (receipt_id, business_date, type, cancelled, account_profile_code, net_without_tax_pence, updated_at) VALUES (?,?,?,0,'LOCAL',?,1)`)
    .run(`R-${ym}`, `${ym}-01`, 'SALE', perDay * n);
  const ld = ledgerDays == null ? n : ledgerDays;
  const insL = db.prepare(`INSERT INTO sales_api_ingest_runs VALUES (?,?,?,?,?,1)`);
  for (let d = 1; d <= ld; d++) insL.run(`${ym}-${pad(d)}`, 'kseries-sales-daily', 'ok', 1, '');
}

/** The seeded world: 2024 £1,500/day (history, day-grain only counts for the columns), 2025
 *  £2,000/day complete on both bases, 2026 Jan–Apr £2,200/day complete + May MTD (14 days).
 *  Every 2026↔2025 ratio is exactly 1.10 → carry-forward 110.0%, everything hand-checkable. */
function makeDb({ partialLy = null } = {}) {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(DDL);
  db.prepare(`INSERT INTO premises_regime VALUES ('previous','2022-02-20','2023-03-31',''),('current','2023-04-01',NULL,'moved to larger premises')`).run();
  db.prepare(`INSERT INTO sales_channel_map_api VALUES ('LOCAL','Local','NONE','EAT IN',1,1,'operator')`).run();
  for (let mo = 1; mo <= 12; mo++) seedMonth(db, `2024-${pad(mo)}`, 150000);
  for (let mo = 1; mo <= 12; mo++) {
    const ym = `2025-${pad(mo)}`;
    seedMonth(db, ym, 200000, ym === partialLy ? { ledgerDays: 10 } : {});
  }
  for (let mo = 1; mo <= 4; mo++) seedMonth(db, `2026-${pad(mo)}`, 220000, { live: true });
  seedMonth(db, '2026-05', 220000, { live: true, days: 14 });
  return db;
}
function ctxFor(db, tab) { return { q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, query: { tab: tab || 'forecast' } }; }
function renderTab(db, tab) {
  const ctx = ctxFor(db, tab);
  return reports.render(reports.getSection(db, ctx), ctx).body;
}

test('forecast columns: three years render + HATCHED forecast bars for current & future months', () => {
  const db = makeDb();
  const body = renderTab(db);
  assert.equal((body.match(/r-mbar y2024/g) || []).length, 12, '2024 day-net bars, all 12 complete months');
  assert.equal((body.match(/r-mbar y2025/g) || []).length, 12, '2025 day-net bars');
  assert.equal((body.match(/r-mbar y2026"/g) || []).length, 4, '2026 ACTUAL bars = ledger-complete Jan–Apr only');
  assert.equal((body.match(/r-mbar forecast/g) || []).length, 8, 'hatched forecast bars May–Dec — never solid');
  assert.match(body, /2026 forecast: £/, 'forecast bars are tip-labelled as forecast');
  assert.match(body, /2026 actual: £/, 'actual bars are tip-labelled as actual');
  db.close();
});

test('planning table: status chips Actual (complete) / Current (MTD) / Forecast (future) + real values', () => {
  const db = makeDb();
  const body = renderTab(db);
  assert.equal((body.match(/r-tag good">Actual/g) || []).length, 4, 'Jan–Apr are Actual');
  assert.equal((body.match(/r-tag warn">Current/g) || []).length, 1, 'May (MTD) is Current');
  assert.equal((body.match(/r-tag info">Forecast/g) || []).length, 7, 'Jun–Dec are Forecast');
  // Jan actual = 31×£2,200; Jan forecast column empty (an actual is never re-forecast)
  assert.match(body, /January<\/td>\s*<td class="r-num mono">£68,200\.00<\/td>\s*<td class="r-num mono">—<\/td>/);
  // May forecast = 1.1 × 31×£2,000 = £68,200 (whole-pound estimate), vs 2025 +10.0%
  assert.match(body, /May<\/td>\s*<td class="r-num mono">—<\/td>\s*<td class="r-num mono">£68,200<span class="hatch-sw"/);
  assert.match(body, /\+10\.0%/);
  assert.match(body, /labour-formula's forecast-net input/, 'the labour-feed pointer, not a copy');
  db.close();
});

test('KPI strip: YoY facts from real complete pairs — YTD vs LY, carry-forward, forecast vs LY', () => {
  const db = makeDb();
  const body = renderTab(db);
  // YTD actual = (31+28+31+30+14) × £2,200 = £294,800.00, premises-guard stated
  assert.match(body, /£294,800\.00/);
  assert.match(body, /premises current only/);
  // every 2026↔2025 pair is 1.10 → +10.0% YTD, 110.0% carry-forward, +10.0% forecast vs 2025
  assert.match(body, /YTD vs 2025/i);
  assert.match(body, /4 complete month-pair\(s\) · MTD excluded/);
  assert.match(body, /110\.0%/, 'carry-forward = the weighted ratio');
  // full-year forecast = 1.1 × 2025 total (365×£2,000 = £730,000) = £803,000
  assert.match(body, /£803,000/);
  assert.match(body, /seasonality-aware/);
  db.close();
});

test('boundary honesty: an unforecastable month carries its REASON chip, never a number or "Forecast"', () => {
  const db = makeDb({ partialLy: '2025-09' }); // Sep 2025 ledger-incomplete → Sep 2026 unforecastable
  const body = renderTab(db);
  assert.match(body, /September<\/td>\s*<td class="r-num mono">—<\/td>\s*<td class="r-num mono">—<\/td>/, 'no fabricated Sep figure');
  assert.match(body, /prior-year month has partial API coverage/, 'the reason chip');
  assert.equal((body.match(/r-tag info">Forecast/g) || []).length, 6, 'Sep is NOT chip-labelled Forecast');
  // the full-year figure refuses (a gap month blocks it) — the KPI says so instead
  assert.match(body, /record filling/);
  assert.doesNotMatch(body, /£803,000/);
  db.close();
});

test('one home: the old YoY headline / long-range grammar is GONE from the forecast tab', () => {
  const db = makeDb();
  const body = renderTab(db);
  assert.doesNotMatch(body, /Long range/);
  assert.doesNotMatch(body, /Latest full-month YoY/);
  assert.doesNotMatch(body, /rp-yoy"/, 'the old headline bar class is deleted');
  db.close();
});

test('EMPTY db: the forecast tab renders honestly — no throw, no £-figures, blockers named', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(DDL);
  const body = renderTab(db);
  assert.doesNotMatch(body, /£\d/, 'no fabricated money on an empty box');
  assert.match(body, /no day-grain record this year yet/);
  assert.match(body, /No complete monthly record/);
  db.close();
});
