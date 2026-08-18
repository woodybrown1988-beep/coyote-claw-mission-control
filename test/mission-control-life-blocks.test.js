'use strict';
// OWNER BLOCKS (operator asks 2026-08-18, from the live place-block failure: 15–17 Aug
// cards still offering Place on the 18th, every tap the writer's 409). Pinned here:
//  - a proposal whose slot has PASSED renders the truth + the owner's real choices
//    ("I did this — mark done" / Dismiss) and NEVER a Place/Move button — on Schedule
//    (both views) and on Today;
//  - the owner's "Place your own block" form exists with task picker, date and times, and
//    posts the DIRECT place_block shape (no proposalId);
//  - placed FUTURE blocks are draggable (data-lc-block) with a Move button; passed blocks
//    are neither; week day cards inside the window take drops (data-lc-dropday);
//  - the command lib accepts the two owner-direct shapes and still refuses garbage —
//    remove/swap remain proposal-only.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite = require('node:sqlite');
const SCHEDULE = require('../mission-control/ui/pages/life/schedule.js');
const TODAY = require('../mission-control/ui/pages/life/today.js');
const LIB = require('../mission-control/ui/life-command-lib.js');
const SHARED = require('../mission-control/ui/shared.js');

const NOW = Date.parse('2026-08-10T11:00:00.000Z'); // 12:00 London (BST)
const DAY = '2026-08-10';

function withEnv(dbPath, fn) {
  const prev = process.env.COYOTE_LIFE_DB;
  process.env.COYOTE_LIFE_DB = dbPath;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.COYOTE_LIFE_DB; else process.env.COYOTE_LIFE_DB = prev;
  }
}

