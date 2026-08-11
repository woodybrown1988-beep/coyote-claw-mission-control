'use strict';
// LIFE OS — SCHEDULE + TODAY'S MY-DAY RAIL on the Outlook mirror (Graph Stage B, operator
// GO 2026-08-10). Pins the ruled honesty laws on the MC read side:
//  - real events render on Schedule and on Today's rail, chronologically, escaped;
//  - a staleness caption rides EVERY populated render (fresh names its age, stale says
//    stale, a failed refresh is named while the last good picture stays visible);
//  - no mirror / no completed sync = the honest not-connected state on both pages;
//  - no free time is computed or implied anywhere (no "free at", no availability grid);
//  - protected events surface as focus candidates;
//  - the "Sync now" affordance carries only the allowlisted calendar_sync command.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite = require('node:sqlite');
const SCHEDULE = require('../mission-control/ui/pages/life/schedule.js');
const TODAY = require('../mission-control/ui/pages/life/today.js');

// Fixed clock: noon London on a BST day; events live on this London date.
const NOW = Date.parse('2026-08-10T11:00:00.000Z'); // 12:00 London
const DAY = '2026-08-10';

function withEnv(dbPath, fn) {
  const prev = process.env.COYOTE_LIFE_DB;
  process.env.COYOTE_LIFE_DB = dbPath;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.COYOTE_LIFE_DB; else process.env.COYOTE_LIFE_DB = prev;
  }
}

