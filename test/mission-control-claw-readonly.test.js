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

// The lifetime-failure count moved OUT of the triage row in the 2026-08-13 design pass — it is a
// number nobody can act on (95 of 126 are a dormant job type) and it was sitting in the row that
// answers "what needs you". It now lives as a one-line strip under The plumbing. What matters has
// not changed and is still asserted below: the total counts EVERY failed job, and the dormant
// annotation counts only learn-validate. This reads the strip instead of the tile.
function getFailedStrip(body) {
  const at = body.indexOf('<span class="s-name">Failed · lifetime</span>');
  assert.notEqual(at, -1, 'the lifetime failure line exists');
  const end = body.indexOf('</div>', at);
  return body.slice(at, end);
}
function stripNote(section) {
  const match = section.match(/<span class="s-note">([^<]*)<\/span>/);
  assert.ok(match, 'the line carries its explanation');
  return match[1];
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
  // Memory added 2026-08-13 (operator ask): the engine banks findings and injects them into the
  // specialists' prompts, and a memory nobody can READ is a memory nobody can correct. It is a
  // console page like its siblings — the read-only assertions below cover it unchanged, and this
  // list stays CLOSED so a fourth page has to be argued for here before it can ship.
  assert.deepEqual(keys, ['chat', 'engine', 'memory'], 'claw = the engine room + Chat + Memory (console pages only)');
  for (const g of claw.groups) for (const it of g.items) assert.match(it.route, /^\/claw\//, `${it.key} routes under /claw`);
});

test('NO /claw page source emits a write affordance (would cross the nonce trust boundary)', () => {
  // A console button/POST/fetch is the forbidden thing. Read-only surfaces link OUT to Telegram instead.
  const writeAffordance = /data-op=|data-log-action|method\s*=\s*["']?\s*post|fetch\s*\(|\/api\//i;
  assert.ok(clawFiles.length >= 2, 'agents + health present');
  // CARVE-OUT (ruling mc-chat-approved 2026-07-21, supersedes 'Chat tab: killed'): chat.js is the
  // frontdoor WEB TRANSPORT — its ONE write is POST /api/chat-message (a transport row; routing
  // stays box-side). Every OTHER claw page remains strictly read-only; this exemption is by NAME,
  // never a loosened pattern.
  for (const f of clawFiles.filter((x) => x !== 'chat.js')) {
    const src = fs.readFileSync(path.join(CLAW_DIR, f), 'utf8');
    assert.doesNotMatch(src, writeAffordance, `${f}: /claw is read-only — no action button; actions are Telegram taps`);
  }
  // and the chat page's write surface is EXACTLY the two chat endpoints — nothing else
  const chatSrc = fs.readFileSync(path.join(CLAW_DIR, 'chat.js'), 'utf8');
  const apis = [...chatSrc.matchAll(/\/api\/[a-z-]+/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(apis)].sort(), ['/api/chat-message', '/api/chat-updates'], 'chat touches ONLY its own transport endpoints (no review/recipe/gate paths)');
});

test('engine Failed jobs hero counts only failed learn-validate jobs in its dormant annotation', () => {
  const { body, sql } = renderEngine([
    { id: 'learn-failed-1', type: 'learn-validate', status: 'failed' },
    { id: 'learn-failed-2', type: 'learn-validate', status: 'failed' },
    { id: 'coder-failed', type: 'coder-build', status: 'failed' },
    { id: 'learn-done', type: 'learn-validate', status: 'done' },
  ]);
  const failedLine = getFailedStrip(body);

  assert.match(failedLine, /<b>3<\/b>/, 'the lifetime total still includes every failed job');
  assert.equal(stripNote(failedLine), 'failed jobs — incl. the 2 dormant learn-validate — named, never hidden');
  assert.doesNotMatch(failedLine, /incl\. the 95 dormant learn-validate — named, never hidden/);
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
  const failedLine = getFailedStrip(body);

  assert.match(failedLine, /<b>1<\/b>/, 'the other-type failure remains in the lifetime total');
  assert.equal(stripNote(failedLine), 'failed jobs — named, never hidden');
  assert.doesNotMatch(stripNote(failedLine), /dormant learn-validate/);
});
