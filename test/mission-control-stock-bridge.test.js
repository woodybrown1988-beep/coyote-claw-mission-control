'use strict';

process.env.MC_AUTH_SECRET = 'test-operator-secret-0123456789abcdef';
process.env.MC_STAFF_SECRET = 'test-staff-secret-0123456789abcdef';
process.env.MC_SESSION_KEY = 'test-session-key-0123456789abcdef';
process.env.MC_LOGIN_DELAY_MS = '0';
process.env.MC_ENGINE_DIR = '/srv/coyote-stock-engine';
process.env.MC_STOCK_TEST_ENV = 'preserved';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DB_PATH = path.join(os.tmpdir(), `mc-stock-bridge-${process.pid}-${randomUUID()}.db`);
process.env.COYOTE_CLAW_DB = DB_PATH;

const AUTH = require('../mission-control/ui/auth.js');
const { buildStockArgv } = require('../mission-control/ui/stock-bridge.js');
const {
  getStockContext,
  handleRequest,
  normalizeStockEngineResult,
} = require('../mission-control/server.js');
const DATA = require('../mission-control/ui/data.js');

const COUNT_ID = '123e4567-e89b-12d3-a456-426614174000';
const OPEN_ID = '223e4567-e89b-12d3-a456-426614174001';
const WASTE_ID = '323e4567-e89b-12d3-a456-426614174002';

const db = new sqlite.DatabaseSync(DB_PATH);
db.exec(String.raw`CREATE TABLE IF NOT EXISTS sub_items (
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
);

CREATE TABLE IF NOT EXISTS ls_items (
  sku                  TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  item_type            TEXT NOT NULL CHECK (item_type IN ('item','combo','group','sub-item')),
  accounting_group     TEXT,
  price_mode           TEXT NOT NULL CHECK (price_mode IN ('amount','percent','none')),
  default_price_pence  INTEGER,        -- when price_mode = 'amount'
  default_price_percent REAL,          -- when price_mode = 'percent'
  cost_price_hp        INTEGER,        -- hundredths of a penny: '0.4163' -> 4163 (lossless; never round a 4dp input to pence)
  package_content      REAL,
  package_unit         TEXT,
  min_max              TEXT,
  sharing_status       TEXT,
  docket_name          TEXT,
  button_name          TEXT,
  menu_paths           TEXT NOT NULL,  -- JSON array of raw 'Menu/Screen/...' tokens
  statistics_groups    TEXT NOT NULL,  -- JSON array of raw tokens
  production_instructions TEXT NOT NULL, -- JSON array of raw tokens
  source_hash          TEXT NOT NULL,
  updated_at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id             TEXT    PRIMARY KEY,            -- stable id (defaults to the sku)
  lightspeed_sku TEXT    NOT NULL UNIQUE,        -- JOINS to sales_line_items.sku
  name           TEXT,
  category       TEXT,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recipe_lines (
  product_id  TEXT    NOT NULL,
  sub_item_id TEXT    NOT NULL,
  quantity    REAL    NOT NULL,                  -- amount of the sub-item per product, in its unit
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (product_id, sub_item_id),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (sub_item_id) REFERENCES sub_items(id),
  CHECK (quantity > 0)
);
`);

const insertIngredient = db.prepare(`INSERT INTO sub_items
  (id, name, pack_cost_pence, pack_qty, unit_of_measure, updated_at) VALUES (?, ?, ?, ?, ?, ?)`);
insertIngredient.run('beef', 'Beef', 1000, 100, 'g', 1);
insertIngredient.run('herbs', 'Herbs', 200, 20, 'g', 1);
db.prepare(`INSERT INTO ingredient_count_settings
  (ingredient_id, location, walk_order, count_unit, count_unit_qty, active, updated_at)
  VALUES (?, ?, ?, ?, ?, 1, 1)`).run('beef', 'kitchen', 2, 'tray', 10);
db.prepare(`INSERT INTO ingredient_count_settings
  (ingredient_id, location, walk_order, count_unit, count_unit_qty, active, updated_at)
  VALUES (?, ?, ?, ?, ?, 1, 1)`).run('herbs', 'dry-store', 1, 'bag', 2);

db.prepare(`INSERT INTO stock_counts
  (id, business_date, kind, status, opened_by, opened_at, closed_by, closed_at)
  VALUES (?, '2026-09-08', 'full', 'closed', 'Alex', 100, 'Alex', 200)`).run(COUNT_ID);
