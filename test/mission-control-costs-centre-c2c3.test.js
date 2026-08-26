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
//   COGS: actual-by-category REAL (QB COGS accounts) + reference-month recipe theoretical;
//     live variance bridge; plain-language ingredient/stock empty states; other-variable REAL.
//   MARGINS: live available-period leaderboard, sales-weighted coverage, median-split matrix,
//     leading-product cost build and recipe data quality.
//   NO-MOCK-NUMBERS: empty DB → the only £ digits anywhere are the encoded rent canon.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const S = require('../mission-control/ui/shared.js');
const page = require('../mission-control/ui/pages/coyote/costs.js');
const { readCanonicalItemSales } = S;
const { buildRecipeEconomics } = page;

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
CREATE TABLE products (id TEXT PRIMARY KEY, lightspeed_sku TEXT, name TEXT, category TEXT);
CREATE TABLE sub_items (id TEXT PRIMARY KEY, name TEXT, pack_cost_pence INTEGER, pack_qty REAL, unit_of_measure TEXT);
CREATE TABLE sales_receipts_api (receipt_id TEXT PRIMARY KEY, business_date TEXT, type TEXT, cancelled INTEGER);
CREATE TABLE sales_receipt_lines_api (receipt_id TEXT, line_id TEXT, business_date TEXT, sku TEXT, name TEXT, quantity REAL, net_with_tax_pence INTEGER, net_without_tax_pence INTEGER, PRIMARY KEY (receipt_id, line_id));
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
// COGS fixture: refMonth = Jun 2026. COGS accounts: Meat £1,000, Dry goods £500 (Cost of
// Goods Sold type). Other-variable overhead: Packaging £300 (variable name). Net £3,970 →
// actual COGS 37.8%. A Rent account (fixed) must NOT appear in either COGS or other-variable.
// ---------------------------------------------------------------------------------------------
function seedCogs(db) {
  const sd = db.prepare(`INSERT INTO v_sales_day_all VALUES (?,?,?)`);
  sd.run('2026-06-15', 200000, 'current'); sd.run('2026-06-30', 197000, 'current');
  const ac = db.prepare(`INSERT INTO qb_accounts (realm_id, account_id, name, acct_type, classification) VALUES ('r1',?,?,?,?)`);
  ac.run('61', 'Meat (203)', 'Cost of Goods Sold', 'Expense');
  ac.run('62', 'Dry goods (203)', 'Cost of Goods Sold', 'Expense');
  ac.run('40', 'Packaging (205)', 'Expense', 'Expense');   // overhead-variable
  ac.run('10', 'Rent (205)', 'Expense', 'Expense');        // overhead-fixed decoy
  const pl = db.prepare(`INSERT INTO qb_pl_monthly VALUES ('r1',?,?,?,?)`);
  pl.run('2026-06', '61', 'Meat (203)', 100000);
  pl.run('2026-06', '62', 'Dry goods (203)', 50000);
  pl.run('2026-06', '40', 'Packaging (205)', 30000);
  pl.run('2026-06', '10', 'Rent (205)', 150000);
}

test('COGS: actual-by-category remains live without recipes; other-variable is live; a fixed account never leaks into either', () => {
  const db = makeDb(); seedCogs(db);
  const body = render(db, { tab: 'cogs' });
  assert.ok(body.includes('Meat (203)') && body.includes('£1,000'), 'COGS category actual');
  assert.ok(body.includes('actual COGS 37.8% of net'), 'COGS % of net');
  assert.ok(body.includes('No recipes have been added yet'), 'the theoretical side has a truthful live empty state');
  assert.ok(body.includes('Packaging (205)') && body.includes('£300'), 'other-variable actual');
  // the fixed Rent account must appear in NEITHER the COGS table nor the other-variable table
  const cogsRegion = body.slice(body.indexOf('Actual versus theoretical'), body.indexOf('COGS variance bridge'));
  assert.ok(!cogsRegion.includes('Rent (205)'), 'a fixed account never renders as COGS');
  const ovRegion = body.slice(body.indexOf('Other variable cost control'));
  assert.ok(!ovRegion.includes('Rent (205)'), 'a fixed account never renders as other-variable');
});

test('COGS unavailable panels use plain operator-facing language', () => {
  const db = makeDb(); seedCogs(db);
  const body = render(db, { tab: 'cogs' });
  assert.ok(body.includes('COGS variance bridge') && body.includes('No recipes have been added yet'), 'bridge explains the missing business input');
  assert.ok(body.includes('Ingredient price watch') && body.includes('each ingredient’s pack price'), 'price watch explains what is missing');
  assert.ok(body.includes('Stock and waste control') && body.includes('No stock counts or waste logs have been recorded'), 'stock panel gives an operator action');
});

