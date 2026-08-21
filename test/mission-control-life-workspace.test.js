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

// Sidebar order (visual pack v1.1.0): Focus · Plan · Review · System — twelve surfaces.
const PAGES = [
  require('../mission-control/ui/pages/life/today.js'),
  require('../mission-control/ui/pages/life/waiting.js'),
  require('../mission-control/ui/pages/life/outcomes.js'),
  require('../mission-control/ui/pages/life/projects.js'),
  require('../mission-control/ui/pages/life/tasks.js'),
  require('../mission-control/ui/pages/life/schedule.js'),
  require('../mission-control/ui/pages/life/recurring.js'),
  require('../mission-control/ui/pages/life/review.js'),
  require('../mission-control/ui/pages/life/quarterly.js'),
  require('../mission-control/ui/pages/life/trust.js'),
  require('../mission-control/ui/pages/life/agents.js'),
  require('../mission-control/ui/pages/life/settings.js'),
];

// Pages are looked up BY KEY, never by position. This list is order-pinned against the
// sidebar, so an insertion shifts every index after it — and a positional assertion then
// quietly starts testing a different page instead of failing. (It did: adding Recurring
// moved review and trust down one.)
const P = (key) => {
  const page = PAGES.find((p) => p.key === key);
  assert.ok(page, `no such life page: ${key}`);
  return page;
};

