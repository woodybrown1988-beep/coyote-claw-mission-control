'use strict';
// WAVE 3 (ops/audit-life-os-2026-08-13.md) — batch decide + the honesty pack, pinned against
// the EMITTED output (mc-client-script-parse-gate: what the browser gets is what is tested).
// The contracts here: every batch tick is an individual proposal id with an accept-safety
// flag (calendar blocks and drafted replies carry data-acceptok="0" — their accept is
// placing/reading, own cards only); a slice says it sliced; the fold's deadline override
// fires on FUTURE times only (a provenance date must not unfold half the mail rail); the
// All-tasks cap is disclosed and the search hits the database; Review says when it was
// built; Agents tells the live truth; Trust excludes UNRESOLVED from accuracy both ways.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite = require('node:sqlite');

const TODAY = require('../mission-control/ui/pages/life/today.js');
const TASKS = require('../mission-control/ui/pages/life/tasks.js');
const REVIEW = require('../mission-control/ui/pages/life/review.js');
const AGENTS = require('../mission-control/ui/pages/life/agents.js');
const TRUST = require('../mission-control/ui/pages/life/trust.js');

const NOW = Date.parse('2026-08-13T12:00:00.000Z');
const T = new Date(NOW).toISOString();
const ago = (ms) => new Date(NOW - ms).toISOString();

function withEnv(dbPath, fn) {
  const prev = process.env.COYOTE_LIFE_DB;
  process.env.COYOTE_LIFE_DB = dbPath;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.COYOTE_LIFE_DB; else process.env.COYOTE_LIFE_DB = prev;
  }
}

/** Minimal fixture: tables the assertions depend on (absent tables degrade honestly). */
function fixture(dir, seed) {
  const p = path.join(dir, 'life.db');
  const db = new sqlite.DatabaseSync(p);
  db.exec(`
    CREATE TABLE life_tasks (id TEXT PRIMARY KEY, owner_id TEXT, outcome_id TEXT, project_id TEXT, domain_key TEXT,
      title TEXT, description TEXT DEFAULT '', status TEXT, execution_mode TEXT, definition_of_done TEXT DEFAULT '',
      due_kind TEXT DEFAULT 'NONE', due_at TEXT, importance INTEGER DEFAULT 3, risk_level TEXT DEFAULT 'LOW',
      closure_evidence_uri TEXT, visibility TEXT, source_type TEXT, created_by TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE life_update_proposals (id TEXT PRIMARY KEY, owner_id TEXT, update_id TEXT, task_id TEXT,
      source_mail_id TEXT, capability_key TEXT, command_type TEXT, command_json TEXT, reason TEXT,
      evidence_refs_json TEXT DEFAULT '[]', confidence REAL, risk_level TEXT, authority_class TEXT, state TEXT,
      decided_by TEXT, decision_note TEXT, decided_at TEXT, applied_event_id TEXT, created_at TEXT);
    CREATE TABLE life_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE life_waiting_conditions (id TEXT PRIMARY KEY, task_id TEXT, owner_id TEXT,
      dependency_label TEXT, wake_type TEXT, fallback_at TEXT, state TEXT, created_at TEXT, updated_at TEXT);
    CREATE VIEW v_life_available_work AS
      SELECT t.*, 0 AS calculated_priority FROM life_tasks t WHERE t.status = 'READY';
  `);
  if (seed) seed(db);
  db.close();
  return p;
}

