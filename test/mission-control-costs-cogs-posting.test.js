'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const { getSection, render } = require('../mission-control/ui/pages/coyote/costs.js');

const NOW = Date.parse('2026-09-01T12:00:00Z');
const DESIRED_MONTH = '2026-08';

const DDL = `
CREATE TABLE v_sales_day_all (business_date TEXT, net_sales_pence INTEGER, premises TEXT);
CREATE TABLE labour_day (business_date TEXT PRIMARY KEY, actual_cost_pence INTEGER, salaried_cost_pence INTEGER, updated_at INTEGER);
CREATE TABLE qb_accounts (realm_id TEXT, account_id TEXT, name TEXT, acct_type TEXT, classification TEXT);
CREATE TABLE qb_pl_monthly (realm_id TEXT, month TEXT, account_id TEXT, account_name TEXT, net_pence INTEGER);
CREATE TABLE qb_journal_lines (realm_id TEXT, period_month TEXT, txn_date TEXT, account_id TEXT, account_name TEXT, debit_pence INTEGER, credit_pence INTEGER);
CREATE TABLE recipe_lines (product_id TEXT, sub_item_id TEXT, quantity REAL);
CREATE TABLE products (id TEXT PRIMARY KEY, lightspeed_sku TEXT, name TEXT, category TEXT);
CREATE TABLE sub_items (id TEXT PRIMARY KEY, name TEXT, pack_cost_pence INTEGER, pack_qty REAL, unit_of_measure TEXT);
CREATE TABLE sales_receipts_api (receipt_id TEXT PRIMARY KEY, business_date TEXT, type TEXT, cancelled INTEGER);
CREATE TABLE sales_receipt_lines_api (receipt_id TEXT, line_id TEXT, business_date TEXT, sku TEXT, name TEXT, quantity REAL, net_with_tax_pence INTEGER, net_without_tax_pence INTEGER, PRIMARY KEY (receipt_id, line_id));
`;

function monthShift(ym, offset) {
  const date = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}

function seedMonth(db, desiredJournalLines) {
  db.exec(DDL);
  db.exec(`
    INSERT INTO v_sales_day_all VALUES
      ('2026-08-01',6000000,'current'),
      ('2026-08-31',4000000,'current');
    INSERT INTO qb_accounts VALUES
      ('r1','cogs','Food purchases','Cost of Goods Sold','Expense'),
      ('r1','pack','Packaging','Expense','Expense'),
      ('r1','rent','Rent (205)','Expense','Expense'),
      ('r1','ins','Insurance (207)','Expense','Expense');
  `);

  const pl = db.prepare(`INSERT INTO qb_pl_monthly VALUES ('r1',?,?,?,?)`);
  const journal = db.prepare(`INSERT INTO qb_journal_lines VALUES ('r1',?,?,?,'Purchases',1000,0)`);
  for (let offset = -6; offset <= 0; offset += 1) {
    const ym = monthShift(DESIRED_MONTH, offset);
    pl.run(ym, 'cogs', 'Food purchases', offset === 0 ? 3000000 : 2800000);
    pl.run(ym, 'pack', 'Packaging', 500000);
    pl.run(ym, 'rent', 'Rent (205)', 1500000);
    pl.run(ym, 'ins', 'Insurance (207)', 500000);
    const lineCount = offset === 0 ? desiredJournalLines : 10;
    for (let line = 0; line < lineCount; line += 1) {
      journal.run(ym, `${ym}-15`, `${ym}-${line}`);
    }
  }
}

function renderCogs(db) {
  const ctx = {
    q: (sql, params) => DATA.safeSelect(db, sql, params),
    now: NOW,
    query: { tab: 'cogs' },
  };
  return render(getSection(db, ctx), ctx).body;
}

test('COGS withholds an unsettled calendar-complete month without hiding complete sales or independent panels', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  seedMonth(db, 2);
  const body = renderCogs(db);

  assert.doesNotMatch(body, /actual COGS \d+(?:\.\d+)?% of net/i,
    'an incomplete purchase posting must not produce a COGS ratio');
  assert.match(body, /Aug 2026/, 'the gated month is named');
  assert.match(body, /purchase posting is incomplete/i, 'the reason for withholding is explicit');
  assert.match(body, /returns automatically once posting is complete/i,
    'the operator is told that COGS restores without intervention');
  assert.match(body, /complete automatic-feed sales remain available: £100,000/i,
    'calendar-complete sales remain visible');
  assert.match(body, /Ingredient price watch[\s\S]*Stock and waste control/,
    'independently complete tab content remains rendered');
});

test('COGS prices and renders normally once the desired month is fully posted', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  seedMonth(db, 10);
  const body = renderCogs(db);

  assert.match(body, /actual COGS 30\.0% of net/i, 'the settled month restores the normal ratio');
  assert.match(body, /Food purchases[\s\S]*£30,000/, 'the settled COGS account is priced normally');
  assert.doesNotMatch(body, /ratio withheld|purchase posting is incomplete/i,
    'the posting gate is absent for a settled month');
});
