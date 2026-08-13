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
    assert.match(working.body, /href="\/claw\/engine"/);
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

// ── "THE AGENT IS STUCK UNTIL YOU SPEAK" (operator ask 2026-08-13): the light-red flag ──
test('needs-you: every stuck state flags; a sent-back task does NOT; a delivered answer does NOT', () => {
  const entry = { jobId: 'j1', jobKind: 'boxquery', reopened: false };
  const nu = (job) => LIFE.agentNeedsYou(entry, job);
  assert.match(nu({ status: 'awaiting_plan_feedback' }).reason, /plan needs your approval/);
  assert.match(nu({ status: 'awaiting_signoff' }).reason, /sign-off/);
  assert.match(nu({ status: 'escalated' }).reason, /gave up/);
  assert.match(nu({ status: 'failed', attempts: 1, max_attempts: 1 }).reason, /gave up/);
  assert.match(nu({ status: 'done', result: JSON.stringify({ outcome: 'cant-see', reason: 'no supplier list' }) }).reason, /asked you a question/);
  assert.equal(nu({ status: 'boxquery' && 'running' }), null, 'a working agent is not stuck');
  assert.equal(nu({ status: 'queued' }), null);
  // A retry still in the tank is NOT a give-up — the fleet will pick it up again.
  assert.equal(nu({ status: 'failed', attempts: 1, max_attempts: 3 }), null, 'a retryable failure must not cry for help');
  // A DELIVERED answer is a decision (Today's queue owns it), never a red "talk to me".
  assert.equal(nu({ status: 'done', result: JSON.stringify({ outcome: 'answered', replyText: 'x' }) }), null);
  // THE RED CASE: already sent back → queued to go again, not stuck.
  assert.equal(LIFE.agentNeedsYou({ ...entry, reopened: true }, { status: 'escalated' }), null,
    'a task the owner already answered must never keep shouting');
  // and a NEWER dispatch after a send-back resets the flag state (the class, not the instance)
  const m = LIFE.dispatchStateByTask([
    { task_id: 't1', event_type: 'AGENT_DISPATCHED', payload_json: '{"jobId":"j1","jobKind":"boxquery"}' },
    { task_id: 't1', event_type: 'REOPENED', payload_json: '{}' },
    { task_id: 't1', event_type: 'AGENT_DISPATCHED', payload_json: '{"jobId":"j2","jobKind":"boxquery"}' },
  ]);
  assert.deepEqual(m.get('t1'), { jobId: 'j2', jobKind: 'boxquery', reopened: false }, 'the fresh dispatch is the live one again');
});

