'use strict';
// RCC Stage 2 (P1 Executive + P4 Forecast) — the restructured /coyote/reports shell.
// Pinned here:
//   (a) SHELL: default tab = executive, ?tab= switches, 5 subtab links, everything inside .rcc;
//   (b) EXECUTIVE: real last-full-week KPIs vs weekday-aligned LY; covers = NOT WIRED with zero
//       digits (POS guest-count is never covers); decision feed carries REAL rota £ verdicts +
//       a reconciliation line; daypart states the ONLINE exclusion £; donut legend sums to the
//       window total;
//   (c) FORECAST: planning chips Actual/Current/Forecast, hatched forecast bars, override
//       journal applied ×(1+pct) to FORECAST months only; applyForecastOverride refuses a
//       non-zero override without its reason (NEGATIVE CONTROL) and 503s on an absent store;
//   (d) NO-MOCK-NUMBERS: an EMPTY db renders zero £-figures on both built tabs.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const reports = require('../mission-control/ui/pages/coyote/reports.js');
const { applyForecastOverride } = require('../mission-control/server.js');

const NOW = 1783000000000; // maxDate 2026-07-14 (Tue) → last full week 2026-07-06..12
const pad = (n) => String(n).padStart(2, '0');
const gbp = (p) => `£${(p / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const DDL = `
CREATE TABLE premises_regime (name TEXT PRIMARY KEY, start_date TEXT, end_date TEXT, note TEXT);
CREATE TABLE sales_day (business_date TEXT PRIMARY KEY, net_sales_pence INTEGER, gross_sales_pence INTEGER, pos_guest_count INTEGER, transactions INTEGER, taxes_pence INTEGER, refunds_pence INTEGER, voids_pence INTEGER, discounts_pence INTEGER, comps_pence INTEGER, service_charges_pence INTEGER, tips_pence INTEGER, updated_at INTEGER);
CREATE TABLE sales_day_history (business_date TEXT PRIMARY KEY, net_sales_pence INTEGER, gross_sales_pence INTEGER, pos_guest_count INTEGER, transactions INTEGER, taxes_pence INTEGER, refunds_pence INTEGER, voids_pence INTEGER, discounts_pence INTEGER, comps_pence INTEGER, service_charges_pence INTEGER, tips_pence INTEGER, updated_at INTEGER);
CREATE VIEW v_sales_day_all AS
  SELECT business_date, net_sales_pence, gross_sales_pence, pos_guest_count, transactions, taxes_pence, refunds_pence, voids_pence, discounts_pence, comps_pence, service_charges_pence, tips_pence, 'live' AS source,
         CASE WHEN business_date >= (SELECT start_date FROM premises_regime WHERE name='current') THEN 'current' ELSE 'previous' END AS premises FROM sales_day
  UNION ALL
  SELECT business_date, net_sales_pence, gross_sales_pence, pos_guest_count, transactions, taxes_pence, refunds_pence, voids_pence, discounts_pence, comps_pence, service_charges_pence, tips_pence, 'history' AS source,
         CASE WHEN business_date >= (SELECT start_date FROM premises_regime WHERE name='current') THEN 'current' ELSE 'previous' END AS premises FROM sales_day_history WHERE business_date NOT IN (SELECT business_date FROM sales_day);
CREATE VIEW v_sales_month AS WITH g AS (
  SELECT substr(business_date,1,7) AS month, COUNT(*) AS days, SUM(net_sales_pence>0) AS open_days, SUM(net_sales_pence) AS net_pence FROM v_sales_day_all GROUP BY month)
  SELECT month, CASE WHEN month >= (SELECT substr(start_date,1,7) FROM premises_regime WHERE name='current') THEN 'current' ELSE 'previous' END AS premises, days,
         CAST(julianday(month||'-01','+1 month') - julianday(month||'-01') AS INT) AS cal_days,
         (days >= CAST(julianday(month||'-01','+1 month') - julianday(month||'-01') AS INT)) AS complete, open_days, net_pence FROM g;