db.prepare(`INSERT INTO stock_counts
  (id, business_date, kind, status, opened_by, opened_at, note)
  VALUES (?, '2026-09-11', 'spot', 'open', 'Sam', 500, 'service close')`).run(OPEN_ID);
db.prepare(`INSERT INTO count_lines VALUES (?, 'beef', 'kitchen', 5, 50, 'Alex', 200)`).run(COUNT_ID);
db.prepare(`INSERT INTO count_lines VALUES (?, 'beef', 'kitchen', 7, 70, 'Sam', 600)`).run(OPEN_ID);

const insertMovement = db.prepare(`INSERT INTO stock_movements
  (id, kind, ingredient_id, business_date, location, qty, unit_of_measure, value_pence,
   proof_kind, proof_ref, entered_by, created_at) VALUES (?, ?, 'beef', ?, ?, ?, 'g', ?, ?, ?, ?, ?)`);
insertMovement.run(1, 'receipt', '2026-09-09', 'kitchen', 20, 200, 'receipt', 'r1', 'engine:receipt', 300);
insertMovement.run(2, 'usage', '2026-09-10', null, -10, -100, 'sales-day', '2026-09-10', 'engine:usage', 400);
insertMovement.run(3, 'adjustment', '2026-09-10', 'kitchen', 999, 9990, 'count', COUNT_ID, 'Alex', 450);

db.prepare(`INSERT INTO waste_events
  (id, business_date, ingredient_id, qty, unit, reason, note, entered_by, created_at)
  VALUES ('w-active', '2026-09-10', 'beef', 2, 'base', 'spoiled', 'trim', 'Alex', 700)`).run();
db.prepare(`INSERT INTO stock_movements
  (id, kind, ingredient_id, business_date, qty, unit_of_measure, value_pence, proof_kind, proof_ref, entered_by, created_at)
  VALUES (4, 'waste', 'beef', '2026-09-10', -2, 'g', -20, 'waste', 'w-active', 'Alex', 700)`).run();
db.prepare(`INSERT INTO waste_events
  (id, business_date, product_sku, qty, unit, reason, note, entered_by, created_at)
  VALUES ('w-void', '2026-09-11', 'BURGER', 1, 'portion', 'returned', 'guest return [voided by Sam]', 'Sam', 800)`).run();

const insertLsItem = db.prepare(`INSERT INTO ls_items
  (sku, name, item_type, price_mode, default_price_pence, menu_paths, statistics_groups,
   production_instructions, source_hash, updated_at) VALUES (?, ?, ?, ?, ?, '[]', '[]', '[]', ?, 1)`);
insertLsItem.run('MOD-1', 'Add bacon', 'sub-item', 'none', null, 'h1');
insertLsItem.run('BURGER', 'Burger', 'item', 'amount', 1200, 'h2');
insertLsItem.run('NO-RECIPE', 'No recipe', 'item', 'amount', 900, 'h3');
db.prepare(`INSERT INTO products VALUES ('burger-product', 'BURGER', 'House Burger', 'food', 1)`).run();
db.prepare(`INSERT INTO recipe_lines VALUES ('burger-product', 'beef', 20, 1)`).run();

test.after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch (_) { /* already absent */ }
  }
});

function makeRes() {
  const res = { statusCode: 0, headers: {}, body: '' };
  res.setHeader = (key, value) => { res.headers[String(key).toLowerCase()] = value; };
  res.getHeader = (key) => res.headers[String(key).toLowerCase()];
  res.writeHead = (status, headers) => {
    res.statusCode = status;
    for (const [key, value] of Object.entries(headers || {})) res.headers[key.toLowerCase()] = value;
    return res;
  };
  res.done = new Promise((resolve) => { res.resolve = resolve; });
  res.end = (body) => { if (body != null) res.body += body; res.resolve(res); };
  return res;
}

function makeReq(method, url, headers, body) {
  const req = Readable.from([body == null ? '' : body]);
  req.method = method;
  req.url = url;
  req.headers = { host: '127.0.0.1:8787', ...(headers || {}) };
  return req;
}

async function request(method, url, headers, body, dependencies) {
  const res = makeRes();
  handleRequest(makeReq(method, url, headers, body), res, dependencies);
  return res.done;
}

function cookie(tier) {
  return { cookie: `${AUTH.COOKIE}=${AUTH.issueToken(Date.now(), tier)}` };
}

function actionBody(op, args, by = 'Alex Smith') {
  return JSON.stringify({ op, args, by });
}

