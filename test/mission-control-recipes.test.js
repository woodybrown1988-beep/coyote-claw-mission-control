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
const recipesPage = require('../mission-control/ui/pages/coyote/recipes.js');
const SHARED = require('../mission-control/ui/shared.js');
const {
  normalizeRecipeFamily,
  getSection: getRecipesSection,
  render: renderRecipes,
} = recipesPage;

const NOW = 1782900000000;

function makeDb(seed) {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sub_items (id TEXT PRIMARY KEY, name TEXT, supplier TEXT, pack_description TEXT, pack_cost_pence INTEGER, pack_qty REAL, unit_of_measure TEXT NOT NULL, cost_source TEXT NOT NULL DEFAULT 'manual', updated_at INTEGER NOT NULL,
      CHECK (unit_of_measure IN ('each','g','ml','portion')), CHECK (cost_source IN ('manual','portal','pdf')), CHECK (pack_cost_pence IS NULL OR pack_cost_pence >= 0), CHECK (pack_qty IS NULL OR pack_qty > 0));
    CREATE TABLE products (id TEXT PRIMARY KEY, lightspeed_sku TEXT NOT NULL UNIQUE, name TEXT, category TEXT, updated_at INTEGER NOT NULL);
    CREATE TABLE recipe_lines (product_id TEXT NOT NULL, sub_item_id TEXT NOT NULL, quantity REAL NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (product_id, sub_item_id), CHECK (quantity > 0));
    CREATE TABLE sales_by_product (business_date TEXT, sku TEXT, product_name TEXT, category_name TEXT, total_amount_pence INTEGER, quantity REAL, transaction_count INTEGER, ls_margin_pence INTEGER, ls_costs_pence INTEGER, updated_at INTEGER, PRIMARY KEY (business_date, sku));
  `);
  if (seed) seed(db);
  return db;
}
function ctxFor(db, query) { return { q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, halt: { halted: false }, query: query || {} }; }
function renderEmitted(db, query) {
  const ctx = ctxFor(db, query);
  const rendered = renderRecipes(getRecipesSection(db, ctx), ctx);
  return {
    ...rendered,
    html: SHARED.renderShell({
      active: recipesPage.key,
      title: recipesPage.title,
      sub: recipesPage.sub,
      stamp: rendered.stamp,
      body: rendered.body,
      badges: {},
      foot: [],
    }),
  };
}

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

test('import recipes: resolves product_sku via lightspeed_sku (NOT id) — real SKU attaches even when id≠sku, no mis-attach', () => {
  const db = makeDb((d) => {
    // product A: id 'prod-A', SKU 'X' (the live SKU the template emits). product B: id 'X' (a stale id
    // that collides with A's SKU as a string), SKU 'Y'. The naive id-match would attach A's recipe to B.
    d.prepare(`INSERT INTO products (id, lightspeed_sku, name, updated_at) VALUES ('prod-A','X','Hangry Bird',1)`).run();
    d.prepare(`INSERT INTO products (id, lightspeed_sku, name, updated_at) VALUES ('X','Y','Haggis Smash',1)`).run();
    d.prepare(`INSERT INTO sub_items (id, name, unit_of_measure, pack_cost_pence, pack_qty, updated_at) VALUES ('bun','bun','each',500,48,1)`).run();
  });
  const r = applyRecipeImport(db, 'recipes', 'product_sku,product_name,sub_item_id,quantity\nX,Hangry Bird,bun,1\n', NOW);
  assert.equal(r.imported, 1, 'a real SKU attaches even though its product id (prod-A) differs from the SKU');
  const line = db.prepare(`SELECT product_id FROM recipe_lines WHERE sub_item_id='bun'`).get();
  assert.equal(line.product_id, 'prod-A', 'attached to the product that OWNS the SKU (A), never the id-collision product (B)');
  // an unknown SKU still rejects
  const r2 = applyRecipeImport(db, 'recipes', 'product_sku,product_name,sub_item_id,quantity\nZZZ,x,bun,1\n', NOW);
  assert.equal(r2.rejected.length, 1); assert.match(r2.rejected[0].error, /live menu|no such product/i);
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

test('normalizeRecipeFamily repeatedly removes specified suffixes, punctuation, and groups case-consistently', () => {
  assert.equal(normalizeRecipeFamily('Mega Burger - Single'), 'Mega Burger');
  assert.equal(normalizeRecipeFamily('Mega Burger - Double - DEAL...'), 'Mega Burger');
  assert.equal(normalizeRecipeFamily('Mega Burger (included)'), 'Mega Burger');
  assert.equal(normalizeRecipeFamily('Pasta - Eat In Deal'), 'Pasta');
  assert.equal(normalizeRecipeFamily('Pasta - CC Deal'), 'Pasta');
  assert.equal(normalizeRecipeFamily('Pasta - DEAL'), 'Pasta');
  assert.equal(normalizeRecipeFamily('Plain Product!!!'), 'Plain Product');
  assert.equal(normalizeRecipeFamily(null), 'Unnamed product');
});

function seedDailyFixture(d) {
  const productInsert = d.prepare(`INSERT INTO products (id, lightspeed_sku, name, updated_at) VALUES (?,?,?,1)`);
  const salesInsert = d.prepare(`INSERT INTO sales_by_product (business_date, sku, total_amount_pence, quantity, updated_at) VALUES (?,?,?,?,1)`);
  const lineInsert = d.prepare(`INSERT INTO recipe_lines (product_id, sub_item_id, quantity, updated_at) VALUES (?,?,?,1)`);

  d.exec(`
    INSERT INTO sub_items (id, name, unit_of_measure, pack_cost_pence, pack_qty, updated_at) VALUES
      ('base','Recipe base','each',1200,8,1),
      ('garnish','Garnish','g',500,100,1),
      ('missing-cost','Missing cost','each',NULL,10,1),
      ('missing-qty','Missing quantity','each',1000,NULL,1);
  `);

  // 22 complete recipes: the first is 1 × 1200/8 + 2 × 500/100 = 160 integer pence.
  const costedNets = [
    300000, 190000,
    ...Array.from({ length: 17 }, (_, i) => 180000 - i * 10000),
    0, -100, -200,
  ];
  costedNets.forEach((net, i) => {
    const sku = `C${String(i).padStart(2, '0')}`;
    productInsert.run(sku, sku, i === 0 ? 'Arithmetic Hero' : `Costed Product ${i}`);
    lineInsert.run(sku, 'base', 1);
    if (i === 0) lineInsert.run(sku, 'garnish', 2);
    // C01 has net sales but zero quantity; C19 has quantity but a zero achieved price.
    const units = i === 0 ? 500 : i === 1 ? 0 : i === 19 ? 10 : 100;
    salesInsert.run('2026-07-20', sku, net, units);
  });

  const outstandingNames = [
    'Solo Hero - CC Deal',
    'Mega Burger - Single',
    'mega burger - Double',
    'Mega Burger (included)',
    'Pasta - Eat In Deal',
    'Pasta - DEAL',
    'Pasta - Double - DEAL...',
    ...Array.from({ length: 15 }, (_, i) => `Outstanding Family ${i}`),
  ];
  const outstandingNets = [
    200000, 90000, 85000, 80000, 70000, 60000, 50000, 40000, 39000, 38000,
    37000, 36000, 35000, 34000, 33000, 32000, 31000, 30000, 29000, 28000, 27000, 26000,
  ];
  outstandingNames.forEach((name, i) => {
    const sku = `O${String(i).padStart(2, '0')}`;
    productInsert.run(sku, sku, name);
    salesInsert.run('2026-07-20', sku, outstandingNets[i], 100);
  });
  lineInsert.run('O00', 'missing-cost', 1);
  lineInsert.run('O01', 'missing-qty', 1);

  // Outside the trailing 12-month window and therefore excluded from rankings and coverage.
  salesInsert.run('2025-07-20', 'O21', 9999999, 1);
}

test('daily emitted page: cost arithmetic, sales coverage, top 20, family roll-ups, next-20 value, and bottom CSV setup', () => {
  const db = makeDb(seedDailyFixture);
  const ctx = ctxFor(db);
  const section = getRecipesSection(db, ctx);

  assert.equal(section.recipeLineCount, 25, 'live count includes every seeded recipe line');
  assert.equal(section.salesWired, true);
  assert.equal(section.salesPresent, true);

  const hero = section.products.find((p) => p.id === 'C00');
  assert.equal(hero.costed, true);
  assert.equal(hero.unit_cost_pence, 160, '1×1200/8 + 2×500/100 = 160p');
  assert.equal(hero.achieved_price_pence, 600, '300000p ÷ 500 units = 600p');
  assert.equal(hero.gp_pence, 440, '600p achieved price − 160p cost = 440p');
  assert.ok(Math.abs(hero.cost_pct - 160 / 600) < 1e-12);
  assert.equal(section.products.find((p) => p.id === 'O00').costed, false, 'missing pack cost stays incomplete');
  assert.equal(section.products.find((p) => p.id === 'O01').costed, false, 'missing pack quantity stays incomplete');

  assert.equal(section.costedTotal, 22);
  assert.equal(section.costedTop.length, 20);
  assert.equal(section.costedTop[0].id, 'C00', 'costed results rank by 12-month net sales');
  assert.equal(section.costedTop[19].id, 'C19');
  assert.equal(section.costedRemaining, 2);

  assert.equal(section.worklist.length, 20);
  assert.equal(section.worklist[0].id, 'O00', 'individual outstanding ranking semantics are preserved');
  assert.equal(section.worklist[19].id, 'O19');
  assert.equal(section.nextOutstandingNet, 1077000, 'next 20 represent £10,770.00 net sales');

  const mega = section.workFamilies.find((f) => f.name === 'Mega Burger');
  assert.ok(mega);
  assert.equal(mega.memberCount, 3);
  assert.equal(mega.net_sales, 255000);
  assert.deepEqual(mega.members.map((p) => p.id), ['O01', 'O02', 'O03']);
  assert.equal(section.workFamilies[0].name, 'Mega Burger', 'combined family sales outrank the higher individual Solo item');
  assert.equal(section.workFamilies[1].name, 'Solo Hero');

  const expectedCostedNet = 2189700;
  const expectedAllNet = 3319700;
  assert.equal(section.coverage.costedNet, expectedCostedNet);
  assert.equal(section.coverage.totalNet, expectedAllNet);
  assert.ok(Math.abs(section.coverage.pct - expectedCostedNet / expectedAllNet) < 1e-12);

  const out = renderEmitted(db);
  assert.match(out.html, /See how much of the last 12 months’ net sales has complete recipe costing/);
  assert.match(out.body, /12-month net sales covered/);
  assert.match(out.body, /66\.0%/);
  assert.match(out.body, /£21,897\.00 costed-product net sales ÷ £33,197\.00 all-product net sales/);
  assert.match(out.body, /Coverage means the share of 12-month net sales whose products have complete recipe costs/);
  assert.match(out.body, /Next 20 outstanding products[\s\S]*£10,770\.00/);

  assert.match(out.body, /<th>product<\/th><th>unit cost<\/th><th>achieved average net price<\/th><th>GP £<\/th><th>cost %<\/th>/);
  assert.match(out.body, /Arithmetic Hero[\s\S]*£1\.60[\s\S]*£6\.00[\s\S]*£4\.40[\s\S]*26\.7%/);
  assert.match(out.body, /and 2 more, all costed\./);
  assert.doesNotMatch(out.body, /Costed Product 20|Costed Product 21/, 'only the top 20 costed products render');
  const zeroQtyRow = out.body.match(/<tr><td>Costed Product 1[\s\S]*?<\/tr>/)[0];
  assert.equal((zeroQtyRow.match(/unavailable/g) || []).length, 3, 'zero quantity makes average price, GP, and cost % unavailable');
  const zeroPriceRow = out.body.match(/<tr><td>Costed Product 19[\s\S]*?<\/tr>/)[0];
  assert.match(zeroPriceRow, /£0\.00[\s\S]*£-1\.50[\s\S]*unavailable/, 'zero achieved price is shown honestly without a cost-% division');

  assert.match(out.body, /<tbody><tr><td><b>Mega Burger<\/b><\/td><td class="mono">3<\/td><td class="mono">£2,550\.00/);
  assert.match(out.body, /<details class="rc-family"><summary>3 members<\/summary><ul>[\s\S]*O01[\s\S]*Mega Burger - Single[\s\S]*O02[\s\S]*mega burger - Double[\s\S]*O03[\s\S]*Mega Burger \(included\)/);
  assert.ok(out.body.indexOf('<b>Mega Burger</b>') < out.body.indexOf('<b>Solo Hero</b>'), 'family rows use combined-net ranking');

  const ingredientsAt = out.body.indexOf('Ingredients <span');
  const setupAt = out.body.indexOf('Recipe setup: bulk CSV import');
  assert.ok(setupAt > ingredientsAt, 'CSV setup is at the bottom, after ingredients');
  assert.match(out.body.slice(out.body.lastIndexOf('<details class="panel rc-setup">')), /^<details class="panel rc-setup"><summary[^>]*><b>Recipe setup: bulk CSV import<\/b>/);
  assert.doesNotMatch(out.body, /<details class="panel rc-setup"[^>]*\bopen\b/, 'CSV setup starts collapsed');

  assert.doesNotMatch(out.body, /Calum gate|not wired|recipe-gated|Infinity|NaN|undefined/i);
  const scripts = [...out.html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.equal(scripts.length, 1, 'the emitted page retains one inline client script');
  for (const src of scripts) assert.doesNotThrow(() => new Function(src), 'an emitted inline script does not parse');
});

test('genuine zero-recipe-lines state replaces Costed and worklist analytics with useful next steps', () => {
  const db = makeDb((d) => {
    d.exec(`
      INSERT INTO products (id, lightspeed_sku, name, updated_at) VALUES ('P1','P1','First Product',1);
      INSERT INTO sales_by_product (business_date, sku, total_amount_pence, quantity, updated_at) VALUES ('2026-07-20','P1',50000,100,1);
    `);
  });
  const section = getRecipesSection(db, ctxFor(db));
  assert.equal(section.recipeLineCount, 0);
  const out = renderEmitted(db);
  assert.match(out.body, /No product recipes have been entered yet/);
  assert.match(out.body, /Add ingredient pack costs below/);
  assert.doesNotMatch(out.body, /<div class="sec-label">Costed|rc-family-table/, 'analytics are replaced, not hardcoded on');
  assert.doesNotMatch(out.body, /Next 1 outstanding product/, 'the worklist value is also replaced in the zero-recipe state');
  assert.match(out.body, /Recipe setup: bulk CSV import/);
  assert.doesNotMatch(out.body, /Calum gate|not wired|recipe-gated|Infinity|NaN|undefined/i);
});

test('partial states: missing sales keeps cost results usable; no complete recipe keeps the family worklist visible', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sub_items (id TEXT PRIMARY KEY, name TEXT, supplier TEXT, pack_description TEXT, pack_cost_pence INTEGER, pack_qty REAL, unit_of_measure TEXT, cost_source TEXT, updated_at INTEGER);
    CREATE TABLE products (id TEXT PRIMARY KEY, lightspeed_sku TEXT, name TEXT, category TEXT, updated_at INTEGER);
    CREATE TABLE recipe_lines (product_id TEXT, sub_item_id TEXT, quantity REAL, updated_at INTEGER, PRIMARY KEY (product_id, sub_item_id));
    INSERT INTO sub_items VALUES ('ok','Costed ingredient',NULL,NULL,500,10,'each','manual',1);
    INSERT INTO sub_items VALUES ('missing','Missing cost',NULL,NULL,NULL,10,'each','manual',1);
    INSERT INTO products VALUES ('COMPLETE','COMPLETE','Complete Product',NULL,1);
    INSERT INTO products VALUES ('PARTIAL','PARTIAL','Partial Product - Single',NULL,1);
    INSERT INTO recipe_lines VALUES ('COMPLETE','ok',2,1);
    INSERT INTO recipe_lines VALUES ('PARTIAL','missing',1,1);
  `);
  const section = getRecipesSection(db, ctxFor(db));
  assert.equal(section.salesWired, false);
  assert.equal(section.coverage, null);
  assert.equal(section.costedTotal, 1);
  const out = renderEmitted(db);
  assert.match(out.body, /12-month sales are unavailable/);
  assert.match(out.body, /Complete Product[\s\S]*£1\.00[\s\S]*unavailable/);
  assert.match(out.body, /<b>Partial Product<\/b>/, 'the outstanding family remains usable without sales');

  const incompleteOnly = makeDb((d) => {
    d.exec(`
      INSERT INTO sub_items (id,name,unit_of_measure,pack_cost_pence,pack_qty,updated_at) VALUES ('x','x','each',NULL,1,1);
      INSERT INTO products (id,lightspeed_sku,name,updated_at) VALUES ('P','P','Needs Cost - DEAL',1);
      INSERT INTO recipe_lines (product_id,sub_item_id,quantity,updated_at) VALUES ('P','x',1,1);
      INSERT INTO sales_by_product (business_date,sku,total_amount_pence,quantity,updated_at) VALUES ('2026-07-20','P',10000,10,1);
    `);
  });
  const incompleteOut = renderEmitted(incompleteOnly);
  assert.match(incompleteOut.body, /No products have complete recipe costs yet/);
  assert.match(incompleteOut.body, /<b>Needs Cost<\/b>/, 'an empty Costed result never hides outstanding work');
  assert.doesNotMatch(incompleteOut.body, /Infinity|NaN|undefined/);
  db.close();
});

test('search still reaches a raw SKU without changing the ranked next-20 product set', () => {
  const db = makeDb(seedDailyFixture);
  const base = getRecipesSection(db, ctxFor(db));
  const searched = getRecipesSection(db, ctxFor(db, { find: 'O21' }));
  assert.deepEqual(searched.worklist.map((p) => p.id), base.worklist.map((p) => p.id));
  assert.equal(searched.matches.total, 1);
  assert.equal(searched.matches.shown[0].id, 'O21');
  const out = renderEmitted(db, { find: 'O21' });
  assert.match(out.body, /1 match for/);
  assert.match(out.body, /details class="rc-prod" open/);
  assert.match(out.body, /O21/);
});
