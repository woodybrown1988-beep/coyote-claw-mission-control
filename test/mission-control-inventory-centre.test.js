'use strict';
// Inventory Centre — selective graduation of counts + waste from the build-ahead scaffold.
// Pinned here:
//   (a) EMPTY DATABASE: all six executive KPIs remain honest dashes and the complete eight-tab
//       render remains byte-identical to the approved scaffold (including every gate panel).
//   (b) COUNTS: latest ten ordering/metadata, latest-closed adjustment ranking, signed quantities
//       and pounds, and the active-setting omission total with a five-name display cap.
//   (c) WASTE: non-voided last-28-day reason + ingredient grains, positive cost totals, and a
//       voided event excluded from the model, KPI, readiness, and HTML.
//   (d) EXECUTIVE: stock/accuracy/gap use the latest closed FULL count; usage uses the seven days
//       ending at the latest closed count's settlement boundary and excludes later movements.
//   (e) ISOLATION: forecast, kitchen, FOH and purchasing remain byte-identical when inventory data
//       is seeded; every still-unsourced panel keeps its original gate.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const page = require('../mission-control/ui/pages/coyote/inventory.js');
const S = require('../mission-control/ui/shared.js');

const NOW = Date.parse('2026-07-22T12:00:00Z');
const TABS = ['executive', 'forecast', 'counts', 'kitchen', 'foh', 'purchasing', 'waste', 'plan'];
const ts = (value) => Date.parse(value);
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// These are the pre-change empty-database bodies. A changed hash means markup outside the newly
// sourced branches moved, or a designed empty-state stopped being byte-identical.
const EMPTY_GOLDENS = {
  executive: 'e1f8f4d20273775a77bf10ab488606a8a6efd6bb5bccbfb720de49f55b0e9be6',
  forecast: 'aee687e585f1e60ba06d98755ea646fb9ed70253657da46355f6302cfc5c8109',
  counts: '0a10f587b72a80808db1b18b597eb3b915a9a0a3687329039a84292644bb3cea',
  kitchen: 'a7bb157bcf6f3cdfd026dd72eaf4e2ced892ca6a8fbdced1aaf339ca8d687834',
  foh: '0c68fc2c8d0d9b13adf81df32a2be2b7eb8f24fbb3e6f78fe1bf9f68b2100930',
  purchasing: '56e207f96d8e359d20e54011bcb022c3c297daeaf8ec216c802325572b1dd7f5',
  waste: 'a8ace04a91986d1090dda55c63b0a81f1393f80affa9524aecd51b5de30bcd58',
  plan: '9f9f114ca96e5bdae070d3251b04654fb8c15e5bd3915342b34d8c6506af0c5f',
};

const DDL = `
CREATE TABLE recipe_lines (product_id TEXT, sub_item_id TEXT, quantity REAL);
CREATE TABLE products (id TEXT PRIMARY KEY, lightspeed_sku TEXT, name TEXT);
CREATE TABLE sub_items (id TEXT PRIMARY KEY, name TEXT, pack_cost_pence INTEGER, pack_qty REAL, unit_of_measure TEXT);
CREATE TABLE inventory_counts (id TEXT PRIMARY KEY, count_type TEXT, status TEXT, started_at INTEGER, closed_at INTEGER, settled_through INTEGER, counted_by TEXT);
CREATE TABLE inventory_count_settings (sub_item_id TEXT PRIMARY KEY, active INTEGER);
CREATE TABLE inventory_waste_events (id TEXT PRIMARY KEY, reason TEXT, status TEXT, occurred_at INTEGER);
CREATE TABLE inventory_movements (id TEXT PRIMARY KEY, sub_item_id TEXT, movement_type TEXT, quantity REAL, unit_cost_pence INTEGER, balance_after REAL, occurred_at INTEGER, count_id TEXT, waste_event_id TEXT);
`;

function makeDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(DDL);
  return db;
}
function ctxFor(db, query, seenSql) {
  return {
    q: (sql, params) => {
      if (seenSql) seenSql.push(String(sql));
      return DATA.safeSelect(db, sql, params);
    },
    now: NOW,
    query: query || {},
  };
}
const section = (db, query, seenSql) => page.getSection(db, ctxFor(db, query, seenSql));
const render = (db, query) => {
  const ctx = ctxFor(db, query);
  return page.render(page.getSection(db, ctx), ctx).body;
};

