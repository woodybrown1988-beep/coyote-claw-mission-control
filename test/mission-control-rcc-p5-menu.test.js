'use strict';
// RCC Stage 2 P5 — the MENU GROWTH tab (the LAST pending tab, built to its honest GATE-STATE:
// recipe_lines = 0 — the Calum gate). Every expected number is HAND-COMPUTED in the fixture
// comments, never re-derived through the module. Pinned here:
//   (a) KPI STRIP (28d to the per-receipt max): products selling = distinct SKUs with positive
//       window net (a zero-net modifier SKU is the pinned negative control — 4, never 5);
//       menu movers = |Δ 28d net| ≥ 25% AND ≥ £100 vs the prior 28d (BOTH conditions — a
//       25.0%-exactly-but-£80 swing is the pinned decoy; a new/stopped product counts when its
//       swing clears £100), captioned as a presentation cut, not a ruling; £-at-risk + dogs =
//       contribution-GATED tiles whose VALUE carries zero digits;
//   (b) PORTFOLIO: the mock's quadrant matrix as the DESIGNED EMPTY-STATE — four labelled
//       tinted quadrants, NO bubbles, the blocker (recipe_lines is empty) + the ONE unlock
//       line + the /coyote/recipes link inside; the classification key = definitional TEXT;
//   (c) DECLINE WATCH: top net declines ≥ £50 vs the prior 28d (a £40 decline is the pinned
//       below-floor decoy), a stopped seller shows its TRUE £0.00 window net, the action
//       column is the honest generic (contribution unknown until costing);
//   (d) PERFORMANCE TABLE: SKU-consolidation (MAX(name) label — the variant name never
//       renders), units/net/mix/trend/YoY hand-pinned, YoY window-bounded (an out-of-LY-window
//       record is the pinned decoy), every contribution cell 'not costed' (zero digits),
//       every class chip Pending; VOID/cancelled receipts never count (SALE_WHERE);
//   (e) ONE-HOME DELETIONS: the pending banner + category-performance + best/slowest sellers
//       + the period-nav machinery are GONE from this page;
//   (f) NO-MOCK-NUMBERS: an EMPTY db renders ZERO £-figures; the Calum gate renders anyway.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const reports = require('../mission-control/ui/pages/coyote/reports.js');

const NOW = 1783000000000; // 2026-07 (the p1p4 anchor)
const UNLOCK = 'recipe costing: top-20 = 59.5% coverage, one session';

// The REAL production column shape (src/schema.sql) — P5 consumes sku/name/quantity, so this
// fixture carries them (the P2/P3 fixtures predate the columns and never select them).
const DDL = `
CREATE TABLE premises_regime (name TEXT PRIMARY KEY, start_date TEXT, end_date TEXT, note TEXT);
CREATE TABLE sales_day (business_date TEXT PRIMARY KEY, net_sales_pence INTEGER, gross_sales_pence INTEGER, pos_guest_count INTEGER, transactions INTEGER, taxes_pence INTEGER, refunds_pence INTEGER, voids_pence INTEGER, discounts_pence INTEGER, comps_pence INTEGER, service_charges_pence INTEGER, tips_pence INTEGER, updated_at INTEGER);
CREATE TABLE sales_receipts_api (receipt_id TEXT PRIMARY KEY, business_date TEXT, type TEXT, cancelled INTEGER, account_profile_code TEXT, net_without_tax_pence INTEGER, updated_at INTEGER);
CREATE TABLE sales_receipt_lines_api (receipt_id TEXT NOT NULL, line_id TEXT NOT NULL, parent_line_id TEXT, business_date TEXT NOT NULL, sku TEXT, name TEXT, quantity REAL, net_with_tax_pence INTEGER, net_without_tax_pence INTEGER, tax_pence INTEGER, discount_pence INTEGER, accounting_group TEXT, time_of_sale_ms INTEGER, updated_at INTEGER NOT NULL, PRIMARY KEY (receipt_id, line_id));
CREATE TABLE sales_api_ingest_runs (business_date TEXT, source TEXT, status TEXT, receipts INTEGER, detail TEXT, pulled_at INTEGER, PRIMARY KEY (business_date, source));
CREATE TABLE sales_channel_map_api (account_profile_code TEXT PRIMARY KEY, profile_name TEXT, delivery_mode TEXT, channel_label TEXT, first_seen INTEGER, updated_at INTEGER, label_source TEXT);
CREATE TABLE acct_groups_api (code TEXT PRIMARY KEY, name TEXT, statistic_group TEXT, updated_at INTEGER);
`;

function makeDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(DDL);
  db.prepare(`INSERT INTO premises_regime VALUES ('previous','2022-02-20','2023-03-31',''),('current','2023-04-01',NULL,'moved')`).run();
  return db;
}

/** Menu world. Per-receipt max = 2026-07-11 → 28d window 2026-06-14..07-11; prior window
 *  2026-05-17..06-13; LY window (−364d) 2025-06-15..2025-07-12.
 *
 *  Current-window products (SKU → lines):
 *    BURG  £400.00 / 40u — TWO name variants sharing the SKU: 'Bacon Cheeseburger' (£300, 30u)
 *          + 'Bacon Cheese Burger (Single)' (£100, 10u) → ONE row, MAX(name) label
 *          'Bacon Cheeseburger' (lexicographic max), the variant name NEVER renders
 *    FRIES £150.00 / 30u ('OG Dirty Fries')
 *    NEWP  £110.00 / 11u ('Vegan BBQ') — absent from the prior window (new)
 *    SHAKE  £80.00 / 16u ('Oreo Shake')
 *    ZMOD    £0.00 /  1u ('Plain Bun add-on') — zero-net modifier SKU → EXCLUDED everywhere
 *    X1 cancelled=1 £999.00 ('Cancelled Burger') + X2 type=VOID £555.00 ('Void Burger')
 *      → SALE_WHERE decoys, must never render anywhere
 *
 *  Prior window (2026-06-01): BURG £320.00 · FRIES £300.00 · SHAKE £120.00 · WING £200.00
 *    ('Hangry Bird' — sells to ZERO in the current window).
 *
 *  LY window (2025-07-01): BURG £250.00 · SHAKE £80.00.
 *  LY DECOY (2025-06-01 — BEFORE the LY window opens): FRIES £100.00 → FRIES YoY must stay '—'.
 *
 *  HAND-COMPUTED:
 *    products selling = 4 (BURG FRIES NEWP SHAKE; ZMOD excluded — 5 = the bug)
 *    movers (|Δ| ≥ 25% AND ≥ £100): FRIES −£150 ✓ · WING −£200 ✓ · NEWP +£110 (new) ✓
 *      · BURG +£80 = 25.0% EXACTLY but < £100 → NOT a mover (4 = the bug) · SHAKE −£40 ✗ → 3
 *    decline watch (≥ £50 floor): WING £200→£0 (−100.0%) then FRIES £300→£150 (−50.0%);
 *      SHAKE's £40 decline is BELOW the floor → absent → '2 declining'
 *    table (net desc, total £740.00): BURG 40u £400.00 mix 54.1% trend +25.0% (400/320)
 *      YoY +60.0% (400/250) · FRIES 30u £150.00 mix 20.3% trend −50.0% YoY '—' (decoy outside
 *      the LY window) · NEWP 11u £110.00 mix 14.9% trend '—' (no prior) YoY '—' · SHAKE 16u
 *      £80.00 mix 10.8% trend −33.3% YoY +0.0% (80/80) */
