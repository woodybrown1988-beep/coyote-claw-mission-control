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
// The tripwire, EVOLVED AGAIN with the planner surfaces: life page bodies still may not
// carry raw write mechanisms (fetch/XHR/data-op/POST forms) — the sanctioned affordances
// are the allowlist-pinned data-lc-* family plus the lc-note-form, ALL of whose handlers
// live in the shared shell and post exclusively to the gated /api/life/* relay. Every
// data-lc-cmd payload must parse as JSON naming a writer-allowlisted command.
const WRITE_AFFORDANCE = /data-op|data-log-action|fetch\(|xhr|XMLHttpRequest|method="post"/i;
const SANCTIONED_LC = new Set(['data-lc-cancel', 'data-lc-cmd', 'data-lc-complete', 'data-lc-wait', 'data-lc-edit', 'data-lc-fab']);
const CMD_ALLOWLIST = new Set(['note', 'decide', 'transition', 'complete', 'set_waiting', 'wake', 'reopen', 'undo',
  'plan_today', 'approve_plan', 'compile_week', 'approve_week', 'compile_quarter', 'approve_quarter',
  'pause_capability', 'resume_capability']);
function assertOnlySanctionedLc(body, key) {
  for (const m of body.matchAll(/data-lc-[a-z-]+/g)) {
    assert.ok(SANCTIONED_LC.has(m[0]), `${key}: unsanctioned life affordance ${m[0]}`);
  }
  for (const m of body.matchAll(/<form\b[^>]*/g)) {
    assert.ok(/lc-note-form/.test(m[0]), `${key}: only the lc-note-form form is sanctioned`);
  }
  for (const m of body.matchAll(/data-lc-cmd="([^"]*)"/g)) {
    const decoded = m[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&#39;', "'");
    const parsed = JSON.parse(decoded);
    assert.ok(CMD_ALLOWLIST.has(parsed.command), `${key}: data-lc-cmd carries unknown command ${parsed.command}`);
  }
}

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
      title TEXT, status TEXT, definition_of_done TEXT DEFAULT '', due_kind TEXT DEFAULT 'NONE', due_at TEXT, estimate_minutes INTEGER,
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
      VALUES ('t0','woody','admin','captured inbox task','INBOX','LOW','OWNER_ONLY','MANUAL','h','${T}','${T}'),
             ('t1','woody','health','ready task','READY','LOW','OWNER_ONLY','MANUAL','h','${T}','${T}'),
             ('t2','woody','health','waiting task','WAITING','LOW','OWNER_ONLY','MANUAL','h','${T}','${T}');
    INSERT INTO life_waiting_conditions VALUES ('w1','t2','woody','Lightspeed engineer','EMAIL_REPLY','2026-08-12','ACTIVE','${T}','${T}');
    CREATE TABLE life_daily_plans (id TEXT PRIMARY KEY, owner_id TEXT, plan_date TEXT, must_win_task_id TEXT,
      support_task_1_id TEXT, support_task_2_id TEXT, decision_task_ids_json TEXT DEFAULT '[]',
      alternative_task_ids_json TEXT DEFAULT '[]', compilation_evidence_json TEXT DEFAULT '{}',
      status TEXT, approved_by TEXT, approved_at TEXT, created_at TEXT, updated_at TEXT);
    INSERT INTO life_daily_plans (id,owner_id,plan_date,must_win_task_id,support_task_1_id,support_task_2_id,alternative_task_ids_json,compilation_evidence_json,status,created_at,updated_at)
      VALUES ('pl1','woody','2026-08-05','t1',NULL,NULL,'[]','{"neglected_domains":["health"]}','PROPOSED','${T}','${T}');
    CREATE TABLE life_task_updates (id TEXT PRIMARY KEY, owner_id TEXT, task_id TEXT, actor_type TEXT, actor_id TEXT,
      raw_text TEXT, input_type TEXT, record_only INTEGER DEFAULT 0, visibility TEXT, source_ref TEXT,
      attachment_refs_json TEXT DEFAULT '[]', extractor_version TEXT, created_at TEXT);
    INSERT INTO life_task_updates (id,owner_id,task_id,actor_type,actor_id,raw_text,input_type,record_only,visibility,created_at)
      VALUES ('u1','woody','t1','HUMAN','woody','waiting on the <engineer>','TEXT',0,'OWNER_ONLY','${T}');
    CREATE TABLE life_update_facts (id TEXT PRIMARY KEY, owner_id TEXT, update_id TEXT, task_id TEXT, fact_type TEXT,
      value_json TEXT, unit TEXT, source_start INTEGER, source_end INTEGER, confidence REAL,
      validation_state TEXT, validated_by TEXT, validated_at TEXT, extractor_version TEXT, created_at TEXT);
    INSERT INTO life_update_facts (id,owner_id,update_id,task_id,fact_type,value_json,confidence,validation_state,extractor_version,created_at)
      VALUES ('f1','woody','u1','t1','blocker_dependency','"the engineer"',0.8,'EXTRACTED','rules-v1','${T}');
    CREATE TABLE life_update_proposals (id TEXT PRIMARY KEY, owner_id TEXT, update_id TEXT, task_id TEXT,
      capability_key TEXT, command_type TEXT, command_json TEXT, reason TEXT, evidence_refs_json TEXT DEFAULT '[]',
      confidence REAL, risk_level TEXT, authority_class TEXT, state TEXT, decided_by TEXT, decision_note TEXT,
      decided_at TEXT, applied_event_id TEXT, created_at TEXT);
    INSERT INTO life_update_proposals (id,owner_id,update_id,task_id,capability_key,command_type,command_json,reason,confidence,risk_level,authority_class,state,created_at)
      VALUES ('pr1','woody','u1','t1','waiting_inference','set_waiting','{"dependencyLabel":"the engineer","wakeType":"HUMAN_UPDATE","fallbackAt":"2026-08-12"}','the note names a dependency',0.8,'LOW','REVERSIBLE_INTERNAL','PROPOSED','${T}');
    CREATE TABLE life_task_events (id TEXT PRIMARY KEY, owner_id TEXT, task_id TEXT, event_type TEXT, actor_type TEXT,
      actor_id TEXT, from_state TEXT, to_state TEXT, payload_json TEXT DEFAULT '{}', idempotency_key TEXT, created_at TEXT);
    INSERT INTO life_task_events (id,owner_id,task_id,event_type,actor_type,actor_id,to_state,created_at)
      VALUES ('e1','woody','t1','CREATED','HUMAN','woody','READY','${T}');
    CREATE TABLE life_automation_capabilities (id TEXT PRIMARY KEY, owner_id TEXT, capability_key TEXT, display_name TEXT,
      maturity TEXT, authority_ceiling TEXT, contract_json TEXT, minimum_sample INTEGER DEFAULT 30,
      required_accuracy REAL DEFAULT 0.9, maximum_calibration_gap REAL DEFAULT 0.08, emergency_paused INTEGER DEFAULT 0,
      last_reviewed_at TEXT, reviewed_by TEXT, created_at TEXT, updated_at TEXT);
    INSERT INTO life_automation_capabilities (id,owner_id,capability_key,display_name,maturity,authority_ceiling,contract_json,created_at,updated_at)
      VALUES ('c1','woody','waiting_inference','Waiting-condition inference','RECOMMEND','ASSIST','{}','${T}','${T}');
    CREATE TABLE life_confidence_predictions (id TEXT PRIMARY KEY, owner_id TEXT, capability_key TEXT, subject_type TEXT,
      subject_id TEXT, predicted_confidence REAL, decision_band TEXT, factors_json TEXT, model_version TEXT,
      rule_version TEXT, source_freshness_state TEXT, created_at TEXT);
    CREATE TABLE life_confidence_outcomes (id TEXT PRIMARY KEY, prediction_id TEXT, owner_id TEXT, resolution TEXT,
      severity TEXT, resolved_by TEXT, evidence_json TEXT DEFAULT '{}', resolved_at TEXT);
    CREATE TABLE life_automation_events (id TEXT PRIMARY KEY, owner_id TEXT, capability_id TEXT, event_type TEXT,
      from_maturity TEXT, to_maturity TEXT, reason TEXT, evidence_json TEXT DEFAULT '{}', actor_id TEXT, created_at TEXT);
    CREATE TABLE life_weekly_snapshots (id TEXT PRIMARY KEY, owner_id TEXT, week_start TEXT, week_end TEXT,
      evidence_json TEXT, proposed_big_three_json TEXT, approved_big_three_json TEXT, carry_forward_json TEXT DEFAULT '[]',
      subtraction_json TEXT DEFAULT '[]', status TEXT, approved_by TEXT, approved_at TEXT, created_at TEXT, updated_at TEXT);
    INSERT INTO life_weekly_snapshots (id,owner_id,week_start,week_end,evidence_json,proposed_big_three_json,carry_forward_json,subtraction_json,status,created_at,updated_at)
      VALUES ('ws1','woody','2026-08-03','2026-08-09','{"done_week":2,"captured_week":5,"cancelled_week":1}','[{"id":"t1","title":"ready task"}]','[]','[]','DRAFT','${T}','${T}');
    CREATE TABLE life_quarterly_reviews (id TEXT PRIMARY KEY, owner_id TEXT, period_start TEXT, period_end TEXT,
      outcomes_json TEXT, operating_patterns_json TEXT, automation_review_json TEXT, feature_review_json TEXT,
      learnings_json TEXT, roadmap_json TEXT, status TEXT, approved_by TEXT, approved_at TEXT, created_at TEXT, updated_at TEXT);
  `);
  db.close();
  return p;
}
const TASK = require('../mission-control/ui/pages/life/task.js');

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
      if (page.key === 'life-today') {
        assert.match(out.body, /Nothing has been captured yet/, 'today: owner-worded empty state');
        assert.match(out.body, /Capture your first task/, 'today: empty state is action-oriented');
      } else {
        assert.match(out.body, /life\.db not initialised/, `${page.key} names the gate (pre-restyle)`);
      }
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
      assert.ok(!WRITE_AFFORDANCE.test(out.body), `${page.key} emits no raw write mechanism`);
      assertOnlySanctionedLc(out.body, page.key);
    }
    const today = PAGES[0].render(PAGES[0].getSection(null, {}), {});
    // A5 acceptance, GOLDEN-MASTER form: Today stays calm — a fresh capture surfaces as the
    // triage line (one click to All tasks, where the Inbox lives); cancel lives in the drawer.
    assert.match(today.body, /1 fresh capture to sort/);
    assert.match(today.body, /triage in All tasks/);
    assert.match(today.body, /Capture, ask or command/, 'the capture bar rides the page head');
    const outcomes = PAGES[2].render(PAGES[2].getSection(null, {}), {});
    assert.ok(outcomes.body.includes('&lt;script&gt;'), 'DB strings render escaped');
    assert.ok(!outcomes.body.includes('<script>alert'), 'never raw');
    const waiting = PAGES[1].render(PAGES[1].getSection(null, {}), {});
    assert.match(waiting.body, /Lightspeed engineer/);
    const tasks = PAGES[4].render(PAGES[4].getSection(null, {}), {});
    assert.match(tasks.body, /WAITING/);
    // planner surfaces render LIVE from the fixture
    const today2 = PAGES[0].render(PAGES[0].getSection(null, { now: Date.parse(T) }), {});
    assert.match(today2.body, /Today's must-win/i);
    assert.match(today2.body, /approve_plan/, 'draft plan carries the approve action');
    assert.match(today2.body, /Quiet corner: nothing is moving on/, 'neglected aim named in owner words');
    assert.match(today2.body, /Needs you/, 'the decision area renders');
    assert.match(today2.body, /Rex — 07:05 owner brief/, 'the golden brief card renders');
    assert.match(today2.body, /Definition of done|Not written yet/, 'the must-win carries its definition-of-done block');
    assert.match(today2.body, /Outlook is not connected/, 'My day is the honest not-connected state');
    assert.match(today2.body, /class="rcc"/, 'today rides the shared RCC component set');
    // Scrub the OWNER-VISIBLE text only: machine payloads inside data-lc-* attributes carry
    // IDs (e.g. proposal 'pr1') that are not language the owner reads.
    const visible = today2.body.replace(/data-lc-[a-z-]+="[^"]*"/g, '');
    const OWNER_SCRUB = /(PR\s?#?\d+|\bschema\b|DB-enforced|engine PR|\bPhase\b|sole writer|life\.db)/i;
    assert.ok(!OWNER_SCRUB.test(visible), 'today speaks owner, never engineer');
    const review = PAGES[5].render(PAGES[5].getSection(null, {}), {});
    assert.match(review.body, /Week of 2026-08-03 — DRAFT/);
    assert.match(review.body, /approve_week/);
    const trust = PAGES[6].render(PAGES[6].getSection(null, {}), {});
    assert.match(trust.body, /Waiting-condition inference/);
    assert.match(trust.body, /pause_capability/);
    const drawer = TASK.render(TASK.getSection(null, { query: { id: 't1' } }), {});
    assert.match(drawer.body, /Add update/);
    assert.match(drawer.body, /record only — do not act/);
    assert.match(drawer.body, /waiting_inference/, 'open proposal card renders');
    assert.ok(drawer.body.includes('waiting on the &lt;engineer&gt;'), 'note text escaped byte-for-byte');
    assert.match(drawer.body, /Audit trail/);
    assertOnlySanctionedLc(drawer.body, 'life-task');
    const waiting2 = PAGES[1].render(PAGES[1].getSection(null, {}), {});
    assert.match(waiting2.body, /data-lc-cmd/, 'wake button present');
  });

test('workspaceOf: the drawer key (no sidebar slot) still resolves to the life workspace', () => {
  assert.equal(SHARED.workspaceOf('life-task').key, 'life');
  assert.equal(SHARED.workspaceOf('engine').key, 'claw', 'existing keys unchanged');
  assert.equal(SHARED.workspaceOf('nonexistent').key, 'coyote', 'unknown keys still default to the first workspace');
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

test('A5: the capture affordance ships in the shell of ALL THREE workspaces', () => {
  for (const active of ['overview', 'engine', 'life-today']) {
    const html = SHARED.renderShell({ active, title: 't', sub: '', stamp: '', body: '', badges: {}, foot: [] });
    assert.ok(html.includes('data-lc-fab'), `${active}: FAB present`);
    assert.ok(html.includes('data-lc-overlay'), `${active}: overlay present`);
    assert.ok(html.includes('/api/life/capture'), `${active}: script posts to the gated path`);
    assert.ok(html.includes('/api/life/cancel'), `${active}: cancel handler present`);
    assert.ok(html.includes('__lcOpen'), `${active}: the 30s soft-reload respects an open overlay`);
  }
  // Mobile-relevant: touch targets are >= 44px and the input is >= 16px (no iOS zoom-jump).
  const css = SHARED.css();
  assert.match(css, /\.lc-btn\{min-height:44px/);
  assert.match(css, /\.lc-fab\{[^}]*width:52px/);
  assert.match(css, /\.lc-input\{[^}]*font-size:17px/);
});

test('negative control: the write-affordance tripwire catches a mutant', () => {
  assert.ok(WRITE_AFFORDANCE.test('<button data-op="approve">'), 'data-op caught');
  assert.ok(WRITE_AFFORDANCE.test('<form method="POST" action="/api/life/capture">'), 'form caught');
  assert.ok(!WRITE_AFFORDANCE.test('<a href="/life/tasks">tasks</a>'), 'plain links pass');
});