/** Minimal fixture: the calendar mirror tables + just enough task schema for Today. */
function makeFixture(dir, { syncRow, events } = {}) {
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
    CREATE TABLE life_daily_plans (id TEXT PRIMARY KEY, owner_id TEXT, plan_date TEXT, must_win_task_id TEXT,
      support_task_1_id TEXT, support_task_2_id TEXT, decision_task_ids_json TEXT DEFAULT '[]',
      alternative_task_ids_json TEXT DEFAULT '[]', compilation_evidence_json TEXT DEFAULT '{}',
      status TEXT, approved_by TEXT, approved_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE life_update_proposals (id TEXT PRIMARY KEY, owner_id TEXT, update_id TEXT, task_id TEXT,
      capability_key TEXT, command_type TEXT, command_json TEXT, reason TEXT, evidence_refs_json TEXT DEFAULT '[]',
      confidence REAL, risk_level TEXT, authority_class TEXT, state TEXT, decided_by TEXT, decision_note TEXT,
      decided_at TEXT, applied_event_id TEXT, created_at TEXT);
    CREATE TABLE life_task_events (id TEXT PRIMARY KEY, owner_id TEXT, task_id TEXT, event_type TEXT, actor_type TEXT,
      actor_id TEXT, from_state TEXT, to_state TEXT, payload_json TEXT DEFAULT '{}', idempotency_key TEXT, created_at TEXT);
    CREATE TABLE life_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
    CREATE TABLE life_outcomes (id TEXT PRIMARY KEY, owner_id TEXT, domain_key TEXT, title TEXT,
      proof_definition TEXT, status TEXT, target_date TEXT, priority INTEGER, visibility TEXT,
      created_at TEXT, updated_at TEXT);
  `);
  if (syncRow) {
    db.prepare('INSERT INTO life_calendar_sync (id, delta_link, window_anchor, last_sync_at, last_error, updated_at) VALUES (1, ?, ?, ?, ?, ?)')
      .run(syncRow.deltaLink ?? 'dl', DAY, syncRow.lastSyncAt ?? null, syncRow.lastError ?? null, new Date(NOW).toISOString());
  }
  for (const e of events || []) {
    db.prepare(`INSERT INTO life_calendar_events (id, owner_id, subject, start_at, end_at, timezone, is_all_day, location, show_as, categories_json, is_protected, calendar_key, updated_at)
                VALUES (?, 'woody', ?, ?, ?, 'Europe/London', ?, ?, ?, '[]', ?, ?, ?)`)
      .run(e.id, e.subject, e.start, e.end, e.allDay ? 1 : 0, e.location || '', e.showAs || 'busy', e.protected ? 1 : 0, e.calendarKey || 'default', new Date(NOW).toISOString());
  }
  db.close();
  return p;
}

const EVENTS = [
  { id: 'e1', subject: 'Dentist <root canal>', start: `${DAY}T09:00:00`, end: `${DAY}T10:00:00`, location: 'High St' },
  { id: 'e2', subject: 'Deep work: menu costing', start: `${DAY}T14:00:00`, end: `${DAY}T16:00:00`, protected: true },
  { id: 'e3', subject: 'Hold: maybe gym', start: `${DAY}T18:00:00`, end: `${DAY}T19:00:00`, showAs: 'free' },
  { id: 'e4', subject: 'Meg birthday', start: `${DAY}T00:00:00`, end: `${DAY}T23:59:00`, allDay: true },
];

// POSITIVE free-time claims only — the pages legitimately NAME the law in negated form
// ("no free time is guessed at"), which must not trip the wire.
const FREE_TIME_RE = /free (at|from|between|until)\b|you are free|you're free|\bavailability\b|free slot|open slot/i;
const visibleText = (body) => body.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/data-lc-[a-z-]+="[^"]*"/g, '');

test('Schedule FRESH: real events chronological + escaped, focus candidate flagged, staleness caption present, no free time', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-cal-'));
  const dbPath = makeFixture(dir, { syncRow: { lastSyncAt: new Date(NOW - 10 * 60_000).toISOString() }, events: EVENTS });
  withEnv(dbPath, () => {
    const out = SCHEDULE.render(SCHEDULE.getSection(null, { now: NOW }), {});
    const body = out.body;
    assert.match(body, /Fresh · 10 min ago/, 'the staleness caption names its age even when fresh');
    assert.match(body, /09:00.*10:00.*Dentist/s, 'a real event renders with its times');
    assert.ok(body.includes('Dentist &lt;root canal&gt;'), 'subjects escape — calendar titles are personal content');
    assert.ok(!body.includes('<root canal>'), 'never raw');
    assert.ok(body.indexOf('Dentist') < body.indexOf('Deep work'), 'chronological order');
    assert.match(body, /Focus candidate/, 'a protected event is a focus candidate');
    assert.match(body, /All day: Meg birthday/, 'an all-day event is context, not committed hours');
    assert.match(body, /Today&#39;s commitments/, 'commitment tile renders (label HTML-escaped)');
    assert.match(body, />2</, 'commitments count excludes the show-as-free hold and the all-day marker');
    assert.ok(!FREE_TIME_RE.test(visibleText(body)), 'no invented free time anywhere');
    assert.match(body, /calendar_sync/, 'Sync now carries the allowlisted command');
    assert.match(body, /Outlook is canonical/i, 'the canon line renders');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Schedule STALE + failed refresh: stale is named, never dressed as fresh, old rows stay visible', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-cal-'));
  const dbPath = makeFixture(dir, {
    syncRow: { lastSyncAt: new Date(NOW - 3 * 3_600_000).toISOString(), lastError: 'Graph delta → 500' },
    events: EVENTS,
  });
  withEnv(dbPath, () => {
    const body = SCHEDULE.render(SCHEDULE.getSection(null, { now: NOW }), {}).body;
    assert.match(body, /Stale · 3h 0m ago/, 'the pill says stale with the age');
    assert.match(body, /latest refresh failed/, 'the failure is named');
    assert.match(body, /Outlook itself is the truth right now/, 'authority handed back to Outlook');
    assert.ok(!/Fresh ·/.test(body), 'stale is never dressed as fresh');
    assert.match(body, /Dentist/, 'the last good picture stays visible under failure');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Schedule honest not-connected: no mirror table, no row, and a never-completed first sync all say so', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-cal-'));
  // 1) sync row exists but no successful sync yet (first look failed).
  const dbPath = makeFixture(dir, { syncRow: { lastSyncAt: null, lastError: 'boom' } });
  withEnv(dbPath, () => {
    const body = SCHEDULE.render(SCHEDULE.getSection(null, { now: NOW }), {}).body;
    assert.match(body, /Outlook is not connected/);
    assert.match(body, /first look at Outlook hasn't completed/, 'a failed first sync is named, not simulated');
    assert.ok(!/\d{2}:\d{2}/.test(visibleText(body)), 'no times invented');
  });
  fs.rmSync(dir, { recursive: true, force: true });
  // 2) no life.db at all.
  withEnv(path.join(os.tmpdir(), 'nonexistent-cal-dir', 'life.db'), () => {
    const body = SCHEDULE.render(SCHEDULE.getSection(null, { now: NOW }), {}).body;
    assert.match(body, /Outlook is not connected/);
  });
});

test("Today's My-day rail: real commitments + staleness caption; stale flips the caption; no sync = the old honest rail", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-cal-'));
  const dbPath = makeFixture(dir, { syncRow: { lastSyncAt: new Date(NOW - 5 * 60_000).toISOString() }, events: EVENTS });
  withEnv(dbPath, () => {
    const body = TODAY.render(TODAY.getSection(null, { now: NOW }), { now: NOW }).body;
    assert.match(body, /My day/);
    assert.match(body, /09:00.*Dentist/s, 'the rail lists the real morning commitment');
    assert.match(body, /Matched to Outlook 5 min ago/, 'staleness caption in every render');
    assert.match(body, /All day: Meg birthday/);
    assert.ok(!body.includes('Hold: maybe gym'), 'show-as-free events are not commitments');
    assert.ok(!FREE_TIME_RE.test(visibleText(body)), 'the rail never invents free time');
    assert.match(body, /href="\/life\/schedule"/, 'links to the full schedule');
    assert.ok(!/Outlook is not connected/.test(body), 'connected rail replaces the gate copy');
  });
  fs.rmSync(dir, { recursive: true, force: true });

  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-cal-'));
  const stalePath = makeFixture(dir2, { syncRow: { lastSyncAt: new Date(NOW - 26 * 3_600_000).toISOString() }, events: EVENTS });
  withEnv(stalePath, () => {
    const body = TODAY.render(TODAY.getSection(null, { now: NOW }), { now: NOW }).body;
    assert.match(body, /treat this as stale; Outlook is the truth/, 'a broken poll is named on the rail');
  });
  fs.rmSync(dir2, { recursive: true, force: true });

  const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-cal-'));
  const nonePath = makeFixture(dir3, {}); // tables exist, no sync row ever
  withEnv(nonePath, () => {
    const body = TODAY.render(TODAY.getSection(null, { now: NOW }), { now: NOW }).body;
    assert.match(body, /Outlook is not connected/, 'no sync row → the honest not-connected rail');
  });
  fs.rmSync(dir3, { recursive: true, force: true });
});

test('Stage W surfaces: block proposals on Schedule + Today ride their OWN verbs; Life OS pill; reject stays a plain decide', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-cal-'));
  const dbPath = makeFixture(dir, {
    syncRow: { lastSyncAt: new Date(NOW - 10 * 60_000).toISOString() },
    events: [...EVENTS, { id: 'blk1', subject: 'Focus: costing', start: `${DAY}T13:00:00`, end: `${DAY}T14:00:00`, calendarKey: 'life' }],
  });
  const db = new sqlite.DatabaseSync(dbPath);
  db.prepare(`INSERT INTO life_update_proposals (id, owner_id, update_id, task_id, capability_key, command_type, command_json, reason, confidence, risk_level, authority_class, state, created_at)
              VALUES ('bp1','woody','u1','t1','calendar_block','place_block', ?, 'must-win focus block — avoids your fixed commitments', 0.75, 'LOW', 'EXTERNAL', 'PROPOSED', ?)`)
    .run(JSON.stringify({ taskId: 't1', planDate: DAY, title: 'Focus: draft criteria', startAt: `${DAY}T10:15:00`, endAt: `${DAY}T11:45:00` }), new Date(NOW).toISOString());
  db.close();
  withEnv(dbPath, () => {
    const sched = SCHEDULE.render(SCHEDULE.getSection(null, { now: NOW }), {}).body;
    const cmds = [...sched.matchAll(/data-lc-cmd="([^"]*)"/g)]
      .map((m) => JSON.parse(m[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&#39;', "'")));
    assert.ok(cmds.some((c) => c.command === 'place_block' && c.payload.proposalId === 'bp1'), 'accept rides place_block, never a generic decide-accept');
    assert.ok(!cmds.some((c) => c.command === 'decide' && c.payload.decision === 'accept'), 'no generic accept exists for a calendar proposal');
    assert.ok(cmds.some((c) => c.command === 'decide' && c.payload.decision === 'reject' && c.payload.proposalId === 'bp1'), 'No = a plain reject — Outlook untouched');
    assert.match(sched, /10:15–11:45/, 'the proposal shows its times');
    assert.match(sched, /Life OS<\/span>/, 'a mirrored block carries the Life OS pill');
    assert.match(sched, /only ever into the Life OS calendar/, 'the write cage is named to the owner');
    assert.match(sched, />1<\/div>/, 'the uncommitted-proposals tile counts the real open proposal');
    const today = TODAY.render(TODAY.getSection(null, { now: NOW }), { now: NOW }).body;
    const tcmds = [...today.matchAll(/data-lc-cmd="([^"]*)"/g)]
      .map((m) => JSON.parse(m[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&#39;', "'")));
    assert.ok(tcmds.some((c) => c.command === 'place_block' && c.payload.proposalId === 'bp1'), 'Today routes the accept through place_block too');
    assert.match(today, /Accept places it in Outlook; No leaves Outlook untouched/, 'the consequence is written on the row');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('owner language: populated calendar surfaces carry no engineering vocabulary', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-cal-'));
  const dbPath = makeFixture(dir, { syncRow: { lastSyncAt: new Date(NOW - 10 * 60_000).toISOString() }, events: EVENTS });
  withEnv(dbPath, () => {
    for (const page of [SCHEDULE, TODAY]) {
      const body = page.render(page.getSection(null, { now: NOW }), { now: NOW }).body;
      const visible = visibleText(body);
      assert.ok(!/(PR\s?#?\d+|\bschema\b|DB-enforced|engine PR|\bPhase\b|\bStage B\b|sole writer|life\.db|\bGraph\b|\bdelta\b|\bmirror table\b)/i.test(visible),
        `${page.key} speaks owner, never engineer`);
    }
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── WEEK VIEW (operator ask 2026-08-11) ──────────────────────────────────────
// The week inherits every honesty law the day view lives by and softens none of them. Pinned
// here: the day view is untouched unless ?view=week is asked for; commitments and Life OS
// blocks render side by side per day; an event running in from the previous day appears on
// both days (the `LIKE 'day%'` trap a week is exactly where you find); navigation is bounded
// by what has actually been read and SAYS so at the edge; proposals land on their target day
// and keep their own per-block verbs; and NO GRID — the free-time tripwire holds across
// seven days, which is the surface most likely to imply bookable time.

/** The week fixture adds the block registry — a placed block is read from Life OS's own
 *  record, not inferred from the mirror. */
function makeWeekFixture(dir, { events, blocks, proposals, lastSyncAt } = {}) {
  const p = makeFixture(dir, { syncRow: { lastSyncAt: lastSyncAt ?? new Date(NOW - 10 * 60_000).toISOString() }, events });
  const db = new sqlite.DatabaseSync(p);
  db.exec(`CREATE TABLE life_calendar_blocks (id TEXT PRIMARY KEY, owner_id TEXT, task_id TEXT, proposal_id TEXT,
    graph_event_id TEXT, calendar_id TEXT, title TEXT, start_at TEXT, end_at TEXT, state TEXT,
    created_at TEXT, updated_at TEXT);`);
  for (const b of blocks || []) {
    db.prepare(`INSERT INTO life_calendar_blocks (id, owner_id, task_id, graph_event_id, calendar_id, title, start_at, end_at, state, created_at, updated_at)
                VALUES (?, 'woody', ?, ?, 'CAL-LIFE', ?, ?, ?, ?, ?, ?)`)
      .run(b.id, b.taskId || 't1', b.eventId || `ev-${b.id}`, b.title, b.start, b.end, b.state || 'PLACED', new Date(NOW).toISOString(), new Date(NOW).toISOString());
  }
  for (const pr of proposals || []) {
    db.prepare(`INSERT INTO life_update_proposals (id, owner_id, update_id, task_id, capability_key, command_type,
                command_json, reason, confidence, risk_level, authority_class, state, created_at)
                VALUES (?, 'woody', 'u1', 't1', 'calendar_block', ?, ?, ?, 0.7, 'LOW', 'EXTERNAL', 'PROPOSED', ?)`)
      .run(pr.id, pr.type, JSON.stringify(pr.command), pr.reason, new Date(NOW).toISOString());
  }
  db.close();
  return p;
}
const weekOut = (dbPath, query) => withEnv(dbPath, () => {
  const ctx = { now: NOW, query: { view: 'week', ...(query || {}) } };
  return SCHEDULE.render(SCHEDULE.getSection(null, ctx), ctx);
});

test('week: seven rolling days from today, commitments and Life OS blocks side by side, same staleness caption', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-week-'));
  const dbPath = makeWeekFixture(dir, {
    events: [
      ...EVENTS,
      { id: 'w1', subject: 'Supplier review', start: '2026-08-13T11:00:00', end: '2026-08-13T12:00:00' },
    ],
    blocks: [{ id: 'b1', title: 'Focus: menu costing', start: '2026-08-13T14:00:00', end: '2026-08-13T15:30:00', eventId: 'blockev1' }],
  });
  const out = weekOut(dbPath);
  const v = visibleText(out.body);

  assert.match(v, /The next seven days/);
  assert.match(v, /2026-08-10 to 2026-08-16/, 'the window is today + 6, stated');
  assert.match(v, /Supplier review/, 'a commitment three days out renders');
  assert.match(v, /Focus: menu costing/, 'and the Life OS block beside it');
  assert.match(v, /Life OS/, 'the block is marked as ours, not as an Outlook commitment');
  // The SAME staleness sentence as the day view — one voice, not seven.
  assert.match(v, /Fresh — matched to Outlook 10 min ago\./);
  assert.ok(!FREE_TIME_RE.test(v), 'a week of days still offers no free time');
  assert.ok(!/&lt;style|<table/i.test(''), 'sanity');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('week: an event running in from the day BEFORE appears on both days — the prefix-match trap', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-week-spill-'));
  // Starts the day before the window opens and runs into it.
  const dbPath = makeWeekFixture(dir, {
    events: [{ id: 'ov', subject: 'Overnight stocktake', start: '2026-08-09T22:00:00', end: '2026-08-10T03:00:00' }],
  });
  const v = visibleText(weekOut(dbPath).body);
  assert.match(v, /Overnight stocktake/, 'an event that starts before the window still covers a day inside it');
  // …and it says which way it runs, so last night's 22:00–05:00 can never be mistaken for
  // tonight's. Both render on the same day otherwise, as two identical-looking rows.
  assert.match(v, /carried over from Sun 9 Aug/);
  assert.ok(!/22:00–05:00/.test(v), 'a spilled-in event does not claim a start time it did not have today');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('week: an event running OUT into the next day says so on the day it starts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-week-spillout-'));
  const dbPath = makeWeekFixture(dir, {
    events: [{ id: 'ov2', subject: 'Night shift', start: '2026-08-12T22:00:00', end: '2026-08-13T05:00:00' }],
  });
  const v = visibleText(weekOut(dbPath).body);
  assert.match(v, /runs into Thu 13 Aug/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('week: the day view is UNCHANGED unless ?view=week is asked for', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-week-default-'));
  const dbPath = makeWeekFixture(dir, { events: EVENTS });
  const plain = withEnv(dbPath, () => SCHEDULE.render(SCHEDULE.getSection(null, { now: NOW }), {}));
  assert.match(visibleText(plain.body), /Today from Outlook/, 'the page still opens on the day');
  assert.ok(!/The next seven days/.test(visibleText(plain.body)), 'the week is opt-in');
  // …and an unparseable start is ignored rather than erroring the page.
  const junk = weekOut(dbPath, { start: 'not-a-date' });
  assert.match(visibleText(junk.body), /2026-08-10 to 2026-08-16/, 'a junk date falls back to today, never a broken page');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('week: navigation moves 7 days at a time and is BOUNDED by what has been read — the edge says so', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-week-nav-'));
  const dbPath = makeWeekFixture(dir, { events: EVENTS });

  const fwd = weekOut(dbPath, { start: '2026-08-17' });
  assert.match(visibleText(fwd.body), /2026-08-17 to 2026-08-23/);
  assert.match(fwd.body, /start=2026-08-24/, 'next steps a full week');
  assert.match(fwd.body, /start=2026-08-10/, 'and back a full week');

  // Past the guaranteed forward horizon: clamped, and the clamp is NAMED.
  const far = weekOut(dbPath, { start: '2027-06-01' });
  const fv = visibleText(far.body);
  assert.match(fv, /moved to the furthest week the calendar has actually been read for/);
  assert.match(fv, /as far forward as the calendar has been read/);
  assert.match(fv, /aren’t empty — they’re unknown/, 'unknown is not dressed as empty');

  const back = weekOut(dbPath, { start: '2020-01-01' });
  assert.match(visibleText(back.body), /as far back as the mirror is kept/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('week: proposals render on their TARGET day and keep their own per-block verbs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-week-prop-'));
  const dbPath = makeWeekFixture(dir, {
    events: EVENTS,
    blocks: [{ id: 'b9', title: 'Focus: forecast', start: '2026-08-12T10:00:00', end: '2026-08-12T11:30:00', eventId: 'bev9' }],
    proposals: [
      { id: 'p1', type: 'place_block', reason: 'must-win focus block', command: { taskId: 't1', planDate: '2026-08-11', title: 'Focus: VAT', startAt: '2026-08-11T09:00:00', endAt: '2026-08-11T10:30:00' } },
      { id: 'p2', type: 'move_block', reason: '"Bank call" now sits on your "Rebuild the forecast" block', command: { blockId: 'b9', startAt: '2026-08-12T11:30:00', endAt: '2026-08-12T13:00:00', title: 'Focus: forecast' } },
      { id: 'p3', type: 'remove_block', reason: 'the task closed but its block still stands', command: { blockId: 'b9' } },
    ],
  });
  const out = weekOut(dbPath);
  const v = visibleText(out.body);

  assert.match(v, /Focus: VAT/, 'a placement shows on the day it would take');
  assert.match(v, /now sits on your/, 'a collision states its reason');
  // Each verb names its own consequence — never a bare "accept", never the wrong verb.
  // data-lc-cmd payloads are HTML-escaped into the attribute, so match the emitted form.
  const cmdOf = (name) => new RegExp(`&quot;command&quot;:&quot;${name}&quot;`);
  assert.match(out.body, cmdOf('place_block'));
  assert.match(out.body, cmdOf('move_block'));
  assert.match(out.body, cmdOf('remove_block'));
  assert.match(v, /Move block/);
  assert.match(v, /Remove block/);
  // A removal names only a block, so its day comes from the block itself — not guessed.
  assert.ok(!/Waiting on you, outside this week[\s\S]{0,400}Remove a standing block/.test(v),
    'a removal whose block is inside the week is shown against that day, not in the leftovers');
  // Rejecting is still a plain decide, on every verb.
  assert.match(out.body, cmdOf('decide'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('week: stale is stale across all seven days, and no list is silently truncated', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-week-stale-'));
  const dbPath = makeWeekFixture(dir, { events: EVENTS, lastSyncAt: new Date(NOW - 5 * 3_600_000).toISOString() });
  const v = visibleText(weekOut(dbPath).body);
  assert.match(v, /Stale — last good look at Outlook was 5h 0m ago/);
  assert.match(v, /Outlook itself is the truth right now/);
  assert.ok(!FREE_TIME_RE.test(v));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('week: a day with nothing on it says so — and never as an invitation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-week-empty-'));
  const dbPath = makeWeekFixture(dir, { events: [] });
  const v = visibleText(weekOut(dbPath).body);
  assert.match(v, /Nothing in the calendar\./);
  assert.ok(!FREE_TIME_RE.test(v), 'an empty week is the highest-risk surface for implying bookable time');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── REGRESSIONS from the adversarial review (2026-08-11) ─────────────────────

test('RED: the proposals tile states the TRUE total, not the number that fitted on the page', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-week-cap-'));
  const many = Array.from({ length: 45 }, (_, i) => ({
    id: `p${i}`, type: 'place_block', reason: 'must-win focus block',
    command: { taskId: 't1', planDate: '2026-08-12', title: `Focus ${i}`, startAt: '2026-08-12T09:00:00', endAt: '2026-08-12T10:00:00' },
  }));
  const dbPath = makeWeekFixture(dir, { events: EVENTS, proposals: many });
  for (const out of [weekOut(dbPath), withEnv(dbPath, () => SCHEDULE.render(SCHEDULE.getSection(null, { now: NOW }), {}))]) {
    const v = visibleText(out.body);
    assert.match(v, /Showing 40 of 45 open calendar questions/, 'the list states its total');
    assert.ok(!/>40<\/div><div class="r-kpi-sub">never shown as booked time/.test(out.body),
      'and the tile does not contradict it two lines above');
    assert.match(out.body, />45<\/div><div class="r-kpi-sub">never shown as booked time/, 'the tile states the real total');
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('RED: a placed block is counted ONCE — as a block, not also as a commitment', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-week-dbl-'));
  // placeBlock mirrors its own event into the calendar, so the mirror row is present and
  // busy-marked exactly as it is in life.
  const dbPath = makeWeekFixture(dir, {
    events: [{ id: 'blockev1', subject: 'Focus: menu costing', start: '2026-08-13T14:00:00', end: '2026-08-13T15:30:00', calendarKey: 'life' }],
    blocks: [{ id: 'b1', title: 'Focus: menu costing', start: '2026-08-13T14:00:00', end: '2026-08-13T15:30:00', eventId: 'blockev1' }],
  });
  const v = visibleText(weekOut(dbPath).body);
  assert.match(v, /0 commitments · 1 block/, 'one block, zero commitments — the count reconciles against the list');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('RED: a long reason is trimmed VISIBLY — a swap must not lose the second priority silently', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-week-reason-'));
  const long = 'A'.repeat(380) + ' (priority 31) holds 2026-08-12 at 10:00 — swap them into that slot?';
  const dbPath = makeWeekFixture(dir, {
    events: EVENTS,
    blocks: [{ id: 'bx', title: 'Focus', start: '2026-08-12T10:00:00', end: '2026-08-12T11:00:00', eventId: 'bevx' }],
    proposals: [{ id: 'ps', type: 'swap_block', reason: long, command: { fromBlockId: 'bx', taskId: 't2', title: 'File the VAT return', startAt: '2026-08-12T10:00:00', endAt: '2026-08-12T11:00:00' } }],
  });
  const v = visibleText(weekOut(dbPath).body);
  assert.match(v, /…/, 'the cut is marked, so a truncated number never reads as a finished sentence');
  assert.match(v, /Swap the slot/, 'and the button names the verb it actually dispatches');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('RED: a BACKWARD clamp is described in backward words', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-week-back-'));
  const dbPath = makeWeekFixture(dir, { events: EVENTS });
  const back = visibleText(weekOut(dbPath, { start: '2020-01-01' }).body);
  assert.match(back, /moved to the earliest week the mirror still keeps/);
  assert.ok(!/furthest week the calendar has actually been read/.test(back),
    'days that were read and then let go must not be described as never looked at');
  const fwd = visibleText(weekOut(dbPath, { start: '2027-06-01' }).body);
  assert.match(fwd, /moved to the furthest week the calendar has actually been read for/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('RED: Today renders every calendar verb with its own words and its own button', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-today-verbs-'));
  const dbPath = makeWeekFixture(dir, {
    events: EVENTS,
    blocks: [{ id: 'bt', title: 'Focus', start: '2026-08-12T10:00:00', end: '2026-08-12T11:00:00', eventId: 'bevt' }],
    proposals: [
      { id: 'pm', type: 'move_block', reason: '"Bank call" (10:30–11:00) now sits on your "Rebuild the forecast" block.', command: { blockId: 'bt', startAt: '2026-08-12T11:00:00', endAt: '2026-08-12T12:00:00' } },
      { id: 'pw', type: 'swap_block', reason: '"File the VAT return" (priority 61) has no time held, while "Tidy the drive" (priority 31) holds it.', command: { fromBlockId: 'bt', taskId: 't2', title: 'File the VAT return', startAt: '2026-08-12T10:00:00', endAt: '2026-08-12T11:00:00' } },
    ],
  });
  const out = withEnv(dbPath, () => TODAY.render(TODAY.getSection(null, { now: NOW }), { now: NOW }));
  const v = visibleText(out.body);
  assert.match(v, /Move block/);
  assert.match(v, /Swap the slot/);
  assert.match(v, /now sits on your/, 'the engine’s reason is shown, not replaced by boilerplate');
  assert.match(v, /priority 61.*priority 31|priority 31/, 'a swap still states both priorities on Today');
  assert.ok(!/The task closed but its focus block still stands/.test(v),
    'a move or a swap is never described as a closed task');
  fs.rmSync(dir, { recursive: true, force: true });
});
