'use strict';

// Overview (redesigned, audit 2026-07-21) + the decomposition's new home in Reports.
// Honesty under test:
//   • the decomposition identity still sums EXACTLY (table now in Reports; Overview carries the
//     current-month VERDICT LINE naming the lever);
//   • QR ATV verdict line reads the PER-RECEIPT record (parity vs direct SQL) — the old
//     scraper-sourced P3 table is gone (the audit's deepest violation);
//   • labour verdict line: scorecard-ruler % vs budget, last full week;
//   • WEEK AHEAD: forecast vs rota'd per day; unpublished days say so, never zeros;
//   • no raw YoY across the premises break; empty DB degrades honestly.
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
    CREATE TABLE sales_receipts_api (receipt_id TEXT PRIMARY KEY, business_date TEXT, type TEXT, cancelled INTEGER, account_profile_code TEXT, net_without_tax_pence INTEGER);
    CREATE TABLE sales_channel_map_api (account_profile_code TEXT PRIMARY KEY, profile_name TEXT, channel_label TEXT);
    CREATE TABLE rota_ahead_budget (business_date TEXT, department TEXT, labour_pct REAL, revenue_target_pence INTEGER, as_of INTEGER, PRIMARY KEY (business_date, department));
    CREATE TABLE rota_ahead_shifts (business_date TEXT, rc_shift_id INTEGER, sched_minutes INTEGER, sched_cost_true_pence INTEGER, department TEXT, as_of INTEGER);
    CREATE TABLE rota_review_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, mode TEXT, week_monday TEXT, ran_at INTEGER, status TEXT, trigger TEXT, report_json TEXT);
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
  for (let d = 1; d <= 15; d++) hist.run(`2025-07-${pad(d)}`, 100000, 50); // LY July MTD (+d15 = yesterday's −364d weekday twin): ATV £20
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

const reports = require('../mission-control/ui/pages/coyote/reports.js');

test('decomposition (now in Reports): identity sums exactly; Overview verdict line names the lever', () => {
  const db = makeDb();
  seedSales(db);
  const ctx = ctxFor(db);
  // Reports carries the table
  const rm = reports.getSection(db, ctx);
  const june = rm.decomp.find((r) => r.month === '2026-06');
  assert.ok(june && june.d, 'June decomposes');
  assert.equal(june.d.volume, -600000);
  assert.equal(june.d.spend, 0);
  assert.ok(june.d.checkOk, 'volume + spend === delta');
  assert.equal(june.d.lead, 'volume');
  const july = rm.decomp.find((r) => r.month === '2026-07');
  assert.ok(july && july.partial && july.d);
  assert.equal(july.d.spend, 140000);
  assert.equal(july.d.lead, 'spend');
  const jan = rm.decomp.find((r) => r.month === '2026-01');
  assert.ok(jan && !jan.d && jan.reason, 'unrecorded month refuses honestly');
  const rout = reports.render(rm, ctx);
  // the decomposition's ONE home = the EXECUTIVE tab (default): current month as r-driver cards
  // (new RCC markup) + the full monthly table behind the expand
  assert.match(rout.body, /decomposition — which lever moved each month/);
  assert.match(rout.body, /r-driver/, 'current-month split renders as RCC driver cards');
  assert.match(rout.body, /Growth from spend<\/small><strong>\+£1,400\.00<\/strong>/, 'July MTD spend effect on the card');
  assert.match(rout.body, /SPEND-led/, 'lead lever named on the card');
  // Overview carries the VERDICT LINE only
  const m = overview.getSection(db, ctx);
  assert.ok(m.decompNow && m.decompNow.lead === 'spend', 'July MTD is spend-led');
  const out = overview.render(m, ctx);
  assert.match(out.body, /SPEND-led/);
  assert.match(out.body, /decomposition →/, 'links to the ONE home');
  db.close();
});

test('overview: THE WEEK — yesterday + last full week verdict tiles, premises-honest', () => {
  const db = makeDb();
  seedSales(db);
  const ctx = ctxFor(db);
  const m = overview.getSection(db, ctx);
  assert.equal(m.week.from, '2026-07-06');
  assert.equal(m.week.net, 770000);
  assert.equal(m.week.lyNet, 700000);
  assert.ok(m.week.comparable);
  assert.equal(m.yesterday.date, '2026-07-14');
  assert.equal(m.yesterday.net, 110000);
  assert.equal(m.yesterday.lyNet, 100000, '−364d same-weekday LY');
  const out = overview.render(m, ctx);
  assert.match(out.body, /Last full week 2026-07-06/);
  assert.match(out.body, /\+10\.0% vs/, 'yesterday verdict carries the LY comparison');
  db.close();
});

