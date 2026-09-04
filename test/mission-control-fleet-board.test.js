'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const AGENTS = require('../mission-control/ui/pages/claw/agents.js');
const SHARED = require('../mission-control/ui/shared.js');
const { gatePrState } = AGENTS;

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;

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
      detail TEXT
    );
    CREATE TABLE worker_heartbeat (
      owner_id TEXT PRIMARY KEY,
      worker_name TEXT,
      last_beat_at INTEGER,
      job_id TEXT,
      phase TEXT,
      updated_at INTEGER
    );
  `);
  return db;
}

function context(db) {
  return {
    now: NOW,
    halt: { halted: false },
    q: (statement, params) => DATA.safeSelect(db, statement, params),
  };
}

function addJob(db, {
  id,
  status,
  payload = '{}',
  ownerId = null,
  updatedAt = NOW - MINUTE,
  type = 'coder-build',
}) {
  db.prepare(`
    INSERT INTO jobs
      (id, type, payload, status, created_at, updated_at, attempts, error, parent_job_id, owner_id)
    VALUES (?, ?, ?, ?, ?, ?, 1, NULL, NULL, ?)
  `).run(id, type, payload, status, updatedAt - MINUTE, updatedAt, ownerId);
}

function addHeartbeat(db, {
  ownerId,
  workerName,
  jobId,
  phase,
  lastBeatAt,
  startedAt,
}) {
  db.prepare(`
    INSERT INTO worker_heartbeat
      (owner_id, worker_name, last_beat_at, job_id, phase, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(ownerId, workerName, lastBeatAt, jobId, phase, startedAt);
}

function allCards(section) {
  return section.columns.flatMap((column) => column.cards.concat(column.aging || []))
    .concat((section.departments || []).flatMap((department) => department.agents));
}

test('gatePrState maps concrete GitHub state inputs and preserves indeterminate gates', () => {
  const job = {
    id: 'gate-state-unit',
    status: 'awaiting_signoff',
    payload: JSON.stringify({ prUrl: 'https://github.com/example/repo/pull/71' }),
  };
  const event = (detail, kind = 'pr_state') => ({
    id: 1,
    job_id: job.id,
    created_at: NOW - MINUTE,
    kind,
    detail: JSON.stringify(detail),
  });

  assert.deepEqual(gatePrState(job, [event({ number: 71, state: 'MERGED' })]), { number: 71, state: 'merged' });
  assert.deepEqual(gatePrState(job, [event({ pull_request: { number: 71, state: 'closed', merged: false } })]),
    { number: 71, state: 'closed' });
  assert.deepEqual(gatePrState(job, [event({ number: 71, state: 'OPEN' })]), { number: 71, state: 'open' });
  assert.deepEqual(gatePrState(job, []), { number: 71, state: null });
  assert.equal(gatePrState({ ...job, payload: '{}' }, []), null);
});

test('WORKING uses a fresh build heartbeat and its phase/job start clock', () => {
  const db = makeDb();
  try {
    addJob(db, {
      id: 'build-job-25',
      status: 'done',
      ownerId: 'box:10:1800000000000',
      updatedAt: NOW - 5 * MINUTE,
    });
    addHeartbeat(db, {
      ownerId: 'box:10:1800000000000',
      workerName: 'coder-1',
      jobId: 'build-job-25',
      phase: 'build',
      lastBeatAt: NOW - 10_000,
      startedAt: NOW - 10_000, // updated_at moves with every beat in production — it is NOT the clock
    });
    // The build started when its spec was approved: that append-only event is the elapsed clock.
    db.prepare(`INSERT INTO job_events (job_id, created_at, kind, actor, detail) VALUES (?, ?, 'gate_decision', 'agent', ?)`)
      .run('build-job-25', NOW - 25 * MINUTE, JSON.stringify({ gate: 'spec', decision: 'approve' }));

    const ctx = context(db);
    const section = AGENTS.getSection(db, ctx);
    const working = section.columns.find((column) => column.id === 'working').cards;
    const card = working.find((item) => item.name === 'coder-1');

    assert.ok(card, 'the heartbeat keeps the worker in WORKING despite the transient done status');
    assert.match(card.task.tail, /job build-job-25/);
    assert.match(card.task.tail, /phase build/);
    assert.equal(card.time, '25 min');
    const body = AGENTS.render(section, ctx).body;
    assert.match(body, /coder-1/);
    assert.match(body, /build-job-25/);
    assert.match(body, /phase build/);
    assert.match(body, /25 min/);
  } finally {
    db.close();
  }
});

