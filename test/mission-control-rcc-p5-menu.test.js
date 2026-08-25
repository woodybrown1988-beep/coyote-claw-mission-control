'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const S = require('../mission-control/ui/shared.js');
const reports = require('../mission-control/ui/pages/coyote/reports.js');

const NOW = 1783000000000;

const DDL = `
CREATE TABLE premises_regime (name TEXT PRIMARY KEY, start_date TEXT, end_date TEXT, note TEXT);
CREATE TABLE sales_day (business_date TEXT PRIMARY KEY, net_sales_pence INTEGER, gross_sales_pence INTEGER, pos_guest_count INTEGER, transactions INTEGER, taxes_pence INTEGER, refunds_pence INTEGER, voids_pence INTEGER, discounts_pence INTEGER, comps_pence INTEGER, service_charges_pence INTEGER, tips_pence INTEGER, updated_at INTEGER);
CREATE TABLE sales_receipts_api (receipt_id TEXT PRIMARY KEY, business_date TEXT, type TEXT, cancelled INTEGER, account_profile_code TEXT, net_without_tax_pence INTEGER, updated_at INTEGER);
CREATE TABLE sales_receipt_lines_api (receipt_id TEXT NOT NULL, line_id TEXT NOT NULL, parent_line_id TEXT, business_date TEXT NOT NULL, sku TEXT, name TEXT, quantity REAL, net_with_tax_pence INTEGER, net_without_tax_pence INTEGER, tax_pence INTEGER, discount_pence INTEGER, accounting_group TEXT, time_of_sale_ms INTEGER, updated_at INTEGER NOT NULL, PRIMARY KEY (receipt_id, line_id));
CREATE TABLE sales_api_ingest_runs (business_date TEXT, source TEXT, status TEXT, receipts INTEGER, detail TEXT, pulled_at INTEGER, PRIMARY KEY (business_date, source));
CREATE TABLE sales_channel_map_api (account_profile_code TEXT PRIMARY KEY, profile_name TEXT, delivery_mode TEXT, channel_label TEXT, first_seen INTEGER, updated_at INTEGER, label_source TEXT);
CREATE TABLE acct_groups_api (code TEXT PRIMARY KEY, name TEXT, statistic_group TEXT, updated_at INTEGER);
CREATE TABLE products (id TEXT PRIMARY KEY, lightspeed_sku TEXT UNIQUE, name TEXT, category TEXT, updated_at INTEGER);
CREATE TABLE sub_items (id TEXT PRIMARY KEY, name TEXT, pack_cost_pence INTEGER, pack_qty REAL);
CREATE TABLE recipe_lines (product_id TEXT, sub_item_id TEXT, quantity REAL, PRIMARY KEY (product_id, sub_item_id));
`;

function makeDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(DDL);
  db.prepare(`INSERT INTO premises_regime VALUES ('previous','2022-02-20','2023-03-31',''),('current','2023-04-01',NULL,'moved')`).run();
  return db;
}

/**
 * Per-receipt max = 2026-07-11, so current = 2026-06-14..07-11 and prior = 05-17..06-13.
 * Current, SKU-consolidated:
 *   BURG 40u £400 (two names/lines), FRIES 30u £150, NEWP 11u £110, SHAKE 16u £80.
 * Prior: BURG £320, FRIES £300, SHAKE £120, WING £200. Thus every decliner is
 * FRIES £150, SHAKE £80, WING £0; the ≥£50 watch contains FRIES + WING.
 */
