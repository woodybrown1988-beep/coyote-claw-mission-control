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
      categories_json TEXT DEFAULT '[]', is_protected INTEGER DEFAULT 0, updated_at TEXT);
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
    db.prepare(`INSERT INTO life_calendar_events (id, owner_id, subject, start_at, end_at, timezone, is_all_day, location, show_as, categories_json, is_protected, updated_at)
                VALUES (?, 'woody', ?, ?, ?, 'Europe/London', ?, ?, ?, '[]', ?, ?)`)
      .run(e.id, e.subject, e.start, e.end, e.allDay ? 1 : 0, e.location || '', e.showAs || 'busy', e.protected ? 1 : 0, new Date(NOW).toISOString());
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
