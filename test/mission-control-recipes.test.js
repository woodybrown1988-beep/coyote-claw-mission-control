'use strict';

// BOM editor (Recipes & Costs) — the SECOND narrow safe-write path. Same discipline as review-action:
// a CLOSED op allowlist, a pure applyRecipeAction(db, body, now), parameterised SQL, no phantom writes.
// Plus the CSV bulk import (same validation, atomic), the pre-filled template, and the SELECT-only page.

const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const {
  applyRecipeAction, applyRecipeImport, RECIPE_ACTION_OPS, buildRecipeTemplate, parseCsv,
} = require('../mission-control/server.js');
const DATA = require('../mission-control/ui/data.js');
const recipesPage = require('../mission-control/ui/pages/recipes.js');

const NOW = 1782900000000;

function makeDb(seed) {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sub_items (id TEXT PRIMARY KEY, name TEXT, supplier TEXT, pack_description TEXT, pack_cost_pence INTEGER, pack_qty REAL, unit_of_measure TEXT NOT NULL, cost_source TEXT NOT NULL DEFAULT 'manual', updated_at INTEGER NOT NULL,
      CHECK (unit_of_measure IN ('each','g','ml','portion')), CHECK (cost_source IN ('manual','portal','pdf')), CHECK (pack_cost_pence IS NULL OR pack_cost_pence >= 0), CHECK (pack_qty IS NULL OR pack_qty > 0));
    CREATE TABLE products (id TEXT PRIMARY KEY, lightspeed_sku TEXT NOT NULL UNIQUE, name TEXT, category TEXT, updated_at INTEGER NOT NULL);
    CREATE TABLE recipe_lines (product_id TEXT NOT NULL, sub_item_id TEXT NOT NULL, quantity REAL NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (product_id, sub_item_id), CHECK (quantity > 0));
    CREATE TABLE sales_line_items (identifier TEXT PRIMARY KEY, sku TEXT, pretax_pence INTEGER, quantity REAL, line_type TEXT);
  `);
  if (seed) seed(db);
  return db;
}
function ctxFor(db) { return { q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, halt: { halted: false } }; }

// ===================================================================================================
// applyRecipeAction — the closed allowlist + validation (mutation-relevant)
// ===================================================================================================
test('allowlist is closed: an unknown/dangerous op is rejected (400), no write', () => {
  const db = makeDb();
  for (const op of ['drop_table', 'delete_product', 'run', '', undefined, 'UPSERT_SUB_ITEM']) {
    const r = applyRecipeAction(db, { op }, NOW);
    assert.equal(r.ok, false); assert.equal(r.status, 400); assert.match(r.error, /unknown op/);
  }
  assert.deepEqual([...RECIPE_ACTION_OPS].sort(), ['delete_recipe_line', 'set_recipe_line', 'upsert_sub_item']);
});

test('upsert_sub_item: stores EXACT inputs; enforces the four units + pence-integer + positive qty', () => {
  const db = makeDb();
  const ok = applyRecipeAction(db, { op: 'upsert_sub_item', id: 'bun', name: 'Brioche bun', supplier: 'ACME', pack_description: 'box of 48', pack_cost_pence: 500, pack_qty: 48, unit_of_measure: 'each' }, NOW);
  assert.equal(ok.ok, true);
  const row = db.prepare(`SELECT * FROM sub_items WHERE id='bun'`).get();
  assert.equal(row.pack_cost_pence, 500); assert.equal(row.pack_qty, 48); assert.equal(row.cost_source, 'manual');
  // no stored unit cost — computed downstream
  assert.ok(!('unit_cost_pence' in row));
  // bad unit → rejected
  assert.match(applyRecipeAction(db, { op: 'upsert_sub_item', id: 'x', name: 'n', unit_of_measure: 'kg' }, NOW).error, /each\|g\|ml\|portion/);
  // non-integer pence (a float) → rejected (money is integer pence)
  assert.match(applyRecipeAction(db, { op: 'upsert_sub_item', id: 'x', name: 'n', unit_of_measure: 'each', pack_cost_pence: 10.5 }, NOW).error, /non-negative integer/);
  // pack_qty 0 → rejected (never divide-by-zero)
  assert.match(applyRecipeAction(db, { op: 'upsert_sub_item', id: 'x', name: 'n', unit_of_measure: 'each', pack_qty: 0 }, NOW).error, /positive number/);
  // missing id/name → rejected
  assert.equal(applyRecipeAction(db, { op: 'upsert_sub_item', name: 'n', unit_of_measure: 'each' }, NOW).ok, false);
});

test('upsert_sub_item is an UPSERT (re-costing an ingredient updates in place, keeps one row)', () => {
  const db = makeDb();
  applyRecipeAction(db, { op: 'upsert_sub_item', id: 'beef', name: 'Beef patty', pack_cost_pence: 2000, pack_qty: 10, unit_of_measure: 'each' }, NOW);
  applyRecipeAction(db, { op: 'upsert_sub_item', id: 'beef', name: 'Beef patty', pack_cost_pence: 2160, pack_qty: 10, unit_of_measure: 'each', cost_source: 'pdf' }, NOW + 1); // +8% re-cost
  const rows = db.prepare(`SELECT pack_cost_pence, cost_source FROM sub_items WHERE id='beef'`).all();
  assert.equal(rows.length, 1); assert.equal(rows[0].pack_cost_pence, 2160); assert.equal(rows[0].cost_source, 'pdf');
});

test('set_recipe_line: attaches ONLY to a real product + real ingredient (no phantom rows); upsert on qty', () => {
  const db = makeDb((d) => {
    d.prepare(`INSERT INTO products (id, lightspeed_sku, name, updated_at) VALUES ('CHZ','CHZ','Cheeseburger',1)`).run();
    d.prepare(`INSERT INTO sub_items (id, name, unit_of_measure, pack_cost_pence, pack_qty, updated_at) VALUES ('bun','bun','each',500,48,1)`).run();
  });
  // unknown product → 409, no fabrication
  assert.match(applyRecipeAction(db, { op: 'set_recipe_line', product_id: 'GHOST', sub_item_id: 'bun', quantity: 1 }, NOW).error, /no such product/i);
  // unknown ingredient → 409
  assert.match(applyRecipeAction(db, { op: 'set_recipe_line', product_id: 'CHZ', sub_item_id: 'ghost', quantity: 1 }, NOW).error, /no such sub_item/i);
  // valid → written; a second call upserts the quantity (0.5 portion allowed)
  assert.equal(applyRecipeAction(db, { op: 'set_recipe_line', product_id: 'CHZ', sub_item_id: 'bun', quantity: 1 }, NOW).ok, true);
  assert.equal(applyRecipeAction(db, { op: 'set_recipe_line', product_id: 'CHZ', sub_item_id: 'bun', quantity: 2 }, NOW).ok, true);
  const rows = db.prepare(`SELECT quantity FROM recipe_lines WHERE product_id='CHZ' AND sub_item_id='bun'`).all();
  assert.equal(rows.length, 1); assert.equal(rows[0].quantity, 2);
  // quantity must be positive
  assert.equal(applyRecipeAction(db, { op: 'set_recipe_line', product_id: 'CHZ', sub_item_id: 'bun', quantity: 0 }, NOW).ok, false);
});

test('delete_recipe_line: removes the line; 409 when absent', () => {
  const db = makeDb((d) => {
    d.prepare(`INSERT INTO products (id, lightspeed_sku, updated_at) VALUES ('CHZ','CHZ',1)`).run();
    d.prepare(`INSERT INTO sub_items (id, name, unit_of_measure, updated_at) VALUES ('bun','bun','each',1)`).run();
    d.prepare(`INSERT INTO recipe_lines (product_id, sub_item_id, quantity, updated_at) VALUES ('CHZ','bun',1,1)`).run();
  });
  assert.equal(applyRecipeAction(db, { op: 'delete_recipe_line', product_id: 'CHZ', sub_item_id: 'bun' }, NOW).ok, true);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM recipe_lines`).get().c, 0);
  assert.equal(applyRecipeAction(db, { op: 'delete_recipe_line', product_id: 'CHZ', sub_item_id: 'bun' }, NOW).status, 409);
});

