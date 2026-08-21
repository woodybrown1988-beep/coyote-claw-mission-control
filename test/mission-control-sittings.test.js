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
    CREATE TABLE sales_receipts_api (receipt_id TEXT PRIMARY KEY, business_date TEXT, type TEXT, cancelled INTEGER, account_profile_code TEXT, table_name TEXT, net_without_tax_pence INTEGER, updated_at INTEGER);
    CREATE TABLE sales_channel_map_api (account_profile_code TEXT PRIMARY KEY, profile_name TEXT, delivery_mode TEXT, channel_label TEXT, first_seen INTEGER, updated_at INTEGER, label_source TEXT);
  `);
  db.prepare(`INSERT INTO sales_channel_map_api VALUES ('LOCAL','Local','NONE','EAT IN',1,1,'operator'),('storekit_orderpay','SK','NONE','STOREKIT ORDER & PAY',1,1,'operator'),('TAKEAWAY','TA','TAKE_AWAY',NULL,1,1,NULL)`).run();
  // FULL dine-in receipts (all tables) = the per-cover numerator: EAT IN 3000 + STOREKIT 3000 + EAT IN 6000
  // = 12000. R1 is dated APIMAX so rv2.maxApiDate = APIMAX (the drivers window anchor). The takeaway
  // receipt (9999) must be EXCLUDED from dine-in net. Deliberately ≠ the sittings subset net so the test
  // guards the exact bug: per-cover must use RECEIPTS dine-in net, never dine_in_sittings.totNet.
  // table_name matters since the capture gate (2026-08-19): a sitting can only form from a receipt on
  // a PHYSICAL table, so these dine-in receipts sit on numbered tables — a REPRESENTATIVE sample, which
  // is what lets the per-sitting tiles render below. The thin-sample case is pinned separately in
  // mission-control-sittings-capture.test.js and by the withholding test at the end of this file.
  const ins = db.prepare(`INSERT INTO sales_receipts_api VALUES (?, ?, 'SALE', 0, ?, ?, ?, 1)`);
  ins.run('R1', APIMAX, 'LOCAL', '27 Bank Street, Table 3', 3000);
  ins.run('R2', shift(APIMAX, -3), 'storekit_orderpay', '27 Bank Street, Table 1', 3000);
  ins.run('R3', shift(APIMAX, -3), 'LOCAL', '27 Bank Street, Table 5', 6000);
  ins.run('R9', APIMAX, 'TAKEAWAY', 'Order 12', 9999); // takeaway — NOT dine-in, excluded from net/cover
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
// Covers land on the days that actually carry the dine-in receipts (APIMAX and APIMAX-3), 150 each
// → 300 total, the figure the assertions below are written against.
//
// They used to sit on APIMAX-5, a day with no receipts at all — which made the per-cover ratio a
// numerator and denominator from two disjoint sets of days. It still produced £0.40 because both
// sides were summed over one nominal window, and that is exactly the defect the COVERS WINDOW
// GUARD (2026-08-21) closes: per-cover is now taken over the days holding BOTH feeds, so a fixture
// with no overlap correctly gates. Realigning the fixture keeps this test's own subject — that the
// numerator is FULL dine-in receipts net, not the sittings subset — testable.
function addCovers(db) {
  db.exec(`CREATE TABLE covers_day (business_date TEXT PRIMARY KEY, total_covers INTEGER, updated_at INTEGER);`);
  const ins = db.prepare(`INSERT INTO covers_day VALUES (?, 150, 1)`);
  ins.run(APIMAX); ins.run(shift(APIMAX, -3));
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

test('SITTINGS + covers: per-cover = FULL dine-in receipts net ÷ covers (NOT the sittings subset)', () => {
  const db = baseDb();
  addSittings(db); // sittings subset net = 3600+3400+3000+5000 = 15000 → the BUG would show £0.50
  addCovers(db);   // 300 covers
  const body = render(db);
  const cover = tileOf(body, 'Net / cover');
  // CORRECT: full dine-in RECEIPTS net = 3000+3000+6000 = 12000 (takeaway 9999 excluded) ÷ 300 = £0.40.
  // The regression guard: £0.40 (receipts) ≠ £0.50 (sittings subset) — proves the numerator is full net.
  assert.match(cover, /£0\.40/, 'net/cover = full dine-in net 12000p ÷ 300 covers = £0.40');
  assert.doesNotMatch(cover, /£0\.50/, 'must NOT divide the physical-table sittings subset by all covers');
  assert.match(cover, /300 OpenTable covers/);
  assert.match(cover, /not channel-split/, 'per-cover is honestly labelled overall, not by channel');
});

// --- CAPTURE GATE (2026-08-19): the same panel must WITHHOLD when the sittings sample is too thin.
// The live defect: QR was 19% captured and served 29%, yet both tiles showed a confident £ figure and
// the two were read against each other. A number on a KPI tile gets read whatever the caption says,
// so the value itself is withheld — not annotated.
test('CAPTURE gate: a thin, unevenly-sampled window withholds the per-sitting £ and says why', () => {
  const db = baseDb();
  // Push most dine-in net onto receipts carrying NO location at all. (Until 2026-08-19 this test
  // used "Order N" — but a closed tab is now clusterable as one party, so the unclusterable case
  // is a receipt with no table and no tab. The gate must still fire for whatever CANNOT be formed
  // into a sitting, whatever that turns out to be next.)
  db.prepare(`INSERT INTO sales_receipts_api VALUES ('R20', ?, 'SALE', 0, 'LOCAL', '', 90000, 1)`).run(shift(APIMAX, -2));
  db.prepare(`INSERT INTO sales_receipts_api VALUES ('R21', ?, 'SALE', 0, 'storekit_orderpay', NULL, 90000, 1)`).run(shift(APIMAX, -2));
  addSittings(db); addCovers(db);
  const body = render(db);
  // tileOf() returns a fixed slice that can spill into the NEXT tile, and the neighbouring
  // per-cover tile legitimately prints a £ — so cut each tile at the following label.
  const justTile = (label) => { const t = tileOf(body, label); const nxt = t.indexOf('r-kpi-label', 20); return nxt < 0 ? t : t.slice(0, nxt); };
  const qr = justTile('Net / QR sitting');
  const served = justTile('Net / served sitting');
  assert.doesNotMatch(qr, /£\d/, 'a thin sample must not print a confident per-QR-sitting £');
  assert.doesNotMatch(served, /£\d/, 'a thin sample must not print a confident per-served-sitting £');
  assert.match(qr, /withheld/, 'the tile says it is withheld');
  assert.match(body, /numbered table/, 'the caption explains the capture limit in plain words');
  assert.match(body, /tables are assigned on the POS/, 'and names the operational fix, not a data fix');
});