test('buildStockArgv emits exact argv and flag order for every operation', () => {
  assert.deepEqual(buildStockArgv({
    op: 'count-open', args: { businessDate: '2026-09-11', kind: 'spot' }, by: 'Alex Smith',
  }), { argv: ['count-open', '2026-09-11', 'spot', '--by', 'Alex Smith'] });
  assert.deepEqual(buildStockArgv({
    op: 'count-set', args: { countId: COUNT_ID, ingredientId: 'beef.1', location: 'walk-in', countUnits: 2.5 }, by: 'Alex',
  }), { argv: ['count-set', COUNT_ID, 'beef.1', 'walk-in', '2.5', '--by', 'Alex'] });
  assert.deepEqual(buildStockArgv({
    op: 'count-set', args: { countId: COUNT_ID, ingredientId: 'beef', location: 'kitchen', countUnits: null }, by: 'Alex',
  }), { argv: ['count-set', COUNT_ID, 'beef', 'kitchen', 'blank', '--by', 'Alex'] });
  assert.deepEqual(buildStockArgv({ op: 'count-close', args: { countId: COUNT_ID }, by: 'Alex' }),
    { argv: ['count-close', COUNT_ID, '--by', 'Alex'] });
  assert.deepEqual(buildStockArgv({
    op: 'waste', args: { target: 'sku:BURGER-1', qty: 0.125, unit: 'portion', reason: 'returned' }, by: 'Sam',
  }), { argv: ['waste', 'sku:BURGER-1', '0.125', 'portion', 'returned', '--by', 'Sam'] });
  assert.deepEqual(buildStockArgv({
    op: 'waste', args: { target: 'beef', qty: 2, unit: 'count', reason: 'prep', note: 'service trim' }, by: 'Sam',
  }), { argv: ['waste', 'beef', '2', 'count', 'prep', '--note', 'service trim', '--by', 'Sam'] });
  assert.deepEqual(buildStockArgv({ op: 'waste-void', args: { id: WASTE_ID }, by: 'Sam' }),
    { argv: ['waste-void', WASTE_ID, '--by', 'Sam'] });
});

test('buildStockArgv rejects unknown, missing, extra and wrongly typed fields', () => {
  const good = { op: 'count-close', args: { countId: COUNT_ID }, by: 'Alex' };
  for (const value of [
    null,
    {},
    { op: 'count-close', args: { countId: COUNT_ID } },
    { ...good, extra: true },
    { ...good, op: 'count-import' },
    { ...good, op: 'constructor' },
    { ...good, op: 3 },
    { ...good, args: null },
    { ...good, args: {} },
    { ...good, args: { countId: COUNT_ID, extra: true } },
  ]) assert.ok(buildStockArgv(value).error, JSON.stringify(value));
});

test('buildStockArgv rejects malformed dates, ids, UUIDs and targets', () => {
  for (const businessDate of ['2026-9-01', '2026-02-30', '', 20260901]) {
    assert.ok(buildStockArgv({ op: 'count-open', args: { businessDate, kind: 'full' }, by: 'Alex' }).error);
  }
  for (const countId of ['not-a-uuid', `${COUNT_ID}x`, '', 12]) {
    assert.ok(buildStockArgv({ op: 'count-close', args: { countId }, by: 'Alex' }).error);
  }
  for (const ingredientId of ['bad id', 'bad/id', 'x'.repeat(65), '', 1]) {
    assert.ok(buildStockArgv({
      op: 'count-set', args: { countId: COUNT_ID, ingredientId, location: 'bar', countUnits: 1 }, by: 'Alex',
    }).error);
  }
  for (const location of ['walk in', '../walk-in', 'x'.repeat(65), '', null]) {
    assert.ok(buildStockArgv({
      op: 'count-set', args: { countId: COUNT_ID, ingredientId: 'beef', location, countUnits: 1 }, by: 'Alex',
    }).error);
  }
  for (const target of ['sku:', 'sku:bad id', 'other:beef', 'bad target', '', null]) {
    assert.ok(buildStockArgv({ op: 'waste', args: { target, qty: 1, unit: 'base', reason: 'prep' }, by: 'Alex' }).error);
  }
});

