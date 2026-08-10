'use strict';
// Duplication-wave PARITY TESTS (operator ruling 2026-08-10 — shared constants + revenue-of-record):
//   (1) the Labour Centre's formula math READS canon_constants (the engine's table) — proven by
//       seeding NON-ruled values and watching the rendered figures follow the DB, not a hardcode;
//   (2) with the RULED values the rendered figures equal hand arithmetic vs direct SQL;
//   (3) the Revenue monthly record equals v_sales_day_all's output (the day-net canon) even when
//       the per-receipt table deliberately carries DIFFERENT sums — receipts are line-level, not
//       the revenue-of-record;
//   (4) NEGATIVE CONTROL — canon_constants absent → the EXPLICIT "Ruled constants unavailable"
//       state and ZERO formula figures (never silent hardcoded numbers).
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const labour = require('../mission-control/ui/pages/coyote/labour.js');
const reports = require('../mission-control/ui/pages/coyote/reports.js');

const NOW = 1784800000000; // 2026-07-23 → labour maxDate Sunday 2026-07-19 = last full week 07-13..19
const ctxFor = (db, query) => ({ q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, halt: { halted: false }, query: query || {} });
const renderLabour = (db, query) => {
  const ctx = ctxFor(db, query);
  return labour.render(labour.getSection(db, ctx), ctx);
};

// ---- labour fixture: one full Mon–Sun week (2026-07-13..19), net £3,000/day, TRUE £900/day
// (salaried £200 inside) → week net £21,000, salaried £1,400 (the L1 arithmetic, reused). ----
function labourDb({ canon } = {}) {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sales_day (business_date TEXT PRIMARY KEY, net_sales_pence INTEGER, updated_at INTEGER);
    CREATE TABLE labour_day (business_date TEXT PRIMARY KEY, scheduled_minutes INTEGER, actual_minutes INTEGER, actual_paid_minutes INTEGER, scheduled_cost_pence INTEGER, actual_cost_pence INTEGER, salaried_cost_pence INTEGER, unmapped_scheduled_minutes INTEGER, unmapped_actual_minutes INTEGER, unmapped_names TEXT, anomalies TEXT, staff_scheduled INTEGER, staff_worked INTEGER, updated_at INTEGER);
  `);
  if (canon) {
    db.exec(`CREATE TABLE canon_constants (key TEXT PRIMARY KEY, value TEXT NOT NULL, as_of TEXT NOT NULL, note TEXT);`);
    const ins = db.prepare(`INSERT INTO canon_constants (key, value, as_of, note) VALUES (?, ?, '2026-08-10', NULL)`);
    for (const [k, v] of Object.entries(canon)) ins.run(k, String(v));
  }
  const sd = db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence) VALUES (?, 300000)`);
  const ld = db.prepare(`INSERT INTO labour_day (business_date, actual_minutes, actual_paid_minutes, scheduled_cost_pence, actual_cost_pence, salaried_cost_pence, unmapped_names) VALUES (?, 3000, 3050, 85000, 90000, 20000, '[]')`);
  for (let i = 13; i <= 19; i++) { sd.run(`2026-07-${i}`); ld.run(`2026-07-${i}`); }
  return db;
}

const RULED = {
  'labour.employer_burden_multiplier': '1.159',
  'labour.var_rate_kitchen': '0.143',
  'labour.var_rate_foh': '0.081',
  'labour.combined_anchor': '0.30',
  'labour.materiality_pence': '4500',
};

test('PARITY: with the RULED canon values the labour formula budget equals hand arithmetic vs direct SQL', () => {
  const db = labourDb({ canon: RULED });
  const body = renderLabour(db, { tab: 'executive' }).body;
  // budget % = (Σ salaried + varRate × net) ÷ net = (140000 + 0.224×2100000)/2100000 = 29.1%
  const varRate = Number(db.prepare(`SELECT value FROM canon_constants WHERE key='labour.var_rate_kitchen'`).get().value)
    + Number(db.prepare(`SELECT value FROM canon_constants WHERE key='labour.var_rate_foh'`).get().value);
  const expected = (((140000 + varRate * 2100000) / 2100000) * 100).toFixed(1) + '%';
  assert.equal(expected, '29.1%', 'the hand sum itself (direct-SQL constants)');
  assert.ok(body.includes('29.1%'), 'the formula-budget % renders from the DB constants');
  assert.ok(body.includes('22.4% × net'), 'the caption quotes the DB-derived combined split');
  assert.ok(body.includes('kitchen 14.3% + FOH 8.1%'), 'the caption quotes the DB splits');
});

test('TEETH: changing canon_constants in the DB changes the rendered labour math — no hardcode survives', () => {
  // NON-ruled values: kitchen 25% + FOH 15% → varRate 40%; a hardcoded 0.224 would render 29.1%
  const db = labourDb({
    canon: {
      'labour.employer_burden_multiplier': '2.0',
      'labour.var_rate_kitchen': '0.25',
      'labour.var_rate_foh': '0.15',
      'labour.combined_anchor': '0.30',
      'labour.materiality_pence': '10000',
    },
  });
  const body = renderLabour(db, { tab: 'executive' }).body;
  // budget % = (140000 + 0.40×2100000)/2100000 = 46.7%
  assert.ok(body.includes('46.7%'), 'the formula-budget % follows the DB value');
  assert.ok(!body.includes('29.1%'), 'the old hardcoded-constant figure is GONE');
  assert.ok(body.includes('40.0% × net'), 'the caption follows the DB too');
  assert.ok(body.includes('kitchen 25.0% + FOH 15.0%'), 'per-dept caption splits follow the DB');
});

