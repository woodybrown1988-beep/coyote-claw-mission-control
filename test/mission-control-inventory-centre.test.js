'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const page = require('../mission-control/ui/pages/coyote/inventory.js');
const S = require('../mission-control/ui/shared.js');

const NOW = Date.parse('2026-07-22T12:00:00Z');
const TABS = ['executive', 'forecast', 'counts', 'kitchen', 'foh', 'purchasing', 'waste', 'plan'];
const APPROVED_TABLES = new Set(['sub_items', 'stock_movements', 'ingredient_count_settings', 'stock_counts', 'count_lines', 'waste_events']);

function makeDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS sub_items (
  id               TEXT    PRIMARY KEY,            -- stable id (slug or generated)
  name             TEXT    NOT NULL,
  supplier         TEXT,
  pack_description TEXT,                           -- e.g. 'box of 48 buns'
  pack_cost_pence  INTEGER,                        -- the real invoice cost of ONE pack (integer pence)
  pack_qty         REAL,                           -- usable units per pack (e.g. 48; REAL for weighed items)
  unit_of_measure  TEXT    NOT NULL,               -- each | g | ml | portion (the four legal units)
  cost_source      TEXT    NOT NULL DEFAULT 'manual', -- manual | portal | pdf (reserves the Move-3 live-loop slot)
  updated_at       INTEGER NOT NULL,               -- epoch ms of the last cost/definition edit
  CHECK (unit_of_measure IN ('each', 'g', 'ml', 'portion')),
  CHECK (cost_source IN ('manual', 'portal', 'pdf')),
  CHECK (pack_cost_pence IS NULL OR pack_cost_pence >= 0),
  CHECK (pack_qty IS NULL OR pack_qty > 0)          -- never divide by zero when computing unit cost
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id              INTEGER PRIMARY KEY,
  kind            TEXT    NOT NULL CHECK (kind IN ('receipt','usage','waste','transfer','batch','adjustment')),
  ingredient_id   TEXT    NOT NULL REFERENCES sub_items(id),
  business_date   TEXT    NOT NULL,
  location        TEXT,
  qty             REAL    NOT NULL,   -- signed, in unit_of_measure: usage and waste NEGATIVE, receipts positive, adjustments either
  unit_of_measure TEXT    NOT NULL,   -- copied from sub_items.unit_of_measure at write time
  value_pence     INTEGER,            -- qty * (pack_cost_pence / pack_qty), rounded at THIS boundary only; NULL when the ingredient has no pack cost
  proof_kind      TEXT    NOT NULL,   -- 'sales-day' for usage
  proof_ref       TEXT    NOT NULL,   -- the business_date for usage
  entered_by      TEXT    NOT NULL,   -- 'engine:usage'
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ingredient_count_settings (
  ingredient_id   TEXT PRIMARY KEY REFERENCES sub_items(id),
  location        TEXT NOT NULL,          -- 'kitchen' | 'walk-in' | 'dry-store' | 'bar' | 'cellar' (free text, no CHECK: locations are the venue's)
  walk_order      INTEGER NOT NULL,       -- position on the shelf walk within the location
  count_unit      TEXT NOT NULL,          -- what a person sees: 'tub', 'bottle', 'case', 'bag', 'each'
  count_unit_qty  REAL NOT NULL CHECK (count_unit_qty > 0), -- base units (sub_items.unit_of_measure) in ONE count unit, e.g. tub = 4000 ml
  active          INTEGER NOT NULL DEFAULT 1,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_counts (
  id              TEXT PRIMARY KEY,       -- uuid
  business_date   TEXT NOT NULL,          -- the trading day the count closes: a count taken after close belongs to that day
  kind            TEXT NOT NULL CHECK (kind IN ('full','spot')),
  status          TEXT NOT NULL CHECK (status IN ('open','closed')),
  opened_by       TEXT NOT NULL,
  opened_at       INTEGER NOT NULL,
  closed_by       TEXT,
  closed_at       INTEGER,
  settled_through TEXT,                   -- last business_date whose usage existed when adjustments were last computed
  note            TEXT
);

CREATE TABLE IF NOT EXISTS count_lines (
  count_id        TEXT NOT NULL REFERENCES stock_counts(id),
  ingredient_id   TEXT NOT NULL REFERENCES sub_items(id),
  location        TEXT NOT NULL,
  count_unit_qty  REAL NOT NULL,          -- what was typed, in count units (2.5 tubs)
  counted_qty     REAL NOT NULL,          -- converted to base units at write time using ingredient_count_settings.count_unit_qty
  entered_by      TEXT NOT NULL,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (count_id, ingredient_id, location)
);

CREATE TABLE IF NOT EXISTS waste_events (
  id              TEXT PRIMARY KEY,             -- uuid
  business_date   TEXT NOT NULL,
  ingredient_id   TEXT REFERENCES sub_items(id),
  product_sku     TEXT,                         -- a finished dish thrown away: expanded through recipe_lines
  qty             REAL NOT NULL,
  unit            TEXT NOT NULL CHECK (unit IN ('base','count','portion')),
  reason          TEXT NOT NULL CHECK (reason IN ('prep','spoiled','dropped','over-made','returned','other')),
  note            TEXT,
  photo_path      TEXT,
  entered_by      TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  CHECK (
    (ingredient_id IS NOT NULL AND product_sku IS NULL)
    OR (ingredient_id IS NULL AND product_sku IS NOT NULL)
  ),
  CHECK (qty > 0)
);`);
  return db;
}

function seedDb() {
  const db = makeDb();
  db.exec(`
    INSERT INTO sub_items (id,name,pack_cost_pence,pack_qty,unit_of_measure,updated_at) VALUES
      ('bun','Brioche bun',4800,48,'each',1),
      ('oil','Fryer oil',1000,1000,'ml',1),
      ('cheese','American cheese',NULL,10,'each',1);
    INSERT INTO ingredient_count_settings (ingredient_id,location,walk_order,count_unit,count_unit_qty,active,updated_at) VALUES
      ('bun','kitchen',1,'case',48,1,1),
      ('oil','kitchen',2,'bottle',1000,1,1),
      ('cheese','kitchen',3,'case',10,1,1);
  `);
  const count = db.prepare(`INSERT INTO stock_counts
    (id,business_date,kind,status,opened_by,opened_at,closed_by,closed_at,settled_through,note)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  count.run('full-1', '2026-07-20', 'full', 'closed', 'Alex', Date.parse('2026-07-20T21:00:00Z'), 'Alex', Date.parse('2026-07-20T23:00:00Z'), '2026-07-20', 'Weekly close');
  count.run('spot-1', '2026-07-21', 'spot', 'closed', 'Bea', Date.parse('2026-07-21T21:00:00Z'), 'Bea', Date.parse('2026-07-21T23:30:00Z'), '2026-07-21', 'High-risk lines');
  const line = db.prepare(`INSERT INTO count_lines
    (count_id,ingredient_id,location,count_unit_qty,counted_qty,entered_by,updated_at)
    VALUES (?,?,?,?,?,?,?)`);
  line.run('full-1', 'bun', 'kitchen', 20 / 48, 20, 'Alex', 1);
  line.run('full-1', 'oil', 'kitchen', 0.5, 500, 'Alex', 1);
  line.run('full-1', 'cheese', 'kitchen', 1, 10, 'Alex', 1);
  line.run('spot-1', 'bun', 'kitchen', 18 / 48, 18, 'Bea', 1);
  line.run('spot-1', 'oil', 'kitchen', 0.4, 400, 'Bea', 1);

  const movement = db.prepare(`INSERT INTO stock_movements
    (id,kind,ingredient_id,business_date,location,qty,unit_of_measure,value_pence,proof_kind,proof_ref,entered_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  movement.run(1, 'adjustment', 'bun', '2026-07-21', 'kitchen', -3, 'each', -300, 'count', 'spot-1', 'engine:count', 1);
  movement.run(2, 'adjustment', 'oil', '2026-07-21', 'kitchen', 50, 'ml', 50, 'count', 'spot-1', 'engine:count', 1);
  movement.run(3, 'adjustment', 'cheese', '2026-07-21', 'kitchen', -2, 'each', null, 'count', 'spot-1', 'engine:count', 1);
  movement.run(4, 'adjustment', 'bun', '2026-07-20', 'kitchen', -1, 'each', -100, 'count', 'full-1', 'engine:count', 1);
  movement.run(5, 'adjustment', 'bun', '2026-07-21', 'kitchen', -99, 'each', -9900, 'waste', 'spot-1', 'wrong-marker', 1);
  const usageValues = [
    ['2026-07-15', -80, -8000], ['2026-07-16', -1, -100], ['2026-07-17', -2, -200], ['2026-07-18', -3, -300],
    ['2026-07-19', -4, -400], ['2026-07-20', -5, -500], ['2026-07-21', -6, -600], ['2026-07-22', -7, -700],
  ];
  usageValues.forEach(([date, qty, value], i) => movement.run(10 + i, 'usage', 'bun', date, 'kitchen', qty, 'each', value, 'sales-day', date, 'engine:usage', 1));
  movement.run(18, 'usage', 'cheese', '2026-07-22', 'kitchen', -4, 'each', null, 'sales-day', '2026-07-22', 'engine:usage', 1);
  movement.run(19, 'usage', 'bun', '2026-07-22', 'kitchen', -50, 'each', -5000, 'count', '2026-07-22', 'wrong-marker', 1);

  const wasteEvent = db.prepare(`INSERT INTO waste_events
    (id,business_date,ingredient_id,product_sku,qty,unit,reason,note,photo_path,entered_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  wasteEvent.run('w-prep', '2026-07-22', 'bun', null, 2, 'base', 'prep', 'Damaged during prep', null, 'Chef', 1);
  wasteEvent.run('w-spoiled', '2026-07-10', 'oil', null, 300, 'base', 'spoiled', 'Past safe use', null, 'Chef', 1);
  wasteEvent.run('w-void', '2026-07-21', 'bun', null, 90, 'base', 'other', 'Entered twice [voided by Tester]', null, 'Chef', 1);
  movement.run(30, 'waste', 'bun', '2026-07-22', 'kitchen', -2, 'each', -200, 'waste', 'w-prep', 'Chef', 1);
  movement.run(31, 'waste', 'oil', '2026-07-10', 'kitchen', -300, 'ml', -300, 'waste', 'w-spoiled', 'Chef', 1);
  return db;
}

function qFor(db) { return (sql, params) => DATA.safeSelect(db, sql, params); }
function render(db, query) {
  const ctx = { q: qFor(db), now: NOW, query: query || {} };
  return page.render(page.getSection(db, ctx), ctx).body;
}

const OLD_GATE = {
  scope: { tag: 'scope + process', tone: 'bad', blocker: 'Lightspeed inventory is the K-Series OPERATIONS API — 403-NO-SCOPE on today’s token (the same wall as account-profiles; grant requested, pending). AND even once granted it stays empty until the venue MAINTAINS stock in Lightspeed — this is a process to adopt, not a toggle.' },
  recipe: { tag: 'recipe-gated', tone: 'warn', blocker: 'theoretical usage needs recipe_lines (the Calum gate) AND the physical/actual side above — double-gated: recipe costing alone does not light this without the count feed.' },
  process: { tag: 'process-gated', tone: 'bad', blocker: 'needs a DAILY HUMAN WORKFLOW that is not happening — this is one of the mock’s own Weeks 1–6: a process the business would adopt, not a data source waiting on a switch.' },
};
function oldGatePanel(title, sub, cls, step) {
  const gate = OLD_GATE[cls];
  return S.rcc.panel({ title, sub, headRight: S.rcc.tag(gate.tag, gate.tone), body: S.rcc.emptyState({ title, blocker: gate.blocker, unlock: step }) });
}

test('shell, contract and exported getSection negative control', () => {
  const db = makeDb();
  const body = render(db);
  for (const tab of TABS) assert.ok(body.includes(`href="/coyote/inventory?tab=${tab}"`), `tab link ${tab}`);
  assert.equal((body.match(/class="r-tab[ "]/g) || []).length, 8);
  assert.match(body, /class="r-tab active" href="\/coyote\/inventory\?tab=executive"/);
  assert.match(render(db, { tab: 'plan' }), /class="r-tab active" href="\/coyote\/inventory\?tab=plan"/);
  const fallback = page.getSection(null, { query: { tab: 'not-a-tab' }, now: NOW });
  assert.equal(fallback.tab, 'executive');
  assert.equal(fallback.readiness, null);
  assert.equal(page.key, 'inventory');
  assert.equal(page.route, '/coyote/inventory');
  assert.equal(page.title, 'Inventory');
});

test('empty six-table database renders every new source as — and invents no pound figure', () => {
  const db = makeDb();
  const executive = render(db);
  assert.deepEqual(executive.match(/r-kpi-value">([^<]*)</g), [
    'r-kpi-value">—<', 'r-kpi-value">—<', 'r-kpi-value">—<',
    'r-kpi-value">—<', 'r-kpi-value">—<', 'r-kpi-value">—<',
  ]);
  const counts = render(db, { tab: 'counts' });
  const waste = render(db, { tab: 'waste' });
  assert.match(counts, /Last counts/);
  assert.match(counts, /class="inv-empty">—</);
  assert.match(waste, /Waste by reason/);
  assert.ok((waste.match(/class="inv-empty">—</g) || []).length >= 2);
  assert.deepEqual([executive, counts, waste].join('').match(/£[\d,]/g) || [], []);
});

test('empty applicable feeds retain the existing gate panels byte-identically', () => {
  const db = makeDb();
  const counts = render(db, { tab: 'counts' });
  assert.ok(counts.includes(oldGatePanel('Top discrepancies', 'largest count-vs-book gaps', 'process', 'a completed stock count — no count, no discrepancy')));
  assert.ok(counts.includes(oldGatePanel('Count quality gate', 'count completion + accuracy', 'process', 'the counting cadence — the gate grades counts that do not exist yet')));
  assert.ok(counts.includes(oldGatePanel('Movement reconciliation', 'purchases − usage − waste = closing', 'scope', 'the inventory movements API (scope-gated) OR counts + waste + recipe usage')));
  assert.ok(counts.includes(oldGatePanel('Variance decision logic', 'the rules that turn a variance into an action', 'recipe', 'theoretical usage (recipes) to compare actual counts against')));
  const waste = render(db, { tab: 'waste' });
  const requiredFields = S.rcc.panel({ title: 'Required waste fields', sub: 'the minimum a waste log must capture', headRight: S.rcc.tag('adoption spec', 'info'),
    body: '<div class="r-mini-note">when waste logging starts, each event needs: item · quantity · reason (spoilage / prep-loss / over-production / customer-error / breakage) · daypart · who. That is the schema this panel fills — it is an adoption SPEC, not a live table.</div>' });
  assert.ok(waste.includes(requiredFields));
  assert.ok(waste.includes(oldGatePanel('Batch yield performance', 'recorded yield vs recipe yield', 'recipe', 'batch recipes with expected yields + posted production')));
  assert.ok(waste.includes(oldGatePanel('Production controls', 'batch posting discipline', 'process', 'posting production batches as they are made')));
});

test('aggregation helpers select the deterministic latest count and exact engine-linked facts', () => {
  const db = seedDb();
  const q = qFor(db);
  const readiness = page.getReadiness(q);
  assert.deepEqual([readiness.counts.ready, readiness.counts.count, readiness.waste.ready, readiness.waste.count], [true, 2, true, 3]);
  assert.deepEqual(page.getCountQuality(q, 'spot-1'), { activeCount: 3, missingCount: 1, names: ['American cheese'] });
  const counts = page.getCountsAggregation(q);
  assert.deepEqual(counts.lastCounts.map((row) => row.id), ['spot-1', 'full-1']);
  assert.equal(counts.latestClosed.id, 'spot-1');
  assert.deepEqual(counts.adjustments.map((row) => [row.ingredient_id, row.qty, row.value_pence]), [
    ['bun', -3, -300], ['oil', 50, 50], ['cheese', -2, null],
  ]);
  assert.deepEqual(counts.quality, { activeCount: 3, missingCount: 1, names: ['American cheese'] });

  const waste = page.getWasteAggregates(q, NOW);
  assert.equal(waste.from, '2026-06-25');
  assert.equal(waste.to, '2026-07-22');
  assert.deepEqual(waste.byReason.map((row) => [row.reason, row.event_count, row.value_pence]), [
    ['spoiled', 1, 300], ['prep', 1, 200],
  ]);
  assert.deepEqual(waste.topIngredients.map((row) => [row.ingredient_id, row.event_count, row.qty, row.value_pence]), [
    ['oil', 1, 300, 300], ['bun', 1, 2, 200],
  ]);

  const kpis = page.getExecutiveKpis(q, NOW);
  assert.equal(kpis.latestFull.id, 'full-1');
  assert.equal(kpis.countedStockPence, 2500);
  assert.equal(kpis.usagePence, 2800);
  assert.equal(kpis.usageDateCount, 7);
  assert.equal(kpis.wastePence, 200);
  assert.equal(kpis.lastFullDaysAgo, 2);

  const section = page.getSection(db, { q, now: NOW, query: { tab: 'counts' } });
  assert.equal(section.tab, 'counts');
  assert.equal(section.counts.latestClosed.id, 'spot-1');
  assert.equal(section.executive.usagePence, 2800);
});

test('seeded render shows exact count, discrepancy, quality, waste, usage and KPI figures', () => {
  const db = seedDb();
  const executive = render(db);
  for (const text of ['£25.00', '£28.00', '2026-07-20', '2 calendar days ago', '£2.00']) assert.ok(executive.includes(text), text);
  assert.doesNotMatch(executive, /£50\.00|£80\.00/, 'wrong-marker and eighth usage date excluded');

  const counts = render(db, { tab: 'counts' });
  assert.ok(counts.indexOf('spot-1') < counts.indexOf('full-1'), 'last counts ordered newest first');
  for (const text of ['−3 each', '−£3.00', '+50 ml', '+£0.50', 'American cheese', 'Active item-locations not counted', '<strong>1</strong>', '3 active count settings']) assert.ok(counts.includes(text), text);
  assert.doesNotMatch(counts, /£99\.00/, 'adjustment without all count markers excluded');
  assert.match(counts, /American cheese<\/td><td>kitchen<\/td><td class="num">−2 each<\/td><td class="num">—<\/td>/, 'uncosted discrepancy has no fabricated value');

  const waste = render(db, { tab: 'waste' });
  for (const text of ['spoiled', 'prep', '£3.00', '£2.00', 'Fryer oil', 'Brioche bun']) assert.ok(waste.includes(text), text);
  assert.doesNotMatch(waste, /voided by|Tester|<td>other<\/td>|90 each/, 'voided event excluded everywhere');

  const plan = render(db, { tab: 'plan' });
  assert.match(plan, /2 of 6 readiness dimensions started/);
  assert.match(plan, /2 counts on record/);
  assert.match(plan, /3 waste events logged/);
});

test('formatting and date helpers cover signed, rounded and fallback behaviour', () => {
  assert.equal(page.formatPounds(1234.6), '£12.35');
  assert.equal(page.formatPounds(123456.6), '£1,234.57');
  assert.equal(page.formatPounds(-300, true), '−£3.00');
  assert.equal(page.formatPounds(50, true), '+£0.50');
  assert.equal(page.formatPounds(null), '—');
  assert.equal(page.formatSignedQuantity(-2.5, 'ml'), '−2.5 ml');
  assert.equal(page.formatSignedQuantity(3, 'each'), '+3 each');
  assert.equal(page.formatSignedQuantity(undefined, 'g'), '—');
  assert.equal(page.calendarDaysAgo('2026-07-20', NOW), 2);
  assert.equal(page.calendarDaysAgo('', NOW), null);
});

test('every Inventory Centre FROM/JOIN identifier belongs to the approved six-table schema', () => {
  const identifiers = [];
  for (const sql of Object.values(page.INVENTORY_SQL)) {
    for (const match of sql.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)/gi)) identifiers.push(match[1]);
  }
  assert.ok(identifiers.length > 0);
  assert.deepEqual([...new Set(identifiers)].sort(), [...APPROVED_TABLES].sort());
  for (const identifier of identifiers) assert.ok(APPROVED_TABLES.has(identifier), identifier);
});

test('golden isolation: every other page file remains byte-identical', () => {
  function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
      ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
  }
  const root = path.join(__dirname, '../mission-control/ui/pages');
  const files = walk(root).filter((file) => file.endsWith('.js') && file !== path.join(root, 'coyote/inventory.js')).sort();
  const hash = crypto.createHash('sha256');
  for (const file of files) hash.update(`${path.relative(path.join(__dirname, '..'), file)}\0`).update(fs.readFileSync(file)).update('\0');
  assert.equal(files.length, 34);
  assert.equal(hash.digest('hex'), '2f27c2dd46f00a11a3e8c0bd1b3d6fac93135772d94204098e8a1e2debfc2ab2');
});
