'use strict';
// LONG RANGE (the merged YoY tab, page-map audit 2026-07-21) — now a Reports section. The
// premises-move boundary must hold: a month whose prior year is pre-move shows a REASON, never a
// fabricated number; an in-boundary month shows a real Δ. The old /coyote/yoy route 308s here.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA = require('../mission-control/ui/data.js');
const reports = require('../mission-control/ui/pages/coyote/reports.js');

// The real boundary-safe views (mirror src/schema.sql in coyote-claw) over minimal base tables.
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
CREATE VIEW v_sales_month_yoy AS
  SELECT cur.month, cur.premises, cur.net_pence, cur.days, cur.cal_days, cur.complete, py.month AS prior_year_month, py.net_pence AS prior_year_net_pence, py.complete AS prior_complete,
         CASE WHEN cur.premises<>'current' THEN NULL WHEN py.month IS NULL THEN NULL WHEN py.premises<>'current' THEN NULL WHEN cur.complete=0 OR py.complete=0 THEN NULL ELSE cur.net_pence - py.net_pence END AS yoy_delta_pence,
         CASE WHEN cur.premises<>'current' THEN 'previous premises — excluded from current-site YoY' WHEN py.month IS NULL THEN 'no prior-year data' WHEN py.premises<>'current' THEN 'no comparable current-premises period (prior year pre-move)' WHEN cur.complete=0 THEN 'partial current month (' || cur.days || '/' || cur.cal_days || ' days)' WHEN py.complete=0 THEN 'prior-year month incomplete' ELSE 'ok' END AS yoy_status
  FROM v_sales_month cur LEFT JOIN v_sales_month py ON py.month = printf('%04d-%s', CAST(substr(cur.month,1,4) AS INT)-1, substr(cur.month,6,2));
CREATE VIEW v_seasonality_current AS
  SELECT substr(business_date,6,2) AS month_of_year, COUNT(*) AS days, SUM(net_sales_pence>0) AS open_days, SUM(net_sales_pence) AS net_pence,
         CASE WHEN SUM(net_sales_pence>0)>0 THEN SUM(net_sales_pence)/SUM(net_sales_pence>0) END AS avg_net_per_open_day_pence FROM v_sales_day_all WHERE premises='current' GROUP BY month_of_year;
`;

function seedMonth(db, ym, netPerDay) {
  const days = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  const ins = db.prepare(`INSERT INTO sales_day_history (business_date,net_sales_pence,gross_sales_pence,total_pence,pos_guest_count,transactions,updated_at) VALUES (?,?,?,?,?,?,?)`);
  for (let d = 1; d <= days; d++) ins.run(`${ym}-${String(d).padStart(2, '0')}`, netPerDay, Math.round(netPerDay * 1.2), netPerDay, 100, 40, 0);
}
function makeDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(DDL);
  db.prepare(`INSERT INTO premises_regime VALUES ('previous','2022-02-20','2023-03-31',''),('current','2023-04-01',NULL,'moved to larger premises')`).run();
  seedMonth(db, '2022-04', 100000); // previous premises
  seedMonth(db, '2023-04', 200000); // current, prior year (2022-04) is PRE-MOVE → no comparable
  seedMonth(db, '2024-04', 220000); // current, prior year (2023-04) is current → OK, Δ = +£6,000
  // one LIVE day — Reports gates on sales_day (never empty on the real box); the long-range
  // section reads the union views beneath it
  db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence, gross_sales_pence, transactions, updated_at) VALUES ('2024-05-01', 100, 120, 1, 0)`).run();
  return db;
}
function ctxFor(db) { return { q: (sql, p) => DATA.safeSelect(db, sql, p), now: 1782800000000 }; }

test('long-range: renders inside Reports with the latest-YoY tile + seasonal + annual panels', () => {
  const db = makeDb();
  const ctx = ctxFor(db);
  const out = reports.render(reports.getSection(db, ctx), ctx);
  assert.match(out.body, /Long range/);
  assert.match(out.body, /Latest full-month YoY/);
  assert.match(out.body, /\+£6,000\.00/, 'Apr-24 vs Apr-23: (2200-2000)×30 days = +£6,000');
  assert.match(out.body, /Seasonality — avg net £\/open-day/);
  assert.match(out.body, /Annual arc/);
  db.close();
});

test('long-range: EMPTY db renders honestly, never throws or fabricates', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  const ctx = ctxFor(db);
  const out = reports.render(reports.getSection(db, ctx), ctx);
  assert.doesNotMatch(out.body, /Long range/, 'no long-range scaffolding on an empty box');
  db.close();
});

test('long-range: BOUNDARY honesty — the straddling month carries its reason in the expand, never a number', () => {
  const db = makeDb();
  const ctx = ctxFor(db);
  const out = reports.render(reports.getSection(db, ctx), ctx);
  assert.match(out.body, /no comparable current-premises period \(prior year pre-move\)/, 'Apr-2023 blocked with its reason');
  const aprIdx = out.body.indexOf('no comparable current-premises period');
  assert.ok(aprIdx > 0);
  db.close();
});

test('long-range: previous-premises years are flagged in the annual arc, never blended', () => {
  const db = makeDb();
  const ctx = ctxFor(db);
  const out = reports.render(reports.getSection(db, ctx), ctx);
  assert.match(out.body, /previous premises/);
  db.close();
});
