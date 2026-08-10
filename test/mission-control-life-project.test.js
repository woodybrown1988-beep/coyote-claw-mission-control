'use strict';
// LIFE OS — PROJECT DRAWER (operator ask 2026-08-10): clicking a project opens its own
// view with every task that lives in it — view (task drawer link), edit (rename), remove
// from the project (assign_project with a NULL home — the task lives on), or cancel (the
// audited delete). Pins: the four verbs per living task, terminal rows offer no verbs,
// project titles LINK to the drawer from the Projects page and the task drawer, honest
// not-found/absent states, escaping, and the same affordance/command allowlists every
// life page answers to.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite = require('node:sqlite');
const SHARED = require('../mission-control/ui/shared.js');
const PROJECT = require('../mission-control/ui/pages/life/project.js');
const PROJECTS = require('../mission-control/ui/pages/life/projects.js');
const TASK = require('../mission-control/ui/pages/life/task.js');

const T = '2026-08-05T12:00:00.000Z';

const SANCTIONED_LC = new Set(['data-lc-cancel', 'data-lc-cmd', 'data-lc-complete', 'data-lc-wait', 'data-lc-edit', 'data-lc-fab', 'data-lc-focus', 'data-lc-quiet', 'data-lc-route',
  'data-lc-rename', 'data-lc-cancel-project', 'data-lc-import', 'data-lc-recap', 'data-lc-assign-bulk']);
const CMD_ALLOWLIST = new Set(['note', 'decide', 'transition', 'complete', 'set_waiting', 'wake', 'reopen', 'undo', 'cancel',
  'plan_today', 'approve_plan', 'compile_week', 'approve_week', 'compile_quarter', 'approve_quarter',
  'pause_capability', 'resume_capability', 'create_outcome', 'create_project', 'set_route', 'set_setting',
  'rename_task', 'rename_project', 'cancel_project', 'import_preview', 'import_batch', 'assign_project', 'accept_standalone',
  'calendar_sync']);
function assertOnlySanctionedLc(body, key) {
  for (const m of body.matchAll(/data-lc-[a-z-]+/g)) assert.ok(SANCTIONED_LC.has(m[0]), `${key}: unsanctioned affordance ${m[0]}`);
  for (const m of body.matchAll(/data-lc-cmd="([^"]*)"/g)) {
    const parsed = JSON.parse(m[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&#39;', "'"));
    assert.ok(CMD_ALLOWLIST.has(parsed.command), `${key}: unknown command ${parsed.command}`);
  }
}

function withEnv(dbPath, fn) {
  const prev = process.env.COYOTE_LIFE_DB;
  process.env.COYOTE_LIFE_DB = dbPath;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.COYOTE_LIFE_DB; else process.env.COYOTE_LIFE_DB = prev;
  }
}

function makeFixture(dir) {
  const p = path.join(dir, 'life.db');
  const db = new sqlite.DatabaseSync(p);
  db.exec(`
    CREATE TABLE life_projects (id TEXT PRIMARY KEY, owner_id TEXT, domain_key TEXT, title TEXT,
      definition_of_done TEXT, stage TEXT, status TEXT, risk_state TEXT, due_date TEXT,
      visibility TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE life_tasks (id TEXT PRIMARY KEY, owner_id TEXT, outcome_id TEXT, project_id TEXT, domain_key TEXT,
      title TEXT, status TEXT, execution_mode TEXT, definition_of_done TEXT DEFAULT '', due_kind TEXT DEFAULT 'NONE',
      due_at TEXT, estimate_minutes INTEGER, importance INTEGER DEFAULT 3, consequence INTEGER DEFAULT 3,
      risk_level TEXT, visibility TEXT, source_type TEXT, created_by TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE life_waiting_conditions (id TEXT PRIMARY KEY, task_id TEXT, owner_id TEXT,
      dependency_label TEXT, wake_type TEXT, fallback_at TEXT, state TEXT, created_at TEXT, updated_at TEXT);
    CREATE VIEW v_life_available_work AS
      SELECT t.*, 0 AS calculated_priority FROM life_tasks t WHERE t.status IN ('READY','SCHEDULED','IN_PROGRESS');
    INSERT INTO life_projects VALUES
      ('pj1','woody','business','Loyalty pilot <q3>','Scorecard approved','DISCOVERY','ACTIVE','AMBER',NULL,'OWNER_ONLY','${T}','${T}'),
      ('pj2','woody','admin','Old drive tidy','Archive emptied','DELIVERY','DONE','GREEN',NULL,'OWNER_ONLY','${T}','${T}');
    INSERT INTO life_tasks (id, owner_id, project_id, domain_key, title, status, due_kind, due_at, visibility, source_type, created_by, created_at, updated_at) VALUES
      ('t1','woody','pj1','business','Draft criteria <script>alert(1)</script>','READY','HARD','2026-08-14','OWNER_ONLY','MANUAL','h','${T}','${T}'),
      ('t2','woody','pj1','business','Chase Como thread','WAITING','NONE',NULL,'OWNER_ONLY','MANUAL','h','${T}','${T}'),
      ('t3','woody','pj1','business','Costing session','IN_PROGRESS','NONE',NULL,'OWNER_ONLY','MANUAL','h','${T}','${T}'),
      ('t4','woody','pj1','business','Shipped groundwork','DONE','NONE',NULL,'OWNER_ONLY','MANUAL','h','${T}','${T}'),
      ('t5','woody',NULL,'admin','Unrelated standalone','READY','NONE',NULL,'OWNER_ONLY','MANUAL','h','${T}','${T}');
    INSERT INTO life_waiting_conditions VALUES ('w1','t2','woody','Como reply','EMAIL_REPLY','2026-08-12','ACTIVE','${T}','${T}');
  `);
  db.close();
  return p;
}