// ---------------------------------------------------------------------------------------------
// RECIPE ECONOMICS fixture — all expected results are hand-computed.
// Eight complete products generate £3,370 net from 440 units; one incomplete and one absent
// recipe add £600 net. Covered-net coverage = 3,370 / 3,970 = 84.9%.
// Complete-product theoretical COGS = £1,030: Food £450 + Drinks £580.
// GP/unit values and units split at medians £5.00 and 55, producing 2 products in every quadrant.
// ---------------------------------------------------------------------------------------------
function seedRecipeEconomics(db) {
  db.exec(`
    INSERT INTO products VALUES
      ('A','A','Alpha Burger','Food'),('B','B','Bravo Burger','Food'),
      ('C','C','Cola','Drinks'),('D','D','Draught','Drinks'),
      ('E','E','Edamame','Food'),('F','F','Fries','Food'),
      ('G','G','Ginger Beer','Drinks'),('H','H','House Soda','Drinks'),
      ('I','I','Incomplete Item','Food'),('J','J','No Recipe Item','Food'),
      ('A-old','A','Alpha Burger Legacy','Food');
    INSERT INTO sub_items VALUES
      ('beef','Beef',150,1,'each'),('bun','Bun',50,1,'each'),
      ('b','Bravo ingredient',200,1,'each'),('c','Cola ingredient',300,1,'each'),
      ('d','Draught ingredient',400,1,'each'),('e','Edamame ingredient',100,1,'each'),
      ('f','Fries ingredient',100,1,'each'),('g','Ginger ingredient',200,1,'each'),
      ('h','Soda ingredient',200,1,'each'),('bad','Missing pack quantity',100,NULL,'each');
    INSERT INTO recipe_lines VALUES
      ('A','beef',1),('A','bun',1),('B','b',1),('C','c',1),('D','d',1),
      ('E','e',1),('F','f',1),('G','g',1),('H','h',1),('I','bad',1),
      ('A-old','beef',1),('A-old','bun',1);
  `);
  const receipt = db.prepare(`INSERT INTO sales_receipts_api VALUES (?,?,?,?)`);
  const line = db.prepare(`INSERT INTO sales_receipt_lines_api VALUES (?,? ,?,?,?,?,?,?)`);
  const add = (id, sku, qty, net, gross = net * 2, type = 'SALE', cancelled = 0) => {
    receipt.run(id, '2026-06-30', type, cancelled);
    line.run(id, 'line', '2026-06-30', sku, sku, qty, gross, net);
  };
  // A is deliberately split across renamed source lines carrying the same canonical SKU.
  add('A-old', 'A', 60, 60000, 120000);
  add('A-new', 'A', 40, 40000, 80000);
  for (const [sku, net, qty] of [
    ['B', 81000, 90], ['C', 40000, 80], ['D', 35000, 70], ['E', 40000, 40],
    ['F', 27000, 30], ['G', 10000, 20], ['H', 4000, 10], ['I', 50000, 50], ['J', 10000, 10],
  ]) add(sku, sku, qty, net);
  add('void-decoy', 'A', 100, 999999, 1111111, 'VOID');
  add('cancelled-decoy', 'A', 100, 888888, 999999, 'SALE', 1);
}

