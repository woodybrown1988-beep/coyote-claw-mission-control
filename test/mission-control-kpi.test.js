'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const {
  classifyGateEvent,
  getKpiSection
} = require('../mission-control/server.js');

function createKpiDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      status TEXT,
      type TEXT,
      updated_at INTEGER,
      created_at INTEGER
    );
    CREATE TABLE job_events (
      job_id TEXT,
      kind TEXT,
      gate TEXT,
      decision TEXT,
      detail TEXT,
      created_at INTEGER
    );
  `);
  return db;
}

function insertJob(db, row) {
  db.prepare(`
    INSERT INTO jobs (id, status, type, updated_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.status,
    row.type || null,
    row.updated_at,
    row.created_at
  );
}

function insertEvent(db, row) {
  db.prepare(`
    INSERT INTO job_events (job_id, kind, gate, decision, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    row.job_id || null,
    row.kind || 'gate_decision',
    row.gate || null,
    row.decision || null,
    row.detail || null,
    row.created_at
  );
}

test('classifyGateEvent classifies base-form and legacy gate decisions', () => {
  assert.equal(classifyGateEvent({ decision: 'approve' }), 'passed');
  assert.equal(classifyGateEvent({ decision: 'reject' }), 'refused');
  assert.equal(classifyGateEvent({ decision: 'approved' }), 'passed');
  assert.equal(classifyGateEvent({ decision: 'refuse' }), 'refused');
  assert.equal(classifyGateEvent({ decision: 'pending' }), null);
  assert.equal(classifyGateEvent({ kind: 'note', decision: 'approve' }), null);
});

test('getKpiSection counts base-form gate decisions and exact awaiting_signoff jobs', () => {
  const db = createKpiDb();
  const monthStartMs = 1_704_067_200_000;
  const today = Date.now() + 86_400_000;
  const older = 1_600_000_000_000;

  try {
    for (let index = 0; index < 4; index += 1) {
      insertJob(db, {
        id: `awaiting-${index}`,
        status: 'awaiting_signoff',
        type: 'gate',
        updated_at: older,
        created_at: older
      });
    }

    insertJob(db, {
      id: 'active-job-main',
      status: 'running',
      type: 'build',
      updated_at: today,
      created_at: today
    });
    insertJob(db, {
      id: 'shipped-job',
      status: 'shipped',
      type: 'release',
      updated_at: today,
      created_at: today
    });
    insertJob(db, {
      id: 'queued-old',
      status: 'queued',
      type: 'spec',
      updated_at: older,
      created_at: older
    });
    insertJob(db, {
      id: 'case-mismatch',
      status: 'Awaiting_Signoff',
      type: 'gate',
      updated_at: older,
      created_at: older
    });

    for (let index = 0; index < 2; index += 1) {
      insertEvent(db, {
        job_id: `passed-${index}`,
        decision: 'approve',
        created_at: today
      });
    }
    for (let index = 0; index < 3; index += 1) {
      insertEvent(db, {
        job_id: `refused-${index}`,
        decision: 'reject',
        created_at: today
      });
    }
    for (const decision of ['pending', 'open', 'awaiting', 'awaiting_tap', 'tap_pending']) {
      insertEvent(db, {
        job_id: `open-control-${decision}`,
        decision,
        created_at: today
      });
    }

    const section = getKpiSection(db, monthStartMs);

    assert.equal(section.ok, true);
    assert.equal(section.gatesPassed, 2);
    assert.equal(section.gatesRefused, 3);
    assert.equal(section.openGates, 4);

    assert.equal(section.jobsToday, 2);
    assert.equal(section.shippedToday, 1);
    assert.equal(section.activeJobs, 1);
    assert.equal(section.activeStage, 'build');
    assert.equal(section.activeJob, 'active-j');
    assert.equal(section.monthStartMs, monthStartMs);
    assert.deepEqual(section.warnings, []);
  } finally {
    db.close();
  }
});

test('getKpiSection keeps the unavailable KPI contract when required tables are absent', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  try {
    assert.deepEqual(getKpiSection(db, 1_704_067_200_000), {
      ok: false,
      message: 'KPI data is unavailable.',
      warnings: []
    });
  } finally {
    db.close();
  }
});
