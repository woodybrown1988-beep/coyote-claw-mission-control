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
const SHARED = require('../mission-control/ui/shared.js');
const overview = require('../mission-control/ui/pages/coyote/overview.js');
const { buildOverviewRecipeEconomics } = overview;

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
    CREATE TABLE sales_receipts_api (receipt_id TEXT PRIMARY KEY, business_date TEXT, type TEXT, cancelled INTEGER, account_profile_code TEXT, net_without_tax_pence INTEGER, table_name TEXT);
    CREATE TABLE sales_receipt_lines_api (receipt_id TEXT, line_id TEXT, business_date TEXT, sku TEXT, name TEXT, quantity REAL, net_with_tax_pence INTEGER, net_without_tax_pence INTEGER, PRIMARY KEY (receipt_id, line_id));
    CREATE TABLE sales_channel_map_api (account_profile_code TEXT PRIMARY KEY, profile_name TEXT, channel_label TEXT);
    CREATE TABLE rota_ahead_budget (business_date TEXT, department TEXT, labour_pct REAL, revenue_target_pence INTEGER, as_of INTEGER, PRIMARY KEY (business_date, department));
    CREATE TABLE rota_ahead_shifts (business_date TEXT, rc_shift_id INTEGER, sched_minutes INTEGER, sched_cost_true_pence INTEGER, department TEXT, as_of INTEGER);
    CREATE TABLE rota_review_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, mode TEXT, week_monday TEXT, ran_at INTEGER, status TEXT, trigger TEXT, report_json TEXT);
    CREATE TABLE sub_items (id TEXT PRIMARY KEY, pack_cost_pence INTEGER, pack_qty REAL);
    CREATE TABLE products (id TEXT PRIMARY KEY, lightspeed_sku TEXT UNIQUE);
    CREATE TABLE recipe_lines (product_id TEXT, sub_item_id TEXT, quantity REAL, PRIMARY KEY (product_id, sub_item_id));
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

test('buildOverviewRecipeEconomics: ex-VAT achieved price, contribution basis, coverage and complete-recipe gate', () => {
  const db = makeDb();
  db.exec(`
    INSERT INTO sub_items VALUES
      ('cost-200',200,1),('cost-100',100,1),('missing-cost',NULL,1),('missing-qty',100,NULL);
    INSERT INTO products VALUES
      ('A','A'),('B','B'),('UNRECIPE','UNRECIPE'),('NULLCOST','NULLCOST'),('NULLQTY','NULLQTY');
    INSERT INTO recipe_lines VALUES
      ('A','cost-200',1),
      ('B','cost-100',3),
      ('NULLCOST','cost-200',1),('NULLCOST','missing-cost',1),
      ('NULLQTY','missing-qty',1);
    INSERT INTO sales_receipts_api (receipt_id,business_date,type,cancelled) VALUES
      ('old','2025-07-14','SALE',0),
      ('A1','2026-07-13','SALE',0),('A2','2026-07-14','SALE',0),
      ('B','2026-07-14','SALE',0),('UNRECIPE','2026-07-14','SALE',0),
      ('NULLCOST','2026-07-14','SALE',0),('NULLQTY','2026-07-14','SALE',0),
      ('VOID','2026-07-14','VOID',0),('CANCELLED','2026-07-14','SALE',1);
    INSERT INTO sales_receipt_lines_api VALUES
      ('old','line','2025-07-14','A','Alpha old',1,1080000,900000),
      ('A1','line','2026-07-13','A','Alpha old name',10,12000,10000),
      ('A2','line','2026-07-14','A','Alpha',10,36000,30000),
      ('B','line','2026-07-14','B','Bravo',20,12000,10000),
      ('UNRECIPE','line','2026-07-14','UNRECIPE','No recipe',5,36000,30000),
      ('NULLCOST','line','2026-07-14','NULLCOST','Partial',2,12000,10000),
      ('NULLQTY','line','2026-07-14','NULLQTY','Partial',2,12000,10000),
      ('VOID','line','2026-07-14','A','Void decoy',100,1200000,1000000),
      ('CANCELLED','line','2026-07-14','A','Cancelled decoy',100,1200000,1000000);
  `);
  const ctx = ctxFor(db);
  const recipeCost = buildOverviewRecipeEconomics(ctx.q);
  assert.equal(recipeCost.recipeLineCount, 5, 'the recipe-line gate is counted live');
  assert.equal(recipeCost.from, '2026-07-13', 'the effective start is the first included feed row');
  assert.equal(recipeCost.to, '2026-07-14');
  assert.equal(recipeCost.allNetPence, 100000, 'gross values, old data, VOID and cancelled receipts stay out');
  assert.equal(recipeCost.coveredNetPence, 50000, 'only A + B have complete recipes');
  assert.ok(Math.abs(recipeCost.theoreticalCostPence - 10000) < 1e-9,
    'A: 20 units × 200p + B: 20 units × 300p');
  assert.equal(recipeCost.achievedAverageNetPence, 1250,
    'achieved average is ex-VAT covered sales 50,000p ÷ 40 actual units');
  assert.ok(Math.abs(recipeCost.theoreticalPct - 20) < 1e-9, '10,000p theoretical ÷ 50,000p covered');
  assert.ok(Math.abs(recipeCost.coveragePct - 50) < 1e-9, '50,000p covered ÷ 100,000p all ex-VAT sales');

  const m = overview.getSection(db, ctx);

  const out = overview.render(m, ctx);
  assert.match(out.body, /Recipe costs · available item sales · 2026-07-13 → 2026-07-14/);
  assert.match(out.body, /Theoretical recipe cost 20\.0% of covered ex-VAT sales · recipes cover 50\.0% of ex-VAT sales/);
  assert.match(out.body, /achieved sales and recipe costs are ex-VAT/);
  assert.match(out.body, /href="\/coyote\/costs"/);
  const tileAt = out.body.indexOf('Recipe costs · available item sales');
  const tileEnd = out.body.indexOf('</a></div></div>', tileAt);
  assert.ok(tileAt >= 0 && tileEnd > tileAt, 'recipe-cost tile is present');
  const tile = out.body.slice(tileAt, tileEnd);
  assert.doesNotMatch(tile, /recipe_lines|sub_items|pack_cost_pence|pack_qty|Calum gate|BOM|denominator/i,
    'the operator tile contains no storage or implementation jargon');
  db.close();
});