test('parameterised: a malicious id is stored/compared as a literal, never executed', () => {
  const db = makeDb();
  const evil = "x'); DROP TABLE sub_items;--";
  assert.equal(applyRecipeAction(db, { op: 'upsert_sub_item', id: evil, name: 'n', unit_of_measure: 'each' }, NOW).ok, true);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM sqlite_master WHERE name='sub_items'`).get().c, 1, 'table intact — injection inert');
  assert.equal(db.prepare(`SELECT name FROM sub_items WHERE id=?`).get(evil).name, 'n');
});

// ===================================================================================================
// CSV bulk import — same validation, atomic, per-row reject summary, £→pence
// ===================================================================================================
test('import sub_items: £ pack cost → integer pence; a bad row is REPORTED, others still import (atomic)', () => {
  const db = makeDb();
  const csv = [
    'id,name,supplier,pack_description,pack_cost,pack_qty,unit_of_measure',
    'bun,Brioche bun,ACME,box of 48,5.00,48,each',       // £5.00 → 500p
    'sauce,Burger sauce,ACME,1L tub,12.60,100,portion',   // £12.60 → 1260p
    'bad,No unit,ACME,x,3.00,10,kilograms',               // illegal unit → rejected
  ].join('\n');
  const r = applyRecipeImport(db, 'sub_items', csv, NOW);
  assert.equal(r.ok, true); assert.equal(r.imported, 2); assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0].row, 4);
  assert.equal(db.prepare(`SELECT pack_cost_pence FROM sub_items WHERE id='bun'`).get().pack_cost_pence, 500);
  assert.equal(db.prepare(`SELECT pack_cost_pence FROM sub_items WHERE id='sauce'`).get().pack_cost_pence, 1260, '£12.60 → 1260p exactly (epsilon-safe)');
});

test('import recipes: attaches to REAL products only; an unknown SKU is REJECTED, never a phantom product', () => {
  const db = makeDb((d) => {
    d.prepare(`INSERT INTO products (id, lightspeed_sku, name, updated_at) VALUES ('CHZ','CHZ','Cheeseburger',1)`).run();
    d.prepare(`INSERT INTO sub_items (id, name, unit_of_measure, pack_cost_pence, pack_qty, updated_at) VALUES ('bun','bun','each',500,48,1)`).run();
  });
  const csv = [
    'product_sku,product_name,sub_item_id,quantity',
    'CHZ,Cheeseburger,bun,1',        // real product + real ingredient → ok
    'GHOST,Not real,bun,1',          // SKU not in live menu → rejected
  ].join('\n');
  const r = applyRecipeImport(db, 'recipes', csv, NOW);
  assert.equal(r.imported, 1); assert.equal(r.rejected.length, 1);
  assert.match(r.rejected[0].error, /no such product|live menu/i);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM products`).get().c, 1, 'no phantom product created by the import');
});