CREATE TABLE sales_receipts_api (receipt_id TEXT PRIMARY KEY, business_date TEXT, type TEXT, cancelled INTEGER, account_profile_code TEXT, net_without_tax_pence INTEGER, updated_at INTEGER, table_name TEXT);
CREATE TABLE sales_receipt_lines_api (receipt_id TEXT, line_id TEXT, business_date TEXT, net_without_tax_pence INTEGER, accounting_group TEXT, time_of_sale_ms INTEGER, updated_at INTEGER, PRIMARY KEY (receipt_id, line_id));
CREATE TABLE sales_api_ingest_runs (business_date TEXT, source TEXT, status TEXT, receipts INTEGER, detail TEXT, pulled_at INTEGER, PRIMARY KEY (business_date, source));
CREATE TABLE sales_channel_map_api (account_profile_code TEXT PRIMARY KEY, profile_name TEXT, delivery_mode TEXT, channel_label TEXT, first_seen INTEGER, updated_at INTEGER, label_source TEXT);
CREATE TABLE acct_groups_api (code TEXT PRIMARY KEY, name TEXT, statistic_group TEXT, updated_at INTEGER);
CREATE TABLE rota_ahead_budget (business_date TEXT, department TEXT, labour_pct REAL, revenue_target_pence INTEGER, as_of INTEGER, PRIMARY KEY (business_date, department));
CREATE TABLE rota_review_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, mode TEXT, week_monday TEXT, ran_at INTEGER, status TEXT, trigger TEXT, report_json TEXT);
CREATE TABLE sales_reconciliation (business_date TEXT, check_name TEXT, api_pence INTEGER, playwright_pence INTEGER, delta_pence INTEGER, passed INTEGER, finding TEXT, computed_at INTEGER, PRIMARY KEY (business_date, check_name));
CREATE TABLE forecast_overrides (id INTEGER PRIMARY KEY AUTOINCREMENT, pct REAL NOT NULL CHECK (pct BETWEEN -50 AND 50), reason TEXT NOT NULL, created_at INTEGER NOT NULL);
`;

function makeDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(DDL);
  db.prepare(`INSERT INTO premises_regime VALUES ('previous','2022-02-20','2023-03-31',''),('current','2023-04-01',NULL,'moved')`).run();
  db.prepare(`INSERT INTO sales_channel_map_api VALUES
    ('LOCAL','Local','NONE','EAT IN',1,1,'operator'),
    ('storekit_orderpay','Storekit','NONE','STOREKIT ORDER & PAY',1,1,'operator'),
    ('online','Online','DELIVERY','ONLINE ORDER',1,1,'operator')`).run();
  db.prepare(`INSERT INTO acct_groups_api VALUES ('27','SOFT DRINKS',NULL,1)`).run();
  return db;
}

/** Executive world: KPI week 07-06..12 = 7×£1,100 net / £1,320 gross / 50 txn (ATV £22);
 *  LY (−364d = 2025-07-07..13) = 7×£1,000 / £1,200 / 50 (ATV £20) → every delta +10.0%. */
function seedExecutive(db) {
  const day = db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence, gross_sales_pence, transactions, discounts_pence, refunds_pence, voids_pence, updated_at) VALUES (?,?,?,?,?,0,0,0)`);
  const hist = db.prepare(`INSERT INTO sales_day_history (business_date, net_sales_pence, gross_sales_pence, transactions, updated_at) VALUES (?,?,?,?,0)`);
  for (let d = 1; d <= 30; d++) day.run(`2026-06-${pad(d)}`, 100000, 120000, 50, 500);
  for (let d = 1; d <= 14; d++) day.run(`2026-07-${pad(d)}`, 110000, 132000, 50, 500);
  for (let d = 1; d <= 15; d++) hist.run(`2025-07-${pad(d)}`, 100000, 120000, 50);
  // trend target: both dept rows carry the SAME per-day figure — DISTINCT dedup must hold (a
  // doubled target would show −50% vs target; the dedup shows +0.0%)
  const bud = db.prepare(`INSERT INTO rota_ahead_budget VALUES (?,?,0.13,110000,1)`);
  for (let d = 6; d <= 12; d++) { bud.run(`2026-07-${pad(d)}`, 'kitchen'); bud.run(`2026-07-${pad(d)}`, 'foh'); }
  // rota verdicts: kitchen £830 UNDER (good) forward; foh £124.18 OVER (bad) hindsight
  db.prepare(`INSERT INTO rota_review_runs (mode, week_monday, ran_at, status, trigger, report_json) VALUES ('forward','2026-07-13',1,'ok','manual',?)`)
    .run(JSON.stringify({ verdicts: [{ dept: 'kitchen', deltaPence: -83000 }] }));
  db.prepare(`INSERT INTO rota_review_runs (mode, week_monday, ran_at, status, trigger, report_json) VALUES ('hindsight','2026-07-06',1,'ok','monday',?)`)
    .run(JSON.stringify({ verdicts: [{ dept: 'foh', deltaPence: 12418 }] }));
  // reconciliation: 3 recorded days; ONLY day_gross fails (the documented VAT-basis class) → clean
  const rec = db.prepare(`INSERT INTO sales_reconciliation VALUES (?,?,0,0,0,?,NULL,1)`);
  for (const d of ['2026-07-12', '2026-07-13', '2026-07-14']) { rec.run(d, 'day_gross', 0); rec.run(d, 'day_net', 1); }
  // per-receipt record, all ≤ 2026-07-12 → the 28d per-receipt window ends 07-12:
  //   EAT IN 2×£100/day + QR 5×£33/day over 07-06..12, one £50 ONLINE order on 07-10
  const insR = db.prepare(`INSERT INTO sales_receipts_api VALUES (?,?,?,0,?,?,1,?)`);
  const insL = db.prepare(`INSERT INTO sales_receipt_lines_api VALUES (?,?,?,?,?,?,1)`);
  for (let d = 6; d <= 12; d++) {
    const date = `2026-07-${pad(d)}`;
    const dinner = Date.UTC(2026, 6, d, 17, 30); // 18:30 London (BST) → DINNER
    for (let i = 0; i < 2; i++) {
      insR.run(`E${d}-${i}`, date, 'SALE', 'LOCAL', 10000, `Order ${10 + i}`); // device counter → own sitting each
      insL.run(`E${d}-${i}`, 'l1', date, 10000, i === 0 ? '27' : '17', dinner); // one drink line per day
    }
    // QR: 5 orders/day on 3 session slots (2+2+1) → 21 sittings, £33/order, £55/sitting
    for (let i = 0; i < 5; i++) insR.run(`Q${d}-${i}`, date, 'SALE', 'storekit_orderpay', 3300, `Order ${1 + Math.floor(i / 2)}`);
  }
  insR.run('OO-1', '2026-07-10', 'SALE', 'online', 5000, null);
  insL.run('OO-1', 'l1', '2026-07-10', 5000, '17', Date.UTC(2026, 6, 10, 18, 0));
}