test('NEGATIVE CONTROL: no canon_constants table → the explicit unavailable state, zero formula figures, the stamp says so', () => {
  const db = labourDb({ canon: null });
  for (const tab of ['executive', 'forecast', 'rota', 'kitchen', 'foh', 'coverage']) {
    const out = renderLabour(db, { tab });
    assert.ok(out.body.includes('Ruled constants unavailable'), `${tab}: the explicit state`);
    assert.ok(out.body.includes('canon_constants'), `${tab}: names the missing table (the unlock)`);
    assert.ok(!out.body.includes('29.1%'), `${tab}: the ruled figure is never silently rendered`);
    assert.ok(!/formula budget/.test(out.body), `${tab}: no formula-budget panel at all`);
  }
  assert.match(renderLabour(db, { tab: 'executive' }).stamp, /ruled constants unavailable/);
  // a PARTIAL table (one key missing) is equally loud — never a partial/default mix
  const partial = labourDb({ canon: { 'labour.employer_burden_multiplier': '1.159' } });
  assert.ok(renderLabour(partial, { tab: 'executive' }).body.includes('Ruled constants unavailable'), 'missing keys gate too');
});

// ---- revenue-of-record parity: the monthly record == the VIEW's output, not the receipts ----
function revenueDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE premises_regime (name TEXT PRIMARY KEY, start_date TEXT, end_date TEXT, note TEXT);
    CREATE TABLE sales_day (business_date TEXT PRIMARY KEY, net_sales_pence INTEGER, transactions INTEGER, updated_at INTEGER);
    CREATE VIEW v_sales_day_all AS
      SELECT business_date, net_sales_pence, transactions,
             CASE WHEN business_date >= (SELECT start_date FROM premises_regime WHERE name='current') THEN 'current' ELSE 'previous' END AS premises
        FROM sales_day;
    CREATE TABLE sales_receipts_api (receipt_id TEXT PRIMARY KEY, business_date TEXT, type TEXT, cancelled INTEGER, account_profile_code TEXT, net_without_tax_pence INTEGER, updated_at INTEGER, table_name TEXT);
    CREATE TABLE sales_api_ingest_runs (business_date TEXT, source TEXT, status TEXT, receipts INTEGER, detail TEXT, pulled_at INTEGER, PRIMARY KEY (business_date, source));
  `);
  db.prepare(`INSERT INTO premises_regime VALUES ('current','2023-04-01',NULL,'moved')`).run();
  const insD = db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence, transactions, updated_at) VALUES (?,?,10,1)`);
  const insR = db.prepare(`INSERT INTO sales_receipts_api VALUES (?,?,'SALE',0,'LOCAL',?,1,NULL)`);
  const insL = db.prepare(`INSERT INTO sales_api_ingest_runs VALUES (?,?,'ok',1,'',1)`);
  const cal = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  const month = (ym, net) => {
    insD.run(`${ym}-01`, net);
    // the per-receipt table DELIBERATELY carries a different sum (the live 36/37-month
    // disagreement class, exaggerated) — the record must NOT read it
    insR.run(`R-${ym}`, `${ym}-01`, net * 2);
    for (let d = 1; d <= cal(ym); d++) insL.run(`${ym}-${String(d).padStart(2, '0')}`, 'kseries-sales-daily');
  };
  for (let mo = 1; mo <= 12; mo++) month(`2025-${String(mo).padStart(2, '0')}`, 1000000);
  for (let mo = 1; mo <= 6; mo++) month(`2026-${String(mo).padStart(2, '0')}`, 1100000);
  return db;
}

test('PARITY: the Revenue monthly record equals v_sales_day_all output — receipts (deliberately different) never leak in', () => {
  const db = revenueDb();
  const ctx = ctxFor(db, { tab: 'forecast' });
  const section = reports.getSection(db, ctx);
  assert.ok(section.rv2, 'rv2 built');
  const viewSum = db.prepare(`SELECT SUM(net_sales_pence) n FROM v_sales_day_all WHERE substr(business_date,1,7)='2026-01'`).get().n;
  const receiptSum = db.prepare(`SELECT SUM(net_without_tax_pence) n FROM sales_receipts_api WHERE substr(business_date,1,7)='2026-01'`).get().n;
  assert.equal(viewSum, 1100000, 'the view says £11,000.00 (direct SQL)');
  assert.equal(receiptSum, 2200000, 'the receipts say £22,000.00 (the decoy)');
  assert.equal(section.rv2.months['2026-01'].netPence, viewSum, 'the monthly record IS the view output');
  assert.notEqual(section.rv2.months['2026-01'].netPence, receiptSum, 'the receipt recompute is NOT the record');
  // full-year projection from the record: every pair 1.10 → 1.1 × £120,000 = £132,000 whole-pound KPI
  const html = reports.render(section, ctx).body;
  assert.match(html, /£132,000</, 'the projection KPI derives from the view record');
  assert.ok(!html.includes('£264,000'), 'the receipts-double never renders');
});