test('the light-red row reaches every list: Today panel, All tasks, project drawer + card', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-stuck-'));
  const dbPath = lifeFixture(dir, (db) => {
    db.prepare(`INSERT INTO life_projects (id,owner_id,domain_key,title,definition_of_done,stage,status,risk_state,visibility,created_at,updated_at)
      VALUES ('p1','woody','business','Loyalty programme','measurable','define','ACTIVE','GREEN','OWNER_ONLY',?,?)`).run(T, T);
    const ins = db.prepare(`INSERT INTO life_tasks (id,owner_id,project_id,domain_key,title,status,execution_mode,visibility,source_type,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    ins.run('t-stuck', 'woody', 'p1', 'business', 'Supplier cost sweep', 'READY', 'AI', 'OWNER_ONLY', 'MANUAL', 'h', T, T);
    ins.run('t-fine', 'woody', 'p1', 'business', 'Quietly working', 'READY', 'AI', 'OWNER_ONLY', 'MANUAL', 'h', T, T);
    dispatchEvent(db, 'e1', 't-stuck', 'j-stuck', 'boxquery', T);
    dispatchEvent(db, 'e2', 't-fine', 'j-fine', 'research', T);
  });
  const jobs = [
    { id: 'j-stuck', type: 'boxquery', status: 'done', updated_at: 1, attempts: 1, max_attempts: 1, result: JSON.stringify({ outcome: 'cant-see', reason: 'no supplier list in the catalog' }) },
    { id: 'j-fine', type: 'research', status: 'running', updated_at: 1, attempts: 1, max_attempts: 1, result: null },
  ];
  withEnv(dbPath, () => {
    const TODAY = require('../mission-control/ui/pages/life/today.js');
    const today = TODAY.render(TODAY.getSection(null, { now: Date.parse(T) }), { now: Date.parse(T), q: bizQ(jobs) });
    assert.match(today.body, /Agents waiting on you/, 'Today carries its own panel');
    assert.match(today.body, /Supplier cost sweep/);
    assert.match(today.body, /Box Query — it asked you a question/);
    assert.match(today.body, /Talk to it/);
    assert.match(today.body, /1 agent is stuck waiting on you/, 'the Rex line counts it');
    assert.ok(!/Quietly working/.test(today.body.split('Agents waiting on you')[1].split('</div></div>')[0] || ''), 'a working agent is not in the stuck panel');

    const tasks = TASKS.render(TASKS.getSection(null, { query: {} }), { q: bizQ(jobs) });
    assert.match(tasks.body, /data-needs-you="1"/, 'the All-tasks row is flagged');
    assert.match(tasks.body, /rgba\(239,107,104,\.10\)/, 'light red, one shared definition');
    assert.match(tasks.body, /Box Query needs you/);
    assert.equal((tasks.body.match(/data-needs-you="1"/g) || []).length, 1, 'ONLY the stuck task is red');

    const drawer = PROJECT.render(PROJECT.getSection(null, { query: { id: 'p1' } }), { q: bizQ(jobs) });
    assert.match(drawer.body, /data-needs-you="1"/);
    assert.match(drawer.body, /1 task waiting on YOU to talk to the agent/);

    const cards = PROJECTS.render(PROJECTS.getSection(null, {}), { q: bizQ(jobs) });
    assert.match(cards.body, /1 task waiting on you to talk to the agent/, 'the project CARD says so without opening it');
  });
  // Once sent back, the red is gone everywhere — the same fixture plus a REOPENED.
  const db2 = new sqlite.DatabaseSync(dbPath);
  db2.prepare(`INSERT INTO life_task_events (id,owner_id,task_id,event_type,actor_type,actor_id,payload_json,created_at)
    VALUES ('e3','woody','t-stuck','REOPENED','HUMAN','woody','{"via":"send_back"}','2026-08-13T13:00:00.000Z')`).run();
  db2.close();
  withEnv(dbPath, () => {
    const tasks2 = TASKS.render(TASKS.getSection(null, { query: {} }), { q: bizQ(jobs) });
    assert.ok(!/data-needs-you="1"/.test(tasks2.body), 'answered = no longer shouting');
    const TODAY = require('../mission-control/ui/pages/life/today.js');
    const today2 = TODAY.render(TODAY.getSection(null, { now: Date.parse(T) }), { now: Date.parse(T), q: bizQ(jobs) });
    assert.ok(!/Agents waiting on you/.test(today2.body));
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the board stops shouting once the owner has answered — and says whether the re-run can happen', () => {
  // LIVE 2026-08-13: an escalated life job stays escalated forever, so the Engine room kept
  // saying "Escalated — needs you" hours after the send-back. The dispatcher now writes an
  // owner-answered job_event (business side — /claw never reads life.db) and the board obeys.
  // ONE job per render: the board shows one card per agent, so a shared fixture would only
  // ever render the highest-ranked bucket and prove nothing about the others.
  const now = Date.parse(T);
  const leadJob = (id, taskId, title) => ({
    id, type: 'lead', status: 'escalated',
    payload: JSON.stringify({ brief: 'x', lifeDispatch: { taskId, title, dispatcher: 'life-dispatcher' } }),
    created_at: now - 7200000, updated_at: now - 3600000, attempts: 1, error: 'gave up', parent_job_id: null, owner_id: null,
  });
  const render = (job, events) => {
    const q = (sql) => {
      const s2 = String(sql);
      if (/FROM jobs WHERE status NOT IN/.test(s2)) return { ok: true, rows: [job] };
      if (/FROM job_events WHERE kind = 'owner-answered'/.test(s2)) return { ok: true, rows: events };
      return { ok: true, rows: [] };
    };
    return AGENTS.render(AGENTS.getSection(null, { q, now, halt: { halted: false } }), { serverRev: '' });
  };
  const blockedCol = (body) => {
    const i = body.indexOf('col blocked');
    const j = body.indexOf('col done', i);
    return i === -1 ? '' : body.slice(i, j === -1 ? body.length : j);
  };

  // 1) NOT answered → still blocked on him. (The guard can fail: this is its red case.)
  const stuck = render(leadJob('j1', 'task-stuck', 'Genuinely stuck task'), []);
  assert.match(blockedCol(stuck.body), /Genuinely stuck task/, 'a real give-up still blocks on you');
  assert.match(stuck.body, /Escalated — needs you/);

  // 2) Answered, AI-routed → out of Blocked, and the promise is keepable.
  const ai = render(leadJob('j2', 'task-ai', 'Answered AI task'),
    [{ job_id: 'j2', kind: 'owner-answered', detail: JSON.stringify({ taskId: 'task-ai', mode: 'AI' }) }]);
  assert.ok(!/Answered AI task/.test(blockedCol(ai.body)), 'an answered give-up leaves the Blocked column');
  assert.match(ai.body, /you sent it back, a fresh run follows/);
  assert.match(ai.body, /↩ answered/);
  assert.ok(!/Escalated — needs you/.test(ai.body), 'and stops claiming he owes anything');

  // 3) Answered but HYBRID → the board says the promised re-run cannot happen.
  const hy = render(leadJob('j3', 'task-hy', 'Answered HYBRID task'),
    [{ job_id: 'j3', kind: 'owner-answered', detail: JSON.stringify({ taskId: 'task-hy', mode: 'HYBRID' }) }]);
  assert.ok(!/Answered HYBRID task/.test(blockedCol(hy.body)));
  assert.match(hy.body, /routed HYBRID and the sweep only takes AI-routed work/);
});
