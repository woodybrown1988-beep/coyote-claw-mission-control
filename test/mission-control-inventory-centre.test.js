'use strict';
// Inventory Centre — the BUILD-AHEAD-AS-A-TARGET scaffold (operator ruling 2026-07-22 after the
// Stage-1 probe returned LIVE-NOW = 0). The module's defining invariant: NO panel can ever render a
// physical-stock number, because there is no live source — every panel is a designed empty-state
// that names its gate class + adoption step. Pinned here:
//   (a) SHELL + REGISTRY: 8 tabs, executive default, ?tab= switches, unknown falls back, all under
//       .rcc; nav Reports order …costs, inventory; server requires the page.
//   (b) NO-MOCK-NUMBERS (the load-bearing invariant): ZERO £ figures on ANY tab, empty or seeded —
//       the LIVE-NOW = 0 verdict encoded as a test.
//   (c) GATE CLASSES: every gate-state names an adoption step (an unlock); the four gate tags appear.
//   (d) READINESS REGISTER (live): physical dims read 'not started'; the recipe dim advances with
//       seeded recipe coverage (the one dimension that can move before counting starts).
//   (e) ADOPTION PLAN: the Weeks 1–6 rollout renders as real text.
//   (f) EXECUTIVE: every KPI is —; the attention queue is real adoption steps, not invented findings.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const page = require('../mission-control/ui/pages/coyote/inventory.js');
const S = require('../mission-control/ui/shared.js');

const NOW = Date.parse('2026-07-22T12:00:00Z');
const TABS = ['executive', 'forecast', 'counts', 'kitchen', 'foh', 'purchasing', 'waste', 'plan'];

function makeDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE recipe_lines (product_id TEXT, sub_item_id TEXT, quantity REAL);
    CREATE TABLE products (id TEXT PRIMARY KEY, lightspeed_sku TEXT, name TEXT);
    CREATE TABLE sub_items (id TEXT PRIMARY KEY, name TEXT, pack_cost_pence INTEGER, pack_qty REAL);
  `);
  return db;
}
const render = (db, query) => {
  const ctx = { q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, query: query || {} };
  return page.render(page.getSection(db, ctx), ctx).body;
};

test('shell: 8 tabs, executive default, ?tab= switches, unknown falls back, all inside .rcc', () => {
  const db = makeDb();
  const body = render(db);
  for (const [k] of [['executive'], ['forecast'], ['counts'], ['kitchen'], ['foh'], ['purchasing'], ['waste'], ['plan']]) {
    assert.ok(body.includes(`href="/coyote/inventory?tab=${k}"`), `tab link ${k}`);
  }
  assert.equal((body.match(/class="r-tab[ "]/g) || []).length, 8, '8 subtab links');
  assert.match(body, /class="r-tab active" href="\/coyote\/inventory\?tab=executive"/, 'executive default');
  assert.match(render(db, { tab: 'plan' }), /class="r-tab active" href="\/coyote\/inventory\?tab=plan"/, '?tab switches');
  assert.match(render(db, { tab: 'garbage' }), /class="r-tab active" href="\/coyote\/inventory\?tab=executive"/, 'unknown → executive');
  assert.equal(body.indexOf('<div class="rcc">'), 0, 'the whole page is under .rcc');
});

test('registry + nav: inventory in the Reports group AFTER costs; server requires the page; contract', () => {
  const coyote = S.WORKSPACES.find((w) => w.key === 'coyote');
  const reports = coyote.groups.find((g) => g.group === 'Reports');
  assert.deepEqual(reports.items.map((i) => i.key), ['revenue', 'labour', 'costs', 'reservations', 'operations', 'inventory', 'customer-growth', 'kitchen-safety', 'report-library'], 'inventory lands after costs');
  assert.equal(reports.items.find((i) => i.key === 'inventory').route, '/coyote/inventory');
  const srv = require('node:fs').readFileSync(require('node:path').join(__dirname, '../mission-control/server.js'), 'utf8');
  assert.match(srv, /require\('\.\/ui\/pages\/coyote\/inventory\.js'\)/, 'server requires inventory');
  assert.equal(page.key, 'inventory'); assert.equal(page.route, '/coyote/inventory'); assert.equal(page.title, 'Inventory');
});

test('THE INVARIANT — NO-MOCK-NUMBERS: not one £ figure on ANY tab, empty DB or seeded (LIVE-NOW = 0)', () => {
  for (const db of [makeDb(), (() => { const d = makeDb(); d.prepare(`INSERT INTO products VALUES ('P1','S1','Burger')`).run(); d.prepare(`INSERT INTO sub_items VALUES ('bun','Bun',500,48)`).run(); d.prepare(`INSERT INTO recipe_lines VALUES ('P1','bun',1)`).run(); return d; })()]) {
    for (const tab of TABS) {
      const body = render(db, { tab });
      assert.deepEqual(body.match(/£[\d,]+/g) || [], [], `${tab}: zero £ figures — no physical-stock number can render`);
      assert.ok(!body.includes('NaN') && !body.includes('undefined'), `${tab}: no NaN/undefined`);
    }
  }
});

test('gate classes: every gate-state names an adoption step (unlock); the four gate tags all appear across the module', () => {
  const db = makeDb();
  const all = TABS.map((t) => render(db, { tab: t })).join('');
  assert.match(all, /scope \+ process/, 'scope gate tag');
  assert.match(all, /recipe-gated/, 'recipe gate tag');
  assert.match(all, /invoice-line gated/, 'invoice gate tag');
  assert.match(all, /process-gated/, 'process gate tag');
  // every designed empty-state carries an "Unlock:" adoption step (never a bare dead-end)
  const unlocks = (all.match(/Unlock:/g) || []).length;
  assert.ok(unlocks >= 15, `every gate-state names its adoption step (${unlocks} unlocks)`);
});

test('readiness register (LIVE): physical dims read "not started"; the recipe dim ADVANCES with seeded coverage', () => {
  // empty: recipe row not started
  const empty = render(makeDb(), { tab: 'plan' });
  assert.match(empty, /Data-quality register/);
  assert.match(empty, /0 of 6 readiness dimensions started/, 'nothing started on an empty DB');
  assert.ok((empty.match(/not started/g) || []).length >= 6, 'all dims not started');
  // seed recipe coverage: 1 product costed → the recipe dim moves to in-progress, physical dims still not started
  const db = makeDb();
  db.prepare(`INSERT INTO products VALUES ('P1','S1','Burger'),('P2','S2','Fries')`).run();
  db.prepare(`INSERT INTO sub_items VALUES ('bun','Bun',500,48)`).run();
  db.prepare(`INSERT INTO recipe_lines VALUES ('P1','bun',1)`).run();
  const seeded = render(db, { tab: 'plan' });
  assert.match(seeded, /1 of 6 readiness dimensions started/, 'the recipe dimension advanced (1/6)');
  assert.match(seeded, /50% — in progress/, 'recipe coverage 1/2 = 50%, live');
  // and STILL no £ figure and no physical count fabricated
  assert.deepEqual(seeded.match(/£[\d,]+/g) || [], []);
});

test('adoption plan: the Weeks 1–6 rollout renders as real text (a plan is not data)', () => {
  const body = render(makeDb(), { tab: 'plan' });
  for (const wk of ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6']) assert.ok(body.includes(wk), `${wk} present`);
  assert.match(body, /operations-scope grant/, 'week 1 = the scope grant');
  assert.match(body, /cost the top-20 recipes/, 'week 6 = the Calum gate');
  assert.match(body, /Oversight rules/, 'the control framework card');
  assert.match(body, /surveillance boundary/, 'no per-person waste scoring — the standing ruling carried in');
});

test('executive: every KPI is —; the attention queue is REAL adoption steps, not invented findings', () => {
  const body = render(makeDb());
  const kpis = body.match(/r-kpi-value">([^<]*)</g) || [];
  assert.ok(kpis.length >= 6, 'six KPI tiles');
  for (const v of kpis) assert.ok(v.includes('—'), `KPI reads — (got ${v})`);
  assert.match(body, /Inventory has no live source yet/, 'the honest lead alert');
  assert.match(body, /Recipe costing is the one advanceable gate/, 'the real next step');
  assert.doesNotMatch(body, /\bstockout(s)? (rose|fell|up|down)\b/i, 'no invented trend findings');
});