function seedMenu(db) {
  const insR = db.prepare(`INSERT INTO sales_receipts_api VALUES (?,?,?,?,'LOCAL',?,1)`);
  const insL = db.prepare(`INSERT INTO sales_receipt_lines_api (receipt_id, line_id, business_date, sku, name, quantity, net_without_tax_pence, updated_at) VALUES (?,?,?,?,?,?,?,1)`);
  // current window
  insR.run('A', '2026-07-10', 'SALE', 0, 30000);
  insL.run('A', 'l1', '2026-07-10', 'BURG', 'Bacon Cheeseburger', 30, 30000);
  insR.run('B', '2026-07-11', 'SALE', 0, 10000); // sets the per-receipt max
  insL.run('B', 'l1', '2026-07-11', 'BURG', 'Bacon Cheese Burger (Single)', 10, 10000);
  insR.run('C', '2026-07-05', 'SALE', 0, 15000);
  insL.run('C', 'l1', '2026-07-05', 'FRIES', 'OG Dirty Fries', 30, 15000);
  insR.run('D', '2026-07-06', 'SALE', 0, 8000);
  insL.run('D', 'l1', '2026-07-06', 'SHAKE', 'Oreo Shake', 16, 8000);
  insR.run('E', '2026-07-08', 'SALE', 0, 11000);
  insL.run('E', 'l1', '2026-07-08', 'NEWP', 'Vegan BBQ', 11, 11000);
  insR.run('F', '2026-07-09', 'SALE', 0, 0);
  insL.run('F', 'l1', '2026-07-09', 'ZMOD', 'Plain Bun add-on', 1, 0); // zero-value modifier
  insR.run('X1', '2026-07-10', 'SALE', 1, 99900); // cancelled — never counts
  insL.run('X1', 'l1', '2026-07-10', 'DEC1', 'Cancelled Burger', 1, 99900);
  insR.run('X2', '2026-07-10', 'VOID', 0, 55500); // VOID type — never counts
  insL.run('X2', 'l1', '2026-07-10', 'DEC2', 'Void Burger', 1, 55500);
  // prior window
  insR.run('P1', '2026-06-01', 'SALE', 0, 32000);
  insL.run('P1', 'l1', '2026-06-01', 'BURG', 'Bacon Cheeseburger', 32, 32000);
  insR.run('P2', '2026-06-01', 'SALE', 0, 30000);
  insL.run('P2', 'l1', '2026-06-01', 'FRIES', 'OG Dirty Fries', 60, 30000);
  insR.run('P3', '2026-06-01', 'SALE', 0, 12000);
  insL.run('P3', 'l1', '2026-06-01', 'SHAKE', 'Oreo Shake', 24, 12000);
  insR.run('P4', '2026-06-01', 'SALE', 0, 20000);
  insL.run('P4', 'l1', '2026-06-01', 'WING', 'Hangry Bird', 20, 20000);
  // LY window + the out-of-LY-window decoy
  insR.run('L1', '2025-07-01', 'SALE', 0, 25000);
  insL.run('L1', 'l1', '2025-07-01', 'BURG', 'Bacon Cheeseburger', 25, 25000);
  insR.run('L2', '2025-07-01', 'SALE', 0, 8000);
  insL.run('L2', 'l1', '2025-07-01', 'SHAKE', 'Oreo Shake', 16, 8000);
  insR.run('L3', '2025-06-01', 'SALE', 0, 10000); // BEFORE 2025-06-15 — outside the LY window
  insL.run('L3', 'l1', '2025-06-01', 'FRIES', 'OG Dirty Fries', 20, 10000);
}

const render = (db) => {
  const ctx = { q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, query: { tab: 'menu' } };
  return reports.render(reports.getSection(db, ctx), ctx).body;
};

// ---------------- (a) the KPI strip ----------------

test('KPI strip: products selling excludes the zero-net modifier SKU (4, never 5); sources captioned', () => {
  const db = makeDb();
  seedMenu(db);
  const body = render(db);
  assert.match(body, /Products selling<\/div><div class="r-kpi-value">4</, 'BURG + FRIES + NEWP + SHAKE');
  assert.doesNotMatch(body, /Products selling<\/div><div class="r-kpi-value">5/, 'counting ZMOD = the bug');
  assert.match(body, /distinct SKUs with positive 28d net · line grain/, 'the basis is captioned');
  assert.match(body, /28d to 2026-07-11 \(per-receipt max\) vs prior 28d · line grain \(sales_receipt_lines_api — product truth from 2023-07\)/, 'window + source named once');
  assert.match(body, /grouped by SKU \(renamed variants consolidated; MAX\(name\) labels the row\)/);
  db.close();
});

