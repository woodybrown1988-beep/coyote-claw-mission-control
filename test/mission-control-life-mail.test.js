'use strict';
// LIFE OS — MAIL surfaces (Graph Stage C, operator GO 2026-08-11).
//
// Proven here: a mail proposal renders with WHO it came from and the machine-derived
// evidence for the match; it is quiet-FOLDED but never hidden (a NEW_TASK proposal has no
// task, so a fold that only showed a count would have left it with no home anywhere); the
// mail rail is honest about a broken poll; Mission Control can meet a life.db that predates
// the mail migration WITHOUT blanking the decision queue; and no mailbox-write verb exists
// on this side of the wall either.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite = require('node:sqlite');
const LIFECMD = require('../mission-control/ui/life-command-lib.js');
const TODAY = require('../mission-control/ui/pages/life/today.js');

const T = '2026-08-11T12:00:00.000Z';
const NOW = Date.parse(T);
const ago = (ms) => new Date(NOW - ms).toISOString();

function withEnv(dbPath, fn) {
  const prev = process.env.COYOTE_LIFE_DB;
  process.env.COYOTE_LIFE_DB = dbPath;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.COYOTE_LIFE_DB; else process.env.COYOTE_LIFE_DB = prev;
  }
}

/** A minimal life.db in the POST-Stage-C shape. `withMail:false` reproduces the pre-migration
 *  DB Mission Control can legitimately meet between two independent deploy taps. */
