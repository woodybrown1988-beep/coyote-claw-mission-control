'use strict';
// LIFE OS — RECURRING OBLIGATIONS (operator ask 2026-08-11). A VIEW over data that already
// exists: no recurrence engine, no computed next date, no write. Pinned here are the three
// honesty rules the page exists to keep, each of which is a way it could quietly lie:
//
//  - the date column is "Surfaces", NOT "Due" — for the annual filings the stored date is the
//    wake date the operator set, and the statutory deadline lives in the task's own words. A
//    column headed "Due" would publish three wrong statutory dates;
//  - "last completed" is empty on a first time through, and says THAT rather than an
//    em-dash — recapture creates a NEW task, so a live row's own completion is always null;
//  - the register's count and the planner's count differ by the obligations that were
//    already overdue at import and never got flagged. The gap is NAMED, not excluded.
//
// Plus: overdue first and in red, sorted by next due, the agent-cadence rows marked as NOT
// tasks, and zero write affordances anywhere on the page.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite = require('node:sqlite');
const RECURRING = require('../mission-control/ui/pages/life/recurring.js');

const NOW = Date.parse('2026-08-11T11:00:00.000Z'); // 12:00 London, BST
const WRITE_AFFORDANCE = /data-op|data-log-action|fetch\(|xhr|XMLHttpRequest|method="post"/i;

function withEnv(dbPath, mdPath, fn) {
  const prevDb = process.env.COYOTE_LIFE_DB;
  const prevMd = process.env.COYOTE_OBLIGATIONS_MD;
  process.env.COYOTE_LIFE_DB = dbPath;
  if (mdPath === null) delete process.env.COYOTE_OBLIGATIONS_MD;
  else process.env.COYOTE_OBLIGATIONS_MD = mdPath;
  try { return fn(); } finally {
    if (prevDb === undefined) delete process.env.COYOTE_LIFE_DB; else process.env.COYOTE_LIFE_DB = prevDb;
    if (prevMd === undefined) delete process.env.COYOTE_OBLIGATIONS_MD; else process.env.COYOTE_OBLIGATIONS_MD = prevMd;
  }
}

/** The live shape: tasks carry the cadence label and the date; history is a chain of tasks
 *  linked by source_ref, and the flag itself is an event. */
function makeFixture(dir, rows, extra = {}) {
  const p = path.join(dir, 'life.db');
  const db = new sqlite.DatabaseSync(p);
  db.exec(`
    CREATE TABLE life_tasks (id TEXT PRIMARY KEY, owner_id TEXT, project_id TEXT, domain_key TEXT, title TEXT,
      description TEXT DEFAULT '', status TEXT, due_kind TEXT DEFAULT 'NONE', due_at TEXT, recurs TEXT,
      source_type TEXT, source_ref TEXT, completed_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE life_task_events (id TEXT PRIMARY KEY, owner_id TEXT, task_id TEXT, event_type TEXT,
      actor_type TEXT, actor_id TEXT, from_state TEXT, to_state TEXT, payload_json TEXT DEFAULT '{}',
      idempotency_key TEXT, created_at TEXT);
  `);
  const ins = db.prepare(`INSERT INTO life_tasks (id, owner_id, domain_key, title, description, status, due_kind, due_at, recurs, source_type, source_ref, completed_at, created_at, updated_at)
    VALUES (?, 'woody', 'admin', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const r of rows) {
    ins.run(r.id, r.title, r.description || '', r.status || 'READY', r.due ? 'TARGET' : 'NONE',
      r.due ? `${r.due}T09:00:00.000Z` : null, r.recurs ?? 'Monthly', r.sourceType || 'IMPORT',
      r.sourceRef || `csv#${r.id}`, r.completedAt || null, new Date(NOW).toISOString(), new Date(NOW).toISOString());
    if (r.recurs !== null) {
      db.prepare(`INSERT INTO life_task_events (id, owner_id, task_id, event_type, actor_type, actor_id, created_at)
                  VALUES (?, 'woody', ?, 'RECURRENCE_SET', 'HUMAN', 'woody', ?)`)
        .run(`ev-${r.id}`, r.id, r.flaggedAt || '2026-08-10T14:53:15.102Z');
    }
  }
  for (const d of extra.declined || []) {
    db.prepare(`INSERT INTO life_task_events (id, owner_id, task_id, event_type, actor_type, actor_id, created_at)
                VALUES (?, 'woody', ?, 'RECAPTURE_DECLINED', 'HUMAN', 'woody', ?)`).run(d.id, d.taskId, d.at);
  }
  db.close();
  return p;
}

/** The obligations register, in the real file's shape. Section (a) mirrors the task titles
 *  WITH the drift the live register actually has ("+" vs "and", em-dash vs hyphen, a
 *  parenthetical that lives in the description) — the page reconciles by title, so a fixture
 *  of identical strings would prove nothing. `extra` names obligations the planner is NOT
 *  carrying: the real fourteenth. */
const DRIFT = {
  'Top up HSBC and Pleo accounts': 'Top up HSBC + Pleo accounts',
  'Submit occasional alcohol licences': 'Submit occasional alcohol licences (+ send Jordan copies)',
  'Run monthly payroll': 'Run monthly payroll (starters/leavers, Nest, hours, QB submit, pay, HMRC, tips, leave)',
};
function makeRegister(dir, { rows = ROWS, extra = [], bRows = 23 } = {}) {
  const p = path.join(dir, 'recurring-obligations.md');
  const titles = [...rows.map((r) => DRIFT[r.title] || r.title), ...extra];
  const a = titles.map((t) => `| ${t} | Monthly | 2026-09-01 | Woody | TickTick routine |`);
  const b = Array.from({ length: bRows }, (_, i) => `| Agent cadence ${i + 1} | Weekly | Loyalty maintenance sheet |`);
  fs.writeFileSync(p, [
    '# Recurring obligations — the register', '',
    '## a) DATED-STATUTORY — in the planner as once-with-wake tasks', '',
    '| Obligation | Cadence | Next due | Owner | Source |', '|---|---|---|---|---|', ...a, '',
    '## b) AGENT-CADENCE — obligations pending automation', '',
    '| Obligation | Cadence | Source |', '|---|---|---|', ...b, '',
    '## c) ROUTINE-OPERATIONAL — dispositions', '',
    '| Obligation | Cadence | Disposition |', '|---|---|---|',
    '| Website check | Monthly | DELEGATE |', '',
  ].join('\n'));
  return p;
}

const ROWS = [
  { id: 't1', title: 'Top up HSBC and Pleo accounts', due: '2026-08-12', recurs: 'Monthly', description: 'Manual recurrence on completion' },
  { id: 't2', title: 'Submit occasional alcohol licences', due: '2026-08-14', recurs: 'Every 6 weeks' },
  { id: 't3', title: 'Run monthly payroll', due: '2026-08-29', recurs: 'Monthly' },
  { id: 't4', title: 'Annual Coyote Burger accounts + pay corporation tax', due: '2026-10-01', recurs: 'Annually', description: 'Due 31 Oct. Manual recurrence on completion' },
  { id: 't5', title: 'Duct cleaning', due: '2026-08-04', recurs: 'Annually' }, // OVERDUE
  { id: 't6', title: 'Confirmation statement', due: '2027-03-20', recurs: 'Annually', description: 'Due 5 Apr 2027. Manual recurrence on completion' },
];

const render = (dbPath, mdPath) => withEnv(dbPath, mdPath, () => {
  const ctx = { now: NOW };
  return RECURRING.render(RECURRING.getSection(null, ctx), ctx);
});
const visibleText = (body) => body.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/data-lc-[a-z-]+="[^"]*"/g, '');