test('a stale non-idle heartbeat stays in WORKING and reports last-seen minutes', () => {
  const db = makeDb();
  try {
    addHeartbeat(db, {
      ownerId: 'box:11:1800000000001',
      workerName: 'researcher-1',
      jobId: 'research-job-stale',
      phase: 'research',
      lastBeatAt: NOW - 7 * MINUTE,
      startedAt: NOW - 40 * MINUTE,
    });

    const ctx = context(db);
    const section = AGENTS.getSection(db, ctx);
    const working = section.columns.find((column) => column.id === 'working').cards;
    const card = working.find((item) => item.name === 'researcher-1');

    assert.ok(card, 'stale work remains on the board');
    assert.equal(card.time, 'last seen 7 min ago');
    assert.equal((section.departments || []).flatMap((d) => d.agents).some((a) => a.name === 'researcher-1'), false,
      'the stale non-idle worker is not presented as idle at home');
    assert.match(AGENTS.render(section, ctx).body, /last seen 7 min ago/);
  } finally {
    db.close();
  }
});

test('the all-heartbeats query also keeps non-idle Lead work in WORKING', () => {
  const db = makeDb();
  try {
    addHeartbeat(db, {
      ownerId: 'lead:1800000000000',
      workerName: 'lead-1',
      jobId: 'lead-job-9',
      phase: 'review',
      lastBeatAt: NOW - 20_000,
      startedAt: NOW - 20_000,
    });
    db.prepare(`INSERT INTO job_events (job_id, created_at, kind, actor, detail) VALUES (?, ?, 'status_change', 'agent', ?)`)
      .run('lead-job-9', NOW - 9 * MINUTE, JSON.stringify({ from: 'queued', to: 'running' }));

    const section = AGENTS.getSection(db, context(db));
    const working = section.columns.find((column) => column.id === 'working').cards;
    const card = working.find((item) => item.name === 'lead-1');
    assert.ok(card);
    assert.match(card.task.tail, /job lead-job-9 · phase review/);
    assert.equal(card.time, '9 min');
  } finally {
    db.close();
  }
});

