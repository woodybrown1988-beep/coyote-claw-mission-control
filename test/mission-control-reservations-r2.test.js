'use strict';
// Reservations Centre R2 — the FIVE OpenTable-gated tabs render as DESIGNED GATE-STATES per
// their mocks (the mock's layout grammar REAL; zero data rows; zero data digits) on
// /coyote/reservations. Every expected number is HAND-COMPUTED in the fixture comments, never
// re-derived through the module. Pinned here:
//   (a) EXECUTIVE KPI STRIP: the 4 gated tiles are zero-digit 'no feed' dashes; the TWO HONEST
//       POS VARIANTS are real (per-receipt EAT IN, trailing 28d to the record's max day, SALE
//       receipts only) and carry their honesty captions VERBATIM; £-digits on the whole tab
//       appear in EXACTLY the two variant values; no percentage renders anywhere;
//   (b) EXECUTIVE FRAMES: the 13-week stacked-column frame = axis + 13 REAL calendar-week
//       labels, NO columns/lines/points; the owner queue = the alert-card frame, zero cards;
//       next-6-weeks = the week-bars frame with 6 REAL upcoming Mondays, no bars; demand mix =
//       gate-state + the one-line Revenue pointer, NO donut (one home per fact);
//   (c) BLOCKER DISCIPLINE: the ONE OpenTable blocker line (verbatim incl. the inbox path)
//       appears EXACTLY ONCE per gated panel — 4× executive · 5× demand · 6× behaviour ·
//       4× capacity · 0× customers (identity-gated instead: the identity blocker 3×, once per
//       panel);
//   (d) READINESS MOVED: the Data-readiness panel lives on EXECUTIVE (its mock home) and is
//       GONE from the reviews tab (deletion pin); the architecture cards stay on reviews only;
//   (e) GATED TABS ARE DIGIT-FREE: demand/behaviour/capacity/customers text carries NO digit at
//       all (dayparts use the ruled digit-free cuts; tables are headers-only; frames carry no
//       scale) — a digit on a gated tab means a fabricated number;
//   (f) CAPACITY HEAT GRID: 7 weekday rows × 5 ruled dayparts = 35 heatCell cells, every one
//       UNCLASSED (no r-lN level) — the frame IS the honest state;
//   (g) EMPTY-DB WHOLE-PAGE PROOF: with empty (or channel-map-less) stores no £-digit and no
//       star renders on ANY tab; the two variants degrade to honest dashes.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const page = require('../mission-control/ui/pages/coyote/reservations.js');

// NOW = 2026-07-02T13:46:40Z (a Thursday) → weekMonday = 2026-06-29.
//   13-week labels (Mondays, oldest→newest): 2026-04-06 … 2026-06-29 → '6 Apr' … '29 Jun'
//   next-6 labels (this Monday forward):     2026-06-29 … 2026-08-03 → '29 Jun' … '3 Aug'
const NOW = 1783000000000;

const DDL = `
CREATE TABLE review_corpus (review_id TEXT PRIMARY KEY, platform TEXT, overall REAL, reviewer TEXT, text TEXT, reviewed_date TEXT, has_reply INTEGER, fetched_at INTEGER);
CREATE TABLE review_snapshot (id INTEGER PRIMARY KEY AUTOINCREMENT, total INTEGER, awaiting_response INTEGER, awaiting_recent_text INTEGER, overall_rating REAL, google_rating REAL, tripadvisor_rating REAL, opentable_rating REAL, ratings_window TEXT, fetched_at INTEGER);
CREATE TABLE review_issues (review_id TEXT, issue_code TEXT, evidence_quote TEXT, extracted_at INTEGER, PRIMARY KEY (review_id, issue_code));
CREATE TABLE issue_extractions (review_id TEXT, extracted_at INTEGER);
CREATE TABLE review_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_code TEXT, identified_at INTEGER, evidence_summary TEXT, action_taken TEXT, action_date INTEGER, status TEXT, issue_rate_before REAL, issue_rate_after REAL, escalate INTEGER, auto INTEGER);
CREATE TABLE sales_receipts_api (receipt_id TEXT PRIMARY KEY, business_date TEXT, type TEXT, cancelled INTEGER, account_profile_code TEXT, net_without_tax_pence INTEGER, updated_at INTEGER);
CREATE TABLE sales_channel_map_api (account_profile_code TEXT PRIMARY KEY, profile_name TEXT, delivery_mode TEXT, channel_label TEXT, first_seen INTEGER, updated_at INTEGER, label_source TEXT);
`;

function makeDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(DDL);
  return db;
}

/** POS world for the two Executive variants (every figure hand-computed).
 *
 *  Channel map: LOCAL → 'EAT IN' · QR → 'QR (Storekit)' · WEB → 'ONLINE ORDER'.
 *  Receipts (id · date · type · cancelled · profile · net pence):
 *    e1 2026-07-02 SALE 0 LOCAL 2000   ← sets apiMax = 2026-07-02; window = 2026-06-05..07-02
 *    e2 2026-07-01 SALE 0 LOCAL 2500   ← in window
 *    e3 2026-06-05 NULL 0 LOCAL 1500   ← the >= window edge; NULL type IS a sale (canon)
 *    x1 2026-06-04 SALE 0 LOCAL 99999  ← ONE DAY outside the 28d window — must NOT count
 *    v1 2026-07-01 VOID 0 LOCAL 5000   ← excluded by type
 *    c1 2026-07-01 SALE 1 LOCAL 6000   ← excluded by cancelled (else net→12000 = £120.00)
 *    q1 2026-07-01 SALE 0 QR    7777   ← excluded by channel (else £77.77 leaks)
 *    w1 2026-07-01 SALE 0 WEB   8888   ← excluded by channel
 *
 *  HAND-COMPUTED: EAT IN window net = 2000+2500+1500 = 6000 pence over 3 txn
 *    → 'Dine-in net · 28d' = £60.00 · 'Spend / transaction' = 6000÷3 = 2000 pence = £20.00
 *    (x1 leaking → net 105999 = £1,059.99 — the classic off-by-one-day bug) */
function seedPos(db) {
  const cm = db.prepare(`INSERT INTO sales_channel_map_api VALUES (?,?,NULL,?,1,1,'seed')`);
  cm.run('LOCAL', 'Local Profile', 'EAT IN');
  cm.run('QR', 'Storekit QR', 'QR (Storekit)');
  cm.run('WEB', 'Website', 'ONLINE ORDER');
  const r = db.prepare(`INSERT INTO sales_receipts_api VALUES (?,?,?,?,?,?,1)`);
  r.run('e1', '2026-07-02', 'SALE', 0, 'LOCAL', 2000);
  r.run('e2', '2026-07-01', 'SALE', 0, 'LOCAL', 2500);
  r.run('e3', '2026-06-05', null, 0, 'LOCAL', 1500);
  r.run('x1', '2026-06-04', 'SALE', 0, 'LOCAL', 99999);
  r.run('v1', '2026-07-01', 'VOID', 0, 'LOCAL', 5000);
  r.run('c1', '2026-07-01', 'SALE', 1, 'LOCAL', 6000);
  r.run('q1', '2026-07-01', 'SALE', 0, 'QR', 7777);
  r.run('w1', '2026-07-01', 'SALE', 0, 'WEB', 8888);
}

const render = (db, tab) => {
  const ctx = { q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, query: { tab } };
  return page.render(page.getSection(db, ctx), ctx).body;
};

// Rendered TEXT: styles stripped FIRST (css is full of digits), then tags, then the escapeHtml
// entities decoded (&#39; would smuggle literal digits into a digit assertion).
const textOf = (body) => body
  .replace(/<style[\s\S]*?<\/style>/g, '')
  .replace(/<[^>]*>/g, '')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const count = (hay, needle) => hay.split(needle).length - 1;