/** Calendar mirror + tasks + blocks + proposals — the full write-side fixture. */
function makeFixture(dir, { blocks = [], proposals = [], tasks = [], events = [] } = {}) {
  const p = path.join(dir, 'life.db');
  const db = new sqlite.DatabaseSync(p);
  db.exec(`
    CREATE TABLE life_calendar_events (id TEXT PRIMARY KEY, owner_id TEXT, subject TEXT, start_at TEXT,
      end_at TEXT, timezone TEXT, is_all_day INTEGER DEFAULT 0, location TEXT DEFAULT '', show_as TEXT DEFAULT 'busy',
      categories_json TEXT DEFAULT '[]', is_protected INTEGER DEFAULT 0,
      series_master_id TEXT, calendar_key TEXT NOT NULL DEFAULT 'default', updated_at TEXT);
    CREATE TABLE life_calendar_sync (id INTEGER PRIMARY KEY, delta_link TEXT, window_anchor TEXT,
      last_sync_at TEXT, last_error TEXT, updated_at TEXT);
    CREATE TABLE life_tasks (id TEXT PRIMARY KEY, owner_id TEXT, outcome_id TEXT, project_id TEXT, domain_key TEXT,
      title TEXT, status TEXT, execution_mode TEXT, definition_of_done TEXT DEFAULT '', due_kind TEXT DEFAULT 'NONE',
      due_at TEXT, recurs TEXT, estimate_minutes INTEGER, importance INTEGER DEFAULT 3, consequence INTEGER DEFAULT 3,
      risk_level TEXT, visibility TEXT, source_type TEXT, created_by TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE life_waiting_conditions (id TEXT PRIMARY KEY, task_id TEXT, owner_id TEXT,
      dependency_label TEXT, wake_type TEXT, fallback_at TEXT, state TEXT, created_at TEXT, updated_at TEXT);
    CREATE VIEW v_life_available_work AS
      SELECT t.*, t.importance * 10 AS calculated_priority FROM life_tasks t WHERE t.status IN ('READY','SCHEDULED','IN_PROGRESS');
    CREATE TABLE life_update_proposals (id TEXT PRIMARY KEY, owner_id TEXT, update_id TEXT, task_id TEXT,
      capability_key TEXT, command_type TEXT, command_json TEXT, reason TEXT, confidence REAL,
      risk_level TEXT, authority_class TEXT, state TEXT, created_at TEXT);
    CREATE TABLE life_calendar_blocks (id TEXT PRIMARY KEY, owner_id TEXT, task_id TEXT, proposal_id TEXT,
      graph_event_id TEXT, calendar_id TEXT, title TEXT, start_at TEXT, end_at TEXT, state TEXT,
      created_at TEXT, updated_at TEXT);
  `);
  db.prepare('INSERT INTO life_calendar_sync (id, last_sync_at) VALUES (1, ?)').run(new Date(NOW - 10 * 60_000).toISOString());
  for (const e of events) {
    db.prepare(`INSERT INTO life_calendar_events (id, owner_id, subject, start_at, end_at, is_all_day, show_as, calendar_key)
                VALUES (?, 'woody', ?, ?, ?, ?, ?, 'default')`)
      .run(e.id, e.subject || 'Busy', e.start, e.end, e.allDay ? 1 : 0, e.showAs || 'busy');
  }
  for (const t of tasks) {
    db.prepare(`INSERT INTO life_tasks (id, owner_id, domain_key, title, status, due_kind, due_at, recurs, importance, visibility, created_at, updated_at)
                VALUES (?, 'woody', 'business', ?, 'READY', ?, ?, ?, ?, 'OWNER_ONLY', ?, ?)`)
      .run(t.id, t.title, t.dueKind || 'NONE', t.dueAt || null, t.recurs || null, t.importance ?? 3, new Date(NOW).toISOString(), new Date(NOW).toISOString());
  }
  for (const b of blocks) {
    db.prepare(`INSERT INTO life_calendar_blocks (id, owner_id, task_id, graph_event_id, calendar_id, title, start_at, end_at, state, created_at, updated_at)
                VALUES (?, 'woody', ?, ?, 'CAL-LIFE', ?, ?, ?, 'PLACED', ?, ?)`)
      .run(b.id, b.taskId || 't1', `ev-${b.id}`, b.title, b.start, b.end, new Date(NOW).toISOString(), new Date(NOW).toISOString());
  }
  for (const pr of proposals) {
    db.prepare(`INSERT INTO life_update_proposals (id, owner_id, update_id, task_id, capability_key, command_type,
                command_json, reason, confidence, risk_level, authority_class, state, created_at)
                VALUES (?, 'woody', 'u1', ?, 'calendar_block', ?, ?, ?, 0.7, 'LOW', 'EXTERNAL', 'PROPOSED', ?)`)
      .run(pr.id, pr.taskId || 't1', pr.type, JSON.stringify(pr.command), pr.reason || 'focus block', new Date(NOW).toISOString());
  }
  db.close();
  return p;
}

