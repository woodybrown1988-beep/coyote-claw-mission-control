'use strict';
// RCC Stage 2 P3 — the RECONCILIATION tab. Every expected number is HAND-COMPUTED in the
// fixture comments, never re-derived through the module. Pinned here:
//   (a) KPI STRIP (28d to the per-receipt max): expected tenders = SUM(net_with_tax_pence),
//       gross basis, window-bounded (an out-of-window payment is a pinned negative control);
//       processed/banked = QB POSTED deposits UNMATCHED (deposit kind only — a 'purchase' row
//       must never count); gross variance = tenders − banked with the unmatched caveat;
//       PROCESSOR FEES = zero-digit (no fee field in the POS record); refunds at day grain +
//       the REFUND-receipt count; unresolved exceptions EXCLUDE day_gross (a seeded day_gross
//       fail is the pinned negative control — 2, never 3);
//   (b) TENDER-TO-BANK TABLE: one row per dict-named method (undictionaried code renders AS
//       the code, NULL code as '(no method)' — never dropped), Recorded tags, the POSTED-
//       deposit bank aggregate row tagged Unmatched (info), the mock's recon-total row;
//   (c) CONTROL FORMULAS: the six canonical rulings VERBATIM;
//   (d) BRIDGE: the mock's waterfall grammar; fixture obeys gross − discounts − comps −
//       refunds − voids + service − VAT = net EXACTLY (100000−2985−1500−1200−800+485−16000
//       = 78000); neg/total classes; the verified day-grain caption verbatim;
//   (e) LEDGER: day_gross → Documented (info, ruled-2026-07-20 tooltip), anything else →
//       Open (warn); owner 'box'; empty window → the batteries-green line;
//   (f) BANK ABSENT PATH + NO-MOCK-NUMBERS: the QB unlock named, zero digits fabricated.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const reports = require('../mission-control/ui/pages/coyote/reports.js');

const NOW = 1783000000000; // 2026-07 (the p1p4 anchor)

const DDL = `
CREATE TABLE premises_regime (name TEXT PRIMARY KEY, start_date TEXT, end_date TEXT, note TEXT);
CREATE TABLE sales_day (business_date TEXT PRIMARY KEY, net_sales_pence INTEGER, gross_sales_pence INTEGER, pos_guest_count INTEGER, transactions INTEGER, taxes_pence INTEGER, refunds_pence INTEGER, voids_pence INTEGER, discounts_pence INTEGER, comps_pence INTEGER, service_charges_pence INTEGER, tips_pence INTEGER, updated_at INTEGER);
CREATE TABLE sales_receipts_api (receipt_id TEXT PRIMARY KEY, business_date TEXT, type TEXT, cancelled INTEGER, account_profile_code TEXT, net_without_tax_pence INTEGER, updated_at INTEGER);
CREATE TABLE sales_api_ingest_runs (business_date TEXT, source TEXT, status TEXT, receipts INTEGER, detail TEXT, pulled_at INTEGER, PRIMARY KEY (business_date, source));
CREATE TABLE sales_channel_map_api (account_profile_code TEXT PRIMARY KEY, profile_name TEXT, delivery_mode TEXT, channel_label TEXT, first_seen INTEGER, updated_at INTEGER, label_source TEXT);
CREATE TABLE sales_payments_api (receipt_id TEXT NOT NULL, payment_seq INTEGER NOT NULL, business_date TEXT NOT NULL, code TEXT, payment_method_id TEXT, net_with_tax_pence INTEGER, tip_pence INTEGER, surcharge_pence INTEGER, updated_at INTEGER NOT NULL, PRIMARY KEY (receipt_id, payment_seq));
CREATE TABLE payment_methods_api (code TEXT PRIMARY KEY, name TEXT, pm_id TEXT, updated_at INTEGER NOT NULL);
CREATE TABLE sales_reconciliation (business_date TEXT NOT NULL, check_name TEXT NOT NULL, api_pence INTEGER, playwright_pence INTEGER, delta_pence INTEGER, passed INTEGER NOT NULL, finding TEXT, computed_at INTEGER NOT NULL, PRIMARY KEY (business_date, check_name));
CREATE TABLE qb_bank_txns (realm_id TEXT NOT NULL, txn_kind TEXT NOT NULL, txn_id TEXT NOT NULL, txn_date TEXT NOT NULL, bank_account_id TEXT, bank_account_name TEXT, total_pence INTEGER NOT NULL, counterparty TEXT, memo TEXT, lines_json TEXT, qb_updated TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (realm_id, txn_kind, txn_id));
`;

function makeDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(DDL);
  db.prepare(`INSERT INTO premises_regime VALUES ('previous','2022-02-20','2023-03-31',''),('current','2023-04-01',NULL,'moved')`).run();
  db.prepare(`INSERT INTO payment_methods_api VALUES
    ('LSPAY_ADYEN_TERMINAL_API_LOCAL','Lightspeed Payments','pm1',1),
    ('CASH','Cash','pm2',1),('STR','STOREKIT','pm3',1)`).run();
  return db;
}

/** Reconciliation world. Per-receipt max = 2026-07-11 → 28d window 2026-06-14..2026-07-11.
 *
 *  Tenders (sales_payments_api, gross basis):
 *    R1: Lightspeed Payments £100.00 (tip £5.00) + a split Cash £20.00 leg (surcharge £1.00)
 *    R2: STOREKIT £50.00 (tip £2.50)
 *    R3: code 'ZZZ' £3.00 — NOT in the dict → renders AS the code
 *    R4: NULL code £1.00 → '(no method)'
 *    R0: Cash £999.99 on 2026-06-13 — OUT of window, must never count
 *  → expected tenders = 100+20+50+3+1 = £174.00 over 5 payments; tips £7.50; surcharge £1.00.
 *
 *  Bank (qb_bank_txns): POSTED deposits £120.00 (07-10) + £30.00 (07-08) = £150.00 over 2;
 *    a £500.00 deposit on 2026-06-01 (out of window) and a £77.77 'purchase' (wrong kind)
 *    must never count. Gross variance = £174.00 − £150.00 = +£24.00 (sides UNMATCHED).
 *
 *  Day grain (sales_day 2026-07-10, the bridge identity hand-pinned):
 *    gross £1,000.00 − disc £29.85 − comps £15.00 − refunds £12.00 − voids £8.00
 *    + service £4.85 − VAT £160.00 = net £780.00 EXACTLY.
 *  Refunds KPI: £12.00 · 1 recorded day · 1 REFUND receipt (RF1).
 *
 *  Batteries (sales_reconciliation, in-window fails):
 *    07-10 day_gross +£812.39  → Documented (VAT/gross-basis class) — EXCLUDED from the count
 *    07-09 day_net   +£0.06    → Open
 *    07-08 pw_internal_net_eq_channel (NULL delta) → Open, delta '—'
 *    07-07 api_internal_net_eq_channel PASSED      → never in the ledger
 *    06-10 day_net (out of window)                 → never rendered
 *  → unresolved exceptions = 2 (day_gross excluded — 3 would be the bug). */
