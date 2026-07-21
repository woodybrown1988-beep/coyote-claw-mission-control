'use strict';
// /claw is the ENGINE ROOM console — READ-ONLY by design. It shows agent state; EVERY action stays a
// Telegram tap. A console action button (data-op / data-log-action / a POST form / an /api/ fetch) would
// cross the nonce trust boundary. This is the tripwire: no page under the /claw workspace may emit a write
// affordance, and the registry must keep /claw = the console pages only, flagged read-only.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const sqlite = require('node:sqlite');
const SHARED = require('../mission-control/ui/shared.js');
const DATA = require('../mission-control/ui/data.js');
const ENGINE = require('../mission-control/ui/pages/claw/engine.js');

const NOW = 1782800000000;

const CLAW_DIR = path.join(__dirname, '..', 'mission-control', 'ui', 'pages', 'claw');
const clawFiles = fs.readdirSync(CLAW_DIR).filter((f) => f.endsWith('.js'));

function renderEngine(jobs) {
  const db = new sqlite.DatabaseSync(':memory:');
  const sql = [];
  try {
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
      )
    `);
    const insert = db.prepare(`
      INSERT INTO jobs
        (id, type, payload, status, created_at, updated_at, attempts, error, parent_job_id, owner_id)
      VALUES (?, ?, '{}', ?, ?, ?, 0, NULL, NULL, NULL)
    `);
    for (const job of jobs) insert.run(job.id, job.type, job.status, NOW, NOW);
    const ctx = {
      now: NOW,
      halt: { halted: false },
      q(statement, params) {
        sql.push(String(statement));
        return DATA.safeSelect(db, statement, params);
      },
    };
    return { body: ENGINE.render(ENGINE.getSection(db, ctx), ctx).body, sql };
  } finally {
    db.close();
  }
}

function getSection(body, label) {
  const labelAt = body.indexOf(`<div class="lab">${label}</div>`);
  assert.notEqual(labelAt, -1, `${label} hero exists`);
  const sectionStart = body.lastIndexOf('<div class="tile ', labelAt);
  const sectionEnd = body.indexOf('</div></div>', labelAt);
  assert.notEqual(sectionStart, -1, `${label} hero starts with a tile`);
  assert.notEqual(sectionEnd, -1, `${label} hero has a closing boundary`);
  return body.slice(sectionStart, sectionEnd + '</div></div>'.length);
}

function getSubcopy(section) {
  const match = section.match(/<div class="sub">([^<]*)<\/div>/);
  assert.ok(match, 'hero subcopy exists');
  return match[1];
}

test('registry: /claw = console pages only, flagged read-only, all under /claw/*', () => {
  const claw = SHARED.WORKSPACES.find((w) => w.key === 'claw');
  assert.ok(claw, 'claw workspace exists');
  assert.equal(claw.readOnly, true, 'claw is flagged read-only');
  const keys = claw.groups.flatMap((g) => g.items.map((i) => i.key)).sort();
  assert.deepEqual(keys, ['engine'], 'claw = ONE engine room (agents + health merged, page-map audit 2026-07-21)');
  for (const g of claw.groups) for (const it of g.items) assert.match(it.route, /^\/claw\//, `${it.key} routes under /claw`);
});

test('NO /claw page source emits a write affordance (would cross the nonce trust boundary)', () => {
  // A console button/POST/fetch is the forbidden thing. Read-only surfaces link OUT to Telegram instead.
  const writeAffordance = /data-op=|data-log-action|method\s*=\s*["']?\s*post|fetch\s*\(|\/api\//i;
  assert.ok(clawFiles.length >= 2, 'agents + health present');
  for (const f of clawFiles) {
    const src = fs.readFileSync(path.join(CLAW_DIR, f), 'utf8');
    assert.doesNotMatch(src, writeAffordance, `${f}: /claw is read-only — no action button; actions are Telegram taps`);
  }
});

test('engine Failed jobs hero counts only failed learn-validate jobs in its dormant annotation', () => {
  const { body, sql } = renderEngine([
    { id: 'learn-failed-1', type: 'learn-validate', status: 'failed' },
    { id: 'learn-failed-2', type: 'learn-validate', status: 'failed' },
    { id: 'coder-failed', type: 'coder-build', status: 'failed' },
    { id: 'learn-done', type: 'learn-validate', status: 'done' },
  ]);
  const failedHero = getSection(body, 'Failed jobs · lifetime');

  assert.match(failedHero, /<div class="val">3<\/div>/, 'the lifetime total still includes every failed job');
  assert.equal(getSubcopy(failedHero), 'failed jobs — incl. the 2 dormant learn-validate — named, never hidden');
  assert.doesNotMatch(failedHero, /incl\. the 95 dormant learn-validate — named, never hidden/);
  assert.equal(
    sql.filter((statement) => statement.trim().replace(/\s+/g, ' ') === 'SELECT status, type, updated_at FROM jobs').length,
    1,
    'the engine reads status, type, and updated_at in one jobs query',
  );
});

test('engine Failed jobs hero omits the dormant annotation when no failed learn-validate jobs exist', () => {
  const { body } = renderEngine([
    { id: 'coder-failed', type: 'coder-build', status: 'failed' },
    { id: 'learn-done', type: 'learn-validate', status: 'done' },
  ]);
  const failedHero = getSection(body, 'Failed jobs · lifetime');

  assert.match(failedHero, /<div class="val">1<\/div>/, 'the other-type failure remains in the lifetime total');
  assert.equal(getSubcopy(failedHero), 'failed jobs — named, never hidden');
  assert.doesNotMatch(getSubcopy(failedHero), /dormant learn-validate/);
});
