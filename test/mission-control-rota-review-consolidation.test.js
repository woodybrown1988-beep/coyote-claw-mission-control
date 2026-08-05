'use strict';
// Rota Review consolidation (operator ruling 2026-07-22): the standalone nav item + route were
// RETIRED, and the FULL report (FORWARD/HINDSIGHT verdicts + per-daypart items + the week-on-week
// run history) is preserved as the Labour Centre's "Rota Review" tab. /coyote/rota-review
// 308-redirects there. This test proves the retirement is clean AND loses no capability — the exact
// thing the operator flagged ("retiring a route must not lose a capability", esp. run history +
// the forward/hindsight distinction).
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA = require('../mission-control/ui/data.js');
const labour = require('../mission-control/ui/pages/coyote/labour.js');
const S = require('../mission-control/ui/shared.js');

const NOW = Date.parse('2026-07-22T09:00:00Z');

// rota_review_runs seeded like the cc cadence writes it — one row per run, report_json holds verdicts.
function runsDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE rota_review_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, mode TEXT, week_monday TEXT, ran_at INTEGER, status TEXT, trigger TEXT, rota_fingerprint TEXT, report_json TEXT, report_text TEXT, error TEXT);
    CREATE TABLE labour_day (business_date TEXT);
  `);
  const fwd = JSON.stringify({ weekMonday: '2026-07-27', verdicts: [{ dept: 'kitchen', plannedTruePence: 96645, salariedPence: 78239, budgetPence: 577300, forecastNetPence: 3490000, deltaPence: -480655, pctOfForecast: 0.0277 }], items: [{ kind: 'UNDER', date: '2026-07-27', dept: 'kitchen', part: 'DINNER', hours: 16.4, pence: 34475, note: 'projected £974/h > own p90 £191/h — service risk' }], mixNotes: {}, lines: [], gaps: [] });
  const hind = JSON.stringify({ weekMonday: '2026-07-13', verdicts: [{ dept: 'kitchen', plannedTruePence: 460000, salariedPence: 78239, budgetPence: 441500, forecastNetPence: 2540000, deltaPence: 18500, pctOfForecast: 0.181 }], items: [], mixNotes: {}, lines: [], gaps: [] });
  const ins = db.prepare(`INSERT INTO rota_review_runs (mode, week_monday, ran_at, status, trigger, report_json) VALUES (?,?,?,?,?,?)`);
  ins.run('forward', '2026-07-27', NOW - 3600000, 'ok', 'thursday', fwd);
  ins.run('hindsight', '2026-07-13', NOW - 7200000, 'ok', 'monday', hind);
  return db;
}
const renderTab = (db, tab) => { const ctx = { q: (s, p) => DATA.safeSelect(db, s, p), now: NOW, query: { tab } }; return labour.render(labour.getSection(db, ctx), ctx); };

test('nav: the standalone Rota Review item is RETIRED; the canonical Reports order stands', () => {
  const reports = S.WORKSPACES.find((w) => w.key === 'coyote').groups.find((g) => g.group === 'Reports');
  const keys = reports.items.map((i) => i.key);
  assert.ok(!keys.includes('rota-review'), 'no standalone Rota Review nav item');
  assert.deepEqual(keys, ['revenue', 'labour', 'costs', 'reservations', 'operations', 'inventory', 'customer-growth', 'kitchen-safety', 'report-library', 'files']);
});

test('CAPABILITY PRESERVED: the Labour "Rota Review" tab renders the FULL report — verdicts + per-daypart items + run history', () => {
  const db = runsDb();
  // the subtab is exposed
  assert.match(renderTab(db, 'executive').body, /labour\?tab=rota-review/, 'the Rota Review subtab is linked');
  // the tab delegates to the same renderer and shows everything the standalone page did
  const body = renderTab(db, 'rota-review').body;
  assert.match(body, /FORWARD/, 'FORWARD verdict section (the forward/hindsight distinction)');
  assert.match(body, /HINDSIGHT/, 'HINDSIGHT verdict section');
  assert.match(body, /Run history/, 'the week-on-week receipts table');
  assert.match(body, /2026-07-27/, 'the forward-week receipt is in the history');
  assert.match(body, /2026-07-13/, 'the hindsight-week receipt is in the history');
  assert.match(body, /DINNER/, 'a per-daypart OVER/UNDER line item survives');
});

test('routing: /coyote/rota-review 308-redirects to the Labour tab and is no longer a standalone PAGE route', () => {
  const srv = fs.readFileSync(path.join(__dirname, '../mission-control/server.js'), 'utf8');
  assert.match(srv, /'\/coyote\/rota-review':\s*'\/coyote\/labour\?tab=rota-review'/, 'the 308 redirect entry exists');
  assert.doesNotMatch(srv, /require\('\.\/ui\/pages\/coyote\/rota-review\.js'\)/, 'server.js no longer registers rota-review as a page (labour.js hosts its renderer)');
});