test('buildStockArgv rejects invalid enums, quantities, by values and notes', () => {
  assert.ok(buildStockArgv({ op: 'count-open', args: { businessDate: '2026-09-11', kind: 'weekly' }, by: 'Alex' }).error);
  for (const unit of ['each', 'BASE', '', null]) {
    assert.ok(buildStockArgv({ op: 'waste', args: { target: 'beef', qty: 1, unit, reason: 'prep' }, by: 'Alex' }).error);
  }
  for (const reason of ['lost', 'SPOILED', '', null]) {
    assert.ok(buildStockArgv({ op: 'waste', args: { target: 'beef', qty: 1, unit: 'base', reason }, by: 'Alex' }).error);
  }
  for (const qty of [0, -1, NaN, Infinity, -Infinity, '2', null]) {
    assert.ok(buildStockArgv({ op: 'waste', args: { target: 'beef', qty, unit: 'base', reason: 'prep' }, by: 'Alex' }).error);
  }
  for (const qty of [0, -1, NaN, Infinity, -Infinity, '2']) {
    assert.ok(buildStockArgv({
      op: 'count-set', args: { countId: COUNT_ID, ingredientId: 'beef', location: 'bar', countUnits: qty }, by: 'Alex',
    }).error);
  }
  for (const by of ['', ' Alex', 'Alex ', 'Alex\nRoot', 'x'.repeat(65), null, 4]) {
    assert.ok(buildStockArgv({ op: 'count-close', args: { countId: COUNT_ID }, by }).error);
  }
  for (const note of ['', 'x'.repeat(201), 'line\nbreak', null, 3]) {
    assert.ok(buildStockArgv({ op: 'waste', args: { target: 'beef', qty: 1, unit: 'base', reason: 'other', note }, by: 'Alex' }).error);
  }
});

test('buildStockArgv accepts the exact positive and text-length boundaries', () => {
  assert.deepEqual(buildStockArgv({
    op: 'count-open', args: { businessDate: '2028-02-29', kind: 'full' }, by: 'x'.repeat(64),
  }), { argv: ['count-open', '2028-02-29', 'full', '--by', 'x'.repeat(64)] });
  assert.deepEqual(buildStockArgv({
    op: 'count-set',
    args: { countId: COUNT_ID.toUpperCase(), ingredientId: 'x'.repeat(64), location: 'y'.repeat(64), countUnits: Number.MIN_VALUE },
    by: 'Alex',
  }).argv[4], String(Number.MIN_VALUE));
  assert.equal(buildStockArgv({
    op: 'waste', args: { target: 'beef', qty: 1, unit: 'base', reason: 'dropped', note: 'n'.repeat(200) }, by: 'Alex',
  }).argv[6].length, 200);
});

test('RED CONTROL — an injected empty operation allowlist rejects every operation', () => {
  const validInputs = [
    { op: 'count-open', args: { businessDate: '2026-09-11', kind: 'full' }, by: 'Alex' },
    { op: 'count-set', args: { countId: COUNT_ID, ingredientId: 'beef', location: 'bar', countUnits: 1 }, by: 'Alex' },
    { op: 'count-close', args: { countId: COUNT_ID }, by: 'Alex' },
    { op: 'waste', args: { target: 'beef', qty: 1, unit: 'base', reason: 'other' }, by: 'Alex' },
    { op: 'waste-void', args: { id: WASTE_ID }, by: 'Alex' },
  ];
  for (const input of validInputs) assert.deepEqual(buildStockArgv(input, Object.freeze({})), { error: 'unknown operation' });
});

test('action route invokes injected execFile with fixed executable, argv and safe options', async () => {
  let invocation;
  const note = 'keep $(touch /tmp/nope); exactly as one argv value';
  const execFile = (...args) => {
    invocation = args.slice(0, 3);
    args[3](null, '', `[stock] recorded waste ${WASTE_ID}: 1 movements (-20p) for 2026-09-11\n`);
  };
  const res = await request('POST', '/api/stock/action',
    { ...cookie('operator'), origin: 'http://127.0.0.1:8787', 'content-type': 'application/json' },
    actionBody('waste', { target: 'beef', qty: 2, unit: 'base', reason: 'prep', note }), { execFile });
  assert.equal(res.statusCode, 200);
  assert.equal(invocation[0], 'npm');
  assert.deepEqual(invocation[1], [
    'run', '-s', 'stock', '--', 'waste', 'beef', '2', 'base', 'prep', '--note', note, '--by', 'Alex Smith',
  ]);
  assert.equal(invocation[2].cwd, '/srv/coyote-stock-engine');
  assert.equal(invocation[2].timeout, 15_000);
  assert.equal(invocation[2].shell, false);
  assert.equal(invocation[2].env.MC_STOCK_TEST_ENV, 'preserved');
  assert.equal(Object.prototype.hasOwnProperty.call(invocation[2].env, 'COYOTE_CLAW_DB'), false);
});

