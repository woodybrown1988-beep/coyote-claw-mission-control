'use strict';

// MC Chat (ruling: mc-chat-approved) — the web-transport surface. The board NEVER routes: its one
// write is a chat_messages 'in' row; everything else renders stored state. Negative controls per
// canon: the absent-table 503 (pre-engine-deploy honesty), the caps, the unwired page state.

const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const { applyChatMessage, chatUpdates } = require('../mission-control/server.js');
const DATA = require('../mission-control/ui/data.js');
const chatPage = require('../mission-control/ui/pages/claw/chat.js');

const NOW = Date.UTC(2026, 6, 21, 12, 0);

function makeDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  // mirrors cc src/schema.sql chat_messages + the jobs columns the page joins (wire-first)
  db.exec(`CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, transport TEXT NOT NULL DEFAULT 'web', direction TEXT NOT NULL CHECK (direction IN ('in','out')), source TEXT, text TEXT NOT NULL, job_id TEXT, reply_to_id INTEGER, routed_at INTEGER, created_at INTEGER NOT NULL);
           CREATE TABLE jobs (id TEXT PRIMARY KEY, type TEXT, status TEXT, payload TEXT, created_at INTEGER, updated_at INTEGER);`);
  return db;
}
function ctxFor(db, query) { return { q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, halt: { halted: false }, query: query || {} }; }

test('applyChatMessage: caps + validation are HARD (empty/oversize/bad-reply rejected, nothing written)', () => {
  const db = makeDb();
  assert.equal(applyChatMessage(db, { text: '   ' }, NOW).status, 400);
  assert.equal(applyChatMessage(db, { text: 'x'.repeat(4001) }, NOW).status, 400);
  assert.equal(applyChatMessage(db, { text: 'ok', reply_to_id: 'DROP TABLE' }, NOW).status, 400);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM chat_messages`).get().c, 0, 'nothing written on any rejection');
  const ok = applyChatMessage(db, { text: 'data: net sales', reply_to_id: null }, NOW);
  assert.equal(ok.ok, true);
  const row = db.prepare(`SELECT direction, transport, text, routed_at FROM chat_messages WHERE id = ?`).get(ok.id);
  assert.deepEqual({ ...row }, { direction: 'in', transport: 'web', text: 'data: net sales', routed_at: null }, 'an UNROUTED in-row — the box-side adapter owns routing');
});

test('applyChatMessage NEGATIVE CONTROL: absent chat store (engine not deployed) → honest 503, never a silent drop', () => {
  const db = new sqlite.DatabaseSync(':memory:'); // NO chat_messages table
  const r = applyChatMessage(db, { text: 'hello' }, NOW);
  assert.equal(r.status, 503);
  assert.match(r.error, /engine side not deployed/);
});

test('chatUpdates: cursor + labels + job statuses; malformed job ids NEVER reach a query; absent table honest', () => {
  const db = makeDb();
  db.prepare(`INSERT INTO chat_messages (direction, text, created_at) VALUES ('in', 'q1', 1)`).run();
  db.prepare(`INSERT INTO chat_messages (direction, source, text, job_id, created_at) VALUES ('out', 'boxquery', 'a1', 'aaaa1111-0000-0000-0000-000000000000', 2)`).run();
  db.prepare(`INSERT INTO jobs (id, type, status) VALUES ('aaaa1111-0000-0000-0000-000000000000', 'boxquery', 'running')`).run();
  const r = chatUpdates(db, 1, ['aaaa1111-0000-0000-0000-000000000000', "1;DROP TABLE jobs--"]);
  assert.equal(r.ok, true);
  assert.equal(r.messages.length, 1, 'only rows after the cursor');
  assert.equal(r.messages[0].label, 'Box Query', 'source labelled for the feed');
  assert.deepEqual(r.jobs, { 'aaaa1111-0000-0000-0000-000000000000': 'running' }, 'the injection-shaped id was ignored');
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM jobs`).get().c, 1, 'jobs table intact');
  const bare = new sqlite.DatabaseSync(':memory:');
  assert.equal(chatUpdates(bare, 0, []).ok, false, 'absent store → ok:false, no throw');
});