test('menu movers: BOTH thresholds pinned — the 25.0%-exactly-but-£80 swing is NOT a mover (3, never 4)', () => {
  const db = makeDb();
  seedMenu(db);
  const body = render(db);
  // FRIES (−£150) + WING (−£200, stopped) + NEWP (+£110, new) = 3; BURG's +£80 is exactly
  // 25.0% of £320 but below the £100 floor — counting it (4) = the bug
  assert.match(body, /Menu movers<\/div><div class="r-kpi-value">3</, 'the hand-computed count');
  assert.doesNotMatch(body, /Menu movers<\/div><div class="r-kpi-value">4/, 'the £100 floor is a separate AND');
  assert.match(body, /≥ 25% and ≥ £100 vs prior 28d — presentation cut, not a ruling/, 'thresholds captioned as presentation, never a ruling');
  db.close();
});

test('£-at-risk + dogs: contribution-GATED tiles — the VALUE carries zero digits, the unlock line rides the sub', () => {
  const db = makeDb();
  seedMenu(db);
  const body = render(db);
  assert.match(body, /Weekly revenue at risk<\/div><div class="r-kpi-value">needs costing<\/div>/, 'no £-at-risk figure exists without contribution');
  assert.match(body, /Dogs<\/div><div class="r-kpi-value">needs costing<\/div>/, 'no dog count exists without classification');
  assert.match(body, /needs contribution — the Calum gate \(recipe_lines is empty\)/);
  assert.match(body, /classification needs contribution — the Calum gate/);
  // the ONE unlock line appears on EVERY contribution-gated surface: at-risk tile, dogs tile,
  // the portfolio empty-state, the performance-table caption = exactly 4
  assert.equal(body.split(UNLOCK).length - 1, 4, 'the unlock line rides every gated panel');
  db.close();
});

// ---------------- (b) the portfolio (designed empty-state) ----------------