test('parseCsv: quoted fields, embedded commas + escaped quotes', () => {
  const rows = parseCsv('a,b\n"x,y","he said ""hi"""\n');
  assert.deepEqual(rows, [['a', 'b'], ['x,y', 'he said "hi"']]);
});

// ===================================================================================================
// template + page render (SELECT-only, no-fabrication)
// ===================================================================================================
test('buildRecipeTemplate: pre-filled with the live products; header-only note when none', () => {
  const empty = buildRecipeTemplate(makeDb());
  assert.match(empty, /^product_sku,product_name,sub_item_id,quantity/);
  assert.match(empty, /no products yet/i);
  const db = makeDb((d) => d.prepare(`INSERT INTO products (id, lightspeed_sku, name, updated_at) VALUES ('CHZ','CHZ','Cheeseburger',1)`).run());
  const t = buildRecipeTemplate(db);
  assert.match(t, /CHZ,Cheeseburger,,/, 'a row per real product, sku pre-filled, ingredient+qty blank');
});

test('page: coverage weights by SALES + a partial-cost product is a GAP, never a fabricated cost', () => {
  const db = makeDb((d) => {
    // two products; CHZ fully costed, FRIES has a recipe line whose ingredient has NO pack cost (uncosted)
    d.prepare(`INSERT INTO products (id, lightspeed_sku, name, updated_at) VALUES ('CHZ','CHZ','Cheeseburger',1),('FRIES','FRIES','Fries',1)`).run();
    d.prepare(`INSERT INTO sub_items (id, name, unit_of_measure, pack_cost_pence, pack_qty, updated_at) VALUES ('bun','bun','each',500,48,1),('spud','potato','g',NULL,NULL,1)`).run();
    d.prepare(`INSERT INTO recipe_lines (product_id, sub_item_id, quantity, updated_at) VALUES ('CHZ','bun',1,1),('FRIES','spud',200,1)`).run();
    // sales: CHZ sells more
    d.prepare(`INSERT INTO sales_line_items (identifier, sku, pretax_pence, quantity, line_type) VALUES ('l1','CHZ',80000,100,'SALE'),('l2','FRIES',20000,50,'SALE')`).run();
  });
  const ctx = ctxFor(db);
  const section = recipesPage.getSection(db, ctx);
  assert.equal(section.salesWired, true);
  const chz = section.products.find((p) => p.id === 'CHZ');
  const fries = section.products.find((p) => p.id === 'FRIES');
  assert.equal(chz.costed, true, 'CHZ fully costed');
  assert.equal(fries.costed, false, 'FRIES partial (uncosted ingredient) → NOT costed, no fabricated number');
  // worklist sorted by sales (CHZ first)
  assert.equal(section.products[0].id, 'CHZ');
  // coverage = costed net / total net = 80000 / 100000 = 0.8
  assert.ok(Math.abs(section.coverage.pct - 0.8) < 1e-9, 'coverage weights by what actually sells');
  const out = recipesPage.render(section, ctx);
  assert.match(out.body, /Net sales costed/);
  assert.match(out.body, /Cheeseburger/);
  assert.doesNotMatch(out.body, /NaN|undefined/);
});

