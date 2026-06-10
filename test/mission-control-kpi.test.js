'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const {
  classifyGateEvent,
  countTestIntegrity,
  getKpiSection,
  renderDashboard
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

function detail(value) {
  return { detail: JSON.stringify(value) };
}

function acceptedCaughtRow() {
  return detail({
    verdict: 'accept',
    perFunction: [
      { caughtByMutant: true }
    ]
  });
}

function renderWithKpis(kpis) {
  const unavailable = { ok: false, message: 'Unavailable', warnings: [] };
  return renderDashboard({
    ok: true,
    halt: { halted: false },
    refreshedAt: 1_704_067_200_000,
    sections: {
      kpis,
      queue: unavailable,
      worker: unavailable,
      spend: { ok: true, totalPence: 0, ceilingPence: 7500, warnings: [] },
      tokens: unavailable,
      outcomes: unavailable,
      deploy: unavailable
    }
  });
}

test('classifyGateEvent classifies base-form and legacy gate decisions', () => {
  assert.equal(classifyGateEvent({ decision: 'approve' }), 'passed');
  assert.equal(classifyGateEvent({ decision: 'reject' }), 'refused');
  assert.equal(classifyGateEvent({ decision: 'approved' }), 'passed');
  assert.equal(classifyGateEvent({ decision: 'refuse' }), 'refused');
  assert.equal(classifyGateEvent({ decision: 'pending' }), null);
  assert.equal(classifyGateEvent({ kind: 'note', decision: 'approve' }), null);
});

test('countTestIntegrity counts accepted rows with mutant catches as teeth', () => {
  assert.deepEqual(countTestIntegrity([
    acceptedCaughtRow(),
    acceptedCaughtRow(),
    acceptedCaughtRow()
  ]), { teeth: 3, theatre: 0 });
});

test('countTestIntegrity counts theatre rows only as theatre', () => {
  assert.deepEqual(countTestIntegrity([
    detail({ verdict: 'theatre' }),
    detail({ verdict: 'theatre' })
  ]), { teeth: 0, theatre: 2 });
});

test('countTestIntegrity rejects accepted rows without caught mutants as teeth', () => {
  assert.equal(countTestIntegrity([
    detail({ verdict: 'accept', perFunction: [] })
  ]).teeth, 0);
  assert.equal(countTestIntegrity([
    detail({ verdict: 'accept' })
  ]).teeth, 0);
  assert.equal(countTestIntegrity([
    detail({ verdict: 'accept', perFunction: [{ caughtByMutant: false }] })
  ]).teeth, 0);
});

test('countTestIntegrity keeps mixed teeth and theatre counts separate', () => {
  assert.deepEqual(countTestIntegrity([
    acceptedCaughtRow(),
    acceptedCaughtRow(),
    detail({ verdict: 'theatre' }),
    detail({ verdict: 'accept', perFunction: [] }),
    { detail: '{malformed' }
  ]), { teeth: 2, theatre: 1 });
});

test('countTestIntegrity ignores malformed and unparseable detail without throwing', () => {
  let result;
  assert.doesNotThrow(() => {
    result = countTestIntegrity([
      { detail: '{malformed' },
      { detail: null },
      {},
      { detail: '' },
      { detail: JSON.stringify(['not', 'object']) }
    ]);
  });
  assert.deepEqual(result, { teeth: 0, theatre: 0 });
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
    assert.equal(section.testIntegrityTeeth, 0);
    assert.equal(section.testIntegrityTheatre, 0);
    assert.equal(section.testIntegrityUnavailable, false);

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

test('renderDashboard includes the test integrity KPI value', () => {
  const db = createKpiDb();
  try {
    for (let index = 0; index < 26; index += 1) {
      insertEvent(db, {
        job_id: `teeth-${index}`,
        kind: 'test_run',
        detail: JSON.stringify({
          verdict: 'accept',
          perFunction: [{ caughtByMutant: true }]
        }),
        created_at: 1_704_067_200_000
      });
    }
    for (let index = 0; index < 2; index += 1) {
      insertEvent(db, {
        job_id: `theatre-${index}`,
        kind: 'test_run',
        detail: JSON.stringify({ verdict: 'theatre' }),
        created_at: 1_704_067_200_000
      });
    }

    const html = renderWithKpis(getKpiSection(db, 1_704_067_200_000));

    assert.match(html, /TEST INTEGRITY/);
    assert.match(html, /26 teeth · 2 theatre/);
  } finally {
    db.close();
  }
});

test('renderDashboard marks the test integrity KPI unavailable when only that query fails', () => {
  const db = createKpiDb();
  try {
    insertEvent(db, {
      job_id: 'would-count',
      kind: 'test_run',
      detail: JSON.stringify({
        verdict: 'accept',
        perFunction: [{ caughtByMutant: true }]
      }),
      created_at: 1_704_067_200_000
    });

    const wrappedDb = {
      prepare(sql) {
        if (sql.trim() === "SELECT detail FROM job_events WHERE kind = 'test_run'") {
          throw new Error('forced integrity select failure');
        }
        return db.prepare(sql);
      }
    };

    const html = renderWithKpis(getKpiSection(wrappedDb, 1_704_067_200_000));

    assert.match(html, /TEST INTEGRITY/);
    assert.match(html, /0 teeth · 0 theatre/);
    assert.match(html, /unavailable/);
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
