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
      job_id TEXT,
      worker_name TEXT
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
    INSERT INTO worker_heartbeat (owner_id, last_beat_at, phase, job_id, worker_name)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    row.owner_id,
    row.last_beat_at,
    row.phase || null,
    row.job_id || null,
    row.worker_name || null
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
  assert.equal(model.workers[0].name, 'coder:one', 'unnamed worker → host:pid fallback label, not a collapsed "coder-worker"');
  assert.equal(model.workers[0].fresh, true);
  assert.equal(model.workers[0].active, true);
  assert.equal(model.workers[0].jobId, 'job-1234');
});

test('buildWorkerModel treats the cutoff boundary exactly (a NAMED worker stays visible when stale)', () => {
  const nowMs = 2_000_000;

  const boundary = buildWorkerModel([
    { owner_id: 'box:1:1', last_beat_at: nowMs - 120_000, phase: 'idle', job_id: '', worker_name: 'coder-1' }
  ], nowMs);
  const stale = buildWorkerModel([
    { owner_id: 'box:1:1', last_beat_at: nowMs - 120_001, phase: 'idle', job_id: '', worker_name: 'coder-1' }
  ], nowMs);

  assert.equal(boundary.anyFresh, true);
  assert.equal(boundary.workers[0].fresh, true);
  assert.equal(boundary.workers[0].active, false);
  assert.equal(stale.anyFresh, false);
  assert.equal(stale.workers[0].fresh, false, 'a configured (named) worker stays visible, flagged not-fresh');
});

test('buildWorkerModel reports a stale NAMED worker without anyFresh', () => {
  const nowMs = 2_000_000;
  const model = buildWorkerModel([
    { owner_id: 'box:1:1', last_beat_at: nowMs - 121_000, phase: 'build', job_id: 'job-stale', worker_name: 'coder-1' }
  ], nowMs);

  assert.equal(model.anyFresh, false);
  assert.equal(model.workers.length, 1);
  assert.equal(model.workers[0].fresh, false);
  assert.equal(model.workers[0].active, false);
});

test('buildWorkerModel DROPS stale UNNAMED historical rows (no ghost flood) but keeps named + fresh-unnamed', () => {
  const nowMs = 5_000_000;
  const model = buildWorkerModel([
    { owner_id: 'box:1:1700000000000', last_beat_at: nowMs - 4_000_000, phase: 'idle', job_id: null },   // ancient unnamed (dead process)
    { owner_id: 'box:2:1700000111111', last_beat_at: nowMs - 3_000_000, phase: 'build', job_id: 'gone' }, // ancient unnamed (dead process)
    { owner_id: 'box:9:1782800000000', last_beat_at: nowMs - 9_000, phase: 'idle', job_id: null, worker_name: 'coder-1' }, // fresh named
    { owner_id: 'box:8:1782800000001', last_beat_at: nowMs - 8_000, phase: 'idle', job_id: null }          // fresh UNNAMED (worker on old code, mid-rollout)
  ], nowMs);

  // both ancient unnamed rows dropped; the named worker + the fresh unnamed (host:pid) survive
  assert.deepEqual(model.workers.map((w) => w.name), ['box:8', 'coder-1']);
});

test('buildWorkerModel keeps the lead collapsed but renders coders PER-WORKER by name', () => {
  const nowMs = 2_000_000;
  const model = buildWorkerModel([
    { owner_id: 'host:11:1700000000000', last_beat_at: nowMs - 10_000, phase: 'build', job_id: 'coder-job', worker_name: 'coder-2' },
    { owner_id: 'host:10:1700000000000', last_beat_at: nowMs - 11_000, phase: 'idle', job_id: null, worker_name: 'coder-1' },
    { owner_id: 'lead:one', last_beat_at: nowMs - 9_000, phase: 'review', job_id: 'lead-job' }
  ], nowMs);

  // lead first, then coders sorted by name — TWO distinct coders, not one collapsed "coder-worker"
  assert.deepEqual(model.workers.map((worker) => worker.name), ['lead', 'coder-1', 'coder-2']);
  assert.equal(model.workers[0].jobId, 'lead-job');
  assert.equal(model.workers[2].jobId, 'coder-jo'); // coder-2 (shortId of 'coder-job')
});

test('buildWorkerModel collapses a RESTARTED worker (same WORKER_NAME, two owner_ids) to its freshest row', () => {
  const nowMs = 2_000_000;
  const olderBeat = nowMs - 100_000;
  const newerBeat = nowMs - 5_000;
  const model = buildWorkerModel([
    { owner_id: 'host:10:1700000000000', last_beat_at: olderBeat, phase: 'idle', job_id: 'old-job', worker_name: 'coder-1' },
    { owner_id: 'host:99:1700000999999', last_beat_at: newerBeat, phase: 'build', job_id: 'new-job', worker_name: 'coder-1' }
  ], nowMs);

  assert.equal(model.workers.length, 1, 'same WORKER_NAME across a restart → ONE card');
  assert.equal(model.workers[0].name, 'coder-1');
  assert.equal(model.workers[0].ownerId, 'host:99:1700000999999', 'the freshest (current) process wins');
  assert.equal(model.workers[0].phase, 'build');
  assert.equal(model.workers[0].jobId, 'new-job');
  assert.equal(model.workers[0].lastBeatMs, newerBeat);
});

test('buildWorkerModel falls back to host:pid (epoch trimmed) when WORKER_NAME is absent', () => {
  const nowMs = 2_000_000;
  const model = buildWorkerModel([
    { owner_id: 'box:443:1782845051237', last_beat_at: nowMs - 10_000, phase: 'idle', job_id: null }
  ], nowMs);
  assert.equal(model.workers[0].name, 'box:443', 'host:pid label, never blank, never fabricated');
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
      owner_id: 'box:1:1',
      last_beat_at: staleBeat,
      phase: 'idle',
      job_id: '',
      worker_name: 'coder-1' // a configured worker stays visible (stale), so its lastBeatMs is inspectable
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
