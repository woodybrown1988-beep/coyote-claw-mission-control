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
//       and the degradation banner naming BOTH operator items with dates drawn FROM the data.
//   (e) CRM anchor: 0 unified profiles + ~100% unknown revenue + the identity-capture adoption unlock.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const page = require('../mission-control/ui/pages/coyote/customer-growth.js');
const S = require('../mission-control/ui/shared.js');

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

test('LIVE reputation heart: real corpus numbers, one-home to Reviews, degradation banner from the data', () => {
  const body = render(reviewsDb(), 'executive').body;
  assert.match(body, /Reputation .{0,6}reach/); // '&' is HTML-escaped to &amp;
  assert.match(body, /★ 4\.\d/, 'a real average rating renders');
  assert.match(body, /4 reviews across platforms/, 'real corpus total (4 seeded)');
  assert.match(body, /2 unposted reply drafts/, 'real reply backlog (2 drafts)');
  assert.match(body, /\/coyote\/reviews/, 'one-home link to the Reviews page');
  // degradation banner names BOTH operator items with dates DRAWN FROM the data
  assert.match(body, /Google OAuth/); assert.match(body, /Anthropic credit/);
  assert.match(body, /stale since 2026-07-06/, 'Google stale date from the seeded latest google review');
  assert.match(body, /stale since 2026-07-05/, 'extractor stale date from the seeded latest issue');
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
  assert.equal(byKey.reviews, 'degraded', 'reviews present → wired-degraded');
  assert.equal(byKey.channel, 'live', 'sales_by_channel present → live');
  assert.equal(byKey.crm, 'nosource', 'no identity tables → no-source');
  assert.ok(sec.counts.nosource >= 1 && sec.counts.integration >= 3, 'the split is mostly integration/no-source');
});
