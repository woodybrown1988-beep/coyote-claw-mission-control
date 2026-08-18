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
function makeFixture(dir, { blocks = [], proposals = [], tasks = [] } = {}) {
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
      due_at TEXT, estimate_minutes INTEGER, importance INTEGER DEFAULT 3, consequence INTEGER DEFAULT 3,
      risk_level TEXT, visibility TEXT, source_type TEXT, created_by TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE life_waiting_conditions (id TEXT PRIMARY KEY, task_id TEXT, owner_id TEXT,
      dependency_label TEXT, wake_type TEXT, fallback_at TEXT, state TEXT, created_at TEXT, updated_at TEXT);
    CREATE VIEW v_life_available_work AS
      SELECT t.*, 0 AS calculated_priority FROM life_tasks t WHERE t.status IN ('READY','SCHEDULED','IN_PROGRESS');
    CREATE TABLE life_update_proposals (id TEXT PRIMARY KEY, owner_id TEXT, update_id TEXT, task_id TEXT,
      capability_key TEXT, command_type TEXT, command_json TEXT, reason TEXT, confidence REAL,
      risk_level TEXT, authority_class TEXT, state TEXT, created_at TEXT);
    CREATE TABLE life_calendar_blocks (id TEXT PRIMARY KEY, owner_id TEXT, task_id TEXT, proposal_id TEXT,
      graph_event_id TEXT, calendar_id TEXT, title TEXT, start_at TEXT, end_at TEXT, state TEXT,
      created_at TEXT, updated_at TEXT);
  `);
  db.prepare('INSERT INTO life_calendar_sync (id, last_sync_at) VALUES (1, ?)').run(new Date(NOW - 10 * 60_000).toISOString());
  for (const t of tasks) {
    db.prepare(`INSERT INTO life_tasks (id, owner_id, domain_key, title, status, visibility, created_at, updated_at)
                VALUES (?, 'woody', 'business', ?, 'READY', 'OWNER_ONLY', ?, ?)`)
      .run(t.id, t.title, new Date(NOW).toISOString(), new Date(NOW).toISOString());
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

test('the refusal copy translates the writer’s stale sentence into the owner’s words', () => {
  const copy = emittedScript();
  assert.ok(copy.includes('already passed'), 'the stale key is in the client copy table');
  assert.ok(copy.includes('mark the task done'), 'the copy names the I-did-this path');
});
