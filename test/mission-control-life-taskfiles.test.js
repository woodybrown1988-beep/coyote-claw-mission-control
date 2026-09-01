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
        // A genuinely UNREADABLE INVOICE. It used to be a Cartmel STATEMENT, and that fixture
        // quietly encoded the confusion the panel now fixes: a statement carries no payable
        // amount of its own, so it was never what should hold back "TOTAL INVOICES TO PAY".
        // The gate property asserted below is unchanged — only the document that triggers it is
        // now one that really is unread debt.
        { moveId: 'mv-c', supplier: 'Cartmel Sticky Toffee Pudding Co. Ltd', subject: 'Cartmel Sticky Toffee Pudding Co. Ltd - Invoice', ref: null, totalPence: null, onwardPath: null, ageDays: 9 },
      ] }));
  }), () => {
    const out = render();
    // Grouped like the run text: one supplier header carrying the subtotal, rows beneath it.
    assert.match(out.body, /1\) George Cockburn &amp; Son Ltd/, 'grouped, biggest first');
    assert.match(out.body, /£456\.30/, 'the group subtotal (185.90 + 270.40)');
    assert.equal((out.body.match(/George Cockburn &amp; Son Ltd/g) || []).length, 1, 'the name prints ONCE, not once per invoice');
    // An unpriced row is identifiable: its subject and age travel with it.
    assert.match(out.body, /Cartmel Sticky Toffee Pudding Co. Ltd - Invoice/, 'the subject is the identifier when there is no ref');
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

