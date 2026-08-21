'use strict';
// Customer Growth Centre — build-ahead scaffold (operator: "build it") after the Stage-1 four-way
// probe: ~10% LIVE (reputation), ~15% NEEDS-INTEGRATION, ~75% NO-SOURCE (a customer-identity business
// gap). Pinned:
//   (a) SHELL/REGISTRY: 8 tabs, executive default, ?tab switch, under .rcc, nav after operations,
//       server requires it.
//   (b) NO FABRICATED NUMBERS: KPI values are only — / real reputation (from the corpus) / the CRM
//       anchor 0 / ~100% — never the mock's marketing fictions (3,284 customers, £31.6k, 11,842 CRM).
//   (c) FOUR-WAY VERDICT: the four tags appear; no-source/integration panels name their source/unlock.
//   (d) LIVE reputation heart: real counts/ratings from a seeded corpus, one-home link to Reviews,
//       and a degradation banner DERIVED from per-platform coverage — never asserting a cause.
//   (e) CRM anchor: 0 unified profiles + ~100% unknown revenue + the identity-capture adoption unlock.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const page = require('../mission-control/ui/pages/coyote/customer-growth.js');
const S = require('../mission-control/ui/shared.js');
const GROWTH = require('../mission-control/ui/growth-export.js');
const fs = require('node:fs');
const path = require('node:path');

const TABS = ['executive', 'market', 'acquisition', 'retention', 'campaigns', 'partners', 'content', 'crm'];
const render = (db, tab) => { const ctx = { q: (s, p) => DATA.safeSelect(db, s, p), now: 0, query: tab ? { tab } : {} }; return page.render(page.getSection(db, ctx), ctx); };
const sectionOf = (db) => page.getSection(db, { q: (s, p) => DATA.safeSelect(db, s, p), now: 0, query: {} });