function fixture(dir, opts) {
  const withMail = !opts || opts.withMail !== false;
  const p = path.join(dir, 'life.db');
  const db = new sqlite.DatabaseSync(p);
  db.exec(`
    CREATE TABLE life_tasks (id TEXT PRIMARY KEY, owner_id TEXT, outcome_id TEXT, project_id TEXT, domain_key TEXT,
      title TEXT, status TEXT, execution_mode TEXT, definition_of_done TEXT DEFAULT '', due_kind TEXT DEFAULT 'NONE',
      due_at TEXT, estimate_minutes INTEGER, importance INTEGER DEFAULT 3, consequence INTEGER DEFAULT 3,
      risk_level TEXT, visibility TEXT, source_type TEXT, created_by TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE life_waiting_conditions (id TEXT PRIMARY KEY, task_id TEXT, owner_id TEXT,
      dependency_label TEXT, wake_type TEXT, fallback_at TEXT, state TEXT, created_at TEXT, updated_at TEXT);
    CREATE VIEW v_life_available_work AS SELECT t.*, 0 AS calculated_priority FROM life_tasks t
      WHERE t.status IN ('READY','SCHEDULED','IN_PROGRESS');
    CREATE TABLE life_daily_plans (id TEXT PRIMARY KEY, owner_id TEXT, plan_date TEXT, must_win_task_id TEXT,
      support_task_1_id TEXT, support_task_2_id TEXT, decision_task_ids_json TEXT DEFAULT '[]',
      alternative_task_ids_json TEXT DEFAULT '[]', compilation_evidence_json TEXT DEFAULT '{}',
      status TEXT, approved_by TEXT, approved_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE life_task_events (id TEXT PRIMARY KEY, owner_id TEXT, task_id TEXT, event_type TEXT, actor_type TEXT,
      actor_id TEXT, from_state TEXT, to_state TEXT, payload_json TEXT DEFAULT '{}', idempotency_key TEXT, created_at TEXT);
    CREATE TABLE life_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE life_outcomes (id TEXT PRIMARY KEY, owner_id TEXT, domain_key TEXT, title TEXT,
      proof_definition TEXT, status TEXT, target_date TEXT, priority INTEGER, visibility TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE life_update_proposals (id TEXT PRIMARY KEY, owner_id TEXT, update_id TEXT, task_id TEXT,
      ${withMail ? 'source_mail_id TEXT,' : ''}
      capability_key TEXT, command_type TEXT, command_json TEXT, reason TEXT, evidence_refs_json TEXT DEFAULT '[]',
      confidence REAL, risk_level TEXT, authority_class TEXT, state TEXT, decided_by TEXT, decision_note TEXT,
      decided_at TEXT, applied_event_id TEXT, created_at TEXT);
    INSERT INTO life_tasks (id, owner_id, domain_key, title, status, risk_level, visibility, source_type, created_by, created_at, updated_at)
      VALUES ('t1','woody','admin','Card reader on till 2 is dead','WAITING','LOW','OWNER_ONLY','MANUAL','h','${T}','${T}');
    INSERT INTO life_waiting_conditions VALUES ('w1','t1','woody','Lightspeed engineer','EMAIL_REPLY','2026-08-20','ACTIVE','${T}','${T}');
    -- an ordinary (non-mail) proposal, so "the queue still renders" is testable
    INSERT INTO life_update_proposals (id,owner_id,update_id,task_id,capability_key,command_type,command_json,reason,confidence,risk_level,authority_class,state,created_at)
      VALUES ('pr-plain','woody','u1','t1','waiting_inference','set_waiting','{"dependencyLabel":"the engineer"}','the note names a dependency',0.8,'LOW','REVERSIBLE_INTERNAL','PROPOSED','${T}');
  `);
  if (withMail) {
    db.exec(`
      CREATE TABLE life_mail_messages (id TEXT PRIMARY KEY, owner_id TEXT, internet_message_id TEXT, conversation_id TEXT,
        from_address TEXT, from_name TEXT, to_json TEXT, subject TEXT, body_preview TEXT, received_at TEXT,
        is_read INTEGER, has_attachments INTEGER, web_link TEXT, classification TEXT, classification_reason TEXT,
        classifier_model TEXT, classified_at TEXT, proposal_id TEXT, first_seen_at TEXT, updated_at TEXT);
      CREATE TABLE life_mail_sync (id INTEGER PRIMARY KEY, delta_link TEXT, window_anchor TEXT, last_sync_at TEXT,
        last_error TEXT, last_triage_at TEXT, last_triage_error TEXT, updated_at TEXT);
      INSERT INTO life_mail_messages (id, owner_id, from_address, from_name, subject, body_preview, received_at, web_link, classification, classified_at)
        VALUES ('mail-1','woody','support@lightspeedhq.com','Lightspeed Support','RE: engineer scheduled','Thursday 9-11.','${ago(3600000)}','https://outlook.live.com/owa/?ItemID=abc','WAKE','${ago(600000)}'),
               ('mail-2','woody','reminders@gassafe.test','GasSafe','Gas certificate expires 3 Sept','Book an engineer.','${ago(7200000)}','https://outlook.live.com/owa/?ItemID=def','NEW_TASK','${ago(600000)}');
      INSERT INTO life_mail_sync (id, last_sync_at, last_triage_at, updated_at) VALUES (1,'${ago(600000)}','${ago(600000)}','${ago(600000)}');
      INSERT INTO life_update_proposals (id,owner_id,update_id,task_id,source_mail_id,capability_key,command_type,command_json,reason,evidence_refs_json,confidence,risk_level,authority_class,state,created_at)
        VALUES
        ('pr-wake','woody',NULL,'t1','mail-1','mail_wake','wake','{"mailId":"mail-1","taskId":"t1","triggeredByRef":"mail:mail-1"}',
          'the engineer has been and gone — from @lightspeedhq.com, matches waiting dependency ''Lightspeed engineer''',
          '[{"kind":"mail","mailId":"mail-1"}]',0.7,'LOW','INTERNAL_WRITE','PROPOSED','${ago(500000)}'),
        ('pr-new','woody',NULL,NULL,'mail-2','mail_capture','create_task','{"mailId":"mail-2","title":"Book the annual gas safety re-certification"}',
          'a certificate has to be re-booked before it lapses (from GasSafe, 2026-08-11)',
          '[{"kind":"mail","mailId":"mail-2"}]',0.55,'LOW','INTERNAL_WRITE','PROPOSED','${ago(400000)}');
    `);
  }
  db.close();
  return p;
}

