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

test('getWorkerSection selects awaiting_signoff jobs as active rows', () => {
  const db = createWorkerDb();
  try {
    insertJob(db, {
      id: 'signoff-job-1',
      status: 'awaiting_signoff',
      updated_at: 2000,
      created_at: 1000
    });

    const section = getWorkerSection(db);

    assert.equal(section.ok, true);
    assert.equal(section.active, true);
    assert.equal(section.currentJob, 'signoff-');
    assert.equal(section.stage, 'awaiting-signoff');
    assert.equal(stageProgressPercent(section.stage), 90);
  } finally {
    db.close();
  }
});

test('getWorkerSection prefers actively-building jobs over newer awaiting_signoff jobs', () => {
  const db = createWorkerDb();
  try {
    insertJob(db, {
      id: 'signoff-newer',
      status: 'awaiting_signoff',
      updated_at: 3000,
      created_at: 1000
    });
    insertJob(db, {
      id: 'running-older',
      status: 'running',
      updated_at: 2000,
      created_at: 1000
    });

    const section = getWorkerSection(db);

    assert.equal(section.ok, true);
    assert.equal(section.active, true);
    assert.equal(section.currentJob, 'running-');
    assert.equal(section.stage, 'build');
  } finally {
    db.close();
  }
});