// A DB with a real reviews corpus (the LIVE-degraded slice), no customer identity anywhere.
function reviewsDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE review_corpus(platform TEXT, overall REAL, reviewed_date TEXT, has_reply INTEGER);
    CREATE TABLE review_drafts(draft_status TEXT);
    CREATE TABLE review_issues(extracted_at TEXT);
    CREATE TABLE sales_by_channel(channel TEXT);
    -- the engine-stored PLATFORM-REPORTED ratings (rating-path unification 2026-08-10):
    -- values deliberately DIFFER from the corpus averages (google corpus avg = 4.2) so the
    -- assertions prove the page reads the snapshot, never recomputes
    CREATE TABLE review_snapshot(overall_rating REAL, google_rating REAL, tripadvisor_rating REAL, opentable_rating REAL, fetched_at INTEGER);
    INSERT INTO review_snapshot VALUES (4.7, 4.77, 4.5, 4.8, 1000);
    INSERT INTO review_corpus VALUES ('google',4.4,'2026-07-06T10:00:00Z',1),('google',4.0,'2026-07-02',0),
      ('tripadvisor',4.6,'2026-07-13',0),('opentable',4.7,'2026-07-19',0);
    INSERT INTO review_drafts VALUES ('draft'),('draft'),('posted');
    INSERT INTO review_issues VALUES ('2026-07-05T09:00:00Z'),('2026-06-30');
    INSERT INTO sales_by_channel VALUES ('EAT IN');
  `);
  return db;
}

test('shell: 8 tabs, executive default, ?tab switch, unknown → executive, under .rcc', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  const body = render(db).body;
  for (const k of TABS) assert.ok(body.includes(`href="/coyote/customer-growth?tab=${k}"`), `tab ${k}`);
  assert.equal((body.match(/class="r-tab[ "]/g) || []).length, 8, '8 subtabs');
  assert.match(body, /class="r-tab active" href="\/coyote\/customer-growth\?tab=executive"/, 'executive default');
  assert.match(render(db, 'crm').body, /class="r-tab active" href="\/coyote\/customer-growth\?tab=crm"/, '?tab switches');
  assert.match(render(db, 'zzz').body, /class="r-tab active" href="\/coyote\/customer-growth\?tab=executive"/, 'unknown → executive');
  assert.equal(body.indexOf('<div class="rcc">'), 0, 'under .rcc');
});

test('registry + nav: customer-growth after operations; server requires it; contract', () => {
  const reports = S.WORKSPACES.find((w) => w.key === 'coyote').groups.find((g) => g.group === 'Reports');
  const keys = reports.items.map((i) => i.key);
  assert.ok(keys.includes('customer-growth'), 'customer-growth in the Reports group'); // canonical order pinned in the registry tests
  assert.equal(reports.items.find((i) => i.key === 'customer-growth').route, '/coyote/customer-growth');
  const srv = require('node:fs').readFileSync(require('node:path').join(__dirname, '../mission-control/server.js'), 'utf8');
  assert.match(srv, /require\('\.\/ui\/pages\/coyote\/customer-growth\.js'\)/);
  assert.equal(page.key, 'customer-growth'); assert.equal(page.route, '/coyote/customer-growth');
});

test('NO FABRICATED NUMBERS: the mock’s marketing fictions never render (empty DB and with reviews)', () => {
  for (const db of [new sqlite.DatabaseSync(':memory:'), reviewsDb()]) {
    for (const tab of TABS) {
      const body = render(db, tab).body;
      for (const fiction of ['3,284', '£31.6k', '32.8%', '11,842', '6,914', '£7.84', '£354k', '84.6%']) {
        assert.ok(!body.includes(fiction), `${tab}: must not render the mock fiction ${fiction}`);
      }
      assert.ok(!body.includes('NaN') && !body.includes('undefined'), `${tab}: no NaN/undefined`);
    }
  }
});

test('four-way verdict: all four tags appear; no-source/integration panels name source + unlock', () => {
  const all = TABS.map((t) => render(new sqlite.DatabaseSync(':memory:'), t).body).join('');
  assert.match(all, /live · degraded/, 'live-degraded tag');
  assert.match(all, /wired · degraded/, 'degraded verdict tag');
  assert.match(all, /needs integration/, 'integration tag');
  assert.match(all, /no source/, 'no-source tag');
  assert.match(all, /one-home · surface/, 'one-home pointer tag');
  assert.ok((all.match(/Unlock:/g) || []).length >= 12, 'panels name their unlock');
  // no-source explicitly names the business-model gap, not a wiring job
  assert.match(all, /BUSINESS DECISION to start capturing customer identity/);
});

test('LIVE reputation heart: PLATFORM-REPORTED ratings (review_snapshot) + corpus counts, one-home to Reviews, degradation banner from the data', () => {
  const body = render(reviewsDb(), 'executive').body;
  assert.match(body, /Reputation .{0,6}reach/); // '&' is HTML-escaped to &amp;
  // rating-path unification (ruling 2026-08-10): stars = the engine-stored platform ratings,
  // NEVER a corpus recompute (the A5.3 audit finding — snapshot 4.77 vs corpus-avg 4.2)
  assert.match(body, /★ 4\.77/, 'the google star is the SNAPSHOT value');
  assert.ok(!body.includes('★ 4.2'), 'the corpus-average google rating never renders');
  assert.match(body, /overall ★ 4\.7/, 'the overall star is the snapshot aggregate');
  assert.match(body, /no rating is recomputed here/, 'the (now true) one-home caption');
  assert.match(body, /4 reviews across platforms/, 'real corpus total (4 seeded)');
  assert.match(body, /2 unposted reply drafts/, 'real reply backlog (2 drafts)');
  assert.match(body, /\/coyote\/reviews/, 'one-home link to the Reviews page');
  // --- THE BANNER MUST NOT ASSERT A CAUSE IT CANNOT OBSERVE (2026-08-21) ---------------------
  // This banner used to name two standing causes in prose: "Google OAuth expired" and "Anthropic
  // credit dead". By the time the operator read them, he had re-consented the OAuth two days
  // earlier and the extractor had been off Anthropic since 2026-08-04. It was unconditional, so it
  // announced an outage that had ended and sent him to fix two things that were not broken —
  // while the REAL silence (a third-party feed) went unnamed for 22 days.
  //
  // THE CLASS: any banner stating WHY must derive the why. A hard-coded cause is a claim with no
  // way to become false, and it will outlive the fault it describes.
  assert.ok(!/Google OAuth/.test(body), 'no hard-coded cause');
  assert.ok(!/Anthropic/.test(body), 'and certainly not one the system stopped using');
  // This fixture holds 4 reviews — too little history to judge a cadence against, so the honest
  // output is NO banner at all. A healthy pipeline renders nothing here.
  assert.ok(!/has gone quiet/.test(body), 'a thin corpus is not evidence of an outage');
  // NEGATIVE CONTROL: corpus present but NO review_snapshot → ratings '—' + the explicit
  // unavailability line; the corpus average must NOT stand in
  const noSnap = new sqlite.DatabaseSync(':memory:');
  noSnap.exec(`CREATE TABLE review_corpus(platform TEXT, overall REAL, reviewed_date TEXT, has_reply INTEGER);
    INSERT INTO review_corpus VALUES ('google',4.4,'2026-07-06',0),('google',4.0,'2026-07-02',0);`);
  const nsBody = render(noSnap, 'executive').body;
  assert.match(nsBody, /platform ratings unavailable, never recomputed from the corpus/, 'missing snapshot says so');
  assert.ok(!/★ 4\.\d/.test(nsBody), 'no star figure is fabricated from the corpus');
  // empty DB → no fabricated reputation, honest not-present
  assert.match(render(new sqlite.DatabaseSync(':memory:'), 'executive').body, /not present on this box|—/);
});

test('CRM anchor: 0 unified profiles + ~100% unknown revenue + the identity-capture adoption unlock', () => {
  const body = render(reviewsDb(), 'crm').body;
  assert.match(body, /Unified customer profiles/);
  assert.match(body, />0</, 'zero profiles');
  assert.match(body, /~100%/, 'unknown customer revenue ~100%');
  assert.match(body, /captures no customer identity/i);
  assert.match(body, /What capturing identity would unlock/, 'the adoption plan');
  assert.match(body, /loyalty|CRM|booking-with-login/i, 'names the capture options');
});

test('source register: reviews degraded, CRM no-source, counts reflect real box state', () => {
  const sec = sectionOf(reviewsDb());
  const byKey = Object.fromEntries(sec.sources.map((s) => [s.key, s.state]));
  // Keyed on COVERAGE, not on the table existing. Under the old rule this row was pinned to
  // 'degraded' for as long as review_corpus existed — it could never go green again once the feed
  // was repaired, so the board could report a fixed pipeline as permanently broken.
  assert.equal(byKey.reviews, 'live', 'present AND no platform silent → live');
  assert.equal(byKey.channel, 'live', 'sales_by_channel present → live');
  assert.equal(byKey.crm, 'nosource', 'no identity tables → no-source');
  assert.ok(sec.counts.nosource >= 1 && sec.counts.integration >= 3, 'the split is mostly integration/no-source');
});

// ---- PR-B: retention panels off OpenTable guest_profiles + the opted-in export ----

function growthDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE covers_day (business_date TEXT PRIMARY KEY, total_covers INT, seated_covers INT);
    CREATE TABLE guest_profiles (identity_key TEXT PRIMARY KEY, marketing_opt_in INT, completed_visits INT,
      first_visit_date TEXT, recent_visit_date TEXT, lifetime_spend_pence INT, window_covers INT);
    CREATE TABLE reservations (reservation_key TEXT PRIMARY KEY, identity_key TEXT, status TEXT, visit_date TEXT,
      first_visit_date TEXT, party_size INT, guest TEXT, email TEXT, phone TEXT, marketing_opt_in INT);
    CREATE TABLE review_corpus (platform TEXT, overall REAL, reviewed_date TEXT, has_reply INT);
  `);
  db.prepare(`INSERT INTO covers_day VALUES ('2024-06-01', 50, 50)`).run();
  db.prepare(`INSERT INTO covers_day VALUES ('2026-07-22', 50, 50)`).run();
  const gp = db.prepare(`INSERT INTO guest_profiles VALUES (?,?,?,?,?,?,?)`);
  gp.run('k-ana', 1, 5, '2024-06-01', '2026-01-01', 12000, 12);   // opted + lapsed regular → in the export
  gp.run('k-bob', 0, 4, '2024-06-10', '2026-01-01', 9000, 8);     // NOT opted + lapsed → MUST be excluded
  gp.run('k-cid', 1, 2, '2025-01-01', '2026-07-20', 4000, 6);     // opted but recent → not lapsed
  gp.run('k-dan', null, 1, '2026-07-01', '2026-07-01', 2000, 4);  // one-timer
  const rv = db.prepare(`INSERT INTO reservations VALUES (?,?,?,?,?,?,?,?,?,?)`);
  rv.run('r1', 'k-ana', 'finished', '2024-06-01', '2024-06-01', 2, 'Ana Adams', 'ana@example.com', '+44700', 1);
  rv.run('r2', 'k-ana', 'finished', '2024-06-20', '2024-06-01', 4, 'Ana Adams', 'ana@example.com', '+44700', 1);
  rv.run('r3', 'k-bob', 'finished', '2024-06-10', '2024-06-10', 2, 'Bob Boyle', 'bob@example.com', '+44701', 0);
  rv.run('r4', 'k-cid', 'finished', '2025-01-01', '2025-01-01', 3, 'Cid Clark', 'cid@example.com', '+44702', 1);
  return db;
}