test('action route normalizes refusal, successes, timeout, spawn failure and malformed output', async () => {
  async function invoke(error, stderr) {
    return request('POST', '/api/stock/action',
      { ...cookie('operator'), 'content-type': 'application/json' },
      actionBody('count-close', { countId: COUNT_ID }),
      { execFile: (_file, _argv, _options, callback) => callback(error, '', stderr) });
  }

  const refusedError = Object.assign(new Error('exit 1'), { code: 1 });
  const refused = await invoke(refusedError, '[stock] refused — count is already closed\n');
  assert.equal(refused.statusCode, 409);
  assert.deepEqual(JSON.parse(refused.body), { ok: false, reason: 'count is already closed' });

  const opened = await invoke(null, `[stock] opened full count ${OPEN_ID} for 2026-09-11\n`);
  assert.deepEqual(JSON.parse(opened.body), {
    ok: true, line: `[stock] opened full count ${OPEN_ID} for 2026-09-11`, id: OPEN_ID,
  });
  const waste = await invoke(null, `[stock] recorded waste ${WASTE_ID}: 2 movements (-55p) for 2026-09-11\n`);
  assert.deepEqual(JSON.parse(waste.body), {
    ok: true, line: `[stock] recorded waste ${WASTE_ID}: 2 movements (-55p) for 2026-09-11`, id: WASTE_ID,
  });
  const ordinary = await invoke(null, `[stock] closed count ${COUNT_ID}: 2 ingredients, 1 adjustments (50p), settled through none\n`);
  assert.deepEqual(JSON.parse(ordinary.body), {
    ok: true, line: `[stock] closed count ${COUNT_ID}: 2 ingredients, 1 adjustments (50p), settled through none`,
  });

  const timeout = await invoke(Object.assign(new Error('timeout'), { killed: true, signal: 'SIGTERM' }), '');
  assert.equal(timeout.statusCode, 502);
  assert.deepEqual(JSON.parse(timeout.body), { ok: false, line: '' });
  const spawn = await invoke(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }), '');
  assert.equal(spawn.statusCode, 502);
  const spawnWithText = await invoke(Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }), '[stock] refused — decoy\n');
  assert.equal(spawnWithText.statusCode, 502, 'a spawn failure cannot be normalized as an engine refusal');
  const malformed = await invoke(null, '[stock] made something up\nsecond line\n');
  assert.equal(malformed.statusCode, 502);
  assert.deepEqual(JSON.parse(malformed.body), { ok: false, line: '[stock] made something up\nsecond line' });
  const badExit = await invoke(Object.assign(new Error('exit 2'), { code: 2 }), `[stock] voided waste ${WASTE_ID}\n`);
  assert.equal(badExit.statusCode, 502, 'a success-shaped line cannot hide a nonzero exit');
});

test('action route enforces authentication, same Origin, and both permitted session tiers', async () => {
  let calls = 0;
  const dependencies = {
    execFile: (_file, _argv, _options, callback) => {
      calls += 1;
      callback(null, '', `[stock] voided waste ${WASTE_ID}\n`);
    },
  };
  const unauthenticated = await request('POST', '/api/stock/action',
    { 'content-type': 'application/json' }, actionBody('waste-void', { id: WASTE_ID }), dependencies);
  assert.equal(unauthenticated.statusCode, 401);
  const crossOrigin = await request('POST', '/api/stock/action',
    { ...cookie('staff'), origin: 'https://evil.example', 'content-type': 'application/json' },
    actionBody('waste-void', { id: WASTE_ID }), dependencies);
  assert.equal(crossOrigin.statusCode, 403);
  for (const tier of ['staff', 'operator']) {
    const allowed = await request('POST', '/api/stock/action',
      { ...cookie(tier), origin: 'http://127.0.0.1:8787', 'content-type': 'application/json' },
      actionBody('waste-void', { id: WASTE_ID }), dependencies);
    assert.equal(allowed.statusCode, 200, tier);
  }
  assert.equal(calls, 2, 'neither rejected request reached the child process');

  const operatorOnlyApi = await request('GET', '/api/chat-updates', cookie('staff'));
  assert.equal(operatorOnlyApi.statusCode, 401);
  const operatorOnlyPage = await request('GET', '/coyote/revenue', { ...cookie('staff'), accept: 'text/html' });
  assert.equal(operatorOnlyPage.statusCode, 302);
  assert.equal(operatorOnlyPage.headers.location, '/coyote/stock');
});