test('overview: recipe-cost tile handles missing and zero sales denominators without inventing percentages', () => {
  const db = makeDb();
  db.exec(`
    INSERT INTO sub_items VALUES ('costed',100,1);
    INSERT INTO products VALUES ('A','A');
    INSERT INTO recipe_lines VALUES ('A','costed',1);
  `);
  const ctx = ctxFor(db);
  const m = overview.getSection(db, ctx);
  assert.equal(m.recipeCost.recipeLineCount, 1);
  assert.equal(m.recipeCost.theoreticalPct, null);
  assert.equal(m.recipeCost.coveragePct, null);
  const out = overview.render(m, ctx);
  assert.match(out.body, /Theoretical recipe cost — of covered ex-VAT sales · recipes cover — of ex-VAT sales/);
  assert.doesNotMatch(out.body, /NaN|Infinity/);
  const visible = out.body.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.doesNotMatch(visible, /sales_receipt_lines_api|sales_receipts_api|\btable\b|\bcolumn\b/i);
  assert.doesNotMatch(visible, /\d{4}-\d{2}-\d{2}\s*→\s*\d{4}-\d{2}-\d{2}/,
    'an empty item feed does not invent a reporting period');
  db.close();

  const zeroDb = makeDb();
  zeroDb.exec(`
    INSERT INTO sub_items VALUES ('costed',100,1);
    INSERT INTO products VALUES ('A','A');
    INSERT INTO recipe_lines VALUES ('A','costed',1);
    INSERT INTO sales_receipts_api (receipt_id,business_date,type,cancelled) VALUES
      ('A','2026-07-14','SALE',0),('UNRECIPE','2026-07-14','SALE',0);
    INSERT INTO sales_receipt_lines_api VALUES
      ('A','line','2026-07-14','A','A',0,9999,0),
      ('UNRECIPE','line','2026-07-14','UNRECIPE','No recipe',1,1200,1000);
  `);
  const zeroCtx = ctxFor(zeroDb);
  const zero = overview.getSection(zeroDb, zeroCtx);
  assert.equal(zero.recipeCost.coveredNetPence, 0);
  assert.equal(zero.recipeCost.theoreticalPct, null, 'zero covered sales is not a valid cost denominator');
  assert.equal(zero.recipeCost.coveragePct, 0, 'zero covered ÷ positive all net is a real 0% coverage');
  const zeroOut = overview.render(zero, zeroCtx);
  assert.match(zeroOut.body, /Theoretical recipe cost — of covered ex-VAT sales · recipes cover 0\.0% of ex-VAT sales/);
  assert.doesNotMatch(zeroOut.body, /NaN|Infinity/);
  zeroDb.close();
});

test('overview recipe tile renders an exact three-month span, no fixed-year wording, and one valid inline script', () => {
  const db = makeDb();
  db.exec(`
    INSERT INTO sub_items VALUES ('costed',100,1);
    INSERT INTO products VALUES ('A','A');
    INSERT INTO recipe_lines VALUES ('A','costed',1);
    INSERT INTO sales_receipts_api (receipt_id,business_date,type,cancelled) VALUES
      ('first','2026-04-01','SALE',0),('middle','2026-05-15','SALE',0),('last','2026-06-30','SALE',0);
    INSERT INTO sales_receipt_lines_api VALUES
      ('first','line','2026-04-01','A','Alpha old',1,1200,1000),
      ('middle','line','2026-05-15','A','Alpha',1,1200,1000),
      ('last','line','2026-06-30','A','Alpha',1,1200,1000);
  `);
  const ctx = ctxFor(db);
  const section = overview.getSection(db, ctx);
  const rendered = overview.render(section, ctx);
  assert.deepEqual([section.recipeCost.from, section.recipeCost.to], ['2026-04-01', '2026-06-30']);
  assert.match(rendered.body, /available item sales · 2026-04-01 → 2026-06-30/);
  assert.doesNotMatch(rendered.body, /trailing 12 months|365 days/i);

  const document = SHARED.renderShell({
    title: overview.title, sub: overview.sub, body: rendered.body, stamp: rendered.stamp,
    workspace: overview.workspace, route: overview.route, key: overview.key,
  });
  const scripts = [...document.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new Function(scripts[0]));
  db.close();
});