/** Forecast world (per-receipt only): 2025 = £10,000/month ×12, 2026 Jan–Jun = £11,000/month —
 *  every pair 1.10 → full year = 1.1 × £120,000 = £132,000; override +5% journaled. */
function seedForecast(db, { override = null } = {}) {
  const insR = db.prepare(`INSERT INTO sales_receipts_api VALUES (?,?,?,0,'LOCAL',?,1,NULL)`);
  const insL2 = db.prepare(`INSERT INTO sales_api_ingest_runs VALUES (?,?,?,1,'',1)`);
  const cal = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  const month = (ym, net) => {
    insR.run(`R-${ym}`, `${ym}-01`, 'SALE', net);
    for (let d = 1; d <= cal(ym); d++) insL2.run(`${ym}-${pad(d)}`, 'kseries-sales-daily', 'ok');
  };
  for (let mo = 1; mo <= 12; mo++) month(`2025-${pad(mo)}`, 1000000);
  for (let mo = 1; mo <= 6; mo++) month(`2026-${pad(mo)}`, 1100000);
  if (override) db.prepare(`INSERT INTO forecast_overrides (pct, reason, created_at) VALUES (?,?,?)`).run(override.pct, override.reason, NOW);
}

const ctxFor = (db, query) => ({ q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, query: query || {} });
const render = (db, query) => {
  const ctx = ctxFor(db, query);
  return reports.render(reports.getSection(db, ctx), ctx).body;
};

// ---------------- (a) the shell ----------------

test('shell: default tab executive, ?tab=forecast switches, 5 links, everything inside .rcc', () => {
  const db = makeDb();
  seedExecutive(db);
  const body = render(db);
  assert.match(body, /class="r-tab active" href="\/coyote\/revenue\?tab=executive"/, 'executive is the default');
  assert.equal((body.match(/class="r-tab[ "]/g) || []).length, 5, '5 subtab links');
  for (const t of ['executive', 'drivers', 'menu', 'reconciliation', 'forecast']) assert.ok(body.includes(`href="/coyote/revenue?tab=${t}"`), `link to ${t}`);
  const fc = render(db, { tab: 'forecast' });
  assert.match(fc, /class="r-tab active" href="\/coyote\/revenue\?tab=forecast"/, '?tab=forecast switches');
  // the .rcc wrapper opens before EVERYTHING (styles + nav) and the body closes it
  const open = body.indexOf('<div class="rcc">');
  assert.ok(open === 0, 'the rcc wrapper encloses the whole page body');
  assert.ok(open < body.indexOf('class="r-tabs"'), 'tab nav inside the wrapper');
  assert.ok(body.trimEnd().endsWith('</div>'), 'wrapper closed');
  // garbage tab falls back to the default, never an error page
  assert.match(render(db, { tab: 'DROP TABLE' }), /class="r-tab active" href="\/coyote\/revenue\?tab=executive"/);
  db.close();
});

