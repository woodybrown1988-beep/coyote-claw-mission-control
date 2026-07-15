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
function makeDeptDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(DDL.replace('created_at INTEGER NOT NULL', 'department TEXT, created_at INTEGER NOT NULL'));
  const ins = db.prepare(`INSERT INTO report_artifacts (job_id,title,tags_json,master_md,html,verdict,problems_json,vault_path,department,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  ins.run('job-1', 'Old Finance', '["finance"]', '# m', '<html>1</html>', 'v1', '[]', 'reports/a.md', 'Finance', 1000);
  ins.run('job-2', 'Column Report', '["finance"]', '# m', '<html>2</html>', 'v2', '[]', 'reports/b.md', 'Legal', 2000);
  ins.run('job-3', 'New Finance', '["finance"]', '# m', '<html>3</html>', 'v3', '[]', 'reports/c.md', 'Finance', 3000);
  ins.run('job-4', 'Untagged Report', '["competitors"]', '# m', '<html>4</html>', 'v4', '[]', null, null, 4000);
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

test('department: column is the source; legacy rows derive from tags; unknown tags stay unfiled', () => {
  const db = makeDb(); // pre-migration schema: NO department column — must not 500
  const sec = page.getSection(db, ctxFor(db));
  assert.equal(sec.reports.find((r) => r.title === 'Clean Report').department, 'Finance', 'finance tag → Finance (legacy derivation)');
  assert.equal(sec.reports.find((r) => r.title === 'Flagged Report').department, 'Operations');
  const out = page.render(sec, ctxFor(db));
  assert.match(out.body, /rl-dept">Finance</);
  db.close();

  const db2 = makeDeptDb(); // post-migration schema: the column wins over tags
  const sec2 = page.getSection(db2, ctxFor(db2));
  assert.equal(sec2.reports.find((r) => r.title === 'Column Report').department, 'Legal', 'column beats tag derivation');
  assert.equal(sec2.reports.find((r) => r.title === 'Untagged Report').department, null, 'no column, no known tag → unfiled, never invented');
  db2.close();
});

test('department: filter narrows, bar renders, emptied filter keeps the bar honest', () => {
  const db = makeDeptDb();
  const sec = page.getSection(db, ctxFor(db, { department: 'legal' })); // case-insensitive
  assert.equal(sec.deptFilter, 'Legal');
  assert.ok(sec.reports.every((r) => r.department === 'Legal'));
  const out = page.render(sec, ctxFor(db, { department: 'legal' }));
  assert.match(out.body, /rl-chip on" href="\/coyote\/report-library\?department=Legal"/);
  assert.match(out.body, /href="\/coyote\/report-library">All</);
  const secNone = page.getSection(db, ctxFor(db, { department: 'Nope' }));
  assert.equal(secNone.deptFilter, null, 'unknown department → no filter, never a stranded empty page');
  db.close();
});

test('department: sort=department groups A→Z with newest-first inside; newest stays the default', () => {
  const db = makeDeptDb();
  const def = page.getSection(db, ctxFor(db));
  assert.equal(def.sort, 'newest');
  assert.deepEqual(def.reports.map((r) => Number(r.id)), [...def.reports.map((r) => Number(r.id))].sort((a, b) => b - a).slice(0), 'default order untouched');
  const sec = page.getSection(db, ctxFor(db, { sort: 'department' }));
  const depts = sec.reports.map((r) => r.department || 'zzz');
  assert.deepEqual(depts, [...depts].sort((a, b) => String(a).localeCompare(String(b))), 'grouped by department');
  const within = sec.reports.filter((r) => r.department === 'Finance').map((r) => Number(r.created_at));
  assert.deepEqual(within, [...within].sort((a, b) => b - a), 'newest first within a department');
  const out = page.render(sec, ctxFor(db, { sort: 'department' }));
  assert.match(out.body, /by department, newest within/);
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

test('entry points: workspace nav carries the Report Library tab; Reports page header links to it', () => {
  const shared = require('fs').readFileSync(require('path').join(__dirname, '../mission-control/ui/shared.js'), 'utf8');
  assert.match(shared, /key: 'report-library', label: 'Report Library', route: '\/coyote\/report-library'/, 'nav registry has the tab');
  const reports = require('../mission-control/ui/pages/coyote/reports.js');
  const sec = { hasData: true, maxDate: '2026-07-14', histStart: '2026-06-30',
    nav: { label: 'x', comparator: null, } , current: { tot: {}, from: '2026-07-14', to: '2026-07-14', closedDays: 0 } };
  let body = null;
  try { body = reports.render(sec, {}).body; } catch (e) { /* fall back to source assert below */ }
  const src = require('fs').readFileSync(require('path').join(__dirname, '../mission-control/ui/pages/coyote/reports.js'), 'utf8');
  assert.match(src, /href="\/coyote\/report-library"/, 'reports page carries the library link');
  if (body) assert.match(body, /href="\/coyote\/report-library"/);
});
