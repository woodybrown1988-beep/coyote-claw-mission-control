'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const AGENTS = require('../mission-control/ui/pages/claw/agents.js');
const HEALTH = require('../mission-control/ui/pages/claw/health.js');

const NOW = 1782800000000;

function makeDb(options = {}) {
  const db = new sqlite.DatabaseSync(':memory:');
  if (options.jobs !== false) {
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
        detail TEXT
      )
    `);
  }
  if (options.heartbeats !== false) {
    db.exec(`
      CREATE TABLE worker_heartbeat (
        owner_id TEXT PRIMARY KEY,
        worker_name TEXT,
        last_beat_at INTEGER
      )
    `);
  }
  return db;
}

function context(db) {
  const sql = [];
  return {
    sql,
    now: NOW,
    halt: { halted: false },
    q(statement, params) {
      sql.push(String(statement));
      return DATA.safeSelect(db, statement, params);
    },
  };
}

function insertJob(db, row) {
  db.prepare(`
    INSERT INTO jobs
      (id, type, payload, status, created_at, updated_at, attempts, error, parent_job_id, owner_id)
    VALUES (?, ?, '{}', ?, ?, ?, 0, NULL, NULL, ?)
  `).run(row.id, row.type || 'coder-build', row.status, row.createdAt, row.updatedAt ?? row.createdAt, row.ownerId ?? null);
}

function insertHeartbeat(db, ownerId, workerName) {
  db.prepare(`INSERT INTO worker_heartbeat (owner_id, worker_name, last_beat_at) VALUES (?, ?, ?)`)
    .run(ownerId, workerName, NOW - 1000);
}

// A worker appears EITHER on the board (it is on a job) or in its department (it is at rest) —
// operator ruling 2026-08-13, "if they are done on a job then they can be in their departments".
// These assertions are about the worker's identity and gauge, which are the same in both places,
// so the helper looks in both rather than pinning where the card happened to sit.
function workerCards(section) {
  const onBoard = section.columns.flatMap((column) => column.cards);
  const atHome = (section.departments || []).flatMap((d) => d.agents);
  return onBoard.concat(atHome).filter((card) => card.workerGauge);
}

function assertSelectOnly(statements) {
  assert.ok(statements.length > 0, 'the page issued read queries');
  for (const statement of statements) {
    assert.match(statement.trim(), /^SELECT\b/i, statement);
  }
}

test('claw queue depth: fleet buckets, all in-flight statuses, worker joins, queue aging, and rendering', () => {
  const db = makeDb();
  insertHeartbeat(db, 'host:1:1782799000000', 'coder-1');
  insertHeartbeat(db, 'host:9:1782798000000', 'coder-1');
  insertHeartbeat(db, 'host:2:1782799000000', 'coder-2');
  insertHeartbeat(db, 'host:3:1782799000000', 'coder-3');

  insertJob(db, { id: 'q-old', status: 'queued', createdAt: NOW - 70 * 60000, ownerId: 'host:1:1782799000000' });
  insertJob(db, { id: 'q-warn', status: 'queued', createdAt: NOW - 20 * 60000, ownerId: 'host:1:1782799000000' });
  insertJob(db, { id: 'q-unknown-age', status: 'queued', createdAt: null, ownerId: 'host:1:1782799000000' });
  insertJob(db, { id: 'preparing', status: 'preparing', createdAt: NOW - 10000, ownerId: 'host:1:1782799000000' });
  insertJob(db, { id: 'dispatched', status: 'dispatched', createdAt: NOW - 9000, ownerId: 'host:9:1782798000000' });
  insertJob(db, { id: 'running', status: 'running', createdAt: NOW - 8000, ownerId: 'host:2:1782799000000' });
  insertJob(db, { id: 'unknown-owner', status: 'running', createdAt: NOW - 7000, ownerId: 'ghost:4:1782799000000' });
  insertJob(db, { id: 'unowned', status: 'running', createdAt: NOW - 6000 });
  insertJob(db, { id: 'signoff', status: 'awaiting_signoff', createdAt: NOW - 5000, ownerId: 'host:1:1782799000000' });
  db.prepare(`INSERT INTO job_events (job_id, created_at, kind, detail) VALUES (?, ?, 'status_change', ?)`)
    .run('signoff', NOW - 5000, JSON.stringify({ from: 'running', to: 'awaiting_signoff' }));
  insertJob(db, { id: 'done', status: 'done', createdAt: NOW - 4000, ownerId: 'host:3:1782799000000' });

  const agentsCtx = context(db);
  const agents = AGENTS.getSection(db, agentsCtx);
  assert.deepEqual(agents.queueDepth, {
    queued: 3,
    inFlight: 5,
    awaitingSignoff: 1,
    oldestQueuedAt: NOW - 70 * 60000,
    oldestQueuedAgeMs: 70 * 60000,
    queuedOver15m: 2,
    queuedOver1h: 1,
  });

  const cards = workerCards(agents);
  const coder1 = cards.find((card) => card.name === 'coder-1');
  assert.deepEqual(coder1.workerGauge, { known: true, count: 2 }, 'same worker_name aggregates preparing + dispatched across owner ids');
  assert.match(coder1.time, /^waiting on the operator · 0m$/, 'signoff age is operator wait, never worker latency');
  assert.deepEqual(cards.find((card) => card.name === 'coder-2').workerGauge, { known: true, count: 1 }, 'running is in-flight');
  assert.deepEqual(cards.find((card) => card.name === 'coder-3').workerGauge, { known: true, count: 0 }, 'a worker with no claimed work displays zero');
  assert.equal(cards.some((card) => card.name === 'ghost:4'), false, 'an owner without a heartbeat is not presented as a worker');
  assert.equal(cards.some((card) => card.name === 'Coder'), false, 'unowned work is not assigned to the fallback Coder role');
  // Keyed on the card's own `fleet` flag, not on the role STRING starting with "fleet ·" — the role
  // is operator-facing copy (it gained the agent's real job in 2026-08-13's roster work) and pinning
  // its prefix made this assertion break on a pure wording change while proving nothing.
  const fleetCards = agents.columns.flatMap((column) => column.cards).filter((card) => card.fleet);
  assert.ok(fleetCards.some((card) => /unrecognised ghost:4/.test(card.role)), 'an unmatched owner remains visible as fleet work');
  assert.ok(fleetCards.some((card) => /fleet · unowned/.test(card.role)), 'unowned work remains visible without a worker label');
  // "Queued work stays fleet-only" = it is never ATTRIBUTED TO A WORKER, even when the row carries
  // an owner_id that matches a live heartbeat. The old form of this assertion counted avatars
  // (av-coder), which only passed because generic cards used to hard-code an unrelated avatar — it
  // would have gone green even if queued work HAD been attributed. Pinned on the fact now.
  const queuedCards = agents.columns.find((column) => column.id === 'queued').cards;
  assert.ok(queuedCards.length > 0, 'the fixture really does queue work (an empty column proves nothing)');
  assert.ok(queuedCards.every((card) => card.fleet === true), 'queued work is fleet-level, never assigned to a worker');
  assert.ok(queuedCards.every((card) => !card.workerGauge), 'and carries no worker gauge');

  const agentsHtml = AGENTS.render(agents, agentsCtx).body;
  assert.match(agentsHtml, /data-queue-depth="fleet"/);
  assert.match(agentsHtml, /data-queue-bucket="queued">3</);
  assert.match(agentsHtml, /data-queue-bucket="in-flight">5</);
  assert.match(agentsHtml, /data-queue-bucket="awaiting-signoff">1</);
  assert.match(agentsHtml, /Current in-flight/);
  assert.match(agentsHtml, /data-worker-in-flight="0"/);
  assert.match(agentsHtml, /fleet · unrecognised ghost:4/);
  assert.match(agentsHtml, /fleet · unowned/);
  assert.match(agentsHtml, /waiting on the operator/);
  assertSelectOnly(agentsCtx.sql);

  const healthCtx = context(db);
  const health = HEALTH.getSection(db, healthCtx);
  assert.deepEqual(health.queueDepth, agents.queueDepth, 'both claw pages expose the same fleet facts');
  const healthHtml = HEALTH.render(health, healthCtx).body;
  assert.match(healthHtml, /data-health="queue-depth"/);
  assert.match(healthHtml, /data-queue-bucket="queued">3</);
  assert.match(healthHtml, /data-queue-bucket="in-flight">5</);
  assert.match(healthHtml, /data-queue-bucket="awaiting-signoff">1</);
  assert.match(healthHtml, /data-oldest-queued="over-1h"/);
  assert.match(healthHtml, /<div class="val">1h<\/div>/, 'oldest queued age is rendered');
  assert.match(healthHtml, /2 &gt;15m/);
  assert.match(healthHtml, /1 &gt;1h/);
  assert.match(healthHtml, /waiting on the operator/);
  assertSelectOnly(healthCtx.sql);
  db.close();
});

test('claw queue aging uses strict >15m and >1h thresholds', () => {
  const db = makeDb();
  insertJob(db, { id: 'at-15m', status: 'queued', createdAt: NOW - 15 * 60000 });
  insertJob(db, { id: 'over-15m', status: 'queued', createdAt: NOW - 15 * 60000 - 1 });
  insertJob(db, { id: 'at-1h', status: 'queued', createdAt: NOW - 60 * 60000 });
  insertJob(db, { id: 'over-1h', status: 'queued', createdAt: NOW - 60 * 60000 - 1 });

  const ctx = context(db);
  const queue = HEALTH.getSection(db, ctx).queueDepth;
  assert.equal(queue.queuedOver15m, 3, 'the exactly-15m job is excluded');
  assert.equal(queue.queuedOver1h, 1, 'the exactly-1h job is excluded');
  assert.equal(queue.oldestQueuedAgeMs, 60 * 60000 + 1);
  assertSelectOnly(ctx.sql);
  db.close();
});

test('claw queue depth: empty and nullable data render explicit zero/unknown states', () => {
  const db = makeDb();
  const agentsCtx = context(db);
  const emptyAgents = AGENTS.getSection(db, agentsCtx);
  assert.deepEqual(emptyAgents.queueDepth, {
    queued: 0,
    inFlight: 0,
    awaitingSignoff: 0,
    oldestQueuedAt: null,
    oldestQueuedAgeMs: null,
    queuedOver15m: 0,
    queuedOver1h: 0,
  });
  assert.deepEqual(workerCards(emptyAgents)[0].workerGauge, { known: true, count: 0 });
  const emptyAgentsHtml = AGENTS.render(emptyAgents, agentsCtx).body;
  assert.match(emptyAgentsHtml, /data-queue-bucket="queued">0</);
  assert.match(emptyAgentsHtml, /queue empty/);

  insertJob(db, { id: 'null-time', status: 'queued', createdAt: null });
  const healthCtx = context(db);
  const nullableHealth = HEALTH.getSection(db, healthCtx);
  assert.equal(nullableHealth.queueDepth.queued, 1);
  assert.equal(nullableHealth.queueDepth.oldestQueuedAgeMs, null);
  assert.equal(nullableHealth.queueDepth.queuedOver15m, 0);
  assert.equal(nullableHealth.queueDepth.queuedOver1h, 0);
  const nullableHealthHtml = HEALTH.render(nullableHealth, healthCtx).body;
  assert.match(nullableHealthHtml, /data-queue-bucket="queued">1</);
  assert.match(nullableHealthHtml, /oldest timestamp unknown/);
  assertSelectOnly(agentsCtx.sql);
  assertSelectOnly(healthCtx.sql);
  db.close();
});

test('claw queue depth: missing jobs and worker tables never throw and render unknown/empty values', () => {
  const db = makeDb({ jobs: false, heartbeats: false });
  const agentsCtx = context(db);
  const healthCtx = context(db);

  let agents;
  let health;
  assert.doesNotThrow(() => { agents = AGENTS.getSection(db, agentsCtx); });
  assert.doesNotThrow(() => { health = HEALTH.getSection(db, healthCtx); });
  assert.equal(agents.queueDepth.queued, 0);
  assert.equal(agents.queueDepth.oldestQueuedAgeMs, null);
  assert.deepEqual(workerCards(agents)[0].workerGauge, { known: false, count: null });
  assert.equal(health.queueDepth.inFlight, 0);
  assert.equal(health.queueDepth.awaitingSignoff, 0);
  assert.doesNotThrow(() => AGENTS.render(agents, agentsCtx));
  assert.doesNotThrow(() => HEALTH.render(health, healthCtx));
  assert.match(AGENTS.render(agents, agentsCtx).body, /data-worker-in-flight="unknown"/);
  assert.match(HEALTH.render(health, healthCtx).body, /queue empty/);
  assertSelectOnly(agentsCtx.sql);
  assertSelectOnly(healthCtx.sql);
  db.close();
});