test('batch decide: one checkbox per open proposal, accept-safety flags, ellipsis on the snip, jump chip', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-w3-batch-'));
  const longReason = 'refusing beats guessing with a budget and this sentence keeps going well past the hundred and forty character mark so the batch row must show an ellipsis rather than stopping mid word somewhere unhelpful';
  const dbPath = fixture(dir, (db) => {
    db.exec(`INSERT INTO life_tasks (id,owner_id,domain_key,title,status,visibility,source_type,created_by,created_at,updated_at)
      VALUES ('t1','woody','business','Loyalty KPI baseline','READY','OWNER_ONLY','MANUAL','h','${T}','${T}')`);
    const ins = db.prepare(`INSERT INTO life_update_proposals (id,owner_id,task_id,capability_key,command_type,command_json,reason,confidence,risk_level,authority_class,state,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'PROPOSED',?)`);
    ins.run('p-route', 'woody', 't1', 'agent_dispatch', 'set_route', '{"taskId":"t1","mode":"HYBRID"}', longReason, 0.7, 'LOW', 'READ', ago(3600e3));
    ins.run('p-deliver', 'woody', 't1', 'agent_delivery', 'complete', '{"taskId":"t1","evidenceNote":"Member penetration 14.2% and AOV £31.80"}', 'The boxquery agent finished job abc.', 0.8, 'LOW', 'INTERNAL_WRITE', ago(3600e3));
    ins.run('p-block', 'woody', 't1', 'calendar_block', 'place_block', '{"startAt":"2026-08-14T09:00:00","endAt":"2026-08-14T10:00:00"}', 'a focus block for the must-win', 0.7, 'LOW', 'EXTERNAL', ago(3600e3));
    ins.run('p-draft', 'woody', 't1', 'mail_reply_draft', 'draft_reply', '{"draftId":"d1"}', 'a reply is drafted', 0.6, 'LOW', 'INTERNAL_WRITE', ago(3600e3));
  });
  withEnv(dbPath, () => {
    const out = TODAY.render(TODAY.getSection(null, { now: NOW }), { now: NOW });
    assert.match(out.body, /class="lc-batch"/, 'the batch screen renders at 4+ open proposals');
    const boxes = [...out.body.matchAll(/class="lc-batch-ck" data-proposal="([^"]+)" data-acceptok="([01])"/g)]
      .map((m) => [m[1], m[2]]);
    assert.equal(boxes.length, 4, 'one tick per open proposal');
    const flag = Object.fromEntries(boxes);
    assert.equal(flag['p-route'], '1');
    assert.equal(flag['p-deliver'], '1');
    assert.equal(flag['p-block'], '0', 'a calendar block accept IS the placement — own card only');
    assert.equal(flag['p-draft'], '0', 'a drafted reply accept means the words were read — own card only');
    assert.match(out.body, /data-lc-batch="accept"/);
    assert.match(out.body, /data-lc-batch="reject"/);
    assert.match(out.body, /somewhere…|well past the hundred and forty character mark…|…/, 'the snip carries an ellipsis, never a mid-word stop');
    assert.ok(!/ — it suggests[^…]*\bsuggest re-\b/.test(out.body), 'no bare mid-word cuts');
    assert.match(out.body, /href="#lt-needs"/, 'the decisions jump chip points at the queue');
    assert.match(out.body, /id="lt-needs"/, 'and the queue carries the anchor');
    assert.match(out.body, /Member penetration 14\.2% and AOV £31\.80/, 'the agent deliverable CONTENT is on the card');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('batch rows say what accept DOES and open their task/email — links outside the tick label', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-w3-clarity-'));
  const fullReason = 'The replacement is scheduled for 19 August, but this does not confirm the awaited terms and warranty — from the supplier thread, matches the waiting dependency on the exchange agreement.';
  const dbPath = fixture(dir, (db) => {
    db.exec(`CREATE TABLE life_mail_messages (id TEXT PRIMARY KEY, owner_id TEXT, folder_name TEXT DEFAULT '',
      from_name TEXT, from_address TEXT, subject TEXT, body_preview TEXT, received_at TEXT, web_link TEXT)`);
    db.exec(`INSERT INTO life_tasks (id,owner_id,domain_key,title,status,visibility,source_type,created_by,created_at,updated_at)
      VALUES ('t1','woody','business','Carpigiani exchange terms','READY','OWNER_ONLY','MANUAL','h','${T}','${T}')`);
    db.exec(`INSERT INTO life_mail_messages (id,owner_id,folder_name,from_name,from_address,subject,body_preview,received_at,web_link)
      VALUES ('m1','woody','','Carpigiani','svc@carpigiani.co.uk','Exchange','...','${T}','https://outlook.example/m1')`);
    const ins = db.prepare(`INSERT INTO life_update_proposals (id,owner_id,task_id,capability_key,command_type,command_json,reason,confidence,risk_level,authority_class,state,source_mail_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'PROPOSED',?,?)`);
    ins.run('p-upd', 'woody', 't1', 'task_update', 'add_update', '{"taskId":"t1"}', fullReason, 0.65, 'LOW', 'READ', 'm1', ago(3600e3));
    ins.run('p-new', 'woody', null, 'task_capture', 'create_task', '{"title":"Renew the LivePepper subscription"}', 'The subscription expires and needs renewal in the back office.', 0.55, 'LOW', 'READ', null, ago(3600e3));
    ins.run('p-r2', 'woody', 't1', 'agent_dispatch', 'set_route', '{"taskId":"t1","mode":"HYBRID"}', 'r', 0.7, 'LOW', 'READ', null, ago(3600e3));
    ins.run('p-r3', 'woody', 't1', 'agent_delivery', 'complete', '{"taskId":"t1"}', 'r', 0.8, 'LOW', 'INTERNAL_WRITE', null, ago(3600e3));
  });
  withEnv(dbPath, () => {
    const body = TODAY.render(TODAY.getSection(null, { now: NOW }), { now: NOW }).body;
    // The full evidence sentence survives — no 140-char mid-word cut (the live complaint).
    assert.ok(body.includes('matches the waiting dependency on the exchange agreement.'), 'the whole reason is readable');
    // Every verb says its consequence in plain words.
    assert.match(body, /Accept files this on the task as evidence — nothing else moves\./);
    assert.match(body, /Accept creates this task in your Inbox\./);
    assert.match(body, /Accept changes who does the task\./);
    assert.match(body, /Accept marks the task done\./);
    // The row opens its task and its email — and the links sit OUTSIDE the <label>, so
    // navigating never toggles the tick.
    assert.ok(body.includes('href="/life/task?id=t1"'), 'Open task link present');
    assert.ok(body.includes('https://outlook.example/m1'), 'Read email link present for mail-backed rows');
    const labelChunk = /<label[^>]*>[\s\S]*?<\/label>/g;
    for (const m of body.match(labelChunk) || []) {
      assert.ok(!m.includes('href="/life/task'), 'no task link inside a tick label');
    }
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('deadline override: a FUTURE time unfolds; a provenance (past) date stays folded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-w3-fold-'));
  const dbPath = fixture(dir, (db) => {
    db.exec(`INSERT INTO life_settings (key,value,updated_at) VALUES ('quiet_support','on','${T}')`);
    db.exec(`INSERT INTO life_tasks (id,owner_id,domain_key,title,status,visibility,source_type,created_by,created_at,updated_at)
      VALUES ('t1','woody','business','Griddle gas fault','READY','OWNER_ONLY','MANUAL','h','${T}','${T}')`);
    const ins = db.prepare(`INSERT INTO life_update_proposals (id,owner_id,task_id,capability_key,command_type,command_json,reason,confidence,risk_level,authority_class,state,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'PROPOSED',?)`);
    // The audit's live case: an engineer-access commitment for TOMORROW, low risk → used to fold.
    ins.run('p-urgent', 'woody', 't1', 'waiting_inference', 'set_waiting', '{"dependencyLabel":"engineer"}',
      'Provide engineer access tomorrow 8-9am for the griddle gas fault', 0.55, 'LOW', 'READ', ago(3600e3));
    // A provenance date (the mail arrived yesterday) — MUST stay folded (the GasSafe regression).
    ins.run('p-prov', 'woody', 't1', 'waiting_inference', 'set_waiting', '{"dependencyLabel":"supplier"}',
      `a certificate has to be re-booked before it lapses (from GasSafe, ${ago(20 * 3600e3).slice(0, 10)})`, 0.55, 'LOW', 'READ', ago(3600e3));
  });
  withEnv(dbPath, () => {
    const out = TODAY.render(TODAY.getSection(null, { now: NOW }), { now: NOW });
    assert.match(out.body, /time-critical/, 'the future commitment carries the chip');
    const foldStart = out.body.indexOf('<details');
    assert.ok(foldStart > -1, 'the quiet fold still exists');
    const fold = out.body.slice(foldStart, out.body.indexOf('</details>'));
    assert.ok(!fold.includes('engineer access tomorrow'), 'the future commitment is OUT of the fold');
    assert.ok(fold.includes('GasSafe'), 'the provenance-dated suggestion stays folded');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('All tasks: the cap is disclosed, show-all lifts it, and search queries the DATABASE', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-w3-tasks-'));
  const dbPath = fixture(dir, (db) => {
    const ins = db.prepare(`INSERT INTO life_tasks (id,owner_id,domain_key,title,description,status,visibility,source_type,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    // 120 open tasks; the NEEDLE is the LEAST recently updated — outside any first-100 page.
    ins.run('needle', 'woody', 'business', 'The needle task nobody could find', 'contains the word xylophone', 'READY', 'OWNER_ONLY', 'IMPORT', 'h', ago(200 * 86400e3), ago(200 * 86400e3));
    for (let i = 0; i < 119; i++) {
      ins.run(`t${i}`, 'woody', 'business', `Routine task ${i}`, '', 'READY', 'OWNER_ONLY', 'IMPORT', 'h', ago(i * 3600e3), ago(i * 3600e3));
    }
  });
  withEnv(dbPath, () => {
    const capped = TASKS.render(TASKS.getSection(null, { query: {} }), {});
    assert.match(capped.body, /Showing the 100 most recently touched of <b>120<\/b>/, 'the cap says so');
    assert.match(capped.body, /show all 120/);
    assert.ok(!capped.body.includes('needle task'), 'the needle is beyond the first page — that is the point');

    const all = TASKS.render(TASKS.getSection(null, { query: { all: '1' } }), {});
    assert.ok(all.body.includes('The needle task nobody could find'), 'show-all really shows all');

    const search = TASKS.render(TASKS.getSection(null, { query: { q: 'xylophone' } }), {});
    assert.ok(search.body.includes('The needle task nobody could find'), 'search hits the DB (description included), not the fetched DOM');
    assert.match(search.body, /1 of 120 open tasks match/);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Weekly review: a snapshot names its age; a past-week draft warns before approving', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-w3-review-'));
  const dbPath = fixture(dir, (db) => {
    db.exec(`CREATE TABLE life_weekly_snapshots (id TEXT PRIMARY KEY, owner_id TEXT, week_start TEXT, week_end TEXT,
      evidence_json TEXT, proposed_big_three_json TEXT, approved_big_three_json TEXT, carry_forward_json TEXT DEFAULT '[]',
      subtraction_json TEXT DEFAULT '[]', status TEXT, approved_by TEXT, approved_at TEXT, created_at TEXT, updated_at TEXT);
      INSERT INTO life_weekly_snapshots (id,owner_id,week_start,week_end,evidence_json,proposed_big_three_json,status,created_at,updated_at)
      VALUES ('ws1','woody','2026-08-02','2026-08-08','{"done_week":0,"captured_week":0}','[]','DRAFT','${ago(11 * 86400e3)}','${ago(11 * 86400e3)}');`);
  });
  withEnv(dbPath, () => {
    const out = REVIEW.render(REVIEW.getSection(null, { now: NOW }), {});
    assert.match(out.body, /This snapshot is from the week of 2026-08-02/, 'a stale snapshot cannot pose as the present');
    assert.match(out.body, /built 11 days ago/);
    assert.match(out.body, /that week/, 'KPI captions stop saying "this week"');
    assert.match(out.body, /rebuild before approving/i, 'a past-week draft warns at the approve button');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Agent activity: live numbers when agents worked; the honest zero-state only at zero', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-w3-agents-'));
  const dbPath = fixture(dir, (db) => {
    db.exec(`CREATE TABLE life_task_events (id TEXT PRIMARY KEY, owner_id TEXT, task_id TEXT, event_type TEXT, actor_type TEXT,
      actor_id TEXT, from_state TEXT, to_state TEXT, payload_json TEXT DEFAULT '{}', idempotency_key TEXT, created_at TEXT);
      CREATE TABLE life_task_updates (id TEXT PRIMARY KEY, owner_id TEXT, task_id TEXT, actor_type TEXT, actor_id TEXT,
      raw_text TEXT, input_type TEXT, record_only INTEGER DEFAULT 0, visibility TEXT, source_ref TEXT,
      attachment_refs_json TEXT DEFAULT '[]', extractor_version TEXT, created_at TEXT);
      INSERT INTO life_tasks (id,owner_id,domain_key,title,status,visibility,source_type,created_by,created_at,updated_at)
      VALUES ('t1','woody','business','Loyalty KPI baseline','READY','OWNER_ONLY','MANUAL','h','${T}','${T}');
      INSERT INTO life_task_events (id,owner_id,task_id,event_type,actor_type,actor_id,created_at)
      VALUES ('e1','woody','t1','AGENT_DISPATCHED','SERVICE','life-dispatcher','${ago(86400e3)}');
      INSERT INTO life_update_proposals (id,owner_id,task_id,capability_key,command_type,command_json,reason,confidence,risk_level,authority_class,state,created_at)
      VALUES ('p1','woody','t1','agent_delivery','complete','{}','done','0.8','LOW','INTERNAL_WRITE','PROPOSED','${ago(3600e3)}');
      INSERT INTO life_task_updates (id,owner_id,task_id,actor_type,actor_id,raw_text,input_type,visibility,created_at)
      VALUES ('u1','woody','t1','AGENT','boxquery','Delivered (job abc): the numbers','TEXT','OWNER_ONLY','${ago(3600e3)}');`);
  });
  withEnv(dbPath, () => {
    const out = AGENTS.render(AGENTS.getSection(null, { now: NOW }), {});
    assert.ok(!out.body.includes('No agents are connected yet'), 'the false empty-state is gone');
    assert.match(out.body, /Awaiting your accept/);
    assert.match(out.body, /Delivered \(job abc\)/, 'recent agent work in its own words');
    assert.match(out.body, /Decide on Today/);
  });
  // Zero-state: a fresh empty db renders the honest zero, not fabricated activity.
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-w3-agents0-'));
  withEnv(fixture(dir2), () => {
    const out0 = AGENTS.render(AGENTS.getSection(null, { now: NOW }), {});
    assert.match(out0.body, /Nothing has worked on your behalf yet/);
  });
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dir2, { recursive: true, force: true });
});

test('Trust: UNRESOLVED never counts as a decision, and the filing rail has a ledger card', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-w3-trust-'));
  const dbPath = fixture(dir, (db) => {
    db.exec(`CREATE TABLE life_automation_capabilities (id TEXT PRIMARY KEY, owner_id TEXT, capability_key TEXT, display_name TEXT,
      maturity TEXT, authority_ceiling TEXT, contract_json TEXT, minimum_sample INTEGER DEFAULT 30,
      required_accuracy REAL DEFAULT 0.9, maximum_calibration_gap REAL DEFAULT 0.08, emergency_paused INTEGER DEFAULT 0,
      last_reviewed_at TEXT, reviewed_by TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE life_confidence_predictions (id TEXT PRIMARY KEY, owner_id TEXT, capability_key TEXT, subject_type TEXT,
      subject_id TEXT, predicted_confidence REAL, decision_band TEXT, factors_json TEXT, model_version TEXT,
      rule_version TEXT, source_freshness_state TEXT, created_at TEXT);
      CREATE TABLE life_confidence_outcomes (id TEXT PRIMARY KEY, prediction_id TEXT UNIQUE, owner_id TEXT, resolution TEXT,
      severity TEXT, resolved_by TEXT, evidence_json TEXT DEFAULT '{}', resolved_at TEXT);
      CREATE TABLE life_automation_events (id TEXT PRIMARY KEY, owner_id TEXT, capability_id TEXT, event_type TEXT,
      from_maturity TEXT, to_maturity TEXT, reason TEXT, evidence_json TEXT DEFAULT '{}', actor_id TEXT, created_at TEXT);
      CREATE TABLE life_mail_rules (id TEXT PRIMARY KEY, owner_id TEXT, match_kind TEXT, match_value TEXT,
      dest_folder_id TEXT, dest_path TEXT, state TEXT, origin TEXT, sample_count INTEGER, reason TEXT,
      created_at TEXT, armed_at TEXT, updated_at TEXT);
      CREATE TABLE life_mail_moves (id TEXT PRIMARY KEY, owner_id TEXT, message_id TEXT, new_message_id TEXT, subject TEXT,
      from_address TEXT, from_folder_id TEXT, from_folder_name TEXT, to_folder_id TEXT, to_folder_name TEXT,
      rule_id TEXT, state TEXT, redirect_reason TEXT, undone_at TEXT, moved_at TEXT);
      INSERT INTO life_automation_capabilities (id,owner_id,capability_key,display_name,maturity,authority_ceiling,contract_json,created_at,updated_at)
      VALUES ('c1','woody','mail_wake','Mail wake','RECOMMEND','ASSIST','{}','${T}','${T}');
      INSERT INTO life_confidence_predictions (id,owner_id,capability_key,subject_type,subject_id,predicted_confidence,decision_band,factors_json,model_version,rule_version,source_freshness_state,created_at)
      VALUES ('pr1','woody','mail_wake','proposal','x1',0.7,'RECOMMEND','{}','v','v','FRESH','${T}'),
             ('pr2','woody','mail_wake','proposal','x2',0.7,'RECOMMEND','{}','v','v','FRESH','${T}');
      INSERT INTO life_confidence_outcomes (id,prediction_id,owner_id,resolution,severity,resolved_by,resolved_at)
      VALUES ('o1','pr1','woody','CORRECT','NONE','h','${T}'),
             ('o2','pr2','woody','UNRESOLVED','NONE','SERVICE:life-writer','${T}');
      INSERT INTO life_mail_rules (id,owner_id,match_kind,match_value,state,origin,created_at,updated_at)
      VALUES ('r1','woody','SENDER','x@y.z','ARMED','CLASSIFIER','${T}','${T}');
      INSERT INTO life_mail_moves (id,owner_id,message_id,subject,from_address,from_folder_id,from_folder_name,to_folder_id,to_folder_name,rule_id,state,moved_at)
      VALUES ('m1','woody','msg1','s','x@y.z','i','Inbox','f','Filed','r1','APPLIED','${T}'),
             ('m2','woody','msg2','s','x@y.z','i','Inbox','f','Filed','r1','UNDONE','${T}');`);
  });
  withEnv(dbPath, () => {
    const out = TRUST.render(TRUST.getSection(null, {}), {});
    // 1 CORRECT + 1 UNRESOLVED: resolved must read 1 (the naive any-outcome-row formula read 2).
    assert.match(out.body, /\(1 of 30 needed\)/, 'UNRESOLVED is excluded from the decided count — an expiry is not a verdict');
    assert.match(out.body, /The filing rail/, 'the class-authorized actor has its ledger where promotions are judged');
    assert.match(out.body, /<b>1<\/b> filed by <b>1<\/b> armed rule/);
    assert.match(out.body, /1<\/b> put back \(50\.0%\)/);
    assert.match(out.body, /1 capabilities, all at recommend/i);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});
