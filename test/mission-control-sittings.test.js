'use strict';
// Revenue Drivers — the SITTINGS panel (2026-07-31): the honest per-PARTY QR-vs-served unit
// (net per sitting by channel) + net-per-cover overall. Negative controls, per the no-board-lies
// canon: no dine_in_sittings → the per-sitting tiles gate ('—' + the backfill hint, no £); no covers
// → the per-cover tile gates (OpenTable named) while the sittings tiles still render.

const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const reports = require('../mission-control/ui/pages/coyote/reports.js');

const NOW = 1783000000000;
const APIMAX = '2026-07-30';
const shift = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

function baseDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sales_receipts_api (receipt_id TEXT PRIMARY KEY, business_date TEXT, type TEXT, cancelled INTEGER, account_profile_code TEXT, net_without_tax_pence INTEGER, updated_at INTEGER);
    CREATE TABLE sales_channel_map_api (account_profile_code TEXT PRIMARY KEY, profile_name TEXT, delivery_mode TEXT, channel_label TEXT, first_seen INTEGER, updated_at INTEGER, label_source TEXT);
  `);
  // one API receipt so rv2.maxApiDate = APIMAX (the drivers window anchor)
  db.prepare(`INSERT INTO sales_receipts_api VALUES ('R1', ?, 'SALE', 0, 'LOCAL', 3000, 1)`).run(APIMAX);
  db.prepare(`INSERT INTO sales_channel_map_api VALUES ('LOCAL','Local','NONE','EAT IN',1,1,'operator'),('storekit_orderpay','SK','NONE','STOREKIT ORDER & PAY',1,1,'operator')`).run();
  return db;
}
function addSittings(db) {
  db.exec(`CREATE TABLE dine_in_sittings (business_date TEXT, sitting_id TEXT, channel TEXT, table_name TEXT, receipt_count INTEGER, net_pence INTEGER, first_order_ms INTEGER, last_order_ms INTEGER, updated_at INTEGER, PRIMARY KEY (business_date, sitting_id));`);
  const ins = db.prepare(`INSERT INTO dine_in_sittings VALUES (?,?,?,?,?,?,?,?,1)`);
  const d = shift(APIMAX, -5); // inside the 28d window
  ins.run(d, 't1#1', 'QR', 'Table 1', 1, 3600, 1, 1);      // QR £36
  ins.run(d, 't2#1', 'QR', 'Table 2', 1, 3400, 1, 1);      // QR £34  → net/QR sitting = £35.00
  ins.run(d, 't3#1', 'served', 'Table 3', 1, 3000, 1, 1);  // served £30 → net/served sitting = £30.00
  ins.run(d, 't4#1', 'mixed', 'Table 4', 2, 5000, 1, 1);   // mixed (both channels)
}
function addCovers(db) {
  db.exec(`CREATE TABLE covers_day (business_date TEXT PRIMARY KEY, total_covers INTEGER, updated_at INTEGER);`);
  db.prepare(`INSERT INTO covers_day VALUES (?, 300, 1)`).run(shift(APIMAX, -5));
}
function render(db) {
  const ctx = { q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, query: { tab: 'drivers' } };
  return reports.render(reports.getSection(db, ctx), ctx).body;
}
function tileOf(body, label) {
  const i = body.indexOf(`r-kpi-label">${label}`); // label prefix (e.g. 'Net / cover' → 'Net / cover (overall)')
  return i < 0 ? '' : body.slice(i, i + 320);
}

test('SITTINGS gate (negative control): no dine_in_sittings → Net/QR sitting is "—" with the backfill hint, no £', () => {
  const body = render(baseDb());
  const tile = tileOf(body, 'Net / QR sitting');
  assert.ok(tile, 'the Net / QR sitting tile is present even when gated');
  assert.match(tile, /—/, 'gated value is an em-dash');
  assert.match(tile, /sittings-backfill/, 'names the unlock action');
  assert.doesNotMatch(tile, /£\d/, 'no £-figure from an absent table (no-board-lies)');
});

test('SITTINGS render: per-sitting by channel renders real £; per-cover gates when no OpenTable covers', () => {
  const db = baseDb();
  addSittings(db); // NO covers_day
  const body = render(db);

  const qr = tileOf(body, 'Net / QR sitting');
  assert.match(qr, /£35\.00/, 'net/QR sitting = (3600+3400)/2 = £35.00');
  assert.match(qr, /2 QR sittings/);
  const served = tileOf(body, 'Net / served sitting');
  assert.match(served, /£30\.00/, 'net/served sitting = 3000/1 = £30.00');

  // per-cover gates honestly (no covers_day) — but the sittings tiles above STILL render
  const cover = tileOf(body, 'Net / cover');
  assert.match(cover, /—/);
  assert.match(cover, /no covers in the window \(OpenTable\)/);
  assert.doesNotMatch(cover, /£\d/, 'per-cover shows no £ without OpenTable covers — POS guest-count is never covers');

  assert.match(body, /honest QR-vs-served/i, 'the panel names the honest unit');
  assert.match(body, /MIXED/, 'mixed sittings are surfaced, not hidden or forced into a channel');
});

test('SITTINGS + covers: per-cover renders overall (dine-in net ÷ OpenTable covers)', () => {
  const db = baseDb();
  addSittings(db);
  addCovers(db); // 300 covers
  const body = render(db);
  const cover = tileOf(body, 'Net / cover');
  // total dine-in net = 3600+3400+3000+5000 = 15000 pence ÷ 300 covers = 50 pence = £0.50
  assert.match(cover, /£0\.50/, 'net/cover = 15000p ÷ 300 covers = £0.50');
  assert.match(cover, /300 OpenTable covers/);
  assert.match(cover, /not channel-split/, 'per-cover is honestly labelled overall, not by channel');
});