test('a merged PR makes its blocked merge-gate record stale and removes the merge tap', () => {
  const db = makeDb();
  try {
    addJob(db, {
      id: 'stale-gate',
      status: 'awaiting_signoff',
      payload: JSON.stringify({ prUrl: 'https://github.com/example/repo/pull/42' }),
      updatedAt: NOW - 30 * MINUTE,
    });
    db.prepare(`
      INSERT INTO job_events (job_id, created_at, kind, actor, detail)
      VALUES (?, ?, 'status_change', 'worker', ?)
    `).run('stale-gate', NOW - 30 * MINUTE, JSON.stringify({ from: 'running', to: 'awaiting_signoff' }));
    db.prepare(`
      INSERT INTO job_events (job_id, created_at, kind, actor, detail)
      VALUES (?, ?, 'pr_state', 'github', ?)
    `).run('stale-gate', NOW - MINUTE, JSON.stringify({ number: 42, state: 'MERGED' }));

    const ctx = context(db);
    const section = AGENTS.getSection(db, ctx);
    const blocked = section.columns.find((column) => column.id === 'blocked').cards;
    const card = blocked.find((item) => item.task && item.task.strong === 'PR #42 merged — gate record stale');

    assert.ok(card, 'the current PR state is rendered on the stale gate');
    assert.equal(card.button, undefined, 'the stale gate has no merge-tap action');
    const body = AGENTS.render(section, ctx).body;
    assert.match(body, /PR #42 merged — gate record stale/);
    assert.doesNotMatch(body, /Approve in TG|Needs your merge tap/);
  } finally {
    db.close();
  }
});

test('a closed unmerged PR gets the corresponding stale-gate wording', () => {
  const db = makeDb();
  try {
    addJob(db, {
      id: 'closed-gate',
      status: 'awaiting_signoff',
      payload: JSON.stringify({ pr_number: 43 }),
    });
    db.prepare(`INSERT INTO job_events (job_id, created_at, kind, actor, detail) VALUES (?, ?, 'pr_state', 'github', ?)`)
      .run('closed-gate', NOW - 10_000, JSON.stringify({ pull_request: { number: 43, state: 'closed', merged: false } }));

    const section = AGENTS.getSection(db, context(db));
    const card = section.columns.find((column) => column.id === 'blocked').cards
      .find((item) => item.talkJobId === 'closed-gate');
    assert.equal(card.task.strong, 'PR #43 closed — gate record stale');
    assert.equal(card.button, undefined);
  } finally {
    db.close();
  }
});

test('an open or unknown PR preserves the existing merge-tap behavior', () => {
  for (const [id, detail] of [
    ['open-gate', { number: 51, state: 'OPEN' }],
    ['unknown-gate', { number: 52 }],
  ]) {
    const db = makeDb();
    try {
      addJob(db, {
        id,
        status: 'awaiting_signoff',
        payload: JSON.stringify({ pr_number: detail.number }),
      });
      db.prepare(`INSERT INTO job_events (job_id, created_at, kind, actor, detail) VALUES (?, ?, 'pr_state', 'github', ?)`)
        .run(id, NOW - 10_000, JSON.stringify(detail));

      const section = AGENTS.getSection(db, context(db));
      const card = section.columns.find((column) => column.id === 'blocked').cards
        .find((item) => item.talkJobId === id);
      assert.deepEqual(card.button, { label: 'Approve in TG' });
      assert.equal(card.waitPill.text, 'Needs your sign-off');
      assert.doesNotMatch(card.task.strong, /gate record stale/);
    } finally {
      db.close();
    }
  }
});

test('a blocked job without a status_change event uses its gate-opening event for held age, never updated_at', () => {
  const db = makeDb();
  try {
    addJob(db, {
      id: 'legacy-gate',
      status: 'awaiting_signoff',
      payload: JSON.stringify({ pr_number: 63 }),
      updatedAt: NOW - 18 * MINUTE,
    });

    const ctx = context(db);
    const section = AGENTS.getSection(db, ctx);
    const card = section.columns.find((column) => column.id === 'blocked').cards
      .find((item) => item.talkJobId === 'legacy-gate');

    assert.match(card.time, /^waiting on the operator(?! · \d)/,
      'renewLease() refreshes updated_at on parked jobs, so with no event the card carries no number');
    db.prepare(`INSERT INTO job_events (job_id, created_at, kind, actor, detail) VALUES (?, ?, 'pr_opened', 'worker', ?)`)
      .run('legacy-gate', NOW - 18 * MINUTE, JSON.stringify({ number: 63 }));
    const withOpening = AGENTS.getSection(db, context(db));
    const again = withOpening.columns.find((column) => column.id === 'blocked').cards.find((item) => item.task && item.task.strong === card.task.strong)
      || withOpening.columns.find((column) => column.id === 'blocked').cards[0];
    assert.match(again.time, /^waiting on the operator · 18m/, 'the gate-opening event is the fallback clock');
    assert.match(again.time, /PR #63 — merged\/closed state is not tracked on this box/, 'an unverified PR says so beside the tap');
  } finally {
    db.close();
  }
});
test('the fleet board empty copy reflects normal build duration', () => {
  const db = makeDb();
  try {
    const ctx = context(db);
    const body = AGENTS.render(AGENTS.getSection(db, ctx), ctx).body;
    assert.match(body, /Builds typically run 10–30 minutes\./);
    assert.doesNotMatch(body, /Jobs finish in seconds/);
  } finally {
    db.close();
  }
});

test('the emitted fleet-board client script passes the repository parse gate', () => {
  const html = String(SHARED.renderShell({
    title: 'Engine room',
    sub: '',
    body: '<div></div>',
    workspace: 'claw',
    route: '/claw/engine',
    key: 'engine',
  }));
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'the fleet board shell emits its client script');
  assert.doesNotThrow(() => new Function(match[1]));
});