test('drawer: the situation brief renders as the machine’s read — labelled, dated, and injection-safe', () => {
  // Operator ask 2026-08-21. It must be unmistakably NOT his own words and NOT an agent report:
  // its own labelled, model-stamped panel. The markdown is a tiny fixed subset rendered by hand —
  // a general renderer here would be a script-injection surface for text a model produced.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-brief-'));
  withEnv(fixture(dir, (db) => {
    db.exec(`CREATE TABLE life_task_briefs (task_id TEXT PRIMARY KEY, brief_md TEXT, input_digest TEXT, model TEXT, generated_at TEXT);`);
    db.prepare('INSERT INTO life_task_briefs VALUES (?,?,?,?,?)').run('t1',
      '**Where it stands.** Out of contract; no competing quote yet.\n\n'
      + '**What has happened.**\n- 19 Aug British Gas offered three fixes.\n- 21 Aug <script>alert(1)</script> said it stands.\n\n'
      + '**Suggested next.**\n1. Get two binding quotes.\n2. Decide by Friday.',
      'dig1', 'gpt-5.6-sol', '2026-08-21T06:40:00.000Z');
  }), () => {
    const out = render();
    assert.match(out.body, /WHERE THIS STANDS/, 'the panel is labelled');
    assert.match(out.body, /read of your notes · gpt-5\.6-sol · \d+d ago/, 'model-stamped and aged — never mistakable for his words');
    assert.match(out.body, /title="2026-08-21T06:40:00\.000Z"/, 'the exact instant is one hover away');
    assert.match(out.body, /<b style="color:#e9eef4">Where it stands\.<\/b>/, 'bold labels render');
    assert.match(out.body, /<ul[^>]*><li[^>]*>19 Aug British Gas offered three fixes\.<\/li>/, 'bullets become a real list');
    assert.match(out.body, /<ol[^>]*><li[^>]*>Get two binding quotes\.<\/li>/, 'numbered steps become an ordered list');
    // The safety that matters: model-produced text is ESCAPED, never executed.
    assert.ok(!out.body.includes('<script>alert(1)</script>'), 'no raw script survives the renderer');
    assert.match(out.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, 'it renders as visible text instead');
    // It sits ABOVE the thread — the point is catching up before reading.
    assert.ok(out.body.indexOf('WHERE THIS STANDS') < out.body.indexOf('Add update'), 'brief first, thread after');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('drawer: a note newer than the brief says so — the panel never pretends to have read it', () => {
  // Operator ask 2026-08-26: "i updated the task and the summary isn't updated". It HAD updated,
  // on the next sweep — but the panel showed generated_at sliced to ten characters, so the brief
  // written before his note and the one written after it both read "2026-08-26". The one number
  // that would have answered him was the one the slice cut off.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-brief-'));
  withEnv(fixture(dir, (db) => {
    db.exec(`CREATE TABLE life_task_briefs (task_id TEXT PRIMARY KEY, brief_md TEXT, input_digest TEXT, model TEXT, generated_at TEXT);`);
    db.prepare('INSERT INTO life_task_briefs VALUES (?,?,?,?,?)').run('t1',
      '**Where it stands.** Waiting on the supplier.', 'dig1', 'gpt-5.6-sol', '2026-08-26T14:18:00.000Z');
    // ...and then he typed something, after that read.
    db.prepare('INSERT INTO life_task_updates (id,owner_id,task_id,actor_type,actor_id,raw_text,input_type,record_only,visibility,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run('u1', 'woody', 't1', 'HUMAN', 'woody', 'We accepted the one year deal', 'TEXT', 0, 'OWNER_ONLY', '2026-08-26T14:31:00.000Z');
  }), () => {
    const out = render();
    assert.match(out.body, /isn&#39;t in this read yet|isn't in this read yet/, 'the panel admits what it has not read');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('drawer: a RECORD-ONLY note is not "not read yet" — that warning would never clear', () => {
  // briefInputs excludes record-only notes on the engine side, so a brief that skipped one is
  // CURRENT, not behind. Counting it here would pin a warning to the panel permanently.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-brief-'));
  withEnv(fixture(dir, (db) => {
    db.exec(`CREATE TABLE life_task_briefs (task_id TEXT PRIMARY KEY, brief_md TEXT, input_digest TEXT, model TEXT, generated_at TEXT);`);
    db.prepare('INSERT INTO life_task_briefs VALUES (?,?,?,?,?)').run('t1',
      '**Where it stands.** Waiting on the supplier.', 'dig1', 'gpt-5.6-sol', '2026-08-26T14:18:00.000Z');
    db.prepare('INSERT INTO life_task_updates (id,owner_id,task_id,actor_type,actor_id,raw_text,input_type,record_only,visibility,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run('u1', 'woody', 't1', 'HUMAN', 'woody', 'filed for the record', 'TEXT', 1, 'OWNER_ONLY', '2026-08-26T14:31:00.000Z');
  }), () => {
    const out = render();
    assert.ok(!/in this read yet/.test(out.body), 'record-only notes were never brief inputs');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('drawer: no brief, no panel — an absent table is not an error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-brief-'));
  withEnv(fixture(dir), () => {
    const out = render();
    assert.ok(!out.body.includes('WHERE THIS STANDS'), 'nothing invented when there is no brief');
    assert.match(out.body, /Working with the agent/, 'and the rest of the drawer still renders');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('drawer: a command in a brief renders as a copyable block, and stays ESCAPED', () => {
  // Operator, 2026-08-28: "I need to know where to go and what to type — what website to visit,
  // or if in cmd what ssh then code to type." The brief now writes commands; the panel has to
  // render them as something he can click once and copy, without ever letting model output
  // reach the page as markup.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-brief-'));
  withEnv(fixture(dir, (db) => {
    db.exec(`CREATE TABLE life_task_briefs (task_id TEXT PRIMARY KEY, brief_md TEXT, input_digest TEXT, model TEXT, generated_at TEXT);`);
    db.prepare('INSERT INTO life_task_briefs VALUES (?,?,?,?,?)').run('t1',
      '**Suggested next.**\n1. Run the check on the box from Windows Terminal:\n'
      + '`ssh david@100.80.56.91`\n`cd ~/coyote-claw && npm run cred-check`\n'
      + '2. Open Mission Control and read the latest `coyote-reviews-ingest` run.\n'
      + '3. <script>alert(1)</script> must never execute.',
      'dig1', 'gpt-5.6-sol', '2026-08-28T09:00:00.000Z');
  }), () => {
    const out = render();
    // the command lines became their own blocks, click-to-select
    assert.match(out.body, /user-select:all[^>]*>ssh david@100\.80\.56\.91</, 'the ssh line is a copyable block');
    assert.match(out.body, /cd ~\/coyote-claw &amp;&amp; npm run cred-check/, 'and so is the cd line, escaped');
    // the numbering SURVIVED — the bug that prompted this was step 2 being swallowed
    assert.match(out.body, /<ol[^>]*>[\s\S]*Run the check on the box[\s\S]*<\/ol>/, 'step 1 is a list item');
    assert.match(out.body, /Open Mission Control/, 'step 2 was not swallowed by step 1');
    // inline code inside a sentence stays inline, not promoted to a block
    assert.match(out.body, /<code[^>]*>coyote-reviews-ingest<\/code>/, 'inline code renders inline');
    // and the safety that outranks all of it
    assert.ok(!out.body.includes('<script>alert(1)</script>'), 'no raw script survives');
    assert.match(out.body, /&lt;script&gt;/, 'it renders as visible text instead');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('drawer: a command between steps does not restart the numbering at 1', () => {
  // Rendering a command closes the open <ol>, so step 2 opened a NEW list and the page showed
  // "1." twice. Caught in the browser, not the suite: the earlier test asserted step 2 was not
  // SWALLOWED, which was true — it was present, and mislabelled.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-brief-'));
  withEnv(fixture(dir, (db) => {
    db.exec(`CREATE TABLE life_task_briefs (task_id TEXT PRIMARY KEY, brief_md TEXT, input_digest TEXT, model TEXT, generated_at TEXT);`);
    db.prepare('INSERT INTO life_task_briefs VALUES (?,?,?,?,?)').run('t1',
      '**Suggested next.**\n1. Run the check:\n`ssh david@100.80.56.91`\n2. Then open the dashboard.\n3. Record the result.',
      'dig1', 'gpt-5.6-sol', '2026-08-28T09:00:00.000Z');
  }), () => {
    const out = render();
    // the list that resumes after the command must declare where it resumes
    assert.match(out.body, /<ol start="2"/, 'the second list resumes at 2, not 1');
    assert.ok(!/<ol start="1"/.test(out.body), 'and a list that starts at 1 needs no attribute');
    // steps 2 and 3 belong to the SAME resumed list — one command should not split it twice
    const resumed = /<ol start="2"[^>]*>([\s\S]*?)<\/ol>/.exec(out.body);
    assert.ok(resumed, 'found the resumed list');
    assert.equal((resumed[1].match(/<li/g) || []).length, 2, 'steps 2 and 3 stay together');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── THE SUPPLIER LEDGER PANEL (operator ask 2026-09-01) ───────────────────────────────────────
//
// "the supplier invoice payment ledger in the task to ensure we are not about to pay for something
// which has already been paid". The panel reports what was last SEEN going out under each
// supplier's identity. It must never say "unpaid" — nothing here can know that, and a green
// all-clear on a supplier the check is blind to is exactly what licenses the second payment.
// The panel's own disclaimer contains the word "unpaid" on purpose ("never a statement that an
// invoice is unpaid"), so a bare search for it trips on the very sentence that makes the promise.
// Strip the disclaimer, then assert the word appears nowhere else.
const withoutDisclaimer = (html) => String(html).replace(/never a statement that an invoice is unpaid\./g, '');

function armedWith(db, payload) {
  db.prepare(
    `INSERT INTO life_task_events (id, owner_id, task_id, event_type, actor_type, actor_id, payload_json, created_at)
     VALUES ('e-inv', 'woody', 't1', 'INVOICE_RUN_ARMED', 'SERVICE', 'life-writer', ?, '2026-09-01T09:00:00.000Z')`,
  ).run(JSON.stringify(payload));
}

test('drawer: each supplier group states what the bank last saw going out', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-ledger-'));
  withEnv(fixture(dir, (db) => {
    armedWith(db, {
      moves: ['mv1'], folder: '00 INVOICES TO PAY', queued: 1,
      lines: [{ moveId: 'mv1', supplier: 'Black Isle Brewing Co Ltd', ref: '48548', totalPence: 30527, ageDays: 12 }],
      suppliers: [{
        supplier: 'Black Isle Brewing Co Ltd', key: 'black-isle', paidCountYear: 49,
        seenSince: '2018-11-24',
        lastPaid: { amountPence: 120455, txnDate: '2026-04-30', account: 'Santander Bank Account (6288)' },
      }],
    });
  }), () => {
    const out = render();
    assert.match(out.body, /last paid/, 'the line is there');
    assert.match(out.body, /£1,204\.55/, 'with the figure that actually left the bank');
    assert.match(out.body, /2026-04-30/, 'and when');
    assert.match(out.body, /Santander Bank Account/, 'and from which account');
    assert.match(out.body, /49 payments in the last year/, 'so he can tell a live account from a dormant one');
    // THE SENTENCE THAT MUST NEVER APPEAR
    assert.ok(!/\bunpaid\b/i.test(withoutDisclaimer(out.body)), 'no line declares an invoice unpaid');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('drawer: a supplier with NO payment on record says so, and names the horizon', () => {
  // "no payment on record" and "I cannot see this supplier" are different sentences, and only
  // one of them is safe to act on. Stating the horizon is what separates them.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-ledger-'));
  withEnv(fixture(dir, (db) => {
    armedWith(db, {
      moves: ['mv1'], folder: '00 INVOICES TO PAY', queued: 1,
      lines: [{ moveId: 'mv1', supplier: 'Unity1 Electrical', ref: null, totalPence: null, ageDays: 9 }],
      suppliers: [{ supplier: 'Unity1 Electrical', key: 'unity', paidCountYear: 0, seenSince: '2018-11-24', lastPaid: null }],
    });
  }), () => {
    const out = render();
    assert.match(out.body, /no payment to this supplier on record/);
    assert.match(out.body, /bank data goes back to 2018-11-24/, 'the reader is told how far the check can see');
    assert.ok(!/\bunpaid\b/i.test(withoutDisclaimer(out.body)));
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('drawer: the header counts how blind the check is, rather than implying a verdict', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-ledger-'));
  withEnv(fixture(dir, (db) => {
    armedWith(db, {
      moves: ['mv1', 'mv2'], folder: '00 INVOICES TO PAY', queued: 2,
      lines: [
        { moveId: 'mv1', supplier: 'Black Isle Brewing Co Ltd', ref: '48548', totalPence: 30527, ageDays: 12 },
        { moveId: 'mv2', supplier: 'Unity1 Electrical', ref: null, totalPence: null, ageDays: 9 },
      ],
      suppliers: [
        { supplier: 'Black Isle Brewing Co Ltd', key: 'black-isle', paidCountYear: 49, seenSince: '2018-11-24',
          lastPaid: { amountPence: 120455, txnDate: '2026-04-30', account: 'Santander' } },
        { supplier: 'Unity1 Electrical', key: 'unity', paidCountYear: 0, seenSince: '2018-11-24', lastPaid: null },
      ],
    });
  }), () => {
    const out = render();
    assert.match(out.body, /1 of 2 suppliers here have a payment on record/);
    assert.match(out.body, /never a statement that an invoice is unpaid/, 'the panel states its own limits');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('drawer: an armed run with NO supplier positions renders the queue unchanged', () => {
  // The field is additive: a run armed before this shipped, or by an older CLI, must not blank
  // the pay queue or grow an empty panel.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-ledger-'));
  withEnv(fixture(dir, (db) => {
    armedWith(db, {
      moves: ['mv1'], folder: '00 INVOICES TO PAY', queued: 1,
      lines: [{ moveId: 'mv1', supplier: 'Black Isle Brewing Co Ltd', ref: '48548', totalPence: 30527, ageDays: 12 }],
    });
  }), () => {
    const out = render();
    assert.match(out.body, /PAY QUEUE/, 'the queue still renders');
    assert.ok(!/Checked against the bank/.test(out.body), 'and no empty ledger header appears');
    assert.ok(!/on record/.test(out.body));
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// STATEMENTS IN THE PAY QUEUE (operator ask 2026-09-01: "fix the 5 statements so they read too")
//
// Six of the twenty-three queued documents were supplier statements, and every one rendered
// "not read" — the same two words the panel uses for an invoice whose PDF defeated the parser.
// Two different situations: one is work to go and do, the other is nothing to pay.
// ═══════════════════════════════════════════════════════════════════════════════════════════

test('drawer: a statement says what it is, and never withholds the payment total', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-stmt-'));
  withEnv(fixture(dir, (db) => {
    armedWith(db, {
      moves: ['mv1', 'mv2'], folder: '00 INVOICES TO PAY', queued: 2,
      lines: [
        { moveId: 'mv1', supplier: 'MCEdge Ltd', subject: 'Invoice 016808 from MCEdge Ltd', ref: '016808', totalPence: 15000, onwardPath: '03 SUPPLIERS/Other suppliers', ageDays: 12, isStatement: false },
        { moveId: 'mv2', supplier: 'MCEdge Ltd', subject: 'Statement from MCEDGE LTD for coyote burger', ref: null, totalPence: null, onwardPath: '03 SUPPLIERS/Other suppliers', ageDays: 7, isStatement: true },
      ],
    });
  }), () => {
    const out = render();
    assert.match(out.body, /statement — nothing to pay from it/, 'the row says what it is');
    assert.match(out.body, /TOTAL INVOICES TO PAY = £150\.00/, 'and the gate goes green on the invoice alone');
    assert.match(out.body, /1 statement not in this total/, 'what was set aside is NAMED, not silently dropped');
    assert.match(out.body, /would pay the same debt twice/, 'with the reason, so the exclusion is auditable');
    assert.match(out.body, /1 INVOICE · 1 STATEMENT/, 'the strip header counts the two kinds apart');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('drawer: an unread INVOICE still withholds the total, statements or no statements', () => {
  // THE NEGATIVE CONTROL. Excluding statements must not quietly become excluding everything
  // awkward — an invoice nobody could read is exactly the case the label exists to protect.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-stmt-'));
  withEnv(fixture(dir, (db) => {
    armedWith(db, {
      moves: ['mv1', 'mv2', 'mv3'], folder: '00 INVOICES TO PAY', queued: 3,
      lines: [
        { moveId: 'mv1', supplier: 'MCEdge Ltd', subject: 'Invoice 016808', ref: '016808', totalPence: 15000, onwardPath: '03 SUPPLIERS/x', ageDays: 12, isStatement: false },
        { moveId: 'mv2', supplier: 'MCEdge Ltd', subject: 'Statement from MCEDGE LTD', ref: null, totalPence: null, onwardPath: '03 SUPPLIERS/x', ageDays: 7, isStatement: true },
        { moveId: 'mv3', supplier: 'Unity1 Electrical', subject: 'Bill INV-0094 is due', ref: null, totalPence: null, onwardPath: '03 SUPPLIERS/x', ageDays: 9, isStatement: false },
      ],
    });
  }), () => {
    const out = render();
    assert.ok(!/TOTAL INVOICES TO PAY/.test(out.body), 'one unread invoice is still enough');
    assert.match(out.body, /TOTAL OF THE 1 READ = £150\.00/);
    assert.match(out.body, /1 invoice still unread/, 'and it counts the INVOICE, not the statement');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('drawer: the supplier’s own stated balance is compared with what we hold', () => {
  // THE LIVE CASE, and the sharpest double-payment signal this panel has: Cockburn's seven queued
  // invoices come to £1,332.73 while their own statement says £1,062.33. The difference is exactly
  // invoice 15453 (£270.40) — a supplier saying you owe LESS than you are about to pay.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-stmt-'));
  withEnv(fixture(dir, (db) => {
    armedWith(db, {
      moves: ['a', 'b'], folder: '00 INVOICES TO PAY', queued: 2,
      lines: [
        { moveId: 'a', supplier: 'George Cockburn & Son Ltd', subject: 'Invoice 15453', ref: '15453', totalPence: 27040, onwardPath: '03 SUPPLIERS/x', ageDays: 12, isStatement: false },
        { moveId: 'b', supplier: 'George Cockburn & Son Ltd', subject: 'Invoice 15251', ref: '15251', totalPence: 18877, onwardPath: '03 SUPPLIERS/x', ageDays: 20, isStatement: false },
      ],
      suppliers: [{
        supplier: 'George Cockburn & Son Ltd', key: 'cockburn', paidCountYear: 12, seenSince: '2018-11-24',
        lastPaid: { amountPence: 90000, txnDate: '2026-08-12', account: 'Santander' },
        statedTotalPence: 18877, statedAt: '2026-08-06',
      }],
    });
  }), () => {
    const out = render();
    assert.match(out.body, /Their statement dated 2026-08-06/, 'the statement’s OWN date is printed');
    assert.match(out.body, /£188\.77/, 'their figure');
    assert.match(out.body, /£459\.17/, 'and ours');
    assert.match(out.body, /you hold <b>£270\.40<\/b> MORE than they say is owed/, 'the difference, named');
    assert.match(out.body, /unless their statement predates one of these/,
      'as a QUESTION — a statement older than an invoice explains the gap innocently');
    // The panel still may not accuse.
    assert.ok(!/\bunpaid\b/i.test(withoutDisclaimer(out.body)));
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('drawer: an incomplete queue is NOT reconciled — a difference would mean nothing', () => {
  // The gate on the comparison itself. If one of our own amounts is unread, "they say less than
  // we hold" is arithmetic about a number we do not have, and printing it would invent a
  // discrepancy out of our own ignorance.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-stmt-'));
  withEnv(fixture(dir, (db) => {
    armedWith(db, {
      moves: ['a', 'b'], folder: '00 INVOICES TO PAY', queued: 2,
      lines: [
        { moveId: 'a', supplier: 'Black Isle Brewing Co Ltd', subject: 'Invoice 48548', ref: '48548', totalPence: 30527, onwardPath: '03 SUPPLIERS/x', ageDays: 12, isStatement: false },
        { moveId: 'b', supplier: 'Black Isle Brewing Co Ltd', subject: 'Invoice from Black Isle', ref: null, totalPence: null, onwardPath: '03 SUPPLIERS/x', ageDays: 8, isStatement: false },
      ],
      suppliers: [{
        supplier: 'Black Isle Brewing Co Ltd', key: 'black-isle', paidCountYear: 49, seenSince: '2018-11-24',
        lastPaid: null, statedTotalPence: 316255, statedAt: null,
      }],
    });
  }), () => {
    const out = render();
    assert.match(out.body, /£3,162\.55/, 'their stated balance is still the most useful number on the row');
    assert.match(out.body, /not comparable yet, 1 amount here still unread/);
    assert.ok(!/MORE than they say is owed/.test(out.body), 'no difference is claimed over a number we do not have');
    assert.match(out.body, /\(undated\)/, 'an undated statement says so rather than implying it is current');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});
