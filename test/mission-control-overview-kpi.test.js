'use strict';

// Overview business KPI feed — computed at read time from librarian.db (canonical-source ruling:
// no stored copies). Honesty under test:
//   • the decomposition identity: volume + spend effects SUM EXACTLY to the actual revenue delta;
//   • the current-month verdict line names the leading lever (covers-led vs spend-led);
//   • day-totals-only days render "no channel split", NEVER zeros;
//   • weeks with no labour rows render "awaiting rota backfill", never interpolated;
//   • QR weekly ATV matches a direct sales_by_channel query (parity);
//   • no raw YoY across the premises break (the LY window guard).
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const K = require('../mission-control/ui/kpi.js');
const overview = require('../mission-control/ui/pages/coyote/overview.js');

const NOW = 1783000000000;
function ctxFor(db) { return { q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW }; }

// ---------- pure compute ----------

test('kpi: week helpers — Mon–Sun windows, weekday-aligned LY shift', () => {
  assert.equal(K.dow('2026-07-12'), 0, 'Sunday');
  assert.equal(K.weekMonday('2026-07-12'), '2026-07-06');
  assert.equal(K.weekMonday('2026-07-06'), '2026-07-06');
  assert.deepEqual(K.lastFullWeek('2026-07-14'), { from: '2026-07-06', to: '2026-07-12' }, 'Tue → prior full week');
  assert.deepEqual(K.lastFullWeek('2026-07-12'), { from: '2026-07-06', to: '2026-07-12' }, 'Sunday closes its own week');
  assert.equal(K.shiftDays('2026-07-06', -364), '2025-07-07', '−364d keeps the weekday (Mon→Mon)');
});

test('kpi: decompose — the identity holds exactly, lead is named, zero-covers refuses', () => {
  // pure volume: same ATV, fewer checks
  const v = K.decompose(1800, 3600000, 1500, 3000000);
  assert.equal(v.volume, -600000);
  assert.equal(v.spend, 0);
  assert.equal(v.delta, -600000);
  assert.ok(v.checkOk, 'volume + spend === delta');
  assert.equal(v.lead, 'volume');
  // pure spend: same checks, higher ATV
  const s = K.decompose(700, 1400000, 700, 1540000);
  assert.equal(s.volume, 0);
  assert.equal(s.spend, 140000);
  assert.equal(s.lead, 'spend');
  // mixed, awkward numbers — identity still exact within float dust
  const m = K.decompose(1234, 5678901, 987, 4321098);
  assert.ok(Math.abs(m.volume + m.spend - m.delta) < 0.5, 'identity holds on awkward numbers');
  // refusal: no fabricated split without transactions
  assert.equal(K.decompose(0, 0, 100, 50000), null);
  assert.equal(K.decompose(100, 50000, 0, 0), null);
});

// ---------- page-level, seeded DB ----------

function makeDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE premises_regime (name TEXT PRIMARY KEY, start_date TEXT, end_date TEXT, note TEXT);
    CREATE TABLE sales_day (business_date TEXT PRIMARY KEY, net_sales_pence INTEGER, gross_sales_pence INTEGER, pos_guest_count INTEGER, transactions INTEGER, taxes_pence INTEGER, refunds_pence INTEGER, voids_pence INTEGER, discounts_pence INTEGER, comps_pence INTEGER, service_charges_pence INTEGER, tips_pence INTEGER, updated_at INTEGER);
    CREATE TABLE sales_day_history (business_date TEXT PRIMARY KEY, net_sales_pence INTEGER, gross_sales_pence INTEGER, pos_guest_count INTEGER, transactions INTEGER, taxes_pence INTEGER, refunds_pence INTEGER, voids_pence INTEGER, discounts_pence INTEGER, comps_pence INTEGER, service_charges_pence INTEGER, tips_pence INTEGER, updated_at INTEGER);
    CREATE VIEW v_sales_day_all AS
      SELECT business_date, net_sales_pence, gross_sales_pence, pos_guest_count, transactions, taxes_pence, refunds_pence, voids_pence, discounts_pence, comps_pence, service_charges_pence, tips_pence, 'live' AS source,
             CASE WHEN business_date >= (SELECT start_date FROM premises_regime WHERE name='current') THEN 'current' ELSE 'previous' END AS premises FROM sales_day
      UNION ALL
      SELECT business_date, net_sales_pence, gross_sales_pence, pos_guest_count, transactions, taxes_pence, refunds_pence, voids_pence, discounts_pence, comps_pence, service_charges_pence, tips_pence, 'history' AS source,
             CASE WHEN business_date >= (SELECT start_date FROM premises_regime WHERE name='current') THEN 'current' ELSE 'previous' END AS premises FROM sales_day_history WHERE business_date NOT IN (SELECT business_date FROM sales_day);
    CREATE TABLE sales_by_channel (business_date TEXT, profile_id TEXT, profile_name TEXT, net_sales_pence INTEGER, gross_sales_pence INTEGER, pos_guest_count INTEGER, transactions INTEGER, tips_pence INTEGER, discounts_pence INTEGER, updated_at INTEGER, PRIMARY KEY (business_date, profile_id));
    CREATE TABLE labour_dept (business_date TEXT, department TEXT, sched_minutes INTEGER, act_minutes INTEGER, sched_cost_rc_pence INTEGER, act_cost_rc_pence INTEGER, rc_uncosted_sched_min INTEGER, rc_uncosted_act_min INTEGER, rc_uncosted_names TEXT, updated_at INTEGER, PRIMARY KEY (business_date, department));
    CREATE TABLE labour_budget (business_date TEXT, department TEXT, labour_pct REAL, updated_at INTEGER, PRIMARY KEY (business_date, department));
  `);
  db.prepare(`INSERT INTO premises_regime VALUES ('previous','2022-02-20','2023-03-31',''),('current','2023-04-01',NULL,'moved')`).run();
  return db;
}

const pad = (n) => String(n).padStart(2, '0');

/** The seeded world: June complete both years (pure covers-led decline), July 1–14 both years
 *  (pure spend-led growth). maxDate = 2026-07-14 (Tue) → last full week 07-06..07-12. */
function seedSales(db) {
  const day = db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence, transactions, updated_at) VALUES (?,?,?,0)`);
  const hist = db.prepare(`INSERT INTO sales_day_history (business_date, net_sales_pence, transactions, updated_at) VALUES (?,?,?,0)`);
  for (let d = 1; d <= 30; d++) hist.run(`2025-06-${pad(d)}`, 120000, 60); // LY June: ATV £20, 60 txn/day
  for (let d = 1; d <= 30; d++) day.run(`2026-06-${pad(d)}`, 100000, 50);  // June: ATV £20, 50 txn/day → covers-led
  for (let d = 1; d <= 14; d++) hist.run(`2025-07-${pad(d)}`, 100000, 50); // LY July MTD: ATV £20
  for (let d = 1; d <= 14; d++) day.run(`2026-07-${pad(d)}`, 110000, 50);  // July MTD: ATV £22 → spend-led
}

