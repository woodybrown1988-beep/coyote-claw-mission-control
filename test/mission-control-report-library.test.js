'use strict';
// Report Library (the Coyote Report Standard's MC surface): list + flags LOUD +
// iframe viewer + the raw responder. SELECT-only; renders on an empty DB.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const page = require('../mission-control/ui/pages/coyote/report-library.js');
const { reportRawResponse } = require('../mission-control/server.js');

const DDL = `CREATE TABLE report_artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, title TEXT NOT NULL,
  tags_json TEXT NOT NULL, master_md TEXT NOT NULL, html TEXT NOT NULL,
  verdict TEXT, problems_json TEXT NOT NULL, vault_path TEXT, created_at INTEGER NOT NULL);`;

function makeDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(DDL);
  const ins = db.prepare(`INSERT INTO report_artifacts (job_id,title,tags_json,master_md,html,verdict,problems_json,vault_path,created_at) VALUES (?,?,?,?,?,?,?,?,?)`);
  ins.run('job-aaaa1111', 'Clean Report', '["finance"]', '# m', '<!DOCTYPE html><html><body>CLEAN HTML</body></html>', 'All fine, act on weekends.', '[]', 'reports/2026-07-14-clean.md', 1000);
  ins.run('job-bbbb2222', 'Flagged Report', '["operations"]', '# m', '<html>F</html>', null, '["UNCITED: no markers"]', null, 2000);
  return db;
}
const ctxFor = (db, query = {}) => ({ q: (sql, p) => DATA.safeSelect(db, sql, p), now: 3000, query });

test('contract + EMPTY db honest state', () => {
  assert.equal(page.route, '/coyote/report-library');
  const db = new sqlite.DatabaseSync(':memory:');
  const out = page.render(page.getSection(db, ctxFor(db)), ctxFor(db));
  assert.match(out.body, /No reports yet/);
  db.close();
});

test('list: newest first, tags + verdict snippet, flags LOUD, vault-pending visible', () => {
  const db = makeDb();
  const out = page.render(page.getSection(db, ctxFor(db)), ctxFor(db));
  assert.ok(out.body.indexOf('Flagged Report') < out.body.indexOf('Clean Report'), 'newest first');
  assert.match(out.body, /All fine, act on weekends\./);
  assert.match(out.body, /⚠ 1 flag/);
  assert.match(out.body, /vault pending/);
  assert.match(out.body, /reports\/2026-07-14-clean\.md/);
  db.close();
});

test('viewer: ?id=N renders the flags banner + iframe to the raw route', () => {
  const db = makeDb();
  const sec = page.getSection(db, ctxFor(db, { id: '2' }));
  assert.equal(sec.selected.title, 'Flagged Report');
  const out = page.render(sec, ctxFor(db, { id: '2' }));
  assert.match(out.body, /Validation flags: UNCITED: no markers/);
  assert.match(out.body, /iframe class="rl-frame" src="\/coyote\/report-library\/raw\?id=2"/);
  db.close();
});

test('raw responder: serves the stored standalone HTML; bad/unknown ids refuse', () => {
  const db = makeDb();
  const ok = reportRawResponse(db, '1');
  assert.equal(ok.status, 200);
  assert.match(ok.contentType, /text\/html/);
  assert.match(ok.body, /CLEAN HTML/);
  assert.equal(reportRawResponse(db, 'nope').status, 400);
  assert.equal(reportRawResponse(db, '999').status, 404);
  db.close();
});