test('page: thread renders per-source — SQL block for boxquery, collapsed brief card, live chip on a running job', () => {
  const db = makeDb();
  db.prepare(`INSERT INTO chat_messages (direction, text, created_at) VALUES ('in', 'data: net sales last 7 days', 10)`).run();
  db.prepare(`INSERT INTO chat_messages (direction, source, text, job_id, created_at) VALUES ('out', 'router', '🔢 Asking the box — answer (with the query shown) lands here shortly. (job aaaa1111)', 'aaaa1111-0000-0000-0000-000000000000', 11)`).run();
  db.prepare(`INSERT INTO chat_messages (direction, source, text, job_id, created_at) VALUES ('out', 'boxquery', '🔢 £4,094.83 net.\n\n\`\`\`\nSELECT SUM(net_sales_pence) FROM sales_day\n\`\`\`\nrows: 1', 'aaaa1111-0000-0000-0000-000000000000', 12)`).run();
  db.prepare(`INSERT INTO chat_messages (direction, source, text, created_at) VALUES ('out', 'brief', '🧭 Morning — all clear.\nLong body …\n— Rex', 13)`).run();
  db.prepare(`INSERT INTO chat_messages (direction, source, text, job_id, created_at) VALUES ('out', 'router', '📋 Sent to the Lead — you will get a plan to approve. (job bbbb2222)', 'bbbb2222-0000-0000-0000-000000000000', 14)`).run();
  db.prepare(`INSERT INTO jobs (id, type, status) VALUES ('aaaa1111-0000-0000-0000-000000000000', 'boxquery', 'done'), ('bbbb2222-0000-0000-0000-000000000000', 'lead', 'running')`).run();

  const m = chatPage.getSection(db, ctxFor(db));
  assert.equal(m.wired, true);
  assert.equal(m.total, 5);
  const out = chatPage.render(m, ctxFor(db));
  // VERBOSITY RULING: answer visible; SQL behind "show workings"; the answered ack FOLDS
  assert.match(out.body, /£4,094\.83 net\./, 'the answer sentence is visible');
  assert.match(out.body, /show workings ▸<\/summary><div class="ch-sql">SELECT SUM\(net_sales_pence\)/, 'SQL collapsed behind show-workings — present, never inline');
  assert.match(out.body, /class="ch-meta">asked <time/, "the folded ack's timing rides the answer card");
  assert.doesNotMatch(out.body, /Asking the box — answer \(with the query shown\)/, 'the ANSWERED router ack no longer renders standalone');
  assert.match(out.body, /Sent to the Lead/, 'an UNanswered ack still renders (its answer is pending)');
  assert.match(out.body, /Rex · morning brief/, 'brief card labelled');
  assert.match(out.body, /<details class="ch-details"/, 'brief collapses');
  assert.match(out.body, /data-jobchip="bbbb2222-0000-0000-0000-000000000000">running…/, 'the running lead job carries a LIVE chip');
  assert.doesNotMatch(out.body, /data-jobchip="aaaa1111/, 'a DONE job carries no chip — the answer row is the state');
  assert.match(out.body, /id="ch-form"/, 'the input form is present');
  assert.doesNotMatch(out.body, /NaN|undefined/);
});

test('page: paging per the unbounded-list rule — 30-per-page window, honest total, older/newer links', () => {
  const db = makeDb();
  const ins = db.prepare(`INSERT INTO chat_messages (direction, text, created_at) VALUES ('in', ?, ?)`);
  for (let i = 1; i <= 65; i++) ins.run(`msg ${i}`, i);
  const p0 = chatPage.getSection(db, ctxFor(db));
  assert.equal(p0.messages.length, 30);
  assert.equal(p0.messages[29].text, 'msg 65', 'newest last (thread order)');
  const r0 = chatPage.render(p0, ctxFor(db));
  assert.match(r0.body, /65 messages · showing 36–65/);
  assert.match(r0.body, /cpage=1">older/);
  const p2 = chatPage.getSection(db, ctxFor(db, { cpage: '2' }));
  assert.equal(p2.messages.length, 5, 'the tail page is REACHABLE (no truncation)');
  assert.match(chatPage.render(p2, ctxFor(db, { cpage: '2' })).body, /cpage=1">newer/);
});

test('page NEGATIVE CONTROL: unwired DB (engine not deployed) → honest banner, no fabricated thread', () => {
  const bare = new sqlite.DatabaseSync(':memory:');
  const m = chatPage.getSection(bare, ctxFor(bare));
  assert.equal(m.wired, false);
  const out = chatPage.render(m, ctxFor(bare));
  assert.match(out.body, /Chat lands once the engine side deploys/);
  assert.match(out.stamp, /awaiting engine deploy/);
  assert.doesNotMatch(out.body, /id="ch-form"/, 'no input surface while the store is absent');
});

test('LENGTH GUARD (negative controls per canon): >10 lines collapses beyond the first paragraph; a short answer gets NO expander chrome', () => {
  const db = makeDb();
  const long = 'First paragraph line.\n\n' + Array.from({ length: 14 }, (_, i) => `detail line ${i + 1}`).join('\n');
  db.prepare(`INSERT INTO chat_messages (direction, source, text, created_at) VALUES ('out', 'lead', ?, 1)`).run(long);
  db.prepare(`INSERT INTO chat_messages (direction, source, text, created_at) VALUES ('out', 'lead', 'One line verdict.', 2)`).run();
  const out = chatPage.render(chatPage.getSection(db, ctxFor(db)), ctxFor(db));
  assert.match(out.body, /First paragraph line\.<details class="ch-workings"><summary>show more \(\d+ more lines\) ▸/, 'long → first paragraph + show more');
  assert.match(out.body, /detail line 14/, 'the expander holds EVERYTHING — nothing deleted');
  const oneLiner = /One line verdict\.(?![\s\S]{0,80}show more)/;
  assert.match(out.body, oneLiner, 'short answer untouched, no expander chrome');
});

test('escalation cards: one line + expander (the long give-up detail collapses)', () => {
  const db = makeDb();
  const esc = '⚠ lead job 0f913cf8 escalated: build failed: empty build.\n\n' + Array.from({ length: 12 }, (_, i) => `- coder summary line ${i}`).join('\n');
  db.prepare(`INSERT INTO chat_messages (direction, source, text, job_id, created_at) VALUES ('out', 'lead', ?, 'j1', 1)`).run(esc);
  const out = chatPage.render(chatPage.getSection(db, ctxFor(db)), ctxFor(db));
  assert.match(out.body, /escalated: build failed: empty build\.<details class="ch-workings"/, 'verdict line visible, mechanics collapsed');
  assert.match(out.body, /coder summary line 11/, 'full detail in the expander');
});

test('LENGTH GUARD wall-of-lines edge: a >10-line single paragraph (Rex list style) still collapses after 4 lines', () => {
  const db = makeDb();
  const wall = Array.from({ length: 15 }, (_, i) => `🔴 item ${i + 1}`).join('\n'); // no blank lines
  db.prepare(`INSERT INTO chat_messages (direction, source, text, created_at) VALUES ('out', 'rex', ?, 1)`).run(wall);
  const out = chatPage.render(chatPage.getSection(db, ctxFor(db)), ctxFor(db));
  assert.match(out.body, /item 4<details class="ch-workings"><summary>show more \(11 more lines\) ▸/, '4 lines visible, 11 collapsed');
  assert.match(out.body, /item 15/, 'everything in the expander');
});