test('overview: QR verdict line renders spend per SITTING (fragmentation ruling 2026-07-31) — QR slots group, EAT IN splits group, £38 target retired', () => {
  const db = makeDb();
  seedSales(db);
  db.prepare(`INSERT INTO sales_channel_map_api VALUES ('storekit_orderpay','Storekit','STOREKIT ORDER & PAY')`).run();
  db.prepare(`INSERT INTO sales_channel_map_api VALUES ('LOCAL','Local','EAT IN')`).run();
  const ins = db.prepare(`INSERT INTO sales_receipts_api VALUES (?,?,?,0,?,?,?)`);
  // QR: 5 orders/day on 3 session slots (2+2+1) → 21 sittings over 7 days, £33/order, £55/sitting
  for (let d = 6; d <= 12; d++) for (let i = 0; i < 5; i++) {
    ins.run(`Q${d}-${i}`, `2026-07-${pad(d)}`, 'SALE', 'storekit_orderpay', 3300, `Order ${1 + Math.floor(i / 2)}`);
  }
  // EAT IN: 2 closed tabs/day ('Order N' = device counter → each its own sitting) @ £100…
  for (let d = 6; d <= 12; d++) for (let i = 0; i < 2; i++) {
    ins.run(`E${d}-${i}`, `2026-07-${pad(d)}`, 'SALE', 'LOCAL', 10000, `Order ${10 + i}`);
  }
  // …plus one party split across two bills ('Table 5.1'/'Table 5.2' → ONE sitting): keeps the
  // per-sitting figure at £100.00 ONLY if base-table grouping works (else 16 sittings → £93.75)
  ins.run('ES-1', '2026-07-12', 'SALE', 'LOCAL', 5000, 'Table 5.1');
  ins.run('ES-2', '2026-07-12', 'SALE', 'LOCAL', 5000, 'Table 5.2');
  ins.run('QV', '2026-07-10', 'VOID', 'storekit_orderpay', 99999, 'Order 9'); // must be excluded
  const ctx = ctxFor(db);
  const m = overview.getSection(db, ctx);
  assert.equal(m.qr.sittings, 21, '3 QR slots/day × 7 days');
  assert.equal(m.qr.perSit, 5500, '£55.00/sitting = 115500p / 21 sittings');
  assert.equal(m.qr.atv, 3300, 'per-order ATV still computed for the caption');
  assert.equal(m.qr.eatPerSit, 10000, 'EAT IN £100.00/sitting — split bills grouped to one sitting');
  const out = overview.render(m, ctx);
  assert.match(out.body, /QR <b>£55\.00<\/b>\/sitting vs EAT IN £100\.00/);
  assert.match(out.body, /QR orders fragment per sitting/, 'the ruled caption');
  assert.match(out.body, /per-receipt record/, 'source stated');
  assert.doesNotMatch(out.body, /£38 target/, 'the per-order target is retired');
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
  const m = overview.getSection(db, ctx);
  assert.equal(m.recipeCost.recipeLineCount, 0, 'the empty-state decision comes from a live count');
  const out = overview.render(m, ctx);
  assert.match(out.body, /No sales record yet/);
  assert.match(out.body, /No forward rota\/forecast on file yet/);
  assert.match(out.body, /Theoretical cost will appear after recipes are added\./);
  assert.match(out.body, /href="\/coyote\/costs"/);
  assert.doesNotMatch(out.body, /recipe_lines is empty|Calum gate/, 'empty state stays in plain operator language');
  assert.doesNotMatch(out.body, /£0\.00.*vs.*LY/, 'no fabricated comparisons');
  db.close();
});

test('overview: every emitted inline script parses and the shared page keeps its single script', () => {
  const db = makeDb();
  const ctx = ctxFor(db);
  const out = overview.render(overview.getSection(db, ctx), ctx);
  const html = SHARED.renderShell({
    active: overview.key, workspace: overview.workspace, route: overview.route,
    title: overview.title, sub: overview.sub, stamp: out.stamp, body: out.body, badges: {}, foot: [],
  });
  const blocks = [...String(html).matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.equal(blocks.length, 1, 'the overview emits only the existing shared inline client script');
  for (const src of blocks) {
    assert.doesNotThrow(() => new Function(src), 'an emitted inline script does not parse');
  }
  db.close();
});
