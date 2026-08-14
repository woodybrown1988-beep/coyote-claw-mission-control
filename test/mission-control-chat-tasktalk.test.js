'use strict';
// TASK-TALK IN CHAT (operator ask 2026-08-13), MC half — pinned against EMITTED output:
// task-agent messages are labelled and carry the ↩ reply affordance; ordinary agent answers
// do NOT (a reply to Box Query is a new question, not a task brief); the reply bar ships;
// and the page script still PARSES (one parse error kills every button — the standing gate).
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');
const CHAT = require('../mission-control/ui/pages/claw/chat.js');

function fixtureDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, transport TEXT NOT NULL DEFAULT 'web',
    direction TEXT NOT NULL CHECK (direction IN ('in','out')), source TEXT, text TEXT NOT NULL, job_id TEXT,
    reply_to_id INTEGER, routed_at INTEGER, created_at INTEGER NOT NULL);
    CREATE TABLE jobs (id TEXT PRIMARY KEY, type TEXT, status TEXT, payload TEXT, result TEXT, error TEXT,
      created_at INTEGER, updated_at INTEGER, attempts INTEGER, max_attempts INTEGER, fresh_until INTEGER,
      parent_job_id TEXT, owner_id TEXT, lease_expires_at INTEGER, initiated_by TEXT, dedup_key TEXT);
    INSERT INTO chat_messages (direction, source, text, created_at) VALUES
      ('out', 'boxquery', 'Answer: £12,340 net last week.', 1000),
      ('out', 'life-task:950a602b-9f1d-401f-a097-a8af03a86414',
       '✅ Establish loyalty KPI baseline — delivered: A=41. ⟦task t:950a602b⟧ Accept it on Today, or reply here.', 2000);`);
  return db;
}

function render(db) {
  const ctx = { q: (sql, params) => { try { return { ok: true, rows: db.prepare(sql).all(...(params || [])) }; } catch (e) { return { ok: false, error: String(e.message) }; } }, now: 3000, query: {} };
  return CHAT.render(CHAT.getSection(db, ctx), ctx);
}

test('task-agent messages get the label + reply affordance; ordinary answers do not', () => {
  const out = render(fixtureDb());
  assert.match(out.body, /Task · agent/, 'the life-task source is labelled for a human');
  const replyBtns = [...out.body.matchAll(/class="btn ch-reply" data-reply="(\d+)"/g)];
  assert.equal(replyBtns.length, 1, 'exactly the task message offers ↩ reply');
  assert.match(out.body, /data-replylabel="✅ Establish loyalty KPI baseline — delivered: A=41\./, 'the reply bar names what you are replying to');
  assert.match(out.body, /id="ch-replybar"/, 'the reply bar ships');
  assert.match(out.body, /this goes to that task’s agent/, 'the bar says where the words go');
  assert.match(out.body, /reply_to_id/, 'the send carries the reply target');
});

test('the page script still parses — reply wiring cannot cost the whole page its buttons', () => {
  const out = render(fixtureDb());
  const m = /<script>([\s\S]*?)<\/script>/.exec(out.body);
  assert.ok(m, 'the page script is present');
  assert.doesNotThrow(() => new Function(m[1]), 'the emitted script parses (mc-client-script-parse-gate)');
  assert.match(m[1], /setReply\(null, null\)/, 'send clears the reply target — no accidental second brief');
});

test('a stuck card can be resolved: the board links to chat, and chat arrives loaded with the two exits', () => {
  // Operator ask 2026-08-13, looking at a Lead card held 8 days: "theres no way to resolve
  // this." The board keeps its READ-ONLY boundary — this is a plain GET link — and the chat
  // it lands on names the job and spells out the exits (close / retask) the engine now has.
  const db = fixtureDb();
  db.exec(`INSERT INTO jobs (id, type, status, payload, error, created_at, updated_at, attempts, max_attempts)
           VALUES ('e7de1759-aaaa-bbbb-cccc-dddddddddddd', 'lead', 'escalated',
             '{"brief":"look into what the new openclaw update has compared to our last update"}',
             'spec advise malformed: killed after 300000ms timeout', 1000, 2000, 1, 1)`);
  const ctx = {
    q: (sql, params) => { try { return { ok: true, rows: db.prepare(sql).all(...(params || [])) }; } catch (e) { return { ok: false, error: String(e.message) }; } },
    now: 3000, query: { about: 'e7de1759-aaaa-bbbb-cccc-dddddddddddd' },
  };
  const out = CHAT.render(CHAT.getSection(db, ctx), ctx);
  assert.match(out.body, /About lead job e7de1759/, 'the thread names the job he came from');
  assert.match(out.body, /look into what the new openclaw update/, 'in its own words');
  assert.match(out.body, /spec advise malformed/, 'and says how it died');
  assert.match(out.body, /close e7de1759 &lt;why&gt;/, 'exit one: drop it');
  assert.match(out.body, /retask e7de1759/, 'exit two: make it a task');
  assert.match(out.body, /<textarea[^>]*>retask e7de1759<\/textarea>/, 'the composer opens pre-loaded');

  // An unknown or malformed id must never fabricate a card.
  const bad = CHAT.render(CHAT.getSection(db, { ...ctx, query: { about: 'not-an-id' } }), { ...ctx, query: { about: 'not-an-id' } });
  assert.ok(!/About .* job/.test(bad.body), 'no job, no banner — never invented');
});

test('the board offers "Talk about this" on blocked cards, and it stays a GET link', () => {
  const AGENTS = require('../mission-control/ui/pages/claw/agents.js');
  const now = 1786600000000;
  const job = {
    id: 'e7de1759-aaaa-bbbb-cccc-dddddddddddd', type: 'lead', status: 'escalated',
    payload: JSON.stringify({ brief: 'look into what the new openclaw update has' }),
    created_at: now - 8 * 86400000, updated_at: now - 8 * 86400000, attempts: 1, error: 'timeout', parent_job_id: null, owner_id: null,
  };
  const q = (sql) => {
    const s = String(sql);
    if (/FROM jobs WHERE status NOT IN/.test(s)) return { ok: true, rows: [job] };
    return { ok: true, rows: [] };
  };
  const out = AGENTS.render(AGENTS.getSection(null, { q, now, halt: { halted: false } }), { serverRev: '' });
  assert.match(out.body, /<a class="acard-btn" href="\/claw\/chat\?about=e7de1759[^"]*">Talk about this<\/a>/, 'the way out is on the card');
  assert.match(out.body, /Open in TG/, 'and the Telegram route still stands beside it');
  // The /claw read-only boundary: a link is a GET; no write affordance may appear.
  assert.ok(!/data-op|method="post"|fetch\(/i.test(out.body), 'the console stays read-only');
});

test('the Chief of Staff button is no longer dead — it opens chat with the question loaded', () => {
  // It was a styled <button> with NO handler anywhere, on the one card whose promise is
  // "the one you actually talk to" (operator ask 2026-08-13).
  const AGENTS = require('../mission-control/ui/pages/claw/agents.js');
  const now = 1786600000000;
  const q = () => ({ ok: true, rows: [] });
  const board = AGENTS.render(AGENTS.getSection(null, { q, now, halt: { halted: false } }), { serverRev: '' });
  assert.ok(!/<button class="cos-btn"/.test(board.body), 'no dead button remains');
  assert.match(board.body, /<a class="cos-btn" href="\/claw\/chat\?ask=[^"]+">▸ What/, 'it is a link into chat');
  assert.match(board.body, /Talk to the fleet/, 'and a plain way through to the agents');

  // Landing there, the question is pre-loaded so one keystroke sends it to Rex.
  const db = fixtureDb();
  const ctx = {
    q: (sql, params) => { try { return { ok: true, rows: db.prepare(sql).all(...(params || [])) }; } catch (e) { return { ok: false, error: String(e.message) }; } },
    now: 3000, query: { ask: 'Rex, what has been done today?' },
  };
  const out = CHAT.render(CHAT.getSection(db, ctx), ctx);
  assert.match(out.body, /<textarea[^>]*>Rex, what has been done today\?<\/textarea>/);
});


// ── VOICE (operator ask 2026-08-14) ─────────────────────────────────────────────────────────────
// Mic dictates into the composer (nothing sends until HE sends — a misheard word must never become
// a dispatched job); the speaker toggle reads NEW replies aloud. Browser-native Web Speech only:
// the /claw readonly carve-out stands — chat's write surface is still EXACTLY its two endpoints,
// asserted by mission-control-claw-readonly.test.js, and this adds none.
const _sqlite = require('node:sqlite');
const _DATA = require('../mission-control/ui/data.js');
test('the chat composer carries the mic and speaker; replies are spoken only on arrival', () => {
  const db = new _sqlite.DatabaseSync(':memory:');
  db.exec('CREATE TABLE chat_messages (id INTEGER PRIMARY KEY, transport TEXT, direction TEXT, source TEXT, text TEXT, job_id TEXT, reply_to_id INTEGER, routed_at INTEGER, created_at INTEGER); CREATE TABLE jobs (id TEXT PRIMARY KEY, status TEXT, type TEXT)');
  const ctx = { now: Date.now(), q: (s, p) => _DATA.safeSelect(db, s, p), query: {} };
  const body = CHAT.render(CHAT.getSection(db, ctx), ctx).body;
  assert.match(body, /id="ch-mic"/, 'the mic is in the composer');
  assert.match(body, /id="ch-say"/, 'the speaker toggle too');
  assert.match(body, /speakOut\(m\.text\)/, 'and ONLY newly-arriving replies are spoken (addMsg), never re-read history');
  assert.ok(!/ch-mic[^>]*type="submit"/.test(body), 'the mic never submits — dictation lands in the box for HIM to send');
  db.close();
});
