'use strict';

// Labour section of the Reports flash (RotaCloud wire). Honesty under test:
//   • labour tables absent/empty → "not pulled yet", NEVER estimated, page never throws;
//   • TRUE cost + RAG vs the 30% target computed against SAME-DAY net only;
//   • variance shown from BOTH numbers (rota'd vs worked);
//   • unmapped staff surfaced by name with cost excluded;
//   • partial labour coverage stated, never scaled up;
//   • daypart merges post-midnight labour hours (24..29) onto wall-clock sales hours.

const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const reports = require('../mission-control/ui/pages/reports.js');

const NOW = 1783000000000;

function makeSalesDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sales_day (business_date TEXT PRIMARY KEY, net_sales_pence INTEGER, gross_sales_pence INTEGER, pos_guest_count INTEGER, transactions INTEGER, taxes_pence INTEGER, refunds_pence INTEGER, voids_pence INTEGER, discounts_pence INTEGER, comps_pence INTEGER, service_charges_pence INTEGER, tips_pence INTEGER, labor_hours REAL, updated_at INTEGER);
    CREATE TABLE sales_hourly (business_date TEXT, hour INTEGER, net_sales_pence INTEGER, gross_sales_pence INTEGER, pos_guest_count INTEGER, transactions INTEGER, updated_at INTEGER);
    CREATE TABLE sales_by_channel (business_date TEXT, profile_id TEXT, profile_name TEXT, net_sales_pence INTEGER, gross_sales_pence INTEGER, pos_guest_count INTEGER, transactions INTEGER, tips_pence INTEGER, discounts_pence INTEGER, updated_at INTEGER);
    CREATE TABLE sales_by_payment (business_date TEXT, method_id TEXT, method_name TEXT, total_pence INTEGER, tips_pence INTEGER, transactions INTEGER, updated_at INTEGER);
    CREATE TABLE sales_by_category (business_date TEXT, grain TEXT, category_id TEXT, category_name TEXT, net_sales_pence INTEGER, gross_sales_pence INTEGER, discounts_pence INTEGER, taxes_pence INTEGER, transactions INTEGER, updated_at INTEGER);
    CREATE TABLE sales_by_product (business_date TEXT, sku TEXT, product_name TEXT, category_name TEXT, total_amount_pence INTEGER, quantity REAL, transaction_count INTEGER, ls_margin_pence INTEGER, ls_costs_pence INTEGER, updated_at INTEGER);
    CREATE TABLE products (id TEXT PRIMARY KEY, lightspeed_sku TEXT UNIQUE, name TEXT, category TEXT, updated_at INTEGER);
    CREATE TABLE recipe_lines (product_id TEXT, sub_item_id TEXT, quantity REAL, updated_at INTEGER);
    CREATE TABLE sub_items (id TEXT PRIMARY KEY, name TEXT, pack_cost_pence INTEGER, pack_qty REAL, unit_of_measure TEXT, updated_at INTEGER);
  `);
  db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence, gross_sales_pence, transactions, taxes_pence, updated_at) VALUES ('2026-07-01', 280270, 336324, 82, 56054, ?)`).run(NOW);
  db.prepare(`INSERT INTO sales_hourly (business_date, hour, net_sales_pence, updated_at) VALUES ('2026-07-01', 12, 60000, ?)`).run(NOW);
  db.prepare(`INSERT INTO sales_hourly (business_date, hour, net_sales_pence, updated_at) VALUES ('2026-07-01', 0, 4000, ?)`).run(NOW);
  return db;
}

function addLabourTables(db) {
  db.exec(`
    CREATE TABLE labour_day (business_date TEXT PRIMARY KEY, scheduled_minutes INTEGER, actual_minutes INTEGER, actual_paid_minutes INTEGER, scheduled_cost_pence INTEGER, actual_cost_pence INTEGER, salaried_cost_pence INTEGER, unmapped_scheduled_minutes INTEGER, unmapped_actual_minutes INTEGER, unmapped_names TEXT, anomalies TEXT, staff_scheduled INTEGER, staff_worked INTEGER, updated_at INTEGER);
    CREATE TABLE labour_hourly (business_date TEXT, hour INTEGER, scheduled_minutes INTEGER, actual_minutes INTEGER, scheduled_cost_pence INTEGER, actual_cost_pence INTEGER, unmapped_minutes INTEGER, updated_at INTEGER);
  `);
}

function seedLabourDay(db, date, over) {
  const base = {
    sm: 5100, am: 4709, pm: 4656, sc: 133810, ac: 123172, sal: 31642,
    usm: 0, uam: 0, un: '[]', an: '[]',
  };
  const v = Object.assign(base, over || {});
  db.prepare(`INSERT INTO labour_day (business_date, scheduled_minutes, actual_minutes, actual_paid_minutes, scheduled_cost_pence, actual_cost_pence, salaried_cost_pence, unmapped_scheduled_minutes, unmapped_actual_minutes, unmapped_names, anomalies, staff_scheduled, staff_worked, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,11,11,?)`)
    .run(date, v.sm, v.am, v.pm, v.sc, v.ac, v.sal, v.usm, v.uam, v.un, v.an, NOW);
}

