'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const {
  buildWorkerModel,
  getWorkerSection
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
      updated_at INTEGER,
      created_at INTEGER
    );
    CREATE TABLE job_events (
      created_at INTEGER
    );
  `);
  return db;
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

test('buildWorkerModel treats a 10s-old heartbeat as fresh', () => {
  const nowMs = 2_000_000;
  const model = buildWorkerModel([
    { owner_id: 'coder:one', last_beat_at: nowMs - 10_000, phase: 'build', job_id: 'job-123456789' }
  ], nowMs);

  assert.deepEqual(Object.keys(model), ['workers', 'anyFresh']);
  assert.equal(model.anyFresh, true);
  assert.equal(model.workers.length, 1);
  assert.equal(model.workers[0].name, 'coder-worker');
  assert.equal(model.workers[0].fresh, true);
  assert.equal(model.workers[0].active, true);
  assert.equal(model.workers[0].jobId, 'job-1234');
});

test('buildWorkerModel treats the cutoff boundary exactly', () => {
  const nowMs = 2_000_000;

  const boundary = buildWorkerModel([
    { owner_id: 'coder:one', last_beat_at: nowMs - 120_000, phase: 'idle', job_id: '' }
  ], nowMs);
  const stale = buildWorkerModel([
    { owner_id: 'coder:one', last_beat_at: nowMs - 120_001, phase: 'idle', job_id: '' }
  ], nowMs);

  assert.equal(boundary.anyFresh, true);
  assert.equal(boundary.workers[0].fresh, true);
  assert.equal(boundary.workers[0].active, false);
  assert.equal(stale.anyFresh, false);
  assert.equal(stale.workers[0].fresh, false);
});

test('buildWorkerModel reports stale-only rows without anyFresh', () => {
  const nowMs = 2_000_000;
  const model = buildWorkerModel([
    { owner_id: 'coder:one', last_beat_at: nowMs - 121_000, phase: 'build', job_id: 'job-stale' }
  ], nowMs);

  assert.equal(model.anyFresh, false);
  assert.equal(model.workers.length, 1);
  assert.equal(model.workers[0].fresh, false);
  assert.equal(model.workers[0].active, false);
});

test('buildWorkerModel keeps lead and coder-worker as separate classes in stable order', () => {
  const nowMs = 2_000_000;
  const model = buildWorkerModel([
    { owner_id: 'coder:one', last_beat_at: nowMs - 10_000, phase: 'build', job_id: 'coder-job' },
    { owner_id: 'lead:one', last_beat_at: nowMs - 9_000, phase: 'review', job_id: 'lead-job' }
  ], nowMs);

  assert.deepEqual(model.workers.map((worker) => worker.name), ['lead', 'coder-worker']);
  assert.equal(model.workers[0].jobId, 'lead-job');
  assert.equal(model.workers[1].jobId, 'coder-jo');
});

test('buildWorkerModel keeps the freshest same-class row', () => {
  const nowMs = 2_000_000;
  const olderBeat = nowMs - 100_000;
  const newerBeat = nowMs - 5_000;
  const model = buildWorkerModel([
    { owner_id: 'coder:old', last_beat_at: olderBeat, phase: 'idle', job_id: 'old-job' },
    { owner_id: 'coder:new', last_beat_at: newerBeat, phase: 'build', job_id: 'new-job' }
  ], nowMs);

  assert.equal(model.workers.length, 1);
  assert.equal(model.workers[0].ownerId, 'coder:new');
  assert.equal(model.workers[0].phase, 'build');
  assert.equal(model.workers[0].jobId, 'new-job');
  assert.equal(model.workers[0].lastBeatMs, newerBeat);
});

test('buildWorkerModel returns an empty model for empty rows', () => {
  assert.deepEqual(buildWorkerModel([], 2_000_000), {
    workers: [],
    anyFresh: false
  });
});

test('getWorkerSection ignores phantom system_state worker keys', () => {
  const db = createWorkerDb();
  try {
    const nowMs = Date.now();
    db.prepare('INSERT INTO system_state (key, value, updated_at) VALUES (?, ?, ?)')
      .run('worker_active', 'true', nowMs);
    db.prepare('INSERT INTO system_state (key, value, updated_at) VALUES (?, ?, ?)')
      .run('worker_heartbeat', String(nowMs), nowMs);
    insertHeartbeat(db, {
      owner_id: 'coder:one',
      last_beat_at: nowMs - 121_000,
      phase: 'idle',
      job_id: ''
    });

    const section = getWorkerSection(db);

    assert.equal(section.ok, true);
    assert.equal(section.anyFresh, false);
    assert.equal(section.active, null);
    assert.equal(section.headerChip, 'UNKNOWN');
  } finally {
    db.close();
  }
});

test('getWorkerSection ignores fresh jobs and job events when heartbeat is stale', () => {
  const db = createWorkerDb();
  try {
    const nowMs = Date.now();
    const staleBeat = nowMs - 121_000;
    insertHeartbeat(db, {
      owner_id: 'coder:one',
      last_beat_at: staleBeat,
      phase: 'idle',
      job_id: ''
    });
    db.prepare('INSERT INTO jobs (id, status, updated_at, created_at) VALUES (?, ?, ?, ?)')
      .run('fresh-job', 'running', nowMs, nowMs);
    db.prepare('INSERT INTO job_events (created_at) VALUES (?)').run(nowMs);

    const section = getWorkerSection(db);

    assert.equal(section.ok, true);
    assert.equal(section.headerChip, 'UNKNOWN');
    assert.equal(section.workers[0].lastBeatMs, staleBeat);
  } finally {
    db.close();
  }
});

test('getWorkerSection ignores fresh jobs and job events when heartbeat is empty', () => {
  const db = createWorkerDb();
  try {
    const nowMs = Date.now();
    db.prepare('INSERT INTO jobs (id, status, updated_at, created_at) VALUES (?, ?, ?, ?)')
      .run('fresh-job', 'running', nowMs, nowMs);
    db.prepare('INSERT INTO job_events (created_at) VALUES (?)').run(nowMs);

    const section = getWorkerSection(db);

    assert.equal(section.ok, true);
    assert.deepEqual(section.workers, []);
    assert.equal(section.anyFresh, false);
    assert.equal(section.headerChip, 'UNKNOWN');
  } finally {
    db.close();
  }
});

test('getWorkerSection header chip is live for fresh non-idle heartbeat', () => {
  const db = createWorkerDb();
  try {
    insertHeartbeat(db, {
      owner_id: 'coder:one',
      last_beat_at: Date.now() - 10_000,
      phase: 'build',
      job_id: ''
    });

    const section = getWorkerSection(db);

    assert.equal(section.headerChip, 'LIVE');
    assert.equal(section.active, true);
  } finally {
    db.close();
  }
});

test('getWorkerSection header chip is live for fresh idle heartbeat with claimed job', () => {
  const db = createWorkerDb();
  try {
    insertHeartbeat(db, {
      owner_id: 'coder:one',
      last_beat_at: Date.now() - 10_000,
      phase: '',
      job_id: 'claimed-job'
    });

    const section = getWorkerSection(db);

    assert.equal(section.headerChip, 'LIVE');
    assert.equal(section.active, true);
  } finally {
    db.close();
  }
});
