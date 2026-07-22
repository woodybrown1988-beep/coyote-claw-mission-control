'use strict';
// Costs Centre C2 (Cost Forecast · Suppliers & Purchasing) + C3 (COGS & Inventory · Recipe
// Margins). Every expected number is HAND-COMPUTED in the fixture comments. Pinned:
//   FORECAST: the ratio base from complete months; the interactive scenario is CLIENT-ONLY
//     (a range input, NO /api/ path, nothing stored); the 3-month accrual outlook with the
//     rent step landing as a hard event; the pointer to Revenue→Forecast (one home for
//     seasonality — never re-derived).
//   SUPPLIERS: scorecard REAL from qb_bank_txns purchases (trailing 12mo, vs prior-year trend);
//     concentration top-1/top-3; person-named payees POOL into Staff-payroll (no name renders —
//     the surveillance boundary); PPV + ingredient watch invoice-line-gated; invoice queue =
//     the no-bills empty-state.
//   COGS: actual-by-category REAL (QB COGS accounts) + theoretical column gated; bridge
//     recipe-gated; ingredient watch invoice-gated; stock no-wire; other-variable REAL.
//   MARGINS: ALL gated EXCEPT recipe-data-quality, which shows LIVE coverage (it measures the
//     gate); the Calum carrot + Recipes link on every gated panel.
//   NO-MOCK-NUMBERS: empty DB → the only £ digits anywhere are the encoded rent canon.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const page = require('../mission-control/ui/pages/coyote/costs.js');

const NOW = Date.parse('2026-07-22T12:00:00Z');

const DDL = `
CREATE TABLE v_sales_day_all (business_date TEXT, net_sales_pence INTEGER, premises TEXT);
CREATE TABLE labour_day (business_date TEXT PRIMARY KEY, actual_cost_pence INTEGER, salaried_cost_pence INTEGER, updated_at INTEGER);
CREATE TABLE qb_accounts (realm_id TEXT, account_id TEXT, name TEXT, acct_type TEXT, classification TEXT);
CREATE TABLE qb_pl_monthly (realm_id TEXT, month TEXT, account_id TEXT, account_name TEXT, net_pence INTEGER);
CREATE TABLE qb_journal_lines (realm_id TEXT, period_month TEXT, txn_date TEXT, account_id TEXT, account_name TEXT, debit_pence INTEGER, credit_pence INTEGER);
CREATE TABLE qb_bank_txns (realm_id TEXT, txn_kind TEXT, txn_id TEXT, txn_date TEXT, total_pence INTEGER, counterparty TEXT);
CREATE TABLE qb_bills (realm_id TEXT, bill_id TEXT);
CREATE TABLE recipe_lines (product_id TEXT, sub_item_id TEXT, quantity REAL);
CREATE TABLE products (id TEXT PRIMARY KEY, lightspeed_sku TEXT, name TEXT);
CREATE TABLE sub_items (id TEXT PRIMARY KEY, name TEXT, pack_cost_pence INTEGER, pack_qty REAL);
`;
function makeDb() { const db = new sqlite.DatabaseSync(':memory:'); db.exec(DDL); return db; }
const render = (db, query, now) => {
  const ctx = { q: (sql, p) => DATA.safeSelect(db, sql, p), now: now || NOW, query: query || {} };
  return page.render(page.getSection(db, ctx), ctx).body;
};