test('action route rejects invalid bridge input before spawning and contains no SQL write path', async () => {
  let called = false;
  const res = await request('POST', '/api/stock/action',
    { ...cookie('staff'), 'content-type': 'application/json' },
    actionBody('count-settle', { countId: COUNT_ID }),
    { execFile: () => { called = true; } });
  assert.equal(res.statusCode, 400);
  assert.equal(called, false);

  const source = fs.readFileSync(path.join(__dirname, '../mission-control/server.js'), 'utf8');
  const handler = source.slice(source.indexOf('function handleStockAction'), source.indexOf('// Read-only stock context'));
  assert.doesNotMatch(handler, /open(?:Writable)?Database|\.prepare\s*\(|\.exec\s*\(|\.run\s*\(/,
    'the action handler delegates to the engine without opening or writing SQL');
  assert.match(handler, /shell:\s*false/);
  assert.doesNotMatch(handler, /exec\s*\(/, 'user-controlled values are never passed to shell exec');
});

test('getStockContext returns stable sections and mirrors expected-unit arithmetic', () => {
  const queries = [];
  const context = getStockContext({ q(sql, params) {
    queries.push(sql);
    return DATA.safeSelect(db, sql, params);
  } });
  assert.deepEqual(Object.keys(context), ['ok', 'countSettings', 'openCounts', 'wasteEvents', 'ingredients', 'products']);
  assert.equal(context.ok, true);
  assert.deepEqual(context.countSettings.map((row) => row.ingredientId), ['herbs', 'beef'], 'location/walk order is stable');
  assert.equal(context.countSettings[0].lastCountedUnits, null);
  assert.equal(context.countSettings[0].expectedUnits, null);
  assert.equal(context.countSettings[1].lastCountedUnits, 7, 'the latest entered line is exposed for resuming a count');
  assert.equal(context.countSettings[1].expectedUnits, 5.8,
    '(50 counted base + 20 receipt - 10 usage - 2 waste; count-proof adjustment excluded) / 10 base per tray');
  assert.deepEqual(context.openCounts, [{
    id: OPEN_ID, businessDate: '2026-09-11', kind: 'spot', openedBy: 'Sam', openedAt: 500, note: 'service close',
  }]);
  assert.equal(context.wasteEvents.length, 2);
  assert.equal(context.wasteEvents[0].id, 'w-void');
  assert.equal(context.wasteEvents[0].voided, true);
  assert.equal(context.wasteEvents[1].voided, false);
  assert.deepEqual(context.ingredients, [{ id: 'beef', name: 'Beef' }, { id: 'herbs', name: 'Herbs' }]);
  assert.deepEqual(context.products, [{ id: 'sku:MOD-1', name: 'Add bacon' }, { id: 'sku:BURGER', name: 'Burger' }]);
  assert.equal(queries.length, 5);
  assert.ok(queries.every((sql) => /^\s*SELECT\b/i.test(sql)), 'every context query is SELECT-only');
});

test('staff-authenticated context route returns the seeded read-only response', async () => {
  const res = await request('GET', '/api/stock/context', cookie('staff'));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.countSettings.find((row) => row.ingredientId === 'beef').expectedUnits, 5.8);
  assert.equal(body.openCounts[0].id, OPEN_ID);
});

test('context endpoint SQL references exactly the fixture table allowlist', () => {
  const source = String(getStockContext);
  const identifiers = new Set();
  for (const match of source.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)/gi)) identifiers.add(match[1]);
  assert.deepEqual([...identifiers].sort(), [
    'count_lines',
    'ingredient_count_settings',
    'ls_items',
    'products',
    'recipe_lines',
    'stock_counts',
    'stock_movements',
    'sub_items',
    'waste_events',
  ]);
});

test('normalizeStockEngineResult is strict about documented one-line output', () => {
  assert.deepEqual(normalizeStockEngineResult(null,
    `[stock] set beef at kitchen: 2.5 count units = 25 base units\n`), {
    status: 200,
    body: { ok: true, line: '[stock] set beef at kitchen: 2.5 count units = 25 base units' },
  });
  assert.deepEqual(normalizeStockEngineResult(null, ''), { status: 502, body: { ok: false, line: '' } });
  assert.equal(normalizeStockEngineResult(null, '[stock] set beef').status, 502);
});