function seedInventory(db) {
  db.exec(`
    INSERT INTO sub_items VALUES
      ('beef','Beef patties',250,1,'each'),
      ('buns','Brioche buns',50,1,'each'),
      ('oil','Frying oil',200,1,'L'),
      ('cheese','American cheese',100,1,'slice'),
      ('chicken','Chicken fillets',1200,1,'kg'),
      ('ketchup','Ketchup',150,1,'L'),
      ('pickles','Pickles',300,1,'kg'),
      ('salt','Salt',80,1,'kg'),
      ('slaw','Slaw',250,1,'kg'),
      ('tomato','Tomato',400,1,'kg'),
      ('mustard','Mustard',100,1,'L');
    INSERT INTO inventory_count_settings VALUES
      ('beef',1),('buns',1),('oil',1),('cheese',1),('chicken',1),('ketchup',1),
      ('pickles',1),('salt',1),('slaw',1),('tomato',1),('mustard',0);
  `);
  const count = db.prepare(`INSERT INTO inventory_counts VALUES (?,?,?,?,?,?,?)`);
  count.run('C-OLD', 'full', 'closed', ts('2026-07-12T10:00:00Z'), ts('2026-07-12T12:00:00Z'), ts('2026-07-12T11:59:00Z'), 'Ada');
  count.run('C-LATEST', 'flash', 'closed', ts('2026-07-20T19:00:00Z'), ts('2026-07-20T22:00:00Z'), ts('2026-07-20T21:00:00Z'), 'Ben');

  const movement = db.prepare(`INSERT INTO inventory_movements VALUES (?,?,?,?,?,?,?,?,?)`);
  const move = (...values) => movement.run(...values);
  // The older FULL count drives stock KPIs: stock £160; theoretical £165; abs gap £15;
  // signed gap -£5; accuracy = 1 - 15/165 = 90.9%.
  move('m01', 'beef', 'count_adjustment', -4, 250, 40, ts('2026-07-12T12:00:00Z'), 'C-OLD', null);
  move('m02', 'buns', 'count_adjustment', 10, 50, 100, ts('2026-07-12T12:00:00Z'), 'C-OLD', null);
  move('m03', 'oil', 'count_adjustment', 0, 200, 5, ts('2026-07-12T12:00:00Z'), 'C-OLD', null);
  // The newer FLASH count drives current discrepancy/missing panels and the usage boundary.
  move('m11', 'beef', 'count_adjustment', -5, 250, 35, ts('2026-07-20T22:00:00Z'), 'C-LATEST', null);
  move('m12', 'oil', 'count_adjustment', 4, 200, 6, ts('2026-07-20T22:00:00Z'), 'C-LATEST', null);
  move('m13', 'buns', 'count_adjustment', -3, 50, 95, ts('2026-07-20T22:00:00Z'), 'C-LATEST', null);

  // Last seven SETTLED days total £34. The £250 later movement and lower-boundary movement are
  // deliberate decoys: neither may enter the holding-days denominator.
  move('u1', 'beef', 'usage', -8, 250, null, ts('2026-07-19T10:00:00Z'), null, null);
  move('u2', 'buns', 'usage', -20, 50, null, ts('2026-07-18T10:00:00Z'), null, null);
  move('u3', 'oil', 'usage', -2, 200, null, ts('2026-07-14T10:00:00Z'), null, null);
  move('u4', 'beef', 'usage', -100, 250, null, ts('2026-07-21T10:00:00Z'), null, null);
  move('u5', 'beef', 'usage', -100, 250, null, ts('2026-07-13T21:00:00Z'), null, null);

  const wasteEvent = db.prepare(`INSERT INTO inventory_waste_events VALUES (?,?,?,?)`);
  wasteEvent.run('W1', 'Spoilage', 'posted', ts('2026-07-21T09:00:00Z'));
  wasteEvent.run('W2', 'Prep error', 'posted', ts('2026-07-10T09:00:00Z'));
  wasteEvent.run('W3', 'Sent then voided', 'voided', ts('2026-07-21T10:00:00Z'));
  // W1 £7, W2 £3.50; W3 £100 is excluded everywhere.
  move('w11', 'beef', 'waste', -2, 250, null, ts('2026-07-21T09:00:00Z'), null, 'W1');
  move('w12', 'buns', 'waste', -4, 50, null, ts('2026-07-21T09:00:00Z'), null, 'W1');
  move('w21', 'beef', 'waste', -1, 250, null, ts('2026-07-10T09:00:00Z'), null, 'W2');
  move('w22', 'oil', 'waste', -0.5, 200, null, ts('2026-07-10T09:00:00Z'), null, 'W2');
  move('w31', 'cheese', 'waste', -100, 100, null, ts('2026-07-21T10:00:00Z'), null, 'W3');
}