// ---------------- (b) Executive ----------------

test('executive KPIs: real week net/gross/ATV vs weekday-aligned LY; covers honest fallback when no OpenTable rows', () => {
  const db = makeDb();
  seedExecutive(db);
  const body = render(db);
  assert.match(body, /£7,700\.00/, 'week net = 7×£1,100');
  assert.match(body, /£9,240\.00/, 'week gross = 7×£1,320');
  assert.match(body, /£22\.00/, 'ATV = net ÷ txn');
  assert.match(body, /▲ 10\.0%/, 'delta vs the −364d weekday twin');
  assert.match(body, /2026-07-06 → 2026-07-12/, 'the window is named');
  // covers: this fixture holds NO covers_day rows → the tile is honest ('—', no fabricated digit).
  // The WIRED case (real covers + reserved/walk-in split) is proven in mission-control-covers-wire.test.js.
  const covers = body.match(/<div class="r-kpi-label">Covers<\/div>[\s\S]*?<\/div><\/div>/);
  assert.ok(covers, 'covers tile renders');
  assert.match(covers[0], /no covers this week/, 'honest — no OpenTable covers in the window');
  assert.match(covers[0], /OpenTable/);
  assert.doesNotMatch(covers[0], /\d/, 'covers tile carries no digits — POS guest-count is not covers');
  assert.match(body, /Average spend \/ cover/);
  assert.match(body, /not ruled/, 'quality score pending the operator ruling');
  db.close();
});

test('executive decision feed: rota £ verdicts (both modes), reconciliation line, QR gap, attach baseline', () => {
  const db = makeDb();
  seedExecutive(db);
  const body = render(db);
  assert.match(body, /Kitchen £830\.00 under formula budget/, 'forward verdict with its £');
  assert.match(body, /Foh £124\.18 over formula budget/, 'hindsight verdict with its £');
  assert.match(body, /see Rota Review/, 'the one-line action');
  assert.match(body, /reconciliation clean — 3 days, day_gross variance is the documented VAT-basis class/);
  // QR sitting basis (£38/order target retired 2026-07-31): 35 orders on 21 slot-sittings
  // @ £33/order → £55.00/sitting, vs EAT IN 14 tabs = 14 sittings @ £100.00/sitting
  assert.match(body, /QR £55\.00\/sitting vs EAT IN £100\.00/);
  assert.match(body, /21 QR sittings/, 'sitting count named');
  assert.match(body, /QR orders fragment per sitting/, 'the ruled caption');
  assert.match(body, /per-order ATV \(£33\.00, 35 txn\) understates spend/, 'per-order basis demoted to caption');
  assert.doesNotMatch(body, /£38 target/, 'the per-order target is retired');
  // attach: drink dict exists, first window → honest baseline note (7 of 50 receipts)
  assert.match(body, /Drink attachment 14\.0%/);
  assert.match(body, /first 28d window on record/);
  // a NON-day_gross failure flips the reconciliation line to a real finding
  db.prepare(`INSERT INTO sales_reconciliation VALUES ('2026-07-14','payment_sum',0,0,7,0,'x',1)`).run();
  assert.match(render(db), /1 reconciliation check failure\(s\)/);
  db.close();
});

test('executive daypart + donut: ONLINE exclusion £ stated; donut legend sums to the window total', () => {
  const db = makeDb();
  seedExecutive(db);
  const body = render(db);
  // daypart: all seeded lines are 18:30 London → DINNER; the £50 ONLINE order is excluded + stated
  assert.match(body, /£50\.00 ONLINE excluded — no true hour/);
  assert.match(body, /DINNER[\s\S]{0,400}?£1,400\.00 · 100%/, 'dinner carries the non-ONLINE line net');
  // donut: EAT 140000 + QR 115500 + ONLINE 5000 = 260500 across the 28d-to-apiMax window
  const rows = db.prepare(`SELECT SUM(net_without_tax_pence) n FROM sales_receipts_api WHERE cancelled=0 AND type='SALE' AND business_date BETWEEN '2026-06-15' AND '2026-07-12'`).get();
  assert.equal(Number(rows.n), 260500, 'fixture arithmetic');
  assert.ok(body.includes(`${gbp(260500)}<small>net · 28d</small>`), 'donut centre = the window total');
  for (const [label, net] of [['EAT IN', 140000], ['STOREKIT ORDER &amp; PAY', 115500], ['ONLINE ORDER', 5000]]) {
    assert.ok(body.includes(label), `${label} in the legend`);
    assert.ok(body.includes(gbp(net)), `${label} £ in the legend`);
  }
  assert.match(body, /window inside API-era coverage/);
  // trend: the per-dept duplicate target rows are DEDUPED → vs target +0.0%, not −50%
  assert.match(body, /\+0\.0%/, 'target dedup holds');
  db.close();
});

