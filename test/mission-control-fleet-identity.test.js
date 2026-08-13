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
const allCards = (section) => section.columns.flatMap((c) => c.cards.concat(c.aging || []));

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
  beat(db, 'b:2', 'researcher-1');   // Research, violet
  const html = AGENTS.render(AGENTS.getSection(db, ctxFor(db)), { serverRev: '' }).body;
  const finance = S.DEPARTMENTS.finance.colour;
  const research = S.DEPARTMENTS.research.colour;
  // A tinted chip alone read as decoration (operator, 2026-08-13: "the department colours need to
  // be more obvious"). The head of the card carries the colour full-bleed.
  assert.ok(html.includes('class="acard-head" style="background:linear-gradient(180deg,' + finance),
    'the Finance card head is emerald');
  assert.ok(html.includes('class="acard-head" style="background:linear-gradient(180deg,' + research),
    'the Research card head is violet');
  assert.ok(html.includes('background:' + finance + ';color:#0A0E16'), 'and the avatar is SOLID on the band, not a tint');
  // The kanban state rail must keep its own surface — department colour never replaces it.
  assert.match(S.css(), /\.acard::before\{[^}]*position:absolute/, 'state rail stays absolutely positioned, painting above the band');
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