test('shell: 8 tabs, executive default, ?tab= switches, unknown falls back, all inside .rcc', () => {
  const db = makeDb();
  const body = render(db);
  for (const tab of TABS) assert.ok(body.includes(`href="/coyote/inventory?tab=${tab}"`), `tab link ${tab}`);
  assert.equal((body.match(/class="r-tab[ "]/g) || []).length, 8, '8 subtab links');
  assert.match(body, /class="r-tab active" href="\/coyote\/inventory\?tab=executive"/, 'executive default');
  assert.match(render(db, { tab: 'plan' }), /class="r-tab active" href="\/coyote\/inventory\?tab=plan"/, '?tab switches');
  assert.match(render(db, { tab: 'garbage' }), /class="r-tab active" href="\/coyote\/inventory\?tab=executive"/, 'unknown → executive');
  assert.equal(body.indexOf('<div class="rcc">'), 0, 'the whole page is under .rcc');
});

test('registry + nav: inventory in Reports after operations; server requires the page; contract exports', () => {
  const coyote = S.WORKSPACES.find((w) => w.key === 'coyote');
  const reports = coyote.groups.find((g) => g.group === 'Reports');
  assert.deepEqual(reports.items.map((i) => i.key), ['revenue', 'labour', 'costs', 'reservations', 'operations', 'inventory', 'customer-growth', 'kitchen-safety', 'report-library', 'files']);
  assert.equal(reports.items.find((i) => i.key === 'inventory').route, '/coyote/inventory');
  const srv = require('node:fs').readFileSync(require('node:path').join(__dirname, '../mission-control/server.js'), 'utf8');
  assert.match(srv, /require\('\.\/ui\/pages\/coyote\/inventory\.js'\)/);
  assert.equal(page.key, 'inventory');
  assert.equal(page.route, '/coyote/inventory');
  assert.equal(page.title, 'Inventory');
  assert.equal(typeof page.getSection, 'function');
  assert.equal(typeof page.render, 'function');
});

