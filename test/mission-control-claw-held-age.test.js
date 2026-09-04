'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const AGENTS = require('../mission-control/ui/pages/claw/agents.js');
const ENGINE = require('../mission-control/ui/pages/claw/engine.js');

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

function makeDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      type TEXT,
      payload TEXT,
      status TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      attempts INTEGER,
      error TEXT,
      parent_job_id TEXT,
      owner_id TEXT
    );
    CREATE TABLE job_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT,
      created_at INTEGER,
      kind TEXT,
      actor TEXT,
      gate TEXT,
      decision TEXT,
      detail TEXT
    );
    CREATE TABLE review_drafts (
      review_id TEXT PRIMARY KEY,
      draft_status TEXT,
      guard_flagged TEXT
    );
    CREATE TABLE worker_heartbeat (
      owner_id TEXT PRIMARY KEY,
      worker_name TEXT,
      last_beat_at INTEGER
    );
  `);
  return db;
}

function addBlockedJob(db, { id, title, status, enteredAt, updatedAt, eventDetail }) {
  db.prepare(`
    INSERT INTO jobs
      (id, type, payload, status, created_at, updated_at, attempts, error, parent_job_id, owner_id)
    VALUES (?, 'boxquery', ?, ?, ?, ?, 1, NULL, NULL, NULL)
  `).run(
    id,
    JSON.stringify({ lifeDispatch: { taskId: `task-${id}`, title } }),
    status,
    enteredAt - DAY,
    updatedAt,
  );
  if (eventDetail !== null) {
    db.prepare(`
      INSERT INTO job_events (job_id, created_at, kind, actor, detail)
      VALUES (?, ?, 'status_change', 'worker', ?)
    `).run(id, enteredAt, eventDetail === undefined
      ? JSON.stringify({ from: 'running', to: status })
      : eventDetail);
  }
}

function addUnrelatedEvent(db, id, at) {
  db.prepare(`
    INSERT INTO job_events (job_id, created_at, kind, actor, detail)
    VALUES (?, ?, 'note', 'worker', '{"lease":"renewed"}')
  `).run(id, at);
}

function readEngine(db) {
  const ctx = {
    now: NOW,
    halt: { halted: false },
    q: (statement, params) => DATA.safeSelect(db, statement, params),
  };
  const section = ENGINE.getSection(db, ctx);
  return { section, body: ENGINE.render(section, ctx).body };
}

function blockedColumn(section) {
  return section.agents.columns.find((column) => column.id === 'blocked');
}

test('blocked age stays anchored to the status-change event after an unrelated write', () => {
  const db = makeDb();
  try {
    addBlockedJob(db, {
      id: 'signoff-held',
      title: 'Status entry is the clock',
      status: 'awaiting_signoff',
      enteredAt: NOW - 3 * DAY,
      updatedAt: NOW - 5 * 60_000,
    });
    addUnrelatedEvent(db, 'signoff-held', NOW - 5 * 60_000);

    const { section, body } = readEngine(db);
    const card = blockedColumn(section).cards.find((item) => item.task.strong === 'Status entry is the clock');

    assert.equal(card.time, 'waiting on the operator · 3d',
      'the displayed wait must use status entry, not the five-minute updated_at');
    assert.doesNotMatch(body, /waiting on the operator · 5m/,
      'an unrelated write must not reset the displayed wait');
  } finally {
    db.close();
  }
});

test('blocked cards sort oldest wait first even when unrelated writes invert updated_at', () => {
  const db = makeDb();
  try {
    addBlockedJob(db, {
      id: 'old-signoff',
      title: 'Old sign-off wait',
      status: 'awaiting_signoff',
      enteredAt: NOW - 6 * DAY,
      updatedAt: NOW - 60_000,
    });
    addBlockedJob(db, {
      id: 'new-plan',
      title: 'New plan wait',
      status: 'awaiting_plan_feedback',
      enteredAt: NOW - 2 * DAY,
      updatedAt: NOW - 20 * 60_000,
    });
    addUnrelatedEvent(db, 'old-signoff', NOW - 60_000);
    addUnrelatedEvent(db, 'new-plan', NOW - 20 * 60_000);

    const { section } = readEngine(db);
    const titles = blockedColumn(section).cards.map((card) => card.task.strong);

    assert.deepEqual(titles, ['Old sign-off wait', 'New plan wait'],
      'status-entry age, rather than updated_at, controls oldest-first triage');
  } finally {
    db.close();
  }
});

test('the seven-day aging group uses status-entry age despite later unrelated writes', () => {
  const db = makeDb();
  try {
    addBlockedJob(db, {
      id: 'aging-plan',
      title: 'Eight-day plan wait',
      status: 'awaiting_plan_feedback',
      enteredAt: NOW - 8 * DAY,
      updatedAt: NOW - 2 * 60_000,
    });
    addBlockedJob(db, {
      id: 'fresh-signoff',
      title: 'Six-day sign-off wait',
      status: 'awaiting_signoff',
      enteredAt: NOW - 6 * DAY,
      updatedAt: NOW - 2 * DAY,
    });
    addUnrelatedEvent(db, 'aging-plan', NOW - 2 * 60_000);
    addUnrelatedEvent(db, 'fresh-signoff', NOW - 2 * DAY);

    const { section, body } = readEngine(db);
    const blocked = blockedColumn(section);

    assert.deepEqual(blocked.cards.map((card) => card.task.strong), ['Six-day sign-off wait']);
    assert.deepEqual(blocked.aging.map((card) => card.task.strong), ['Eight-day plan wait']);
    assert.match(body, /aging \(1\) — held over 7 days/,
      'the populated real-age field drives the existing collapsed aging group');
  } finally {
    db.close();
  }
});

test('both blocked statuses show event age; without a transition event the gate-opening event is the clock, and with neither the card carries no number', () => {
  const db = makeDb();
  try {
    addBlockedJob(db, {
      id: 'valid-signoff',
      title: 'Valid sign-off event',
      status: 'awaiting_signoff',
      enteredAt: NOW - DAY,
      updatedAt: NOW - 10_000,
    });
    addBlockedJob(db, {
      id: 'valid-plan',
      title: 'Valid plan event',
      status: 'awaiting_plan_feedback',
      enteredAt: NOW - 2 * DAY,
      updatedAt: NOW - 20_000,
    });
    // Predates the status_change trail but carries the engine-written gate-opening event.
    addBlockedJob(db, {
      id: 'opened-signoff',
      title: 'Opened sign-off event',
      status: 'awaiting_signoff',
      enteredAt: NOW - 3 * DAY,
      updatedAt: NOW - 10_000,
      eventDetail: null,
    });
    db.prepare(`INSERT INTO job_events (job_id, created_at, kind, actor, detail) VALUES (?, ?, 'pr_opened', 'worker', ?)`)
      .run('opened-signoff', NOW - 3 * DAY, JSON.stringify({ number: 9, prUrl: 'https://github.com/x/y/pull/9' }));
    // renewLease() refreshes updated_at on parked jobs, so a 10-second-old updated_at must NEVER
    // become "waiting 10s": with no usable event the card says so without a number.
    addBlockedJob(db, {
      id: 'missing-signoff',
      title: 'Missing sign-off event',
      status: 'awaiting_signoff',
      enteredAt: NOW - 4 * DAY,
      updatedAt: NOW - 10_000,
      eventDetail: null,
    });
    addBlockedJob(db, {
      id: 'malformed-plan',
      title: 'Malformed plan event',
      status: 'awaiting_plan_feedback',
      enteredAt: NOW - 5 * DAY,
      updatedAt: NOW - 10_000,
      eventDetail: '{not-json',
    });

    const { section, body } = readEngine(db);
    const cards = blockedColumn(section).cards;
    const byTitle = new Map(cards.map((card) => [card.task.strong, card]));

    assert.equal(byTitle.get('Valid sign-off event').time, 'waiting on the operator · 24h');
    assert.equal(byTitle.get('Valid plan event').time, 'held 2d ago');
    assert.match(byTitle.get('Opened sign-off event').time, /^waiting on the operator · 3d/);
    assert.equal(byTitle.get('Opened sign-off event')._ageMs, 3 * DAY);
    assert.match(byTitle.get('Missing sign-off event').time, /^waiting on the operator(?! ·)/);
    assert.doesNotMatch(byTitle.get('Missing sign-off event').time, /10s|1 min|waiting on the operator · /);
    assert.equal(byTitle.get('Malformed plan event').time, 'held');
    assert.doesNotMatch(body, /held age unavailable — missing valid status-change event/);
  } finally {
    db.close();
  }
});

test('deriveBlockedHeldAge prefers the latest valid transition, then the gate-opening event, and never updated_at', () => {
  const job = { id: 'job-1', status: 'awaiting_plan_feedback', updated_at: NOW - 10_000 };
  const older = {
    id: 1,
    job_id: 'job-1',
    created_at: NOW - 4 * DAY,
    kind: 'status_change',
    detail: JSON.stringify({ from: 'running', to: 'awaiting_plan_feedback' }),
  };
  const latest = {
    id: 2,
    job_id: 'job-1',
    created_at: NOW - 2 * DAY,
    kind: 'status_change',
    detail: JSON.stringify({ from: 'running', to: 'awaiting_plan_feedback' }),
  };
  const opened = { id: 3, job_id: 'job-1', created_at: NOW - 3 * DAY, kind: 'plan_submitted', detail: '{}' };

  assert.equal(AGENTS.deriveBlockedHeldAge(job, [older, latest], NOW), 2 * DAY);
  assert.equal(AGENTS.deriveBlockedHeldAge(job, [older, latest, opened], NOW), 2 * DAY, 'a valid transition beats the opening event');
  assert.equal(AGENTS.deriveBlockedHeldAge(job, [opened], NOW), 3 * DAY, 'the gate-opening event is the fallback clock');
  assert.equal(AGENTS.deriveBlockedHeldAge(job, [], NOW), null, 'updated_at is never a clock: renewLease() refreshes it on parked jobs');
  assert.equal(AGENTS.deriveBlockedHeldAge(job, [{ ...latest, detail: '{bad-json' }], NOW), null);
  assert.equal(AGENTS.deriveBlockedHeldAge(job, [{ ...latest, created_at: NOW + 1 }, opened], NOW), 3 * DAY,
    'a future transition timestamp is invalid, so the opening event wins');
  assert.equal(AGENTS.deriveBlockedHeldAge({ ...job, updated_at: null }, [], NOW), null);
  assert.equal(AGENTS.deriveBlockedHeldAge({ id: 'job-1', status: 'running' }, [latest], NOW), null, 'only held statuses have a held age');
});