function seedSales(db) {
  const receipt = db.prepare(`INSERT INTO sales_receipts_api VALUES (?,?,?,?,'LOCAL',?,1)`);
  const line = db.prepare(`INSERT INTO sales_receipt_lines_api (receipt_id,line_id,business_date,sku,name,quantity,net_without_tax_pence,updated_at) VALUES (?,?,?,?,?,?,?,1)`);
  const add = (id, date, sku, name, qty, net, type = 'SALE', cancelled = 0) => {
    receipt.run(id, date, type, cancelled, net);
    line.run(id, 'l1', date, sku, name, qty, net);
  };

  add('A', '2026-07-10', 'BURG', 'Bacon Cheeseburger', 30, 30000);
  add('B', '2026-07-11', 'BURG', 'Bacon Cheese Burger (Single)', 10, 10000);
  add('C', '2026-07-05', 'FRIES', 'OG Dirty Fries', 30, 15000);
  add('D', '2026-07-06', 'SHAKE', 'Oreo Shake', 16, 8000);
  add('E', '2026-07-08', 'NEWP', 'Vegan BBQ', 11, 11000);
  add('F', '2026-07-09', 'ZMOD', 'Plain Bun add-on', 1, 0);
  add('X1', '2026-07-10', 'DEC1', 'Cancelled Burger', 1, 99900, 'SALE', 1);
  add('X2', '2026-07-10', 'DEC2', 'Void Burger', 1, 55500, 'VOID', 0);

  add('P1', '2026-06-01', 'BURG', 'Bacon Cheeseburger', 32, 32000);
  add('P2', '2026-06-01', 'FRIES', 'OG Dirty Fries', 60, 30000);
  add('P3', '2026-06-01', 'SHAKE', 'Oreo Shake', 24, 12000);
  add('P4', '2026-06-01', 'WING', 'Hangry Bird', 20, 20000);

  add('L1', '2025-07-01', 'BURG', 'Bacon Cheeseburger', 25, 25000);
  add('L2', '2025-07-01', 'SHAKE', 'Oreo Shake', 16, 8000);
  add('L3', '2025-06-01', 'FRIES', 'OG Dirty Fries', 20, 10000);
}

function seedCompleteRecipes(db) {
  db.exec(`
    INSERT INTO products VALUES
      ('product-burger','BURG','Bacon Cheeseburger','Mains',1),
      ('product-fries','FRIES','OG Dirty Fries','Sides',1),
      ('product-new','NEWP','Vegan BBQ','Mains',1),
      ('product-shake','SHAKE','Oreo Shake','Drinks',1);
    INSERT INTO sub_items VALUES
      ('bun','Bun',100,1),
      ('patty','Patty pack',1000,5),
      ('potato','Potato portion',400,1000),
      ('vegan','Vegan filling',200,1),
      ('shake','Shake ingredients',600,1);
    INSERT INTO recipe_lines VALUES
      ('product-burger','bun',1),
      ('product-burger','patty',1),
      ('product-fries','potato',1000),
      ('product-new','vegan',1),
      ('product-shake','shake',1);
  `);
}

function seedPartialRecipes(db) {
  db.exec(`
    INSERT INTO products VALUES
      ('product-burger','BURG','Bacon Cheeseburger','Mains',1),
      ('product-fries','FRIES','OG Dirty Fries','Sides',1),
      ('product-new','NEWP','Vegan BBQ','Mains',1),
      ('product-shake','SHAKE','Oreo Shake','Drinks',1);
    INSERT INTO sub_items VALUES
      ('bun','Bun',100,1),
      ('patty','Patty pack',1000,5),
      ('potato','Potato portion',400,1000),
      ('missing-pack','Vegan filling',200,NULL);
    INSERT INTO recipe_lines VALUES
      ('product-burger','bun',1),
      ('product-burger','patty',1),
      ('product-fries','potato',1000),
      ('product-new','missing-pack',1);
  `);
}

function rendered(db) {
  const ctx = { q: (sql, params) => DATA.safeSelect(db, sql, params), now: NOW, query: { tab: 'menu' } };
  const section = reports.getSection(db, ctx);
  const page = reports.render(section, ctx);
  return { section, page, html: page.body };
}

