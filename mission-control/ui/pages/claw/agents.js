'use strict';
// Agents page — THE centrepiece. Renders REAL agent states from the Librarian (jobs + job_events +
// review_drafts) into the locked ops-centre board: leadership apex (Boss + Chief of Staff) → Librarian
// band (live counts) → flow-divider legend → 5-column kanban (Idle/Queued/Working/Blocked/Done).
// Contract: { key, route, title, sub, getSection(db,ctx), render(section,ctx) }.
// SELECT-only via ctx.q; render returns { stamp, body }. No writes, no network, only ../shared.js.
const S = require('../../shared.js');

// --- jobs read-contract helpers -------------------------------------------------------------------
const ACTIVE6 = ['queued', 'preparing', 'dispatched', 'running', 'awaiting_signoff', 'awaiting_plan_feedback'];
const IN_FLIGHT = ['preparing', 'dispatched', 'running'];
const QUEUE_AGE_15M = 15 * 60 * 1000;
const QUEUE_AGE_1H = 60 * 60 * 1000;
const RECENT_MS = 36 * 60 * 60 * 1000; // a job counts as "recently done" within ~1.5× the daily cadence
const HELD_STATUSES = new Set(['awaiting_signoff', 'awaiting_plan_feedback']);

// WHO EACH AGENT IS comes from the shared roster (S.FLEET / S.agentIdentity) — see shared.js for
// why identity has exactly one writer. This page used to hold its OWN 3-entry map, which is how
// every live worker ended up labelled "Coder · builder · cage" and how the board printed raw job
// types like 'cos-query' as agent names.
const AV_CLASS = {
  lead: 'av-lead', coder: 'av-coder', reviews: 'av-rev', research: 'av-research',
  accountant: 'av-acct', 'cos-query': 'av-cos',
};

