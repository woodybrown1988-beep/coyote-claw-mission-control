'use strict';
// AGENT PRESENCE (operator ask 2026-08-13) — who is on a task/project and WHERE, honestly:
// the job STATE MACHINE is the stage; the only % anywhere is a project's real tasks-done
// fraction, always shown WITH its numbers. Pins: the chip names the agent; the strip renders
// the machine's position (plan-gate loud); a one-shot job NEVER gets a percentage; the Claw
// board shows the task title + Open-the-task link on life jobs and leaves other jobs alone.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite = require('node:sqlite');
const LIFE = require('../mission-control/ui/pages/life/life-lib.js');
const TASK = require('../mission-control/ui/pages/life/task.js');
const TASKS = require('../mission-control/ui/pages/life/tasks.js');
const PROJECTS = require('../mission-control/ui/pages/life/projects.js');
const PROJECT = require('../mission-control/ui/pages/life/project.js');
const AGENTS = require('../mission-control/ui/pages/claw/agents.js');

const T = '2026-08-13T12:00:00.000Z';

function withEnv(dbPath, fn) {
  const prev = process.env.COYOTE_LIFE_DB;
  process.env.COYOTE_LIFE_DB = dbPath;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.COYOTE_LIFE_DB; else process.env.COYOTE_LIFE_DB = prev;
  }
}

/** Business-q stub: answers the jobs lookup from a fixed map, everything else ok-empty. */
function bizQ(jobsRows) {
  return (sql, params) => {
    if (/FROM jobs/.test(String(sql))) {
      const ids = new Set(params || []);
      return { ok: true, rows: jobsRows.filter((r) => ids.has(r.id)) };
    }
    return { ok: true, rows: [] };
  };
}