const T = '2026-08-05T12:00:00.000Z';
// The tripwire, EVOLVED AGAIN with the planner surfaces: life page bodies still may not
// carry raw write mechanisms (fetch/XHR/data-op/POST forms) — the sanctioned affordances
// are the allowlist-pinned data-lc-* family plus the lc-note-form, ALL of whose handlers
// live in the shared shell and post exclusively to the gated /api/life/* relay. Every
// data-lc-cmd payload must parse as JSON naming a writer-allowlisted command.
const WRITE_AFFORDANCE = /data-op|data-log-action|fetch\(|xhr|XMLHttpRequest|method="post"/i;
const SANCTIONED_LC = new Set(['data-lc-cancel', 'data-lc-cmd', 'data-lc-complete', 'data-lc-wait', 'data-lc-edit', 'data-lc-fab', 'data-lc-focus', 'data-lc-quiet', 'data-lc-route',
  'data-lc-rename', 'data-lc-cancel-project', 'data-lc-import', 'data-lc-recap', 'data-lc-assign-bulk',
  'data-lc-mailedit', 'data-lc-due', 'data-lc-replied',
  // Batch decide (Wave 3, 2026-08-13): sugar over per-proposal audited `decide` posts —
  // the shell handler posts one allowlisted command per ticked row, same relay, same gates.
  'data-lc-batch', 'data-lc-batch-all',
  // Task files (operator ask 2026-08-13): the picker posts RAW bytes to the auth-walled
  // upload endpoint; the sole writer attaches. The note input is plain data for that post.
  'data-lc-taskfile', 'data-lc-taskfile-note',
  // Repeats setter (operator ask 2026-08-18): one prompt sets/clears a task's cadence via
  // the allowlisted set_recurrence relay; the grammar is refused client-side by the same
  // regex the advancer parses, and the writer re-validates.
  'data-lc-setrecur']);
const CMD_ALLOWLIST = new Set(['note', 'decide', 'transition', 'complete', 'set_waiting', 'wake', 'reopen', 'undo', 'cancel',
  'plan_today', 'approve_plan', 'compile_week', 'approve_week', 'compile_quarter', 'approve_quarter',
  'pause_capability', 'resume_capability', 'create_outcome', 'create_project', 'set_route', 'set_setting',
  'rename_task', 'rename_project', 'cancel_project', 'import_preview', 'import_batch', 'assign_project', 'accept_standalone',
  'calendar_sync', 'park_project', 'activate_project', 'place_block', 'remove_block', 'move_block', 'swap_block', 'mail_sync', 'set_due', 'mail_owner_replied', 'mail_paid',
  'remove_task_file', 'renew_dispatch']);
function assertOnlySanctionedLc(body, key) {
  for (const m of body.matchAll(/data-lc-[a-z-]+/g)) {
    assert.ok(SANCTIONED_LC.has(m[0]), `${key}: unsanctioned life affordance ${m[0]}`);
  }
  for (const m of body.matchAll(/<form\b[^>]*/g)) {
    // lc-search-form (Wave 3, 2026-08-13) is GET-only — a read affordance (the All-tasks
    // database search), pinned as such right here so it can never quietly grow a POST.
    assert.ok(/lc-note-form|lc-create-form|lc-replied-form|lc-search-form/.test(m[0]), `${key}: only the sanctioned form classes`);
    if (/lc-search-form/.test(m[0])) assert.match(m[0], /method="get"/, `${key}: the search form must stay GET-only`);
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
    CREATE TABLE life_tasks (id TEXT PRIMARY KEY, owner_id TEXT, outcome_id TEXT, project_id TEXT, domain_key TEXT,
      title TEXT, status TEXT, execution_mode TEXT, definition_of_done TEXT DEFAULT '', due_kind TEXT DEFAULT 'NONE', due_at TEXT, estimate_minutes INTEGER,
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
    CREATE TABLE life_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
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
  // AMENDMENT 2 (2026-08-05) as amended by the calendar GO (2026-08-10): Schedule's
  // populated view now exists, but with NOTHING KNOWN (empty section — no life.db, no
  // mirror, no completed sync) it must still be the honest not-connected state, and
  // Agent activity stays gated. These assertions are the not-connected pin.
  const sched = PAGES.find((pg) => pg.key === 'life-schedule').render({}, {});
  assert.match(sched.body, /Outlook is not connected/);
  assert.ok(!/\d{2}:\d{2}/.test(sched.body.replace(/<style>[\s\S]*?<\/style>/, '')), 'no times invented on an unconnected schedule');
  // Wave 3 (2026-08-13 audit F3): the old "No agents are connected yet" empty-state was
  // FALSE against five live deliverables. The page now reads life.db; with an empty section
  // it renders the honest zero-state instead.
  const ag = PAGES.find((pg) => pg.key === 'life-agents').render({}, {});
  assert.match(ag.body, /Nothing has worked on your behalf yet/);
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
      // EVERY life page speaks owner in absence now (visual pack + amendments): a truthful
      // line and a useful action — never an engineering gate line.
      assert.match(out.body, /Nothing has been captured yet|Outlook is not connected|No agents are connected|Not enough evidence|The standing design charter/,
        `${page.key}: owner-worded empty state`);
      assert.ok(!/life\.db|unlock:|scaffold/i.test(out.body.replace(/data-lc-[a-z-]+="[^"]*"/g, '')), `${page.key}: no scaffold language in absence`);
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
    const today = P('life-today').render(P('life-today').getSection(null, {}), {});
    // A5 acceptance, GOLDEN-MASTER form: Today stays calm — a fresh capture surfaces as the
    // triage line (one click to All tasks, where the Inbox lives); cancel lives in the drawer.
    assert.match(today.body, /1 fresh capture to sort/);
    assert.match(today.body, /triage in All tasks/);
    assert.match(today.body, /Capture, ask or command/, 'the capture bar rides the page head');
    const outcomes = P('life-outcomes').render(P('life-outcomes').getSection(null, {}), {});
    assert.ok(outcomes.body.includes('&lt;script&gt;'), 'DB strings render escaped');
    assert.ok(!outcomes.body.includes('<script>alert'), 'never raw');
    const waiting = P('life-waiting').render(P('life-waiting').getSection(null, {}), {});
    assert.match(waiting.body, /Lightspeed engineer/);
    const tasks = P('life-tasks').render(P('life-tasks').getSection(null, {}), {});
    assert.match(tasks.body, /Waiting/, 'the waiting section renders in owner case');
    // Wave 3 (2026-08-13 audit F1): the DOM-only filter became a DATABASE search — the old
    // one searched the fetched 100 rows and could report nothing for a task that exists.
    assert.match(tasks.body, /Search every open task/, 'search/filter control present');
    // planner surfaces render LIVE from the fixture
    const today2 = P('life-today').render(P('life-today').getSection(null, { now: Date.parse(T) }), {});
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
    // \bPR is load-bearing: unanchored, /PR\s?#?\d+/i matches the "pr 2027" inside "Apr 2027",
    // so any April date in a title would fail this for speaking English correctly.
    const OWNER_SCRUB = /(\bPR\s?#?\d+|\bschema\b|DB-enforced|engine PR|\bPhase\b|sole writer|life\.db)/i;
    assert.ok(!OWNER_SCRUB.test(visible), 'today speaks owner, never engineer');
    const review = P('life-review').render(P('life-review').getSection(null, {}), {});
    assert.match(review.body, /week of 2026-08-03/);
    assert.match(review.body, /approve_week/);
    const trust = P('life-trust').render(P('life-trust').getSection(null, {}), {});
    assert.match(trust.body, /Waiting-condition inference/);
    assert.match(trust.body, /pause_capability/);
    assert.match(trust.body, /Not enough observations yet/, 'per-capability honesty, no synthetic score');
    const outc = P('life-outcomes').render(P('life-outcomes').getSection(null, {}), {});
    assert.match(outc.body, /Proof of completion/);
    assert.match(outc.body, /open outcome slot/i, 'slots render, never six zero counters');
    assert.match(outc.body, /lc-create-form/, 'the Add outcome action exists');
    const drawer = TASK.render(TASK.getSection(null, { query: { id: 't1' } }), {});
    assert.match(drawer.body, /Add update/);
    assert.match(drawer.body, /record only — do not act/);
    assert.match(drawer.body, /waiting inference/, 'open proposal card renders (capability humanised)');
    assert.match(drawer.body, /r-conf/, 'proposal carries a contextual confidence chip (A3)');
    assert.match(drawer.body, /lc-route-sel/, 'the execution-route control renders in the drawer (A3)');
    assert.match(drawer.body, /Handoffs &amp; history/, 'handoff detail lives in the drawer (A3 placement)');
    assert.ok(drawer.body.includes('waiting on the &lt;engineer&gt;'), 'note text escaped byte-for-byte');
    assert.match(drawer.body, /Handoffs &amp; history/, "audit trail reframed as handoffs (A3)");
    assertOnlySanctionedLc(drawer.body, 'life-task');
    const waiting2 = P('life-waiting').render(P('life-waiting').getSection(null, {}), {});
    assert.match(waiting2.body, /data-lc-cmd/, 'wake button present');
    assert.match(waiting2.body, /Waiting on Lightspeed engineer/, 'the dependency reads as a sentence');
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

test('owner-language: no engineering vocabulary in ANY life page title or subtitle (the page-head strings the body scan misses — regression guard from the A3 review 2026-08-06)', () => {
  const OWNER_SCRUB = /(PR\s?#?\d+|\bschema\b|DB-enforced|engine PR|\bphase\b|sole writer|life\.db|\bmigration\b|unlock:|scaffold)/i;
  const TASK = require('../mission-control/ui/pages/life/task.js');
  for (const page of [...PAGES, TASK]) {
    assert.ok(!OWNER_SCRUB.test(String(page.title || '')), `${page.key}: forbidden term in title "${page.title}"`);
    assert.ok(!OWNER_SCRUB.test(String(page.sub || '')), `${page.key}: forbidden term in subtitle "${page.sub}"`);
  }
  // the life-lib owner-facing fallback reasons must be owner-voice too (defence-in-depth)
  const LIFELIB = require('../mission-control/ui/pages/life/life-lib.js');
  const prev = process.env.COYOTE_LIFE_DB;
  process.env.COYOTE_LIFE_DB = require('node:path').join(require('node:os').tmpdir(), 'nonexistent-life-xyz', 'life.db');
  const r = LIFELIB.openLifeReadonly();
  if (prev === undefined) delete process.env.COYOTE_LIFE_DB; else process.env.COYOTE_LIFE_DB = prev;
  assert.equal(r.ok, false);
  assert.ok(!OWNER_SCRUB.test(String(r.reason || '')), `life-lib absent reason leaks engineering vocab: "${r.reason}"`);
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

// ============================================================================
// OWNER-LANGUAGE TRIPWIRE, EXTENDED TO CLIENT-SIDE ERROR PATHS (first-real-use defect 2,
// 2026-08-08): the page-copy/title scans above never saw the JS error paths, and a raw
// alert('refused: create_project: definitionOfDone required…') leaked browser chrome with
// command vocabulary at the owner. Refusals now render INLINE in owner language; the raw
// writer message goes to console.warn only.

test('client error paths: NO browser alert() anywhere in the shell script, and none in any life page module', () => {
  // The shell client script ships on EVERY page — life included — so one alert anywhere
  // in it is an alert reachable on a life surface.
  for (const active of ['life-today', 'overview', 'engine']) {
    const html = SHARED.renderShell({ active, title: 't', sub: '', stamp: '', body: '', badges: {}, foot: [] });
    const script = html.slice(html.indexOf('<script>'));
    assert.ok(!/\balert\s*\(/.test(script), `${active}: the shell client script must never alert() — refusals render inline`);
    assert.ok(script.includes('window.__lcSay='), `${active}: the inline-message renderer ships`);
    assert.ok(script.includes('window.__lcOwnerCopy='), `${active}: the owner-copy translator ships`);
    assert.ok(script.includes("console.warn('life write refused:'"), `${active}: the raw writer message stays available to a debugger`);
  }
  // And no life page module smuggles its own alert()/prompt-based error rendering in.
  const lifeDir = path.join(__dirname, '..', 'mission-control', 'ui', 'pages', 'life');
  for (const f of fs.readdirSync(lifeDir)) {
    const src = fs.readFileSync(path.join(lifeDir, f), 'utf8');
    assert.ok(!/\balert\s*\(/.test(src), `${f}: no browser alert in life page modules`);
  }
});

test('writer refusals map to DESIGNED OWNER COPY: the named first-use leaks, capacity refusals, and the honest fallback', () => {
  // The exact refusals that leaked (or nearly did) on first real use, translated:
  assert.equal(SHARED.ownerRefusalCopy('create_project: definitionOfDone required (≤500 chars)'),
    'Every project needs a definition of done — how will you know it is finished?');
  assert.equal(SHARED.ownerRefusalCopy('create_outcome: proofDefinition required (≤500 chars) — an outcome without proof of completion is a wish'),
    'Every outcome needs its proof of completion — what evidence will exist when it is done?');
  assert.equal(SHARED.ownerRefusalCopy('maximum three active outcomes'),
    'Three active outcomes is the ceiling — finish or park one to open the slot.');
  assert.equal(SHARED.ownerRefusalCopy('maximum four active projects'),
    'Four active projects is the ceiling — finish or park one to open the slot.');
  assert.equal(SHARED.ownerRefusalCopy('set_waiting: fallbackAt required — waiting work must never rot silently'),
    'A follow-up date is needed — waiting work must never rot silently.');
  assert.equal(SHARED.ownerRefusalCopy('HALT engaged (drill) — life commands refused, nothing applied'),
    'Everything is paused right now — nothing was changed. Try again once things resume.');
  assert.equal(SHARED.ownerRefusalCopy('cancel: task is DONE (terminal) — completed work is not erased'),
    'Finished work stays finished — reopen it from its page if it truly is not done.');
  // Unknown writer messages fall back to honest owner copy that names the no-change guarantee:
  assert.match(SHARED.ownerRefusalCopy('capture: idempotencyKey must be 8–128 chars when given'), /nothing was changed/i);
  assert.match(SHARED.ownerRefusalCopy(undefined), /nothing was changed/i);
});

test('rename & delete (operator ask 2026-08-08): every living task/project offers rename + cancel in place; finished work offers neither', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-life-'));
  const dbPath = makeFixture(dir);
  const db = new sqlite.DatabaseSync(dbPath);
  db.exec(`INSERT INTO life_projects (id, owner_id, domain_key, title, definition_of_done, stage, status, risk_state, due_date, visibility, created_at, updated_at) VALUES
    ('pj1','woody','business','Loyalty pilot','Pilot live.','BUILD','ACTIVE','GREEN',NULL,'OWNER_ONLY','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z'),
    ('pj2','woody','family','Parked thing','d','PARKED','PARKED','GREEN',NULL,'OWNER_ONLY','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z'),
    ('pj3','woody','admin','Shipped thing','d','DONE','DONE','GREEN',NULL,'OWNER_ONLY','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z')`);
  db.close();
  const decodeAttr = (s) => JSON.parse(s.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&#39;', "'"));
  withEnv(dbPath, () => {
    const PROJECTS = PAGES.find((p) => p.key === 'life-projects');
    const out = PROJECTS.render(PROJECTS.getSection(null, {}), {});
    assert.match(out.body, /data-lc-cancel-project="pj1"/, 'active project card offers cancel');
    assert.match(out.body, /data-lc-cancel-project="pj2"/, 'parked project row offers cancel too');
    assert.ok(!out.body.includes('data-lc-cancel-project="pj3"'), 'DONE project offers NO delete — completed work is not erased');
    const renames = [...out.body.matchAll(/data-lc-rename="([^"]*)"/g)].map((m) => decodeAttr(m[1]));
    assert.ok(renames.some((r) => r.kind === 'project' && r.id === 'pj1' && r.title === 'Loyalty pilot'),
      'rename carries the CURRENT name so the prompt opens prefilled');
    assert.ok(!renames.some((r) => r.id === 'pj3'), 'DONE project offers no rename — finished work keeps its name');
    assertOnlySanctionedLc(out.body, 'life-projects');
    const TASKS = PAGES.find((p) => p.key === 'life-tasks');
    const tout = TASKS.render(TASKS.getSection(null, {}), {});
    assert.match(tout.body, /data-lc-rename/, 'task rows offer rename without opening the drawer');
    assert.match(tout.body, /data-lc-cancel="t1"/, 'task rows offer cancel without opening the drawer');
    const trow = [...tout.body.matchAll(/data-lc-rename="([^"]*)"/g)].map((m) => decodeAttr(m[1]));
    assert.ok(trow.every((r) => r.kind === 'task' && r.id && typeof r.title === 'string'), 'row rename payloads are complete');
    assertOnlySanctionedLc(tout.body, 'life-tasks');
    const dout = TASK.render(TASK.getSection(null, { query: { id: 't1' } }), {});
    assert.match(dout.body, /data-lc-rename/, 'the drawer offers rename');
    assertOnlySanctionedLc(dout.body, 'life-task');
  });
  fs.rmSync(dir, { recursive: true, force: true });
  // The shell ships the handlers, and the relay accepts exactly the sane shapes.
  const html = SHARED.renderShell({ active: 'life-today', title: 't', sub: '', stamp: '', body: '', badges: {}, foot: [] });
  for (const name of ['rename_task', 'rename_project', 'cancel_project']) {
    assert.ok(html.includes(`'${name}'`) || html.includes(`"${name}"`), `shell client script posts ${name}`);
  }
  const LIFECMD = require('../mission-control/ui/life-command-lib.js');
  const key = 'k'.repeat(16);
  assert.ok(LIFECMD.validateCommand({ command: 'rename_task', idempotencyKey: key, payload: { taskId: 't1', title: 'New name' } }).ok);
  assert.ok(LIFECMD.validateCommand({ command: 'rename_project', idempotencyKey: key, payload: { projectId: 'p1', title: 'New name' } }).ok);
  assert.ok(LIFECMD.validateCommand({ command: 'cancel_project', idempotencyKey: key, payload: { projectId: 'p1' } }).ok);
  assert.ok(!LIFECMD.validateCommand({ command: 'rename_task', idempotencyKey: key, payload: { taskId: 't1', title: '   ' } }).ok, 'blank name refused at the relay');
  assert.ok(!LIFECMD.validateCommand({ command: 'rename_project', idempotencyKey: key, payload: { projectId: 'p1', title: 'x'.repeat(201) } }).ok, 'over-cap name refused at the relay');
  assert.ok(!LIFECMD.validateCommand({ command: 'cancel_project', idempotencyKey: key, payload: {} }).ok, 'missing id refused at the relay');
});

test('bulk import (operator brief 2026-08-08): the inbox panel lists files with a Preview affordance; empty state honest; shell ships the staged handlers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-life-imp-'));
  const dbPath = makeFixture(dir);
  const inbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-life-inbox-'));
  const prevInbox = process.env.COYOTE_LIFE_IMPORT_DIR;
  process.env.COYOTE_LIFE_IMPORT_DIR = inbox;
  try {
    const TASKS = PAGES.find((p) => p.key === 'life-tasks');
    withEnv(dbPath, () => {
      const empty = TASKS.render(TASKS.getSection(null, {}), {});
      assert.match(empty.body, /The import inbox is empty/, 'empty inbox says so, names the folder');
      assert.match(empty.body, /life-os-imports/);
      assert.match(empty.body, /data-import-out/, 'the preview target exists');
      fs.writeFileSync(path.join(inbox, 'loyalty.csv'), 'Task,Owner\nx,Woody\n');
      fs.writeFileSync(path.join(inbox, 'notes.txt'), 'not importable');
      const withFile = TASKS.render(TASKS.getSection(null, {}), {});
      assert.match(withFile.body, /data-lc-import="loyalty\.csv"/, 'the dropped file offers Preview');
      assert.ok(!withFile.body.includes('notes.txt'), 'only .csv/.xlsx are listed');
      assert.match(withFile.body, /Preview first — nothing is created until you commit/, 'the staged promise is on the panel');
      assertOnlySanctionedLc(withFile.body, 'life-tasks');
    });
    // The shell ships the staged handlers and the relay accepts exactly the sane shapes.
    const html = SHARED.renderShell({ active: 'life-tasks', title: 't', sub: '', stamp: '', body: '', badges: {}, foot: [] });
    assert.ok(html.includes("'import_preview'") || html.includes('"import_preview"'), 'shell posts import_preview');
    assert.ok(html.includes("'import_batch'") || html.includes('"import_batch"'), 'shell posts import_batch');
    assert.ok(html.includes('__lcHoldRefresh'), 'a rendered preview/report pins the soft refresh open');
    assert.ok(/textContent/.test(html) && !/impPreviewRender[\s\S]{0,3000}innerHTML/.test(html.slice(html.indexOf('impPreviewRender'))),
      'preview renders file-derived text via textContent, never markup');
    const LIFECMD = require('../mission-control/ui/life-command-lib.js');
    const key = 'k'.repeat(16);
    assert.ok(LIFECMD.validateCommand({ command: 'import_preview', idempotencyKey: key, payload: { fileName: 'loyalty.csv' } }).ok);
    assert.ok(LIFECMD.validateCommand({ command: 'import_batch', idempotencyKey: key, payload: { fileName: 'loyalty.csv', dispositions: [{ source: 'x', choice: 'skip' }], project: { title: 'Como Loyalty Launch', definitionOfDone: 'd' } } }).ok);
    assert.ok(!LIFECMD.validateCommand({ command: 'import_preview', idempotencyKey: key, payload: {} }).ok, 'a nameless preview refused at the relay');
    assert.ok(!LIFECMD.validateCommand({ command: 'import_batch', idempotencyKey: key, payload: { fileName: 'x.csv', dispositions: 'all' } }).ok, 'non-array rulings refused at the relay');
  } finally {
    if (prevInbox === undefined) delete process.env.COYOTE_LIFE_IMPORT_DIR; else process.env.COYOTE_LIFE_IMPORT_DIR = prevInbox;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(inbox, { recursive: true, force: true });
  }
});

test('recapture-on-complete (operator GO 2026-08-10): flagged tasks offer the prefilled recapture; cadence math is a fixed table; declines are deliberate', () => {
  // Cadence table — month arithmetic clamps the day; statutory labels all resolve.
  assert.equal(SHARED.advanceCadence('Monthly', '2026-08-29'), '2026-09-29');
  assert.equal(SHARED.advanceCadence('Monthly', '2026-01-31'), '2026-02-28', 'day clamps at month end');
  assert.equal(SHARED.advanceCadence('Quarterly', '2026-09-07'), '2026-12-07');
  assert.equal(SHARED.advanceCadence('Annually', '2026-11-06'), '2027-11-06');
  assert.equal(SHARED.advanceCadence('Fortnightly', '2026-08-17'), '2026-08-31');
  assert.equal(SHARED.advanceCadence('Every 6 weeks', '2026-08-14'), '2026-09-25');
  assert.equal(SHARED.advanceCadence('Six-monthly and after form/legal changes', '2026-08-10'), '2027-02-10', 'six-monthly beats the month rule');
  assert.equal(SHARED.advanceCadence('whenever', '2026-08-10'), '2026-09-10', 'unknown label suggests a month — the prompt is editable, never silent');
  // Drawer: a flagged task's Mark-done carries the recap payload + a repeats tag; unflagged has neither.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-life-rc-'));
  const dbPath = makeFixture(dir);
  const db = new sqlite.DatabaseSync(dbPath);
  db.exec("ALTER TABLE life_tasks ADD COLUMN recurs TEXT");
  db.exec(`INSERT INTO life_tasks (id, owner_id, domain_key, title, status, risk_level, visibility, source_type, created_by, created_at, updated_at, recurs, due_at, due_kind)
    VALUES ('t-vat','woody','business','VAT analysis and payment','READY','LOW','OWNER_ONLY','IMPORT','HUMAN:woody-import','2026-08-10T00:00:00Z','2026-08-10T00:00:00Z','Quarterly','2026-09-07T09:00:00.000Z','TARGET')`);
  db.close();
  withEnv(dbPath, () => {
    const TASK2 = require('../mission-control/ui/pages/life/task.js');
    const flagged = TASK2.render(TASK2.getSection(null, { query: { id: 't-vat' } }), {});
    assert.match(flagged.body, /data-lc-recap=/, 'the flagged Mark-done carries the recapture payload');
    const payload = /data-lc-recap="([^"]*)"/.exec(flagged.body);
    const decoded = JSON.parse(payload[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&#39;', "'"));
    assert.deepEqual(decoded, { cadence: 'Quarterly', due: '2026-09-07' }, 'cadence + due ride the button for the prefill');
    assert.match(flagged.body, /repeats · quarterly/, 'the obligation is visible on the drawer');
    assertOnlySanctionedLc(flagged.body, 'life-task');
    const plain = TASK2.render(TASK2.getSection(null, { query: { id: 't1' } }), {});
    assert.ok(!plain.body.includes('data-lc-recap'), 'ordinary tasks stay one-step');
  });
  fs.rmSync(dir, { recursive: true, force: true });
  // Shell wiring: the serialized cadence fn is the exported one; both decision paths ship.
  const html = SHARED.renderShell({ active: 'life-today', title: 't', sub: '', stamp: '', body: '', badges: {}, foot: [] });
  assert.ok(html.includes(`window.__lcNextDate=(${SHARED.advanceCadence.toString()})`), 'client cadence math is the tested export, byte-identical');
  assert.ok(html.includes('declineRecapture'), 'the audited-decline path ships');
  assert.ok(html.includes('recapture={nextDate:'), 'the recapture path ships');
  assert.ok(html.includes('Decline the recapture?'), 'dismissing goes through one named confirm');
  // TEMPLATE-COOKING PIN (live bug found 2026-08-10): a bare \d in the clientScript
  // template literal cooks to plain 'd', silently breaking date validation (the
  // Park-waiting check shipped broken this way). The RENDERED script must carry REAL
  // date regexes — both of them (recapture + park-waiting).
  const rendered = (html.match(/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/g) || []).length;
  assert.ok(rendered >= 2, `both client date regexes survive template cooking (found ${rendered})`);
  assert.ok(!/\^d\{4\}-d\{2\}-d\{2\}/.test(html), 'no cooked-to-death date regex anywhere in the shell');
});

test('agent deliverables (dispatch rung 2026-08-10): ALWAYS material on Today, Accept wording, never quiet-folded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-life-ad-'));
  const dbPath = makeFixture(dir);
  const db = new sqlite.DatabaseSync(dbPath);
  db.exec(`INSERT INTO life_update_proposals (id,owner_id,update_id,task_id,capability_key,command_type,command_json,reason,confidence,risk_level,authority_class,state,created_at)
    VALUES ('agp1','woody','u1','t1','agent_delivery','complete','{"taskId":"t1","evidenceNote":"KPI baseline numbers attached"}','The boxquery agent finished job abc12345.',0.8,'LOW','INTERNAL_WRITE','PROPOSED','2026-08-05T10:00:00Z')`);
  // quiet-support ON — a plain suggestion would fold; the agent deliverable must NOT.
  db.exec("CREATE TABLE IF NOT EXISTS life_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)");
  db.exec("INSERT OR REPLACE INTO life_settings (key,value,updated_at) VALUES ('quiet_support','on','2026-08-05T10:00:00Z')");
  db.close();
  withEnv(dbPath, () => {
    const TODAY = PAGES.find((p2) => p2.key === 'life-today');
    const out = TODAY.render(TODAY.getSection(null, { now: Date.parse(T) }), { now: Date.parse(T) });
    assert.match(out.body, /Agent deliverable awaiting your accept/, 'the deliverable renders with its own copy');
    // Wave 3 (2026-08-13 audit): the deliverable CONTENT renders on the card — the only
    // material class without an inline preview was the one the owner never accepted.
    assert.match(out.body, /Accept completes the task with it attached as evidence/);
    assert.match(out.body, /KPI baseline numbers attached/, 'the evidenceNote is ON the card, not behind an Inspect round-trip');
    const cmds = [...out.body.matchAll(/data-lc-cmd="([^"]*)"/g)].map((m) => JSON.parse(m[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&')));
    assert.ok(cmds.some((c) => c.command === 'decide' && c.payload && c.payload.proposalId === 'agp1' && c.payload.decision === 'accept'), 'Accept posts the existing decide command — the owner tap IS the state change');
    assertOnlySanctionedLc(out.body, 'life-today');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('task-to-project assignment (triage ruling 2026-08-10): the decision verb on drawer + rows + bulk, parked labelled, Inbox offers Accept standalone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-life-as-'));
  const dbPath = makeFixture(dir);
  const db = new sqlite.DatabaseSync(dbPath);
  db.exec(`INSERT INTO life_projects (id, owner_id, domain_key, title, definition_of_done, stage, status, risk_state, due_date, visibility, created_at, updated_at) VALUES
    ('pjA','woody','business','Como Loyalty Launch','d','BUILD','ACTIVE','GREEN',NULL,'OWNER_ONLY','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z'),
    ('pjP','woody','venture','Burger Van','d','DEFINE','PARKED','GREEN',NULL,'OWNER_ONLY','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z'),
    ('pjX','woody','admin','Dead','d','DEFINE','CANCELLED','GREEN',NULL,'OWNER_ONLY','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z')`);
  db.exec("UPDATE life_tasks SET project_id='pjA' WHERE id='t1'");
  db.close();
  withEnv(dbPath, () => {
    const TASK2 = require('../mission-control/ui/pages/life/task.js');
    const drawer = TASK2.render(TASK2.getSection(null, { query: { id: 't1' } }), {});
    assert.match(drawer.body, /lc-assign-sel/, 'the drawer carries the project select');
    assert.match(drawer.body, /Burger Van \(parked\)/, 'parked projects are labelled — assigning in is choosing the park');
    assert.ok(!drawer.body.includes('Dead'), 'cancelled projects never offered');
    assert.match(drawer.body, /value="pjA" selected/, 'current assignment selected');
    assert.match(drawer.body, /project: Como Loyalty Launch/, 'the home is visible on the drawer head');
    assertOnlySanctionedLc(drawer.body, 'life-task');
    const inbox = TASK2.render(TASK2.getSection(null, { query: { id: 't0' } }), {});
    const cmds = [...inbox.body.matchAll(/data-lc-cmd="([^"]*)"/g)].map((m) => JSON.parse(m[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&')));
    assert.ok(cmds.some((c) => c.command === 'accept_standalone'), 'Inbox offers the explicit standalone acceptance');
    assert.ok(!cmds.some((c) => c.command === 'transition' && c.payload && c.payload.to === 'READY'), 'the anonymous Ready transition left the Inbox drawer');
    const TASKS2 = PAGES.find((p2) => p2.key === 'life-tasks');
    const rows = TASKS2.render(TASKS2.getSection(null, {}), {});
    assert.match(rows.body, /data-task-id="t1"/, 'rows carry ids for the bulk sugar');
    assert.ok((rows.body.match(/lc-assign-sel/g) || []).length >= 2, 'inline selects on rows — no drawer round-trips');
    assert.match(rows.body, /data-lc-assign-bulk/, 'bulk apply affordance present');
    assert.match(rows.body, /data-assign-bulk-sel/, 'bulk project picker present');
    assertOnlySanctionedLc(rows.body, 'life-tasks');
  });
  fs.rmSync(dir, { recursive: true, force: true });
  // Shell + relay wiring.
  const html = SHARED.renderShell({ active: 'life-tasks', title: 't', sub: '', stamp: '', body: '', badges: {}, foot: [] });
  assert.ok(html.includes("'assign_project'"), 'shell posts assign_project');
  assert.ok(html.includes('Each gets its own record.'), 'bulk is sugar over per-task audited commands, and says so');
  const LIFECMD = require('../mission-control/ui/life-command-lib.js');
  const key = 'k'.repeat(16);
  assert.ok(LIFECMD.validateCommand({ command: 'assign_project', idempotencyKey: key, payload: { taskId: 't1', projectId: 'p1' } }).ok);
  assert.ok(LIFECMD.validateCommand({ command: 'assign_project', idempotencyKey: key, payload: { taskId: 't1', projectId: null } }).ok, 'explicit null clears');
  assert.ok(!LIFECMD.validateCommand({ command: 'assign_project', idempotencyKey: key, payload: { taskId: 't1', projectId: '' } }).ok, 'empty-string project refused at the relay');
  assert.ok(LIFECMD.validateCommand({ command: 'accept_standalone', idempotencyKey: key, payload: { taskId: 't1' } }).ok);
});

test('owner copy is owner-clean: no command vocabulary, no engineering terms, in ANY mapped sentence or the fallback', () => {
  const OWNER_SCRUB = /(PR\s?#?\d+|\bschema\b|DB-enforced|engine PR|\bphase\b|sole writer|life\.db|\bmigration\b|unlock:|scaffold)/i;
  const CMD_VOCAB = /[a-z]+_[a-z]+|\b[a-z]+[A-Z][a-zA-Z]*|idempoten|payload|writer|\bjson\b|\bhttp\b|\bapi\b/;
  for (const [key, copy] of SHARED.LIFE_REFUSAL_COPY) {
    assert.ok(typeof key === 'string' && key === key.toLowerCase(), `match key must be lowercase: ${key}`);
    assert.ok(!OWNER_SCRUB.test(copy), `engineering vocab in owner copy: "${copy}"`);
    assert.ok(!CMD_VOCAB.test(copy), `command vocabulary leaked into owner copy: "${copy}"`);
  }
  assert.ok(!CMD_VOCAB.test(SHARED.LIFE_REFUSAL_FALLBACK), 'fallback is owner-clean');
  // The client ships the SAME table — serialized verbatim, so shipped copy cannot drift
  // from the copy these tests just approved.
  const html = SHARED.renderShell({ active: 'life-today', title: 't', sub: '', stamp: '', body: '', badges: {}, foot: [] });
  assert.ok(html.includes(JSON.stringify(SHARED.LIFE_REFUSAL_COPY)), 'client mapping table drifted from the exported one');
  assert.ok(html.includes(JSON.stringify(SHARED.LIFE_REFUSAL_FALLBACK)), 'client fallback drifted from the exported one');
});