test('portfolio: four labelled tinted quadrants, NO bubbles, the Calum blocker + unlock + recipes link inside', () => {
  const db = makeDb();
  seedMenu(db);
  const body = render(db);
  assert.match(body, /class="quad opportunity"><strong>OPPORTUNITIES \/ PUZZLES<\/strong><br>High contribution · low popularity/);
  assert.match(body, /class="quad winner"><strong>WINNERS \/ STARS<\/strong><br>High contribution · high popularity/);
  assert.match(body, /class="quad dog"><strong>DOGS<\/strong><br>Low contribution · low popularity/);
  assert.match(body, /class="quad workhorse"><strong>WORKHORSES \/ PLOWHORSES<\/strong><br>Low contribution · high popularity/);
  assert.equal((body.match(/class="bubble/g) || []).length, 0, 'NO bubbles — placement needs contribution');
  assert.match(body, /portfolio placement needs per-item contribution — recipe_lines is empty \(the Calum gate\)/, 'the blocker is named');
  assert.match(body, new RegExp(`Unlock: ${UNLOCK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), 'the unlock line inside the empty-state');
  assert.match(body, /class="r-worklist-link" href="\/coyote\/recipes"/, 'the live recipes-worklist link');
  // the axis labels are structural text of the designed state
  assert.match(body, /class="axis-y">Contribution profit \/ item</);
  assert.match(body, /class="axis-x">Sales popularity →</);
  db.close();
});

test('classification key: the four class-cards render definitional TEXT — no numbers', () => {
  const db = makeDb();
  seedMenu(db);
  const body = render(db);
  const start = body.indexOf('<div class="classification-key">');
  const end = body.indexOf('Same-period decline watch');
  assert.ok(start >= 0 && end > start, 'the key renders inside the portfolio panel');
  const key = body.slice(start, end);
  assert.equal((key.match(/class="class-card"/g) || []).length, 4, 'four class-cards');
  assert.match(key, /Winners<\/h4><p>Protect availability, feature prominently/);
  assert.match(key, /Workhorses<\/h4><p>Keep because guests want them/);
  assert.match(key, /Opportunities<\/h4><p>Profitable but under-ordered/);
  assert.match(key, /Dogs<\/h4><p>Low popularity and weak economics/);
  assert.doesNotMatch(key.replace(/<[^>]*>/g, ''), /\d/, 'definitional text only — never a number');
  db.close();
});

// ---------------- (c) the decline watch ----------------

test('decline watch: seeded declines hand-pinned in order; a stopped seller shows its TRUE £0.00; the £40 decoy stays out', () => {
  const db = makeDb();
  seedMenu(db);
  const body = render(db);
  const panel = body.slice(body.indexOf('Same-period decline watch'), body.indexOf('Canonical product performance'));
  // WING £200→£0 = the biggest decline, first; its window net truly IS zero (line-ledger fact)
  assert.match(panel, /<strong>Hangry Bird<\/strong><\/div>\s*<div class="r-num mono">£200\.00<\/div><div class="r-num mono">£0\.00<\/div>\s*<div class="r-num mono r-down">−100\.0%<\/div>/, 'the stopped seller leads');
  assert.match(panel, /<strong>OG Dirty Fries<\/strong><\/div>\s*<div class="r-num mono">£300\.00<\/div><div class="r-num mono">£150\.00<\/div>\s*<div class="r-num mono r-down">−50\.0%<\/div>/);
  assert.ok(panel.indexOf('Hangry Bird') < panel.indexOf('OG Dirty Fries'), 'ordered by £ decline, biggest first');
  // SHAKE's £40 decline is below the £50 floor — the pinned below-floor decoy
  assert.doesNotMatch(panel, /Oreo Shake/, 'a below-floor decline never renders in the watch');
  assert.match(panel, /r-tag bad">2 declining</, 'the head count = rows shown');
  // the action column is the HONEST GENERIC — per-product actions need contribution
  assert.equal((panel.match(/check price\/portion\/menu placement — contribution unknown until costing/g) || []).length, 2, 'one generic action per row, nothing invented');
  assert.match(panel, /≥ £50 \(presentation floor, not a ruling\)/, 'the floor is captioned');
  db.close();
});

// ---------------- (d) the performance table ----------------

test('performance table: SKU-consolidation + units/net/mix/trend/YoY hand-pinned; the variant name never renders', () => {
  const db = makeDb();
  seedMenu(db);
  const body = render(db);
  // BURG: ONE consolidated row — 40u, £400.00, mix 400/740 = 54.1%, trend 400/320 = +25.0%,
  // YoY 400/250 = +60.0%
  assert.match(body, /<td>Bacon Cheeseburger<\/td>\s*<td class="r-num mono">40<\/td>\s*<td class="r-num mono">£400\.00<\/td>\s*<td class="r-num mono">54\.1%<\/td>\s*<td class="r-num mono"><span class="r-up">\+25\.0%<\/span><\/td>\s*<td class="r-num mono"><span class="r-up">\+60\.0%<\/span><\/td>/, 'the consolidated row, hand-computed');
  assert.doesNotMatch(body, /Bacon Cheese Burger \(Single\)/, 'MAX(name) labels the SKU — the variant never renders');
  assert.equal((body.match(/<td>Bacon Cheese/g) || []).length, 1, 'one row per SKU, never per name');
  // FRIES: trend −50.0%; YoY '—' — its only LY record sits BEFORE the −364d window opens
  assert.match(body, /<td>OG Dirty Fries<\/td>\s*<td class="r-num mono">30<\/td>\s*<td class="r-num mono">£150\.00<\/td>\s*<td class="r-num mono">20\.3%<\/td>\s*<td class="r-num mono"><span class="r-down">−50\.0%<\/span><\/td>\s*<td class="r-num mono"><span class="rp-yoy-na" title="no LY record \(same 28d window −364d\)">—<\/span><\/td>/, 'YoY is window-bounded — the out-of-window LY decoy never counts');
  // NEWP: no prior window → trend '—' with its reason (yet it IS a menu mover above)
  assert.match(body, /<td>Vegan BBQ<\/td>\s*<td class="r-num mono">11<\/td>\s*<td class="r-num mono">£110\.00<\/td>\s*<td class="r-num mono">14\.9%<\/td>\s*<td class="r-num mono"><span class="rp-yoy-na" title="no prior-28d record">—<\/span><\/td>/);
  // SHAKE: trend −33.3%, YoY flat +0.0% (80/80)
  assert.match(body, /<td>Oreo Shake<\/td>\s*<td class="r-num mono">16<\/td>\s*<td class="r-num mono">£80\.00<\/td>\s*<td class="r-num mono">10\.8%<\/td>\s*<td class="r-num mono"><span class="r-down">−33\.3%<\/span><\/td>\s*<td class="r-num mono"><span class="r-up">\+0\.0%<\/span><\/td>/);
  // net-desc ordering
  assert.ok(body.indexOf('<td>Bacon Cheeseburger</td>') < body.indexOf('<td>OG Dirty Fries</td>'), 'ordered by 28d net');
  assert.ok(body.indexOf('<td>OG Dirty Fries</td>') < body.indexOf('<td>Vegan BBQ</td>'));
  assert.ok(body.indexOf('<td>Vegan BBQ</td>') < body.indexOf('<td>Oreo Shake</td>'));
  db.close();
});

test('performance table: every contribution cell is the SAME zero-digit "not costed", every class chip Pending', () => {
  const db = makeDb();
  seedMenu(db);
  const body = render(db);
  assert.equal((body.match(/<td class="r-num not-costed">not costed<\/td>/g) || []).length, 4, 'one muted zero-digit cell per row — no per-product invention');
  assert.equal((body.match(/<span class="r-tag info">Pending<\/span>/g) || []).length, 4, 'one Pending chip per row');
  assert.match(body, /contribution \+ classification unlock with recipe costing: top-20 = 59\.5% coverage, one session/, 'the caption carries the unlock');
  assert.match(body, /<a href="\/coyote\/recipes">recipes worklist<\/a>/, 'the caption links the worklist');
  db.close();
});

test('SALE_WHERE + modifier honesty: cancelled/VOID receipts and the zero-net modifier never render', () => {
  const db = makeDb();
  seedMenu(db);
  const body = render(db);
  assert.doesNotMatch(body, /Cancelled Burger|Void Burger/, 'non-sale receipts never enter the product ledger');
  assert.doesNotMatch(body, /£999|£555/, 'their £ never leak into any figure');
  assert.doesNotMatch(body, /Plain Bun add-on/, 'a zero-net modifier SKU is excluded (stated in the caption)');
  assert.match(body, /SKUs without positive window net excluded \(zero-value modifier lines\)/);
  db.close();
});

// ---------------- (e) one-home deletions ----------------

test('ONE-HOME: the pending banner, category-performance, best/slowest sellers and the period-nav machinery are GONE', () => {
  const db = makeDb();
  seedMenu(db);
  const body = render(db);
  assert.doesNotMatch(body, /Phase 5 pending/, 'the phase banner is deleted');
  assert.doesNotMatch(body, /Category performance/, 'the parked flash category table is deleted — the performance table is its home');
  assert.doesNotMatch(body, /Best sellers|Slowest sellers/, 'the parked seller lists are deleted — the table + decline watch absorb them');
  assert.doesNotMatch(body, /rp-two|rp-hint/, 'the pending-tab grammar left the page');
  assert.doesNotMatch(body, /period=day|period=week|name="period"/, 'the period-nav strip left reports (labour keeps its own)');
  db.close();
});

// ---------------- (f) no mock numbers ----------------

test('NO-MOCK-NUMBERS: an EMPTY db renders ZERO £-figures on the menu tab; the Calum gate renders anyway', () => {
  const db = makeDb(); // tables exist, no rows — the honest-empty worst case
  const body = render(db);
  assert.doesNotMatch(body, /£\d/, 'no £-figure may render from an empty box');
  assert.match(body, /No per-receipt API record yet/, 'the strip names its blocker');
  assert.match(body, /no per-receipt line record yet/, 'the real tiles say why they are empty');
  // the contribution gate is a fact about recipe_lines, not about sales — it renders regardless
  assert.match(body, /recipe_lines is empty \(the Calum gate\)/);
  assert.equal(body.split(UNLOCK).length - 1, 3, 'at-risk + dogs + portfolio carry the unlock (the table caption is an empty-state here)');
  assert.equal((body.match(/class="bubble/g) || []).length, 0, 'still no bubbles');
  db.close();
});
