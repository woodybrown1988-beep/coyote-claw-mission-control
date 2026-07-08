'use strict';
// Agents page — THE centrepiece. Renders REAL agent states from the Librarian (jobs + job_events +
// review_drafts) into the locked ops-centre board: leadership apex (Boss + Chief of Staff) → Librarian
// band (live counts) → flow-divider legend → 5-column kanban (Idle/Queued/Working/Blocked/Done).
// Contract: { key, route, title, sub, getSection(db,ctx), render(section,ctx) }.
// SELECT-only via ctx.q; render returns { stamp, body }. No writes, no network, only ../shared.js.
const S = require('../../shared.js');

// --- jobs read-contract helpers -------------------------------------------------------------------
const ACTIVE6 = ['queued', 'preparing', 'dispatched', 'running', 'awaiting_signoff', 'awaiting_plan_feedback'];
const RECENT_MS = 36 * 60 * 60 * 1000; // a job counts as "recently done" within ~1.5× the daily cadence

// Known fleet. Research + Accountant are scoped-but-unbuilt → ALWAYS faded idle, never an active state.
const AGENTS = {
  lead: { key: 'lead', av: 'av-lead', initials: 'LE', name: 'Lead', role: 'planner · gate' },
  coder: { key: 'coder', av: 'av-coder', initials: 'CO', name: 'Coder', role: 'builder · cage' },
  reviews: { key: 'reviews', av: 'av-rev', initials: 'RV', name: 'Reviews', role: 'drafting · ingest' },
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function rows(res) {
  return res && res.ok && Array.isArray(res.rows) ? res.rows : [];
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

// job.type → fleet agent. Literal substring containment per the contract (lead/plan, coder/build/pr,
// review/ingest/draft). Anything else → null (rendered as an honest generic worker card by real type).
function agentForType(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('lead') || t.includes('plan')) return 'lead';
  if (t.includes('coder') || t.includes('build') || t.includes('pr')) return 'coder';
  if (t.includes('review') || t.includes('ingest') || t.includes('draft')) return 'reviews';
  return null;
}

// One job → its kanban bucket. activeChildParents = parent ids that have an active child (a parent
// still in-flight while a child runs in another dept = blocked-on-dept, the only honest amber signal).
function classify(job, activeChildParents) {
  const s = job.status;
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
    for (const f of ['title', 'summary', 'brief', 'description', 'headline', 'subject', 'task', 'name']) {
      if (typeof p[f] === 'string' && p[f].trim()) return trunc(p[f].trim(), 90);
    }
    const prn = p.pr_number != null ? p.pr_number : p.pr != null ? p.pr : p.pr_id;
    if (prn != null && Number.isFinite(Number(prn))) return 'PR #' + Number(prn);
    if (typeof p.repo === 'string' && p.repo.trim()) return trunc(p.repo.trim(), 90);
  }
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

// =================================================================================================
module.exports = {
  key: 'agents',
  route: '/claw/agents', workspace: 'claw',
  title: 'Agents',
  sub: 'The team · who is working, who is stuck, who needs you',

  getSection(db, ctx) {
    const q = ctx.q;
    const now = ctx.now;

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

    // parents that have an active (in-flight) child → that parent is waiting on the child's dept
    const activeChildParents = new Set();
    const childOf = new Map(); // parentId → first active child job
    for (const j of allJobs) {
      if (j.parent_job_id != null && ACTIVE6.indexOf(j.status) !== -1) {
        activeChildParents.add(j.parent_job_id);
        if (!childOf.has(j.parent_job_id)) childOf.set(j.parent_job_id, j);
      }
    }

    // group by agent
    const byAgent = { lead: [], coder: [], reviews: [] };
    const generics = [];
    for (const j of allJobs) {
      const a = agentForType(j.type);
      if (a && byAgent[a]) byAgent[a].push(j);
      else generics.push(j);
    }
    const order = ['blocked_you', 'blocked_dept', 'working', 'queued'];
    function pickRep(jobs) {
      const sorted = jobs.slice().sort((x, y) => num(y.updated_at) - num(x.updated_at));
      const found = {};
      let terminal = null;
      for (const j of sorted) {
        const b = classify(j, activeChildParents);
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

    // --- Coder roster: ONE card PER live worker (named), not a single collapsed "Coder" -------------
    // Sources (SELECT-only): worker_heartbeat (fresh non-lead rows = who's alive + their STABLE name,
    // idle-aware because the beat fires even when idle) + coder jobs grouped by owner_id (each worker's
    // own work — the worker mints ONE owner_id for both its beat and its claims). A worker is keyed by
    // WORKER_NAME (stable across restarts) else owner_id; label = name ?? host:pid (never blank, never
    // fabricated). Stale heartbeats (>120s) are dropped. In-flight jobs whose owner has no fresh beat are
    // STILL shown (work is never hidden). With no heartbeat table at all it degrades to one card per
    // job-owner — never losing a job (the honest in-between before workers restart with their names).
    const HEARTBEAT_FRESH_MS = 120000; // 4× the 30s beat; matches server.js getWorkerSection
    function shortOwner(id) {
      return String(id || '').replace(/:\d{10,}$/, ''); // host:pid (drop the per-restart epoch-ms tail)
    }
    function coderSlots(coderJobs) {
      const hb = rows(q(
        `SELECT owner_id, worker_name, last_beat_at FROM worker_heartbeat WHERE owner_id NOT LIKE 'lead:%' ORDER BY last_beat_at DESC`,
      ));
      const nameByOwner = new Map(); // owner_id → stable name (even a momentarily-stale beat still names its owner)
      for (const r of hb) {
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
      const slots = new Map(); // key → { label, fresh, jobs }
      const slotFor = (key, label) => {
        if (!slots.has(key)) slots.set(key, { label, fresh: false, jobs: [] });
        return slots.get(key);
      };
      // 1) fresh non-lead workers = the idle-aware roster (stale dropped), deduped by name||owner
      for (const r of hb) {
        if (now - num(r.last_beat_at) > HEARTBEAT_FRESH_MS) continue;
        const wn = r.worker_name && String(r.worker_name).trim();
        slotFor(wn || r.owner_id, wn || shortOwner(r.owner_id)).fresh = true;
      }
      // 2) attribute each worker's CURRENT state to its slot: IN-FLIGHT jobs (ACTIVE6), a RECENT terminal,
      // or a genuine GIVE-UP (unmarked escalated). Deliberate cancels + stale terminal are NOT worker state
      // (skipped). A give-up attaches ONLY to an EXISTING live slot — it never spawns a card — so a dead
      // worker's old escalation stays off the board (no live card), while a non-roster owner still gets a
      // card for genuinely in-flight work (a hung worker holding a gate — never hidden).
      for (const j of coderJobs) {
        const inflight = ACTIVE6.indexOf(j.status) !== -1;
        const recentTerminal = (j.status === 'done' || j.status === 'failed') && now - num(j.updated_at) <= RECENT_MS;
        const giveUp = j.status === 'escalated' && !cancelledIds.has(j.id); // unmarked escalated = genuine give-up
        if (!inflight && !recentTerminal && !giveUp) continue; // skip deliberate cancels + stale terminal
        const owner = j.owner_id || null;
        const wn = owner ? nameByOwner.get(owner) : null;
        const key = wn || owner || ' unassigned';
        if (slots.has(key)) slots.get(key).jobs.push(j); // a live worker's job — incl. its genuine give-up
        else if (inflight) slotFor(key, wn || (owner ? shortOwner(owner) : AGENTS.coder.name)).jobs.push(j); // no-hide: live in-flight work by a non-roster owner
        // else: a give-up/terminal by a dead owner with no live slot → no card (the historical stay off)
      }
      // 3) a rep per slot; a fresh worker with no live job → idle "standing by"; drop empty non-roster slots
      const out = [];
      for (const s of slots.values()) {
        if (!s.jobs.length && !s.fresh) continue;
        out.push({ label: s.label, rep: pickRep(s.jobs) }); // pickRep([]) → idle "standing by"
      }
      if (!out.length) out.push({ label: AGENTS.coder.name, rep: pickRep([]) }); // never hide the role entirely
      return out.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
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
      const ca = agentForType(child.type);
      if (ca && AGENTS[ca]) return AGENTS[ca].name;
      return String(child.type || 'another');
    }

    function agentCard(meta, rep) {
      const job = rep.job;
      const c = { kind: 'agent', av: meta.av, initials: meta.initials, name: meta.name, role: meta.role };
      const summary = job ? describeJob(job) || String(job.type) : null;
      if (rep.bucket === 'blocked_you') {
        const cp = youCopy(meta.key, job.status);
        c.col = 'blocked';
        c.variant = 'you';
        c.task = { strong: summary, tail: ' — ' + cp.verb + '.' };
        c.waitPill = { tone: 'you', text: cp.pill };
        c.button = { label: cp.btn };
        c.time = 'held ' + S.agoLabel(now - num(job.updated_at));
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
        c.task = { strong: summary, tail: '.' };
        c.time = 'running ' + fmtDur(now - num(job.updated_at));
        c._trackJob = job.id;
        c._trackMode = 'working';
        trackJobIds.add(job.id);
      } else if (rep.bucket === 'queued') {
        c.col = 'queued';
        c.variant = 'q';
        c.task = { strong: summary, tail: ' queued.' };
        c.time = 'waiting ' + S.agoLabel(now - num(job.created_at));
      } else if (rep.bucket === 'done') {
        c.col = 'done';
        c.variant = 'd';
        c.task = { strong: summary, tail: ' — done.' };
        c.time = '✓ ' + S.agoLabel(now - num(job.updated_at));
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
      return c;
    }

    // Lead by job state (one Lead). Coder: ONE card PER live worker, named (Coder-1 / Coder-2), each
    // showing its own job state — replaces the single collapsed "Coder" so two workers are both visible.
    cards.push(agentCard(AGENTS.lead, pickRep(byAgent.lead)));
    for (const slot of coderSlots(byAgent.coder)) {
      cards.push(agentCard({ ...AGENTS.coder, name: slot.label }, slot.rep));
    }

    // Reviews: a job-gate outranks the draft queue; otherwise the pending operator queue surfaces it as
    // blocked-on-you (summarised from review_drafts — the mockup's signature Reviews card).
    const revRep = pickRep(byAgent.reviews);
    if (revRep.bucket === 'blocked_you') {
      cards.push(agentCard(AGENTS.reviews, revRep));
    } else if (pendingDrafts > 0) {
      const parts = [];
      if (toApprove > 0) parts.push(toApprove + ' to approve');
      if (toPost > 0) parts.push(toPost + ' to copy & post');
      cards.push({
        kind: 'reviewsQueue',
        col: 'blocked',
        variant: 'you',
        av: AGENTS.reviews.av,
        initials: AGENTS.reviews.initials,
        name: 'Reviews',
        role: 'drafting',
        task: { strong: pendingDrafts + (pendingDrafts === 1 ? ' reply' : ' replies'), tail: ' drafted, in voice' + (guardFlagged > 0 ? ' · ' + guardFlagged + ' guard-flagged' : '') + '.' },
        waitPill: { tone: 'you', text: parts.join(' · ') },
        button: { label: 'Go to queue', href: '/reviews' },
      });
    } else {
      const rc = agentCard(AGENTS.reviews, revRep);
      if (revRep.bucket === 'idle') rc.task = { muted: true, tail: 'Queue clear — no drafts pending.' };
      cards.push(rc);
    }

    // Generic unmapped jobs → honest cards by their real type. Non-terminal always; cap recent terminal.
    let genTerminal = 0;
    for (const j of generics.slice().sort((x, y) => num(y.updated_at) - num(x.updated_at))) {
      const b = classify(j, activeChildParents);
      const typeLabel = String(j.type || 'job');
      const base = { kind: 'generic', av: 'av-research', initials: 'JB', name: trunc(typeLabel, 16), role: 'worker · ' + (j.owner_id ? trunc(String(j.owner_id), 14) : 'unassigned') };
      if (b === 'blocked_you') {
        const cp = youCopy(null, j.status);
        cards.push(Object.assign(base, { col: 'blocked', variant: 'you', task: { strong: typeLabel, tail: ' — ' + cp.verb + '.' }, waitPill: { tone: 'you', text: cp.pill }, button: { label: cp.btn }, time: 'held ' + S.agoLabel(now - num(j.updated_at)), _trackJob: j.id, _trackMode: 'gate' }));
        trackJobIds.add(j.id);
      } else if (b === 'blocked_dept') {
        cards.push(Object.assign(base, { col: 'blocked', variant: 'dept', task: { strong: typeLabel, tail: ' — awaiting another desk.' }, waitPill: { tone: 'dept', text: 'Waiting on ' + deptNameFor(j) + ' Dept' }, time: 'blocked ' + S.agoLabel(now - num(j.updated_at)) }));
      } else if (b === 'working') {
        cards.push(Object.assign(base, { col: 'working', variant: 'w', task: { strong: typeLabel, tail: ' running.' }, time: 'running ' + fmtDur(now - num(j.updated_at)), _trackJob: j.id, _trackMode: 'working' }));
        trackJobIds.add(j.id);
      } else if (b === 'queued') {
        cards.push(Object.assign(base, { col: 'queued', variant: 'q', task: { strong: typeLabel, tail: ' queued.' }, time: 'waiting ' + S.agoLabel(now - num(j.created_at)) }));
      } else if ((b === 'done' || b === 'failed') && now - num(j.updated_at) <= RECENT_MS && genTerminal < 4) {
        genTerminal++;
        if (b === 'failed') {
          cards.push(Object.assign(base, { col: 'done', variant: '', inlineStyle: 'border-left:2.5px solid var(--amber)', task: { strong: typeLabel, tail: ' — failed.' }, time: '✕ failed · ' + S.agoLabel(now - num(j.updated_at)) }));
        } else {
          cards.push(Object.assign(base, { col: 'done', variant: 'd', task: { strong: typeLabel, tail: ' — done.' }, time: '✓ ' + S.agoLabel(now - num(j.updated_at)) }));
        }
      }
    }

    // Unbuilt fleet → always faded idle, never active.
    cards.push({ kind: 'agent', col: 'idle', variant: 'i', faded: true, av: 'av-research', initials: 'RE', name: 'Research', role: 'precedent', task: { muted: true, tail: 'Standing by for stubborn-issue hand-offs. Not yet wired.' }, time: 'scoped · Gap C' });
    cards.push({ kind: 'agent', col: 'idle', variant: 'i', faded: true, dim: true, av: 'av-acct', initials: 'AC', name: 'Accountant', role: 'books · tax', task: { muted: true, tail: 'Planned specialist. Not built.' }, time: 'future' });

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
    const COLS = [
      { id: 'idle', cls: 'idle', label: 'Idle' },
      { id: 'queued', cls: 'queued', label: 'Queued' },
      { id: 'working', cls: 'working', label: 'Working' },
      { id: 'blocked', cls: 'blocked', label: 'Blocked' },
      { id: 'done', cls: 'done', label: 'Done' },
    ];
    const columns = COLS.map((col) => ({ ...col, cards: cards.filter((c) => c.col === col.id) }));

    return {
      halt: ctx.halt || { halted: false },
      lib: { active: libActive, total: libTotal, events: libEvents },
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
    function footHtml(c) {
      let btn = '';
      if (c.button) {
        btn = c.button.href
          ? '<a class="acard-btn" href="' + esc(c.button.href) + '">' + esc(c.button.label) + '</a>'
          : '<button class="acard-btn" type="button">' + esc(c.button.label) + '</button>';
      }
      const time = c.time ? '<span class="acard-time">' + esc(c.time) + '</span>' : '';
      if (!btn && !time) return '';
      return '<div class="acard-foot">' + btn + time + '</div>';
    }
    function cardHtml(c) {
      const cls = 'acard' + (c.variant ? ' ' + c.variant : '') + (c.faded ? ' faded' : '');
      const style = c.inlineStyle ? ' style="' + esc(c.inlineStyle) + '"' : '';
      const nameStyle = c.dim ? ' style="color:rgba(170,195,225,.4)"' : '';
      const pill = c.waitPill ? '<div class="wait-pill ' + c.waitPill.tone + '"><span class="ar">▸</span>' + esc(c.waitPill.text) + '</div>' : '';
      return (
        '<div class="' + cls + '"' + style + '>' +
        '<div class="acard-top"><div class="acard-av ' + c.av + '">' + esc(c.initials) + '</div>' +
        '<div><div class="acard-name"' + nameStyle + '>' + esc(c.name) + '</div><div class="acard-role">' + esc(c.role) + '</div></div></div>' +
        '<div class="acard-task">' + taskHtml(c.task) + '</div>' +
        pill +
        trackHtml(c.track) +
        footHtml(c) +
        '</div>'
      );
    }
    function colHtml(col) {
      const body = col.cards.length ? col.cards.map(cardHtml).join('') : '';
      return (
        '<div class="col ' + col.cls + '">' +
        '<div class="col-head"><span class="col-name"><i></i>' + esc(col.label) + '</span>' +
        '<span class="col-count">' + col.cards.length + '</span></div>' +
        body +
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
      '<div class="lead-top"><span class="lead-name">Boss</span><span class="lead-role">router · reception</span><span class="mstat idle"><span class="sd"></span>Listening</span></div>' +
      '<div class="lead-desc">Classifies every incoming message and routes it. <span class="muted">A switchboard, not a manager — it directs, it doesn\'t reason.</span></div>' +
      '</div></div>' +
      '<div class="lead-card cos">' +
      '<div class="lead-av cos">CS</div>' +
      '<div class="lead-body">' +
      '<div class="lead-top"><span class="lead-name">Chief of Staff</span><span class="lead-role">advisor · briefings</span><span class="mstat ready"><span class="sd"></span>Ready</span></div>' +
      '<div class="lead-desc">Reads the Librarian, synthesises status, talks through next steps. <span class="muted">The one you actually talk to.</span></div>' +
      '<button class="cos-btn" type="button">▸ What\'s been done today?</button>' +
      '</div></div>' +
      '</div>';

    const librarian =
      '<div class="librarian">' +
      '<div class="lib-av">LB</div>' +
      '<div class="lib-text">' +
      '<div class="lib-name">The Librarian <span class="lib-tag">state spine · source of truth</span></div>' +
      '<div class="lib-desc">Every job state, result, and gate decision. No model — pure memory. Everyone reads and writes here; the board renders from it.</div>' +
      '</div>' +
      '<div class="lib-stats">' +
      '<div class="lib-stat"><div class="v">' + esc(S.fmtInt(lib.active)) + '</div><div class="l">active jobs</div></div>' +
      '<div class="lib-stat"><div class="v">' + esc(S.fmtInt(lib.total)) + '</div><div class="l">total run</div></div>' +
      '<div class="lib-stat"><div class="v">' + esc(S.fmtInt(lib.events)) + '</div><div class="l">events</div></div>' +
      '</div></div>';

    const divider =
      '<div class="flow-divider">' +
      '<span class="t">The fleet</span><span class="rule"></span>' +
      '<span class="legend">' +
      '<span><i style="background:#566"></i>idle</span><span><i style="background:#60A5FA"></i>queued</span>' +
      '<span><i style="background:#34D399"></i>working</span><span><i style="background:#F87171"></i>blocked</span>' +
      '<span><i style="background:rgba(52,211,153,.45)"></i>done</span>' +
      '</span></div>';

    const board = '<div class="board">' + (section.columns || []).map(colHtml).join('') + '</div>';

    const body = haltBanner + apex + librarian + divider + board;
    return { stamp, body };
  },
};
