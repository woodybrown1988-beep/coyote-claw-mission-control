'use strict';
// ONE HOME PER FACT (RCC restructure): the old Reports YoY headline bar ("vs same month last
// year") and the long-range section were ABSORBED into the Forecast tab (see
// mission-control-yoy.test.js for the new home's assertions). This file pins the DELETION —
// the old grammar must be GONE from every tab, and the module contract must survive.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const reports = require('../mission-control/ui/pages/coyote/reports.js');

// Minimal day-grain world (the old fixture's shape) — enough for every tab to render.
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
`;

function makeDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(DDL);
  db.prepare(`INSERT INTO premises_regime VALUES ('previous','2022-02-20','2023-03-31',''),('current','2023-04-01',NULL,'moved to larger premises')`).run();
  const hist = db.prepare(`INSERT INTO sales_day_history (business_date,net_sales_pence,gross_sales_pence,total_pence,pos_guest_count,transactions,updated_at) VALUES (?,?,?,?,100,40,0)`);
  for (let d = 1; d <= 30; d++) hist.run(`2023-04-${String(d).padStart(2, '0')}`, 200000, 240000, 200000);
  db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence, gross_sales_pence, transactions, updated_at) VALUES ('2024-04-30', 220000, 264000, 40, 0)`).run();
  return db;
}
const ctxFor = (db, tab) => ({ q: (sql, p) => DATA.safeSelect(db, sql, p), now: 1782800000000, query: tab ? { tab } : {} });

test('reports contract intact after the RCC restructure', () => {
  assert.equal(reports.key, 'reports');
  assert.equal(reports.route, '/coyote/reports');
  assert.equal(reports.title, 'Revenue');
});

test('the old YoY headline + long-range grammar is deleted from EVERY tab (absorbed into Forecast)', () => {
  const db = makeDb();
  for (const tab of ['executive', 'drivers', 'menu', 'reconciliation', 'forecast']) {
    const ctx = ctxFor(db, tab);
    const body = reports.render(reports.getSection(db, ctx), ctx).body;
    assert.doesNotMatch(body, /class="rp-yoy"/, `${tab}: old headline bar gone`);
    assert.doesNotMatch(body, /vs same month last year/, `${tab}: old headline copy gone`);
    assert.doesNotMatch(body, /Long range/, `${tab}: long-range section gone`);
    assert.doesNotMatch(body, /Annual arc/, `${tab}: annual arc gone`);
    assert.doesNotMatch(body, /Seasonality — avg net/, `${tab}: seasonality bars gone`);
  }
  db.close();
});

test('every tab still renders inside the RCC shell with the 5-link subnav', () => {
  const db = makeDb();
  for (const tab of ['executive', 'drivers', 'menu', 'reconciliation', 'forecast']) {
    const ctx = ctxFor(db, tab);
    const body = reports.render(reports.getSection(db, ctx), ctx).body;
    assert.match(body, /<div class="rcc">/, `${tab}: rcc wrapper`);
    assert.equal((body.match(/class="r-tab[ "]/g) || []).length, 5, `${tab}: 5 subtab links`);
  }
  db.close();
});

test('EMPTY db renders honestly on the default tab — no throw, no fabricated money', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  const ctx = ctxFor(db);
  const out = reports.render(reports.getSection(db, ctx), ctx);
  assert.match(out.body, /No Lightspeed sales yet/i);
  assert.doesNotMatch(out.body, /£\d/);
  db.close();
});