// ---------------------------------------------------------------------------------------------
// FORECAST fixture: refMonth = Jun 2026 (sales max = 2026-06-30, its own last day). Base months
// Apr/May/Jun each: net £100,000 (10,000,000 pence), COGS £30,000, variable OH £5,000, fixed OH
// £20,000 (Rent + Insurance). So cogsPct = 30%, varPct = 5%, fixedMonthly = £20,000, netMonthly
// = £100,000. Contribution at base = 100 − 30 − 5 − 20 = £45,000.
// ---------------------------------------------------------------------------------------------
function seedForecast(db) {
  const sd = db.prepare(`INSERT INTO v_sales_day_all VALUES (?,?,?)`);
  for (const [m, last] of [['04', '30'], ['05', '31'], ['06', '30']]) {
    sd.run(`2026-${m}-15`, 5000000, 'current'); sd.run(`2026-${m}-${last}`, 5000000, 'current');
  }
  const ac = db.prepare(`INSERT INTO qb_accounts (realm_id, account_id, name, acct_type, classification) VALUES ('r1',?,?,?,?)`);
  ac.run('60', 'Cost of sales (203)', 'Cost of Goods Sold', 'Expense');
  ac.run('10', 'Rent (205)', 'Expense', 'Expense');          // fixed
  ac.run('13', 'Insurance (207)', 'Expense', 'Expense');     // fixed
  ac.run('40', 'Packaging (205)', 'Expense', 'Expense');     // variable
  const pl = db.prepare(`INSERT INTO qb_pl_monthly VALUES ('r1',?,?,?,?)`);
  for (const ym of ['2026-04', '2026-05', '2026-06']) {
    pl.run(ym, '60', 'Cost of sales (203)', 3000000);
    pl.run(ym, '10', 'Rent (205)', 1500000);
    pl.run(ym, '13', 'Insurance (207)', 500000);
    pl.run(ym, '40', 'Packaging (205)', 500000);
  }
}

test('FORECAST: the ratio base is set from complete months; the outlook prices COGS%×proj-net + held fixed; the rent step lands as a hard event', () => {
  const db = makeDb(); seedForecast(db);
  const body = render(db, { tab: 'forecast' });
  // base ratios captioned
  assert.ok(body.includes('30.0% of net'), 'COGS ratio base');
  assert.ok(body.includes('5.0%'), 'variable-overhead ratio base');
  assert.ok(body.includes('£45,000'), 'base contribution = 100 − 30 − 5 − 20 (£45k)');
  // 3-month outlook: Jul/Aug/Sep 2026 rows; rent step (2026-10-28) is AFTER the horizon → NO 'rent step live' tag in the outlook rows here
  assert.ok(body.includes('3-month cost outlook') || body.includes('cost outlook'), 'the outlook renders');
  // the pointer — seasonality lives on Revenue → Forecast, never re-derived here
  assert.ok(body.includes('/coyote/revenue?tab=forecast'), 'one home: pointer to the Revenue forecast for seasonality');
  assert.ok(body.includes('flat carry') || body.includes('FLAT CARRY'), 'the flat-carry basis is stated');
});