function renderReports(db, query) {
  const ctx = { q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, halt: { halted: false }, query: query || {} };
  return reports.render(reports.getSection(db, ctx), ctx).body;
}

test('labour tables ABSENT: flash renders, says not-pulled, estimates nothing', () => {
  const db = makeSalesDb(); // no labour tables at all — safeSelect degrades to []
  const body = renderReports(db);
  assert.ok(body.includes('Labour (RotaCloud · true cost)'), 'labour section present');
  assert.ok(body.includes('No labour pulled for this period yet'), body.slice(0, 200));
  assert.ok(!body.includes('Labour cost (true)'), 'no cost tile without data');
});

test('labour seeded: true cost, RAG vs 30% on SAME-DAY net, variance, daypart merge', () => {
  const db = makeSalesDb();
  addLabourTables(db);
  seedLabourDay(db, '2026-07-01');
  db.prepare(`INSERT INTO labour_hourly (business_date, hour, actual_minutes, actual_cost_pence, updated_at) VALUES ('2026-07-01', 12, 306, 6508, ?)`).run(NOW);
  // post-midnight labour (hour 24 = wall-clock 00:00) merges onto the sales 0:00 row
  db.prepare(`INSERT INTO labour_hourly (business_date, hour, actual_minutes, actual_cost_pence, updated_at) VALUES ('2026-07-01', 24, 30, 700, ?)`).run(NOW);
  const body = renderReports(db);

  assert.ok(body.includes('Labour cost (true)'), 'cost tile present');
  assert.ok(body.includes('£1,231.72'), 'the true cost figure');
  assert.ok(body.includes('£316.42 salaried/365'), 'salaried slice named');
  // £-CONSEQUENCE leads: permitted = 30% × £2,802.70 = £840.81; delta = +£390.91 → red
  assert.ok(body.includes('£390.91 OVER'), 'the £ leads');
  assert.ok(/vs the 30% target — true-cost ruler<\/div><div class="val" style="color:var\(--red/.test(body), 'red at 43.9%');
  assert.ok(body.includes('43.9% of net'), 'the % is the subtitle');
  assert.ok(body.includes('permitted £840.81 at 30%'), 'the permitted £ is stated');
  assert.ok(body.includes('85.0h → 78.5h'), 'rota’d → worked variance');
  assert.ok(body.includes('−6.5h vs rota'), 'signed variance');
  assert.ok(body.includes('Daypart — labour vs sales by hour'), 'daypart table present');
  assert.ok(body.includes('>0:00<'), 'post-midnight labour merged onto the 0:00 wall-clock row');
  assert.ok(!body.includes('labour % needs wage rates'), 'the old not-wired hint is gone');
});

test('£-delta tile: green under (£ leads), amber in the 30–33 grace band', () => {
  const green = makeSalesDb();
  addLabourTables(green);
  seedLabourDay(green, '2026-07-01', { ac: 80000 }); // 28.5% → £40.81 under
  const gb = renderReports(green);
  assert.ok(gb.includes('£40.81 under'), 'under stated in £');
  assert.ok(/vs the 30% target — true-cost ruler<\/div><div class="val" style="color:var\(--green/.test(gb), 'green ≤30');

  const amber = makeSalesDb();
  addLabourTables(amber);
  seedLabourDay(amber, '2026-07-01', { ac: 87000 }); // 31.0% → £29.19 OVER, amber band
  const ab = renderReports(amber);
  assert.ok(ab.includes('£29.19 OVER'));
  assert.ok(/vs the 30% target — true-cost ruler<\/div><div class="val" style="color:var\(--amber/.test(ab), 'amber ≤33');
});

test('unmapped staff: named, hours shown, cost exclusion stated', () => {
  const db = makeSalesDb();
  addLabourTables(db);
  seedLabourDay(db, '2026-07-01', { uam: 194, un: '["David Brown","Fern Alexander"]' });
  const body = renderReports(db);
  assert.ok(body.includes('Unmapped staff'), 'tile present');
  assert.ok(body.includes('3.2h'), 'unmapped hours visible');
  assert.ok(body.includes('cost EXCLUDED'), 'exclusion stated, never estimated');
  assert.ok(body.includes('David Brown, Fern Alexander'), 'names surfaced for the operator to fix');
});

test('partial coverage: labour 1 of 2 sales days → said plainly, % against covered net only', () => {
  const db = makeSalesDb();
  db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence, transactions, updated_at) VALUES ('2026-06-30', 406195, 114, ?)`).run(NOW);
  addLabourTables(db);
  seedLabourDay(db, '2026-07-01');
  const body = renderReports(db, { period: 'week' }); // calendar Mon–Sun 06-29→07-05 holds both days
  assert.ok(body.includes('Labour covers 1 of 2 sales day(s)'), 'coverage honesty line');
  // % uses 2026-07-01 net (280270) NOT the 2-day total (686465): 123172/280270 = 43.9%
  assert.ok(body.includes('43.9%'), 'labour % against SAME-day net, never diluted by uncovered days');
  assert.ok(!body.includes('17.9%'), '123172/686465 would be the dishonest dilution');
});
