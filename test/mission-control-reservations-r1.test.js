'use strict';
// Reservations Centre R1 — the six-tab shell + the REVIEWS & RECOVERY tab (the wired reviews
// dept) on /coyote/reservations. Every expected number is HAND-COMPUTED in the fixture comments,
// never re-derived through the module. Pinned here:
//   (a) SHELL: default tab = executive, 6 subtab links, ?tab= switches; R2 UPDATE: the five
//       non-reviews tabs now render designed gate-states (mission-control-reservations-r2.test.js)
//       — the R1 pending note is GONE everywhere;
//   (b) KPI STRIP: newest snapshot wins (an older decoy must not render); stars ride real
//       ratings only; response rate = Google replied ÷ Google total ONLY (a TA has_reply=1
//       decoy must NOT blend); reviews last 90d counts by reviewed_date incl. the >= edge;
//   (c) TREND: monthly AVG(overall) over the trailing 12 months — a gap month breaks the line
//       (2 polylines + 1 isolated point, NEVER one interpolated line); volume columns real;
//   (d) THEMES: the extraction taxonomy meters = seeded counts (all-time + last-90d), scaled
//       to the max code; the extraction-backlog line = has-text corpus rows not in
//       issue_extractions (whitespace-only text is NOT has-text);
//   (e) RECOVERY + RETURN: identity-gated designed empty-states carrying ZERO digits, both
//       naming the identity blocker + the verbatim OpenTable blocker line;
//   (f) ACTIONS: newest 8 of review_actions — status chips per class, '—' when open,
//       before→after ONLY when both rates exist (a before-only decoy must not render);
//   (g) READINESS: real statuses — Ready paths, the absent-store OpenTable sentence, the
//       present-store paths, guest identity 'not started', the fs-vs-db caption (R2: the panel
//       LIVES ON EXECUTIVE now — its mock home; the deletion-from-reviews pin is in the R2 file);
//   (h) NO-MOCK-NUMBERS: an EMPTY db renders no rating digit and no star anywhere;
//   (i) REGISTRY: Reports group order = revenue, report-library, rota-review, reservations;
//       server.js requires the page after reports.js.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const page = require('../mission-control/ui/pages/coyote/reservations.js');

// NOW = 2026-07-02T13:46:40Z → from90 = 2026-04-03 · trailing months 2025-08 .. 2026-07
const NOW = 1783000000000;

const DDL = `
CREATE TABLE review_corpus (review_id TEXT PRIMARY KEY, platform TEXT, overall REAL, reviewer TEXT, text TEXT, reviewed_date TEXT, has_reply INTEGER, fetched_at INTEGER);
CREATE TABLE review_snapshot (id INTEGER PRIMARY KEY AUTOINCREMENT, total INTEGER, awaiting_response INTEGER, awaiting_recent_text INTEGER, overall_rating REAL, google_rating REAL, tripadvisor_rating REAL, opentable_rating REAL, ratings_window TEXT, fetched_at INTEGER);
CREATE TABLE review_issues (review_id TEXT, issue_code TEXT, evidence_quote TEXT, extracted_at INTEGER, PRIMARY KEY (review_id, issue_code));
CREATE TABLE issue_extractions (review_id TEXT, extracted_at INTEGER);
CREATE TABLE review_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_code TEXT, identified_at INTEGER, evidence_summary TEXT, action_taken TEXT, action_date INTEGER, status TEXT, issue_rate_before REAL, issue_rate_after REAL, escalate INTEGER, auto INTEGER);
CREATE TABLE sales_receipts_api (receipt_id TEXT PRIMARY KEY, business_date TEXT, type TEXT, cancelled INTEGER, account_profile_code TEXT, net_without_tax_pence INTEGER, updated_at INTEGER);
`;

function makeDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(DDL);
  return db;
}

const DAY = 86400000;

