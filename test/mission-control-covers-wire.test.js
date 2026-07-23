'use strict';
// Phase 2 PR1 — covers wired off the corrected covers_day / reservations (OpenTable, live).
// Pins: Reservations Centre covers panels (Executive KPIs + 13-week chart, Behaviour party/lead,
// Capacity turn) light with REAL data; the Revenue covers-denominator (Covers, Spend/cover,
// Covers/transaction sanity metric) lights; every covers panel captions the reserved/walk-in split;
// and — the negative control — with NO covers rows every panel falls back to its honest gate-state.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');
const DATA = require('../mission-control/ui/data.js');
const resPage = require('../mission-control/ui/pages/coyote/reservations.js');
const revPage = require('../mission-control/ui/pages/coyote/reports.js');

const NOW = Date.parse('2026-07-23T09:00:00Z');
const q = (db) => (s, p) => DATA.safeSelect(db, s, p);

// covers_day schema (mirrors src/schema.sql) + reservations (aggregate columns only).
function coversDb(seed = true) {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE covers_day (business_date TEXT PRIMARY KEY, reservations INT, seated_reservations INT,
      noshow_reservations INT, cancelled_reservations INT, booked_reservations INT, seated_covers INT,
      noshow_covers INT, cancelled_covers INT, reserved_covers INT, walkin_covers INT, total_covers INT,
      avg_party REAL, avg_duration_min REAL, updated_at INT);
    CREATE TABLE reservations (reservation_key TEXT PRIMARY KEY, visit_date TEXT, party_size INT,
      status TEXT, source TEXT, created_lead_days REAL, actual_duration_min REAL);
    CREATE TABLE reservations_ingest_runs (file_sha TEXT PRIMARY KEY, file_name TEXT, source TEXT,
      status TEXT, rows_written INT, date_from TEXT, date_to TEXT, detail TEXT, ingested_at INT);
  `);
  if (!seed) return db;
  const cd = db.prepare(`INSERT INTO covers_day (business_date, seated_covers, reserved_covers, walkin_covers, total_covers, avg_party, avg_duration_min, updated_at) VALUES (?,?,?,?,?,?,?,0)`);
  cd.run('2026-07-22', 300, 120, 180, 300, 2.5, 95);   // both in the trailing-28d window (max = 07-22)
  cd.run('2026-07-21', 200, 80, 120, 200, 2.0, 90);
  const rv = db.prepare(`INSERT INTO reservations (reservation_key, visit_date, party_size, status, source, created_lead_days, actual_duration_min) VALUES (?,?,?,?,?,?,?)`);
  rv.run('a', '2026-07-20', 2, 'finished', 'OpenTable', 0, 90);
  rv.run('b', '2026-07-20', 4, 'finished', 'OpenTable', 3, 120);
  rv.run('c', '2026-07-19', 2, 'seated', 'Walk-in', 10, 100);
  return db;
}

test('Reservations Executive — covers KPIs + reserved/walk-in split caption are REAL', () => {
  const db = coversDb();
  const ctx = { q: q(db), now: NOW, query: { tab: 'executive' } };
  const body = resPage.render(resPage.getSection(db, ctx), ctx).body;
  assert.match(body, /Seated dine-in covers · 28d/);
  assert.match(body, />500</, 'total covers 300+200 = 500');
  assert.match(body, /40\.0%/, 'reserved share 200/500');
  assert.match(body, /60\.0%/, 'walk-in share 300/500');
  assert.match(body, /never read booked\/reserved covers as total/, 'the split caption is present');
  assert.match(body, /200 reserved \(40\.0%\) \+ 300 walk-in \(60\.0%\) = 500 seated covers/);
  assert.match(body, /Ready/, 'the readiness probe (reservations table) now reads Ready');
  assert.doesNotMatch(body, /NaN|undefined/);
});

test('Reservations Behaviour + Capacity — party-size, lead-time and turn light from the reservations grain', () => {
  const db = coversDb();
  const beh = resPage.render(resPage.getSection(db, { q: q(db), now: NOW, query: { tab: 'behaviour' } }), { q: q(db), now: NOW, query: { tab: 'behaviour' } }).body;
  assert.match(beh, /Party of 2/); assert.match(beh, /Party of 4/);
  assert.match(beh, /4 covers/, 'party-size mix shows real covers (party-of-4 = 4 covers)');
  assert.match(beh, /Same day \(walk-in\/late\)/, 'lead-time bucket from created_lead_days');
  assert.match(beh, /seated covers by booked party size/, 'the party panel is wired (not the donut gate)');
  // the identity-dependent behaviour panels (source, funnel, no-show) legitimately STAY gated
  const cap = resPage.render(resPage.getSection(db, { q: q(db), now: NOW, query: { tab: 'capacity' } }), { q: q(db), now: NOW, query: { tab: 'capacity' } }).body;
  assert.match(cap, /Table-turn performance/);
  assert.match(cap, /95 min/, 'party-of-2 avg actual duration = (90+100)/2');
  assert.match(cap, /120 min/, 'party-of-4 avg actual duration');
});

test('NEGATIVE CONTROL — with covers_day present but EMPTY, every covers panel falls back to its gate-state', () => {
  const db = coversDb(false);
  const ctx = { q: q(db), now: NOW, query: { tab: 'executive' } };
  const body = resPage.render(resPage.getSection(db, ctx), ctx).body;
  assert.match(body, /no feed — OpenTable weekly export/, 'the four cover tiles revert to no-feed');
  assert.match(body, /not wired/, 'the 13-week chart reverts to the gate-state');
  assert.doesNotMatch(body, /Seated dine-in covers · 28d/, 'no live cover KPI when there are no rows');
});

// ---- Revenue covers-denominator ----

function revenueDb(covers = true) {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sales_day (business_date TEXT PRIMARY KEY, net_sales_pence INT, gross_sales_pence INT, transactions INT, discounts_pence INT, refunds_pence INT, voids_pence INT);
    CREATE TABLE v_sales_day_all (business_date TEXT, net_sales_pence INT, gross_sales_pence INT, transactions INT, premises TEXT);
    CREATE TABLE covers_day (business_date TEXT PRIMARY KEY, reserved_covers INT, walkin_covers INT, total_covers INT);
    CREATE TABLE labour_day (business_date TEXT, actual_minutes INT, actual_cost_pence INT, salaried_cost_pence INT);
    CREATE TABLE sales_receipts_api (receipt_id TEXT, business_date TEXT, net_without_tax_pence INT, cancelled INT, type TEXT, account_profile_code TEXT);
    CREATE TABLE sales_receipt_lines_api (receipt_id TEXT, time_of_sale_ms INT, net_without_tax_pence INT, accounting_group TEXT);
    CREATE TABLE sales_channel_map_api (account_profile_code TEXT, channel_label TEXT);
    CREATE TABLE acct_groups_api (code TEXT, name TEXT);
  `);
  const days = [];
  for (let i = 0; i < 30; i++) { const d = new Date(Date.UTC(2026, 6, 19)); d.setUTCDate(d.getUTCDate() - i); days.push(d.toISOString().slice(0, 10)); }
  const sd = db.prepare('INSERT INTO sales_day VALUES (?,?,?,?,?,?,?)');
  const va = db.prepare('INSERT INTO v_sales_day_all VALUES (?,?,?,?,?)');
  const cd = db.prepare('INSERT INTO covers_day VALUES (?,?,?,?)');
  const rc = db.prepare('INSERT INTO sales_receipts_api VALUES (?,?,?,?,?,?)');
  for (const d of days) {
    sd.run(d, 500000, 600000, 230, 5000, 0, 0);
    va.run(d, 500000, 600000, 230, 'current');
    rc.run('r' + d, d, 2000, 0, 'SALE', '');
    if (covers) cd.run(d, 180, 260, 440);   // 440 covers/day, 230 txns → covers/txn ≈ 1.91
  }
  return db;
}

