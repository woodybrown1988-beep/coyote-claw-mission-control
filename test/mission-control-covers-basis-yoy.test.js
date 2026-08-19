'use strict';
// COVERS BASIS GUARD + spend-per-cover YoY (2026-08-19).
//
// The GuestCenter export splits a timestamp across two columns; the bare "Visit Time" never parsed,
// so every reservation ingested before the fix has visit_at NULL and its distinct same-table
// walk-ins collapsed into one row — understating covers. Repairing the CURRENT window while history
// stays collapsed does not remove that error, it MOVES it into the comparison: measured live, the
// spend/cover delta swung from -3.3% to +4.3% purely on which side had been repaired.
//
// A delta that changes SIGN with the basis is not a delta. So the LEVEL renders (it is true) and the
// DELTA is withheld until both windows are parsed the same way.
//
// THE CLASS, not the instance: any year-on-year comparison whose two sides were produced by
// different pipeline versions must prove they share a basis before it subtracts them.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');
const DATA = require('../mission-control/ui/data.js');
const revPage = require('../mission-control/ui/pages/coyote/reports.js');

const NOW = Date.parse('2026-07-20T09:00:00Z');   // → last full week = 2026-07-13..19; LY = 2025-07-14..20
const q = (db) => (s, p) => DATA.safeSelect(db, s, p);
const range = (a, b) => { const out = []; for (let d = new Date(a + 'T12:00:00Z'); d <= new Date(b + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10)); return out; };