/** Reviews world (every figure hand-computed).
 *
 *  Corpus (review_id · platform · overall · text · reviewed_date · has_reply):
 *    g1 google 5 'Great burgers'        2026-06-20            has_reply 1
 *    g2 google 3 'Pricey for what'      2026-05-10            has_reply 0
 *    g3 google 3 'Slowish'              2026-01-15            has_reply NULL
 *    g4 google 2 '  ' (whitespace!)     2025-12-01            has_reply 0
 *    t1 tripadvisor 4 'Lovely staff'    2026-04-03T12:00:00Z  has_reply 1  ← the BLEND DECOY
 *    o1 opentable 4 NULL text           2025-09-10            has_reply NULL
 *
 *  HAND-COMPUTED:
 *    response rate = Google ONLY: 1 replied ÷ 4 total = 25.0% (blending t1 → 2/5 = 40.0%
 *      or 2/6 = 33.3% = the bug)
 *    last 90d (reviewed_date >= 2026-04-03): g1 + g2 + t1 (the >= edge, datetime string) = 3
 *    trend (month → avg · n): 2025-09 4.00·1 | 2025-12 2.00·1 | 2026-01 3.00·1 |
 *      2026-04 4.00·1 | 2026-05 3.00·1 | 2026-06 5.00·1; gaps 2025-08/10/11, 2026-02/03/07
 *      → contiguous runs [Sep] [Dec,Jan] [Apr,May,Jun] = 2 polylines + 1 isolated point
 *      geometry: X step = 805/11 = 73.1818…; lone Sep point cx=133.2 cy=Y(4)=60;
 *      the Dec→Jan polyline = "352.7,140 425.9,100" (Y: 2→140, 3→100, 4→60, 5→20)
 *    themes: VALUE_PRICING 3 (g2 g3 g4; 90d: g2 → 1) · FOOD_QUALITY 2 (t1 o1; 90d: t1 → 1)
 *      · SERVICE_SPEED 1 (g1; 90d 1); meters scale to max 3 → 100% / 66.6…% / 33.3…%
 *    backlog: has-text rows = g1 g2 g3 t1 (g4 whitespace + o1 NULL are NOT has-text) = 4;
 *      issue_extractions holds g1 g2 → backlog = 2
 *    actions (newest 8 of 10 by identified_at): a3 ALLERGEN escalated (auto, no rates) →
 *      a2 VALUE_PRICING open (action NULL → '—'; before 0.3 ONLY → rate cell '—', '30.0%'
 *      must never render) → a1 SERVICE_SPEED actioned 0.4→0.1 = '40.0% → 10.0%' →
 *      FILLER_A..E resolved; FILLER_F (15d) + DROPPED_OLDEST (20d) fall off the newest-8 */
