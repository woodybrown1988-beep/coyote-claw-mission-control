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
      definition_of_done TEXT, stage TEXT, status TEXT, visibility TEXT, created_at TEXT, updated_at TEXT, standing INTEGER NOT NULL DEFAULT 0);
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

test('drawer: the pay queue is the primary surface — grouped, totaled, every row actionable', () => {
  // Play-through findings (operator, 2026-08-21): the first cut showed the same 18 invoices
  // twice — a wall of description text, then flat button rows below it — with unpriced rows
  // indistinguishable and "file by hand" a dead end. Pinned here: the block is grouped like the
  // run text, the raw description folds behind a <details>, the total keeps its gate, and a row
  // with no recorded home gets a PICKER of real folders, not a shrug.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-tf-'));
  withEnv(fixture(dir, (db) => {
    db.exec(`CREATE TABLE life_mail_folders (id TEXT PRIMARY KEY, owner_id TEXT, display_name TEXT, path TEXT,
      parent_id TEXT, enabled INTEGER, refused INTEGER, refused_reason TEXT, full_history INTEGER,
      move_target INTEGER, item_count INTEGER, discovered_at TEXT, updated_at TEXT);
      INSERT INTO life_mail_folders VALUES
        ('f1','woody','Drinks','03 SUPPLIERS/Drinks',NULL,1,0,'',0,1,0,'${T}','${T}'),
        ('f2','woody','Other suppliers','03 SUPPLIERS/Other suppliers',NULL,0,0,'',0,1,0,'${T}','${T}'),
        ('f3','woody','Pay','00 INVOICES TO PAY',NULL,1,0,'',0,1,0,'${T}','${T}'),
        ('f4','woody','Bin','Deleted Items/Active Bills - To Pay',NULL,1,0,'',0,1,0,'${T}','${T}');`);
    db.prepare('UPDATE life_tasks SET description = ? WHERE id = ?').run('18 invoices queued.\n\n1) X', 't1');
    db.prepare(`INSERT INTO life_task_events (id, owner_id, task_id, event_type, actor_type, payload_json, created_at)
                VALUES ('ev1','woody','t1','INVOICE_RUN_ARMED','HUMAN', ?, '2026-08-21T06:40:00.000Z')`).run(
      JSON.stringify({ moves: ['mv-a', 'mv-b', 'mv-c'], queued: 3, lines: [
        { moveId: 'mv-a', supplier: 'George Cockburn & Son Ltd', subject: 's1', ref: '15072', totalPence: 18590, onwardPath: '03 SUPPLIERS/Other suppliers', ageDays: 7 },
        { moveId: 'mv-b', supplier: 'George Cockburn & Son Ltd', subject: 's2', ref: '15453', totalPence: 27040, onwardPath: '03 SUPPLIERS/Other suppliers', ageDays: 15 },
        { moveId: 'mv-c', supplier: 'Cartmel Sticky Toffee Pudding Co. Ltd', subject: 'Statement from Cartmel for COYOTE', ref: null, totalPence: null, onwardPath: null, ageDays: 9 },
      ] }));
  }), () => {
    const out = render();
    // Grouped like the run text: one supplier header carrying the subtotal, rows beneath it.
    assert.match(out.body, /1\) George Cockburn &amp; Son Ltd/, 'grouped, biggest first');
    assert.match(out.body, /£456\.30/, 'the group subtotal (185.90 + 270.40)');
    assert.equal((out.body.match(/George Cockburn &amp; Son Ltd/g) || []).length, 1, 'the name prints ONCE, not once per invoice');
    // An unpriced row is identifiable: its subject and age travel with it.
    assert.match(out.body, /Statement from Cartmel for COYOTE/, 'the subject is the identifier when there is no ref');
    assert.match(out.body, /15d/, 'ages render');
    // The total keeps its gate: something unread → no payment label.
    assert.ok(!/TOTAL INVOICES TO PAY/.test(out.body), 'the payment label is withheld while anything is unread');
    assert.match(out.body, /TOTAL OF THE 2 READ = £456\.30/, 'what IS known is stated');
    // The recorded-home rows: one-tap button, moveId only.
    const btn = /data-lc-cmd="([^"]*mail_paid[^"]*)"/.exec(out.body);
    assert.ok(btn, 'the one-tap Paid button');
    const cmd = JSON.parse(btn[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
    assert.deepEqual(cmd.payload, { moveId: 'mv-a' }, 'ONLY the moveId travels on the one-tap path');
    // The folderless row: a PICKER of real folders, not "file by hand".
    assert.ok(!out.body.includes('file by hand'), 'the dead end is gone');
    assert.match(out.body, /data-lc-paidto="mv-c"/, 'the picker button names its move');
    assert.match(out.body, /data-lc-payfolder/, 'with a sibling select the client handler reads');
    assert.match(out.body, /<select data-lc-payfolder class="r-routesel"/, 'the select wears the class with color-scheme:dark — as r-btn its popup rendered white-on-white (operator, 2026-08-21, a repeat of 2026-08-10)');
    assert.match(out.body, /<option value="03 SUPPLIERS\/Drinks">/, 'real folders are the options');
    assert.match(out.body, /<option value="03 SUPPLIERS\/Other suppliers">/, 'an UNSYNCED folder is still a destination — enabled means mirrored, not valid');
    assert.ok(!out.body.includes('<option value="00 INVOICES TO PAY">'), 'the queue itself is never a destination');
    assert.ok(!out.body.includes('Deleted Items'), 'nor the bin');
    // The written run folds away instead of duplicating the list.
    assert.match(out.body, /<details[^>]*><summary[^>]*>The run as written/, 'the raw text is one tap away, not a second copy');
    assert.match(out.body, /white-space:pre-wrap">18 invoices queued\./, 'and keeps its structure inside');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('drawer: a bank payment matching an invoice renders as a SUGGESTION, in his own shape', () => {
  // Operator ask 2026-08-21: "£150 paid on 21/08/2026 under invoice 1234 - match". The hint is
  // green like a citation, names its source (QuickBooks, the account), and says "confirm with
  // Paid" in the same breath — the tap stays the owner's act. A group paid as one transfer gets
  // the same line under the group header.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-tf-'));
  withEnv(fixture(dir, (db) => {
    db.prepare(`INSERT INTO life_task_events (id, owner_id, task_id, event_type, actor_type, payload_json, created_at)
                VALUES ('ev1','woody','t1','INVOICE_RUN_ARMED','HUMAN', ?, '2026-08-21T06:40:00.000Z')`).run(
      JSON.stringify({ moves: ['mv-a', 'mv-b', 'mv-c'], queued: 3, groupPaid: [
        { supplier: 'George Cockburn & Son Ltd', amountPence: 45630, txnDate: '2026-08-20', account: 'HSBC Current' },
      ], lines: [
        { moveId: 'mv-a', supplier: 'George Cockburn & Son Ltd', subject: 's1', ref: '15072', totalPence: 18590, onwardPath: '03 SUPPLIERS/Other suppliers', ageDays: 7 },
        { moveId: 'mv-b', supplier: 'George Cockburn & Son Ltd', subject: 's2', ref: '15453', totalPence: 27040, onwardPath: '03 SUPPLIERS/Other suppliers', ageDays: 7 },
        { moveId: 'mv-c', supplier: 'MCEdge Ltd', subject: 's3', ref: '016808', totalPence: 15000, onwardPath: '03 SUPPLIERS/Other suppliers', ageDays: 6,
          paid: { amountPence: 15000, txnDate: '2026-08-21', account: 'HSBC Current', matchedBy: 'supplier-and-amount' } },
      ] }));
  }), () => {
    const out = render();
    assert.match(out.body, /£150\.00 paid on 21\/08\/2026 \(HSBC Current, QuickBooks\) — matches invoice 016808; confirm with Paid/,
      'his shape: amount, date dd/mm/yyyy, source, the invoice it matches, and the confirmation stays his');
    assert.match(out.body, /£456\.30 paid on 20\/08\/2026 \(HSBC Current, QuickBooks\) — matches this group's total/,
      'a statement paid as one transfer reads at the group level');
    assert.match(out.body, /color:#9BC17E/, 'green like a citation, not a verdict');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});