function seedRecon(db, { bank = true } = {}) {
  const insR = db.prepare(`INSERT INTO sales_receipts_api VALUES (?,?,?,0,'LOCAL',?,1)`);
  insR.run('R1', '2026-07-10', 'SALE', 12000);
  insR.run('R2', '2026-07-09', 'SALE', 5000);
  insR.run('R3', '2026-07-11', 'SALE', 300);
  insR.run('R4', '2026-07-08', 'SALE', 100);
  insR.run('RF1', '2026-07-10', 'REFUND', -1200);
  insR.run('R0', '2026-06-13', 'SALE', 99999);
  const insP = db.prepare(`INSERT INTO sales_payments_api VALUES (?,?,?,?,?,?,?,?,1)`);
  insP.run('R1', 0, '2026-07-10', 'LSPAY_ADYEN_TERMINAL_API_LOCAL', 'pm1', 10000, 500, 0);
  insP.run('R1', 1, '2026-07-10', 'CASH', 'pm2', 2000, 0, 100);
  insP.run('R2', 0, '2026-07-09', 'STR', 'pm3', 5000, 250, 0);
  insP.run('R3', 0, '2026-07-11', 'ZZZ', null, 300, 0, 0);
  insP.run('R4', 0, '2026-07-08', null, null, 100, 0, 0);
  insP.run('R0', 0, '2026-06-13', 'CASH', 'pm2', 99999, 0, 0);
  if (bank) {
    const insB = db.prepare(`INSERT INTO qb_bank_txns VALUES ('realm',?,?,?,'63','Santander',?,NULL,NULL,NULL,NULL,1)`);
    insB.run('deposit', 'd1', '2026-07-10', 12000);
    insB.run('deposit', 'd2', '2026-07-08', 3000);
    insB.run('deposit', 'd0', '2026-06-01', 50000); // out of window
    insB.run('purchase', 'p1', '2026-07-09', 7777); // wrong kind — never takings
  }
  db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence, gross_sales_pence, transactions, taxes_pence, refunds_pence, voids_pence, discounts_pence, comps_pence, service_charges_pence, updated_at)
    VALUES ('2026-07-10', 78000, 100000, 50, 16000, 1200, 800, 2985, 1500, 485, 1)`).run();
  const insC = db.prepare(`INSERT INTO sales_reconciliation VALUES (?,?,0,0,?,?,?,1)`);
  insC.run('2026-07-10', 'day_gross', 81239, 0, 'gross−net VAT basis (the documented class)');
  insC.run('2026-07-09', 'day_net', 6, 0, 'past-midnight receipts — business-day boundary');
  insC.run('2026-07-08', 'pw_internal_net_eq_channel', null, 0, null);
  insC.run('2026-07-07', 'api_internal_net_eq_channel', 0, 1, null);
  insC.run('2026-06-10', 'day_net', 999, 0, 'out of window');
}

const render = (db) => {
  const ctx = { q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, query: { tab: 'reconciliation' } };
  return reports.render(reports.getSection(db, ctx), ctx).body;
};

// ---------------- (a) the KPI strip ----------------

test('KPI strip: tenders sum window-bounded, banked = POSTED deposits only, variance, refunds, sources captioned', () => {
  const db = makeDb();
  seedRecon(db);
  const body = render(db);
  // £100 + £20 + £50 + £3 + £1 = £174.00 over 5 payments — the 06-13 £999.99 never counts
  assert.match(body, /Expected tenders<\/div><div class="r-kpi-value">£174\.00</, 'the hand-computed tender sum');
  assert.match(body, /gross basis \(inc VAT\) · 5 payment\(s\) · sales_payments_api/, 'the basis is captioned');
  assert.doesNotMatch(body, /£999\.99/, 'the out-of-window payment is a pinned negative control');
  // banked: £120 + £30 = £150.00 over 2 POSTED deposits; the purchase (£77.77) and the
  // out-of-window deposit (£500.00) never count
  assert.match(body, /Processed \/ banked<\/div><div class="r-kpi-value">£150\.00</);
  assert.match(body, /QB POSTED deposits — unmatched to tenders \(match build pending\) · 2 deposit\(s\)/);
  assert.doesNotMatch(body, /£77\.77/, 'a purchase-kind bank txn is never takings');
  assert.doesNotMatch(body, /£650\.00/, 'the out-of-window deposit never joins the sum');
  // variance = £174.00 − £150.00 = +£24.00, carried with the unmatched caveat
  assert.match(body, /Gross variance<\/div><div class="r-kpi-value">\+£24\.00</);
  assert.match(body, /sides UNMATCHED — payout timing \+ non-sales deposits included until the match build/);
  // refunds: day grain £12.00 + the REFUND receipt count
  assert.match(body, /Refunds · 28d<\/div><div class="r-kpi-value">£12\.00</);
  assert.match(body, /sales_day day grain · 1 recorded day\(s\) · 1 REFUND receipt\(s\)/);
  // the strip names its window + sources once
  assert.match(body, /28d to 2026-07-11 \(per-receipt max\)/);
  db.close();
});

test('unresolved exceptions EXCLUDE day_gross — the pinned negative control (2, never 3)', () => {
  const db = makeDb();
  seedRecon(db);
  const body = render(db);
  assert.match(body, /Unresolved exceptions<\/div><div class="r-kpi-value">2</, 'day_net + pw_internal fails only');
  assert.doesNotMatch(body, /Unresolved exceptions<\/div><div class="r-kpi-value">3/, 'counting day_gross = the bug');
  assert.match(body, /day_gross documented class excluded/, 'the exclusion is stated, not silent');
  db.close();
});

test('processor fees: zero-digit not-wired tile — no fee field exists in the POS record', () => {
  const db = makeDb();
  seedRecon(db);
  const body = render(db);
  const tile = body.match(/<div class="r-kpi-label">Processor fees<\/div>[\s\S]*?<\/div><\/div>/);
  assert.ok(tile, 'the tile renders');
  assert.match(tile[0], /no source/);
  assert.match(tile[0], /statement\/QB fact/);
  assert.doesNotMatch(tile[0], /\d/, 'no fee field in the POS record — no digits at all');
  db.close();
});

// ---------------- (b) the tender-to-bank table ----------------

test('tender table: dict-named method rows (fallbacks pinned), Recorded tags, the Unmatched bank row, total row', () => {
  const db = makeDb();
  seedRecon(db);
  const body = render(db);
  assert.match(body, /<td>Lightspeed Payments<\/td><td class="r-num mono">£100\.00<\/td><td class="r-num mono">1<\/td><td class="r-num mono">£5\.00</, 'dict-named row with tips');
  assert.match(body, /<td>Cash<\/td><td class="r-num mono">£20\.00<\/td><td class="r-num mono">1<\/td><td class="r-num mono">£0\.00<\/td><td class="r-num mono">£1\.00</, 'the split-payment Cash leg with its surcharge');
  assert.match(body, /<td>STOREKIT<\/td><td class="r-num mono">£50\.00</);
  // the merge bug pinned: grouping on a bare `name` resolves to m.name (NULL for BOTH
  // fallback rows) and silently merges ZZZ with (no method) → £4.00 over 2 txns
  assert.match(body, /<td>ZZZ<\/td><td class="r-num mono">£3\.00<\/td><td class="r-num mono">1</, 'an undictionaried code renders AS the code, never dropped, never merged');
  assert.match(body, /<td>\(no method\)<\/td><td class="r-num mono">£1\.00<\/td><td class="r-num mono">1</, 'a NULL code renders as (no method), never dropped, never merged');
  assert.doesNotMatch(body, /£4\.00/, 'the fallback rows must never merge into one method');
  assert.equal((body.match(/<span class="r-tag">Recorded<\/span>/g) || []).length, 5, 'one Recorded tag per method row');
  // the bank side: one UNMATCHED aggregate row — no per-method attribution exists yet
  assert.match(body, /QB POSTED deposits <span class="ash">\(bank side\)<\/span>/);
  assert.match(body, /title="POSTED deposits in the window — no tender↔deposit match yet \(the match build is future work\)"><span class="r-tag info">Unmatched<\/span>/);
  // the mock's recon-total row
  assert.match(body, /recon-total"><span>Total<\/span><span class="mono">£174\.00 tendered · £150\.00 banked · variance \+£24\.00 \(unmatched\)<\/span>/);
  // amt DESC ordering: Lightspeed (£100) before STOREKIT (£50) before Cash (£20)
  assert.ok(body.indexOf('<td>Lightspeed Payments</td>') < body.indexOf('<td>STOREKIT</td>'), 'ordered by tendered £');
  assert.ok(body.indexOf('<td>STOREKIT</td>') < body.indexOf('<td>Cash</td>'));
  db.close();
});

test('bank ABSENT path: not-wired tile names the QB unlock, variance not computable, bank empty-state — zero fabricated digits', () => {
  const db = makeDb();
  seedRecon(db, { bank: false });
  const body = render(db);
  const tile = body.match(/<div class="r-kpi-label">Processed \/ banked<\/div>[\s\S]*?<\/div><\/div>/);
  assert.ok(tile, 'the tile renders');
  assert.match(tile[0], /not wired/);
  assert.match(tile[0], /QuickBooks statement wire — POSTED deposits \(qb_bank_txns\)/, 'the unlock is named');
  assert.doesNotMatch(tile[0], /\d/, 'no deposits recorded — no digits at all');
  assert.match(body, /Gross variance<\/div><div class="r-kpi-value">not computable</);
  assert.match(body, /needs both sides real — tenders and banked deposits/);
  // the table keeps its tender truth; the bank side is the designed empty-state
  assert.match(body, /Expected tenders<\/div><div class="r-kpi-value">£174\.00</, 'tenders stay real');
  assert.match(body, /<b>Bank side<\/b> — not wired\./);
  assert.match(body, /Unlock: the QuickBooks statement wire \(qb_bank_txns POSTED deposits\)/);
  assert.doesNotMatch(body, /Unmatched/, 'no bank row without bank data');
  assert.doesNotMatch(body, /£150\.00/, 'no banked figure may appear');
  db.close();
});

// ---------------- (c) the control formulas ----------------

test('control formulas: the six canonical rulings VERBATIM', () => {
  const db = makeDb();
  seedRecon(db);
  const body = render(db);
  for (const line of [
    'day net (ex-VAT) = SUM(net_without_tax_pence) over non-cancelled SALE receipts',
    'ATV = net ÷ transactions · ex-VAT · sales_by_channel basis',
    'QR = STOREKIT ORDER &amp; PAY',
    'gross = net + VAT; day_gross deltas vs the scraper eras = DOCUMENTED VAT-basis class (ruled 2026-07-20)',
    'covers ≠ POS guest count (OpenTable only)',
    'single-writer: values live in the DB; docs carry pointers',
  ]) assert.ok(body.includes(line), `verbatim ruling: ${line.slice(0, 40)}`);
  assert.match(body, /the rulings the batteries enforce/, 'the panel sub');
  db.close();
});

// ---------------- (d) the gross-to-net bridge ----------------

test('bridge: hand-pinned waterfall — gross − parts − VAT = net exactly; neg/total classes; the verified day-grain caption', () => {
  const db = makeDb();
  seedRecon(db);
  const body = render(db);
  // 100000 − 2985 − 1500 − 1200 − 800 + 485 − 16000 = 78000 (the fixture identity)
  assert.match(body, /wf-val">£1,000\.00<\/div><\/div><div class="wf-lab">Gross sales inc VAT/);
  assert.match(body, /wf-val">−£29\.85<\/div><\/div><div class="wf-lab">Discounts/, 'the known-discount-day figure at day grain');
  assert.match(body, /wf-val">−£15\.00<\/div><\/div><div class="wf-lab">Comps/);
  assert.match(body, /wf-val">−£12\.00<\/div><\/div><div class="wf-lab">Refunds/);
  assert.match(body, /wf-val">−£8\.00<\/div><\/div><div class="wf-lab">Voids/);
  assert.match(body, /wf-val">\+£4\.85<\/div><\/div><div class="wf-lab">Service charges/);
  assert.match(body, /wf-val">£780\.00<\/div><\/div><div class="wf-lab">Net revenue ex VAT/);
  // bars scale to gross (175px = the mock's tallest); classes carry the mock's grammar
  assert.match(body, /style="height:175px"><div class="wf-val">£1,000\.00/, 'gross = the full bar');
  assert.equal((body.match(/wf-col neg/g) || []).length, 4, 'discounts/comps/refunds/voids grey');
  assert.equal((body.match(/wf-col total/g) || []).length, 1, 'net = the green total');
  // the VAT split + the VERIFIED day-grain statement (known-discount-day cross-check)
  assert.match(body, /VAT in window £160\.00/);
  assert.match(body, /per-receipt discount attribution not populated by the wire; day grain \(verified against known-discount days\)/);
  db.close();
});

// ---------------- (e) the exception ledger ----------------

test('ledger: day_gross → Documented (ruled tooltip), others → Open; NULL delta honest; owner box; passed rows absent', () => {
  const db = makeDb();
  seedRecon(db);
  const body = render(db);
  assert.match(body, /<td class="mono">2026-07-10<\/td><td class="mono"[^>]*>day_gross<\/td><td class="r-num mono">\+£812\.39<\/td><td>box<\/td><td><span title="VAT\/gross-basis class, ruled 2026-07-20"><span class="r-tag info">Documented<\/span>/, 'the documented class is CLASSED, never open');
  assert.match(body, /<td class="mono">2026-07-09<\/td><td class="mono"[^>]*>day_net<\/td><td class="r-num mono">\+£0\.06<\/td><td>box<\/td><td><span class="r-tag warn">Open<\/span>/);
  assert.match(body, /pw_internal_net_eq_channel<\/td><td class="r-num mono">—<\/td>/, 'a NULL delta renders — not £0.00');
  assert.doesNotMatch(body, /api_internal_net_eq_channel/, 'a passed check never enters the ledger');
  assert.doesNotMatch(body, /2026-06-10/, 'out-of-window fails never render');
  assert.match(body, /r-tag warn">2 open</, 'the head count = open fails, day_gross excluded');
  assert.match(body, /owner ‘box’ = the battery raised it — owner\/assignment lands with the workflow build/);
  db.close();
});

test('ledger empty window: the batteries-green line — only when batteries actually recorded', () => {
  const db = makeDb();
  db.prepare(`INSERT INTO sales_receipts_api VALUES ('R3','2026-07-11','SALE',0,'LOCAL',300,1)`).run();
  db.prepare(`INSERT INTO sales_reconciliation VALUES ('2026-07-10','day_net',0,0,0,1,NULL,1)`).run();
  const body = render(db);
  assert.match(body, /no exceptions in the window — batteries green/);
  assert.match(body, /1 recorded day\(s\) of battery checks, all passed/);
  db.close();
});

// ---------------- (f) one-home + no mock numbers ----------------

test('ONE-HOME: the pending banner + parked payments/exceptions grammar is GONE from this tab', () => {
  const db = makeDb();
  seedRecon(db);
  const body = render(db);
  assert.doesNotMatch(body, /Phase 3 pending/, 'the phase banner is deleted');
  assert.doesNotMatch(body, /sec-label">Payments/, 'the parked flash payments table is deleted');
  assert.doesNotMatch(body, /rp-grid/, 'the parked exceptions tile grid is deleted');
  assert.doesNotMatch(body, /tab=reconciliation&amp;period=/, 'no period-nav on the built tab');
  db.close();
});

test('NO-MOCK-NUMBERS: an EMPTY db renders ZERO £-figures on the reconciliation tab', () => {
  const db = makeDb(); // tables exist, no rows — the honest-empty worst case
  const body = render(db);
  assert.doesNotMatch(body, /£\d/, 'no £-figure may render from an empty box');
  assert.match(body, /No per-receipt payment record yet/, 'the strip names its blocker');
  assert.match(body, /not wired|not computable|no source/, 'honest empty states name themselves');
  db.close();
});