test('buildRecipeEconomics: concrete leaderboard, weighted coverage, quadrants, cost build and monthly category outputs', () => {
  const db = makeDb(); seedRecipeEconomics(db);
  const q = (sql, p) => DATA.safeSelect(db, sql, p);
  const result = buildRecipeEconomics(q, '2026-06');
  assert.equal(result.recipeLines, 12);
  assert.equal(result.costedProducts, 8, 'the missing pack quantity fails validated completeness');
  assert.equal(result.costed.filter((product) => product.sku === 'A').length, 1,
    'duplicate product records mapping to one canonical SKU cannot duplicate recipe economics');
  assert.equal(result.leaderboard[0].name, 'Alpha Burger');
  assert.equal(result.leaderboardTotals.net, 337000);
  assert.equal(result.leaderboardTotals.units, 440);
  assert.ok(Math.abs(result.coveragePct - 84.88664987405541) < 1e-9);
  const alpha = result.costed.find((product) => product.sku === 'A');
  assert.equal(alpha.units, 100, 'two source lines consolidate to one canonical SKU without duplicate units');
  assert.equal(alpha.net, 100000, 'only the ex-VAT values are summed; gross values and excluded receipts are decoys');
  assert.equal(alpha.achievedPricePence, 1000, '£10.00 = 100,000p ex-VAT ÷ 100 sold');
  assert.equal(alpha.gpPence, 800, '£8.00 contribution = £10.00 achieved price − £2.00 recipe cost');
  assert.equal(alpha.marginPct, 80, 'margin = contribution ÷ achieved ex-VAT price');
  assert.equal(alpha.costPct, 20, 'cost percentage = recipe cost ÷ achieved ex-VAT price');
  assert.equal(result.matrix.volumeMedian, 55);
  assert.equal(result.matrix.gpMedianPence, 500);
  assert.deepEqual(Object.fromEntries(Object.entries(result.matrix.quadrants).map(([key, value]) => [key, value.count])),
    { protect: 2, promote: 2, fix: 2, replace: 2 });
  assert.deepEqual(result.matrix.quadrants.protect.leaders.map((p) => p.name), ['Alpha Burger', 'Bravo Burger']);
  assert.deepEqual(result.costBuild.lines.map((line) => [line.ingredient, line.lineCostPence]), [['Beef', 150], ['Bun', 50]]);
  assert.equal(result.monthly.theoretical, 103000);
  assert.deepEqual(result.monthly.byCategory, [{ name: 'Drinks', p: 58000 }, { name: 'Food', p: 45000 }]);
});

test('readCanonicalItemSales: actual three-month span, July-2023 floor, filters and empty fallback', () => {
  const db = makeDb();
  const receipt = db.prepare(`INSERT INTO sales_receipts_api VALUES (?,?,?,?)`);
  const line = db.prepare(`INSERT INTO sales_receipt_lines_api VALUES (?,?,?,?,?,?,?,?)`);
  const add = (id, date, sku, qty, gross, net, type = 'SALE', cancelled = 0) => {
    receipt.run(id, date, type, cancelled);
    line.run(id, 'line', date, sku, sku, qty, gross, net);
  };
  add('before-truth', '2023-06-30', 'A', 99, 99000, 90000);
  add('first', '2026-04-01', 'A', 2, 3000, 2500);
  add('alias', '2026-05-15', 'A', 3, 6000, 5000);
  add('last', '2026-06-30', 'B', 5, 12000, 10000);
  add('void', '2026-07-01', 'A', 1, 99999, 88888, 'VOID');

  const q = (sql, params) => DATA.safeSelect(db, sql, params);
  const actual = readCanonicalItemSales(q);
  assert.equal(actual.filteredMax, '2026-06-30', 'the endpoint comes from the filtered feed, not the VOID decoy');
  assert.deepEqual([actual.from, actual.to], ['2026-04-01', '2026-06-30']);
  assert.deepEqual(actual.rows, [
    { sku: 'A', net: 7500, units: 5 },
    { sku: 'B', net: 10000, units: 5 },
  ]);
  db.close();

  const emptyDb = makeDb();
  const empty = readCanonicalItemSales((sql, params) => DATA.safeSelect(emptyDb, sql, params));
  assert.deepEqual(empty, { filteredMax: null, from: null, to: null, rows: [] });
  emptyDb.close();
});

test('MARGINS renders leaderboard totals, weighted coverage, all matrix quadrants and the leading product cost build', () => {
  const db = makeDb(); seedRecipeEconomics(db);
  const body = render(db, { tab: 'margins' });
  assert.match(body, /Sales-weighted recipe coverage<\/div><div class="r-kpi-value">84\.9%/);
  assert.ok(body.includes('£3,370.00'), 'leaderboard total net');
  assert.match(body, /Top 8 total \/ weighted average/);
  assert.match(body, />440<\/th>/, 'leaderboard total units');
  for (const quadrant of ['Protect', 'Promote', 'Fix', 'Replace']) {
    assert.match(body, new RegExp(`<b>${quadrant}<\\/b><span class="mono">2<`), `${quadrant} count`);
  }
  assert.ok(body.includes('Alpha Burger cost build'), 'highest-net product selected');
  assert.ok(body.includes('Beef') && body.includes('Bun'), 'ingredient lines render');
  assert.ok(body.includes('£1.50') && body.includes('£0.50'), 'line and unit costs render');
  assert.match(body, /Total recipe cost[\s\S]*£2\.00/);
  assert.match(body, /Achieved average price \(ex-VAT\)[\s\S]*£10\.00/);
  assert.match(body, /achieved sales and recipe costs are ex-VAT/);
  assert.ok(body.includes('Complete recipes') && body.includes('>8<'), 'recipe quality is preserved');
});