test('PR-B retention: four panels render with real values + the LIVE ceiling caption on every one', () => {
  const body = render(growthDb(), 'retention').body;
  assert.match(body, /Second-visit conversion/); assert.match(body, /Visit-frequency distribution/);
  assert.match(body, /Lapsed regulars/); assert.match(body, /Repeat vs new covers/);
  assert.match(body, /Repeat rate \(lifetime\)<\/div><div class="r-kpi-value"[^>]*>75\.0%</, 'lifetime repeat rate is the HEADLINE (3 of 4 booked 2+)');
  assert.match(body, /Identified guests<\/div><div class="r-kpi-value"[^>]*>4</);
  assert.match(body, /Lapsed regulars \(≥3\)<\/div><div class="r-kpi-value"[^>]*>2</, 'two lapsed regulars (Ana + Bob, both ≥3 visits)');
  assert.match(body, /90\+ days lapsed · 1 contactable/, 'only 1 lapsed regular is contactable — Ana (Bob not opted-in)');
  assert.match(body, /VIPs \(6\+ bookings\)/, 'the VIP segment KPI');
  assert.match(body, /Measures re-BOOKING[\s\S]*?UNDERSTATES true repeat behaviour/, 're-booking caveat present on the panels');
  assert.match(body, /short-window view — the lifetime repeat rate above is the headline/, 'second-visit reframed as short-window, not hero');
  assert.match(body, /identified guests only — \d+\.\d+% of covers/, 'live-computed identity ceiling');
  assert.match(body, /consent: \d+% of identified opted-in/, 'consent ceiling stated (separate from identity)');
});