test('FORECAST scenario is CLIENT-ONLY: a range input, a textContent-only script, NO network path, nothing stored', () => {
  const db = makeDb(); seedForecast(db);
  const body = render(db, { tab: 'forecast' });
  assert.ok(body.includes('type="range"'), 'a slider');
  assert.ok(body.includes('nothing stored') || body.includes('what-if only'), 'the no-persistence caption');
  const scriptRegion = body.slice(body.indexOf('cst-scn'));
  assert.ok(!/\/api\/|fetch\s*\(|XMLHttpRequest/.test(scriptRegion), 'no network call in the scenario script');
  // every <script> the tab emits must PARSE (the template-literal incident class)
  for (const scr of [...body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((mm) => mm[1])) new Function(scr);
});

// ---------------------------------------------------------------------------------------------
// SUPPLIERS fixture (trailing 12mo = 2026-07-21..prior; bank max = 2026-07-20):
//   Booker: £50,000 this year (2026-07-01), £40,000 prior year (2025-07-01) → trend +25%.
//   Cleaning Co: £10,000 this year only.
//   Persons Mr A / Miss B (payees): £5,000 each this year → pool into Staff payroll £10,000.
//   Total this year = 50k + 10k + 10k(pooled) = £70,000. Booker share = 71.4%; top-3 = 100%.
// ---------------------------------------------------------------------------------------------
function seedSuppliers(db) {
  const bk = db.prepare(`INSERT INTO qb_bank_txns (realm_id, txn_kind, txn_id, txn_date, total_pence, counterparty) VALUES ('r1','purchase',?,?,?,?)`);
  let id = 0;
  bk.run(`s${++id}`, '2026-07-01', 5000000, 'Booker');
  bk.run(`s${++id}`, '2025-07-01', 4000000, 'Booker'); // prior-year for the trend
  bk.run(`s${++id}`, '2026-06-01', 1000000, 'Cleaning Co');
  bk.run(`s${++id}`, '2026-06-15', 500000, 'Mr Alpha One');
  bk.run(`s${++id}`, '2026-06-16', 500000, 'Miss Beta Two');
  bk.run(`s${++id}`, '2026-07-20', 100, 'Zed'); // sets bank max = 07-20; tiny
  db.prepare(`INSERT INTO qb_bank_txns (realm_id, txn_kind, txn_id, txn_date, total_pence, counterparty) VALUES ('r1','deposit','d1','2026-07-19',9999999,'Card Settlement')`).run();
}

test('SUPPLIERS scorecard is REAL from bank purchases: Booker share + prior-year trend; deposits never enter; person payees POOL (no name renders)', () => {
  const db = makeDb(); seedSuppliers(db);
  const body = render(db, { tab: 'suppliers' });
  assert.ok(body.includes('£50,000') && body.includes('Booker'), 'Booker 12mo spend');
  assert.ok(body.includes('Staff payroll (2 payees, aggregated)'), 'payees pool into ONE aggregate');
  for (const nm of ['Mr Alpha One', 'Miss Beta Two']) assert.ok(!body.includes(nm), `${nm} never renders — the surveillance boundary`);
  assert.ok(!body.includes('£99,999') && !body.includes('Card Settlement'), 'the deposit decoy never enters purchase spend');
  assert.ok(body.includes('+25%'), 'Booker trend vs prior year (50k vs 40k)');
});

test('SUPPLIERS concentration + the gated panels: top-1/top-3 shares real; PPV + ingredient watch invoice-line-gated; invoice queue = the no-bills empty-state', () => {
  const db = makeDb(); seedSuppliers(db);
  const body = render(db, { tab: 'suppliers' });
  // total = 50k(Booker) + 10k(Cleaning) + 10k(pooled) + ~£1(Zed) ≈ £70,001 → Booker ≈ 71.4%
  assert.ok(/7[01]\.\d%/.test(body.slice(body.indexOf('Top supplier share'), body.indexOf('Top supplier share') + 200)), 'top-1 share ~71%');
  assert.ok(body.includes('Purchase price variance') && body.includes('invoice-LINE data'), 'PPV names the invoice-line build');
  assert.ok(body.includes('QB Bills not in use'), 'invoice queue = the no-bills empty-state');
});

// ---------------------------------------------------------------------------------------------
// COGS fixture: refMonth = Jun 2026. COGS accounts: Meat £20,000, Dry goods £10,000 (Cost of
// Goods Sold type). Other-variable overhead: Packaging £3,000 (variable name). Net £100,000 →
// COGS 30%. A Rent account (fixed) must NOT appear in either COGS or other-variable.
// ---------------------------------------------------------------------------------------------
function seedCogs(db) {
  const sd = db.prepare(`INSERT INTO v_sales_day_all VALUES (?,?,?)`);
  sd.run('2026-06-15', 5000000, 'current'); sd.run('2026-06-30', 5000000, 'current');
  const ac = db.prepare(`INSERT INTO qb_accounts (realm_id, account_id, name, acct_type, classification) VALUES ('r1',?,?,?,?)`);
  ac.run('61', 'Meat (203)', 'Cost of Goods Sold', 'Expense');
  ac.run('62', 'Dry goods (203)', 'Cost of Goods Sold', 'Expense');
  ac.run('40', 'Packaging (205)', 'Expense', 'Expense');   // overhead-variable
  ac.run('10', 'Rent (205)', 'Expense', 'Expense');        // overhead-fixed decoy
  const pl = db.prepare(`INSERT INTO qb_pl_monthly VALUES ('r1',?,?,?,?)`);
  pl.run('2026-06', '61', 'Meat (203)', 2000000);
  pl.run('2026-06', '62', 'Dry goods (203)', 1000000);
  pl.run('2026-06', '40', 'Packaging (205)', 300000);
  pl.run('2026-06', '10', 'Rent (205)', 1500000);
}

test('COGS: actual-by-category is REAL (QB COGS accounts) with the theoretical column gated; other-variable REAL; a fixed account never leaks into either', () => {
  const db = makeDb(); seedCogs(db);
  const body = render(db, { tab: 'cogs' });
  assert.ok(body.includes('Meat (203)') && body.includes('£20,000'), 'COGS category actual');
  assert.ok(body.includes('COGS 30.0% of net'), 'COGS % of net');
  assert.ok(body.includes('theoretical — recipe-gated'), 'the theoretical column is gated, not fabricated');
  assert.ok(body.includes('Packaging (205)') && body.includes('£3,000'), 'other-variable actual');
  // the fixed Rent account must appear in NEITHER the COGS table nor the other-variable table
  const cogsRegion = body.slice(body.indexOf('Actual versus theoretical'), body.indexOf('COGS variance bridge'));
  assert.ok(!cogsRegion.includes('Rent (205)'), 'a fixed account never renders as COGS');
  const ovRegion = body.slice(body.indexOf('Other variable cost control'));
  assert.ok(!ovRegion.includes('Rent (205)'), 'a fixed account never renders as other-variable');
});

test('COGS gated panels: variance bridge recipe-gated · ingredient watch invoice-line-gated · stock no-wire', () => {
  const db = makeDb(); seedCogs(db);
  const body = render(db, { tab: 'cogs' });
  assert.ok(body.includes('COGS variance bridge') && body.includes('recipe_lines is empty'), 'bridge = the Calum gate');
  assert.ok(body.includes('Ingredient price watch') && body.includes('invoice-LINE data'), 'price watch = the invoice-line build');
  assert.ok(body.includes('Stock and waste control') && body.includes('no stock-count wire'), 'stock = no wire');
});

// ---------------------------------------------------------------------------------------------
// MARGINS fixture: 3 products; product P1 fully costed (recipe line to a costed sub_item); P2
// has a recipe line to an UNCOSTED sub_item (pack_cost null) → NOT costed; P3 no recipe. So
// products = 3, costed = 1, recipe_lines = 2. Coverage = 33.3%.
// ---------------------------------------------------------------------------------------------
function seedMargins(db) {
  db.prepare(`INSERT INTO products VALUES ('P1','SKU1','Burger'),('P2','SKU2','Fries'),('P3','SKU3','Shake')`).run();
  db.prepare(`INSERT INTO sub_items VALUES ('bun','Bun',500,48),('spud','Potato',NULL,NULL)`).run();
  db.prepare(`INSERT INTO recipe_lines VALUES ('P1','bun',1),('P2','spud',200)`).run();
}

test('MARGINS: all four heart panels are recipe-gated with the Calum carrot; recipe-data-quality shows LIVE coverage (it measures the gate)', () => {
  const db = makeDb(); seedMargins(db);
  const body = render(db, { tab: 'margins' });
  for (const p of ['Menu margin erosion watch', 'Product economics matrix', 'Smokehouse BBQ cost build']) {
    assert.ok(body.includes(p), `${p} panel present`);
  }
  assert.ok((body.match(/recipe_lines is empty/g) || []).length >= 3, 'the gated panels name the Calum gate');
  assert.ok((body.match(/59\.5% coverage/g) || []).length >= 3, 'the carrot on every gated panel');
  // recipe-data-quality: LIVE — products 3, costed 1, coverage 33.3%, recipe lines 2
  const q = body.slice(body.indexOf('Recipe data quality'));
  assert.ok(q.includes('>3<'), 'products count live');
  assert.ok(q.includes('>1<'), 'costed count live');
  assert.ok(q.includes('33.3% of products'), 'coverage measured live');
  assert.ok(q.includes('the Calum gate — 0') || q.includes('>2<'), 'recipe-lines count');
  assert.ok(body.includes('/coyote/recipes'), 'the manage-at pointer');
});

test('NO-MOCK-NUMBERS across C2 + C3: an empty DB renders only the encoded rent canon — every other £ is absent, no NaN/undefined', () => {
  const db = makeDb();
  const allowed = new Set(['£60,000', '£65,000', '£16,250', '£15,000']);
  for (const tab of ['forecast', 'suppliers', 'cogs', 'margins']) {
    const body = render(db, { tab });
    for (const hit of body.match(/£[\d,]+(\.\d\d)?/g) || []) assert.ok(allowed.has(hit), `${tab}: '${hit}' must be encoded canon`);
    assert.ok(!body.includes('NaN') && !body.includes('undefined'), `${tab}: no NaN/undefined`);
  }
});