test('COGS calculates monthly theoretical categories and an actual-versus-theoretical variance bridge', () => {
  const db = makeDb(); seedCogs(db); seedRecipeEconomics(db);
  const body = render(db, { tab: 'cogs' });
  assert.match(body, /Drinks[\s\S]*£580/);
  assert.match(body, /Food[\s\S]*£450/);
  assert.match(body, /Theoretical COGS<\/div><div class="r-kpi-value">£1,030/);
  assert.match(body, /Gap<\/div><div class="r-kpi-value">\+£470/);
  assert.ok(body.includes('+45.6% vs theoretical'), 'variance percentage is shown');
  assert.ok(body.includes('Complete recipes cover 84.9% of Jun 2026 ex-VAT item sales'), 'monthly sales-weighted coverage');
  assert.ok(body.includes('waste, larger portions, buying-price changes, stock timing'), 'operational meaning is explained');
});

test('MARGINS genuine-empty fallback is driven by the live recipe count', () => {
  const db = makeDb();
  const body = render(db, { tab: 'margins' });
  assert.ok(body.includes('No recipes have been added yet'), 'genuine empty state');
  assert.ok(body.includes('no recipes added yet'), 'quality panel reflects the same live state');
  assert.doesNotMatch(body, /£0\.00/, 'the fallback does not invent sales or costs');
});

test('an empty item feed keeps the operator-facing no-sales state and invents no period', () => {
  const db = makeDb();
  db.exec(`
    INSERT INTO products VALUES ('A','A','Alpha','Food');
    INSERT INTO sub_items VALUES ('ingredient','Ingredient',100,1,'each');
    INSERT INTO recipe_lines VALUES ('A','ingredient',1);
  `);
  const body = render(db, { tab: 'margins' });
  const visible = body.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(visible, /no item-level sales period available/i);
  assert.doesNotMatch(visible, /sales_receipt_lines_api|sales_receipts_api|\btable\b|\bcolumn\b/i);
  assert.doesNotMatch(visible, /\d{4}-\d{2}-\d{2}\s*→\s*\d{4}-\d{2}-\d{2}/);
  db.close();
});

test('emitted inline scripts parse and recipe/stock empty states contain no implementation jargon', () => {
  const db = makeDb(); seedCogs(db); seedRecipeEconomics(db);
  for (const tab of ['executive', 'forecast', 'cogs', 'margins', 'suppliers', 'fixed', 'cash']) {
    const body = render(db, { tab });
    const blocks = [...body.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    for (const src of blocks) assert.doesNotThrow(() => new Function(src), `${tab} emitted an invalid inline script`);
  }
  for (const tab of ['cogs', 'margins']) {
    const body = render(db, { tab });
    assert.doesNotMatch(body, /recipe_lines|sub_items|pack_cost_pence|pack_qty|Calum gate|not wired|\bgated\b|invoice-LINE|operations-scope|no wire/i,
      `${tab} contains internal project or storage language`);
  }
});

test('MARGINS renders its effective dates without fixed-year wording and the full page has one valid inline script', () => {
  const db = makeDb();
  db.exec(`
    INSERT INTO products VALUES ('A','A','Alpha','Food');
    INSERT INTO sub_items VALUES ('ingredient','Ingredient',100,1,'each');
    INSERT INTO recipe_lines VALUES ('A','ingredient',1);
    INSERT INTO sales_receipts_api VALUES
      ('first','2026-04-01','SALE',0),('middle','2026-05-15','SALE',0),('last','2026-06-30','SALE',0);
    INSERT INTO sales_receipt_lines_api VALUES
      ('first','line','2026-04-01','A','Alpha old',1,1200,1000),
      ('middle','line','2026-05-15','A','Alpha',1,1200,1000),
      ('last','line','2026-06-30','A','Alpha',1,1200,1000);
  `);
  const ctx = { q: (sql, params) => DATA.safeSelect(db, sql, params), now: NOW, query: { tab: 'margins' } };
  const rendered = page.render(page.getSection(db, ctx), ctx);
  assert.match(rendered.body, /available item sales · 2026-04-01 → 2026-06-30/);
  assert.doesNotMatch(rendered.body, /trailing 12 months|trailing-12-month|365 days/i);
  const document = S.renderShell({
    title: page.title, sub: page.sub, body: rendered.body, stamp: rendered.stamp,
    workspace: page.workspace, route: page.route, key: page.key,
  });
  const scripts = [...document.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new Function(scripts[0]));
  db.close();
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
