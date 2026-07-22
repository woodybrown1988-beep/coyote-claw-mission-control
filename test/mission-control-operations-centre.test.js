'use strict';
// Operations Centre — the build-ahead scaffold (operator ruling 2026-07-22: "build it, we can connect
// later"), after the Stage-1 overlap audit found it's a NEW service-execution domain gated on four
// un-wired sources (KDS / OpenTable / digital-order / defect-capture), NOT a re-render. Pinned:
//   (a) SHELL/REGISTRY: 7 tabs, executive default, ?tab= switch, under .rcc, nav after kitchen-safety,
//       server requires it, the /coyote/operations→overview redirect is REMOVED.
//   (b) NO-MOCK-NUMBERS: every KPI reads "—" on every tab, empty DB or live (the whole scaffold rule).
//   (c) SOURCE GATES: the four service gates + composite appear; every gate names a wiring unlock.
//   (d) ONE-HOME: the attention queue + core safeguards are POINTERS (re-render), never recomputed —
//       they name Rex / the Decision Feed / the home centre, and fabricate no number.
//   (e) CONNECTION-STATE (the live heart): reads the real wire-state — 4 service dark always; the 4
//       imports go live when their tables exist.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const page = require('../mission-control/ui/pages/coyote/operations.js');
const S = require('../mission-control/ui/shared.js');

const TABS = ['executive', 'live', 'kitchen', 'foh', 'takeaway', 'quality', 'scorecards'];
const render = (db, tab) => { const ctx = { q: (s, p) => DATA.safeSelect(db, s, p), now: 0, query: tab ? { tab } : {} }; return page.render(page.getSection(db, ctx), ctx); };
const sectionOf = (db) => { const ctx = { q: (s, p) => DATA.safeSelect(db, s, p), now: 0, query: {} }; return page.getSection(db, ctx); };