function seedChannels(db) {
  const ins = db.prepare(`INSERT INTO sales_by_channel (business_date, profile_id, profile_name, net_sales_pence, transactions, updated_at) VALUES (?,?,?,?,?,0)`);
  for (let d = 6; d <= 12; d++) {
    if (d === 8) continue; // 2026-07-08 has a sales_day row but NO channel rows → "no channel split"
    const date = `2026-07-${pad(d)}`;
    ins.run(date, 'p1', 'EAT IN', 45000, 10);
    ins.run(date, 'p2', 'STOREKIT ORDER & PAY', 33000, 10);
    ins.run(date, 'p3', 'MON-FRI DEAL', 11100, 3);
  }
}

function seedLabour(db) {
  const ld = db.prepare(`INSERT INTO labour_dept (business_date, department, act_cost_rc_pence, updated_at) VALUES (?,?,?,0)`);
  const lb = db.prepare(`INSERT INTO labour_budget (business_date, department, labour_pct, updated_at) VALUES (?,?,?,0)`);
  for (let d = 6; d <= 12; d++) {
    const date = `2026-07-${pad(d)}`;
    ld.run(date, 'Kitchen', 14000);
    ld.run(date, 'FOH', 11000);
    lb.run(date, 'Kitchen', 0.133);
    lb.run(date, 'FOH', 0.103);
  }
  // June weeks intentionally have NO labour_dept rows → "awaiting rota backfill"
}

test('overview KPIs: decomposition sums to the delta, verdict names the lever, headline strip is honest', () => {
  const db = makeDb();
  seedSales(db);
  const ctx = ctxFor(db);
  const m = overview.getSection(db, ctx);

  // June: pure covers-led. C0=1800 R0=3.6M · C1=1500 R1=3.0M → volume −600000, spend 0.
  const june = m.decomp.find((r) => r.month === '2026-06');
  assert.ok(june && june.d, 'June decomposes');
  assert.equal(june.d.volume, -600000);
  assert.equal(june.d.spend, 0);
  assert.equal(june.d.delta, june.d.volume + june.d.spend, 'volume + spend === actual delta');
  assert.ok(june.d.checkOk);
  assert.equal(june.d.lead, 'volume');

  // July MTD (to day 14): pure spend-led. Δ=+140000 all spend.
  const july = m.decomp.find((r) => r.month === '2026-07');
  assert.ok(july && july.partial && july.d, 'July compares MTD');
  assert.equal(july.d.volume, 0);
  assert.equal(july.d.spend, 140000);
  assert.equal(july.d.lead, 'spend');

  // months with no record carry a reason, never a split
  const jan = m.decomp.find((r) => r.month === '2026-01');
  assert.ok(jan && !jan.d && jan.reason, 'unrecorded month refuses honestly');

  // headline strip: wk 07-06..07-12 vs LY 07-07..07-13, +10% net, 0% txn
  assert.equal(m.week.from, '2026-07-06');
  assert.equal(m.week.lyFrom, '2025-07-07');
  assert.equal(m.week.net, 770000);
  assert.equal(m.week.lyNet, 700000);
  assert.equal(m.week.txn, m.week.lyTxn);
  assert.ok(m.week.comparable);

  const out = overview.render(m, ctx);
  assert.match(out.body, /SPEND-led/, 'current-month verdict names the lever');
  assert.match(out.body, /sum = actual delta/, 'the reconciliation check is rendered');
  assert.doesNotMatch(out.body, /CHECK FAILED/);
  db.close();
});

