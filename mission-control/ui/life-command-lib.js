'use strict';
// Life OS command relay — the MC half of the sole-writer path (engine ops/life-os.md).
// Mission Control NEVER opens life.db read-write: an authenticated, origin-checked POST is
// validated here and relayed over the engine writer's Unix socket (~/.coyote-claw/
// life-writer.sock, 0600 — a filesystem object, no TCP listener); the writer's JSON reply
// passes straight through. Writer down/absent = a NAMED 503 and nothing queued anywhere
// (writer-down honesty: a command the writer never saw must never look accepted).
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const REPLY_CAP = 256 * 1024;
const TIMEOUT_MS = 5000;

function sockPath() {
  return process.env.COYOTE_LIFE_SOCK || path.join(os.homedir(), '.coyote-claw', 'life-writer.sock');
}

/** Validate a browser capture body into a writer command. The idempotency key is REQUIRED
 *  at this layer: every browser retry must be provably safe across the full path. */
function validateCapture(body) {
  const b = body || {};
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  if (!title) return { ok: false, status: 400, error: 'title required' };
  if (title.length > 500) return { ok: false, status: 400, error: 'title too long (500 char cap)' };
  const key = typeof b.idempotencyKey === 'string' ? b.idempotencyKey : '';
  if (key.length < 8 || key.length > 128) {
    return { ok: false, status: 400, error: 'idempotencyKey required (8–128 chars) — retries must be safe end-to-end' };
  }
  const payload = { title };
  if (b.domainKey !== undefined) payload.domainKey = b.domainKey;
  if (b.visibility !== undefined) payload.visibility = b.visibility;
  if (b.description !== undefined) payload.description = b.description;
  // RICH CAPTURE (operator ask 2026-08-18): project + due + cadence ride the one command.
  // Shapes refused here fail fast; the writer re-validates everything (project exists and
  // is ACTIVE, domain agreement, the set_due date convention) — fail-closed twice.
  if (b.projectId !== undefined) {
    if (typeof b.projectId !== 'string' || !b.projectId.trim() || b.projectId.length > 64) return { ok: false, status: 400, error: 'projectId must be a task-system id' };
    payload.projectId = b.projectId;
  }
  if (b.dueAt !== undefined) {
    if (typeof b.dueAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.dueAt)) return { ok: false, status: 400, error: 'dueAt must be YYYY-MM-DD' };
    payload.dueAt = b.dueAt;
  }
  if (b.dueKind !== undefined) {
    if (b.dueKind !== 'HARD' && b.dueKind !== 'TARGET') return { ok: false, status: 400, error: 'dueKind must be HARD or TARGET' };
    payload.dueKind = b.dueKind;
  }
  if (b.recurs !== undefined) {
    if (typeof b.recurs !== 'string' || !b.recurs.trim() || b.recurs.length > 60) return { ok: false, status: 400, error: 'recurs must be a cadence label ≤60 chars' };
    payload.recurs = b.recurs;
  }
  // Anything else in the body is DROPPED here — the writer validates again (fail-closed twice).
  return { ok: true, cmd: { command: 'capture', payload, idempotencyKey: key } };
}

/** Relay one command to the writer. cb(status, jsonBody) fires exactly once. */
function sendCommand(cmd, cb) {
  let done = false;
  const once = (status, body) => { if (!done) { done = true; cb(status, body); } };
  const req = http.request(
    { socketPath: sockPath(), path: '/command', method: 'POST', headers: { 'content-type': 'application/json' } },
    (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; if (raw.length > REPLY_CAP) req.destroy(); });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(raw || '{}'); } catch (_) {
          once(502, { ok: false, error: 'life writer replied unparseably — command state UNKNOWN, check the writer log' });
          return;
        }
        once(res.statusCode || 502, parsed);
      });
    },
  );
  req.setTimeout(TIMEOUT_MS, () => {
    once(504, { ok: false, error: `life writer timed out after ${TIMEOUT_MS}ms — command state UNKNOWN, check the writer log` });
    req.destroy();
  });
  req.on('error', () => {
    once(503, { ok: false, error: 'life writer offline — command NOT accepted, nothing queued (is coyote-life-writer running?)' });
  });
  req.end(JSON.stringify(cmd));
}

/** Validate a browser cancel body into a writer command (same discipline as capture). */
function validateCancel(body) {
  const b = body || {};
  const taskId = typeof b.taskId === 'string' ? b.taskId.trim() : '';
  if (!taskId || taskId.length > 64) return { ok: false, status: 400, error: 'taskId required' };
  const key = typeof b.idempotencyKey === 'string' ? b.idempotencyKey : '';
  if (key.length < 8 || key.length > 128) {
    return { ok: false, status: 400, error: 'idempotencyKey required (8–128 chars) — retries must be safe end-to-end' };
  }
  return { ok: true, cmd: { command: 'cancel', payload: { taskId }, idempotencyKey: key } };
}

/** The planner command multiplexer (A6-A13 surfaces). One route, an ALLOWLIST of command
 *  names, per-command shape checks — and the writer re-validates everything (fail-closed
 *  twice). Anything not listed here cannot leave Mission Control. */
