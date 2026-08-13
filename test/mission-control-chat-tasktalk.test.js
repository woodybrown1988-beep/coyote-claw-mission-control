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
