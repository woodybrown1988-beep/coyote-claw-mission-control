'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { applyChatMessage } = require('../mission-control/server.js');

/**
 * RAPID-DUPLICATE DEDUPE — the gate proving it can fail.
 *
 * Shipped in #180 WITHOUT this test (a canon slip: a gate that has never been seen red is
 * theatre). The live defect it guards: one press wrote identical 'in' rows 125/126 seconds
 * apart, and the router answered twice with two differently-worded parses of one sentence.
 */
function db0() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, transport TEXT, direction TEXT,
    source TEXT, text TEXT, job_id TEXT, reply_to_id INTEGER, routed_at INTEGER, created_at INTEGER)`);
  return db;
}
const NOW = 1_787_000_000_000;

test('the same text within 90s is ONE message — the second POST gets the first row back', () => {
  const db = db0();
  const a = applyChatMessage(db, { text: 'move the woodwinters one' }, NOW);
  const b = applyChatMessage(db, { text: 'move the woodwinters one' }, NOW + 3_000);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true, 'the client must still clear its box');
  assert.equal(b.id, a.id, 'same intent, same row');
  assert.equal(b.deduped, true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM chat_messages WHERE direction='in'").get().n, 1);
});

test('NEGATIVE CONTROLS: different text, and the same text after the window, both land', () => {
  // Without these, a dedupe that swallowed EVERYTHING would pass the test above — a chat that
  // silently eats repeated instructions is worse than one that answers twice.
  const db = db0();
  applyChatMessage(db, { text: 'move the woodwinters one' }, NOW);
  const other = applyChatMessage(db, { text: 'move the williamsons one' }, NOW + 3_000);
  assert.notEqual(other.deduped, true, 'different text is a different message');
  const later = applyChatMessage(db, { text: 'move the woodwinters one' }, NOW + 120_000);
  assert.notEqual(later.deduped, true, 'repeating yourself two minutes later is deliberate');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM chat_messages WHERE direction='in'").get().n, 3);
});
