'use strict';
// OWNER→AGENT CONTEXT, MC half (operator ask 2026-08-13) — the drawer's agent rail against
// EMITTED output, and the upload validators' red cases. The endpoint mechanics mirror the
// tested reservations upload (same UP helpers, same inbox posture); the engine-side gates
// (sanitise, allowlist, cap, HUMAN-only) are pinned in coyote-claw test/life-task-files.test.ts.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite = require('node:sqlite');
const UP = require('../mission-control/ui/upload.js');
const TASK = require('../mission-control/ui/pages/life/task.js');
const LIFECMD = require('../mission-control/ui/life-command-lib.js');

const T = '2026-08-13T12:00:00.000Z';

function withEnv(dbPath, fn) {
  const prev = process.env.COYOTE_LIFE_DB;
  process.env.COYOTE_LIFE_DB = dbPath;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.COYOTE_LIFE_DB; else process.env.COYOTE_LIFE_DB = prev;
  }
}

function fixture(dir, seed) {
  const p = path.join(dir, 'life.db');
  const db = new sqlite.DatabaseSync(p);
  db.exec(`
    CREATE TABLE life_tasks (id TEXT PRIMARY KEY, owner_id TEXT, outcome_id TEXT, project_id TEXT, domain_key TEXT,
      title TEXT, description TEXT DEFAULT '', status TEXT, execution_mode TEXT, definition_of_done TEXT DEFAULT '',
      due_kind TEXT DEFAULT 'NONE', due_at TEXT, importance INTEGER DEFAULT 3, risk_level TEXT DEFAULT 'LOW', recurs TEXT,
      visibility TEXT, source_type TEXT, created_by TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE life_task_events (id TEXT PRIMARY KEY, owner_id TEXT, task_id TEXT, event_type TEXT, actor_type TEXT,
      actor_id TEXT, from_state TEXT, to_state TEXT, payload_json TEXT DEFAULT '{}', idempotency_key TEXT, created_at TEXT);
    CREATE TABLE life_task_updates (id TEXT PRIMARY KEY, owner_id TEXT, task_id TEXT, actor_type TEXT, actor_id TEXT,
      raw_text TEXT, input_type TEXT, record_only INTEGER DEFAULT 0, visibility TEXT, source_ref TEXT,
      attachment_refs_json TEXT DEFAULT '[]', extractor_version TEXT, created_at TEXT);
    CREATE TABLE life_update_facts (id TEXT PRIMARY KEY, owner_id TEXT, update_id TEXT, task_id TEXT, fact_type TEXT,
      value_json TEXT, unit TEXT, source_start INTEGER, source_end INTEGER, confidence REAL,
      validation_state TEXT, extractor_version TEXT, created_at TEXT);
    CREATE TABLE life_update_proposals (id TEXT PRIMARY KEY, owner_id TEXT, update_id TEXT, task_id TEXT,
      source_mail_id TEXT, capability_key TEXT, command_type TEXT, command_json TEXT, reason TEXT,
      confidence REAL, risk_level TEXT, authority_class TEXT, state TEXT, decided_by TEXT, decision_note TEXT, created_at TEXT);
    CREATE TABLE life_waiting_conditions (id TEXT PRIMARY KEY, task_id TEXT, owner_id TEXT,
      dependency_label TEXT, wake_type TEXT, fallback_at TEXT, state TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE life_projects (id TEXT PRIMARY KEY, owner_id TEXT, domain_key TEXT, title TEXT,
      definition_of_done TEXT, stage TEXT, status TEXT, visibility TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE life_task_files (id TEXT PRIMARY KEY, owner_id TEXT, task_id TEXT, filename TEXT,
      original_name TEXT DEFAULT '', kind TEXT, bytes INTEGER, sha256 TEXT, note TEXT DEFAULT '',
      state TEXT DEFAULT 'ATTACHED', created_at TEXT, updated_at TEXT);
    INSERT INTO life_tasks (id,owner_id,domain_key,title,status,execution_mode,visibility,source_type,created_by,created_at,updated_at)
      VALUES ('t1','woody','business','Reconcile counts','READY','AI','OWNER_ONLY','MANUAL','h','${T}','${T}');
  `);
  if (seed) seed(db);
  db.close();
  return p;
}

const render = () => TASK.render(TASK.getSection(null, { query: { id: 't1' } }), {});

test('upload validators: the allowlist is the gate, case-insensitive, and .exe never passes', () => {
  assert.equal(UP.isAllowedTaskFileName('numbers.csv'), true);
  assert.equal(UP.isAllowedTaskFileName('NOTES.MD'), true);
  assert.equal(UP.isAllowedTaskFileName('sheet.XLSX'), true);
  assert.equal(UP.isAllowedTaskFileName('photo.jpeg'), true);
  assert.equal(UP.isAllowedTaskFileName('tool.exe'), false, 'executables never');
  assert.equal(UP.isAllowedTaskFileName('script.sh'), false);
  assert.equal(UP.isAllowedTaskFileName('noext'), false);
  assert.equal(UP.isAllowedTaskFileName(''), false);
  // the sanitiser + allowlist compose: a traversal name survives only as a plain basename
  assert.equal(UP.sanitizeUploadName('../../etc/passwd.csv'), 'passwd.csv');
});