function seedReviews(db) {
  db.prepare(`INSERT INTO review_snapshot (total, awaiting_response, awaiting_recent_text, overall_rating, google_rating, tripadvisor_rating, opentable_rating, ratings_window, fetched_at) VALUES (500, 70, 6, 3.10, 3.20, 3.30, 3.40, '30d', ?)`).run(NOW - 10 * DAY); // the OLD decoy — must never render
  db.prepare(`INSERT INTO review_snapshot (total, awaiting_response, awaiting_recent_text, overall_rating, google_rating, tripadvisor_rating, opentable_rating, ratings_window, fetched_at) VALUES (534, 79, 8, 4.62, 4.78, 4.55, 4.49, '12mo', ?)`).run(NOW - 3600000);
  const rc = db.prepare(`INSERT INTO review_corpus (review_id, platform, overall, reviewer, text, reviewed_date, has_reply, fetched_at) VALUES (?,?,?,?,?,?,?,1)`);
  rc.run('g1', 'google', 5, 'Ann', 'Great burgers', '2026-06-20', 1);
  rc.run('g2', 'google', 3, 'Bob', 'Pricey for what it is', '2026-05-10', 0);
  rc.run('g3', 'google', 3, 'Cal', 'Slowish', '2026-01-15', null);
  rc.run('g4', 'google', 2, 'Dee', '  ', '2025-12-01', 0);
  rc.run('t1', 'tripadvisor', 4, 'Eve', 'Lovely staff', '2026-04-03T12:00:00Z', 1);
  rc.run('o1', 'opentable', 4, 'Fay', null, '2025-09-10', null);
  const ri = db.prepare(`INSERT INTO review_issues (review_id, issue_code, extracted_at) VALUES (?,?,1)`);
  ri.run('g2', 'VALUE_PRICING'); ri.run('g3', 'VALUE_PRICING'); ri.run('g4', 'VALUE_PRICING');
  ri.run('t1', 'FOOD_QUALITY'); ri.run('o1', 'FOOD_QUALITY');
  ri.run('g1', 'SERVICE_SPEED');
  const ie = db.prepare(`INSERT INTO issue_extractions (review_id, extracted_at) VALUES (?,1)`);
  ie.run('g1'); ie.run('g2');
  const ra = db.prepare(`INSERT INTO review_actions (issue_code, identified_at, action_taken, action_date, status, issue_rate_before, issue_rate_after, escalate, auto) VALUES (?,?,?,?,?,?,?,?,?)`);
  ra.run('ALLERGEN_HANDLING', NOW - 1 * DAY, 'escalated to David', NOW - 1 * DAY, 'escalated', null, null, 1, 1);
  ra.run('VALUE_PRICING', NOW - 2 * DAY, null, null, 'open', 0.3, null, 0, 0);
  ra.run('SERVICE_SPEED', NOW - 5 * DAY, 'retrained the pass', NOW - 4 * DAY, 'actioned', 0.4, 0.1, 0, 0);
  const fillers = ['FILLER_A', 'FILLER_B', 'FILLER_C', 'FILLER_D', 'FILLER_E', 'FILLER_F'];
  fillers.forEach((code, i) => ra.run(code, NOW - (10 + i) * DAY, 'done', NOW - (10 + i) * DAY, 'resolved', null, null, 0, 0));
  ra.run('DROPPED_OLDEST', NOW - 20 * DAY, 'ancient', NOW - 20 * DAY, 'resolved', null, null, 0, 0);
  db.prepare(`INSERT INTO sales_receipts_api VALUES ('r1','2026-07-01','SALE',0,'LOCAL',1000,1)`).run();
}

const render = (db, query) => {
  const ctx = { q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, query: query || { tab: 'reviews' } };
  return page.render(page.getSection(db, ctx), ctx).body;
};

// The R1 pending line — R2 shipped the gate-states, so this must never render again.
const R2_NOTE = 'R2 gate-state build pending — every panel here needs the OpenTable weekly export (inbox: no files received yet).';
const slice = (body, from, to) => {
  const a = body.indexOf(from);
  const b = body.indexOf(to);
  assert.ok(a >= 0 && b > a, `slice bounds exist: ${from} .. ${to}`);
  return body.slice(a, b);
};

// ---------------- (a) the shell ----------------

test('shell: executive is the default tab, 6 subtab links, ?tab= switches, garbage falls back', () => {
  const db = makeDb();
  seedReviews(db);
  const home = render(db, {});
  assert.match(home, /class="r-tab active" href="\/coyote\/reservations\?tab=executive"/, 'executive is the default');
  assert.equal((home.match(/class="r-tab[ "]/g) || []).length, 6, '6 subtab links');
  for (const label of ['Executive', 'Demand &amp; Forecast', 'Booking Behaviour', 'Capacity &amp; Flow', 'Customer Intelligence', 'Reviews &amp; Recovery'])
    assert.ok(home.includes(label), `tab label ${label}`);
  assert.ok(home.indexOf('<div class="rcc">') < home.indexOf('class="r-tabs"'), 'tab nav inside the .rcc wrapper');
  const rv = render(db, { tab: 'reviews' });
  assert.match(rv, /class="r-tab active" href="\/coyote\/reservations\?tab=reviews"/, '?tab=reviews switches');
  assert.match(render(db, { tab: 'DROP TABLE' }), /class="r-tab active" href="\/coyote\/reservations\?tab=executive"/, 'garbage falls back to executive');
  db.close();
});

