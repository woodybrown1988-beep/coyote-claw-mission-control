'use strict';
// YoY / Seasonality tab — the premises-move boundary must hold in the UI: a month whose prior year is
// pre-move shows a REASON, never a fabricated number; an in-boundary month shows a real Δ. Renders on an
// empty DB without throwing. Read-only, no network (asserted on the source).
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA = require('../mission-control/ui/data.js');
const yoy = require('../mission-control/ui/pages/yoy-seasonality.js');

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
  return db;
}
function ctxFor(db) { return { q: (sql, p) => DATA.safeSelect(db, sql, p), now: 1782800000000 }; }

test('yoy: contract + module shape', () => {
  assert.equal(yoy.key, 'yoy');
  assert.equal(yoy.route, '/yoy');
  assert.ok(yoy.title && yoy.sub);
});

test('yoy: EMPTY db renders the honest empty state, never throws or fabricates', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  const ctx = ctxFor(db);
  const out = yoy.render(yoy.getSection(db, ctx), ctx);
  assert.ok(out && typeof out.body === 'string' && out.body.length > 20);
  assert.match(out.body, /No sales history yet/i);
  assert.doesNotMatch(out.body, /£0\.00/);
  db.close();
});

test('yoy: BOUNDARY honesty — straddling month shows a reason, in-boundary month shows a real Δ', () => {
  const db = makeDb();
  const ctx = ctxFor(db);
  const section = yoy.getSection(db, ctx);
  assert.equal(section.hasData, true);
  const out = yoy.render(section, ctx);
  // ruler stated up-front
  assert.match(out.body, /premises move 2023-04-01/);
  // Apr 2023 (current) vs Apr 2022 (pre-move) → the REASON, not a number
  assert.match(out.body, /no comparable current-premises period/);
  // Apr 2024 vs Apr 2023 (both current) → real Δ = 220000-200000 per day × 30 = £6,000
  assert.match(out.body, /\+£6,000\.00/);
  // headline names the first comparable YoY month
  assert.match(out.body, /First comparable current-premises YoY:\s*<b>Apr 2024<\/b>/);
  // seasonality section present (current-premises curve)
  assert.match(out.body, /Seasonality/);
  db.close();
});

test('yoy: NO-FABRICATION — the non-comparable Apr-2023 row carries no YoY number', () => {
  const db = makeDb();
  const ctx = ctxFor(db);
  const out = yoy.render(yoy.getSection(db, ctx), ctx);
  // isolate the Apr 2023 table row and assert it holds the reason, not a +/-£ delta
  const i = out.body.indexOf('<td>Apr 2023');
  assert.ok(i >= 0, 'Apr 2023 table row present');
  const row = out.body.slice(i, i + 320);
  assert.match(row, /no comparable current-premises period/);
  assert.doesNotMatch(row, /[+−]£/, 'no fabricated YoY delta on a non-comparable month');
  db.close();
});

test('yoy: source is read-only, no network, requires only shared.js', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'mission-control', 'ui', 'pages', 'yoy-seasonality.js'), 'utf8');
  assert.doesNotMatch(src, /\bfetch\s*\(|\bchild_process\b|require\(['"]node:(http|https|net|dgram|child_process)/);
  assert.doesNotMatch(src, /\.(run|exec|prepare)\s*\(/, 'reads only via ctx.q');
  assert.doesNotMatch(src, /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|INSERT\s+OR)\b/i);
  const requires = src.match(/require\((['"][^'"]+['"])\)/g) || [];
  for (const r of requires) assert.match(r, /\.\.\/shared\.js/, `requires only ../shared.js, got ${r}`);
});
