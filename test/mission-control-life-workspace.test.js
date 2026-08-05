'use strict';
// LIFE OS workspace (PR 3) — registry shape, read-only wall, honest gate-states, real counts.
// Tripwires mirrored from the claw read-only test: no life page may emit a write affordance,
// and NOTHING in Mission Control may hold a writable life.db handle (operator ruling
// 2026-08-05: writes go authenticated-MC → engine sole-writer command path, a later PR).
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite = require('node:sqlite');
const SHARED = require('../mission-control/ui/shared.js');
const LIFE = require('../mission-control/ui/pages/life/life-lib.js');

// Sidebar order: Focus (today, waiting) · Plan (outcomes, projects, tasks) · Review (review, trust).
const PAGES = [
  require('../mission-control/ui/pages/life/today.js'),
  require('../mission-control/ui/pages/life/waiting.js'),
  require('../mission-control/ui/pages/life/outcomes.js'),
  require('../mission-control/ui/pages/life/projects.js'),
  require('../mission-control/ui/pages/life/tasks.js'),
  require('../mission-control/ui/pages/life/review.js'),
  require('../mission-control/ui/pages/life/trust.js'),
];

const T = '2026-08-05T12:00:00.000Z';
const WRITE_AFFORDANCE = /data-op|data-log-action|<form\b|fetch\(|xhr|XMLHttpRequest|method="post"/i;

function withEnv(dbPath, fn) {
  const prev = process.env.COYOTE_LIFE_DB;
  process.env.COYOTE_LIFE_DB = dbPath;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.COYOTE_LIFE_DB; else process.env.COYOTE_LIFE_DB = prev;
  }
}

function makeFixture(dir) {
  const p = path.join(dir, 'life.db');
  const db = new sqlite.DatabaseSync(p);
  db.exec(`
    CREATE TABLE life_outcomes (id TEXT PRIMARY KEY, owner_id TEXT, domain_key TEXT, title TEXT,
      proof_definition TEXT, status TEXT, target_date TEXT, priority INTEGER, visibility TEXT,
      created_at TEXT, updated_at TEXT);
    CREATE TABLE life_projects (id TEXT PRIMARY KEY, owner_id TEXT, domain_key TEXT, title TEXT,
      definition_of_done TEXT, stage TEXT, status TEXT, risk_state TEXT, due_date TEXT,
      visibility TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE life_tasks (id TEXT PRIMARY KEY, owner_id TEXT, outcome_id TEXT, domain_key TEXT,
      title TEXT, status TEXT, due_kind TEXT DEFAULT 'NONE', due_at TEXT, estimate_minutes INTEGER,
      importance INTEGER DEFAULT 3, consequence INTEGER DEFAULT 3, risk_level TEXT, visibility TEXT,
      source_type TEXT, created_by TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE life_waiting_conditions (id TEXT PRIMARY KEY, task_id TEXT, owner_id TEXT,
      dependency_label TEXT, wake_type TEXT, fallback_at TEXT, state TEXT, created_at TEXT, updated_at TEXT);
    CREATE VIEW v_life_available_work AS
      SELECT t.*, 0 AS calculated_priority FROM life_tasks t
       WHERE t.status IN ('READY','SCHEDULED','IN_PROGRESS')
         AND NOT EXISTS (SELECT 1 FROM life_waiting_conditions w WHERE w.task_id = t.id AND w.state = 'ACTIVE');
    INSERT INTO life_outcomes VALUES ('o1','woody','health','<script>alert(1)</script> stronger','p','ACTIVE',NULL,1,'OWNER_ONLY','${T}','${T}');
    INSERT INTO life_tasks (id, owner_id, domain_key, title, status, risk_level, visibility, source_type, created_by, created_at, updated_at)
      VALUES ('t1','woody','health','ready task','READY','LOW','OWNER_ONLY','MANUAL','h','${T}','${T}'),
             ('t2','woody','health','waiting task','WAITING','LOW','OWNER_ONLY','MANUAL','h','${T}','${T}');
    INSERT INTO life_waiting_conditions VALUES ('w1','t2','woody','Lightspeed engineer','EMAIL_REPLY','2026-08-12','ACTIVE','${T}','${T}');
  `);
  db.close();
  return p;
}

test('registry: Life OS is the third workspace with the ruled shape', () => {
  const life = SHARED.WORKSPACES.find((w) => w.key === 'life');
  assert.ok(life, 'life workspace registered');
  assert.equal(life.home, '/life/today');
  // The readOnly flag flipped WITH the sole-writer command path (operator ruling 2026-08-05):
  // writes exist, but only as authenticated POSTs relayed to the engine writer.
  assert.ok(!life.readOnly, 'command path landed — the flag flipped here, never before');
  assert.equal(life.roNote, undefined, 'the scaffold note went with it');
  const items = life.groups.flatMap((g) => g.items);
  assert.deepEqual(items.map((i) => i.key), PAGES.map((p) => p.key), 'sidebar items = page modules, in order');
  assert.ok(items.every((i) => i.route.startsWith('/life/')));
  // Graph-era surfaces are deliberately absent (v1 scope = Phases 0-3 only).
  assert.ok(!items.some((i) => /schedule|agents|settings/.test(i.key)), 'no Graph-era surfaces in v1');
});