test('shell (R2): the five non-reviews tabs render designed gate-states — the R1 pending note is GONE everywhere', () => {
  const db = makeDb();
  seedReviews(db);
  for (const t of ['executive', 'demand', 'behaviour', 'capacity', 'customers', 'reviews']) {
    const body = render(db, { tab: t });
    assert.ok(!body.includes(R2_NOTE), `${t} never claims to be pending — R2 shipped its gate-states`);
    assert.match(body, /class="r-card r-panel"/, `${t} renders real panel shells`);
  }
  db.close();
});

test('contract: key/route/workspace/title as ruled', () => {
  assert.equal(page.key, 'reservations');
  assert.equal(page.route, '/coyote/reservations');
  assert.equal(page.workspace, 'coyote');
  assert.equal(page.title, 'Reservations');
  assert.match(page.sub, /OpenTable feed pending/);
});

// ---------------- (b) the KPI strip ----------------

test('KPI strip: newest snapshot wins, stars ride real ratings, window captioned', () => {
  const db = makeDb();
  seedReviews(db);
  const body = render(db);
  assert.match(body, /Overall rating<\/div><div class="r-kpi-value">4\.62</, 'newest snapshot overall');
  assert.match(body, /Google rating<\/div><div class="r-kpi-value">4\.78</);
  assert.match(body, /TripAdvisor rating<\/div><div class="r-kpi-value">4\.55</);
  assert.match(body, /OpenTable rating<\/div><div class="r-kpi-value">4\.49</);
  assert.doesNotMatch(body, /3\.10|3\.20|3\.30|3\.40/, 'the OLD snapshot decoy never renders');
  assert.match(body, /title="4\.49 \/ 5">★★★★☆</, 'OpenTable 4.49 rounds to four filled stars');
  assert.match(body, /title="4\.62 \/ 5">★★★★★</, 'overall 4.62 rounds to five');
  assert.equal((body.match(/window: 12mo/g) || []).length, 4, 'the ratings window captions all four rating tiles');
  db.close();
});