const cmdsIn = (body) => [...body.matchAll(/data-lc-cmd="([^"]*)"/g)]
  .map((m) => JSON.parse(m[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&#39;', "'")));

/** The ONE shared client script, as the browser receives it (the parse-gate discipline:
 *  only the EMITTED output is the truth — clientScript isn't exported, the shell emits it). */
function emittedScript() {
  const html = String(SHARED.renderShell({ title: 't', sub: '', body: '<div></div>', workspace: 'life', route: '/life/schedule', key: 'k' }));
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, 'no inline script emitted');
  return m[1];
}

test('a slot-passed proposal renders the truth and the mark-done path — never a dead Place button', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-blk-'));
  const dbPath = makeFixture(dir, {
    tasks: [{ id: 't1', title: 'Renew the GitHub tokens' }],
    proposals: [
      { id: 'bp-stale', type: 'place_block', command: { taskId: 't1', planDate: DAY, title: 'MC Setup: tokens', startAt: `${DAY}T07:30:00`, endAt: `${DAY}T09:00:00` } },
      { id: 'bp-live', type: 'place_block', command: { taskId: 't1', planDate: DAY, title: 'Evening pass', startAt: `${DAY}T18:00:00`, endAt: `${DAY}T19:00:00` } },
    ],
  });
  withEnv(dbPath, () => {
    for (const view of ['day', 'week']) {
      const ctx = view === 'week' ? { now: NOW, query: { view: 'week' } } : { now: NOW };
      const body = SCHEDULE.render(SCHEDULE.getSection(null, ctx), ctx).body;
      const cmds = cmdsIn(body);
      assert.ok(!cmds.some((c) => c.command === 'place_block' && c.payload.proposalId === 'bp-stale'),
        `${view}: no Place button on a passed slot`);
      assert.ok(cmds.some((c) => c.command === 'complete' && c.payload.taskId === 't1'),
        `${view}: the owner can say the work actually happened`);
      assert.ok(cmds.some((c) => c.command === 'decide' && c.payload.decision === 'reject' && c.payload.proposalId === 'bp-stale'),
        `${view}: dismiss stays available`);
      assert.match(body, /This slot passed before it was decided/, `${view}: the card says what happened`);
      assert.ok(cmds.some((c) => c.command === 'place_block' && c.payload.proposalId === 'bp-live'),
        `${view}: a future slot still places normally`);
    }
    // Today mirrors the same truth.
    const today = TODAY.render(TODAY.getSection(null, { now: NOW }), { now: NOW }).body;
    const tcmds = cmdsIn(today);
    assert.ok(!tcmds.some((c) => c.command === 'place_block' && c.payload.proposalId === 'bp-stale'), 'Today: no dead Place button');
    assert.ok(tcmds.some((c) => c.command === 'complete' && c.payload.taskId === 't1'), 'Today: mark-done offered');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Place your own block: the form exists, lists open work, and posts the DIRECT shape', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-blk-'));
  const dbPath = makeFixture(dir, { tasks: [{ id: 't9', title: 'New electricity contract' }] });
  withEnv(dbPath, () => {
    const body = SCHEDULE.render(SCHEDULE.getSection(null, { now: NOW }), {}).body;
    assert.match(body, /Place your own block/);
    for (const f of ['bf-task', 'bf-title', 'bf-date', 'bf-start', 'bf-end']) {
      assert.ok(body.includes(`name="${f}"`), `field ${f} present`);
    }
    assert.match(body, /New electricity contract/, 'open work is offered in the picker');
    assert.ok(body.includes('data-lc-blockplace'), 'the submit rides the blockplace handler');
    // The handler itself lives in the ONE shared client script and parses.
    const js = emittedScript();
    assert.ok(js.includes('[data-lc-blockplace]'), 'the form submit handler is in the ONE shared script');
    assert.ok(js.includes('__lcMoveBlock'), 'the shared mover exists');
    assert.ok(js.includes("command:'place_block'"), 'the direct place shape is assembled client-side');
    assert.doesNotThrow(() => new Function(js), 'the emitted shared script parses (mc-client-script-parse-gate)');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('placed FUTURE blocks are draggable with a Move button; passed blocks are neither; week days take drops', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-blk-'));
  const dbPath = makeFixture(dir, {
    blocks: [
      { id: 'b-future', title: 'Focus: costing', start: `${DAY}T15:00:00`, end: `${DAY}T16:00:00` },
      { id: 'b-past', title: 'Focus: morning', start: `${DAY}T08:00:00`, end: `${DAY}T09:00:00` },
    ],
  });
  withEnv(dbPath, () => {
    const ctx = { now: NOW, query: { view: 'week' } };
    const week = SCHEDULE.render(SCHEDULE.getSection(null, ctx), ctx).body;
    const futureBlock = /data-lc-block="[^"]*b-future[^"]*"/.test(week);
    const pastBlock = /data-lc-block="[^"]*b-past[^"]*"/.test(week);
    assert.ok(futureBlock, 'a future block is draggable');
    assert.ok(!pastBlock, 'a passed block is not offered a move');
    assert.ok(/data-lc-blockmove="[^"]*b-future[^"]*"/.test(week), 'the Move button rides the same payload');
    assert.ok(week.includes(`data-lc-dropday="${DAY}"`), 'today takes drops');
    assert.ok(!week.includes('data-lc-dropday=""'), 'no empty drop targets');

    // Day view: the standing block gets the same Move affordance.
    const day = SCHEDULE.render(SCHEDULE.getSection(null, { now: NOW }), {}).body;
    assert.match(day, /Life OS blocks today/);
    assert.ok(/data-lc-blockmove="[^"]*b-future[^"]*"/.test(day), 'day view offers Move on the future block');
    assert.ok(!/data-lc-blockmove="[^"]*b-past[^"]*"/.test(day), 'day view refuses to move the past');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('command lib: owner-direct shapes accepted, garbage refused, remove/swap stay proposal-only', () => {
  const ok = (command, payload) => LIB.validateCommand({ command, idempotencyKey: 'k'.repeat(12), payload });
  // Direct place: task or title with well-formed future-shaped times.
  assert.equal(ok('place_block', { taskId: 't1', startAt: '2026-08-20T10:00:00', endAt: '2026-08-20T11:00:00' }).ok, true);
  assert.equal(ok('place_block', { title: 'Deep work', startAt: '2026-08-20T10:00:00', endAt: '2026-08-20T11:00:00' }).ok, true);
  assert.equal(ok('place_block', { proposalId: 'p1' }).ok, true, 'the proposal path is unchanged');
  assert.equal(ok('place_block', { startAt: '2026-08-20T10:00:00', endAt: '2026-08-20T11:00:00' }).ok, false, 'nameless direct place refused');
  assert.equal(ok('place_block', { taskId: 't1', startAt: '2026-08-20T11:00:00', endAt: '2026-08-20T10:00:00' }).ok, false, 'end before start refused');
  assert.equal(ok('place_block', { taskId: 't1', startAt: 'tomorrow', endAt: 'later' }).ok, false, 'prose times refused');
  // Direct move: blockId + times.
  assert.equal(ok('move_block', { blockId: 'b1', startAt: '2026-08-20T10:00:00', endAt: '2026-08-20T11:00:00' }).ok, true);
  assert.equal(ok('move_block', { blockId: 'b1', startAt: '2026-08-20T10:00', endAt: '2026-08-20T11:00' }).ok, false, 'seconds are part of the shape');
  assert.equal(ok('move_block', { proposalId: 'p1' }).ok, true);
  assert.equal(ok('move_block', { blockId: '', startAt: '2026-08-20T10:00:00', endAt: '2026-08-20T11:00:00' }).ok, false);
  // The two that did NOT relax.
  assert.equal(ok('remove_block', { blockId: 'b1' }).ok, false, 'remove stays proposal-only');
  assert.equal(ok('swap_block', { fromBlockId: 'b1', taskId: 't1', startAt: '2026-08-20T10:00:00', endAt: '2026-08-20T11:00:00' }).ok, false, 'swap stays proposal-only');
});

test('Worth scheduling next: deadlines first (soonest, hard over soft), then importance; blocked/asked work excluded; Schedule prefills', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rec-'));
  const dbPath = makeFixture(dir, {
    tasks: [
      { id: 't-imp', title: 'High importance, no deadline', importance: 5 },
      { id: 't-hard', title: 'Hard deadline Friday', dueKind: 'HARD', dueAt: '2026-08-14T00:00:00', importance: 2 },
      { id: 't-soft', title: 'Soft deadline Friday', dueKind: 'SOFT', dueAt: '2026-08-14T00:00:00', importance: 4 },
      { id: 't-near', title: 'Hard deadline Wednesday', dueKind: 'HARD', dueAt: '2026-08-12T00:00:00', importance: 1 },
      { id: 't-far', title: 'Deadline far away', dueKind: 'HARD', dueAt: '2026-12-01T00:00:00', importance: 3 },
      { id: 't-blocked', title: 'Already holds a block', importance: 5 },
      { id: 't-asked', title: 'Already asked as a proposal', importance: 5 },
    ],
    blocks: [{ id: 'b-held', taskId: 't-blocked', title: 'Held', start: `${DAY}T18:00:00`, end: `${DAY}T19:00:00` }],
    proposals: [{ id: 'bp-open', taskId: 't-asked', type: 'place_block', command: { taskId: 't-asked', startAt: `${DAY}T18:00:00`, endAt: `${DAY}T19:00:00` } }],
  });
  withEnv(dbPath, () => {
    const body = SCHEDULE.render(SCHEDULE.getSection(null, { now: NOW }), {}).body;
    assert.match(body, /Worth scheduling next/);
    // Order: Wed hard → Fri hard → Fri soft → then by priority (importance) with the
    // far deadline treated as ordinary work.
    const order = ['Hard deadline Wednesday', 'Hard deadline Friday', 'Soft deadline Friday', 'High importance, no deadline']
      .map((t) => body.indexOf(t));
    assert.ok(order.every((i) => i >= 0), 'all four expected rows render');
    assert.deepEqual([...order].sort((a, b) => a - b), order, 'deadline-then-importance order holds');
    assert.ok(body.indexOf('High importance, no deadline') < body.indexOf('Deadline far away'),
      'a far-off deadline does not outrank importance');
    // Exclusions: held and already-asked work is not re-recommended.
    assert.ok(!body.includes('data-lc-recfill="{&quot;taskId&quot;:&quot;t-blocked'), 'work holding a future block is excluded');
    assert.ok(!body.includes('&quot;taskId&quot;:&quot;t-asked&quot;'), 'work with an open placement question is excluded');
    // Chips + prefill affordance.
    assert.match(body, /due Fri 14 Aug · hard/, 'the deadline is called out in words');
    assert.ok(body.includes('&quot;taskId&quot;:&quot;t-near&quot;'), 'Schedule prefill carries the task id');
    assert.ok(body.includes('&quot;due&quot;:&quot;2026-08-12&quot;'), 'Schedule prefill carries the due date for the form (operator ask 2026-08-18)');
    const js = emittedScript();
    assert.ok(js.includes('[data-lc-recfill]'), 'the prefill handler is in the ONE shared script');
    assert.doesNotThrow(() => new Function(js), 'script still parses');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('times are single 15-minute dropdowns inside 06:00–22:00 — no native hour/minute dials', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rec-'));
  const dbPath = makeFixture(dir, {});
  withEnv(dbPath, () => {
    const body = SCHEDULE.render(SCHEDULE.getSection(null, { now: NOW }), {}).body;
    assert.ok(/<select name="bf-start"/.test(body), 'start is a select');
    assert.ok(/<select name="bf-end"/.test(body), 'end is a select');
    assert.ok(!/type="time"/.test(body), 'no native time inputs remain');
    for (const t of ['06:00', '07:15', '13:45', '21:45']) assert.ok(body.includes(`<option value="${t}">`), `start offers ${t}`);
    assert.ok(body.includes('<option value="22:00">'), 'end reaches 22:00');
    assert.ok(!body.includes('<option value="22:15">'), 'nothing past quiet hours');
    assert.ok(!body.includes('<option value="05:45">'), 'nothing before 06:00');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('recommendation rows act in place: task link, Done, Later (DATE snooze), Schedule', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rec2-'));
  const dbPath = makeFixture(dir, { tasks: [{ id: 't-act', title: 'Top up the accounts' }] });
  withEnv(dbPath, () => {
    const body = SCHEDULE.render(SCHEDULE.getSection(null, { now: NOW }), {}).body;
    assert.ok(body.includes('href="/life/task?id=t-act"'), 'the title opens the task page');
    assert.ok(/data-lc-complete="t-act"/.test(body), 'Done rides the task-page completion flow');
    assert.ok(!/data-lc-complete="t-act"[^>]*data-lc-recap/.test(body), 'a plain task carries no recapture payload');
    assert.ok(/data-lc-recsnooze="[^"]*t-act[^"]*"/.test(body), 'Later carries the task for the snooze prompt');
    const js = emittedScript();
    assert.ok(js.includes('[data-lc-recsnooze]'), 'the snooze handler is in the ONE shared script');
    assert.ok(js.includes("wakeType:'DATE'"), 'a snooze parks on a DATE wake — the writer tick brings it back');
    assert.doesNotThrow(() => new Function(js), 'script still parses');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a recurring recommendation: Done offers the next date from its own cadence; the row says it repeats', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rec4-'));
  const dbPath = makeFixture(dir, { tasks: [{ id: 't-rec', title: 'Top up HSBC and Pleo accounts', recurs: 'monthly', dueKind: 'TARGET', dueAt: '2026-08-12T00:00:00' }] });
  withEnv(dbPath, () => {
    const body = SCHEDULE.render(SCHEDULE.getSection(null, { now: NOW }), {}).body;
    const m = /data-lc-complete="t-rec" data-lc-recap="([^"]*)"/.exec(body);
    assert.ok(m, 'the recurring Done carries the recapture payload (the live 409 case)');
    const recap = JSON.parse(m[1].replaceAll('&quot;', '"'));
    assert.equal(recap.cadence, 'monthly');
    assert.equal(recap.due, '2026-08-12', 'the next date rolls from the task’s own due date');
    assert.match(body, /repeats · monthly/, 'the row shows its cadence');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the cadence grammar: every-N days/weeks/months/years advance exactly; the setter grammar matches the advancer', () => {
  assert.equal(SHARED.advanceCadence('every 10 days', '2026-08-12'), '2026-08-22');
  assert.equal(SHARED.advanceCadence('every 2 weeks', '2026-08-12'), '2026-08-26');
  assert.equal(SHARED.advanceCadence('every 2 months', '2026-08-12'), '2026-10-12');
  assert.equal(SHARED.advanceCadence('every 1 year', '2026-08-12'), '2027-08-12');
  assert.equal(SHARED.advanceCadence('monthly', '2026-01-31'), '2026-02-28', 'month-end clamps, never spills');
  assert.equal(SHARED.advanceCadence('quarterly', '2026-08-12'), '2026-11-12');
  for (const good of ['monthly', 'weekly', 'daily', 'quarterly', 'yearly', 'annually', 'every 2 weeks', 'every 10 days', 'every 3 months', 'every 1 year', 'fortnightly']) {
    assert.ok(SHARED.RECUR_GRAMMAR_RE.test(good), `grammar accepts "${good}"`);
  }
  for (const bad of ['whenever', 'sometimes', 'every blue moon', 'x weeks']) {
    assert.ok(!SHARED.RECUR_GRAMMAR_RE.test(bad), `grammar refuses "${bad}" — an unparseable cadence must never be stored`);
  }
  const js = emittedScript();
  assert.ok(js.includes('__lcRecurOk'), 'the grammar guard ships in the client');
  assert.ok(js.includes('[data-lc-setrecur]'), 'the Repeats setter handler is in the ONE shared script');
  assert.doesNotThrow(() => new Function(js), 'script still parses');
});

test('command lib: set_recurrence accepts a cadence or null, refuses garbage', () => {
  const ok = (payload) => LIB.validateCommand({ command: 'set_recurrence', idempotencyKey: 'k'.repeat(12), payload });
  assert.equal(ok({ taskId: 't1', cadence: 'every 2 weeks' }).ok, true);
  assert.equal(ok({ taskId: 't1', cadence: null }).ok, true, 'null clears the repeat');
  assert.equal(ok({ taskId: 't1', cadence: '' }).ok, false);
  assert.equal(ok({ taskId: 't1' }).ok, false);
  assert.equal(ok({ cadence: 'monthly' }).ok, false);
});

test('command lib: set_waiting accepts the DATE-wake shape', () => {
  const ok = (payload) => LIB.validateCommand({ command: 'set_waiting', idempotencyKey: 'k'.repeat(12), payload });
  assert.equal(ok({ taskId: 't1', dependencyLabel: 'Snoozed — suggest again 2026-09-01', wakeType: 'DATE', fallbackAt: '2026-09-01T07:00:00.000Z' }).ok, true);
  assert.equal(ok({ taskId: 't1', dependencyLabel: 'x', fallbackAt: '2026-09-01T07:00:00.000Z' }).ok, true, 'wakeType stays optional');
  assert.equal(ok({ taskId: 't1', dependencyLabel: 'x' }).ok, false, 'a snooze with no date is refused — nothing may rot silently');
});

test('a snoozed (WAITING) task leaves the recommendations; a lapsed block says so and its task returns', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rec3-'));
  const dbPath = makeFixture(dir, {
    tasks: [{ id: 't-open', title: 'Still open task' }, { id: 't-lapsed', title: 'Scheduled but not done' }],
    blocks: [{ id: 'b-past-open', taskId: 't-lapsed', title: 'Scheduled but not done', start: `${DAY}T08:00:00`, end: `${DAY}T09:00:00` }],
  });
  const db = new sqlite.DatabaseSync(dbPath);
  db.prepare(`INSERT INTO life_tasks (id, owner_id, domain_key, title, status, visibility, created_at, updated_at)
              VALUES ('t-snoozed', 'woody', 'business', 'Snoozed away', 'WAITING', 'OWNER_ONLY', ?, ?)`)
    .run(new Date(NOW).toISOString(), new Date(NOW).toISOString());
  db.close();
  withEnv(dbPath, () => {
    const body = SCHEDULE.render(SCHEDULE.getSection(null, { now: NOW }), {}).body;
    assert.ok(!body.includes('Snoozed away'), 'a WAITING task is out of the list until its date wakes it');
    assert.ok(body.includes('not done — re-suggested'), 'a passed block with an open task says the truth');
    assert.ok(body.includes('&quot;taskId&quot;:&quot;t-lapsed&quot;'), 'the lapsed task is back in the suggestions — a past block never excludes');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a placed block’s title opens its task on both views; a taskless block links nowhere', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-blk-link-'));
  const dbPath = makeFixture(dir, {
    tasks: [{ id: 't-linked', title: 'Renew the tokens' }],
    blocks: [
      { id: 'b-task', taskId: 't-linked', title: 'Renew the tokens', start: `${DAY}T15:00:00`, end: `${DAY}T16:00:00` },
    ],
  });
  const db = new sqlite.DatabaseSync(dbPath);
  db.prepare(`INSERT INTO life_calendar_blocks (id, owner_id, task_id, graph_event_id, calendar_id, title, start_at, end_at, state, created_at, updated_at)
              VALUES ('b-free', 'woody', NULL, 'ev-free', 'CAL-LIFE', 'Deep <thinking> time', ?, ?, 'PLACED', ?, ?)`)
    .run(`${DAY}T17:00:00`, `${DAY}T18:00:00`, new Date(NOW).toISOString(), new Date(NOW).toISOString());
  db.close();
  withEnv(dbPath, () => {
    const ctx = { now: NOW, query: { view: 'week' } };
    const week = SCHEDULE.render(SCHEDULE.getSection(null, ctx), ctx).body;
    assert.ok(week.includes('href="/life/task?id=t-linked"'), 'week view: the block title opens its task (notes and updates live there)');
    assert.ok(week.includes('Deep &lt;thinking&gt; time'), 'a taskless block renders escaped');
    assert.ok(!/href="\/life\/task\?id="/.test(week), 'no empty task links');
    const day = SCHEDULE.render(SCHEDULE.getSection(null, { now: NOW }), {}).body;
    assert.ok(day.includes('href="/life/task?id=t-linked"'), 'day view: same link on Life OS blocks today');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('busy map: taken intervals per date — timed non-free commitments + standing blocks; nights clip per day; free/all-day never busy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-busy-'));
  const dbPath = makeFixture(dir, {
    events: [
      { id: 'e-am', subject: 'Meeting', start: `${DAY}T07:00:00`, end: `${DAY}T08:30:00` },
      { id: 'e-free', subject: 'Reminder', start: `${DAY}T10:00:00`, end: `${DAY}T11:00:00`, showAs: 'free' },
      { id: 'e-allday', subject: 'Note', start: `${DAY}T00:00:00`, end: `2026-08-11T00:00:00`, allDay: true },
      { id: 'e-night', subject: 'Sleep', start: `${DAY}T22:00:00`, end: `2026-08-11T05:00:00` },
    ],
    blocks: [{ id: 'b-busy', title: 'Focus', start: `${DAY}T15:00:00`, end: `${DAY}T16:00:00` }],
  });
  withEnv(dbPath, () => {
    const s = SCHEDULE.getSection(null, { now: NOW });
    const today = s.busyMap[DAY] || [];
    assert.ok(today.some(([a, b]) => a === 420 && b === 510), 'the 07:00–08:30 commitment is taken (his worked example)');
    assert.ok(today.some(([a, b]) => a === 900 && b === 960), 'a standing Life OS block is taken');
    assert.ok(today.some(([a, b]) => a === 1320 && b === 1440), 'the night clips to 22:00–24:00 on its first day');
    assert.ok((s.busyMap['2026-08-11'] || []).some(([a, b]) => a === 0 && b === 300), '…and 00:00–05:00 on its second');
    assert.ok(!today.some(([a, b]) => a === 600), 'a free-marked event is never taken');
    const body = SCHEDULE.render(s, {}).body;
    assert.ok(body.includes('data-bf-busy='), 'the form carries the map');
    assert.match(body, /times already taken grey out/, 'the affordance is named to the owner');
    const js = emittedScript();
    assert.ok(js.includes('data-bf-busy'), 'the greyer is in the ONE shared script');
    assert.ok(js.includes("' — busy'"), 'taken options say why they are off');
    assert.doesNotThrow(() => new Function(js), 'script still parses');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('updates are not felt: the periodic refresh swaps <main> in place; action reloads restore scroll', () => {
  const js = emittedScript();
  // The periodic path is a background fetch + in-place swap, never a jolt.
  assert.ok(js.includes("querySelector('main.main')"), 'the refresh swaps the content region in place');
  assert.ok(js.includes('__lcInitContent(om)'), 'swapped-in content re-arms its initialisers');
  assert.ok(js.includes('__lcDragging'), 'a drag in flight holds the refresh');
  // Every ACTION reload goes through the scroll-preserving helper — exactly one raw
  // location.reload() may exist: the helper's own definition.
  assert.equal((js.match(/location\.reload\(\)/g) || []).length, 1, 'one raw reload — the __lcReload definition');
  assert.ok(js.includes("sessionStorage.setItem('lcScroll:'"), 'scroll is remembered before a hard reload');
  assert.ok(js.includes("sessionStorage.getItem("), 'and restored on the way back in');
  assert.doesNotThrow(() => new Function(js), 'script still parses');
});

test('the refusal copy translates the writer’s stale sentence into the owner’s words', () => {
  const copy = emittedScript();
  assert.ok(copy.includes('already passed'), 'the stale key is in the client copy table');
  assert.ok(copy.includes('mark the task done'), 'the copy names the I-did-this path');
});
