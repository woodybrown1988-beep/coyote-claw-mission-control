#!/usr/bin/env node
'use strict';
// LIFE OS VISUAL FIXTURE — TEST/SCREENSHOT HARNESS ONLY (operator amendment 1, 2026-08-05):
// this data exists so the visual hierarchy can be assessed against the golden-master PNGs.
// It is NEVER read by the live render path — live pages render real data or their designed
// empty state, and the no-mock-numbers tests stand unchanged. Content mirrors the golden
// book's illustrative day (loyalty decision must-win, invoice + strength supports, Como
// follow-up decision, tracked dependencies) WITHOUT any prototype-only labels.
//
// Usage: node scripts/life-visual-fixture.mjs /tmp/life-visual/life.db
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[2];
if (!out) { console.error('usage: life-visual-fixture.mjs <path/to/life.db>'); process.exit(2); }
mkdirSync(dirname(out), { recursive: true });

// The engine owns the real schema; the harness applies the ENGINE's own schema file so the
// fixture can never drift from production shape (read-only dependency on the repo checkout).
import { readFileSync, existsSync } from 'node:fs';
const candidates = [
  join(process.env.HOME || '', 'coyote-claw', 'src', 'life', 'schema-life.sql'),
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'coyote-claw', 'src', 'life', 'schema-life.sql'),
];
const schemaPath = candidates.find((p) => existsSync(p));
if (!schemaPath) { console.error('engine schema-life.sql not found — is the engine checkout present?'); process.exit(3); }

const db = new DatabaseSync(out);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(readFileSync(schemaPath, 'utf8'));

const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const t = iso(NOW);
const uid = (() => { let n = 0; return (p) => `${p}-${String(++n).padStart(3, '0')}`; })();

function task(id, title, status, domain, extra = {}) {
  db.prepare(`INSERT INTO life_tasks (id, owner_id, domain_key, title, description, definition_of_done, status,
      due_kind, due_at, importance, consequence, risk_level, visibility, source_type, source_ref, created_by, created_at, updated_at)
    VALUES (?, 'woody', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'LOW', 'OWNER_ONLY', 'MANUAL', ?, 'HUMAN:woody', ?, ?)`)
    .run(id, domain, title, extra.description || '', extra.dod || '', status,
      extra.dueKind || 'NONE', extra.dueAt || null, extra.importance || 3, extra.consequence || 3, id, iso(NOW - (extra.ageMs || 3_600_000)), t);
  db.prepare(`INSERT INTO life_task_events (id, owner_id, task_id, event_type, actor_type, actor_id, to_state, created_at)
    VALUES (?, 'woody', ?, 'CREATED', 'HUMAN', 'woody', ?, ?)`).run(uid('ev'), id, status, iso(NOW - (extra.ageMs || 3_600_000)));
}

task('mw-1', 'Lock the loyalty pilot decision criteria', 'READY', 'business',
  { dod: 'Metric, guardrails and decision thresholds approved.', importance: 5, consequence: 5, dueKind: 'HARD', dueAt: iso(NOW + 86_400_000) });
task('sp-1', 'Review supplier invoice exception', 'READY', 'business', { importance: 4, consequence: 4 });
task('sp-2', 'Complete strength session — week 3 of 6', 'READY', 'health', { importance: 4 });
task('av-1', 'Review FOH staffing exception', 'READY', 'business', { importance: 3 });
task('av-2', 'Reconcile weekly loyalty baseline', 'READY', 'business', { importance: 3 });
task('av-3', 'Draft the October half-term plan', 'READY', 'family', { importance: 2 });
task('ap-1', 'Approve supplier payment instruction', 'AWAITING_APPROVAL', 'business', { importance: 4, consequence: 5 });
task('in-1', 'Look at the van lease options', 'INBOX', 'general');
task('wt-1', 'Send Como follow-up', 'READY', 'business');
task('wt-2', 'Chase the VAT accountant', 'READY', 'admin');
task('wt-3', 'Confirm the equipment engineer visit', 'READY', 'business');

function wait(taskId, dep, wake, fallbackMs) {
  const tk = db.prepare('SELECT version FROM life_tasks WHERE id = ?').get(taskId);
  db.prepare(`INSERT INTO life_waiting_conditions (id, task_id, owner_id, dependency_label, wake_type, fallback_at, state, created_at, updated_at)
    VALUES (?, ?, 'woody', ?, ?, ?, 'ACTIVE', ?, ?)`).run(uid('wc'), taskId, dep, wake, iso(fallbackMs), t, t);
  db.prepare(`UPDATE life_tasks SET status = 'WAITING', version = version + 1 WHERE id = ?`).run(taskId);
  void tk;
}
wait('wt-1', 'a Como platform reply', 'HUMAN_UPDATE', NOW + 3 * 86_400_000);
wait('wt-2', 'the accountant’s VAT ruling', 'HUMAN_UPDATE', NOW + 5 * 86_400_000);
wait('wt-3', 'the manufacturer’s recipe-card revision', 'DATE', NOW + 2 * 86_400_000);

// one open suggestion so "Needs you" shows the decision grammar
db.prepare(`INSERT INTO life_task_updates (id, owner_id, task_id, actor_type, actor_id, raw_text, input_type, record_only, visibility, created_at)
  VALUES ('up-001', 'woody', 'wt-1', 'HUMAN', 'woody', 'sent the deck, waiting on their product team to confirm the pilot cohort', 'TEXT', 0, 'OWNER_ONLY', ?)`).run(t);
db.prepare(`INSERT INTO life_update_proposals (id, owner_id, update_id, task_id, capability_key, command_type, command_json, reason, confidence, risk_level, authority_class, state, created_at)
  VALUES ('pp-001', 'woody', 'up-001', 'sp-1', 'waiting_inference', 'set_waiting',
    '{"dependencyLabel":"the supplier credit note","wakeType":"HUMAN_UPDATE","fallbackAt":"${iso(NOW + 7 * 86_400_000)}"}',
    'The update names an external dependency (the supplier credit note)', 0.8, 'LOW', 'REVERSIBLE_INTERNAL', 'PROPOSED', ?)`).run(t);

// today's plan, draft — the approve action must be assessable
const planDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(NOW));
db.prepare(`INSERT INTO life_daily_plans (id, owner_id, plan_date, must_win_task_id, support_task_1_id, support_task_2_id,
    decision_task_ids_json, alternative_task_ids_json, compilation_evidence_json, status, created_at, updated_at)
  VALUES ('plan-001', 'woody', ?, 'mw-1', 'sp-1', 'sp-2', '["task:ap-1","proposal:pp-001"]', '["av-1","av-2","av-3"]',
    '{"neglected_domains":[],"available_count":6,"decision_overflow":0}', 'PROPOSED', ?, ?)`).run(planDate, t, t);

db.close();
console.log(`visual fixture written → ${out} (harness-only; never the live path)`);