test('PR-B NEGATIVE CONTROL: no identity-derived panel renders without its ceiling caption', () => {
  const body = render(growthDb(), 'retention').body;
  const idTags = (body.match(/OpenTable identity/g) || []).length;
  const ceilings = (body.match(/identified guests only —/g) || []).length;
  assert.ok(idTags >= 4, 'the four retention identity panels are present');
  assert.equal(ceilings, idTags, 'the ceiling caption is on EXACTLY the identity panels — none without it');
});

test('PR-B: no per-guest NAMES/emails render on ANY tab (aggregates + segments only)', () => {
  const db = growthDb();
  for (const tab of ['retention', 'acquisition', 'crm', 'executive']) {
    const body = render(db, tab).body;
    for (const pii of ['Ana Adams', 'Bob Boyle', 'Cid Clark', 'ana@example.com', '+44700']) {
      assert.doesNotMatch(body, new RegExp(pii.replace(/[.+*?^${}()|[\]\\]/g, '\\$&')), `${tab}: "${pii}" must never render on the board`);
    }
  }
});

test('PR-B EXPORT: lapsed-regular list is opted-in only (data-layer) — refuses non-opted-in guests', () => {
  const out = GROWTH.lapsedExportRows(growthDb(), '3');
  assert.deepEqual(out.rows.map((r) => r.name), ['Ana Adams'], 'only opted-in lapsed Ana; Bob (not opted) excluded');
  assert.ok(out.rows.every((r) => r.email), 'the download carries contact detail (not a board render)');
  const src = fs.readFileSync(path.join(__dirname, '../mission-control/ui/growth-export.js'), 'utf8');
  assert.match(src, /marketing_opt_in\s*=\s*1/, 'consent enforced in the SQL, not the caller');
  assert.equal(GROWTH.clampMinVisits('1'), 2); assert.equal(GROWTH.clampMinVisits('99'), 20); assert.equal(GROWTH.clampMinVisits('x'), 3);
  assert.match(GROWTH.toCsv(out.rows), /^name,email,phone,lifetime_visits,last_visit,lifetime_spend_gbp\nAna Adams,ana@example.com/);
});