function textOnly(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

test('buildMenuPortfolio: concrete medians, inclusive boundaries, four classes and de-duplicated risk', () => {
  const result = reports.buildMenuPortfolio([
    { sku: 'BURG', qty: 40, net: 40000, unitCostPence: 300 },
    { sku: 'FRIES', qty: 30, net: 15000, unitCostPence: 400 },
    { sku: 'NEWP', qty: 11, net: 11000, unitCostPence: 200 },
    { sku: 'SHAKE', qty: 16, net: 8000, unitCostPence: 600 },
  ], [
    { sku: 'FRIES', now: 15000 },
    { sku: 'SHAKE', now: 8000 },
    { sku: 'WING', now: 0 },
  ]);

  assert.equal(result.popularityMedian, 30);
  assert.equal(result.contributionMedianPence, 700);
  assert.deepEqual(Object.fromEntries(result.products.map((p) => [p.sku, p.className])), {
    BURG: 'Winner',
    FRIES: 'Workhorse',
    NEWP: 'Opportunity',
    SHAKE: 'Dog',
  });
  assert.equal(result.products.find((p) => p.sku === 'BURG').contributionPence, 700, 'window net / units − summed unit cost');
  assert.equal(result.products.find((p) => p.sku === 'FRIES').className, 'Workhorse', 'exact popularity median enters high side');
  assert.equal(result.products.find((p) => p.sku === 'BURG').className, 'Winner', 'exact contribution median enters high side');
  assert.deepEqual(result.riskSkus, ['FRIES', 'SHAKE', 'WING'], 'Dog SHAKE is counted once when also declining');
  assert.equal(result.weeklyRiskPence, 5750);
  assert.equal(result.coveragePct, 100);
});

test('buildMenuPortfolio: partial and empty inputs keep uncosted items out with honest fallbacks', () => {
  const partial = reports.buildMenuPortfolio([
    { sku: 'A', qty: 4, net: 4000, unitCostPence: 250 },
    { sku: 'B', qty: 2, net: 1000, unitCostPence: null },
  ], null);
  assert.deepEqual(partial.plottable.map((p) => p.sku), ['A']);
  assert.equal(partial.awaitingCount, 1);
  assert.equal(partial.awaitingNet, 1000);
  assert.equal(partial.coveragePct, 80);

  const empty = reports.buildMenuPortfolio(null, undefined);
  assert.deepEqual(empty.products, []);
  assert.equal(empty.popularityMedian, null);
  assert.equal(empty.contributionMedianPence, null);
  assert.equal(empty.weeklyRiskPence, 0);
  assert.equal(empty.coveragePct, 0);
});

test('live recipes emit all bubbles, thresholds, classes, contribution, Dogs and weekly risk', () => {
  const db = makeDb();
  seedSales(db);
  seedCompleteRecipes(db);
  const { section, html } = rendered(db);

  assert.equal(section.menu.products.length, 4, 'zero-net, cancelled and VOID lines stay excluded');
  assert.equal((html.match(/class="bubble /g) || []).length, 4);
  for (const [sku, className] of [['BURG', 'Winner'], ['FRIES', 'Workhorse'], ['NEWP', 'Opportunity'], ['SHAKE', 'Dog']]) {
    assert.match(html, new RegExp(`data-menu-sku="${sku}" data-menu-class="${className}"`));
  }
  assert.match(html, /median 30 units/);
  assert.match(html, /median £7\.00/);
  assert.match(html, /Contribution on 100\.0% of window net/);
  assert.match(html, /Weekly revenue at risk<\/div><div class="r-kpi-value">£57\.50<\/div>/);
  assert.match(html, /Dogs<\/div><div class="r-kpi-value">1<\/div><div class="r-kpi-sub">£80\.00 combined current-window net/);
  assert.match(html, /<td class="r-num mono">£7\.00<\/td><td><span class="r-tag good">Winner<\/span>/);
  assert.match(html, /<td class="r-num mono">£1\.00<\/td><td><span class="r-tag warn">Workhorse<\/span>/);
  assert.match(html, /<td class="r-num mono">£8\.00<\/td><td><span class="r-tag info">Opportunity<\/span>/);
  assert.match(html, /<td class="r-num mono">−£1\.00<\/td><td><span class="r-tag bad">Dog<\/span>/);
  assert.match(html, /OG Dirty Fries[\s\S]*£1\.00 \/ item[\s\S]*Workhorse/, 'costed decliner response uses achieved contribution');
  assert.match(html, /Hangry Bird[\s\S]*href="\/coyote\/recipes">No recipe yet<\/a>/, 'uncosted decliner links to the recipe worklist');
  db.close();
});

test('SKU consolidation prevents duplicate plotting and KPI counting', () => {
  const db = makeDb();
  seedSales(db);
  seedCompleteRecipes(db);
  const { html } = rendered(db);

  assert.match(html, /Products selling<\/div><div class="r-kpi-value">4<\/div>/);
  assert.equal((html.match(/data-menu-sku="BURG"/g) || []).length, 1, 'two till names sharing BURG make one bubble');
  assert.doesNotMatch(html, /data-menu-sku="ZMOD"|data-menu-sku="DEC1"|data-menu-sku="DEC2"/);
  assert.doesNotMatch(html, /Bacon Cheese Burger \(Single\)/, 'the consolidated label is stable');
  assert.equal((html.match(/Weekly revenue at risk<\/div><div class="r-kpi-value">£57\.50/g) || []).length, 1);
  db.close();
});

test('partial recipes exclude incomplete and missing recipes, and report their exact exposure', () => {
  const db = makeDb();
  seedSales(db);
  seedPartialRecipes(db);
  const { html } = rendered(db);

  assert.equal((html.match(/class="bubble /g) || []).length, 2);
  assert.match(html, /data-menu-sku="BURG"/);
  assert.match(html, /data-menu-sku="FRIES"/);
  assert.doesNotMatch(html, /data-menu-sku="NEWP"|data-menu-sku="SHAKE"/);
  assert.match(html, /Contribution on 74\.3% of window net/);
  assert.match(html, /Awaiting recipes: 2 items, £190\.00 net/);
  assert.equal((html.match(/href="\/coyote\/recipes">No recipe yet<\/a>/g) || []).length, 3,
    'NEWP + SHAKE in performance and SHAKE in decline response use the recipe fallback');
  db.close();
});

test('empty recipe book emits friendly empty states and no internal implementation language', () => {
  const db = makeDb();
  seedSales(db);
  const { html } = rendered(db);
  const visible = textOnly(html);

  assert.equal((html.match(/class="bubble /g) || []).length, 0);
  assert.match(visible, /Portfolio awaiting recipes/);
  assert.match(visible, /Add a menu recipe to compare popularity with contribution/);
  assert.match(visible, /Awaiting recipes: 4 items, £740\.00 net/);
  assert.match(html, /Weekly revenue at risk<\/div><div class="r-kpi-value">—<\/div>/);
  assert.match(html, /Dogs<\/div><div class="r-kpi-value">—<\/div>/);
  assert.doesNotMatch(visible, /recipe_lines|sub_items|sales_receipt_lines_api|Calum gate|needs costing|not wired|\bgated\b/i);
  db.close();
});

test('Menu Growth emitted HTML retains one compiling inline client script', () => {
  const db = makeDb();
  seedSales(db);
  seedCompleteRecipes(db);
  const { page } = rendered(db);
  const document = S.renderShell({
    title: reports.title,
    sub: reports.sub,
    body: page.body,
    stamp: page.stamp,
    workspace: reports.workspace,
    route: reports.route,
    key: reports.key,
  });
  const scripts = [...document.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.equal(scripts.length, 1, 'the tab introduces no second inline script block');
  for (const src of scripts) assert.doesNotThrow(() => new Function(src));
  db.close();
});