test('project drawer: header + DoD, living tasks with the four verbs, finished kept separate, escaped, allowlists hold', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-pj-'));
  const dbPath = makeFixture(dir);
  withEnv(dbPath, () => {
    const out = PROJECT.render(PROJECT.getSection(null, { query: { id: 'pj1' } }), {});
    const body = out.body;
    assert.ok(body.includes('Loyalty pilot &lt;q3&gt;'), 'project title renders escaped');
    assert.match(body, /Definition of done/);
    assert.match(body, /Scorecard approved/);
    // living tasks — in progress first, waiting last; the standalone t5 is NOT here
    assert.match(body, /Costing session/);
    assert.ok(body.indexOf('Costing session') < body.indexOf('Draft criteria'), 'status order: in-progress before ready');
    assert.ok(!body.includes('Unrelated standalone'), 'only tasks homed in THIS project');
    assert.ok(body.includes('Draft criteria &lt;script&gt;'), 'task titles escaped');
    assert.ok(!body.includes('<script>alert'), 'never raw');
    // the four verbs on a living task
    assert.match(body, /href="\/life\/task\?id=t1"/, 'VIEW: opens the task drawer');
    assert.match(body, /data-lc-rename/, 'EDIT: rename affordance present');
    const removeCmd = [...body.matchAll(/data-lc-cmd="([^"]*)"/g)]
      .map((m) => JSON.parse(m[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&#39;', "'")))
      .find((c) => c.command === 'assign_project' && c.payload.taskId === 't1');
    assert.ok(removeCmd && removeCmd.payload.projectId === null, 'REMOVE: assign_project with a null home — un-homed, not deleted');
    assert.match(body, /data-lc-cancel="t1"/, 'DELETE: the audited cancel verb');
    // waiting context surfaces
    assert.match(body, /Waiting on Como reply/);
    // finished stays separate, no verbs
    assert.match(body, /Finished here/);
    const finishedChunk = body.slice(body.indexOf('Finished here'));
    assert.ok(!/data-lc-cancel="t4"|data-lc-rename[^>]*t4/.test(finishedChunk), 'DONE rows offer no mutating verbs');
    // project's own controls
    assert.match(body, /cancel project/);
    assertOnlySanctionedLc(body, 'life-project');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('project drawer honest states: unknown id, missing id, absent life.db', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-pj-'));
  const dbPath = makeFixture(dir);
  withEnv(dbPath, () => {
    const missing = PROJECT.render(PROJECT.getSection(null, { query: { id: 'nope' } }), {});
    assert.match(missing.body, /Not found/);
    const noId = PROJECT.render(PROJECT.getSection(null, { query: {} }), {});
    assert.match(noId.body, /no project id/);
  });
  fs.rmSync(dir, { recursive: true, force: true });
  withEnv(path.join(os.tmpdir(), 'nonexistent-pj-dir', 'life.db'), () => {
    const absent = PROJECT.render(PROJECT.getSection(null, { query: { id: 'pj1' } }), {});
    assert.match(absent.body, /Nothing has been captured yet/);
  });
});

test('terminal project offers no rename/cancel; its tasks still open read-only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-pj-'));
  const dbPath = makeFixture(dir);
  withEnv(dbPath, () => {
    const body = PROJECT.render(PROJECT.getSection(null, { query: { id: 'pj2' } }), {}).body;
    assert.ok(!/data-lc-cancel-project|data-lc-rename/.test(body), 'finished project keeps its name — no mutating controls');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('every project touchpoint links here: Projects page cards + rest rows, task drawer project tag', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-pj-'));
  const dbPath = makeFixture(dir);
  withEnv(dbPath, () => {
    const pjs = PROJECTS.render(PROJECTS.getSection(null, {}), {}).body;
    assert.match(pjs, /href="\/life\/project\?id=pj1"/, 'active card title links to the project drawer');
    assert.match(pjs, /href="\/life\/project\?id=pj2"/, 'waiting/parked/finished rows link too');
    const drawer = TASK.render(TASK.getSection(null, { query: { id: 't1' } }), {}).body;
    assert.match(drawer, /href="\/life\/project\?id=pj1"/, "the task drawer's project tag opens the project");
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('wiring: server registers the route; workspaceOf resolves the drawer to the life workspace', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'mission-control', 'server.js'), 'utf8');
  assert.ok(src.includes("require('./ui/pages/life/project.js')"), 'server.js serves /life/project');
  assert.equal(SHARED.workspaceOf('life-project').key, 'life', 'prefix fallback shells the drawer correctly');
  assert.equal(PROJECT.route, '/life/project');
});