test('PR-B: server registers the GET /api/lapsed-export download route', () => {
  const srv = fs.readFileSync(path.join(__dirname, '../mission-control/server.js'), 'utf8');
  assert.match(srv, /'\/api\/lapsed-export'/); assert.match(srv, /handleLapsedExport/);
  assert.match(srv, /content-disposition[\s\S]{0,90}attachment/i, 'a download, not a page render');
});

test('PR-B NO-SOURCE fallback: with no guest_profiles the retention tab keeps its honest nosource verdict', () => {
  const body = render(reviewsDb(), 'retention').body;
  assert.match(body, /no source|not captured/i, 'reverts to the nosource verdict');
  assert.doesNotMatch(body, /identified guests only —/, 'no ceiling caption without identity data');
});


// --- COVERAGE DRIVES THE BANNER, END TO END (2026-08-21) --------------------------------------
// The thin fixture above proves the quiet case. This proves the LOUD one: with enough history to
// establish a cadence, a feed that stops must be named — platform, date, and the gap it has beaten
// — and the healthy platforms must be named as healthy rather than smeared with it.
function silentGoogleDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE review_corpus(platform TEXT, overall REAL, reviewed_date TEXT, has_reply INTEGER);
    CREATE TABLE review_drafts(draft_status TEXT);
    CREATE TABLE review_snapshot(overall_rating REAL, google_rating REAL, tripadvisor_rating REAL,
      opentable_rating REAL, total INTEGER, awaiting_recent_text INTEGER, fetched_at INTEGER);
    CREATE TABLE sales_by_channel(channel TEXT);
    INSERT INTO sales_by_channel VALUES ('EAT IN');`);
  const now = Date.now();
  const day = (n) => new Date(now - n * 86400000).toISOString().slice(0, 10) + 'T00:00:00Z';
  const ins = db.prepare('INSERT INTO review_corpus VALUES (?,?,?,?)');
  // google: every 2 days for two months, then NOTHING for 22 days. tripadvisor: still current.
  for (let d = 80; d >= 22; d -= 2) ins.run('google', 4.5, day(d), 0);
  for (let d = 80; d >= 0; d -= 2) ins.run('tripadvisor', 4.5, day(d), 0);
  // Google's own profile count vs what reached us — the cross-check the board never made.
  db.prepare('INSERT INTO review_snapshot VALUES (?,?,?,?,?,?,?)').run(4.7, 3.86, 4.5, 4.8, 1386, 21, now);
  return db;
}

test('a genuinely silent feed IS named — platform, date, and the gap it beat', () => {
  const ctx = { q: (s, p) => DATA.safeSelect(silentGoogleDb(), s, p), now: Date.now(), query: { tab: 'executive' } };
  const db = silentGoogleDb();
  const c = { q: (s, p) => DATA.safeSelect(db, s, p), now: Date.now(), query: { tab: 'executive' } };
  const body = page.render(page.getSection(db, c), c).body;
  assert.match(body, /has gone quiet/, 'the outage is announced');
  assert.match(body, /google has delivered no review since/, 'and the platform is named');
  assert.match(body, /longest gap in the last year was 2/, 'it shows its working');
  assert.match(body, /tripadvisor is current to/, 'healthy platforms are not smeared');
  assert.ok(!/Anthropic/.test(body), 'still no invented cause');
  // The cross-check: 1,386 on the profile against what arrived.
  assert.match(body, /1,386 reviews against/, "Google's own count is compared to ours");
  void ctx;
});

test('the source register goes DEGRADED on silence and back to LIVE on repair', () => {
  const db = silentGoogleDb();
  const sec = page.getSection(db, { q: (s, p) => DATA.safeSelect(db, s, p), now: Date.now(), query: {} });
  assert.equal(Object.fromEntries(sec.sources.map((s) => [s.key, s.state])).reviews, 'degraded',
    'a silent feed degrades the row');
  // NEGATIVE CONTROL — and it must be able to come BACK. This is the half the old code could not do.
  const fixed = silentGoogleDb();
  const now = Date.now();
  fixed.prepare('INSERT INTO review_corpus VALUES (?,?,?,?)').run('google', 5, new Date(now).toISOString(), 0);
  const sec2 = page.getSection(fixed, { q: (s, p) => DATA.safeSelect(fixed, s, p), now, query: {} });
  assert.equal(Object.fromEntries(sec2.sources.map((s) => [s.key, s.state])).reviews, 'live',
    'one fresh review restores it — the state is reversible, which is the whole point');
});