const renderToday = () => TODAY.render(TODAY.getSection(null, { now: NOW }), { now: NOW });
const cmdsIn = (body) => [...body.matchAll(/data-lc-cmd="([^"]*)"/g)]
  .map((m) => JSON.parse(m[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&#39;', "'")));

test('a mail proposal renders WHO it is from and the evidence for the match', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-mail-'));
  withEnv(fixture(dir), () => {
    const out = renderToday();
    assert.match(out.body, /From Lightspeed Support/, 'the sender is named on the row');
    assert.match(out.body, /matches waiting dependency &#39;Lightspeed engineer&#39;/,
      'the machine-derived evidence is on the row, in words the owner can check');
    assert.match(out.body, /This looks like the reply this task was waiting for\. Accept wakes it; No leaves it waiting\./);
    assert.match(out.body, /Accept captures “Book the annual gas safety re-certification” into your Inbox\. Nothing is sent, and the email is not touched\./);
    assert.match(out.body, /outlook\.live\.com/, 'a link straight to the message in Outlook');
    const c = cmdsIn(out.body);
    assert.ok(c.some((x) => x.command === 'decide' && x.payload.proposalId === 'pr-wake' && x.payload.decision === 'accept'),
      'accept rides the ordinary decide verb — a mail proposal writes only inside life.db');
    assert.ok(c.some((x) => x.command === 'decide' && x.payload.proposalId === 'pr-wake' && x.payload.decision === 'reject'));
    assert.match(out.body, /data-lc-mailedit="[^"]*pr-new/, 'the wording of a NEW_TASK proposal can be edited before accepting');
    assert.ok(!/data-lc-mailedit="[^"]*pr-wake/.test(out.body), 'a wake has no wording to edit, so it offers no Edit');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('mail proposals are QUIET-FOLDED — but the fold contains the rows, not just a count', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-mail-fold-'));
  const dbPath = fixture(dir);
  const db = new sqlite.DatabaseSync(dbPath);
  db.exec(`INSERT INTO life_settings (key,value,updated_at) VALUES ('quiet_support','on','${T}')`);
  db.close();
  withEnv(dbPath, () => {
    const out = renderToday();
    assert.match(out.body, /<details/, 'the fold is a real disclosure');
    const fold = out.body.slice(out.body.indexOf('<details'), out.body.indexOf('</details>'));
    assert.match(fold, /lower-stakes suggestion/);
    assert.match(fold, /Book the annual gas safety re-certification/,
      'the NEW_TASK proposal is INSIDE the fold — it has no task, so a count-only fold would have hidden it for good');
    assert.match(fold, /pr-wake/, 'and so is the wake');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a NEW_TASK proposal takes its heading from what it would create (there is no task to name)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-mail-title-'));
  withEnv(fixture(dir), () => {
    assert.match(renderToday().body, /Book the annual gas safety re-certification/);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the mail rail is honest: fresh reads say so, a broken poll says nothing was read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-mail-stale-'));
  const dbPath = fixture(dir);
  withEnv(dbPath, () => {
    assert.match(renderToday().body, /Inbox read 10 min ago .*read-only, and only ever suggestions/);
  });
  const db = new sqlite.DatabaseSync(dbPath);
  db.exec(`UPDATE life_mail_sync SET last_sync_at = '${ago(9 * 3600000)}', last_error = 'Graph mail delta → 401 Unauthorized'`);
  db.close();
  withEnv(dbPath, () => {
    const body = renderToday().body;
    assert.match(body, /Inbox last read 9h 0m ago and the last pass failed \(Graph mail delta → 401 Unauthorized\)/);
    assert.match(body, /nothing has been read, so nothing has been suggested from it/);
    assert.match(body, /Outlook is untouched either way/);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('DEPLOY ORDERING: a life.db predating the mail migration still renders the whole decision queue', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-mail-premig-'));
  withEnv(fixture(dir, { withMail: false }), () => {
    const out = renderToday();
    // The point: MC and the engine deploy on separate taps. The mail rail may be absent for
    // a few minutes; the owner's existing decisions must NOT be.
    assert.match(out.body, /the note names a dependency/, 'the ordinary proposal still renders');
    assert.ok(!/Inbox read|Inbox last read/.test(out.body), 'and the mail rail is simply absent, not broken');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the relay allows mail_sync, and deliberately does NOT relay mail_triage', () => {
  const key = 'k'.repeat(16);
  assert.equal(LIFECMD.validateCommand({ command: 'mail_sync', idempotencyKey: key, payload: {} }).ok, true);
  const triage = LIFECMD.validateCommand({ command: 'mail_triage', idempotencyKey: key, payload: {} });
  assert.equal(triage.ok, false);
  assert.match(triage.error, /unknown or unrelayed command 'mail_triage'/);
});

test('the relay refuses a mailbox-write verb by name — no such command can leave Mission Control', () => {
  const key = 'k'.repeat(16);
  for (const command of ['mail_send', 'send_mail', 'reply_mail', 'mail_delete', 'mail_move', 'mark_read']) {
    const r = LIFECMD.validateCommand({ command, idempotencyKey: key, payload: {} });
    assert.equal(r.ok, false, `${command} must not be relayable`);
    assert.match(r.error, /unknown or unrelayed command/);
  }
});

test("an EDIT must carry an edit — a decide('edit') with no editedCommand is refused, not silently accepted", () => {
  const key = 'k'.repeat(16);
  const bare = LIFECMD.validateCommand({ command: 'decide', idempotencyKey: key, payload: { proposalId: 'p1', decision: 'edit' } });
  assert.equal(bare.ok, false);
  assert.match(bare.error, /payload shape refused/);
  const real = LIFECMD.validateCommand({
    command: 'decide', idempotencyKey: key,
    payload: { proposalId: 'p1', decision: 'edit', editedCommand: { title: 'my wording' } },
  });
  assert.equal(real.ok, true);
  assert.deepEqual(real.cmd.payload.editedCommand, { title: 'my wording' });
  // accept/reject are unchanged.
  assert.equal(LIFECMD.validateCommand({ command: 'decide', idempotencyKey: key, payload: { proposalId: 'p1', decision: 'accept' } }).ok, true);
});

test('STRUCTURAL: no Mission Control file names a mailbox-write endpoint or scope', () => {
  const roots = [path.join(__dirname, '..', 'mission-control', 'ui'), path.join(__dirname, '..', 'mission-control')];
  const seen = new Set();
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const f = path.join(d, name);
      if (fs.statSync(f).isDirectory()) { if (name !== 'node_modules') walk(f); continue; }
      if (!f.endsWith('.js') || seen.has(f)) continue;
      seen.add(f);
      const code = fs.readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      assert.ok(!/Mail\.Send|Mail\.ReadWrite|sendMail|graph\.microsoft\.com/.test(code),
        `${f}: Mission Control holds no Graph mailbox path at all — it relays commands, it does not talk to Graph`);
    }
  };
  for (const r of roots) walk(r);
  assert.ok(seen.size > 5, `the scan actually walked the tree (${seen.size} files)`);
});

test('NO SILENT TRUNCATION: a queue longer than the render limit says so instead of looking complete', () => {
  // The defect this pins, found on the first live mail pass: the panel took the 10 OLDEST
  // open proposals. Thirteen agent-dispatch recommendations landed in one second the day
  // before, filled the limit, and every newer item — agent deliverables awaiting an accept,
  // calendar blocks, every mail proposal — vanished from a board that looked complete.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-mail-trunc-'));
  const dbPath = fixture(dir);
  const db = new sqlite.DatabaseSync(dbPath);
  for (let i = 0; i < 70; i++) {
    db.exec(`INSERT INTO life_update_proposals (id,owner_id,update_id,task_id,capability_key,command_type,command_json,reason,confidence,risk_level,authority_class,state,created_at)
      VALUES ('old-${i}','woody','u1','t1','agent_dispatch','recommendation','{}','Really needs you: piled up',0.7,'LOW','READ','PROPOSED','2026-08-10T16:04:38.00${i % 10}Z')`);
  }
  db.close();
  withEnv(dbPath, () => {
    const out = renderToday();
    assert.match(out.body, /more open suggestions beyond what fits here/, 'the overflow is COUNTED and stated');
    assert.match(out.body, /Nothing is being hidden from you silently/);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the mail proposals SURFACE even behind a day of older recommendations (the live failure)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-mail-behind-'));
  const dbPath = fixture(dir);
  const db = new sqlite.DatabaseSync(dbPath);
  // 13 older recommendations, exactly the live shape that hid everything newer.
  for (let i = 0; i < 13; i++) {
    db.exec(`INSERT INTO life_update_proposals (id,owner_id,update_id,task_id,capability_key,command_type,command_json,reason,confidence,risk_level,authority_class,state,created_at)
      VALUES ('rec-${i}','woody','u1','t1','agent_dispatch','recommendation','{}','Really needs you: shape refusal',0.7,'LOW','READ','PROPOSED','2026-08-10T16:04:38.00${i % 10}Z')`);
  }
  db.exec(`INSERT INTO life_settings (key,value,updated_at) VALUES ('quiet_support','on','${T}')`);
  db.close();
  withEnv(dbPath, () => {
    const body = renderToday().body;
    assert.match(body, /From Lightspeed Support/, 'the mail proposal renders despite 13 older ones ahead of it');
    assert.match(body, /Book the annual gas safety re-certification/);
    assert.ok(!/more open suggestions beyond what fits/.test(body), 'and a queue this size needs no overflow warning');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the board can actually CHOOSE an email-reply wait (it used to hardcode HUMAN_UPDATE)', () => {
  const shell = fs.readFileSync(path.join(__dirname, '..', 'mission-control', 'ui', 'shared.js'), 'utf8');
  assert.match(shell, /Are you waiting on an EMAIL REPLY\?/, 'the owner is asked, once');
  assert.match(shell, /wakeType:byEmail\?'EMAIL_REPLY':'HUMAN_UPDATE'/, 'and the answer reaches the writer');
  assert.ok(!/wakeType:'HUMAN_UPDATE'/.test(shell), 'the hardcoded wake type is gone — it made the record lie');
});
