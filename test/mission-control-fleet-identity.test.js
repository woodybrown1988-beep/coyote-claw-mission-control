'use strict';
// WHO EACH AGENT IS — one roster, one answer, everywhere.
//
// Live on 2026-08-13 the engine room showed four agents standing by as "Coder · builder · cage":
// accountant-1, boxquery-1, finplan-1 and researcher-1. The board's worker roster took EVERY
// non-lead heartbeat as a coder, because it was written when coder-1/coder-2 were the only named
// workers; every service added afterwards silently inherited the Coder's name and role. Directly
// below them sat two hard-coded cards asserting that Research was "Not yet wired" and the
// Accountant "Not built" — both had completed real jobs that same day. Elsewhere the board printed
// raw job types as agent names ('cos-query', 'finplan'), and four separate files each kept their
// own private name map, so the chat feed, the task drawer and the board could disagree about who
// was on a job.
//
// The general shape (learning rule 4): identity invented AT THE POINT OF DISPLAY drifts from
// reality, and hard-coded claims about live state cannot stop being true. So these pin the CLASS:
// identity is READ from the roster, presence is READ from the heartbeat, and no page may hold its
// own copy of an agent's name.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const sqlite = require('node:sqlite');

const S = require('../mission-control/ui/shared.js');
const DATA = require('../mission-control/ui/data.js');
const AGENTS = require('../mission-control/ui/pages/claw/agents.js');
const ENGINE = require('../mission-control/ui/pages/claw/engine.js');

const NOW = Date.UTC(2026, 7, 13, 16, 0); // 17:00 London (BST)

function makeDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE jobs (id TEXT PRIMARY KEY, type TEXT, payload TEXT, status TEXT, created_at INTEGER,
      updated_at INTEGER, attempts INTEGER, error TEXT, parent_job_id TEXT, owner_id TEXT);
    CREATE TABLE worker_heartbeat (owner_id TEXT PRIMARY KEY, worker_name TEXT, last_beat_at INTEGER);
    CREATE TABLE job_events (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, kind TEXT, detail TEXT);
  `);
  return db;
}
const ctxFor = (db, now = NOW) => ({ now, halt: { halted: false }, q: (s, p) => DATA.safeSelect(db, s, p) });
const beat = (db, owner, name, at = NOW - 1000) =>
  db.prepare(`INSERT INTO worker_heartbeat (owner_id, worker_name, last_beat_at) VALUES (?,?,?)`).run(owner, name, at);
const job = (db, r) => db.prepare(
  `INSERT INTO jobs (id,type,payload,status,created_at,updated_at,attempts,error,parent_job_id,owner_id)
   VALUES (?,?,?,?,?,?,0,NULL,NULL,?)`,
).run(r.id, r.type, r.payload || '{}', r.status, r.at ?? NOW - 60000, r.at ?? NOW - 60000, r.owner ?? null);
// The whole fleet, wherever it is standing: on the board (working / queued / blocked) or at home
// in its department (idle / just finished). Identity is identical in both — see agents.js.
const allCards = (section) => section.columns
  .flatMap((c) => c.cards.concat(c.aging || []))
  .concat((section.departments || []).flatMap((d) => d.agents));

// ── the live bug, exactly ───────────────────────────────────────────────────────────────────────
test('every live worker keeps its OWN identity — no desk is absorbed by whoever registered first', () => {
  const db = makeDb();
  for (const [owner, name] of [['b:1', 'accountant-1'], ['b:2', 'boxquery-1'], ['b:3', 'finplan-1'], ['b:4', 'researcher-1'], ['b:5', 'coder-1']]) {
    beat(db, owner, name);
  }
  const cards = allCards(AGENTS.getSection(db, ctxFor(db)));
  const byName = (n) => cards.find((c) => c.name === n);

  const expected = {
    'accountant-1': { dept: 'finance', name: 'Accountant' },
    'boxquery-1': { dept: 'data', name: 'Data Desk' },
    'finplan-1': { dept: 'finance', name: 'Financial Planner' },
    'researcher-1': { dept: 'research', name: 'Researcher' },
    'coder-1': { dept: 'build', name: 'Coder' },
  };
  for (const [worker, want] of Object.entries(expected)) {
    const card = byName(worker);
    assert.ok(card, `${worker} is on the board`);
    assert.equal(card.dept, want.dept, `${worker} sits in the ${want.dept} department`);
    assert.equal(card.role, S.FLEET[S.agentKeyForWorker(worker)].role, `${worker} shows its OWN role`);
  }
  // The precise live symptom: the Accountant described as a caged builder.
  assert.doesNotMatch(JSON.stringify(cards), /builder · cage/, 'no worker inherits the Coder role');
  // and four different desks must not all be the same department
  const depts = new Set(Object.keys(expected).map((w) => byName(w).dept));
  assert.ok(depts.size >= 3, 'distinct desks land in distinct departments');
  db.close();
});

test('the board never asserts that a working agent does not exist', () => {
  const db = makeDb();
  beat(db, 'b:1', 'researcher-1');
  beat(db, 'b:2', 'accountant-1');
  job(db, { id: 'r1', type: 'research', status: 'done', owner: 'b:1', at: NOW - 3 * 3600_000 });
  const html = AGENTS.render(AGENTS.getSection(db, ctxFor(db)), { serverRev: '' }).body;
  assert.doesNotMatch(html, /Not yet wired|Not built|Planned specialist/,
    'presence is read from the heartbeat; a hard-coded claim about live state cannot stop being a lie');
  // Both are present as live workers, under their own names and their own departments.
  assert.match(html, /researcher-1/);
  assert.match(html, /accountant-1/);
  // The role travels with the agent even at rest — the department panel doubles as the org chart.
  assert.match(html, /finds precedent · cites sources/, 'the Researcher does research');
  assert.match(html, /books · obligations · advisory/, 'the Accountant does the books');
  db.close();
});

test('an unmapped job type prints ITSELF — honest, never a fabricated name', () => {
  const id = S.agentIdentity('quantum-sommelier');
  assert.equal(id.known, false);
  assert.equal(id.name, 'quantum-sommelier', 'we show what we actually have');
  assert.equal(id.dept, 'engine', 'and file it under the engine rather than guessing a desk');
});

test('every card on the board carries a department', () => {
  const db = makeDb();
  beat(db, 'b:1', 'coder-1');
  job(db, { id: 'j1', type: 'cos-query', status: 'done', payload: JSON.stringify({ question: 'what needs me?' }), at: NOW - 600_000 });
  job(db, { id: 'j2', type: 'finplan', status: 'running', payload: JSON.stringify({ title: 'Model the deal' }) });
  const cards = allCards(AGENTS.getSection(db, ctxFor(db)));
  assert.ok(cards.length > 0);
  for (const c of cards) {
    assert.ok(c.dept, `card "${c.name}" names its department`);
    assert.ok(S.DEPARTMENTS[c.dept], `"${c.dept}" is a real department`);
    assert.ok(c.deptColour, 'and carries its colour so the board is scannable by desk');
  }
  // the two the operator called out by name are gone from the display layer
  const names = cards.map((c) => c.name);
  assert.ok(!names.includes('cos-query') && !names.includes('finplan'), 'raw job types are never agent names');
  assert.ok(names.includes('Rex') || names.includes('Financial Planner'), 'their real names are');
  db.close();
});

test('the department OWNS the head of the card, not just a chip', () => {
  const db = makeDb();
  beat(db, 'b:1', 'accountant-1');   // Finance, emerald
  beat(db, 'b:2', 'researcher-1');   // Research, indigo
  // Both must be ON THE BOARD for there to be a card head to check — an agent at rest goes home to
  // its department, where it is a row rather than a card (operator ruling 2026-08-13).
  job(db, { id: 'a1', type: 'accountant', status: 'running', owner: 'b:1' });
  job(db, { id: 'r1', type: 'research', status: 'running', owner: 'b:2' });
  const html = AGENTS.render(AGENTS.getSection(db, ctxFor(db)), { serverRev: '' }).body;
  const finance = S.DEPARTMENTS.finance.colour;
  const research = S.DEPARTMENTS.research.colour;
  // A tinted chip alone read as decoration (operator, 2026-08-13: "the department colours need to
  // be more obvious"). The head of the card carries the colour full-bleed.
  // A FLAT tint with a solid top bar, not a gradient — the Coyote design system rules out gradient
  // backgrounds, and the hard edge reads as more deliberate than a fade.
  assert.ok(html.includes('class="acard-head" style="background:' + finance + '26;border-top-color:' + finance),
    'the Finance card head is emerald, flat, with a solid top bar');
  assert.ok(html.includes('class="acard-head" style="background:' + research + '26;border-top-color:' + research),
    'the Research card head is indigo, flat, with a solid top bar');
  assert.doesNotMatch(html, /linear-gradient/, 'no gradient backgrounds (Coyote design system)');
  assert.ok(html.includes('background:' + finance + ';color:#0A0E16'), 'and the avatar is SOLID on the band, not a tint');
  // The kanban state rail must keep its own surface — department colour never replaces it.
  assert.match(S.css(), /\.acard::before\{[^}]*position:absolute/, 'state rail stays absolutely positioned, painting above the band');
  db.close();
});

// ── the fleet at rest goes home ─────────────────────────────────────────────────────────────────
// "if they are done on a job then they can be in their departments which will sit above the kanban
// board — the list for complete is long so makes it messy" (operator, 2026-08-13). The rule: the
// BOARD is work in motion; an agent that is idle or finished is at home in its department. What
// must NOT happen is an agent disappearing, or a job card being swept up with the agents.
test('an agent at rest goes home to its department and leaves the board', () => {
  const db = makeDb();
  beat(db, 'b:1', 'accountant-1');                                   // idle → home
  beat(db, 'b:2', 'boxquery-1');                                     // working → board
  job(db, { id: 'w1', type: 'boxquery', status: 'running', owner: 'b:2', payload: JSON.stringify({ question: 'covers yesterday?' }) });
  job(db, { id: 'd1', type: 'accountant', status: 'done', owner: 'b:1', at: NOW - 3600_000 });
  const s = AGENTS.getSection(db, ctxFor(db));

  const home = (s.departments || []).flatMap((d) => d.agents).map((a) => a.name);
  const board = s.columns.flatMap((c) => c.cards).map((c) => c.name);
  assert.ok(home.includes('accountant-1'), 'the finished worker is at home in Finance');
  assert.ok(!board.includes('accountant-1'), 'and is NOT still sitting in the board');
  assert.ok(board.includes('boxquery-1'), 'the working one stays on the board');
  assert.ok(!home.includes('boxquery-1'), 'and is not also at home — an agent is in exactly one place');
  assert.equal(s.columns.find((c) => c.id === 'idle'), undefined, 'there is no Idle column any more');
  db.close();
});

test('a JOB card is never swept home with the agents — only agents go to departments', () => {
  const db = makeDb();
  // A life task that finished: it is WORK, and the owner tracks it, so it stays in Done.
  job(db, {
    id: 'lt', type: 'boxquery', status: 'done', at: NOW - 3600_000,
    payload: JSON.stringify({ lifeDispatch: { taskId: 'task-1', title: 'Create repeat-member dashboard' } }),
  });
  const s = AGENTS.getSection(db, ctxFor(db));
  const done = s.columns.find((c) => c.id === 'done').cards;
  assert.ok(done.some((c) => /repeat-member dashboard/.test((c.task && c.task.strong) || '')),
    'the finished life task stays on the board where the owner tracks it');
  const home = (s.departments || []).flatMap((d) => d.agents);
  assert.ok(!home.some((a) => /repeat-member dashboard/.test(a.line || '')), 'it did not go home with the fleet');
  db.close();
});

test('going home never truncates the honesty line', () => {
  const db = makeDb();
  // The sentence that tells the owner a re-run CANNOT happen is long — and was being clipped at 68
  // characters into "...but the task is r…", which reads as if the re-run is coming.
  job(db, {
    id: 'gv', type: 'lead', status: 'escalated', at: NOW - 3600_000,
    payload: JSON.stringify({ lifeDispatch: { taskId: 'task-hy', title: 'Answered HYBRID task' } }),
  });
  db.prepare(`INSERT INTO job_events (job_id, kind, detail) VALUES ('gv','owner-answered',?)`)
    .run(JSON.stringify({ mode: 'HYBRID' }));
  const html = AGENTS.render(AGENTS.getSection(db, ctxFor(db)), { serverRev: '' }).body;
  assert.match(html, /routed HYBRID and the sweep only takes AI-routed work/,
    'the whole sentence survives — a row can wrap, a half-truth cannot');
  db.close();
});

test('the BOARD leads; the summary tiles sit underneath it (operator ruling 2026-08-13)', () => {
  const db = makeDb();
  beat(db, 'b:1', 'coder-1');
  job(db, { id: 'j1', type: 'boxquery', status: 'done', at: NOW - 600_000 });
  const body = ENGINE.render(ENGINE.getSection(db, ctxFor(db)), ctxFor(db)).body;
  const depts = body.indexOf('The departments');
  const board = body.indexOf('<div class="board">');
  const summary = body.indexOf('Where it stands');
  const today = body.indexOf('dept-rollcall');
  const plumbing = body.indexOf('The plumbing');
  assert.ok(depts > -1 && board > -1 && summary > -1 && today > -1 && plumbing > -1, 'all five sections render');
  assert.ok(depts < board, 'the fleet at rest sits ABOVE the board (operator ruling 2026-08-13)');
  assert.ok(board < summary, 'the board comes before the summary — this page is worked, not read');
  assert.ok(summary < today, 'the triage tiles and the day roll-call stay together');
  assert.ok(today < plumbing, 'the plumbing stays last');
  // each region is announced exactly ONCE — the page used to say "The fleet" twice
  for (const heading of ['The departments', 'On the board', 'Where it stands', 'The plumbing']) {
    assert.equal(body.split('>' + heading + '<').length - 1, 1, `one "${heading}" heading`);
  }
  db.close();
});

test('the Chief of Staff buttons are a spaced row, not inline links carrying vertical margin', () => {
  const db = makeDb();
  const body = AGENTS.render(AGENTS.getSection(db, ctxFor(db)), { serverRev: '' }).body;
  assert.match(body, /<div class="cos-actions">/, 'the buttons live in their own row');
  // The live bug: an INLINE <a> with margin-top does not push anything — the buttons rode up into
  // the description text. Spacing belongs to the container, and the row must be a flex box.
  assert.doesNotMatch(body, /class="cos-btn"[^>]*margin-(top|left)/, 'no per-button margin hacks');
  assert.match(S.css(), /\.cos-actions\{display:flex;gap:/, 'the row supplies the gap');
  assert.match(S.css(), /\.cos-btn\{display:inline-flex/, 'and the button is not an inline box');
  db.close();
});

test('a question-shaped job shows what was ASKED, not its job type', () => {
  const db = makeDb();
  job(db, { id: 'j1', type: 'boxquery', status: 'running', payload: JSON.stringify({ question: 'How many covers yesterday?' }) });
  const html = AGENTS.render(AGENTS.getSection(db, ctxFor(db)), { serverRev: '' }).body;
  assert.match(html, /How many covers yesterday\?/, 'the ask is the content of the work');
  db.close();
});

// ── "nothing has moved": the day, not the instant ───────────────────────────────────────────────
test('the flow band reports the LONDON day, and a quiet desk shows a real zero', () => {
  const db = makeDb();
  // 00:30 London on a BST morning = 23:30 UTC the day before. A UTC window loses this entirely.
  const at0030 = Date.UTC(2026, 7, 13, 0, 30) - 3600_000;
  job(db, { id: 'a', type: 'boxquery', status: 'done', at: at0030 });
  job(db, { id: 'b', type: 'accountant', status: 'done', at: NOW - 3600_000 });
  job(db, { id: 'c', type: 'coder', status: 'failed', at: NOW - 1800_000 });
  job(db, { id: 'd', type: 'research', status: 'done', at: NOW - 40 * 3600_000 }); // yesterday: excluded
  const flow = ENGINE.getSection(db, ctxFor(db)).flow;

  assert.equal(flow.finished, 2, 'both of today\'s completions counted, including the 00:30 one');
  assert.equal(flow.failed, 1, 'failures are never quietly dropped');
  const dept = (k) => flow.depts.find((d) => d.key === k);
  assert.equal(dept('data').finished, 1);
  assert.equal(dept('finance').finished, 1);
  assert.equal(dept('customer').finished, 0, 'a quiet desk reports zero rather than vanishing');
  assert.ok(flow.depts.length === Object.keys(S.DEPARTMENTS).length, 'every department is accounted for');
  db.close();
});

test('londonMidnightMs tracks the zone through BST and GMT', () => {
  // BST: London midnight is 23:00 UTC the previous day.
  assert.equal(S.londonMidnightMs(Date.UTC(2026, 7, 13, 16, 0)), Date.UTC(2026, 7, 12, 23, 0));
  // GMT: London midnight IS UTC midnight.
  assert.equal(S.londonMidnightMs(Date.UTC(2026, 0, 13, 16, 0)), Date.UTC(2026, 0, 13, 0, 0));
});

// ── the tripwire: no page keeps its own copy of an agent's name ──────────────────────────────────
// This is the artifact that covers the class rather than the instance. Four files had each invented
// their own name map; fixing those four fixes today. This catches the fifth.
const UI_ROOT = path.join(__dirname, '..', 'mission-control');
function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
      else if (e.name.endsWith('.js') && p !== path.join(UI_ROOT, 'ui', 'shared.js')) out.push(p);
    }
  };
  walk(UI_ROOT);
  return out;
}
// Names distinctive enough that a literal occurrence is always a second copy of the roster, never
// ordinary prose. ('Rex' and 'Coder' are deliberately excluded — they DO appear as English.)
const OWNED_NAMES = ['Data Desk', 'Financial Planner', 'Learning Check'];
const RETIRED = ['builder · cage', 'Box Query'];

// Comments are stripped first: these names appear in the very comments EXPLAINING the roster, and a
// guard that fires on its own documentation trains people to disable it.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function offenders(files, needles) {
  const hits = [];
  for (const f of files) {
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    for (const n of needles) if (src.includes(n)) hits.push(path.relative(UI_ROOT, f) + ' :: ' + n);
  }
  return hits;
}

test('no file outside shared.js hard-codes an agent name, and the retired ones are gone', () => {
  assert.deepEqual(offenders(sourceFiles(), OWNED_NAMES), [],
    'agent names come from S.FLEET — a literal here is a second source of truth waiting to drift');
  assert.deepEqual(offenders(sourceFiles(), RETIRED), [],
    'the old wrong role and the retired name must not survive anywhere');
});

test('the tripwire goes RED on a second copy of a roster name (negative control)', () => {
  const tmp = path.join(__dirname, '..', 'mission-control', '.tripwire-probe.js');
  fs.writeFileSync(tmp, "const LABEL = { boxquery: 'Data Desk' };\n");
  try {
    const hits = offenders(sourceFiles(), OWNED_NAMES);
    assert.equal(hits.length, 1, 'the guard catches a hand-written agent name');
    assert.match(hits[0], /tripwire-probe/);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});
