'use strict';

process.env.MC_AUTH_SECRET = 'stock-page-operator-secret';
process.env.MC_STAFF_SECRET = 'stock-page-staff-secret';
process.env.MC_SESSION_KEY = 'stock-page-session-key-secret';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DB_PATH = path.join(os.tmpdir(), `mc-stock-page-${process.pid}-${crypto.randomUUID()}.db`);
new sqlite.DatabaseSync(DB_PATH).close();
process.env.COYOTE_CLAW_DB = DB_PATH;

const AUTH = require('../mission-control/ui/auth.js');
const S = require('../mission-control/ui/shared.js');
const { getSection, render, jsonForScript, defaultCountKind } = require('../mission-control/ui/pages/coyote/stock.js');
const page = require('../mission-control/ui/pages/coyote/stock.js');
const { handleRequest } = require('../mission-control/server.js');

const COUNT_ID = '123e4567-e89b-12d3-a456-426614174000';
const WASTE_ID = '223e4567-e89b-12d3-a456-426614174001';
const MODEL = {
  ok: true,
  countSettings: [
    { ingredientId: 'beef', name: 'Beef', unitOfMeasure: 'g', location: 'kitchen', walkOrder: 2, countUnit: 'tray', countUnitQty: 1000, lastCountedUnits: 3, expectedUnits: 2.5 },
    { ingredientId: 'herbs', name: 'Herbs', unitOfMeasure: 'g', location: 'walk-in', walkOrder: 1, countUnit: 'bag', countUnitQty: 250, lastCountedUnits: null, expectedUnits: null },
  ],
  openCounts: [{ id: COUNT_ID, businessDate: '2026-09-11', kind: 'spot', openedBy: 'Previous person' }],
  wasteEvents: [
    { id: WASTE_ID, businessDate: '2026-09-11', target: 'beef', name: 'Beef', qty: 1.5, unit: 'base', reason: 'prep', note: 'trim', enteredBy: 'Previous person', voided: false },
  ],
  ingredients: [{ id: 'beef', name: 'Beef' }, { id: 'herbs', name: 'Herbs' }],
  products: [{ id: 'sku:BURGER', name: 'Burger' }],
};

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch (_) { /* already absent */ }
  }
});

function makeResponse() {
  const response = { statusCode: 0, headers: {}, body: '' };
  response.setHeader = (key, value) => { response.headers[String(key).toLowerCase()] = value; };
  response.getHeader = (key) => response.headers[String(key).toLowerCase()];
  response.writeHead = (status, headers) => {
    response.statusCode = status;
    for (const [key, value] of Object.entries(headers || {})) response.headers[String(key).toLowerCase()] = value;
    return response;
  };
  response.done = new Promise((resolve) => { response.finish = resolve; });
  response.end = (chunk) => { if (chunk != null) response.body += chunk; response.finish(response); };
  return response;
}

async function getAs(tier) {
  const request = Readable.from(['']);
  request.method = 'GET';
  request.url = '/coyote/stock';
  request.headers = {
    host: '127.0.0.1:8787',
    accept: 'text/html',
    cookie: `${AUTH.COOKIE}=${AUTH.issueToken(Date.now(), tier)}`,
  };
  const response = makeResponse();
  handleRequest(request, response);
  return response.done;
}

test('registered stock page renders successfully for both staff and operator sessions', async () => {
  for (const tier of ['staff', 'operator']) {
    const response = await getAs(tier);
    assert.equal(response.statusCode, 200, tier);
    assert.match(response.body, /<title>Coyote Claw · Mission Control · Stock count<\/title>/);
    assert.match(response.body, /id="stock-identity"/);
  }
});