const slice = (body, from, to) => {
  const a = body.indexOf(from);
  const b = to ? body.indexOf(to) : body.length;
  assert.ok(a >= 0 && b > a, `slice bounds exist: ${from} .. ${to || '(end)'}`);
  return body.slice(a, b);
};

// The ONE blocker line, VERBATIM (incl. the inbox path) — and the identity blocker.
const BLOCKER = 'OpenTable weekly export — no files received yet; unlock = start the emailed export to ~/coyote-claw/data/opentable-inbox/';
const IDENTITY = 'guest identity map — not started; needs OpenTable + the identity-map decision';

// ---------------- (a) the executive KPI strip ----------------

test('executive: 4 gated zero-digit tiles + the two POS variants real, captioned, decoys excluded', () => {
  const db = makeDb();
  seedPos(db);
  const body = render(db, 'executive');
  // the four cover tiles: with NO covers_day rows they are honest dashes + the no-feed sub. The
  // labels are the covers-live set (Booking→seated / No-show drop off — completed-visits-only export).
  for (const label of ['Seated dine-in covers', 'Reserved cover share', 'Walk-in cover share', 'Average party'])
    assert.match(body, new RegExp(`${label.replace(/[.*+?^${'{}'}()|[\\]\\\\]/g, '\\$&')}</div><div class="r-kpi-value">—<`), `gated tile ${label} is a dash`);
  assert.equal(count(body, 'no feed — OpenTable weekly export'), 4, 'the no-feed sub on all four gated tiles');
  // the two honest variants — hand-computed: EAT IN 28d net 6000p = £60.00 over 3 txn → £20.00
  assert.match(body, /Dine-in net · 28d<\/div><div class="r-kpi-value">£60\.00</, 'the hand-computed dine-in net');
  assert.match(body, /Spend \/ transaction<\/div><div class="r-kpi-value">£20\.00</, 'the hand-computed net÷txn');
  assert.match(body, /transactions basis, not covers/, 'variant 1 caption verbatim');
  assert.match(body, /per TRANSACTION — £\/cover on Revenue/, 'variant 2 caption verbatim');
  // the caption names the real window + the real txn count
  assert.match(body, /trailing 28d 2026-06-05 → 2026-07-02/, 'the window is stated');
  assert.match(body, /net ÷ 3 transactions/, 'the divisor is stated');
  assert.match(body, /POS guest-count is never covers/, 'the covers canon is stated');
  // decoys: out-of-window / cancelled / void / wrong-channel receipts never leak
  const text = textOf(body);
  assert.doesNotMatch(text, /1,059|99,999|£120\.00|£77\.77|£88\.88|£50\.00/, 'no decoy value renders');
  // £-digits appear in EXACTLY the two variant values; no percentage renders anywhere
  assert.equal((text.match(/£\d/g) || []).length, 2, 'exactly two £ values on the whole tab');
  assert.doesNotMatch(text, /\d(\.\d+)?%/, 'no percentage anywhere — every share/rate is gated');
  assert.doesNotMatch(text, /★|☆/, 'no stars on executive');
  db.close();
});

// ---------------- (b) the executive frames ----------------

