'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const {
  deriveStage,
  getWorkerSection,
  stageProgressPercent
} = require('../mission-control/server.js');

function createWorkerDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE system_state (
      key TEXT,
      value TEXT,
      updated_at INTEGER
    );
    CREATE TABLE worker_heartbeat (
      owner_id TEXT,
      last_beat_at INTEGER,
      phase TEXT,
      job_id TEXT
    );
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      status TEXT,
      stage TEXT,
      type TEXT,
      updated_at INTEGER,
      created_at INTEGER
    );
    CREATE TABLE job_events (
      created_at INTEGER
    );
  `);
  return db;
}

function insertJob(db, row) {
  db.prepare(`
    INSERT INTO jobs (id, status, stage, type, updated_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.status,
    row.stage || null,
    row.type || null,
    row.updated_at,
    row.created_at
  );
}

function insertHeartbeat(db, row) {
  db.prepare(`
    INSERT INTO worker_heartbeat (owner_id, last_beat_at, phase, job_id)
    VALUES (?, ?, ?, ?)
  `).run(
    row.owner_id,
    row.last_beat_at,
    row.phase || null,
    row.job_id || null
  );
}

test('stageProgressPercent maps late review and signoff stages near done', () => {
  const nearDone = stageProgressPercent('awaiting-signoff');

  assert.equal(nearDone, 90);
  assert.equal(stageProgressPercent('lead_review'), nearDone);
  assert.equal(stageProgressPercent('lead-review'), nearDone);
  assert.equal(stageProgressPercent('pr'), nearDone);
  assert.equal(stageProgressPercent('review'), nearDone);
});

test('stageProgressPercent preserves existing core stage values and gate fallback', () => {
  assert.equal(stageProgressPercent('spec'), 32);
  assert.equal(stageProgressPercent('build'), 64);
  assert.equal(stageProgressPercent('done'), 100);
  assert.equal(stageProgressPercent('queued'), 0);

  const failureStage = deriveStage({ status: 'failed' });
  assert.equal(failureStage, 'gate');
  assert.notEqual(stageProgressPercent(failureStage), 90);
  assert.equal(stageProgressPercent(failureStage), 0);
});

test('awaiting signoff progress does not regress to zero', () => {
  assert.ok(stageProgressPercent('awaiting-signoff') > 0);
  assert.equal(stageProgressPercent('awaiting-signoff'), 90);
});

test('getWorkerSection uses worker heartbeat rows for active state', () => {
  const db = createWorkerDb();
  try {
    insertHeartbeat(db, {
      owner_id: 'coder:one',
      last_beat_at: Date.now() - 10_000,
      phase: 'build',
      job_id: 'running-job-1'
    });

    const section = getWorkerSection(db);

    assert.equal(section.ok, true);
    assert.equal(section.active, true);
    assert.equal(section.headerChip, 'LIVE');
    assert.equal(section.workers[0].jobId, 'running-');
    assert.equal(section.workers[0].phase, 'build');
  } finally {
    db.close();
  }
});

test('getWorkerSection does not derive worker state from active jobs', () => {
  const db = createWorkerDb();
  try {
    insertJob(db, {
      id: 'running-newer',
      status: 'running',
      updated_at: 3000,
      created_at: 1000
    });

    const section = getWorkerSection(db);

    assert.equal(section.ok, true);
    assert.equal(section.active, null);
    assert.equal(section.headerChip, 'UNKNOWN');
    assert.deepEqual(section.workers, []);
  } finally {
    db.close();
  }
});