test('Revenue Executive — Covers, Spend/cover, and the reserved/walk-in + covers-per-transaction captions are REAL', () => {
  const db = revenueDb();
  const ctx = { q: q(db), now: Date.parse('2026-07-20T09:00:00Z'), query: { tab: 'executive' } };
  const body = revPage.render(revPage.getSection(db, ctx), ctx).body;
  assert.match(body, /r-kpi-label">Covers<\/div><div class="r-kpi-value">3,080/, 'week covers = 440 × 7 = 3,080');
  assert.match(body, /Average spend \/ cover/);
  assert.match(body, /Lightspeed net ÷ OpenTable covers/);
  assert.match(body, /reserved \+ /); assert.match(body, /walk-in — booked covers are NEVER read as total/);
  assert.match(body, /covers\/transaction 1\.91 \(sanity ~1\.9–2\.0; a material drift is a data finding, not a KPI\)/);
  assert.doesNotMatch(body, /NaN|undefined/);
});

test('Revenue Drivers — Covers/transaction sanity tile + per-day scorecard covers/spend-per-cover are REAL', () => {
  const db = revenueDb();
  const ctx = { q: q(db), now: Date.parse('2026-07-20T09:00:00Z'), query: { tab: 'drivers' } };
  const body = revPage.render(revPage.getSection(db, ctx), ctx).body;
  assert.match(body, /Covers \/ transaction<\/div><div class="r-kpi-value">1\.91/);
  assert.match(body, /sanity ~1\.9–2\.0 \(drift = data finding, not a KPI\)/);
  assert.match(body, /spend\/cover = net ÷ covers/, 'the scorecard note names the derivation');
});

test('Revenue NEGATIVE CONTROL — no covers rows → tiles read "—", never a POS-guest-count number', () => {
  const db = revenueDb(false);
  const ctx = { q: q(db), now: Date.parse('2026-07-20T09:00:00Z'), query: { tab: 'executive' } };
  const body = revPage.render(revPage.getSection(db, ctx), ctx).body;
  assert.match(body, /no covers this week \(OpenTable\)/, 'the Covers tile is honest about no covers');
  assert.doesNotMatch(body, /covers\/transaction \d/, 'no sanity ratio without covers');
});

// ---- Phase 2 PR2b: OpenTable £/cover cross-check on the Reconciliation tab ----

function reconDb(revenue = true) {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sales_receipts_api (receipt_id TEXT, business_date TEXT, net_without_tax_pence INT, cancelled INT, type TEXT, account_profile_code TEXT);
    CREATE TABLE v_sales_day_all (business_date TEXT, net_sales_pence INT, transactions INT, premises TEXT);
    CREATE TABLE covers_day (business_date TEXT PRIMARY KEY, seated_covers INT, revenue_net_pence INT, revenue_gross_pence INT, revenue_covers INT);
    CREATE TABLE sales_payments_api (business_date TEXT, code TEXT, net_with_tax_pence INT, tip_pence INT, surcharge_pence INT);
    CREATE TABLE sales_day (business_date TEXT, gross_sales_pence INT, discounts_pence INT, comps_pence INT, refunds_pence INT, voids_pence INT, service_charges_pence INT, net_sales_pence INT, taxes_pence INT);
  `);
  db.prepare(`INSERT INTO sales_receipts_api VALUES ('r1','2026-07-12',2000,0,'SALE','')`).run();
  const va = db.prepare('INSERT INTO v_sales_day_all VALUES (?,?,?,?)');
  const cd = db.prepare('INSERT INTO covers_day VALUES (?,?,?,?,?)');
  va.run('2026-07-12', 120000, 60, 'current'); va.run('2026-07-11', 100000, 50, 'current');
  if (revenue) {
    cd.run('2026-07-12', 55, 100000, 120000, 50);  // £1000 net / 50 covers
    cd.run('2026-07-11', 44, 80000, 96000, 40);     // £800 net / 40 covers
  } else {
    cd.run('2026-07-12', 55, 0, 0, 0);              // seated but NO POS revenue
  }
  return db;
}

test('Reconciliation — OpenTable £/cover cross-check: £/cover, OT/LS ratio, "cross-check not canon" framing', () => {
  const db = reconDb();
  const ctx = { q: q(db), now: Date.parse('2026-07-13T09:00:00Z'), query: { tab: 'reconciliation' } };
  const body = revPage.render(revPage.getSection(db, ctx), ctx).body;
  assert.match(body, /OpenTable £\/cover cross-check/);
  assert.match(body, /£20\.00/, '£/cover = (100000+80000) ÷ (50+40) = £20.00');
  assert.match(body, /81\.8%/, 'OT ÷ LS = 180000 ÷ 220000');
  assert.match(body, /91% of seated covers/, 'coverage 90/99 seated');
  assert.match(body, /Lightspeed stays the canon/, 'canon framing');
  assert.match(body, /CROSS-CHECK, not a correction/);
  assert.doesNotMatch(body, /NaN|undefined/);
});

test('Reconciliation NEGATIVE CONTROL — no OpenTable revenue → honest empty-state, no fabricated £/cover', () => {
  const db = reconDb(false);
  const ctx = { q: q(db), now: Date.parse('2026-07-13T09:00:00Z'), query: { tab: 'reconciliation' } };
  const body = revPage.render(revPage.getSection(db, ctx), ctx).body;
  assert.match(body, /OpenTable £\/cover cross-check/);
  assert.match(body, /no OpenTable POS revenue in the window/, 'honest empty-state, not a number');
  assert.doesNotMatch(body, /OpenTable £\/cover \(net\)<\/small><strong>£/, 'no £/cover value without revenue');
});