test('page: renders gracefully with NO sales table (products not seeded yet) — never throws, never fabricates', () => {
  // a DB WITHOUT sales_line_items (pre-Slice-1)
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sub_items (id TEXT PRIMARY KEY, name TEXT, pack_cost_pence INTEGER, pack_qty REAL, unit_of_measure TEXT, cost_source TEXT, updated_at INTEGER);
           CREATE TABLE products (id TEXT PRIMARY KEY, lightspeed_sku TEXT, name TEXT, category TEXT, updated_at INTEGER);
           CREATE TABLE recipe_lines (product_id TEXT, sub_item_id TEXT, quantity REAL, updated_at INTEGER, PRIMARY KEY (product_id, sub_item_id));`);
  const ctx = ctxFor(db);
  const section = recipesPage.getSection(db, ctx);
  assert.equal(section.salesWired, false, 'no sales table → not wired, handled');
  assert.equal(section.coverage, null, 'no coverage % fabricated without sales');
  const out = recipesPage.render(section, ctx);
  assert.ok(out.body.length > 50);
  assert.match(out.body, /No products yet|seeds from the live Lightspeed/i, 'honest empty-products state');
  assert.match(out.stamp, /products seed when sales flow/i, 'stamp is honest about the pending seed');
  assert.doesNotMatch(out.body, /NaN|undefined|£0\.00/, 'no fabricated numbers before data');
  db.close();
});