test('executive: 13-week stack frame = axis + 13 REAL week labels, NO columns; queue + week-bars + mix frames honest', () => {
  const db = makeDb();
  seedPos(db);
  const body = render(db, 'executive');

  // 13-week: real calendar Mondays ending this week (NOW → 2026-06-29), zero geometry
  const stack = slice(body, '13-week dine-in cover performance', 'Owner attention queue');
  assert.equal((stack.match(/class="axistext"/g) || []).length, 13, '13 week labels');
  assert.ok(stack.includes('>6 Apr</text>'), 'the oldest real Monday label (2026-04-06)');
  assert.ok(stack.includes('>29 Jun</text>'), 'the newest real Monday label (2026-06-29)');
  assert.doesNotMatch(stack, /<rect|<polyline|<circle/, 'NO columns, lines or points — a column would be a fabricated cover');
  assert.match(stack, /class="gridline"/, 'the axis renders');
  for (const leg of ['Reserved', 'Walk-in', 'LY total']) assert.ok(stack.includes(`</i>${leg}</span>`), `legend ${leg}`);

  // owner attention queue: the alert-card frame, zero data cards
  const queue = slice(body, 'Owner attention queue', 'Next 6 weeks');
  assert.match(queue, /class="r-alert"/, 'the alert-card frame renders');
  assert.doesNotMatch(queue, /r-impact">[^<]/, 'no invented £-impact');

  // next 6 weeks: the week-bars frame — 6 real upcoming Mondays, no bars
  const bars = slice(body, 'Next 6 weeks', 'Dine-in demand mix');
  assert.equal((bars.match(/class="rsv-week-col"/g) || []).length, 6, '6 week columns');
  for (const lab of ['29 Jun', '6 Jul', '13 Jul', '20 Jul', '27 Jul', '3 Aug'])
    assert.ok(bars.includes(`>${lab}</span>`), `real upcoming Monday ${lab}`);
  assert.doesNotMatch(bars, /style="height/, 'no bar heights — a bar would be a fabricated on-books count');

  // demand mix: gate-state + the one-line pointer; the donut is NOT duplicated here
  const mix = slice(body, 'Dine-in demand mix', 'Data readiness');
  assert.ok(mix.includes('transaction-basis channel mix lives on Revenue → Executive'), 'the one-home pointer');
  assert.doesNotMatch(mix, /donut|conic-gradient|drow/, 'no donut on this tab — one home per fact');
  db.close();
});

// ---------------- (c) blocker discipline ----------------

test('blocker line: verbatim, EXACTLY once per gated panel (4 exec · 5 demand · 6 behaviour · 4 capacity)', () => {
  const db = makeDb();
  seedPos(db);

  const cases = [
    ['executive', ['13-week dine-in cover performance', 'Owner attention queue', 'Next 6 weeks', 'Dine-in demand mix', 'Data readiness']],
    ['demand', ['Eight-week demand forecast', 'Forecast assumptions', 'Booking pickup curve', 'Forward occupancy by daypart', 'Next fourteen days — management booking view', null]],
    ['behaviour', ['Reservation source performance', 'Booking funnel', 'Lead-time distribution', 'Party-size mix', 'New versus returning', 'No-show and cancellation diagnosis', null]],
    ['capacity', ['Actual occupancy heatmap', 'Capacity leakage', 'Table-turn performance', 'Guest-flow signals', null]],
  ];
  for (const [tab, bounds] of cases) {
    const body = render(db, tab);
    const gatedPanels = bounds.length - 1; // last entry is the closing bound (null = end of body)
    assert.equal(count(body, BLOCKER), gatedPanels, `${tab}: the blocker appears ${gatedPanels}× (once per gated panel)`);
    for (let i = 0; i < gatedPanels; i++) {
      const panel = slice(body, bounds[i], bounds[i + 1] || undefined);
      assert.equal(count(panel, BLOCKER), 1, `${tab} · ${bounds[i]}: exactly one blocker line`);
    }
  }
  // executive's readiness panel is REAL statuses, not a gate — no blocker inside it
  const exec = render(db, 'executive');
  assert.equal(count(slice(exec, 'Data readiness'), BLOCKER), 0, 'readiness carries no blocker — it is real');
  db.close();
});

test('customers: identity-gated — the identity blocker once per panel, the OpenTable line absent', () => {
  const db = makeDb();
  seedPos(db);
  const body = render(db, 'customers');
  assert.equal(count(body, BLOCKER), 0, 'no OpenTable blocker — these panels name the DEEPER gate instead');
  assert.equal(count(body, IDENTITY), 3, 'the identity blocker on all three panels');
  const bounds = ['Best customers and lapse monitoring', 'Customer value × frequency matrix', 'Lapse logic and action rules', null];
  for (let i = 0; i < 3; i++)
    assert.equal(count(slice(body, bounds[i], bounds[i + 1] || undefined), IDENTITY), 1, `${bounds[i]}: exactly one identity blocker`);
  db.close();
});

// ---------------- (d) the readiness move ----------------

test('readiness panel: ON executive (real statuses), GONE from reviews; architecture cards stay on reviews only', () => {
  const db = makeDb();
  seedPos(db);
  const exec = render(db, 'executive');
  assert.ok(exec.includes('Data readiness'), 'readiness lives on executive — its mock home');
  const ready = slice(exec, 'Data readiness');
  assert.match(ready, /<span class="r-tag good">Ready<\/span>/, 'the seeded per-receipt store reads Ready');
  assert.match(ready, /<span class="r-tag bad">no rows<\/span>/, 'the empty reviews store reads no rows, never Ready');
  assert.match(ready, /no feed — 0 files received/, 'the OpenTable status is the real zero-files state');
  assert.match(ready, /<span class="r-tag">not started<\/span>/, 'guest identity is neutral, not red');
  assert.match(ready, /readiness read from the DB; drop the export in the panel above — no filesystem, no CLI./, 'the fs-vs-db caption');

  const reviews = render(db, 'reviews');
  assert.ok(!reviews.includes('Data readiness'), 'DELETION PIN: the reviews tab no longer carries the readiness panel');
  assert.ok(reviews.includes('Recommended data architecture'), 'the architecture cards stay on reviews');
  assert.ok(!exec.includes('Recommended data architecture'), 'and do NOT duplicate onto executive');
  db.close();
});

// ---------------- (e) the gated tabs: frames real, text digit-free ----------------

test('demand: the five mock frames render, headers-only table, ruled daypart rows, ZERO digits', () => {
  const db = makeDb();
  seedPos(db); // digits in the DB must not leak onto a gated tab
  const body = render(db, 'demand');
  for (const t of ['Eight-week demand forecast', 'Forecast assumptions', 'Booking pickup curve', 'Forward occupancy by daypart', 'Next fourteen days — management booking view'])
    assert.ok(body.includes(`<h3 class="r-panel-title">${t}</h3>`), `panel ${t}`);
  // the management booking view: the mock's columns, ZERO rows
  for (const h of ['Date', 'Service', 'On books', 'Forecast covers', 'Forecast occupancy', 'Large parties', 'VIP / high spender', 'Risk / action'])
    assert.ok(body.includes(`>${h}</th>`), `booking-view header ${h}`);
  assert.match(body, /<tbody><\/tbody>/, 'headers only — a row would be a claim');
  // forward occupancy: the ruled daypart cuts as row labels, empty tracks, dash values
  for (const d of ['PREP', 'LUNCH', 'TROUGH', 'DINNER', 'LATE'])
    assert.ok(body.includes(`<div class="r-label">${d}</div><div class="r-track"></div><div class="r-value">—</div>`), `daypart row ${d} — label real, bar absent`);
  // the assumptions card is definitional: the forecast identity, no numbers
  assert.match(body, /Forecast covers =/, 'the forecast identity renders');
  assert.match(body, /labour follows forecast covers by daypart, not monthly revenue alone/, 'the labour-budgeting note');
  // the forecast + pickup frames carry axis only — no data geometry, no scale labels
  assert.doesNotMatch(body, /<polyline|<circle|<rect|class="axistext"/, 'no chart geometry and no fabricated scale');
  assert.doesNotMatch(textOf(body), /\d/, 'the WHOLE tab text is digit-free — any digit is a fabricated number');
  db.close();
});

test('behaviour: six mock frames — funnel stages labelled with NO widths, tables headers-only, ZERO digits', () => {
  const db = makeDb();
  seedPos(db);
  const body = render(db, 'behaviour');
  for (const t of ['Reservation source performance', 'Booking funnel', 'Lead-time distribution', 'Party-size mix', 'New versus returning', 'No-show and cancellation diagnosis'])
    assert.ok(body.includes(`<h3 class="r-panel-title">${t}</h3>`), `panel ${t}`);
  // the funnel: all five mock stages, frame rows only — no widths, dash values
  const funnel = slice(body, 'Booking funnel', 'Lead-time distribution');
  for (const stage of ['Reserved covers created', 'Still expected after cancellation', 'Arrived / seated', 'POS check matched', 'Guest identity reusable'])
    assert.ok(funnel.includes(`<span>${stage}</span><b>—</b>`), `funnel stage ${stage}`);
  assert.equal((funnel.match(/class="rsv-funnel-row"/g) || []).length, 5, 'five funnel rows');
  assert.doesNotMatch(funnel, /style="width/, 'no funnel widths — a width would be a conversion claim');
  // both tables: mock columns, zero rows
  for (const h of ['Source', 'Seated covers', 'Booking → seated', 'No-show', 'Lead time', 'Spend / cover', 'Decision', 'Segment', 'Estimated lost covers', 'Estimated revenue risk', 'Recommended control'])
    assert.ok(body.includes(`>${h}</th>`), `table header ${h}`);
  assert.equal((body.match(/<tbody><\/tbody>/g) || []).length, 2, 'both tables are headers-only');
  // party-size donut = an empty ring frame; new-vs-returning = 4 dash drivers
  assert.match(body, /class="rsv-donut-frame"/, 'the donut FRAME (empty ring, no segments)');
  assert.doesNotMatch(body, /conic-gradient/, 'no donut segments — a segment would be a mix claim');
  assert.equal((body.match(/<strong>—<\/strong>/g) || []).length, 4, 'four zero-digit new-vs-returning stats');
  assert.doesNotMatch(textOf(body), /\d/, 'the WHOLE tab text is digit-free');
  db.close();
});

// ---------------- (f) the capacity heat grid ----------------

test('capacity: heat grid all-unclassed (7×5), leak + turn + flow frames, ZERO digits', () => {
  const db = makeDb();
  seedPos(db);
  const body = render(db, 'capacity');
  for (const t of ['Actual occupancy heatmap', 'Capacity leakage', 'Table-turn performance', 'Guest-flow signals'])
    assert.ok(body.includes(`<h3 class="r-panel-title">${t}</h3>`), `panel ${t}`);
  // the grid: 7 weekdays × 5 ruled dayparts, EVERY cell the unclassed no-data cell
  assert.equal((body.match(/<div class="r-cell"><\/div>/g) || []).length, 35, '35 no-data cells');
  assert.doesNotMatch(body, /class="r-cell r-l/, 'no level class anywhere — a level would be an occupancy claim');
  assert.equal((body.match(/class="rsv-hlabel"/g) || []).length, 5, 'the 5 ruled daypart column labels');
  for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    assert.ok(body.includes(`<div class="rsv-hday">${d}</div>`), `weekday row ${d}`);
  // leakage: the five mock leak rows, dash values
  const leak = slice(body, 'Capacity leakage', 'Table-turn performance');
  for (const h of ['Late table turns', 'Unfilled late cancellations', 'No-show gaps', 'Over-blocked inventory', 'Waitlist non-response'])
    assert.ok(leak.includes(`<h4>${h}</h4>`), `leak row ${h}`);
  assert.equal((leak.match(/<strong>—<\/strong>/g) || []).length, 5, 'five zero-digit leak values');
  // table-turn: headers only
  for (const h of ['Party size', 'Target duration', 'Actual duration', 'On target', 'Peak variance'])
    assert.ok(body.includes(`>${h}</th>`), `turn header ${h}`);
  assert.match(body, /<tbody><\/tbody>/, 'turn table headers-only');
  // guest-flow: 8 dash driver cards
  assert.equal((body.match(/class="r-driver"/g) || []).length, 8, 'eight flow signal cards');
  assert.equal((body.match(/<strong>—<\/strong>/g) || []).length, 13, 'every flow (8) + leak (5) value is a dash');
  assert.doesNotMatch(textOf(body), /\d/, 'the WHOLE tab text is digit-free');
  db.close();
});

test('customers: table headers, the four quadrant labels with NO bubbles, digit-free lapse rules (no unruled thresholds)', () => {
  const db = makeDb();
  seedPos(db);
  const body = render(db, 'customers');
  for (const h of ['Guest', 'Visits ever', 'Last quarter', 'Last visit', 'Expected gap', 'Lifetime spend', 'Avg / visit', 'Segment', 'Lapse flag'])
    assert.ok(body.includes(`>${h}</th>`), `best-customers header ${h}`);
  assert.match(body, /<tbody><\/tbody>/, 'headers only');
  // the quad-matrix frame: four labelled quadrants, zero bubbles
  const quad = slice(body, 'Customer value × frequency matrix', 'Lapse logic and action rules');
  for (const lab of ['High value · low frequency — OPPORTUNITY', 'High value · high frequency — VIP', 'Low value · low frequency — OCCASIONAL', 'Low value · high frequency — HABITUAL'])
    assert.ok(quad.includes(lab), `quadrant ${lab}`);
  assert.doesNotMatch(quad, /bubble|style="width:\d|style="left/, 'no bubbles — a bubble would be a per-guest claim');
  // lapse rules: definitional and DIGIT-FREE — the mock's 1.25×/1.75× thresholds are UNRULED
  assert.match(body, /Lapse ratio = days since last interaction ÷ expected return gap/, 'the ratio definition');
  assert.match(body, /ruled multiples of the expected gap/, 'thresholds deferred to the ruling, not invented');
  for (const pr of ['First priority', 'Second priority', 'Third priority'])
    assert.ok(body.includes(`<strong>${pr}</strong>`), `action rule ${pr} (spelled, not numbered)`);
  assert.doesNotMatch(textOf(body), /\d/, 'the WHOLE tab text is digit-free');
  db.close();
});

// ---------------- (g) empty-DB whole-page proof ----------------

test('EMPTY DB: no £-digit and no star on ANY tab; the two variants degrade to honest dashes', () => {
  const db = makeDb(); // every table exists, zero rows
  for (const tab of ['executive', 'demand', 'behaviour', 'capacity', 'customers', 'reviews']) {
    const text = textOf(render(db, tab));
    assert.doesNotMatch(text, /£\d/, `${tab}: no £ value can appear from an empty box`);
    assert.doesNotMatch(text, /★|☆/, `${tab}: no stars`);
  }
  const exec = render(db, 'executive');
  assert.equal((exec.match(/r-kpi-value">—</g) || []).length, 6, 'all six executive tiles are dashes (4 gated + 2 unlit variants)');
  assert.match(exec, /no window computable yet/, 'the variant caption names its own gap');
  db.close();
});

test('MISSING channel map: the variants stay dashes even with receipts present (no unmapped-channel guess)', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(DDL.replace(/CREATE TABLE sales_channel_map_api[^;]+;/, '')); // no channel map table at all
  db.prepare(`INSERT INTO sales_receipts_api VALUES ('e1','2026-07-02','SALE',0,'LOCAL',2000,1)`).run();
  const body = render(db, 'executive');
  assert.doesNotMatch(textOf(body), /£\d/, 'no £ value without the channel-map join — EAT IN cannot be guessed');
  assert.match(body, /Dine-in net · 28d<\/div><div class="r-kpi-value">—</, 'variant 1 degrades to a dash');
  assert.match(body, /Spend \/ transaction<\/div><div class="r-kpi-value">—</, 'variant 2 degrades to a dash');
  db.close();
});
