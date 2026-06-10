'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const {
  buildWorkerModel,
  getWorkerSection,
  renderWorker
} = require('../mission-control/server.js');

function createWorkerDb({ withHeartbeat = true } = {}) {
  const db = new sqlite.DatabaseSync(':memory:');

  if (withHeartbeat) {
    db.exec(`
      CREATE TABLE worker_heartbeat (
        owner_id TEXT,
        last_beat_at INTEGER,
        phase TEXT,
        job_id TEXT
      );
    `);
  }

  return db;
}

function insertHeartbeat(db, row) {
  db.prepare(`
    INSERT INTO worker_heartbeat (owner_id, last_beat_at, phase, job_id)
    VALUES (?, ?, ?, ?)
  `).run(
    row.owner_id,
    row.last_beat_at,
    row.phase,
    row.job_id
  );
}

function withFixedNow(nowMs, callback) {
  const originalNow = Date.now;
  Date.now = () => nowMs;

  try {
    return callback();
  } finally {
    Date.now = originalNow;
  }
}

test('fresh idle worker heartbeat with no job is not active', () => {
  const nowMs = 2_000_000;
  const heartbeat = {
    owner_id: 'coder:idle',
    last_beat_at: nowMs - 10_000,
    phase: 'idle',
    job_id: null
  };

  const model = buildWorkerModel([heartbeat], nowMs);

  assert.equal(model.anyFresh, true);
  assert.equal(model.workers.length, 1);
  assert.equal(model.workers[0].fresh, true);
  assert.equal(model.workers[0].active, false);

  const db = createWorkerDb();
  try {
    insertHeartbeat(db, heartbeat);

    const section = withFixedNow(nowMs, () => getWorkerSection(db));

    assert.equal(section.ok, true);
    assert.equal(section.active, false);
    assert.equal(section.headerChip, 'IDLE');
  } finally {
    db.close();
  }
});

test('missing worker_heartbeat table returns unavailable section without legacy fallback text', () => {
  const db = createWorkerDb({ withHeartbeat: false });
  try {
    let section;

    assert.doesNotThrow(() => {
      section = getWorkerSection(db);
    });

    assert.equal(section.ok, false);
    assert.doesNotMatch(
      JSON.stringify(section),
      /No explicit worker heartbeat keys found/
    );
    assert.doesNotMatch(
      renderWorker(section),
      /No explicit worker heartbeat keys found/
    );
  } finally {
    db.close();
  }
});

test('renderWorker includes fresh and stale workers with stale marker', () => {
  const nowMs = 2_000_000;
  const model = buildWorkerModel([
    {
      owner_id: 'lead:one',
      last_beat_at: nowMs - 10_000,
      phase: 'review',
      job_id: 'lead-job'
    },
    {
      owner_id: 'coder:one',
      last_beat_at: nowMs - 121_000,
      phase: 'build',
      job_id: 'coder-job'
    }
  ], nowMs);

  const html = renderWorker({
    ok: true,
    workers: model.workers,
    anyFresh: model.anyFresh,
    warnings: []
  });

  assert.match(html, /lead/);
  assert.match(html, /coder-worker/);
  assert.match(html, /class="hero\s+stale"|>STALE</);
});