// A DB with the four LIVE import sources present (Revenue/Labour/Reviews/Kitchen-Safety).
function importsLiveDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sales_day(business_date TEXT);
    CREATE TABLE labour_day(business_date TEXT);
    CREATE TABLE review_aggregate(id TEXT);
    CREATE TABLE ks_sync_meta(table_name TEXT PRIMARY KEY, row_count INTEGER, synced_at INTEGER);
    INSERT INTO ks_sync_meta VALUES('ks_temp_log_entries', 802, 0);
  `);
  return db;
}

test('shell: 7 tabs, executive default, ?tab= switch, unknown → executive, whole page under .rcc', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  const body = render(db).body;
  for (const k of TABS) assert.ok(body.includes(`href="/coyote/operations?tab=${k}"`), `tab ${k}`);
  assert.equal((body.match(/class="r-tab[ "]/g) || []).length, 7, '7 subtabs');
  assert.match(body, /class="r-tab active" href="\/coyote\/operations\?tab=executive"/, 'executive default');
  assert.match(render(db, 'scorecards').body, /class="r-tab active" href="\/coyote\/operations\?tab=scorecards"/, '?tab switches');
  assert.match(render(db, 'nonsense').body, /class="r-tab active" href="\/coyote\/operations\?tab=executive"/, 'unknown → executive');
  assert.equal(body.indexOf('<div class="rcc">'), 0, 'under .rcc');
});

test('registry + nav + routing: operations after kitchen-safety; server requires it; redirect REMOVED', () => {
  const reports = S.WORKSPACES.find((w) => w.key === 'coyote').groups.find((g) => g.group === 'Reports');
  const keys = reports.items.map((i) => i.key);
  assert.ok(keys.includes('operations'), 'operations in the Reports group'); // canonical order pinned in the registry tests
  assert.equal(reports.items.find((i) => i.key === 'operations').route, '/coyote/operations');
  const srv = require('node:fs').readFileSync(require('node:path').join(__dirname, '../mission-control/server.js'), 'utf8');
  assert.match(srv, /require\('\.\/ui\/pages\/coyote\/operations\.js'\)/, 'server requires operations');
  assert.doesNotMatch(srv, /'\/coyote\/operations':\s*'\/coyote\/overview'/, 'the operations→overview redirect is gone');
  assert.match(srv, /'\/operations':\s*'\/coyote\/operations'/, 'the workspace-prefix redirect stays');
  assert.equal(page.key, 'operations'); assert.equal(page.route, '/coyote/operations');
});

test('THE SCAFFOLD RULE — every KPI reads "—" on every tab, empty DB AND live imports (no mock numbers)', () => {
  for (const db of [new sqlite.DatabaseSync(':memory:'), importsLiveDb()]) {
    for (const tab of TABS) {
      const body = render(db, tab).body;
      const kpis = body.match(/r-kpi-value">([^<]*)</g) || [];
      assert.ok(kpis.length >= 6, `${tab}: has KPI tiles`);
      for (const v of kpis) assert.ok(v.includes('—'), `${tab}: KPI reads — (got ${v})`);
      assert.ok(!body.includes('NaN') && !body.includes('undefined'), `${tab}: no NaN/undefined`);
      // no fabricated operational metric value (real ones in this mock are decimals, e.g. "11.8 min");
      // integer window labels like "Orders last 15 min" are metric NAMES, not fabricated data.
      assert.doesNotMatch(body, /\b\d+\.\d+\s?min\b/, `${tab}: no fabricated prep-time value`);
      assert.doesNotMatch(body, /\b\d+\s?\/\s?100\b/, `${tab}: no fabricated score/100`);
    }
  }
});

test('source gates: the four service gates + composite appear; every gate-state names a wiring unlock', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  const all = TABS.map((t) => render(db, t).body).join('');
  assert.match(all, /KDS-gated/); assert.match(all, /OpenTable-gated/);
  assert.match(all, /digital-order gated/); assert.match(all, /defect-capture gated/);
  assert.match(all, /composite · all sources/);
  const unlocks = (all.match(/Unlock:/g) || []).length;
  assert.ok(unlocks >= 12, `every gate names its wiring unlock (${unlocks})`);
  // the four connections plan is present
  assert.match(render(db, 'executive').body, /The four connections to make/);
});

test('ONE-HOME: the attention queue + core safeguards are re-render POINTERS, never recomputed', () => {
  const body = render(new sqlite.DatabaseSync(':memory:'), 'executive').body;
  assert.ok((body.match(/one-home · re-render/g) || []).length >= 2, 'attention queue + core safeguards tagged re-render');
  assert.match(body, /Rex/, 'names Rex as the home');
  assert.match(body, /Decision Feed/, 'names the Decision Feed');
  assert.match(body, /not recomputed here/, 'explicit: not recomputed');
  // and no fabricated number in the queue (e.g. "5 actions", "43 late orders" from the mock)
  assert.doesNotMatch(body, /\b\d+ late orders\b/);
});

test('connection-state (the live heart): 4 service sources always dark; imports light up when present', () => {
  // empty DB → 0 live imports
  const empty = sectionOf(new sqlite.DatabaseSync(':memory:'));
  assert.equal(empty.serviceWired, 0, 'no service source is ever wired in the scaffold');
  assert.equal(empty.liveImports, 0, 'empty DB → no imports live');
  // live imports DB → all four imports live, service still 0
  const live = sectionOf(importsLiveDb());
  assert.equal(live.liveImports, 4, 'Revenue+Labour+Reviews+KitchenSafety live');
  assert.equal(live.serviceWired, 0, 'the four service sources remain dark (build-ahead)');
  const body = render(importsLiveDb(), 'executive').body;
  assert.match(body, /Data architecture .{0,6}connection state/); // '&' is HTML-escaped to &amp;
  assert.match(body, /NOT WIRED/, 'dark service sources shown honestly');
  assert.match(body, /CONNECTED/, 'live imports shown connected');
});

test('scorecards hard-override is a re-render of the Kitchen Safety red-cap, not a recompute', () => {
  const body = render(new sqlite.DatabaseSync(':memory:'), 'scorecards').body;
  assert.match(body, /Hard override/);
  assert.match(body, /red-cap/i);
  assert.match(body, /\/coyote\/kitchen-safety/, 'points to the Kitchen Safety Centre');
});
