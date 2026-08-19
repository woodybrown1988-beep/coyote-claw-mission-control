'use strict';
// NEW UPDATE ON TODAY (operator ask 2026-08-19: "the task is marked somewhere on the today
// sheet advising new update … flashing to show me its returned or has a 'New Update' banner
// or both"). The rule carries no read-receipt: UNSEEN = the agent spoke more recently than
// the owner acted on that task, so replying/deciding/completing clears it and nothing has to
// be maintained. Pinned: the banner appears with the task named; the row wears a tag; owner
// action clears it; finished work never nags; the motion is bounded and motion-safe.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite = require('node:sqlite');
const TODAY = require('../mission-control/ui/pages/life/today.js');

const NOW = Date.parse('2026-08-19T16:00:00.000Z');
const DAY = '2026-08-19';
const T = new Date(NOW).toISOString();
const ago = (ms) => new Date(NOW - ms).toISOString();

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
      due_kind TEXT DEFAULT 'NONE', due_at TEXT, recurs TEXT, importance INTEGER DEFAULT 3, risk_level TEXT DEFAULT 'LOW',
      closure_evidence_uri TEXT, visibility TEXT, source_type TEXT, created_by TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE life_task_updates (id TEXT PRIMARY KEY, task_id TEXT, owner_id TEXT, actor_type TEXT, actor_id TEXT,
      raw_text TEXT, record_only INTEGER DEFAULT 0, source_ref TEXT, created_at TEXT);
    CREATE TABLE life_task_events (id TEXT PRIMARY KEY, owner_id TEXT, task_id TEXT, event_type TEXT,
      actor_type TEXT, actor_id TEXT, from_state TEXT, to_state TEXT, payload_json TEXT, created_at TEXT);
    CREATE TABLE life_update_proposals (id TEXT PRIMARY KEY, owner_id TEXT, update_id TEXT, task_id TEXT,
      source_mail_id TEXT, capability_key TEXT, command_type TEXT, command_json TEXT, reason TEXT,
      evidence_refs_json TEXT DEFAULT '[]', confidence REAL, risk_level TEXT, authority_class TEXT, state TEXT,
      decided_by TEXT, decision_note TEXT, decided_at TEXT, applied_event_id TEXT, created_at TEXT);
    CREATE TABLE life_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE life_waiting_conditions (id TEXT PRIMARY KEY, task_id TEXT, owner_id TEXT,
      dependency_label TEXT, wake_type TEXT, fallback_at TEXT, state TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE life_daily_plans (owner_id TEXT, plan_date TEXT, status TEXT, must_win_task_id TEXT,
      support_task_1_id TEXT, support_task_2_id TEXT, decision_task_ids_json TEXT DEFAULT '[]',
      alternative_task_ids_json TEXT DEFAULT '[]', compilation_evidence_json TEXT DEFAULT '{}',
      approved_by TEXT, approved_at TEXT, created_at TEXT, updated_at TEXT, PRIMARY KEY (owner_id, plan_date));
    CREATE VIEW v_life_available_work AS
      SELECT t.*, 0 AS calculated_priority FROM life_tasks t WHERE t.status = 'READY';
  `);
  const task = (id, title, status = 'READY') => db.exec(
    `INSERT INTO life_tasks (id,owner_id,domain_key,title,status,visibility,source_type,created_by,created_at,updated_at)
     VALUES ('${id}','woody','business','${title}','${status}','OWNER_ONLY','MANUAL','h','${T}','${T}')`);
  const upd = db.prepare(`INSERT INTO life_task_updates (id,task_id,owner_id,actor_type,actor_id,raw_text,record_only,created_at) VALUES (?,?,'woody',?,?,?,0,?)`);
  seed({ db, task, upd });
  db.close();
  return p;
}

test('an agent answer that arrived AFTER the owner last acted raises the banner and tags the task', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-newup-'));
  const dbPath = fixture(dir, ({ task, upd }) => {
    task('t-back', 'New electricity contract');
    upd.run('u1', 't-back', 'HUMAN', 'woody', 'see attached bills', ago(3600e3));
    upd.run('u2', 't-back', 'AGENT', 'finplan', 'THE FULL REPORT — British Gas review', ago(600e3));
  });
  withEnv(dbPath, () => {
    const body = TODAY.render(TODAY.getSection(null, { now: NOW }), { now: NOW }).body;
    assert.match(body, /1 new agent update — an agent has come back to you/, 'the banner counts it');
    assert.match(body, /New electricity contract/, 'and names the task');
    assert.match(body, /href="\/life\/task\?id=t-back"/, 'linking straight into it');
    assert.match(body, /clears when you reply, decide or complete/, 'the clearing rule is stated, not guessed at');
    assert.match(body, /class="lt-newup-dot"/, 'the pulse rides the banner');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the owner acting AFTER the agent clears it — and finished work never nags', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-newup2-'));
  const dbPath = fixture(dir, ({ db, task, upd }) => {
    task('t-answered', 'Answered and dealt with');
    upd.run('u1', 't-answered', 'AGENT', 'finplan', 'report', ago(900e3));
    upd.run('u2', 't-answered', 'HUMAN', 'woody', 'thanks — actioned', ago(300e3));

    task('t-event', 'Cleared by a decision, not a note');
    upd.run('u3', 't-event', 'AGENT', 'boxquery', 'answer', ago(900e3));
    db.exec(`INSERT INTO life_task_events (id,owner_id,task_id,event_type,actor_type,actor_id,created_at)
             VALUES ('e1','woody','t-event','STATUS_CHANGED','HUMAN','woody','${ago(120e3)}')`);

    task('t-done', 'Finished work', 'DONE');
    upd.run('u4', 't-done', 'AGENT', 'finplan', 'report', ago(60e3));
  });
  withEnv(dbPath, () => {
    const body = TODAY.render(TODAY.getSection(null, { now: NOW }), { now: NOW }).body;
    assert.ok(!/new agent update/.test(body), 'nothing is flagged');
    assert.ok(!body.includes('<span class="lt-newtag">'), 'and no row wears the rendered tag');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the motion is bounded and motion-safe — a permanently flashing page is noise', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-newup3-'));
  const dbPath = fixture(dir, ({ task, upd }) => {
    task('t1', 'Something back');
    upd.run('u1', 't1', 'AGENT', 'finplan', 'report', ago(60e3));
  });
  withEnv(dbPath, () => {
    const body = TODAY.render(TODAY.getSection(null, { now: NOW }), { now: NOW }).body;
    assert.match(body, /animation:ltpulse 1\.6s ease-in-out 3/, 'it pulses a bounded number of times, never forever');
    assert.match(body, /@media \(prefers-reduced-motion: reduce\)\{[^}]*animation:none/, 'and stops entirely for reduced motion');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});