/** Roster identity + this page's avatar class, for a roster key or a raw job type. */
function idOf(keyOrType) {
  const a = S.agentIdentity(keyOrType);
  return { ...a, av: AV_CLASS[a.key] || 'av-research' };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function rows(res) {
  return res && res.ok && Array.isArray(res.rows) ? res.rows : [];
}

// A blocked job's wait starts when it ENTERED the status, not whenever the mutable job row was
// last touched. In particular, renewLease() deliberately updates jobs.updated_at while a job is
// parked at either human gate (LEASEABLE_STATUSES includes them), so updated_at is NEVER a clock
// for a held age — it would render every parked gate as "held 1 min" for ever. The append-only
// status_change trail is the stable clock; when a job predates that trail, the gate's own opening
// event (pr_opened / spec_submitted / plan_submitted — all engine-written, append-only) is the
// honest fallback. With neither, the card says "held" and carries no number.
const GATE_ENTRY_KINDS = new Set(['pr_opened', 'spec_submitted', 'plan_submitted']);
function deriveBlockedHeldAge(job, eventRows, now) {
  if (!job || !HELD_STATUSES.has(job.status) || !Number.isFinite(now)) return null;
  const valid = (event) => event && event.job_id === job.id
    && typeof event.created_at === 'number' && Number.isFinite(event.created_at)
    && event.created_at >= 0 && event.created_at <= now;
  const matching = [];
  const entries = [];
  for (const event of Array.isArray(eventRows) ? eventRows : []) {
    if (!valid(event)) continue;
    if (GATE_ENTRY_KINDS.has(String(event.kind || ''))) { entries.push(event); continue; }
    if (event.kind !== 'status_change') continue;
    let detail = event.detail;
    if (typeof detail === 'string') {
      try { detail = JSON.parse(detail); } catch (_) { detail = null; }
    }
    if (!detail || typeof detail !== 'object' || detail.to !== job.status) continue;
    matching.push(event);
  }
  const latest = (list) => list.sort((a, b) => (b.created_at - a.created_at) || (num(b.id) - num(a.id)))[0];
  const clock = matching.length ? latest(matching) : (entries.length ? latest(entries) : null);
  if (!clock) return null;
  const age = now - clock.created_at;
  return Number.isFinite(age) && age >= 0 ? age : null;
}

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function prNumberFrom(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const urlMatch = text.match(/\/pull\/(\d+)(?:\b|\/|$)/i);
  if (urlMatch) return Number(urlMatch[1]);
  const numberMatch = text.match(/^#?(\d+)$/);
  return numberMatch && Number(numberMatch[1]) > 0 ? Number(numberMatch[1]) : null;
}

function prNumberIn(source) {
  if (!source || typeof source !== 'object') return null;
  for (const key of ['pr_number', 'prNumber', 'pull_request', 'pullRequest', 'pr', 'pr_id', 'number']) {
    const number = prNumberFrom(source[key]);
    if (number !== null) return number;
  }
  for (const key of ['pr_url', 'prUrl', 'pull_request_url', 'pullRequestUrl', 'html_url', 'url']) {
    const number = prNumberFrom(source[key]);
    if (number !== null) return number;
  }
  for (const key of ['pull_request', 'pullRequest', 'github', 'result']) {
    const nested = parseObject(source[key]);
    const number = nested && nested !== source ? prNumberIn(nested) : null;
    if (number !== null) return number;
  }
  return null;
}

// GitHub/PR facts already reach the read-only board through job payloads + the job-event trail.
// Resolve the latest state fact for the job's referenced PR; this never mutates the stale gate.
function gatePrState(job, eventRows) {
  if (!job || job.status !== 'awaiting_signoff') return null;
  const events = (Array.isArray(eventRows) ? eventRows : [])
    .filter((event) => event && event.job_id === job.id)
    .slice()
    .sort((a, b) => (num(b.created_at) - num(a.created_at)) || (num(b.id) - num(a.id)));
  const payload = parseObject(job.payload) || {};
  let prNumber = prNumberIn(payload);
  if (prNumber === null) {
    for (const event of events) {
      prNumber = prNumberIn(parseObject(event.detail));
      if (prNumber !== null) break;
    }
  }
  if (prNumber === null) return null;

  for (const event of events) {
    const detail = parseObject(event.detail) || {};
    const eventPr = prNumberIn(detail);
    if (eventPr !== null && eventPr !== prNumber) continue;
    const kind = String(event.kind || '').trim().toLowerCase().replace(/-/g, '_');
    const prDetail = parseObject(detail.pull_request) || parseObject(detail.pullRequest) || detail;
    const rawState = prDetail.pr_state ?? prDetail.prState ?? prDetail.state ?? prDetail.status;
    const state = String(rawState || '').trim().toLowerCase();
    const merged = prDetail.merged === true || prDetail.merged_at || prDetail.mergedAt
      || kind === 'merge_fired' || kind === 'pr_merged' || kind === 'pull_request_merged';
    if (merged || state === 'merged') return { number: prNumber, state: 'merged' };
    const closed = prDetail.closed === true || prDetail.closed_at || prDetail.closedAt
      || kind === 'pr_closed' || kind === 'pull_request_closed';
    if (closed || state === 'closed') return { number: prNumber, state: 'closed' };
    if (state === 'open' || kind === 'pr_opened' || kind === 'pr_reopened') {
      return { number: prNumber, state: 'open' };
    }
  }
  return { number: prNumber, state: null };
}

function nullableInt(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function trunc(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}
// minutes/hours/days WITHOUT the trailing "ago" — for "running 4m" style elapsed labels.
function fmtDur(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const m = Math.floor(ms / 60000);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 48) return h + 'h';
  return Math.floor(h / 24) + 'd';
}

// job.type → roster key (exact, then the historic substring rule). Lives in shared.js so the board,
// the life task pages and any future surface agree on which desk a job belongs to.
const agentForType = S.agentKeyForType;

// One job → its kanban bucket. activeChildParents = parent ids that have an active child (a parent
// still in-flight while a child runs in another dept = blocked-on-dept, the only honest amber signal).
function classify(job, activeChildParents, answeredJobIds) {
  const s = job.status;
  // A give-up the owner has ALREADY answered is not blocked on him — it is spent work with
  // a fresh run behind it. Leaving it in Blocked made the triage column lie (live 2026-08-13).
  if (s === 'escalated' && answeredJobIds && answeredJobIds.has(job.id)) return 'done';
  if (s === 'awaiting_signoff' || s === 'awaiting_plan_feedback' || s === 'escalated') return 'blocked_you';
  if (s === 'preparing' || s === 'dispatched' || s === 'running') {
    return activeChildParents.has(job.id) ? 'blocked_dept' : 'working';
  }
  if (s === 'queued') return 'queued';
  if (s === 'done') return 'done';
  if (s === 'failed') return 'failed';
  return 'idle';
}

// A short, honest one-liner pulled from the job's own payload, else null (caller falls back to type).
function describeJob(job) {
  let p = {};
  try {
    p = JSON.parse(job.payload || '{}') || {};
  } catch (_) {
    p = {};
  }
  if (p && typeof p === 'object') {
    // Life-dispatched work names its TASK first (operator ask 2026-08-13): the board is
    // where the agents live, and a life job's identity is the task it serves.
    if (p.lifeDispatch && typeof p.lifeDispatch === 'object' && typeof p.lifeDispatch.title === 'string' && p.lifeDispatch.title.trim()) {
      return trunc(p.lifeDispatch.title.trim(), 90);
    }
    // 'question' added 2026-08-13: boxquery/research/cos-query jobs carry the ASK under that key, so
    // without it the board printed the bare job type ("boxquery — done") for the one class of work
    // whose whole content is a sentence the operator wrote.
    for (const f of ['title', 'summary', 'brief', 'description', 'headline', 'subject', 'task', 'question', 'name']) {
      if (typeof p[f] === 'string' && p[f].trim()) return trunc(p[f].trim(), 90);
    }
    const prn = p.pr_number != null ? p.pr_number : p.pr != null ? p.pr : p.pr_id;
    if (prn != null && Number.isFinite(Number(prn))) return 'PR #' + Number(prn);
    if (typeof p.repo === 'string' && p.repo.trim()) return trunc(p.repo.trim(), 90);
  }
  return null;
}

// ANSWERED-ALREADY (live 2026-08-13): a life job that gave up stays 'escalated' FOREVER, so
// the board went on shouting "Escalated — needs you" hours after the owner had already
// answered on the task and re-queued the work. The job record cannot know that on its own —
// so the DISPATCHER writes an 'owner-answered' job_event when it sees the send-back, and the
// board reads it from the BUSINESS store like any other job fact. (/claw never reaches into
// life.db: the boundary test is the design speaking, and the marker respects it. Exactly the
// shape of the existing 'cancelled' marker that separates deliberate cancels from give-ups.)
function readOwnerAnswered(q) {
  const out = new Map(); // jobId → { mode }
  for (const r of rows(q(`SELECT job_id, detail FROM job_events WHERE kind = 'owner-answered'`))) {
    let d = {};
    try { d = JSON.parse(r.detail || '{}') || {}; } catch (_) { d = {}; }
    out.set(String(r.job_id), { mode: String(d.mode || 'unset') });
  }
  return out;
}

// Life-task pointer on a job (payload.lifeDispatch, written by the life dispatcher) —
// the board↔task link both ways. Ids only; the title already rides the payload.
function lifeTaskOf(job) {
  try {
    const p = JSON.parse(job.payload || '{}') || {};
    const ld = p && p.lifeDispatch;
    if (ld && typeof ld === 'object' && typeof ld.taskId === 'string' && ld.taskId) {
      return { taskId: ld.taskId, title: typeof ld.title === 'string' ? ld.title : '' };
    }
  } catch (_) { /* not a life job */ }
  return null;
}

// per-status copy for a blocked-on-you card (pill text / task verb / off-board TG button label).
function youCopy(agentKey, status) {
  if (status === 'awaiting_plan_feedback') return { pill: 'Needs your plan feedback', verb: 'awaiting your plan feedback', btn: 'Review in TG' };
  if (status === 'escalated') {
    // A coder escalation that reaches a worker card is, by construction, a genuine GIVE-UP (deliberate
    // cancels carry a 'cancelled' marker and are suppressed in coderSlots) — so name it plainly.
    return agentKey === 'coder'
      ? { pill: 'Gave up — needs you', verb: 'gave up', btn: 'Open in TG' }
      : { pill: 'Escalated — needs you', verb: 'escalated to you', btn: 'Open in TG' };
  }
  // awaiting_signoff
  return { pill: agentKey === 'coder' ? 'Needs your merge tap' : 'Needs your sign-off', verb: 'held at the merge gate', btn: 'Approve in TG' };
}

// mini-track segments from REAL milestone events. 'gate' = blinking red final seg (blocked-on-you).
function buildTrack(mode, milestonesDone) {
  const d = Math.max(0, Math.min(3, milestonesDone));
  if (mode === 'gate') {
    const segs = [];
    for (let i = 0; i < 3; i++) segs.push(i < d ? 'done' : '');
    segs.push('gate');
    return segs;
  }
  // working: progress with one amber 'active' head
  const segs = [];
  for (let i = 0; i < 4; i++) segs.push(i < d ? 'done' : i === d ? 'active' : '');
  return segs;
}

// Fleet queue facts are deliberately separate from worker attribution: queued work is unclaimed, while
// the worker gauge counts only work that is actually preparing, dispatched, or running.
function readQueueDepth(q, now) {
  const row = rows(q(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END), 0) AS queued,
       COALESCE(SUM(CASE WHEN status IN ('preparing','dispatched','running') THEN 1 ELSE 0 END), 0) AS in_flight,
       COALESCE(SUM(CASE WHEN status = 'awaiting_signoff' THEN 1 ELSE 0 END), 0) AS awaiting_signoff,
       MIN(CASE WHEN status = 'queued' AND created_at IS NOT NULL THEN created_at END) AS oldest_queued_at,
       COALESCE(SUM(CASE WHEN status = 'queued' AND created_at IS NOT NULL AND created_at < ? THEN 1 ELSE 0 END), 0) AS queued_over_15m,
       COALESCE(SUM(CASE WHEN status = 'queued' AND created_at IS NOT NULL AND created_at < ? THEN 1 ELSE 0 END), 0) AS queued_over_1h
     FROM jobs`,
    [now - QUEUE_AGE_15M, now - QUEUE_AGE_1H],
  ))[0] || {};
  const oldestQueuedAt = nullableInt(row.oldest_queued_at);
  return {
    queued: num(row.queued),
    inFlight: num(row.in_flight),
    awaitingSignoff: num(row.awaiting_signoff),
    oldestQueuedAt,
    oldestQueuedAgeMs: oldestQueuedAt === null ? null : Math.max(0, now - oldestQueuedAt),
    queuedOver15m: num(row.queued_over_15m),
    queuedOver1h: num(row.queued_over_1h),
  };
}

// =================================================================================================
module.exports = {
  deriveBlockedHeldAge,
  gatePrState,
  key: 'agents',
  route: '/claw/agents', workspace: 'claw',
  title: 'Agents',
  sub: 'The team · who is working, who is stuck, who needs you',

  getSection(db, ctx) {
    const q = ctx.q;
    const now = Number.isFinite(Number(ctx.now)) ? Number(ctx.now) : Date.now();
    const queueDepth = readQueueDepth(q, now);

    // --- Librarian band: live counts (honest COUNT(*), never inflated) -----------------------------
    const placeholders = ACTIVE6.map(() => '?').join(',');
    const libActive = num((rows(q(`SELECT COUNT(*) c FROM jobs WHERE status IN (${placeholders})`, ACTIVE6))[0] || {}).c);
    const libTotal = num((rows(q(`SELECT COUNT(*) c FROM jobs`))[0] || {}).c);
    const libEvents = num((rows(q(`SELECT COUNT(*) c FROM job_events`))[0] || {}).c);

    // --- jobs for cards: all non-terminal + a recent slice of terminal --------------------------------
    const cols = 'id,type,payload,status,created_at,updated_at,attempts,error,parent_job_id,owner_id';
    const nonTerminal = rows(q(`SELECT ${cols} FROM jobs WHERE status NOT IN ('done','failed') ORDER BY updated_at DESC`));
    const terminalRecent = rows(q(`SELECT ${cols} FROM jobs WHERE status IN ('done','failed') ORDER BY updated_at DESC LIMIT 60`));
    const allJobs = nonTerminal.concat(terminalRecent);

    // Prefer the immutable transition trail for held age, while retaining updated_at as the
    // compatibility fallback for older jobs that have no valid status-change event.
    const heldJobs = allJobs.filter((job) => HELD_STATUSES.has(job.status));
    const heldEventRows = heldJobs.length
      ? rows(q(
        `SELECT id, job_id, created_at, kind, detail FROM job_events
          WHERE job_id IN (${heldJobs.map(() => '?').join(',')})
          ORDER BY created_at DESC, id DESC`,
        heldJobs.map((job) => job.id),
      ))
      : [];
    const heldAgeByJob = new Map(heldJobs.map((job) => [
      job.id,
      deriveBlockedHeldAge(job, heldEventRows, now),
    ]));
    const gatePrByJob = new Map(heldJobs.map((job) => [
      job.id,
      gatePrState(job, heldEventRows),
    ]));

    // parents that have an active (in-flight) child → that parent is waiting on the child's dept
    const activeChildParents = new Set();
    const childOf = new Map(); // parentId → first active child job
    for (const j of allJobs) {
      if (j.parent_job_id != null && ACTIVE6.indexOf(j.status) !== -1) {
        activeChildParents.add(j.parent_job_id);
        if (!childOf.has(j.parent_job_id)) childOf.set(j.parent_job_id, j);
      }
    }

    // Which give-ups has the owner ALREADY answered? (see readOwnerAnswered)
    const lifeAnswered = readOwnerAnswered(q);
    const answeredJobIds = new Set(lifeAnswered.keys());

    // group by agent. The Lead and Reviews own dedicated cards; everything else is a candidate for a
    // WORKER slot below (the roster now covers boxquery/research/accountant/finplan, which used to
    // fall straight through to anonymous generic cards).
    const byAgent = { lead: [], coder: [], reviews: [] };
    const generics = [];
    const workerJobs = []; // anything a named worker could own
    for (const j of allJobs) {
      const a = agentForType(j.type);
      if (a === 'lead' || a === 'reviews') byAgent[a].push(j);
      // A LIFE-DISPATCHED job keeps its OWN card and is never folded into a worker slot. It stands
      // for a task the operator owns and tracks, so it must not disappear behind whichever job that
      // worker happened to run most recently — which is exactly what folding it in did on the first
      // pass here: "Create repeat-member dashboard" vanished the moment boxquery-1 ran anything else.
      else if (lifeTaskOf(j)) generics.push(j);
      else workerJobs.push(j);
    }
    const order = ['blocked_you', 'blocked_dept', 'working', 'queued'];
    function pickRep(jobs) {
      const sorted = jobs.slice().sort((x, y) => num(y.updated_at) - num(x.updated_at));
      const found = {};
      let terminal = null;
      for (const j of sorted) {
        const b = classify(j, activeChildParents, answeredJobIds);
        if (order.indexOf(b) !== -1) {
          if (!found[b]) found[b] = j;
        } else if ((b === 'done' || b === 'failed') && !terminal) {
          terminal = j;
        }
      }
      for (const b of order) if (found[b]) return { bucket: b, job: found[b] };
      if (terminal) {
        const recent = now - num(terminal.updated_at) <= RECENT_MS;
        if (recent) return { bucket: terminal.status === 'failed' ? 'failed' : 'done', job: terminal };
        return { bucket: 'idle', job: terminal };
      }
      return { bucket: 'idle', job: null };
    }

    // --- Worker roster: ONE card PER live worker (named), carrying its OWN identity ----------------
    // Sources (SELECT-only): every worker_heartbeat row (who's alive + their STABLE name,
    // idle-aware because the beat fires even when idle) + jobs grouped by owner_id (each worker mints
    // ONE owner_id for both its beat and its claims). A worker is keyed by WORKER_NAME (stable across
    // restarts) else owner_id; label = name ?? host:pid (never blank, never fabricated). Any
    // non-idle phase is work, independent of transient jobs.status changes. Stale non-idle beats
    // stay visible with their last-seen age. With no heartbeat table at all it degrades to one card
    // per job-owner — never losing a job (the honest in-between before workers restart with names).
    //
    // THE BUG THIS FIXES (live 2026-08-13): this was `coderSlots`, and it took EVERY non-lead
    // heartbeat as a coder. It was written when coder-1/coder-2 were the only named workers; the
    // Researcher, Data Desk, Accountant and Financial Planner services were added later and silently
    // inherited the Coder's name and role. The board showed four agents standing by as "builder ·
    // cage" — the Accountant among them — while two faded cards below claimed Research and Accountant
    // did not exist. Identity now comes from each worker's OWN name via the roster, so a new worker
    // service is right the day it starts beating instead of being absorbed by whoever came first.
    const HEARTBEAT_FRESH_MS = 120000; // 4× the 30s beat; matches server.js getWorkerSection
    function shortOwner(id) {
      return String(id || '').replace(/:\d{10,}$/, ''); // host:pid (drop the per-restart epoch-ms tail)
    }
    function workerSlots(coderJobs) {
      const hb = rows(q(
        `SELECT * FROM worker_heartbeat ORDER BY last_beat_at DESC`,
      ));
      let leadHeartbeat = null;
      const inFlightPlaceholders = IN_FLIGHT.map(() => '?').join(',');
      const loadResult = q(
        `SELECT h.owner_id, h.worker_name, COUNT(j.id) AS in_flight
           FROM worker_heartbeat h
           LEFT JOIN jobs j
             ON j.owner_id = h.owner_id
            AND j.status IN (${inFlightPlaceholders})
          WHERE h.owner_id NOT LIKE 'lead:%'
          GROUP BY h.owner_id, h.worker_name`,
        IN_FLIGHT,
      );
      const workerLoadsKnown = !!(loadResult && loadResult.ok);
      const inFlightByName = new Map();
      const inFlightByOwner = new Map();
      for (const r of rows(loadResult)) {
        const owner = r.owner_id == null ? '' : String(r.owner_id);
        const wn = r.worker_name && String(r.worker_name).trim();
        if (owner) inFlightByOwner.set(owner, num(r.in_flight));
        if (wn) inFlightByName.set(wn, num(inFlightByName.get(wn)) + num(r.in_flight));
      }
      const nameByOwner = new Map(); // owner_id → stable name (even a momentarily-stale beat still names its owner)
      const heartbeatOwners = new Set();
      for (const r of hb) {
        if (r.owner_id) heartbeatOwners.add(r.owner_id);
        const wn = r.worker_name && String(r.worker_name).trim();
        if (wn && !nameByOwner.has(r.owner_id)) nameByOwner.set(r.owner_id, wn);
      }
      // DELIBERATE cancels vs genuine GIVE-UPS: an escalated coder job is a worker/Lead give-up UNLESS it
      // carries a 'cancelled' event (actor='human', written by lib.cancel / the CLI escalate route). That
      // marker is the failure-vs-choice cut — an unmarked escalation gets SURFACED ("gave up — needs you"),
      // a marked one is a deliberate operator cancel and stays SUPPRESSED (the worker shows its true state).
      // Default-surface: a give-up never written a marker still shows, so a real failure is never hidden.
      const cancelledIds = new Set(
        rows(q(`SELECT DISTINCT job_id FROM job_events WHERE kind = 'cancelled'`)).map((r) => r.job_id),
      );
      // WORKING elapsed: worker_heartbeat carries NO phase-start column, and its updated_at moves on
      // every 30s beat — so "on it for N min" can only come from the job's own append-only trail: the
      // latest gate approval, spec/build submission or status change at or before now (a build starts
      // the moment its spec is approved; a spec turn starts at the claim). Absent that, the card says
      // "working now" and carries no number — never "0 min" from a timestamp that just got refreshed.
      const hbJobIds = [...new Set(hb.map((r) => (r.job_id == null ? '' : String(r.job_id))).filter(Boolean))];
      const workStartByJob = new Map(hbJobIds.length ? rows(q(
        `SELECT job_id, MAX(created_at) started_at FROM job_events
          WHERE job_id IN (${hbJobIds.map(() => '?').join(',')})
            AND kind IN ('gate_decision','spec_submitted','build_submitted','status_change','pr_opened','claimed')
            AND created_at <= ?
          GROUP BY job_id`, [...hbJobIds, now],
      )).map((r) => [String(r.job_id), nullableInt(r.started_at)]) : []);
      const slots = new Map(); // key → { label, fresh, heartbeat, jobs, inFlightCount }
      const workerLoad = (workerName, ownerId) => {
        if (!workerLoadsKnown) return null;
        if (workerName) return num(inFlightByName.get(workerName));
        if (ownerId && inFlightByOwner.has(ownerId)) return num(inFlightByOwner.get(ownerId));
        return null; // no heartbeat match: do not imply this owner is a recognised worker
      };
      const slotFor = (key, label, workerName, ownerId) => {
        if (!slots.has(key)) {
          slots.set(key, {
            label,
            fresh: false,
            heartbeat: null,
            jobs: [],
            inFlightCount: workerLoad(workerName, ownerId),
            // WHO this worker is, from its OWN name (coder-2 → Coder, accountant-1 → Accountant).
            // null when the beat carries no name — resolved from its jobs' types in step 3, and
            // failing that the card degrades to the honest owner-id label it already had.
            agentKey: S.agentKeyForWorker(workerName),
          });
        }
        return slots.get(key);
      };
      // 1) all non-lead heartbeat rows, deduped by stable name||owner. Fresh idle rows form the
      // at-home roster; a stale row survives only while its last recorded phase is non-idle.
      for (const r of hb) {
        const wn = r.worker_name && String(r.worker_name).trim();
        const lastBeatAt = nullableInt(r.last_beat_at);
        const fresh = lastBeatAt !== null && now - lastBeatAt <= HEARTBEAT_FRESH_MS;
        const heartbeat = {
          ownerId: r.owner_id == null ? '' : String(r.owner_id),
          workerName: wn || '',
          jobId: r.job_id == null ? '' : String(r.job_id),
          phase: r.phase == null ? '' : String(r.phase).trim(),
          startedAt: r.job_id == null ? null : (workStartByJob.get(String(r.job_id)) ?? null),
          lastBeatAt,
          fresh,
        };
        if (heartbeat.ownerId.startsWith('lead:')) {
          if (!leadHeartbeat || num(heartbeat.lastBeatAt) > num(leadHeartbeat.lastBeatAt)) {
            leadHeartbeat = heartbeat;
          }
          continue;
        }
        const slot = slotFor(wn || r.owner_id, wn || shortOwner(r.owner_id), wn, r.owner_id);
        slot.fresh = slot.fresh || fresh;
        if (!slot.heartbeat || num(r.last_beat_at) > num(slot.heartbeat.lastBeatAt)) {
          slot.heartbeat = heartbeat;
        }
      }
      // 2) attribute each worker's CURRENT state to its slot: claimed/gated jobs (not queued), a RECENT terminal,
      // or a genuine GIVE-UP (unmarked escalated). Deliberate cancels + stale terminal are NOT worker state
      // (skipped). A give-up attaches ONLY to an EXISTING live slot — it never spawns a card — so a dead
      // worker's old escalation stays off the board (no live card), while a non-roster owner still gets a
      // fleet-level unattributed card for genuinely current work (never hidden or assigned by guesswork).
      const unattributed = [];
      for (const j of coderJobs) {
        if (j.status === 'queued') {
          unattributed.push(j); // queued work is fleet-only even if an owner_id happens to be present
          continue;
        }
        const currentWorkerState = j.status !== 'queued' && ACTIVE6.indexOf(j.status) !== -1;
        const recentTerminal = (j.status === 'done' || j.status === 'failed') && now - num(j.updated_at) <= RECENT_MS;
        const giveUp = j.status === 'escalated' && !cancelledIds.has(j.id); // unmarked escalated = genuine give-up
        if (!currentWorkerState && !recentTerminal && !giveUp) continue; // queued is fleet-only; skip cancels + stale terminal
        const owner = j.owner_id || null;
        const recognisedOwner = !!(owner && heartbeatOwners.has(owner));
        const wn = owner ? nameByOwner.get(owner) : null;
        const key = wn || owner || ' unassigned';
        if (recognisedOwner && slots.has(key)) slots.get(key).jobs.push(j); // a recognised worker's job — incl. its genuine give-up
        else if (recognisedOwner && currentWorkerState) slotFor(key, wn || shortOwner(owner), wn, owner).jobs.push(j); // stale heartbeat but current work: never hide it
        else if (currentWorkerState) unattributed.push(j); // visible later as fleet work, never as a worker
        // else: a give-up/terminal by a dead owner with no live slot → no card (the historical stay off)
      }
      // 3) a rep per slot; a fresh worker with no live job → idle "standing by"; drop empty non-roster slots
      const out = [];
      const jobsById = new Map(coderJobs.map((job) => [String(job.id), job]));
      for (const s of slots.values()) {
        const heartbeatWorking = !!(s.heartbeat && s.heartbeat.phase
          && s.heartbeat.phase.toLowerCase() !== 'idle');
        if (!s.jobs.length && !s.fresh && !heartbeatWorking) continue;
        // An unnamed beat still gets the right desk if its own work says which one.
        const agentKey = s.agentKey || (s.jobs.length ? agentForType(s.jobs[0].type) : null);
        let rep = pickRep(s.jobs);
        if (heartbeatWorking) {
          // Heartbeat is the authority for WORKING. Its job can already have crossed a transient
          // jobs.status boundary (or be absent from the selected job slice) without hiding work.
          rep = {
            bucket: 'working',
            job: jobsById.get(s.heartbeat.jobId) || rep.job || null,
            heartbeat: s.heartbeat,
          };
        }
        out.push({ label: s.label, rep, inFlightCount: s.inFlightCount, agentKey }); // pickRep([]) → idle "standing by"
      }
      if (!out.length) {
        out.push({
          label: idOf('coder').name,
          rep: pickRep([]),
          inFlightCount: workerLoadsKnown ? 0 : null,
          agentKey: 'coder',
        }); // never hide the role entirely
      }
      return {
        slots: out.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)),
        unattributed,
        leadHeartbeat,
      };
    }

    // --- review_drafts: the operator queue that surfaces Reviews as blocked-on-you ------------------
    const draftRows = rows(q(
      `SELECT draft_status, COUNT(*) c FROM review_drafts WHERE draft_status NOT IN ('responded','skipped','posted') GROUP BY draft_status`
    ));
    let toApprove = 0;
    let toPost = 0;
    for (const r of draftRows) {
      if (r.draft_status === 'awaiting_approval') toApprove += num(r.c);
      else toPost += num(r.c); // 'draft' (in-voice, ready to copy & post)
    }
    const pendingDrafts = toApprove + toPost;
    // guard_flagged is TEXT (NULL = clean, else a comma-joined excuse-tell string) — match the writer
    // (draftQueue.ts) + sister reviews.js, NOT '=1' which never matches a real flag (TEXT affinity).
    const guardFlagged = num((rows(q(
      `SELECT COUNT(*) c FROM review_drafts WHERE guard_flagged IS NOT NULL AND guard_flagged <> '' AND draft_status NOT IN ('responded','skipped','posted')`
    ))[0] || {}).c);

    // --- build cards ------------------------------------------------------------------------------
    const cards = []; // each: {col, ...card}, with _trackJob/_trackMode resolved to .track later
    const trackJobIds = new Set();

    function deptNameFor(parentJob) {
      const child = childOf.get(parentJob.id);
      if (!child) return 'another';
      return idOf(child.type).name;
    }

    function agentCard(meta, rep, inFlightCount) {
      const job = rep.job;
      const c = {
        kind: 'agent', av: meta.av, initials: meta.initials, name: meta.name, role: meta.role,
        dept: meta.dept, deptLabel: meta.deptLabel, deptColour: meta.deptColour,
      };
      if (inFlightCount !== undefined) {
        c.workerGauge = { known: inFlightCount !== null, count: inFlightCount };
      }
      const summary = job ? describeJob(job) || String(job.type) : null;
      const heartbeat = rep.heartbeat || null;
      // A life-dispatched rep job links its card back to the task (board↔task, 2026-08-13).
      // Set AFTER the bucket branches below so a blocked-on-you card keeps its gate button.
      const lifeRep = job ? lifeTaskOf(job) : null;
      if (rep.bucket === 'blocked_you') {
        const cp = youCopy(meta.key, job.status);
        const heldAge = HELD_STATUSES.has(job.status) ? heldAgeByJob.get(job.id) : undefined;
        const pr = job.status === 'awaiting_signoff' ? gatePrByJob.get(job.id) : null;
        const staleGate = pr && (pr.state === 'merged' || pr.state === 'closed');
        c.col = 'blocked';
        c.variant = 'you';
        c.task = staleGate
          ? { strong: 'PR #' + pr.number + ' ' + pr.state + ' — gate record stale' }
          : { strong: summary, tail: ' — ' + cp.verb + '.' };
        c.waitPill = { tone: 'you', text: staleGate ? 'Gate record stale' : cp.pill };
        if (!staleGate) c.button = { label: cp.btn };
        c.talkJobId = job.id; // "Talk about this" → MC Chat, where close/retask live
        // HONESTY ABOUT WHAT THIS BOARD CAN SEE (2026-09-04): nothing on the box writes a PR's merged/
        // closed state today — a merge made outside the Telegram tap never reaches the job trail. So
        // a gate that is NOT provably stale is not thereby provably live; say so next to the tap rather
        // than let "Needs your merge tap" imply the PR is still open.
        const prNote = pr && !staleGate ? ' · PR #' + pr.number + ' — merged/closed state is not tracked on this box' : '';
        c.time = (job.status === 'awaiting_signoff'
          ? heldAge === null ? 'waiting on the operator' : 'waiting on the operator · ' + fmtDur(heldAge)
          : heldAge === null ? 'held'
            : 'held ' + S.agoLabel(heldAge)) + prNote;
        if (heldAge !== undefined && heldAge !== null) c._ageMs = heldAge;
        c._trackJob = job.id;
        c._trackMode = 'gate';
        trackJobIds.add(job.id);
      } else if (rep.bucket === 'blocked_dept') {
        c.col = 'blocked';
        c.variant = 'dept';
        c.task = { strong: summary, tail: ' — handed down, awaiting the other desk.' };
        c.waitPill = { tone: 'dept', text: 'Waiting on ' + deptNameFor(job) + ' Dept' };
        c.time = 'blocked ' + S.agoLabel(now - num(job.updated_at));
      } else if (rep.bucket === 'working') {
        c.col = 'working';
        c.variant = 'w';
        if (heartbeat) {
          const workName = summary || (heartbeat.jobId ? 'Job ' + heartbeat.jobId : 'Current work');
          const facts = [];
          if (heartbeat.jobId) facts.push('job ' + heartbeat.jobId);
          facts.push('phase ' + heartbeat.phase);
          c.task = { strong: workName, tail: ' — ' + facts.join(' · ') + '.' };
          if (heartbeat.fresh) {
            const elapsed = heartbeat.startedAt === null ? null : now - heartbeat.startedAt;
            c.time = Number.isFinite(elapsed) && elapsed >= 0
              ? Math.floor(elapsed / 60000) + ' min'
              : 'working now';
          } else {
            const seen = heartbeat.lastBeatAt === null ? null : now - heartbeat.lastBeatAt;
            c.time = Number.isFinite(seen) && seen >= 0
              ? 'last seen ' + Math.floor(seen / 60000) + ' min ago'
              : 'last seen time unknown';
          }
        } else {
          c.task = { strong: summary, tail: '.' };
          c.time = 'running ' + fmtDur(now - num(job.updated_at));
        }
        c._trackJob = heartbeat && heartbeat.jobId ? heartbeat.jobId : job && job.id;
        c._trackMode = 'working';
        if (c._trackJob) trackJobIds.add(c._trackJob);
      } else if (rep.bucket === 'queued') {
        c.col = 'queued';
        c.variant = 'q';
        c.task = { strong: summary, tail: ' queued.' };
        c.time = 'waiting ' + S.agoLabel(now - num(job.created_at));
      } else if (rep.bucket === 'done') {
        c.col = 'done';
        c.variant = 'd';
        // Same honesty as the generic cards: an ANSWERED give-up says so (it reached 'done'
        // only because the owner already replied — calling it "done" would be a lie).
        const answered = answeredJobIds.has(job.id);
        const mode = (lifeAnswered.get(job.id) || {}).mode;
        c.task = { strong: summary, tail: answered
          ? (mode === 'AI' ? ' — gave up; you sent it back, a fresh run follows.'
            : ` — gave up; you sent it back, but the task is routed ${mode} and the sweep only takes AI-routed work.`)
          : ' — done.' };
        c.time = (answered ? '↩ answered · ' : '✓ ') + S.agoLabel(now - num(job.updated_at));
      } else if (rep.bucket === 'failed') {
        c.col = 'done';
        c.variant = '';
        c.inlineStyle = 'border-left:2.5px solid var(--amber)';
        c.task = { strong: summary, tail: ' — failed' + (job.error ? ': ' + trunc(job.error, 70) : '') + '.' };
        c.time = '✕ failed · ' + S.agoLabel(now - num(job.updated_at));
      } else {
        // idle (built agent, no active/recent job)
        c.col = 'idle';
        c.variant = 'i';
        c.task = { muted: true, tail: 'No active job — standing by.' };
        if (job) c.time = 'last seen ' + S.agoLabel(now - num(job.updated_at));
      }
      // The board↔task link: only where no bucket button exists (a blocked-on-you card's
      // gate tap outranks navigation — the tap IS the point there).
      if (lifeRep && !c.button && rep.bucket !== 'idle') {
        c.button = { label: 'Open the task', href: '/life/task?id=' + encodeURIComponent(lifeRep.taskId) };
        c.role = meta.role + ' · life task';
      }
      return c;
    }

    // Lead by job state (one Lead). Coder: ONE card PER live worker, named (Coder-1 / Coder-2), each
    // showing its own job state — replaces the single collapsed "Coder" so two workers are both visible.
    const workerRoster = workerSlots(workerJobs);
    let leadRep = pickRep(byAgent.lead);
    const leadHeartbeat = workerRoster.leadHeartbeat;
    if (leadHeartbeat && leadHeartbeat.phase && leadHeartbeat.phase.toLowerCase() !== 'idle') {
      leadRep = {
        bucket: 'working',
        job: byAgent.lead.find((job) => String(job.id) === leadHeartbeat.jobId) || leadRep.job || null,
        heartbeat: leadHeartbeat,
      };
    }
    const leadId = idOf('lead');
    cards.push(agentCard(
      leadHeartbeat && leadHeartbeat.workerName ? { ...leadId, name: leadHeartbeat.workerName } : leadId,
      leadRep,
    ));
    for (const slot of workerRoster.slots) {
      // The INSTANCE keeps its own name (coder-1, accountant-1) — the operator needs to know which
      // worker — while the identity underneath it comes from the roster, so each desk reads as
      // itself. `role` is the agent's real job, never the first-registered worker's.
      const id = idOf(slot.agentKey || 'coder');
      cards.push(agentCard({ ...id, name: slot.label }, slot.rep, slot.inFlightCount));
    }
    const unattributedCoderJobIds = new Set(workerRoster.unattributed.map((job) => job.id));
    generics.push(...workerRoster.unattributed);

    // Reviews: a job-gate outranks the draft queue; otherwise the pending operator queue surfaces it as
    // blocked-on-you (summarised from review_drafts — the mockup's signature Reviews card).
    const revRep = pickRep(byAgent.reviews);
    const revId = idOf('reviews');
    if (revRep.bucket === 'blocked_you') {
      cards.push(agentCard(revId, revRep));
    } else if (pendingDrafts > 0) {
      const parts = [];
      if (toApprove > 0) parts.push(toApprove + ' to approve');
      if (toPost > 0) parts.push(toPost + ' to copy & post');
      cards.push({
        kind: 'reviewsQueue',
        col: 'blocked',
        variant: 'you',
        av: revId.av,
        initials: revId.initials,
        name: revId.name,
        role: revId.role,
        dept: revId.dept, deptLabel: revId.deptLabel, deptColour: revId.deptColour,
        task: { strong: pendingDrafts + (pendingDrafts === 1 ? ' reply' : ' replies'), tail: ' drafted, in voice' + (guardFlagged > 0 ? ' · ' + guardFlagged + ' guard-flagged' : '') + '.' },
        waitPill: { tone: 'you', text: parts.join(' · ') },
        button: { label: 'Go to queue', href: '/reviews' },
      });
    } else {
      const rc = agentCard(revId, revRep);
      if (revRep.bucket === 'idle') rc.task = { muted: true, tail: 'Queue clear — no drafts pending.' };
      cards.push(rc);
    }

    // Generic unmapped jobs → honest cards by their real type. Non-terminal always; cap recent terminal.
    let genTerminal = 0;
    for (const j of generics.slice().sort((x, y) => num(y.updated_at) - num(x.updated_at))) {
      const b = classify(j, activeChildParents, answeredJobIds);
      const life = lifeTaskOf(j);
      // What the work IS, for every job — not just life-dispatched ones. This branch used to call
      // describeJob ONLY for life jobs, so a plain fleet card could only ever say "boxquery", never
      // the question the operator actually asked. The agent's name is on the card already; the body
      // is for the work.
      const typeLabel = describeJob(j) || String(j.type || 'job');
      const fleetOnly = unattributedCoderJobIds.has(j.id);
      // The card is named for the AGENT that owns the work — "Rex", "Financial Planner" — not the
      // raw job type it used to print ('cos-query', 'finplan'). An unmapped type still shows itself
      // verbatim (identity.known === false): honest, never a fabricated name.
      const id = idOf(j.type);
      const where = life
        ? 'life task'
        : fleetOnly
          ? (j.status === 'queued' ? 'fleet · unattributed queue' : (j.owner_id ? 'fleet · unrecognised ' + trunc(String(j.owner_id), 14) : 'fleet · unowned'))
          : 'worker · ' + (j.owner_id ? trunc(String(j.owner_id), 14) : 'unassigned');
      const role = id.known ? id.role + ' · ' + where : where;
      const base = {
        kind: 'generic', av: id.av, initials: id.initials, name: trunc(id.name, 18), role,
        dept: id.dept, deptLabel: id.deptLabel, deptColour: id.deptColour,
        // Explicit flags rather than sniffing the role text: the role is operator-facing copy and
        // WILL be reworded, so anything that needs to know "is this fleet-level / a life task"
        // should read the fact, not the sentence.
        fleet: !!fleetOnly, lifeTask: !!life,
      };
      // The board↔task link (operator ask 2026-08-13): a life job's card opens its task.
      // Blocked-on-you keeps its gate button (the tap is the point there).
      const lifeBtn = life ? { label: 'Open the task', href: '/life/task?id=' + encodeURIComponent(life.taskId) } : null;
      if (b === 'blocked_you') {
        const cp = youCopy(null, j.status);
        const heldAge = HELD_STATUSES.has(j.status) ? heldAgeByJob.get(j.id) : undefined;
        const pr = j.status === 'awaiting_signoff' ? gatePrByJob.get(j.id) : null;
        const staleGate = pr && (pr.state === 'merged' || pr.state === 'closed');
        const prNote = pr && !staleGate ? ' · PR #' + pr.number + ' — merged/closed state is not tracked on this box' : '';
        const waiting = (j.status === 'awaiting_signoff'
          ? heldAge === null ? 'waiting on the operator' : 'waiting on the operator · ' + fmtDur(heldAge)
          : heldAge === null ? 'held' : 'held ' + S.agoLabel(heldAge)) + prNote;
        const blocked = {
          col: 'blocked', variant: 'you',
          task: staleGate
            ? { strong: 'PR #' + pr.number + ' ' + pr.state + ' — gate record stale' }
            : { strong: typeLabel, tail: ' — ' + cp.verb + '.' },
          waitPill: { tone: 'you', text: staleGate ? 'Gate record stale' : cp.pill },
          talkJobId: j.id, time: waiting,
          _ageMs: heldAge === undefined ? now - num(j.updated_at) : heldAge,
          _trackJob: j.id, _trackMode: 'gate',
        };
        if (!staleGate) blocked.button = { label: cp.btn };
        cards.push(Object.assign(base, blocked));
        trackJobIds.add(j.id);
      } else if (b === 'blocked_dept') {
        cards.push(Object.assign(base, { col: 'blocked', variant: 'dept', task: { strong: typeLabel, tail: ' — awaiting another desk.' }, waitPill: { tone: 'dept', text: 'Waiting on ' + deptNameFor(j) + ' Dept' }, time: 'blocked ' + S.agoLabel(now - num(j.updated_at)), _ageMs: now - num(j.updated_at), button: lifeBtn || undefined }));
      } else if (b === 'working') {
        cards.push(Object.assign(base, { col: 'working', variant: 'w', task: { strong: typeLabel, tail: ' running.' }, time: 'running ' + fmtDur(now - num(j.updated_at)), _trackJob: j.id, _trackMode: 'working', button: lifeBtn || undefined }));
        trackJobIds.add(j.id);
      } else if (b === 'queued') {
        cards.push(Object.assign(base, { col: 'queued', variant: 'q', task: { strong: typeLabel, tail: ' queued.' }, time: 'waiting ' + S.agoLabel(now - num(j.created_at)), button: lifeBtn || undefined }));
      } else if ((b === 'done' || b === 'failed') && now - num(j.updated_at) <= RECENT_MS && genTerminal < 4) {
        genTerminal++;
        const answered = life && answeredJobIds.has(j.id);
        if (answered) {
          // The owner already answered this give-up. Say what actually happened — and, when
          // the task is not AI-routed, that the promised re-run cannot happen until he says so.
          const mode = (lifeAnswered.get(j.id) || {}).mode;
          const tail = mode === 'AI'
            ? ' — gave up; you sent it back, a fresh run follows.'
            : ` — gave up; you sent it back, but the task is routed ${mode} and the sweep only takes AI-routed work.`;
          cards.push(Object.assign(base, { col: 'done', variant: 'd', task: { strong: typeLabel, tail }, time: '↩ answered · ' + S.agoLabel(now - num(j.updated_at)), button: lifeBtn || undefined }));
        } else if (b === 'failed') {
          cards.push(Object.assign(base, { col: 'done', variant: '', inlineStyle: 'border-left:2.5px solid var(--amber)', task: { strong: typeLabel, tail: ' — failed.' }, time: '✕ failed · ' + S.agoLabel(now - num(j.updated_at)), button: lifeBtn || undefined }));
        } else {
          cards.push(Object.assign(base, { col: 'done', variant: 'd', task: { strong: typeLabel, tail: ' — done.' }, time: '✓ ' + S.agoLabel(now - num(j.updated_at)), button: lifeBtn || undefined }));
        }
      }
    }

    // REMOVED 2026-08-13: two hard-coded cards claiming Research was "Not yet wired" and the
    // Accountant "Planned specialist. Not built." Both were true when written and false for weeks
    // since — coyote-researcher and coyote-accountant are running services that had each completed
    // real jobs the same day the operator was reading this board. They now appear from their own
    // heartbeats like every other worker, so the board can no longer assert an agent does not exist
    // while that agent is working. A hard-coded claim about live state has no way to stop being a
    // lie; the heartbeat does.

    // --- resolve mini-tracks from real milestone events -------------------------------------------
    if (trackJobIds.size) {
      const ids = Array.from(trackJobIds);
      const ph = ids.map(() => '?').join(',');
      const evRows = rows(q(`SELECT job_id, kind FROM job_events WHERE job_id IN (${ph})`, ids));
      const milestones = new Map(); // job_id → Set(kind)
      for (const e of evRows) {
        if (!milestones.has(e.job_id)) milestones.set(e.job_id, new Set());
        milestones.get(e.job_id).add(e.kind);
      }
      for (const c of cards) {
        if (!c._trackJob) continue;
        const set = milestones.get(c._trackJob) || new Set();
        let done = 0;
        for (const k of ['spec_submitted', 'build_submitted', 'pr_opened']) if (set.has(k)) done++;
        c.track = buildTrack(c._trackMode, done);
      }
    }

    // --- assemble columns in fixed order ----------------------------------------------------------
    // THE FLEET AT REST GOES HOME (operator ask 2026-08-13: "if they are done on a job then they
    // can be in their departments which will sit above the kanban board — the list for complete is
    // long so makes it messy").
    //
    // The board is for work IN MOTION. An agent that is idle, or that finished something hours
    // ago, is not work — it was sitting in Idle and Done as a card the same size and weight as a
    // live job, which is what made Done a wall. Those agents now sit in their DEPARTMENT above the
    // board, where "who have I got and what did they last do" is answered in one glance.
    //
    // Only AGENT cards move. A job card — a life task, an unattributed fleet job — stays in Done,
    // because that IS a piece of work reaching an end and the operator tracks it. Nothing is
    // hidden: an agent that FAILED goes home too, with the failure named on its row.
    const atRest = new Set(['idle', 'done']);
    const isAgentCard = (c) => c.kind === 'agent' || c.kind === 'reviewsQueue';
    const homeCards = cards.filter((c) => isAgentCard(c) && atRest.has(c.col));
    const boardCards = cards.filter((c) => !(isAgentCard(c) && atRest.has(c.col)));

    // WHAT EACH DESK KNOWS. The department panel is where the operator looks to see a desk, so it
    // is where "and here is what it has already established" belongs — the full list reads on
    // /claw/memory. A missing table (a tree that has not deployed the memory build yet, and every
    // fixture that does not seed one) degrades to NO chip — never a zero, which would read as
    // "this desk has learned nothing" when the truth is "we cannot tell".
    const memByDept = new Map();
    const memRes = q(`SELECT department, COUNT(*) c FROM fleet_memory WHERE superseded_by IS NULL AND department IS NOT NULL GROUP BY department`);
    const memoryKnown = !!(memRes && memRes.ok);
    for (const r of rows(memRes)) memByDept.set(String(r.department || '').toLowerCase(), num(r.c));

    // One panel per department that has anyone at home; the rest are named as quiet in one line, so
    // a department is never silently missing.
    const departments = [];
    for (const d of Object.values(S.DEPARTMENTS)) {
      const mine = homeCards.filter((c) => c.dept === d.key);
      if (!mine.length) continue;
      departments.push({
        key: d.key, label: d.label, colour: d.colour,
        knows: memoryKnown ? num(memByDept.get(d.key)) : null,
        // The row carries the SAME identity fields a board card does — name, role, department,
        // avatar, worker gauge. Going home must not make an agent's facts less available than
        // being on the board did; only the presentation changes.
        agents: mine.map((c) => ({
          kind: c.kind, name: c.name, initials: c.initials, role: c.role, av: c.av, col: c.col,
          dept: c.dept, deptLabel: c.deptLabel, deptColour: c.deptColour,
          workerGauge: c.workerGauge,
          line: c.task ? ((c.task.strong || '') + (c.task.tail || '')).trim() : '',
          time: c.time || '', failed: /failed/i.test(String(c.time || '')),
          button: c.button || null,
        })),
      });
    }
    // A department with nobody at home is either OUT (its agents are on the board right now) or
    // genuinely empty. Saying "nobody at home in Build" while both Coders sit in Blocked would read
    // as though the department did not exist — the same class of lie as the old "Not built" cards.
    const onBoardDepts = new Set(boardCards.filter((c) => isAgentCard(c) && c.dept).map((c) => c.dept));
    const restDepts = Object.values(S.DEPARTMENTS).filter((d) => !departments.some((x) => x.key === d.key));
    const outDepts = restDepts.filter((d) => onBoardDepts.has(d.key)).map((d) => d.label);
    const quietDepts = restDepts.filter((d) => !onBoardDepts.has(d.key)).map((d) => d.label);

    const COLS = [
      { id: 'queued', cls: 'queued', label: 'Queued' },
      { id: 'working', cls: 'working', label: 'Working' },
      { id: 'blocked', cls: 'blocked', label: 'Blocked' },
      { id: 'done', cls: 'done', label: 'Done' },
    ];
    // TRIAGE (audit 2026-07-21): the blocked column reads oldest-first (a 48-day-held item led
    // the audit's red wall from the BOTTOM); give-ups older than 7 days move to a collapsed
    // AGING group — still listed, still ackable (the default-surface convention stands; only
    // the presentation ages).
    const AGING_MS = 7 * 86_400_000;
    const columns = COLS.map((col) => {
      const colCards = boardCards.filter((c) => c.col === col.id);
      if (col.id !== 'blocked') return { ...col, cards: colCards };
      const sorted = colCards.slice().sort((a, b) => (b._ageMs || 0) - (a._ageMs || 0));
      return { ...col, cards: sorted.filter((c) => (c._ageMs || 0) < AGING_MS), aging: sorted.filter((c) => (c._ageMs || 0) >= AGING_MS) };
    });

    return {
      halt: ctx.halt || { halted: false },
      lib: { active: libActive, total: libTotal, events: libEvents },
      queueDepth,
      departments,
      quietDepts,
      outDepts,
      columns,
    };
  },

  render(section, ctx) {
    const esc = S.escapeHtml;
    const stamp = 'live · <b>polling the Librarian</b>';

    function taskHtml(t) {
      if (!t) return '';
      let inner = '';
      if (t.lead) inner += esc(t.lead);
      if (t.strong) inner += '<b>' + esc(t.strong) + '</b>';
      if (t.tail) inner += esc(t.tail);
      return t.muted ? '<span class="muted">' + inner + '</span>' : inner;
    }
    function trackHtml(track) {
      if (!track || !track.length) return '';
      return '<div class="mini-track">' + track.map((s) => '<div class="mini-seg' + (s ? ' ' + s : '') + '"></div>').join('') + '</div>';
    }
    // The worker's current load, INLINE. This was a boxed row on every worker card — a full band of
    // vertical space that, on an idle fleet, said "Current in-flight: 0" six times over. A worker
    // carrying nothing is already described by its card ("standing by"), so the pill appears only
    // when the number is worth reading: a real load, or an honest "attribution unavailable".
    // The data attribute stays on the card in every case — the number is still published.
    function workerGaugeHtml(gauge) {
      if (!gauge) return '';
      const known = gauge.known;
      const attr = ' data-worker-in-flight="' + (known ? esc(String(gauge.count)) : 'unknown') + '"';
      if (known && gauge.count === 0) return '<span class="inflight-pill" hidden' + attr + ' title="Current in-flight">0</span>';
      const label = known ? esc(S.fmtInt(gauge.count)) + ' in flight' : 'load unknown';
      const style = known ? '' : ' style="background:rgba(137,154,177,.14);color:var(--muted);border-color:var(--border)"';
      return '<span class="inflight-pill"' + attr + style + ' title="Current in-flight">' + label + '</span>';
    }
    function footHtml(c) {
      let btn = '';
      if (c.button) {
        btn = c.button.href
          ? '<a class="acard-btn" href="' + esc(c.button.href) + '">' + esc(c.button.label) + '</a>'
          : '<button class="acard-btn" type="button">' + esc(c.button.label) + '</button>';
      }
      // TALK ABOUT THIS (operator ask 2026-08-13): "theres no way to resolve this" — a card
      // held 8 days offered only "Open in TG". This is a plain LINK into MC Chat carrying the
      // job id (a GET, never a write affordance — /claw stays the read-only console and its
      // boundary test still holds); the chat composer opens pre-loaded so the resolving verbs
      // — close <id> / retask <id> — are one keystroke away, and the agents are right there.
      const talk = c.talkJobId
        ? '<a class="acard-btn" href="/claw/chat?about=' + encodeURIComponent(c.talkJobId) + '">Talk about this</a>'
        : '';
      const time = c.time ? '<span class="acard-time">' + esc(c.time) + '</span>' : '';
      if (!btn && !talk && !time) return '';
      return '<div class="acard-foot">' + btn + talk + time + '</div>';
    }
    function cardHtml(c) {
      const cls = 'acard' + (c.variant ? ' ' + c.variant : '') + (c.faded ? ' faded' : '');
      const style = c.inlineStyle ? ' style="' + esc(c.inlineStyle) + '"' : '';
      const nameStyle = c.dim ? ' style="color:rgba(170,195,225,.4)"' : '';
      const pill = c.waitPill ? '<div class="wait-pill ' + c.waitPill.tone + '"><span class="ar">▸</span>' + esc(c.waitPill.text) + '</div>' : '';
      // DEPARTMENT: the avatar is tinted with the department's own colour and the name carries its
      // chip. Kanban STATE keeps the left rail (green working / red blocked / blue queued), so the
      // two never share a surface and cannot be read for each other.
      // SOLID, not tinted: the avatar now sits ON the department band, and a 14%-alpha tint on a
      // 24%-alpha band is invisible. Dark initials on the full department colour give the card a
      // hard anchor point — every department colour is light enough to carry near-black text.
      const avStyle = c.deptColour
        ? ' style="background:' + esc(c.deptColour) + ';color:#0A0E16;border-color:' + esc(c.deptColour) + '"'
        : '';
      const avCls = 'acard-av ' + c.av + (c.deptColour ? ' dept-av' : '');
      const chip = c.dept ? S.deptChip(c.dept) : '';
      // The head of the card IS the department colour — a gradient so it reads as a deliberate band
      // rather than a flat block, fading into the card body. Colour is inline because it is data.
      const headStyle = c.deptColour
        ? ' style="background:' + esc(c.deptColour) + '26;border-top-color:' + esc(c.deptColour) + ';border-bottom-color:' + esc(c.deptColour) + '40"'
        : ' style="border-color:transparent"';
      return (
        '<div class="' + cls + '"' + style + '>' +
        '<div class="acard-head"' + headStyle + '>' +
        '<div class="acard-top" style="margin-bottom:0"><div class="' + avCls + '"' + avStyle + '>' + esc(c.initials) + '</div>' +
        '<div><div class="acard-namerow"><span class="acard-name"' + nameStyle + '>' + esc(c.name) + '</span>' + chip
        + workerGaugeHtml(c.workerGauge) + '</div>' +
        '<div class="acard-role">' + esc(c.role) + '</div></div></div></div>' +
        '<div class="acard-task">' + taskHtml(c.task) + '</div>' +
        pill +
        trackHtml(c.track) +
        footHtml(c) +
        '</div>'
      );
    }
    // A column with nothing in it is a STATE, and it should say which one. Empty columns used to
    // render a header over dead space — and on this board "Working: 0" is the normal reading, not a
    // fault, because a job can pass through it in under twelve seconds.
    const EMPTY_COPY = {
      idle: 'Every agent has work or has just finished.',
      queued: 'Nothing waiting — the fleet is keeping up.',
      working: 'No worker is building right now. Builds typically run 10–30 minutes.',
      blocked: 'Nothing is waiting on you. ✓',
      done: 'Nothing finished recently.',
    };
    function colHtml(col) {
      const body = col.cards.length
        ? col.cards.map(cardHtml).join('')
        : '<div class="col-empty">' + esc(EMPTY_COPY[col.id] || 'Nothing here.') + '</div>';
      const aging = (col.aging && col.aging.length)
        ? '<details style="margin-top:8px"><summary style="font-family:var(--font-mono,monospace);font-size:10.5px;color:var(--muted,#7a8);cursor:pointer;list-style:none">aging (' + col.aging.length + ') — held over 7 days ▸</summary>' + col.aging.map(cardHtml).join('') + '</details>'
        : '';
      const total = col.cards.length + ((col.aging && col.aging.length) || 0);
      return (
        '<div class="col ' + col.cls + '">' +
        '<div class="col-head"><span class="col-name"><i></i>' + esc(col.label) + '</span>' +
        '<span class="col-count">' + total + '</span></div>' +
        body + aging +
        '</div>'
      );
    }

    const lib = section.lib || { active: 0, total: 0, events: 0 };
    const haltBanner = section.halt && section.halt.halted
      ? '<div class="banner amber">Operations paused · ' + esc(section.halt.source || 'halt') + ' — the board is read-only; the fleet stays put until you re-arm.</div>'
      : '';

    const apex =
      '<div class="apex">' +
      '<div class="lead-card boss">' +
      '<div class="lead-av boss">BO</div>' +
      '<div class="lead-body">' +
      // Trimmed to one line: this card is a STATUS, and the two sentences explaining that a router
      // routes were documentation sitting in the operator's most valuable screen space.
      '<div class="lead-top"><span class="lead-name">Boss</span><span class="lead-role">router · reception</span><span class="mstat idle"><span class="sd"></span>Listening</span></div>' +
      '<div class="lead-desc"><span class="muted">Classifies every incoming message and routes it — a switchboard, not a manager.</span></div>' +
      '</div></div>' +
      '<div class="lead-card cos">' +
      '<div class="lead-av cos">CS</div>' +
      '<div class="lead-body">' +
      '<div class="lead-top"><span class="lead-name">Chief of Staff</span><span class="lead-role">advisor · briefings</span><span class="mstat ready"><span class="sd"></span>Ready</span></div>' +
      '<div class="lead-desc"><span class="muted">Reads everything, synthesises status, talks through next steps — the one you actually talk to.</span></div>' +
      // The Chief of Staff button was DEAD — a styled <button> with no handler anywhere, on
      // the one card whose whole promise is "the one you actually talk to" (operator ask
      // 2026-08-13: "we also need to be able to talk to … the cheif of staff"). It is now a
      // link into MC Chat with the question pre-loaded; Rex answers inline there, read-only,
      // and /claw stays a read-only console (a GET link is not a write affordance).
      '<div class="cos-actions">' +
      '<a class="cos-btn" href="/claw/chat?ask=' + encodeURIComponent('Rex, what has been done today?') + '">▸ What\'s been done today?</a>' +
      '<a class="cos-btn ghost" href="/claw/chat">▸ Talk to the fleet</a>' +
      '</div>' +
      '</div></div>' +
      '</div>';

    // THE LIBRARIAN, and THE FLEET QUEUE, as one-line strips.
    //
    // Both used to be full-width bands: the Librarian spent a whole block of the page on three
    // counters and a paragraph explaining what a database is, and the queue spent a four-tile row
    // restating what the board's own columns say two inches lower (queued / in-flight / awaiting
    // sign-off). Between them they pushed the actual board — the thing the page is for — below the
    // fold. Every number survives, with the same data attributes; only the furniture is gone.
    const librarian =
      '<div class="strip">' +
      '<span class="s-name">The Librarian</span>' +
      '<span class="s-item"><b>' + esc(S.fmtInt(lib.active)) + '</b> active</span>' +
      '<span class="s-item"><b>' + esc(S.fmtInt(lib.total)) + '</b> run all-time</span>' +
      '<span class="s-item"><b>' + esc(S.fmtInt(lib.events)) + '</b> events</span>' +
      '<span class="s-sep"></span>' +
      '<span class="s-note">state spine · every job, result and gate decision · the board renders from it</span>' +
      '</div>';

    const queue = section.queueDepth || { queued: 0, inFlight: 0, awaitingSignoff: 0, oldestQueuedAgeMs: null };
    const oldestQueue = queue.oldestQueuedAgeMs === null
      ? (queue.queued ? 'unknown' : 'queue empty')
      : S.agoLabel(queue.oldestQueuedAgeMs);
    const queueContext =
      '<div class="strip" data-queue-depth="fleet">' +
      '<span class="s-name">Fleet queue</span>' +
      '<span class="s-item"><b data-queue-bucket="queued">' + esc(S.fmtInt(queue.queued)) + '</b> queued · unattributed</span>' +
      '<span class="s-item"><b data-queue-bucket="in-flight">' + esc(S.fmtInt(queue.inFlight)) + '</b> in flight</span>' +
      '<span class="s-item"><b data-queue-bucket="awaiting-signoff">' + esc(S.fmtInt(queue.awaitingSignoff)) + '</b> awaiting your sign-off</span>' +
      '<span class="s-sep"></span>' +
      '<span class="s-note">oldest queued: ' + esc(oldestQueue) + '</span>' +
      '</div>';

    // THE DEPARTMENTS — the fleet at home, above the board. Each agent is one dense ROW, not a
    // card: at rest the useful facts are who it is and what it last did, and a card's worth of
    // chrome for that is exactly what made the Done column a wall.
    function deptHtml(d) {
      const rows = d.agents.map((a) => {
        // NOT truncated. This line carries the honesty copy — "you sent it back, but the task is
        // routed HYBRID and the sweep only takes AI-routed work" is the sentence that stops the
        // owner waiting for a re-run that cannot happen. Clipping it at 68 characters cut it in
        // half. A row can wrap; a half-truth cannot.
        const detail = a.line
          ? '<div class="dagent-line' + (a.failed ? ' bad' : '') + '">' + esc(a.line) + '</div>'
          : '';
        // What this agent DOES, kept at rest: the department panel doubles as the org chart, and
        // "finds precedent · cites sources" is the answer to "what have I actually got here".
        const role = a.role ? '<div class="dagent-role">' + esc(a.role) + '</div>' : '';
        const when = a.time ? '<span class="dagent-time">' + esc(a.time) + '</span>' : '';
        const open = a.button && a.button.href
          ? '<a class="dagent-link" href="' + esc(a.button.href) + '">' + esc(a.button.label) + '</a>'
          : '';
        return '<div class="dagent">'
          + '<div class="dagent-av ' + esc(a.av) + '" style="background:' + esc(d.colour) + ';color:#0A0E16;border-color:' + esc(d.colour) + '">' + esc(a.initials) + '</div>'
          + '<div class="dagent-body"><div class="dagent-top"><span class="dagent-name">' + esc(a.name) + '</span>'
          + workerGaugeHtml(a.workerGauge) + when + '</div>'
          + role + detail + open + '</div></div>';
      }).join('');
      // "knows N" links to the full list — the desk's own established findings, which every job it
      // runs is given before it starts.
      const knows = d.knows
        ? '<a class="dept-knows" href="/claw/memory" title="what this desk has established — every job is given it before it starts">knows ' + d.knows + '</a>'
        : '';
      return '<div class="dept-panel" style="border-top-color:' + esc(d.colour) + ';background:' + esc(d.colour) + '0A">'
        + '<div class="dept-panel-head" style="color:' + esc(d.colour) + '">' + esc(d.label)
        + knows + '<span class="dept-panel-n">' + d.agents.length + '</span></div>'
        + rows + '</div>';
    }
    const depts = section.departments || [];
    const notes = [];
    if ((section.outDepts || []).length) {
      notes.push('<span style="color:var(--text-2)">Out on the board:</span> ' + esc((section.outDepts || []).join(' · ')));
    }
    if ((section.quietDepts || []).length) {
      notes.push('No agents standing by in ' + esc((section.quietDepts || []).join(' · ')));
    }
    const quiet = notes.length ? '<div class="dept-quiet">' + notes.join(' &nbsp;·&nbsp; ') + '</div>' : '';
    const deptBand = depts.length || quiet
      ? '<div class="sec-label" style="margin-top:16px">The departments<span class="rule"></span>'
        + '<span class="legend"><span>standing by · last job shown</span></span></div>'
        + '<div class="dept-grid">' + depts.map(deptHtml).join('') + '</div>' + quiet
      : '';

    // The board's own heading carries the state legend. The old "The fleet" flow-divider is gone:
    // it was a third heading for the same region, and its 'idle' swatch named a column that no
    // longer exists — idle agents are at home in their department now.
    const board = '<div class="flow-divider" style="margin:18px 0 13px">'
      + '<span class="t">On the board</span><span class="rule"></span>'
      + '<span class="legend">'
      + '<span><i style="background:#60A5FA"></i>queued</span>'
      + '<span><i style="background:#34D399"></i>working</span>'
      + '<span><i style="background:#F87171"></i>blocked</span>'
      + '<span><i style="background:rgba(52,211,153,.45)"></i>done</span>'
      + '<span style="color:var(--muted)">an agent goes home to its department when it finishes</span>'
      + '</span></div>'
      + '<div class="board">' + (section.columns || []).map(colHtml).join('') + '</div>';

    const body = haltBanner + apex + librarian + queueContext + deptBand + board;
    return { stamp, body };
  },
};