function lifeFixture(dir, seed) {
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
      definition_of_done TEXT, stage TEXT, status TEXT, risk_state TEXT, due_date TEXT, visibility TEXT, created_at TEXT, updated_at TEXT);
    CREATE VIEW v_life_available_work AS SELECT t.*, 0 AS calculated_priority FROM life_tasks t WHERE t.status = 'READY';
  `);
  if (seed) seed(db);
  db.close();
  return p;
}

const dispatchEvent = (db, id, taskId, jobId, jobKind, at) => db.prepare(
  `INSERT INTO life_task_events (id,owner_id,task_id,event_type,actor_type,actor_id,payload_json,created_at)
   VALUES (?,?,?,'AGENT_DISPATCHED','SERVICE','life-dispatcher',?,?)`,
).run(id, 'woody', taskId, JSON.stringify({ jobId, jobKind }), at);

test('helpers: last dispatch wins; the strip is the STATE MACHINE and never a percentage', () => {
  const m = LIFE.latestDispatchByTask([
    { task_id: 't1', payload_json: '{"jobId":"j-old","jobKind":"boxquery"}' },
    { task_id: 't1', payload_json: '{"jobId":"j-new","jobKind":"research"}' },
  ]);
  assert.deepEqual(m.get('t1'), { jobId: 'j-new', jobKind: 'research' }, 'a sent-back task’s live job is its newest');
  for (const st of ['queued', 'running', 'awaiting_signoff', 'done']) {
    assert.ok(!/%/.test(LIFE.stageStrip(st)), `no fabricated %% on '${st}' — the machine position is the truth`);
  }
  assert.match(LIFE.stageStrip('running'), /working/);
  assert.match(LIFE.stageStrip('awaiting_plan_feedback'), /#ef6b68/, 'the plan gate is loud');
  assert.match(LIFE.stageStrip('failed'), /gave up/);
  assert.match(LIFE.agentChip('boxquery', 'running'), /Box Query · working now/);
  assert.equal(LIFE.agentChip('boxquery', null), '', 'no status, no chip — never invented');
});

test('task drawer: the agent by NAME with its live stage; a handoff follows the specialist; the plan gate shouts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-pres-'));
  const dbPath = lifeFixture(dir, (db) => {
    db.prepare(`INSERT INTO life_tasks (id,owner_id,domain_key,title,status,execution_mode,visibility,source_type,created_by,created_at,updated_at)
      VALUES ('t1','woody','business','Create tag dictionary','READY','AI','OWNER_ONLY','MANUAL','h',?,?)`).run(T, T);
    dispatchEvent(db, 'e1', 't1', 'job-lead-1', 'lead', T);
  });
  withEnv(dbPath, () => {
    const render = (jobs) => TASK.render(TASK.getSection(null, { query: { id: 't1' } }), { q: bizQ(jobs) });
    const working = render([{ id: 'job-lead-1', type: 'lead', status: 'running', updated_at: 1, result: null }]);
    assert.match(working.body, /<b>The Lead<\/b> is on this/);
    assert.match(working.body, /working/);
    assert.match(working.body, /See the board/);
    assert.match(working.body, /href="\/claw\/agents"/);
    const gated = render([{ id: 'job-lead-1', type: 'lead', status: 'awaiting_plan_feedback', updated_at: 1, result: null }]);
    assert.match(gated.body, /plan awaits YOUR approval/);
    const handed = render([
      { id: 'job-lead-1', type: 'boxquery', status: 'done', updated_at: 1, result: JSON.stringify({ outcome: 'handoff', handoffJob: 'job-fin-1' }) },
      { id: 'job-fin-1', type: 'finplan', status: 'running', updated_at: 2, result: null },
    ]);
    assert.match(handed.body, /→ <b>finplan<\/b>/, 'the specialist actually working is the one shown');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('All tasks rows: an in-flight chip, and NO chip once delivered (the proposal owns that state)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-pres2-'));
  const dbPath = lifeFixture(dir, (db) => {
    db.prepare(`INSERT INTO life_tasks (id,owner_id,domain_key,title,status,execution_mode,visibility,source_type,created_by,created_at,updated_at)
      VALUES ('t1','woody','business','Working one','READY','AI','OWNER_ONLY','MANUAL','h',?,?)`).run(T, T);
    db.prepare(`INSERT INTO life_tasks (id,owner_id,domain_key,title,status,execution_mode,visibility,source_type,created_by,created_at,updated_at)
      VALUES ('t2','woody','business','Delivered one','READY','AI','OWNER_ONLY','MANUAL','h',?,?)`).run(T, T);
    dispatchEvent(db, 'e1', 't1', 'j1', 'boxquery', T);
    dispatchEvent(db, 'e2', 't2', 'j2', 'research', T);
  });
  withEnv(dbPath, () => {
    const out = TASKS.render(TASKS.getSection(null, { query: {} }), { q: bizQ([
      { id: 'j1', type: 'boxquery', status: 'running', updated_at: 1, result: null },
      { id: 'j2', type: 'research', status: 'done', updated_at: 1, result: null },
    ]) });
    assert.match(out.body, /Box Query · working now/);
    assert.ok(!/Researcher · delivered/.test(out.body), 'a delivered job is the proposal’s story, not a presence chip');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('projects: the one honest %% — tasks done over tasks, WITH its fraction — plus who is working, by name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-pres3-'));
  const dbPath = lifeFixture(dir, (db) => {
    db.prepare(`INSERT INTO life_projects (id,owner_id,domain_key,title,definition_of_done,stage,status,risk_state,visibility,created_at,updated_at)
      VALUES ('p1','woody','business','Loyalty programme','measurable','define','ACTIVE','GREEN','OWNER_ONLY',?,?)`).run(T, T);
    const ins = db.prepare(`INSERT INTO life_tasks (id,owner_id,project_id,domain_key,title,status,execution_mode,visibility,source_type,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    ins.run('t1', 'woody', 'p1', 'business', 'Done one', 'DONE', 'SELF', 'OWNER_ONLY', 'MANUAL', 'h', T, T);
    ins.run('t2', 'woody', 'p1', 'business', 'Done two', 'DONE', 'SELF', 'OWNER_ONLY', 'MANUAL', 'h', T, T);
    ins.run('t3', 'woody', 'p1', 'business', 'Live one', 'READY', 'AI', 'OWNER_ONLY', 'MANUAL', 'h', T, T);
    ins.run('t4', 'woody', 'p1', 'business', 'Live two', 'READY', 'AI', 'OWNER_ONLY', 'MANUAL', 'h', T, T);
    ins.run('t5', 'woody', 'p1', 'business', 'Cancelled — not counted', 'CANCELLED', 'SELF', 'OWNER_ONLY', 'MANUAL', 'h', T, T);
    dispatchEvent(db, 'e1', 't3', 'j1', 'boxquery', T);
  });
  withEnv(dbPath, () => {
    const jobs = [{ id: 'j1', type: 'boxquery', status: 'running', updated_at: 1, result: null }];
    const cards = PROJECTS.render(PROJECTS.getSection(null, {}), { q: bizQ(jobs) });
    assert.match(cards.body, /2 of 4 tasks done/, 'cancelled work is neither done nor owed');
    assert.match(cards.body, />50%</);
    assert.match(cards.body, /working now: Box Query/);
    const drawer = withEnv(dbPath, () => PROJECT.render(PROJECT.getSection(null, { query: { id: 'p1' } }), { q: bizQ(jobs) }));
    assert.match(drawer.body, /2 of 4 tasks done/);
    assert.match(drawer.body, /Box Query · working now/, 'the per-task chip rides the project drawer too');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the Claw board: a life job shows its TASK and links to it; other jobs are untouched', () => {
  const now = Date.parse(T);
  const jobs = [
    { id: 'j-life-1', type: 'boxquery', status: 'running', payload: JSON.stringify({ question: 'x', lifeDispatch: { taskId: 'aaaa-task', title: 'Create repeat-member dashboard', dispatcher: 'life-dispatcher' } }), created_at: now - 60000, updated_at: now - 30000, attempts: 1, error: null, parent_job_id: null, owner_id: null },
    { id: 'j-plain-1', type: 'boxquery', status: 'running', payload: JSON.stringify({ question: 'plain data question' }), created_at: now - 60000, updated_at: now - 30000, attempts: 1, error: null, parent_job_id: null, owner_id: null },
  ];
  const q = (sql) => {
    const s = String(sql);
    if (/FROM jobs WHERE status NOT IN/.test(s)) return { ok: true, rows: jobs };
    if (/FROM jobs WHERE status IN \('done','failed'\)/.test(s)) return { ok: true, rows: [] };
    return { ok: true, rows: [] };
  };
  const section = AGENTS.getSection(null, { q, now, halt: { halted: false } });
  const out = AGENTS.render(section, { serverRev: '' });
  assert.match(out.body, /Create repeat-member dashboard/, 'the board names the TASK, not just the lane');
  assert.match(out.body, /href="\/life\/task\?id=aaaa-task"/, 'Open the task rides the card');
  assert.match(out.body, /life task · boxquery/);
  assert.ok(!/href="\/life\/task\?id=[^"]*plain/.test(out.body), 'a non-life job gains no task link');
});
