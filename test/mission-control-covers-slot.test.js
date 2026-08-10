'use strict';
// Phase 2 PR3b — covers_slot wired into Labour (covers-demand heatmap) + Operations (typical arrival
// waves). Additive: the mature staffing heatmap is untouched; the live-event Operations panels stay
// gated. Negative controls: with no covers_slot rows both fall back to their honest gate-state.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');
const DATA = require('../mission-control/ui/data.js');
const labour = require('../mission-control/ui/pages/coyote/labour.js');
const operations = require('../mission-control/ui/pages/coyote/operations.js');

const NOW = Date.parse('2026-07-23T09:00:00Z');
const q = (db) => (s, p) => DATA.safeSelect(db, s, p);

function slotDb(withSlots = true) {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE labour_day (business_date TEXT, scheduled_cost_pence INT, actual_cost_pence INT, salaried_cost_pence INT, actual_minutes INT, unmapped_actual_minutes INT);
    CREATE TABLE covers_slot (business_date TEXT, slot_hour INT, arrivals INT, reserved_arrivals INT, walkin_arrivals INT, bookings INT, updated_at INT);
    CREATE TABLE sales_day (business_date TEXT, net_sales_pence INT);
  `);
  db.prepare(`INSERT INTO labour_day VALUES ('2026-07-20', 100000, 100000, 20000, 3000, 0)`).run();
  if (withSlots) {
    const s = db.prepare(`INSERT INTO covers_slot VALUES (?,?,?,?,?,?,0)`);
    s.run('2026-07-18', 19, 80, 60, 20, 30);  // Sat dinner
    s.run('2026-07-18', 12, 30, 20, 10, 12);  // Sat lunch
    s.run('2026-07-20', 19, 40, 30, 10, 16);  // Mon dinner
  }
  // The ruled constants — canon_constants fixture (the labour page READS these from the DB;
  // the engine's schema.sql seeds the live table — ruling 2026-08-10, one home).
  db.exec(`CREATE TABLE IF NOT EXISTS canon_constants (key TEXT PRIMARY KEY, value TEXT NOT NULL, as_of TEXT NOT NULL, note TEXT);
    INSERT INTO canon_constants (key, value, as_of, note) VALUES
      ('labour.employer_burden_multiplier','1.159','2026-07-02',NULL),
      ('labour.var_rate_kitchen','0.143','2026-07-18',NULL),
      ('labour.var_rate_foh','0.081','2026-07-18',NULL),
      ('labour.combined_anchor','0.30','2026-07-18',NULL),
      ('labour.materiality_pence','4500','2026-07-18',NULL);`);
  return db;
}

test('Labour Coverage — covers-demand heatmap lights from covers_slot; the staffing grid is untouched', () => {
  const db = slotDb();
  const ctx = { q: q(db), now: NOW, query: { tab: 'coverage' } };
  const body = labour.render(labour.getSection(db, ctx), ctx).body;
  assert.match(body, /Covers demand by weekday × hour/);
  assert.match(body, /Sat 19:00 — 80 covers\/Sat/, 'Sat dinner avg (one occurrence)');
  assert.match(body, /Mon 19:00 — 40 covers\/Mon/);
  assert.match(body, /Combined coverage vs required staffing/, 'the staffing heatmap is still present (untouched)');
  assert.match(body, /OpenTable — LIVE/, 'the architecture card is updated');
  assert.doesNotMatch(body, /NaN|undefined/);
});

test('Labour NEGATIVE CONTROL — no covers_slot → covers-demand panel falls back to its gate-state', () => {
  const db = slotDb(false);
  const ctx = { q: q(db), now: NOW, query: { tab: 'coverage' } };
  const body = labour.render(labour.getSection(db, ctx), ctx).body;
  assert.match(body, /Covers demand by weekday × hour/);
  assert.match(body, /no covers_slot record yet/, 'honest empty-state, not a number');
  assert.doesNotMatch(body, /covers\/Sat/, 'no cover numbers without data');
});

test('Operations FOH — typical arrival waves light from covers_slot; live-event panels stay gated', () => {
  const db = slotDb();
  const ctx = { q: q(db), now: NOW, query: { tab: 'foh' } };
  const body = operations.render(operations.getSection(db, ctx), ctx).body;
  assert.match(body, /Typical arrival waves/);
  assert.match(body, /60\/day/, '19:00 = (80 Sat + 40 Mon) ÷ 2 days = 60/day');
  assert.match(body, /On-time seating/); assert.match(body, /OpenTable-gated/, 'live-event panels stay gated');
  assert.match(body, /still not wired/, 'the gate blocker names the live-event wall (not the stale inbox-zero)');
  assert.doesNotMatch(body, /NaN|undefined/);
});

test('Operations NEGATIVE CONTROL — no covers_slot → arrival waves fall back to the gate-state', () => {
  const db = slotDb(false);
  const ctx = { q: q(db), now: NOW, query: { tab: 'foh' } };
  const body = operations.render(operations.getSection(db, ctx), ctx).body;
  assert.match(body, /Typical arrival waves/);
  assert.match(body, /not wired/, 'gate-state, not a fabricated wave');
});