// lyCollapsed = how many LY reservation rows carry visit_at NULL (the un-reparsed marker)
function db_(lyCollapsed) {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sales_day (business_date TEXT PRIMARY KEY, net_sales_pence INT, gross_sales_pence INT, transactions INT, discounts_pence INT, refunds_pence INT, voids_pence INT);
    CREATE TABLE v_sales_day_all (business_date TEXT, net_sales_pence INT, gross_sales_pence INT, transactions INT, premises TEXT);
    CREATE TABLE covers_day (business_date TEXT PRIMARY KEY, reserved_covers INT, walkin_covers INT, total_covers INT);
    CREATE TABLE reservations (reservation_key TEXT PRIMARY KEY, visit_date TEXT, visit_at TEXT, party_size INT, seated_date TEXT);
    CREATE TABLE labour_day (business_date TEXT, actual_minutes INT, actual_cost_pence INT, salaried_cost_pence INT);
    CREATE TABLE sales_receipts_api (receipt_id TEXT, business_date TEXT, net_without_tax_pence INT, cancelled INT, type TEXT, account_profile_code TEXT, table_name TEXT);
    CREATE TABLE sales_receipt_lines_api (receipt_id TEXT, time_of_sale_ms INT, net_without_tax_pence INT, accounting_group TEXT);
    CREATE TABLE sales_channel_map_api (account_profile_code TEXT, channel_label TEXT);
    CREATE TABLE acct_groups_api (code TEXT, name TEXT);
  `);
  const sd = db.prepare('INSERT INTO sales_day VALUES (?,?,?,?,?,?,?)');
  const va = db.prepare('INSERT INTO v_sales_day_all VALUES (?,?,?,?,?)');
  const cd = db.prepare('INSERT INTO covers_day VALUES (?,?,?,?)');
  const rs = db.prepare('INSERT INTO reservations VALUES (?,?,?,?,?)');
  // CURRENT: 500 covers/day @ £5,000 net → spend/cover £10.00
  for (const d of range('2026-06-20', '2026-07-19')) {
    sd.run(d, 500000, 600000, 250, 0, 0, 0); va.run(d, 500000, 600000, 250, 'current');
    cd.run(d, 200, 300, 500);
    rs.run('c' + d, d, d + 'T19:00:00', 4, d + 'T19:05:00');   // current rows carry a time discriminator
  }
  // LY: 400 covers/day @ £5,000 net → spend/cover £12.50 (so a real delta exists to withhold)
  for (const d of range('2025-07-10', '2025-07-24')) {
    sd.run(d, 500000, 600000, 250, 0, 0, 0); va.run(d, 500000, 600000, 250, 'current');
    cd.run(d, 150, 250, 400);
    // AT RISK = no time discriminator AT ALL. visit_at alone is not the test: until 2026-07-23 the
    // export carried seated_date as a timestamp to the second, which discriminates on its own — all
    // 63,915 historical rows are uniquely keyed. Only when BOTH are absent can a row collapse.
    rs.run('l' + d, d, lyCollapsed ? null : d + 'T19:00:00', 4, lyCollapsed ? null : d + 'T19:05:00');
  }
  return db;
}
const render = (db) => revPage.render(revPage.getSection(db, { q: q(db), now: NOW, query: { tab: 'executive' } }), { q: q(db), now: NOW, query: { tab: 'executive' } }).body;
const tile = (body, label) => { const i = body.indexOf(`r-kpi-label">${label}`); if (i < 0) return ''; const t = body.slice(i, i + 420); const n = t.indexOf('r-kpi-label', 20); return n < 0 ? t : t.slice(0, n); };

test('POSITIVE CONTROL: both windows re-parsed → spend/cover shows its YoY delta', () => {
  const body = render(db_(false));
  const spc = tile(body, 'Average spend / cover');
  assert.match(spc, /£10/, 'level renders: £5,000 ÷ 500 covers');
  assert.match(spc, /vs same week LY/, 'and it names the comparison basis');
  assert.match(spc, /20\.0%/, '£10.00 vs LY £12.50 = -20.0%');
  assert.doesNotMatch(spc, /withheld/, 'a like-for-like comparison must NOT be blocked');
});

test('LY still collapsed → BOTH covers YoY and spend/cover YoY are withheld, levels survive', () => {
  const body = render(db_(true));
  const spc = tile(body, 'Average spend / cover');
  const cov = tile(body, 'Covers');
  assert.match(spc, /£10/, 'the LEVEL is true and must still render');
  assert.match(spc, /withheld/, 'the DELTA is withheld');
  assert.match(spc, /not on the same basis/, 'and says why in plain words');
  assert.doesNotMatch(spc, /20\.0%/, 'the mixed-basis delta must never be printed');
  assert.match(cov, /withheld/, 'covers YoY is blocked by the same guard — it was the original lie');
  assert.match(body, /returns by itself once the reservations history is rebuilt/, 'the caption names the unlock');
});

test('the guard counts the un-reparsed rows it found, so the claim is checkable', () => {
  const body = render(db_(true));
  assert.match(body, /at-risk LY rows/);
  assert.doesNotMatch(body, /\(0 at-risk LY rows/, 'it must report the real count, not zero');
});

// --- THE CORRECTION THAT MATTERS MORE THAN THE GUARD (2026-08-19) -------------------------------
// The first version of this guard tested `visit_at IS NULL`, which is true of ALL 65,959 rows, and
// so declared the entire reservations history damaged. It was not. The bare "Visit Time" column
// never parsed — but until 2026-07-23 the export ALSO carried seated_date as a timestamp to the
// second, which discriminates one party from another on its own: all 63,915 historical rows are
// uniquely keyed, zero collapse. The export format then narrowed, the key lost every time component
// at once, and 773 of 2,812 rows collapsed.
//
// An over-broad guard is not the safe direction. It withheld a spend-per-cover YoY that was sound
// all along, and pointed at a full-history rebuild that was never needed.
test('a window with seated_date but no visit_at is NOT at risk — it is uniquely keyed', () => {
  const db = db_(false);
  // Strip visit_at from the LY window, leaving seated_date — the real historical shape.
  db.prepare(`UPDATE reservations SET visit_at = NULL WHERE visit_date < '2026-01-01'`).run();
  const body = render(db);
  const spc = tile(body, 'Average spend / cover');
  assert.doesNotMatch(spc, /withheld/,
    'seated_date alone discriminates — the comparison must NOT be blocked by a missing visit_at');
  assert.match(spc, /vs same week LY/, 'and the delta renders');
});

test('a window with NEITHER discriminator is still caught', () => {
  const db = db_(false);
  db.prepare(`UPDATE reservations SET visit_at = NULL, seated_date = NULL WHERE visit_date < '2026-01-01'`).run();
  const spc = tile(render(db), 'Average spend / cover');
  assert.match(spc, /withheld/, 'no time component at all is the shape that genuinely collapses');
});