test('command shapes: remove/renew validate; attach_task_file is NOT browser-reachable', () => {
  const v = (command, payload) => LIFECMD.validateCommand({ command, idempotencyKey: 'k'.repeat(12), payload });
  assert.equal(v('remove_task_file', { taskId: 't1', fileId: 'f1' }).ok, true);
  assert.equal(v('remove_task_file', { taskId: 't1' }).ok, false, 'no fileId, no remove');
  assert.equal(v('renew_dispatch', { taskId: 't1' }).ok, true);
  assert.equal(v('attach_task_file', { taskId: 't1', inboxName: 'x.csv' }).ok, false,
    'the browser never names inbox paths — attach goes through the upload endpoint only');
});

test('drawer: routed-but-never-sent shows the sweep promise and NO send-back; upload control present', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-tf-'));
  withEnv(fixture(dir), () => {
    const out = render();
    assert.match(out.body, /Working with the agent/);
    assert.match(out.body, /sweep \(09:20 \/ 15:20 London\) picks it up/);
    assert.ok(!out.body.includes('Send back to the agent'), 'nothing to send back before a first dispatch');
    assert.match(out.body, /data-lc-taskfile="t1"/, 'the upload picker is on the drawer');
    assert.match(out.body, /15 MB max/);
    assert.match(out.body, /record-only/i, 'the talk copy says what travels');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('drawer: a dispatched task offers Send back; files list with download + remove; sent-back state says so', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-tf2-'));
  const dbPath = fixture(dir, (db) => {
    db.exec(`INSERT INTO life_task_events (id,owner_id,task_id,event_type,actor_type,actor_id,payload_json,created_at)
      VALUES ('e1','woody','t1','AGENT_DISPATCHED','SERVICE','life-dispatcher','{"jobId":"abcd1234-x","jobKind":"boxquery"}','${T}');
      INSERT INTO life_task_files (id,owner_id,task_id,filename,kind,bytes,sha256,note,state,created_at,updated_at)
      VALUES ('f1','woody','t1','partial.csv','TEXT',2048,'sha','counts I already did','ATTACHED','${T}','${T}');`);
  });
  withEnv(dbPath, () => {
    const out = render();
    assert.match(out.body, /An agent has been sent \(job abcd1234, boxquery\)/);
    assert.match(out.body, /Send back to the agent/);
    assert.match(out.body, /"command":"renew_dispatch"/.source ? /renew_dispatch/ : /renew_dispatch/, 'the button posts the audited verb');
    assert.match(out.body, /partial\.csv/);
    assert.match(out.body, /counts I already did/);
    assert.match(out.body, /\/api\/life\/task-file\?id=f1/, 'download rides the by-row endpoint');
    assert.match(out.body, /remove_task_file/);
  });
  // Sent back → the state line changes and the button withdraws (idempotence made visible).
  const db2 = new sqlite.DatabaseSync(dbPath);
  db2.exec(`INSERT INTO life_task_events (id,owner_id,task_id,event_type,actor_type,actor_id,payload_json,created_at)
    VALUES ('e2','woody','t1','REOPENED','HUMAN','woody','{"via":"send_back"}','2026-08-13T13:00:00.000Z')`);
  db2.close();
  withEnv(dbPath, () => {
    const out2 = render();
    assert.match(out2.body, /Sent back — it goes out again on the next sweep/);
    assert.ok(!out2.body.includes('Send back to the agent'), 'no double-queue button while already queued');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('drawer: a structured description KEEPS its structure — pre-wrap, newlines intact (operator, 2026-08-21)', () => {
  // The pay-run task is WRITTEN grouped by supplier — one block each, a total line — and the
  // drawer collapsed every newline into a space: eighteen invoices as one solid paragraph. The
  // updates thread below has carried pre-wrap since it was built; the description was the one
  // render site without it.
  const DESC = '18 invoices queued.\n\n1) GEORGE COCKBURN & SON LTD\n   Invoices 15072 & 15453 = £401.71\n\nTOTAL OF THE 8 READ = £1,482.73';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-tf-'));
  withEnv(fixture(dir, (db) => {
    db.prepare('UPDATE life_tasks SET description = ? WHERE id = ?').run(DESC, 't1');
  }), () => {
    const out = render();
    const div = /<div style="[^"]*margin-bottom:10px[^"]*">18 invoices queued\.[\s\S]*?<\/div>/.exec(out.body);
    assert.ok(div, 'the description renders');
    assert.match(div[0], /white-space:pre-wrap/, 'without pre-wrap the browser eats every newline');
    assert.ok(div[0].includes('\n\n1) GEORGE COCKBURN &amp; SON LTD'), 'the blank line before a supplier block survives, escaped');
    assert.ok(div[0].includes('\n   Invoices 15072 &amp; 15453 = £401.71'), 'and so does the indent that makes it a block');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});