test('workspace switcher: claw note byte-identical; life renders no read-only note', () => {
  const claw = SHARED.WORKSPACES.find((w) => w.key === 'claw');
  const clawHtml = SHARED.renderShell({ active: 'engine', title: 't', sub: '', stamp: '', body: '', badges: {}, foot: [] });
  assert.ok(clawHtml.includes('read-only · actions via Telegram · chat = the front door'), 'legacy claw note unchanged');
  const lifeHtml = SHARED.renderShell({ active: 'life-today', title: 't', sub: '', stamp: '', body: '', badges: {}, foot: [] });
  assert.ok(!lifeHtml.includes('read-only scaffold'), 'the scaffold note is gone with the flag');
  assert.ok(lifeHtml.includes('Life OS'), 'chip renders');
  assert.ok(claw.readOnly, 'claw stays read-only');
});

test('every life page renders an honest engine gate when life.db is absent — and no write affordance ever', () => {
  withEnv(path.join(os.tmpdir(), 'nonexistent-life-dir', 'life.db'), () => {
    for (const page of PAGES) {
      const section = page.getSection(null, { now: Date.parse(T) });
      const out = page.render(section, { now: Date.parse(T) });
      assert.ok(out && typeof out.body === 'string', `${page.key} renders`);
      assert.match(out.body, /life\.db not initialised/, `${page.key} names the gate`);
      assert.ok(!WRITE_AFFORDANCE.test(out.body), `${page.key} emits no write affordance`);
    }
  });
});

test('with a real life.db: real counts, real rows, HTML-escaped, still zero write affordances', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-life-'));
  const dbPath = makeFixture(dir);
  withEnv(dbPath, () => {
    for (const page of PAGES) {
      const out = page.render(page.getSection(null, { now: Date.parse(T) }), { now: Date.parse(T) });
      assert.ok(!WRITE_AFFORDANCE.test(out.body), `${page.key} emits no write affordance`);
    }
    const today = PAGES[0].render(PAGES[0].getSection(null, {}), {});
    assert.match(today.body, /Active outcomes/);
    assert.match(today.stamp, /outcomes=1 available=1/, 'real counts: 1 active outcome, 1 available task');
    const outcomes = PAGES[2].render(PAGES[2].getSection(null, {}), {});
    assert.ok(outcomes.body.includes('&lt;script&gt;'), 'DB strings render escaped');
    assert.ok(!outcomes.body.includes('<script>alert'), 'never raw');
    const waiting = PAGES[1].render(PAGES[1].getSection(null, {}), {});
    assert.match(waiting.body, /Lightspeed engineer/);
    const tasks = PAGES[4].render(PAGES[4].getSection(null, {}), {});
    assert.match(tasks.body, /WAITING/);
    // review/trust tables don't exist in the fixture → pages degrade to their gate-states.
    const review = PAGES[5].render(PAGES[5].getSection(null, {}), {});
    assert.match(review.body, /unlock:/i);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('read-only wall: the life.db handle cannot write; only life-lib touches the database', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-life-'));
  const dbPath = makeFixture(dir);
  withEnv(dbPath, () => {
    const o = LIFE.openLifeReadonly();
    assert.ok(o.ok);
    assert.throws(() => o.db.exec("INSERT INTO life_tasks (id) VALUES ('x')"), /readonly/i);
    o.db.close();
  });
  fs.rmSync(dir, { recursive: true, force: true });
  // Structural: no life page module opens a database itself — only life-lib.js may.
  const lifeDir = path.join(__dirname, '..', 'mission-control', 'ui', 'pages', 'life');
  for (const f of fs.readdirSync(lifeDir)) {
    if (f === 'life-lib.js') continue;
    const src = fs.readFileSync(path.join(lifeDir, f), 'utf8');
    assert.ok(!/node:sqlite|DatabaseSync/.test(src), `${f} must not open databases directly`);
  }
  const lib = fs.readFileSync(path.join(lifeDir, 'life-lib.js'), 'utf8');
  assert.ok(/readOnly:\s*true/.test(lib), 'life-lib opens read-only');
  assert.ok(!/readOnly:\s*false/.test(lib));
  // And nothing OUTSIDE ui/pages/life can OPEN life.db: an offender must both name the
  // life path AND reference the sqlite driver (prose mentions — e.g. the registry's
  // read-only note — are not handles and must not trip this).
  const uiDir = path.join(__dirname, '..', 'mission-control', 'ui');
  const offenders = [];
  (function scan(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!p.endsWith(path.join('pages', 'life'))) scan(p); continue; }
      if (!e.name.endsWith('.js')) continue;
      const src = fs.readFileSync(p, 'utf8');
      if (/life\.db|COYOTE_LIFE_DB/.test(src) && /node:sqlite|DatabaseSync/.test(src)) offenders.push(p);
    }
  })(uiDir);
  assert.deepEqual(offenders, [], `life.db opened outside ui/pages/life: ${offenders.join(', ')}`);
});

test('negative control: the write-affordance tripwire catches a mutant', () => {
  assert.ok(WRITE_AFFORDANCE.test('<button data-op="approve">'), 'data-op caught');
  assert.ok(WRITE_AFFORDANCE.test('<form method="POST" action="/api/life/capture">'), 'form caught');
  assert.ok(!WRITE_AFFORDANCE.test('<a href="/life/tasks">tasks</a>'), 'plain links pass');
});