test('response rate: Google replied ÷ Google total ONLY — the TA has_reply=1 decoy must NOT blend', () => {
  const db = makeDb();
  seedReviews(db);
  const body = render(db);
  const tile = slice(body, 'Response rate', 'Reviews · last 90d');
  // 1 of 4 Google reviews replied = 25.0%; blending t1 (TA, has_reply=1) → 40.0% or 33.3% = the bug
  assert.match(tile, /r-kpi-value">25\.0%</, 'the hand-computed Google-only rate');
  assert.doesNotMatch(tile, /40\.0%|33\.3%/, 'no blended rate — reply state is not tracked for TA/OT');
  assert.match(tile, /Google only — reply state not tracked for TA\/OT/, 'the tile says so verbatim');
  assert.match(body, /1 of 4/, 'the caption carries the real counts');
  db.close();
});

test('reviews last 90d: counts by reviewed_date incl. the >= edge on a datetime string (3, never 2)', () => {
  const db = makeDb();
  seedReviews(db);
  const body = render(db);
  // g1 (06-20) + g2 (05-10) + t1 (04-03T12:00Z — exactly the from90 edge, datetime format) = 3
  assert.match(body, /Reviews · last 90d<\/div><div class="r-kpi-value">3</, 'the hand-computed 90d count');
  assert.match(body, /review_corpus · by reviewed_date/, 'the source is captioned');
  db.close();
});

// ---------------- (c) the monthly rating trend ----------------

test('trend: a gap month BREAKS the line — 2 polylines + 1 isolated point, never one interpolated line', () => {
  const db = makeDb();
  seedReviews(db);
  const body = render(db);
  const lines = body.match(/<polyline[^>]*class="line-current"/g) || [];
  assert.equal(lines.length, 2, 'runs [Dec,Jan] + [Apr,May,Jun] — interpolating across gaps = the bug (1 line)');
  assert.match(body, /<polyline points="352\.7,140 425\.9,100" class="line-current"\/>/, 'the Dec→Jan run, hand-computed geometry');
  assert.match(body, /<circle cx="133\.2" cy="60" r="4" class="point"\/>/, 'isolated Sep 2025 renders a lone point, joined to nothing');
  assert.doesNotMatch(body, /<polyline[^>]*133\.2/, 'the isolated month never joins a line');
  assert.equal((body.match(/class="rsv-vol"/g) || []).length, 6, 'one volume column per month WITH reviews (6), gap months get none');
  assert.match(body, /Jun 2026 · avg 5\.00 · 1 review\(s\)/, 'the month tooltip carries avg + count');
  assert.match(body, /a month without a rated review is a GAP — the line breaks, never interpolates/, 'the honesty rule is captioned');
  db.close();
});

// ---------------- (d) sentiment themes ----------------

test('themes: taxonomy meters = seeded counts (all-time + 90d), scaled to the max code, backlog line real', () => {
  const db = makeDb();
  seedReviews(db);
  const body = render(db);
  const panel = slice(body, 'Sentiment themes', 'Service recovery queue');
  assert.match(panel, /VALUE_PRICING<\/div><div class="r-track"><div class="r-seg" style="width:100%/, 'max code fills the track');
  assert.match(panel, /FOOD_QUALITY<\/div><div class="r-track"><div class="r-seg" style="width:66\.6/, '2 of max 3');
  assert.match(panel, /SERVICE_SPEED<\/div><div class="r-track"><div class="r-seg" style="width:33\.3/, '1 of max 3');
  assert.match(panel, /3 · 1 in 90d/, 'VALUE_PRICING: 3 all-time, 1 in the 90d window (g2)');
  assert.match(panel, /2 · 1 in 90d/, 'FOOD_QUALITY: t1 in-window, o1 out');
  assert.match(panel, /1 · 1 in 90d/, 'SERVICE_SPEED');
  assert.ok(panel.indexOf('VALUE_PRICING') < panel.indexOf('FOOD_QUALITY') && panel.indexOf('FOOD_QUALITY') < panel.indexOf('SERVICE_SPEED'), 'ordered by all-time count');
  // backlog: has-text = g1 g2 g3 t1 (whitespace g4 + NULL o1 are NOT has-text); extracted g1 g2 → 2
  assert.match(panel, /extraction backlog 2 unclassified/, 'the staleness fact — the extractor\'s own claim filter');
  assert.match(panel, /themes = the extraction taxonomy \(review_issues\)/, 'the taxonomy is named');
  db.close();
});

// ---------------- (e) the identity-gated panels ----------------

test('recovery queue + review-to-return: designed gated states carry ZERO digits + both blockers verbatim', () => {
  const db = makeDb();
  seedReviews(db);
  const body = render(db);
  const gated = slice(body, 'Service recovery queue', 'Reputation management actions');
  const text = gated.replace(/<[^>]*>/g, '');
  assert.doesNotMatch(text, /\d/, 'zero digits anywhere in the two gated panels — no invented per-guest number');
  assert.equal((gated.match(/per-guest recovery needs review↔guest identity linking \(OpenTable \+ the identity-map decision\)/g) || []).length, 2, 'the identity blocker on BOTH panels');
  assert.equal((gated.match(/OpenTable weekly export — no files received yet; unlock = start the emailed export to the inbox/g) || []).length, 2, 'the verbatim OpenTable blocker line on BOTH panels');
  // the mock layouts survive: the queue row headers + the 4-stat grid
  for (const h of ['Guest', 'Review', 'Issue', 'Recovery status', 'Owner']) assert.ok(gated.includes(`<div>${h}</div>`), `queue header ${h}`);
  assert.equal((gated.match(/class="r-driver"/g) || []).length, 4, 'the 4-stat return layout');
  assert.equal((gated.match(/<strong>—<\/strong>/g) || []).length, 4, 'every return stat is a zero-digit dash');
  db.close();
});

// ---------------- (f) the actions table ----------------

test('actions: newest 8, status chips per class, "—" when open, before→after ONLY when both measured', () => {
  const db = makeDb();
  seedReviews(db);
  const body = render(db);
  const panel = slice(body, 'Reputation management actions', 'Recommended data architecture');
  // order: newest first
  assert.ok(panel.indexOf('ALLERGEN_HANDLING') < panel.indexOf('VALUE_PRICING'), 'newest first');
  assert.ok(panel.indexOf('VALUE_PRICING') < panel.indexOf('SERVICE_SPEED'));
  // newest 8 of 10: FILLER_E stays, FILLER_F + DROPPED_OLDEST fall off
  assert.ok(panel.includes('FILLER_E'), '8th-newest row present');
  assert.doesNotMatch(panel, /FILLER_F|DROPPED_OLDEST/, 'beyond the newest 8 never renders');
  // chips per status class
  assert.match(panel, /<span class="r-tag bad">escalated<\/span>/);
  assert.match(panel, /<span class="r-tag warn">open<\/span>/);
  assert.match(panel, /<span class="r-tag info">actioned<\/span>/);
  assert.match(panel, /<span class="r-tag good">resolved<\/span>/);
  // the measurement loop: 0.4→0.1 = '40.0% → 10.0%'; the before-only decoy renders NO rate
  assert.match(panel, /40\.0% → 10\.0%/, 'before→after when BOTH sides measured');
  assert.doesNotMatch(panel, /30\.0%/, 'a before-only rate never renders half a loop');
  // open action = '—'; identified dates real; the write path is named
  assert.match(panel, /<td>—<\/td>/, 'an open action shows no invented action text');
  assert.match(panel, /2026-06-27/, 'a1 identified date');
  assert.match(panel, /ALLERGEN_HANDLING <span class="ash">auto<\/span>/, 'auto-raised actions are marked');
  assert.match(panel, /write path = the reviews action log CLI \(reviews action log &lt;CODE&gt; "what changed"\) — the board never writes/, 'the CLI is named as the ONLY write path');
  db.close();
});

// ---------------- (g) data readiness ----------------

// R2: the readiness panel lives on the EXECUTIVE tab now (its mock home — one home per fact);
// these two tests render THAT tab. The reviews-tab deletion pin lives in the R2 file.
const readinessSlice = (body) => {
  const a = body.indexOf('Data readiness');
  assert.ok(a >= 0, 'the readiness panel exists on executive');
  return body.slice(a);
};

test('readiness: Ready paths real, the ABSENT OpenTable store says exactly so, identity not started, fs-vs-db caption', () => {
  const db = makeDb(); // has sales_receipts_api + review_corpus; NO opentable_reservations/covers_day tables
  seedReviews(db);
  const body = render(db, { tab: 'executive' });
  const panel = readinessSlice(body);
  assert.equal((panel.match(/<span class="r-tag good">Ready<\/span>/g) || []).length, 2, 'per-receipt + reviews dept are Ready');
  assert.match(panel, /sales_receipts_api — per-receipt truth flowing/);
  assert.match(panel, /review_corpus \+ review_snapshot — the wired reviews dept/);
  assert.match(panel, /<span class="r-tag bad">no feed — 0 files received<\/span>/, 'the OpenTable bad tag');
  assert.match(panel, /no reservation store in the DB — the weekly export has never landed/, 'the absent-store sentence, exactly');
  assert.match(panel, /<span class="r-tag">not started<\/span>/, 'guest identity is neutral, not red');
  assert.match(panel, /readiness read from the DB; the export inbox is a box path the board cannot see/, 'the fs-vs-db honesty caption');
  db.close();
});

test('readiness: a PRESENT OpenTable store flips honestly — empty store ≠ absent store ≠ rows', () => {
  const empty = makeDb();
  seedReviews(empty);
  empty.exec(`CREATE TABLE covers_day (business_date TEXT PRIMARY KEY, covers INTEGER)`);
  const b1 = render(empty, { tab: 'executive' });
  assert.match(b1, /reservation store present but empty — no export ingested yet/, 'present-but-empty is its own honest state');
  assert.doesNotMatch(b1, /no reservation store in the DB/, 'the absent-store sentence never fires when a store exists');
  empty.close();

  const withRows = makeDb();
  seedReviews(withRows);
  withRows.exec(`CREATE TABLE opentable_reservations (reservation_id TEXT PRIMARY KEY, business_date TEXT)`);
  withRows.prepare(`INSERT INTO opentable_reservations VALUES ('ot1','2026-07-01')`).run();
  const b2 = render(withRows, { tab: 'executive' });
  const panel = readinessSlice(b2);
  assert.equal((panel.match(/<span class="r-tag good">Ready<\/span>/g) || []).length, 3, 'the OpenTable row goes Ready with rows');
  assert.match(panel, /reservation rows present/);
  assert.doesNotMatch(panel, /no feed — 0 files received/);
  withRows.close();
});

test('architecture cards: 4 definitional TEXT cards — the four ruled sources, no numbers', () => {
  const db = makeDb();
  seedReviews(db);
  const body = render(db);
  const a = body.indexOf('Recommended data architecture');
  assert.ok(a >= 0);
  const panel = body.slice(a);
  for (const name of ['OpenTable GuestCenter', 'Lightspeed K-Series', 'LivePepper / COMBO', 'Customer identity map'])
    assert.ok(panel.includes(name), `card ${name}`);
  assert.equal((panel.match(/class="r-driver"/g) || []).length, 4, 'four cards');
  assert.doesNotMatch(panel.replace(/<[^>]*>/g, ''), /\d/, 'definitional text only — never a number');
  db.close();
});

// ---------------- (h) no mock numbers ----------------

test('NO-MOCK-NUMBERS: an EMPTY db renders no rating digit and no star anywhere on the whole page', () => {
  const db = makeDb(); // tables exist, zero rows — the honest-empty worst case
  const body = render(db);
  assert.doesNotMatch(body, /★|☆/, 'no stars without a real rating — zero stars would claim a zero rating');
  assert.doesNotMatch(body, /r-kpi-value">[1-9]/, 'no non-zero KPI value can appear from an empty box');
  assert.equal((body.match(/r-kpi-value">—</g) || []).length, 5, 'four rating tiles + response rate are honest dashes');
  assert.match(body, /r-kpi-value">0</, 'reviews-last-90d shows its TRUE zero (the corpus exists and is empty)');
  assert.match(body, /No review snapshot yet/, 'the strip names its blocker');
  assert.match(body, /no rated review in the trailing 12 months/, 'trend empty-state');
  assert.doesNotMatch(body, /<polyline|class="rsv-vol"/, 'no chart geometry without data');
  assert.match(body, /no issue extractions yet \(review_issues is empty\)/, 'themes empty-state');
  assert.match(body, /no actions logged yet \(review_actions is empty\)/, 'actions empty-state');
  // (the readiness 'no rows' pin moved with the panel to the EXECUTIVE tab — see the R2 file)
  db.close();
});

// ---------------- (i) registry + server wiring ----------------

test('registry: the Reports group order = revenue, report-library, rota-review, reservations; route + ico pinned', () => {
  const S = require('../mission-control/ui/shared.js');
  const coyote = S.WORKSPACES.find((w) => w.key === 'coyote');
  const reportsGroup = coyote.groups.find((g) => g.group === 'Reports');
  assert.deepEqual(reportsGroup.items.map((i) => i.key), ['revenue', 'report-library', 'rota-review', 'reservations', 'labour'], 'Reservations lands AFTER Rota Review (Labour joined the group — centre L1)');
  const item = reportsGroup.items[3];
  assert.equal(item.label, 'Reservations');
  assert.equal(item.route, '/coyote/reservations');
  assert.match(item.ico, /M12 2a4 4 0 0 1 4 4c0 2\.5-4 7-4 7s-4-4\.5-4-7a4 4 0 0 1 4-4z/, 'the ruled location-pin mark');
});

test('server: PAGES requires the reservations page (after reports.js) so the route serves', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../mission-control/server.js'), 'utf8');
  assert.match(src, /require\('\.\/ui\/pages\/coyote\/reservations\.js'\)/, 'registered in PAGES');
  assert.ok(src.indexOf("require('./ui/pages/coyote/reports.js')") < src.indexOf("require('./ui/pages/coyote/reservations.js')"), 'listed after reports.js');
});
