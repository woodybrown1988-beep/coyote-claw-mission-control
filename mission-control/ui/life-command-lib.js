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
const COMMAND_SHAPES = {
  note: (p) => typeof p.taskId === 'string' && typeof p.text === 'string' && p.text.trim() && p.text.length <= 4000,
  decide: (p) => typeof p.proposalId === 'string' && ['accept', 'edit', 'reject'].includes(p.decision),
  transition: (p) => typeof p.taskId === 'string' && typeof p.to === 'string',
  complete: (p) => typeof p.taskId === 'string',
  set_waiting: (p) => typeof p.taskId === 'string' && typeof p.dependencyLabel === 'string' && typeof p.fallbackAt === 'string',
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
  pause_capability: (p) => typeof p.capabilityKey === 'string',
  resume_capability: (p) => typeof p.capabilityKey === 'string',
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