test('getSection consumes only the stock context interface and has a concrete fallback', () => {
  let calls = 0;
  const section = getSection(null, {
    stockContext() { calls += 1; return MODEL; },
    q() { throw new Error('the stock page must not issue its own query'); },
  });
  assert.equal(calls, 1);
  assert.deepEqual(section.openCounts, [{ id: COUNT_ID, businessDate: '2026-09-11', kind: 'spot' }]);
  assert.equal(section.countSettings[0].expectedUnits, 2.5);
  assert.equal(Object.prototype.hasOwnProperty.call(section.openCounts[0], 'openedBy'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(section.wasteEvents[0], 'enteredBy'), false);
  assert.deepEqual(getSection(null, {}), {
    ok: false, countSettings: [], openCounts: [], wasteEvents: [], ingredients: [], products: [],
  });
  assert.deepEqual(getSection(null, { stockContext() { throw new Error('offline'); } }), {
    ok: false, countSettings: [], openCounts: [], wasteEvents: [], ingredients: [], products: [],
  });
});

test('render includes identity/location, walk-order count list, and waste capture from supplied context', () => {
  const output = render(MODEL);
  assert.equal(output.stamp, 'live stock context');
  for (const id of ['stock-identity', 'stock-count-list', 'stock-waste']) assert.match(output.body, new RegExp(`id="${id}"`));
  assert.match(output.body, /data-location-choice="kitchen"/);
  assert.match(output.body, /Beef/);
  assert.match(output.body, /tray · 1000 g supplied per count unit/);
  assert.match(output.body, /Last <b>3<\/b>/);
  assert.match(output.body, /Expected <b>2\.5<\/b>/);
  assert.match(output.body, /value="" placeholder="blank"/);
  assert.match(output.body, /data-fraction="0\.25">¼/);
  assert.match(output.body, /Reconfirm this discrepancy/);
  assert.match(output.body, /data-waste-target="sku:BURGER"/);
  for (const reason of ['prep', 'spoiled', 'dropped', 'over-made', 'returned', 'other']) assert.match(output.body, new RegExp(`data-waste-reason="${reason}"`));
  assert.match(output.body, /Undo this waste entry/);
  assert.doesNotMatch(output.body, /Previous person/, 'prior counter attribution is neither rendered nor embedded');
  const fallback = render(null);
  assert.equal(fallback.stamp, 'stock context unavailable');
  assert.match(fallback.body, /Stock context is unavailable/);
});

test('remembered-name field is device-only and the emitted inline client script parses', () => {
  const output = render(MODEL);
  assert.match(output.body, /id="stock-counter-name" data-counter-name/);
  const match = output.body.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'stock page emits its inline client script');
  const script = match[1];
  assert.match(script, /NAME_KEY='coyote\.stock\.counterName'/);
  assert.match(script, /localStorage\.getItem\(NAME_KEY\)/);
  assert.match(script, /localStorage\.setItem\(NAME_KEY,this\.value\)/);
  assert.doesNotThrow(() => new Function(script));
});

test('jsonForScript preserves data while preventing script-tag and line-separator breakout', () => {
  const serialized = jsonForScript({ name: '</script>', separator: '\u2028\u2029' });
  assert.equal(serialized, '{"name":"\\u003c/script>","separator":"\\u2028\\u2029"}');
  assert.deepEqual(new Function(`return ${serialized}`)(), { name: '</script>', separator: '\u2028\u2029' });
});

test('defaultCountKind maps Sundays to full and weekdays or invalid dates to spot', () => {
  assert.equal(defaultCountKind('2026-09-13'), 'full');
  assert.equal(defaultCountKind('2026-09-11'), 'spot');
  assert.equal(defaultCountKind('2026-02-30'), 'spot');
  assert.equal(defaultCountKind(''), 'spot');
});