// ---------------- (c) Forecast ----------------

test('forecast: chips + hatched bars + the journaled override applied to FORECAST months only', () => {
  const db = makeDb();
  seedForecast(db, { override: { pct: 5, reason: 'price rise from July' } });
  const body = render(db, { tab: 'forecast' });
  assert.equal((body.match(/r-tag good">Actual/g) || []).length, 6, 'Jan–Jun Actual');
  assert.equal((body.match(/r-tag warn">Current/g) || []).length, 1, 'July Current');
  assert.equal((body.match(/r-tag info">Forecast/g) || []).length, 5, 'Aug–Dec Forecast');
  assert.equal((body.match(/r-mbar forecast/g) || []).length, 6, 'Jul–Dec hatched, never solid');
  // base = 6×£11,000 + 1.1×6×£10,000 = £132,000; +5% on the £66,000 forecast half = £135,300
  assert.match(body, /£132,000/, 'base full-year forecast');
  assert.match(body, /£135,300/, 'after adjustment — override scales forecast months only');
  assert.match(body, /override \+5\.0% applied to forecast months only/);
  // planning forecast months: 1.05 × £11,000 = £11,550
  assert.match(body, /£11,550<span class="hatch-sw"/);
  assert.match(body, /price rise from July/, 'the journaled reason renders');
  db.close();
});

test('forecast: override defaults to 0 (empty journal) and the control renders', () => {
  const db = makeDb();
  seedForecast(db);
  const body = render(db, { tab: 'forecast' });
  assert.match(body, /id="ov-range"[^>]*value="0"/, 'slider at 0 by default');
  assert.match(body, /override 0% — matches the base rule/);
  assert.match(body, /no overrides journaled yet/);
  assert.match(body, /a non-zero override needs its reason|non-zero needs its reason/, 'the ruling stated at the control');
  db.close();
});

test('applyForecastOverride: NEGATIVE CONTROL — non-zero without a reason refuses 400', () => {
  const db = makeDb();
  const r = applyForecastOverride(db, { pct: -5 }, NOW);
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(r.error, 'a non-zero override needs its reason');
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM forecast_overrides`).get().c, 0, 'nothing written');
  db.close();
});

test('applyForecastOverride: valid insert works; zero without reason journals as "reset"; range enforced', () => {
  const db = makeDb();
  const ok = applyForecastOverride(db, { pct: -5, reason: 'August closure week' }, NOW);
  assert.equal(ok.ok, true);
  const row = db.prepare(`SELECT pct, reason, created_at FROM forecast_overrides WHERE id = ?`).get(ok.id);
  assert.equal(row.pct, -5);
  assert.equal(row.reason, 'August closure week');
  assert.equal(row.created_at, NOW);
  const zero = applyForecastOverride(db, { pct: 0 }, NOW);
  assert.equal(zero.ok, true);
  assert.equal(db.prepare(`SELECT reason FROM forecast_overrides WHERE id = ?`).get(zero.id).reason, 'reset');
  assert.equal(applyForecastOverride(db, { pct: 60, reason: 'x' }, NOW).status, 400, '±50 hard wall');
  assert.equal(applyForecastOverride(db, { pct: 'NaN', reason: 'x' }, NOW).status, 400);
  db.close();
});

test('applyForecastOverride: absent table → honest 503 naming the missing deploy', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  const r = applyForecastOverride(db, { pct: 2, reason: 'x' }, NOW);
  assert.equal(r.status, 503);
  assert.match(r.error, /override store not deployed \(cc #86\)/);
  db.close();
});

// ---------------- (d) no mock numbers ----------------

test('NO-MOCK-NUMBERS: an EMPTY db renders ZERO £-figures on every built tab', () => {
  const db = makeDb(); // tables exist, no rows — the honest-empty worst case
  for (const tab of ['executive', 'drivers', 'forecast']) {
    const body = render(db, { tab });
    assert.doesNotMatch(body, /£\d/, `${tab}: no £-figure may render from an empty box`);
    assert.match(body, /not wired|no [a-z-]* ?record|record filling|pending/i, `${tab}: honest empty states name themselves`);
  }
  db.close();
});