test('empty database: every KPI is — and all sourced empty states plus untouched panels are byte-identical', () => {
  const db = makeDb();
  for (const tab of TABS) {
    const body = render(db, { tab });
    assert.equal(sha256(body), EMPTY_GOLDENS[tab], `${tab}: approved empty-state golden`);
    assert.ok(!body.includes('NaN') && !body.includes('undefined'), `${tab}: no NaN/undefined`);
  }
  const executive = render(db);
  assert.deepEqual(executive.match(/r-kpi-value">([^<]*)</g), Array(6).fill('r-kpi-value">—<'));
  assert.match(executive, /13-week inventory control trend[\s\S]*a weekly stock count — the trend needs a count history to plot/);
  const counts = render(db, { tab: 'counts' });
  assert.match(counts, /Top discrepancies[\s\S]*a completed stock count — no count, no discrepancy/);
  assert.match(counts, /Count quality gate[\s\S]*the counting cadence — the gate grades counts that do not exist yet/);
  const waste = render(db, { tab: 'waste' });
  assert.match(waste, /Waste by reason[\s\S]*waste logging at source with a reason — the single feed for this panel/);
  assert.match(waste, /Top wasted items[\s\S]*waste events \+ recipe costs to value them/);
});

test('getSection uses SELECT-only ctx.q queries and returns empty/fallback values without source tables', () => {
  const db = makeDb();
  const seen = [];
  const model = section(db, {}, seen);
  assert.ok(seen.length >= 10, 'all inventory/readiness queries ran');
  for (const sql of seen) assert.match(sql.trim(), /^SELECT\b/i, sql);
  assert.deepEqual(model.counts, []);
  assert.deepEqual(model.adjustments, []);
  assert.equal(model.countQuality, null);
  assert.deepEqual(model.waste, { byReason: [], byIngredient: [] });
  assert.deepEqual(model.executive, { full: null, usage: null, waste: null });
  assert.deepEqual(model.readiness.counts, { ready: false, count: 0, detail: 'no counts on record — the counting process has not started' });
  assert.deepEqual(model.readiness.waste, { ready: false, count: 0, detail: 'no waste events logged' });
});

test('fixture: latest counts and latest-closed discrepancies are exact, signed and absolute-value ranked', () => {
  const db = makeDb();
  seedInventory(db);
  const model = section(db);
  assert.deepEqual(model.counts, [
    { id: 'C-LATEST', type: 'flash', status: 'closed', startedAt: ts('2026-07-20T19:00:00Z'), closedAt: ts('2026-07-20T22:00:00Z'), settledThrough: ts('2026-07-20T21:00:00Z'), countedBy: 'Ben', adjustmentCount: 3, costedCount: 3, stockValuePence: 14700, discrepancyPence: -600 },
    { id: 'C-OLD', type: 'full', status: 'closed', startedAt: ts('2026-07-12T10:00:00Z'), closedAt: ts('2026-07-12T12:00:00Z'), settledThrough: ts('2026-07-12T11:59:00Z'), countedBy: 'Ada', adjustmentCount: 3, costedCount: 3, stockValuePence: 16000, discrepancyPence: -500 },
  ]);
  assert.deepEqual(model.adjustments.map((a) => [a.ingredient, a.unit, a.theoreticalQuantity, a.countedQuantity, a.discrepancyQuantity, a.discrepancyPence]), [
    ['Beef patties', 'each', 40, 35, -5, -1250],
    ['Frying oil', 'L', 2, 6, 4, 800],
    ['Brioche buns', 'each', 98, 95, -3, -150],
  ]);
  const body = render(db, { tab: 'counts' });
  assert.ok(body.indexOf('Beef patties') < body.indexOf('Frying oil') && body.indexOf('Frying oil') < body.indexOf('Brioche buns'), 'absolute-value rank renders');
  for (const literal of ['−5 each', '−£12.50', '+4 L', '+£8.00', '−3 each', '−£1.50']) assert.ok(body.includes(literal), literal);
  assert.doesNotMatch(body, /Top discrepancies[\s\S]{0,500}a completed stock count — no count, no discrepancy/);
});

test('fixture: active ingredients missing from the latest count have an exact total and capped catalogue-name list', () => {
  const db = makeDb();
  seedInventory(db);
  const model = section(db);
  assert.deepEqual(model.countQuality, {
    countId: 'C-LATEST',
    missingCount: 7,
    missingNames: ['American cheese', 'Chicken fillets', 'Ketchup', 'Pickles', 'Salt'],
  });
  const body = render(db, { tab: 'counts' });
  assert.match(body, /Active ingredients absent: 7/);
  assert.match(body, /American cheese · Chicken fillets · Ketchup · Pickles · Salt · \+2 more/);
  assert.doesNotMatch(body, /\bSlaw\b|\bTomato\b|\bMustard\b/, 'five-name cap and inactive setting both hold');
});

test('fixture: waste reason and ingredient totals are exact positive costs; voided event is absent everywhere', () => {
  const db = makeDb();
  seedInventory(db);
  const model = section(db);
  assert.deepEqual(model.waste.byReason.map((r) => [r.reason, r.wastePence, r.eventCount]), [
    ['Spoilage', 700, 1],
    ['Prep error', 350, 1],
  ]);
  assert.deepEqual(model.waste.byIngredient.map((r) => [r.ingredient, r.unit, r.wasteQuantity, r.wastePence, r.eventCount]), [
    ['Beef patties', 'each', 3, 750, 2],
    ['Brioche buns', 'each', 4, 200, 1],
    ['Frying oil', 'L', 0.5, 100, 1],
  ]);
  const body = render(db, { tab: 'waste' });
  for (const literal of ['Spoilage', '£7.00', 'Prep error', '£3.50', 'Beef patties', '3 each', '£7.50', '0.5 L', '£1.00']) assert.ok(body.includes(literal), literal);
  const allInventoryOutput = TABS.map((tab) => render(db, { tab })).join('');
  assert.ok(!JSON.stringify(model.waste).includes('Sent then voided'));
  assert.doesNotMatch(allInventoryOutput, /Sent then voided|£100\.00|American cheese[\s\S]{0,80}100/);
});

test('fixture: executive KPIs use the full count, settled usage boundary and non-voided waste exactly', () => {
  const db = makeDb();
  seedInventory(db);
  const model = section(db);
  assert.deepEqual(model.executive, {
    full: { countId: 'C-OLD', closedAt: ts('2026-07-12T12:00:00Z'), settledThrough: ts('2026-07-12T11:59:00Z'), movementCount: 3, costedCount: 3, stockValuePence: 16000, theoreticalValuePence: 16500, absoluteDiscrepancyPence: 1500, discrepancyPence: -500 },
    usage: { countId: 'C-LATEST', settledThrough: ts('2026-07-20T21:00:00Z'), movementCount: 3, costedCount: 3, usagePence: 3400 },
    waste: { eventCount: 2, movementCount: 4, costedCount: 4, wastePence: 1050 },
  });
  const body = render(db);
  assert.deepEqual(body.match(/r-kpi-value">([^<]*)</g), [
    'r-kpi-value">£160.00<',
    'r-kpi-value">32.9 days<',
    'r-kpi-value">90.9%<',
    'r-kpi-value">−£5.00<',
    'r-kpi-value">£10.50<',
    'r-kpi-value">—<',
  ]);
  assert.match(body, /latest full count C-OLD · 10d ago/);
  assert.match(body, /£34\.00 usage · last 7 settled days/);
  assert.match(body, /2 non-voided events · last 28 days/);
  assert.doesNotMatch(body, /£250\.00|£25,000\.00/, 'later and lower-boundary usage decoys excluded');
});

test('fixture: counts and non-voided waste readiness are live while untouched dimensions stay gated', () => {
  const db = makeDb();
  seedInventory(db);
  const model = section(db);
  assert.deepEqual(model.readiness.counts, { ready: true, count: 2, detail: '2 counts on record' });
  assert.deepEqual(model.readiness.waste, { ready: true, count: 2, detail: '2 waste events logged' });
  assert.equal(model.readiness.scope.ready, false);
  assert.equal(model.readiness.items.ready, false);
  assert.equal(model.readiness.pos.ready, false);
  const plan = render(db, { tab: 'plan' });
  assert.match(plan, /2 of 6 readiness dimensions started/);
  assert.ok((plan.match(/>ready</g) || []).length >= 2);
});

test('golden isolation: all unaffected tabs and still-unsourced panels are byte-identical under the fixture', () => {
  const db = makeDb();
  seedInventory(db);
  for (const tab of ['forecast', 'kitchen', 'foh', 'purchasing']) {
    assert.equal(sha256(render(db, { tab })), EMPTY_GOLDENS[tab], `${tab}: unaffected page golden`);
  }
  const counts = render(db, { tab: 'counts' });
  assert.match(counts, /Movement reconciliation[\s\S]*the inventory movements API \(scope-gated\) OR counts \+ waste \+ recipe usage/);
  assert.match(counts, /Variance decision logic[\s\S]*theoretical usage \(recipes\) to compare actual counts against/);
  const waste = render(db, { tab: 'waste' });
  assert.match(waste, /Required waste fields/);
  assert.match(waste, /Batch yield performance[\s\S]*batch recipes with expected yields \+ posted production/);
  assert.match(waste, /Production controls[\s\S]*posting production batches as they are made/);
});

test('gate classes and adoption plan remain complete', () => {
  const db = makeDb();
  const all = TABS.map((tab) => render(db, { tab })).join('');
  for (const literal of ['scope + process', 'recipe-gated', 'invoice-line gated', 'process-gated']) assert.ok(all.includes(literal), literal);
  assert.ok((all.match(/Unlock:/g) || []).length >= 15, 'every designed gate names its adoption step');
  const plan = render(db, { tab: 'plan' });
  for (const week of ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6']) assert.ok(plan.includes(week));
  assert.match(plan, /surveillance boundary/);
});