test('overview: QR verdict line reads the PER-RECEIPT record (parity vs direct SQL) + £38 reference', () => {
  const db = makeDb();
  seedSales(db);
  db.prepare(`INSERT INTO sales_channel_map_api VALUES ('storekit_orderpay','Storekit','STOREKIT ORDER & PAY')`).run();
  const ins = db.prepare(`INSERT INTO sales_receipts_api VALUES (?,?,?,0,'storekit_orderpay',?)`);
  for (let d = 6; d <= 12; d++) for (let i = 0; i < 5; i++) ins.run(`Q${d}-${i}`, `2026-07-${pad(d)}`, 'SALE', 3300);
  ins.run('QV', '2026-07-10', 'VOID', 99999); // must be excluded
  const ctx = ctxFor(db);
  const m = overview.getSection(db, ctx);
  const direct = DATA.safeSelect(db,
    `SELECT SUM(net_without_tax_pence) * 1.0 / COUNT(*) atv FROM sales_receipts_api
      WHERE account_profile_code = 'storekit_orderpay' AND cancelled = 0 AND type = 'SALE'`).rows[0];
  assert.equal(m.qr.atv, Number(direct.atv), 'parity with the direct per-receipt query');
  assert.equal(m.qr.atv, 3300);
  const out = overview.render(m, ctx);
  assert.match(out.body, /vs the £38 target/);
  assert.match(out.body, /per-receipt record/, 'source stated');
  db.close();
});

test('overview: labour verdict line — scorecard % vs budget, last full week', () => {
  const db = makeDb();
  seedSales(db);
  seedLabour(db);
  const ctx = ctxFor(db);
  const m = overview.getSection(db, ctx);
  assert.ok(Math.abs(m.labourWeek.actPct - (175000 / 770000) * 100) < 0.001);
  assert.ok(Math.abs(m.labourWeek.budPct - 23.6) < 0.001);
  const out = overview.render(m, ctx);
  assert.match(out.body, /Labour last week: <b>22\.7%<\/b> vs budget 23\.6%/);
  assert.match(out.body, /rota review →/);
  db.close();
});

test('overview: WEEK AHEAD — forecast vs rota, unpublished honesty, FORWARD verdict line', () => {
  const db = makeDb();
  seedSales(db);
  const b = db.prepare(`INSERT INTO rota_ahead_budget VALUES (?,?,0.138,?,1)`);
  b.run('2026-07-15', 'kitchen', 400000);
  b.run('2026-07-16', 'kitchen', 420000);
  db.prepare(`INSERT INTO rota_ahead_shifts VALUES ('2026-07-15', 1, 480, 11300, 'kitchen', 5)`).run();
  // 07-16 has a budget but NO shifts → "rota not published"
  db.prepare(`INSERT INTO rota_review_runs (mode, week_monday, ran_at, status, trigger, report_json) VALUES ('forward','2026-07-13',1,'ok','manual',?)`)
    .run(JSON.stringify({ verdicts: [{ dept: 'kitchen', deltaPence: -83000 }], gaps: ['kitchen rota looks PARTIALLY PUBLISHED (1 shift(s) on the whole week)'] }));
  const ctx = ctxFor(db);
  const m = overview.getSection(db, ctx);
  assert.equal(m.ahead.days.length, 2);
  assert.equal(m.ahead.forward.unpublished, true);
  const out = overview.render(m, ctx);
  assert.match(out.body, /The week ahead/);
  assert.match(out.body, /8\.0h · £113\.00/, 'rota d 07-15: 480min, £113 hourly TRUE');
  assert.match(out.body, /rota not published/, '07-16 honest');
  assert.match(out.body, /FORWARD verdict w\/c 2026-07-13/);
  assert.match(out.body, /kitchen rota unpublished — provisional/);
  db.close();
});

test('overview: premises guard — an LY window on the old site refuses raw YoY', () => {
  const db = makeDb();
  const day = db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence, transactions, updated_at) VALUES (?,?,?,0)`);
  const hist = db.prepare(`INSERT INTO sales_day_history (business_date, net_sales_pence, transactions, updated_at) VALUES (?,?,?,0)`);
  for (let d = 18; d <= 26; d++) day.run(`2024-03-${pad(d)}`, 90000, 40);
  for (let d = 18; d <= 28; d++) hist.run(`2023-03-${pad(d)}`, 60000, 35);
  const ctx = ctxFor(db);
  const m = overview.getSection(db, ctx);
  assert.ok(m.week && m.week.days > 0);
  assert.equal(m.week.comparable, false);
  const out = overview.render(m, ctx);
  assert.match(out.body, /LY not comparable \(premises guard\)/);
  db.close();
});

test('overview: EMPTY db degrades to honest banners (no throw, no fabrication)', () => {
  const db = makeDb();
  const ctx = ctxFor(db);
  const out = overview.render(overview.getSection(db, ctx), ctx);
  assert.match(out.body, /No sales record yet/);
  assert.match(out.body, /No forward rota\/forecast on file yet/);
  assert.doesNotMatch(out.body, /£0\.00.*vs.*LY/, 'no fabricated comparisons');
  db.close();
});