test('the register lists every flagged obligation, sorted by next due, with cadence and owner', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rec-'));
  const out = render(makeFixture(dir, ROWS), makeRegister(dir));
  const v = visibleText(out.body);
  for (const r of ROWS) assert.match(v, new RegExp(r.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${r.title} listed`);
  assert.match(v, /Every 6 weeks/, 'the cadence is shown as the owner wrote it, never re-worded');
  assert.match(v, /woody/, 'owner column');
  // Sorted by date — with the overdue one lifted to the top regardless.
  const order = ['Duct cleaning', 'Top up HSBC', 'Submit occasional', 'Run monthly payroll', 'Annual Coyote'];
  let cursor = -1;
  for (const t of order) {
    const at = v.indexOf(t);
    assert.ok(at > cursor, `${t} comes after the one before it`);
    cursor = at;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('OVERDUE comes first and is red; "days until" is counted from London today', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rec-od-'));
  const out = render(makeFixture(dir, ROWS), makeRegister(dir));
  const v = visibleText(out.body);
  assert.match(v, /7 days overdue/, 'Duct cleaning was due 4 Aug; today is 11 Aug');
  assert.match(v, /tomorrow/, 'HSBC is due 12 Aug');
  assert.match(v, /in 18 days/, 'payroll is 29 Aug');
  // Red, and structurally marked as the row that has slipped.
  assert.match(out.body, /#f2777a/, 'overdue is rendered in red');
  assert.ok(v.indexOf('Duct cleaning') < v.indexOf('Top up HSBC'), 'overdue outranks the nearest future date');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the date column is SURFACES, not "Due" — and the stated statutory deadline rides beside it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rec-due-'));
  const out = render(makeFixture(dir, ROWS), makeRegister(dir));
  const v = visibleText(out.body);
  assert.match(v, /Surfaces/, 'the column names what the date actually is');
  // The annual filing surfaces 1 Oct and is DUE 31 Oct — both facts, neither one pretending
  // to be the other. This is the whole reason the column is not headed "Due".
  assert.match(v, /stated deadline 31 Oct/);
  assert.match(v, /1 Oct 2026/);
  assert.ok(!/\bDue\b\s*<\/div>/.test(out.body), 'no bare "Due" column heading');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('"last completed" on a first time through says so — never a bare dash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rec-hist-'));
  const out = render(makeFixture(dir, ROWS), makeRegister(dir));
  assert.match(visibleText(out.body), /First time through Life OS — flagged 10 Aug 2026/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a completed occurrence is found through the recapture chain, not on the live row', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rec-chain-'));
  // The predecessor completed on 12 Jul; the LIVE row is its successor and has no
  // completed_at of its own. A page reading only the live row would show nothing.
  const dbPath = makeFixture(dir, [
    { id: 'old', title: 'Run monthly payroll', due: '2026-07-29', recurs: 'Monthly', status: 'DONE', completedAt: '2026-07-12T10:00:00.000Z', sourceRef: 'csv#old' },
    { id: 'new', title: 'Run monthly payroll', due: '2026-08-29', recurs: 'Monthly', sourceType: 'SYSTEM', sourceRef: 'recapture:old' },
  ]);
  const v = visibleText(render(dbPath, makeRegister(dir)).body);
  assert.match(v, /Last done 12 Jul 2026/, 'the history comes from the previous occurrence');
  assert.ok(!/First time through/.test(v), 'and it is no longer a first time through');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the 14-vs-13 gap is NAMED, not silently excluded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rec-gap-'));
  // The live defect's shape: the register carries one the planner never flagged.
  const out = render(makeFixture(dir, ROWS), makeRegister(dir, { extra: ['New electricity contract'] }));
  const v = visibleText(out.body);
  assert.match(v, /One obligation on the register isn’t in the list below/);
  assert.match(v, /New electricity contract/, 'and it is NAMED — a count alone says nothing actionable');
  assert.match(v, /Set both on the task/, 'the fix is named');
  // The titles that merely DRIFT between the register and the board are matched, not
  // reported as missing — otherwise the warning cries wolf and gets ignored.
  assert.ok(!/Top up HSBC \+ Pleo/.test(v), 'punctuation drift is not a missing obligation');
  assert.ok(!/send Jordan copies/.test(v), 'nor is a parenthetical that lives in the description');

  // THE PAIR THAT NEARLY FOOLED IT. "New gas contract" and "New electricity contract" differ
  // by one word. Matching on long words only left each with "contract" alone: the gas one
  // failed to match its own task, and came within a word of matching the electricity one —
  // which would have hidden the exact obligation this card exists to report.
  const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rec-near-'));
  const near = [{ id: 'g', title: 'New gas contract', due: '2027-01-20', recurs: 'Annually' }];
  const v3 = visibleText(render(makeFixture(dir3, near), makeRegister(dir3, { rows: near, extra: ['New electricity contract'] })).body);
  assert.match(v3, /One obligation on the register isn’t/, 'exactly one gap');
  assert.match(v3, /· New electricity contract/, 'and it is the electricity one');
  assert.ok(!/· New gas contract/.test(v3), 'the gas contract matched its own task');

  // And a long title must not swallow a short one on a couple of shared words.
  const dir4 = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rec-swallow-'));
  const one = [{ id: 'a', title: 'Annual Coyote Burger accounts + pay corporation tax', due: '2026-10-01', recurs: 'Annually' }];
  const v4 = visibleText(render(makeFixture(dir4, one), makeRegister(dir4, { rows: one, extra: ['Corporation accounts filing'] })).body);
  assert.match(v4, /· Corporation accounts filing/, 'a different filing is not absorbed by the annual accounts row');
  fs.rmSync(dir3, { recursive: true, force: true });
  fs.rmSync(dir4, { recursive: true, force: true });

  // AND the crucial one: flagging an UNRELATED task must not make the warning disappear.
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rec-gap2-'));
  const padded = [...ROWS, { id: 'unrelated', title: 'Something else entirely', due: '2026-09-09', recurs: 'Monthly' }];
  const v2 = visibleText(render(makeFixture(dir2, padded), makeRegister(dir2, { extra: ['New electricity contract'] })).body);
  assert.match(v2, /New electricity contract/, 'the counts now match, but the obligation is still missing — and still said so');
  fs.rmSync(dir2, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the agent-cadence rows render from the register, marked NOT tasks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rec-pending-'));
  const out = render(makeFixture(dir, ROWS), makeRegister(dir));
  const v = visibleText(out.body);
  assert.match(v, /Pending automation — not tasks/);
  assert.match(v, /are <b>not<\/b> on your task list|are not on your task list/, 'stated in words as well as in the heading');
  assert.match(v, /Agent cadence 1/);
  assert.match(v, /Agent cadence 23/, 'all 23 render — no silent truncation');
  assert.ok(!/Website check/.test(v), 'section (c) dispositions are NOT this page');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('no register file: the second half is absent and SAYS so — the first half is unaffected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rec-nomd-'));
  const out = render(makeFixture(dir, ROWS), path.join(dir, 'does-not-exist.md'));
  const v = visibleText(out.body);
  assert.match(v, /couldn’t be read, so this half of the picture isn’t shown rather than guessed at/);
  assert.match(v, /Run monthly payroll/, 'the planner half still renders');
  assert.ok(!/The register lists/.test(v), 'and no count is claimed against a register we could not read');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an obligation dropped by decline is surfaced, not silently lost', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rec-decl-'));
  const dbPath = makeFixture(dir, [
    ...ROWS,
    { id: 'gone', title: 'Duct cleaning contract', due: '2026-07-01', recurs: 'Annually', status: 'DONE' },
  ], { declined: [{ id: 'd1', taskId: 'gone', at: '2026-08-09T09:00:00.000Z' }] });
  const v = visibleText(render(dbPath, makeRegister(dir)).body);
  assert.match(v, /Dropped on purpose/);
  assert.match(v, /Duct cleaning contract/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('nothing flagged yet, and life.db absent, are both owner-worded states — never a crash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rec-empty-'));
  const empty = render(makeFixture(dir, []), makeRegister(dir));
  const ev = visibleText(empty.body);
  assert.match(ev, /Nothing is flagged as recurring yet/);
  // …and CRUCIALLY the gap note stays silent. With nothing flagged there is nothing to
  // compare the register against, and "14 obligations are on the board as ordinary work"
  // would be a claim about tasks this page never looked at.
  assert.ok(!/The register lists/.test(ev), 'no gap is claimed when the two lists are not comparable');
  assert.match(ev, /Pending automation — not tasks/, 'the other half of the picture still renders');

  const gone = render(path.join(dir, 'nope.db'), makeRegister(dir));
  assert.match(visibleText(gone.body), /Nothing has been captured yet/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the page is a VIEW: zero write affordances, and nothing an owner reads is engineer-speak', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rec-ro-'));
  const out = render(makeFixture(dir, ROWS), makeRegister(dir));
  assert.ok(!WRITE_AFFORDANCE.test(out.body), 'no raw write mechanism');
  assert.ok(!/data-lc-/.test(out.body), 'and no command affordance at all — this page changes nothing');
  const v = visibleText(out.body);
  // \bPR, not PR: an unanchored /PR\s?\d+/i matches the "pr 2027" inside "5 Apr 2027", so a
  // page would go red every April for saying a date correctly. ROWS carries an April
  // deadline precisely so this stays proven rather than lucky.
  assert.match(v, /5 Apr 2027/, 'the fixture really does render an April date');
  assert.ok(!/(\bPR\s?#?\d+|\bschema\b|DB-enforced|sole writer|life\.db|\brecurs\b|source_ref|due_at)/i.test(v),
    'the owner reads owner language, never column names');
  fs.rmSync(dir, { recursive: true, force: true });
});