/** London-local wall-clock text, exactly the shape the writer stores and compares. */
function localTime(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(v); }

const COMMAND_SHAPES = {
  note: (p) => typeof p.taskId === 'string' && typeof p.text === 'string' && p.text.trim() && p.text.length <= 4000,
  // An EDIT must actually carry an edit — the writer merges it over the original command, so
  // a missing editedCommand would silently become a plain accept of wording the owner meant
  // to change.
  decide: (p) => typeof p.proposalId === 'string' && ['accept', 'edit', 'reject'].includes(p.decision)
    && (p.decision !== 'edit' || (!!p.editedCommand && typeof p.editedCommand === 'object' && !Array.isArray(p.editedCommand))),
  transition: (p) => typeof p.taskId === 'string' && typeof p.to === 'string',
  complete: (p) => typeof p.taskId === 'string',
  set_waiting: (p) => typeof p.taskId === 'string' && typeof p.dependencyLabel === 'string' && typeof p.fallbackAt === 'string'
    && (p.wakeType === undefined || typeof p.wakeType === 'string'),
  // Recurrence flag (operator ask 2026-08-18): set a cadence, or null to stop repeating.
  // The writer re-validates; the browser has already refused anything the advancer cannot
  // roll forward (the grammar and the advancer live in one place in shared.js).
  set_recurrence: (p) => typeof p.taskId === 'string' && !!p.taskId
    && (p.cadence === null || (typeof p.cadence === 'string' && !!p.cadence.trim() && p.cadence.length <= 60)),
  wake: (p) => typeof p.taskId === 'string',
  reopen: (p) => typeof p.taskId === 'string',
  undo: (p) => typeof p.taskId === 'string',
  plan_today: () => true,
  approve_plan: () => true,
  compile_week: () => true,
  approve_week: () => true,
  compile_quarter: () => true,
  approve_quarter: () => true,
  create_outcome: (p) => typeof p.title === 'string' && typeof p.proofDefinition === 'string',
  create_project: (p) => typeof p.title === 'string' && typeof p.definitionOfDone === 'string',
  // Rename / delete (operator ask 2026-08-08): edit a task or project NAME in place;
  // cancel a project the way tasks cancel. The writer re-validates (terminal work keeps
  // its name; DONE is never erased) — these shapes just refuse garbage early.
  rename_task: (p) => typeof p.taskId === 'string' && typeof p.title === 'string' && !!p.title.trim() && p.title.length <= 500,
  rename_project: (p) => typeof p.projectId === 'string' && typeof p.title === 'string' && !!p.title.trim() && p.title.length <= 200,
  cancel_project: (p) => typeof p.projectId === 'string' && !!p.projectId,
  // Slot swap (operator ask 2026-08-10): four active is the design cap — the owner parks
  // and activates to manage the slots; the writer refuses the fifth activation by name.
  park_project: (p) => typeof p.projectId === 'string' && !!p.projectId,
  activate_project: (p) => typeof p.projectId === 'string' && !!p.projectId,
  // Calendar blocks (Graph Stage W, operator GO 2026-08-10): accepting a block proposal
  // rides its OWN verb — the writer places/removes the real Outlook event, then marks the
  // proposal; a generic decide-accept on one is refused engine-side (fail-closed twice).
  // HUMAN-only at the writer: any agent/service actor is refused by name.
  //
  // OWNER-NAMED TIMES (operator ask 2026-08-18): place_block and move_block also accept a
  // DIRECT shape — the owner typing a time ("Propose block") or dragging a block to a new
  // day IS the feature now, so the old rule ("no payload from this surface can name a time
  // he was never shown") is deliberately relaxed for these two owner verbs and NO others.
  // The writer stays the enforcer: well-formed London-local times, in the future, the Life
  // OS calendar only. swap_block and remove_block still ride a proposal id and nothing else.
  place_block: (p) => (typeof p.proposalId === 'string' && !!p.proposalId)
    || (localTime(p.startAt) && localTime(p.endAt) && p.endAt > p.startAt
      && (p.taskId === undefined || (typeof p.taskId === 'string' && !!p.taskId))
      && (p.title === undefined || (typeof p.title === 'string' && p.title.length <= 200))
      && (typeof p.taskId === 'string' || (typeof p.title === 'string' && !!p.title.trim()))),
  remove_block: (p) => typeof p.proposalId === 'string' && !!p.proposalId,
  // Continuous replan (operator ask 2026-08-11): the compiler revisits blocks that already
  // stand and proposes moving or swapping one when it stops being true.
  move_block: (p) => (typeof p.proposalId === 'string' && !!p.proposalId)
    || (typeof p.blockId === 'string' && !!p.blockId
      && localTime(p.startAt) && localTime(p.endAt) && p.endAt > p.startAt),
  swap_block: (p) => typeof p.proposalId === 'string' && !!p.proposalId,
  // Bulk import (operator brief 2026-08-08): commands carry a file NAME in the import
  // inbox plus the operator's per-row rulings — never file content (the writer reads the
  // file itself and re-validates everything; preview writes nothing).
  // Triage verbs (operator ruling 2026-08-10): give a task its home, or accept it standalone.
  assign_project: (p) => typeof p.taskId === 'string' && (p.projectId === null || (typeof p.projectId === 'string' && !!p.projectId)),
  accept_standalone: (p) => typeof p.taskId === 'string',
  import_preview: (p) => typeof p.fileName === 'string' && !!p.fileName.trim() && p.fileName.length <= 200,
  import_batch: (p) => typeof p.fileName === 'string' && !!p.fileName.trim() && p.fileName.length <= 200
    && (p.dispositions === undefined || (Array.isArray(p.dispositions) && p.dispositions.length <= 500))
    && (p.project === undefined || p.project === null || (typeof p.project === 'object' && typeof p.project.title === 'string')),
  set_route: (p) => typeof p.taskId === 'string' && ['SELF', 'AI', 'DELEGATE', 'HYBRID'].includes(p.mode),
  // Owner→agent context (operator ask 2026-08-13). attach_task_file is DELIBERATELY not
  // here: the browser never names inbox paths — the upload endpoint stages the bytes and
  // posts that command server-side. These two are plain drawer buttons.
  remove_task_file: (p) => typeof p.taskId === 'string' && typeof p.fileId === 'string' && !!p.fileId,
  renew_dispatch: (p) => typeof p.taskId === 'string' && !!p.taskId,
  set_setting: (p) => typeof p.key === 'string' && typeof p.value === 'string',
  pause_capability: (p) => typeof p.capabilityKey === 'string',
  resume_capability: (p) => typeof p.capabilityKey === 'string',
  // Calendar refresh (Graph go 2026-08-10): the Schedule page's "Sync now". Read-side only —
  // the writer polls Outlook and updates its OWN mirror; nothing is ever written to the
  // calendar. The writer refuses this from any agent-actor payload; MC relays no actor at
  // all (it IS the authenticated owner surface).
  calendar_sync: () => true,
  // Mail (Graph Stage C 2026-08-11): the owner's "read my inbox now". READ-ONLY against the
  // mailbox — the writer polls Graph and updates its OWN mirror; nothing is ever sent.
  //
  // `mail_triage` is deliberately NOT relayed. The classification pass spawns the Codex
  // engine per batch and routinely outruns this relay's 5-second timeout, so a button for it
  // would mostly return "command state UNKNOWN" — an affordance that lies about what
  // happened is worse than no affordance. The 20-minute timer owns triage; this verb just
  // makes the mirror current.
  mail_sync: () => true,
  // Due dates (2026-08-11): null clears. The writer enforces the two invariants — a date
  // needs a kind, and clearing the date clears the kind — so this only refuses garbage early.
  // Undo a draft reply this system put in Outlook (reply loop, operator ruling 2026-08-11).
  // The seamId names a ROW IN OUR OWN LOG, never a message: the writer looks the Graph id up
  // from that row, so there is no shape of payload from this surface that reaches a message
  // we did not create. Nothing here can send, delete mail, or touch the original.
  undo_draft: (p) => typeof p.seamId === 'string' && p.seamId.length > 8 && p.seamId.length < 80,
  // "I've replied myself" (operator ask 2026-08-12). The draftId names a row in OUR OWN draft
  // log, never a message — so no payload from this surface can reach mail this system did not
  // draft. taskOutcome is a CLOSED vocabulary here and again at the writer; the note is capped
  // and may be empty, because the system cannot read what he actually sent and an absent note
  // is the honest record of that.
  mail_owner_replied: (p) => typeof p.draftId === 'string' && !!p.draftId.trim()
    && (p.note === undefined || (typeof p.note === 'string' && p.note.length <= 2000))
    && (p.taskOutcome === undefined || ['waiting', 'wake', 'complete', 'none'].includes(p.taskOutcome)),
  set_due: (p) => typeof p.taskId === 'string' && !!p.taskId
    && (p.dueAt === null || (typeof p.dueAt === 'string' && !!p.dueAt.trim()))
    && (p.dueKind === undefined || ['HARD', 'TARGET', 'NONE'].includes(p.dueKind)),
};

function validateCommand(body) {
  const b = body || {};
  const name = typeof b.command === 'string' ? b.command : '';
  const shape = COMMAND_SHAPES[name];
  if (!shape) return { ok: false, status: 400, error: `unknown or unrelayed command '${name}'` };
  const key = typeof b.idempotencyKey === 'string' ? b.idempotencyKey : '';
  if (key.length < 8 || key.length > 128) {
    return { ok: false, status: 400, error: 'idempotencyKey required (8–128 chars) — retries must be safe end-to-end' };
  }
  const payload = (b.payload && typeof b.payload === 'object') ? b.payload : {};
  if (!shape(payload)) return { ok: false, status: 400, error: `${name}: payload shape refused` };
  return { ok: true, cmd: { command: name, payload, idempotencyKey: key } };
}

module.exports = { sockPath, validateCapture, validateCancel, validateCommand, sendCommand };