test('static POST inspection pins the one endpoint and exact five-operation allowlist', () => {
  const script = render(MODEL).body.match(/<script>([\s\S]*?)<\/script>/)[1];
  const postLines = script.split('\n').filter((line) => /method:'POST'/.test(line));
  assert.equal(postLines.length, 1, 'one centralized scripted POST');
  for (const line of postLines) assert.match(line, /fetch\('\/api\/stock\/action'/);
  const operations = [...script.matchAll(/postAction\('([^']+)'/g)].map((match) => match[1]).sort();
  assert.deepEqual([...new Set(operations)], ['count-close', 'count-open', 'count-set', 'waste', 'waste-void']);
  assert.match(script, /var OPS=\['count-open','count-set','count-close','waste','waste-void'\]/);
});

test('contract, server registration, route, nav label, and Reports ordering are pinned', () => {
  assert.deepEqual(
    { key: page.key, route: page.route, workspace: page.workspace, title: page.title },
    { key: 'stock', route: '/coyote/stock', workspace: 'coyote', title: 'Stock count' },
  );
  const serverSource = fs.readFileSync(path.join(__dirname, '../mission-control/server.js'), 'utf8');
  assert.match(serverSource, /require\('\.\/ui\/pages\/coyote\/inventory\.js'\),\n  require\('\.\/ui\/pages\/coyote\/stock\.js'\),/);
  const reports = S.WORKSPACES.find((workspace) => workspace.key === 'coyote').groups.find((group) => group.group === 'Reports');
  const keys = reports.items.map((item) => item.key);
  assert.equal(reports.items.find((item) => item.key === 'stock').label, 'Stock count');
  assert.equal(reports.items.find((item) => item.key === 'stock').route, '/coyote/stock');
  assert.equal(keys.indexOf('stock'), keys.indexOf('inventory') + 1);
  assert.deepEqual(keys, ['revenue', 'labour', 'costs', 'reservations', 'operations', 'inventory', 'stock', 'customer-growth', 'kitchen-safety', 'report-library', 'files']);
});

test('golden isolation: existing page sources and pre-existing sidebar output are unchanged after removing the one intentional nav link', () => {
  function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
      ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
  }
  const pagesRoot = path.join(__dirname, '../mission-control/ui/pages');
  const files = walk(pagesRoot).filter((file) => file.endsWith('.js') && file !== path.join(pagesRoot, 'coyote/stock.js')).sort();
  const sourceHash = crypto.createHash('sha256');
  for (const file of files) sourceHash.update(`${path.relative(path.join(__dirname, '..'), file)}\0`).update(fs.readFileSync(file)).update('\0');
  assert.equal(files.length, 35);
  assert.equal(sourceHash.digest('hex'), 'b59a13edbf7dbb739eb82d55a575d83abab436befe60fd19abf772903c986aa6');

  const sidebarGoldens = {
    overview: '49d6a329bab14c379b8dc821477fc89b1eecabd9a4ba80431ff9c92511b2cded',
    revenue: 'e64f3a84c3bbbbbe386f1ea66f22aaf2491a26bf56e2eba33fbcb3ea516a006c',
    labour: '0bebfd1eec5ef34b6fec1ca57689678c24fce6bbde502bc2b67d965917b78cae',
    costs: 'e31a06a63c9650012e22bebdc6abc29d051551ddfbb24f214f1016bff1787462',
    reservations: 'fc80db62bfc7efc9e0179874bcab7384eab88b682d0bdc8a8d476718106ca7e7',
    operations: 'fd15a9dd9322e77f50172f03645f401be611d3714f6cd7e41eca89403a14b78b',
    inventory: '5588eaf5409f3aeb4f887624feb674328cb8cc4a68048f9aa0af458d11d868ec',
    'customer-growth': 'd91fd9fd20cfe418d5e4693bbd71dc460a9d05e1454b7108cd05ab584d0bea70',
    'kitchen-safety': '5fad983383736f203def1c84c992ec549edb88990523e0c052447f328de573e9',
    'report-library': 'd5d231281b78ecb5ef2730ed2300f879b4f69ce3d1a9a2739adf81b010994ee7',
    files: '7e8ed7a51cdd063a3e7c68a8d958ba76454a9095c60d85c3462b69c289d9add2',
  };
  for (const [key, expected] of Object.entries(sidebarGoldens)) {
    const withoutStock = S.renderSidebar(key, {}, []).replace(/<a class="nav-item" href="\/coyote\/stock">[\s\S]*?Stock count<\/a>/, '');
    assert.equal(crypto.createHash('sha256').update(withoutStock).digest('hex'), expected, key);
  }
  const allExistingSidebars = crypto.createHash('sha256');
  let sidebarCount = 0;
  for (const workspace of S.WORKSPACES) for (const group of workspace.groups) for (const item of group.items) {
    if (item.key === 'stock') continue;
    const output = S.renderSidebar(item.key, {}, []).replace(/<a class="nav-item" href="\/coyote\/stock">[\s\S]*?Stock count<\/a>/, '');
    allExistingSidebars.update(`${item.key}\0`).update(output).update('\0');
    sidebarCount += 1;
  }
  assert.equal(sidebarCount, 29);
  assert.equal(allExistingSidebars.digest('hex'), '602c6eae9f4da09df5d2fccfdde879b4177b4b18fe9b3a332d81b7dd3c3fe2b5');
});
