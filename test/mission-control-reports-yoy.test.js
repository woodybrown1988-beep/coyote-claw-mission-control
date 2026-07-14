'use strict';
// Reports YoY headline — "vs same month last year" at the top of /coyote/reports, read from the
// box's boundary-safe v_sales_month_yoy. The premises boundary must hold in the UI: a comparison
// the move blocks shows the view's REASON verbatim, never a fabricated number; a partial month
// shows its reason plus the latest COMPARABLE month (labelled), never a month-to-date fudge.
// Renders on an empty DB without throwing. Read-only (SELECT-only via ctx.q).
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

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
`;

function seedHistoryMonth(db, ym, netPerDay) {
  const days = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  const ins = db.prepare(`INSERT INTO sales_day_history (business_date,net_sales_pence,gross_sales_pence,total_pence,pos_guest_count,transactions,updated_at) VALUES (?,?,?,?,?,?,?)`);
  for (let d = 1; d <= days; d++) ins.run(`${ym}-${String(d).padStart(2, '0')}`, netPerDay, Math.round(netPerDay * 1.2), netPerDay, 100, 40, 0);
}
function seedLiveDay(db, date, net) {
  db.prepare(`INSERT INTO sales_day (business_date,net_sales_pence,gross_sales_pence,pos_guest_count,transactions,taxes_pence,refunds_pence,voids_pence,discounts_pence,comps_pence,service_charges_pence,tips_pence,labor_hours,updated_at) VALUES (?,?,?,?,?,?,0,0,0,0,0,0,0,0)`)
    .run(date, net, Math.round(net * 1.2), 100, 40, Math.round(net * 0.2));
}
function makeDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(DDL);
  db.prepare(`INSERT INTO premises_regime VALUES ('previous','2022-02-20','2023-03-31',''),('current','2023-04-01',NULL,'moved to larger premises')`).run();
  return db;
}
function ctxFor(db) { return { q: (sql, p) => DATA.safeSelect(db, sql, p), now: 1782800000000, query: {} }; }

test('reports yoy: contract intact', () => {
  assert.equal(reports.key, 'reports');
  assert.equal(reports.route, '/coyote/reports');
});

test('reports yoy: EMPTY db renders the honest empty state — no headline, no throw', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  const ctx = ctxFor(db);
  const out = reports.render(reports.getSection(db, ctx), ctx);
  assert.match(out.body, /No Lightspeed sales yet/i);
  assert.doesNotMatch(out.body, /rp-yoy/);
  db.close();
});

test('reports yoy: comparable month shows the real Δ, labelled current-premises', () => {
  const db = makeDb();
  seedHistoryMonth(db, '2023-04', 200000);   // prior year, current premises, complete
  seedHistoryMonth(db, '2024-04', 220000);   // days 1..29 land from history …
  db.prepare(`DELETE FROM sales_day_history WHERE business_date='2024-04-30'`).run();
  seedLiveDay(db, '2024-04-30', 220000);     // … day 30 lands live; maxDate anchors Apr 2024
  const ctx = ctxFor(db);
  const section = reports.getSection(db, ctx);
  assert.equal(section.yoyAnchor && section.yoyAnchor.yoy_status, 'ok');
  const out = reports.render(section, ctx);
  // Apr 2024 (30×£2,200) vs Apr 2023 (30×£2,000) → +£6,000.00 / +10.0%
  assert.match(out.body, /Apr 2024<\/b> vs Apr 2023/);
  assert.match(out.body, /\+£6,000\.00/);
  assert.match(out.body, /\+10\.0%/);
  assert.match(out.body, /class="rp-yoy-up"/);
  assert.match(out.body, /current premises/);
  db.close();
});

test('reports yoy: BOUNDARY honesty — prior year pre-move shows the reason, never a number', () => {
  const db = makeDb();
  seedHistoryMonth(db, '2022-04', 100000);   // previous premises
  seedHistoryMonth(db, '2023-04', 200000);
  db.prepare(`DELETE FROM sales_day_history WHERE business_date='2023-04-30'`).run();
  seedLiveDay(db, '2023-04-30', 200000);     // maxDate anchors Apr 2023
  const ctx = ctxFor(db);
  const out = reports.render(reports.getSection(db, ctx), ctx);
  assert.match(out.body, /no comparable current-premises period \(prior year pre-move\)/);
  // the blocked month must not carry a delta; no comparable fallback exists either
  assert.doesNotMatch(out.body, /class="rp-yoy-(up|down)"/);
  assert.doesNotMatch(out.body, /latest comparable/);
  db.close();
});

test('reports yoy: PARTIAL month shows its reason + the latest comparable month alongside', () => {
  const db = makeDb();
  seedHistoryMonth(db, '2023-04', 200000);
  seedHistoryMonth(db, '2023-05', 200000);
  seedHistoryMonth(db, '2024-04', 220000);   // latest comparable (ok)
  for (let d = 1; d <= 10; d++) seedLiveDay(db, `2024-05-${String(d).padStart(2, '0')}`, 210000);
  const ctx = ctxFor(db);
  const section = reports.getSection(db, ctx);
  assert.match(String(section.yoyAnchor && section.yoyAnchor.yoy_status), /^partial current month \(10\/31 days\)$/);
  assert.equal(section.yoyLatestOk && section.yoyLatestOk.month, '2024-04');
  const out = reports.render(section, ctx);
  assert.match(out.body, /partial current month \(10\/31 days\)/);
  assert.match(out.body, /latest comparable:.*Apr 2024<\/b> vs Apr 2023/);
  assert.match(out.body, /\+£6,000\.00/);
  db.close();
});