test('overview KPIs: channel weeks — missing-split day says "no channel split", QR parity vs direct SQL, £38 reference', () => {
  const db = makeDb();
  seedSales(db);
  seedChannels(db);
  const ctx = ctxFor(db);
  const m = overview.getSection(db, ctx);

  const wk = m.channels.weeks.find((w) => w.monday === '2026-07-06');
  assert.ok(wk, 'the seeded week exists');
  assert.equal(wk.noSplit, 1, '2026-07-08 counted as day-totals-only');
  assert.equal(wk.chDays, 6);
  assert.equal(wk.salesDays, 7);

  // parity: page QR ATV === direct sales_by_channel query for the same window
  const direct = DATA.safeSelect(db,
    `SELECT SUM(net_sales_pence) * 1.0 / SUM(transactions) atv FROM sales_by_channel
      WHERE profile_name = 'STOREKIT ORDER & PAY' AND business_date BETWEEN '2026-07-06' AND '2026-07-12'`).rows[0];
  assert.equal(wk.qr, Number(direct.atv), 'QR weekly ATV matches the direct query');
  assert.equal(wk.qr, 3300, '£33.00/txn');
  assert.equal(wk.eatIn, 4500);
  assert.equal(Math.round(wk.server), Math.round((45000 * 6 + 11100 * 6) / (10 * 6 + 3 * 6)), 'server blend = EAT IN + MON-FRI DEAL');

  const out = overview.render(m, ctx);
  assert.match(out.body, /1d no channel split/, 'the gap is stated');
  const panel = out.body.slice(out.body.indexOf('ATV by channel'), out.body.indexOf('Labour %'));
  assert.ok(panel.length > 100, 'channel panel present');
  assert.doesNotMatch(panel, /£0\.00/, 'never a fabricated zero ATV in the channel panel');
  assert.match(out.body, /vs £38/, 'the QR checkpoint reference (decision, qr-upsell-spec:87)');
  db.close();
});

test('overview KPIs: labour weeks — actual vs budget on the scorecard ruler; missing weeks say "awaiting rota backfill"', () => {
  const db = makeDb();
  seedSales(db);
  seedLabour(db);
  const ctx = ctxFor(db);
  const m = overview.getSection(db, ctx);

  const wk = m.labourWeeks.find((w) => w.from === '2026-07-06');
  assert.ok(wk && wk.labourDays === 7, 'the labour week is complete');
  // actual: 7×(14000+11000)=175000 over net 770000 → 22.727…%
  assert.ok(Math.abs(wk.actPct - (175000 / 770000) * 100) < 0.001);
  // budget: (0.133+0.103)×net / net = 23.6%
  assert.ok(Math.abs(wk.budPct - 23.6) < 0.001);

  const juneWk = m.labourWeeks.find((w) => w.from === '2026-06-15');
  assert.ok(juneWk && juneWk.labourDays === 0, 'a June week has no labour rows');
  assert.equal(juneWk.actPct, null, 'never interpolated');

  const out = overview.render(m, ctx);
  assert.match(out.body, /awaiting rota backfill/);
  assert.match(out.body, /scorecard ruler \(pre-burden\), not the vault policy/);
  db.close();
});

test('overview KPIs: premises guard — an LY window on the old site refuses raw YoY', () => {
  const db = makeDb();
  // world where the last full week is 2024-03 (current premises) but LY = 2023-03 (pre-move)
  const day = db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence, transactions, updated_at) VALUES (?,?,?,0)`);
  const hist = db.prepare(`INSERT INTO sales_day_history (business_date, net_sales_pence, transactions, updated_at) VALUES (?,?,?,0)`);
  for (let d = 18; d <= 26; d++) day.run(`2024-03-${pad(d)}`, 90000, 40);   // current premises
  for (let d = 18; d <= 28; d++) hist.run(`2023-03-${pad(d)}`, 60000, 35);  // OLD premises
  const ctx = ctxFor(db);
  const m = overview.getSection(db, ctx);
  assert.ok(m.week && m.week.days > 0);
  assert.equal(m.week.comparable, false, 'pre-move LY window is not comparable');
  const out = overview.render(m, ctx);
  assert.match(out.body, /LY window not comparable \(premises rule\)/);
  db.close();
});

test('overview KPIs: EMPTY db degrades to honest banners (no throw, no fabrication)', () => {
  const db = makeDb();
  const ctx = ctxFor(db);
  const out = overview.render(overview.getSection(db, ctx), ctx);
  assert.match(out.body, /No sales record yet/);
  assert.match(out.body, /No monthly record yet|No channel-split data yet/);
  db.close();
});
