'use strict';
// Health page — the System view, re-skinned into the ops-centre language. Renders, top to bottom:
//   (e) HALT STATE   — ctx.halt: a red banner when halted, else a calm "running" tile (top status strip)
//   (b) SPEND        — SUM(spend_log.cost_pence) this month vs system_state monthly_ceiling_pence, as a
//                      .tile with a % and a bar (amber >=80%, red >=100%)
//   (a) DAEMONS      — the KNOWN service set as honest "unit" rows. The board CANNOT probe liveness (no
//                      shell), so per-unit liveness is asserted by the systemd layer, NOT faked green here.
//                      Where the Librarian's own data gives a real signal (last actor event / last ingest /
//                      this page serving) we surface THAT derived fact instead of a fabricated up/down.
//   (c) SHIPS        — recent done deploy/pr jobs + job_events kind=pr_opened, a small table
//   (d) INGEST       — review_snapshot latest fetched_at + kpi_snapshot latest ("not wired") via S.freshness
//   (f) JOBS         — COUNT(*) per status, colour-coded tiles
// Contract: { key, route, title, sub, getSection(db,ctx), render(section,ctx) }. SELECT-only via ctx.q;
// render returns { stamp, body }. NO writes, NO network, NO LLM — requires only ../shared.js. Honest
// freshness everywhere; empty/missing data degrades to a graceful state, never a fabricated number.
const S = require('../../shared.js');
const QUEUE_AGE_15M = 15 * 60 * 1000;
const QUEUE_AGE_1H = 60 * 60 * 1000;

function rows(res) {
  return res && res.ok && Array.isArray(res.rows) ? res.rows : [];
}
function one(res) {
  const r = rows(res);
  return r.length ? r[0] : null;
}
function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
function nullableInt(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function readQueueDepth(q, now) {
  const row = one(q(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END), 0) AS queued,
       COALESCE(SUM(CASE WHEN status IN ('preparing','dispatched','running') THEN 1 ELSE 0 END), 0) AS in_flight,
       COALESCE(SUM(CASE WHEN status = 'awaiting_signoff' THEN 1 ELSE 0 END), 0) AS awaiting_signoff,
       MIN(CASE WHEN status = 'queued' AND created_at IS NOT NULL THEN created_at END) AS oldest_queued_at,
       COALESCE(SUM(CASE WHEN status = 'queued' AND created_at IS NOT NULL AND created_at < ? THEN 1 ELSE 0 END), 0) AS queued_over_15m,
       COALESCE(SUM(CASE WHEN status = 'queued' AND created_at IS NOT NULL AND created_at < ? THEN 1 ELSE 0 END), 0) AS queued_over_1h
     FROM jobs`,
    [now - QUEUE_AGE_15M, now - QUEUE_AGE_1H],
  )) || {};
  const oldestQueuedAt = nullableInt(row.oldest_queued_at);
  return {
    queued: toInt(row.queued),
    inFlight: toInt(row.in_flight),
    awaitingSignoff: toInt(row.awaiting_signoff),
    oldestQueuedAt,
    oldestQueuedAgeMs: oldestQueuedAt === null ? null : Math.max(0, now - oldestQueuedAt),
    queuedOver15m: toInt(row.queued_over_15m),
    queuedOver1h: toInt(row.queued_over_1h),
  };
}

// The architectural service set. These are facts about WHAT the fleet is, not claims about whether each is
// up right now — liveness lives in the systemd layer, which the board cannot probe. `signal` says where (if
// anywhere) the Librarian's data gives an honest, unit-specific activity signal we can surface.
const UNITS = [
  { name: 'Librarian', role: 'state spine · sqlite', signal: 'db' },
  { name: 'Boss / Router', role: 'reception · routing', signal: 'actor:router' },
  { name: 'Lead', role: 'planner · gate', signal: 'actor:agent' },
  { name: 'Coder', role: 'builder · worker cage', signal: 'actor:worker' },
  { name: 'Reviews ingest', role: 'daily corpus pull', signal: 'ingest' },
  { name: 'Mission Control', role: 'dashboard · this board', signal: 'self' },
  { name: 'Forwarder', role: 'telegram bridge', signal: 'systemd' },
  { name: 'Front Door', role: 'DM intake', signal: 'systemd' },
];

function getSection(db, ctx) {
  const q = (sql, params) => ctx.q(sql, params);
  const now = (ctx && ctx.now) || Date.now();
  const queueDepth = readQueueDepth(q, now);

  const d = new Date(now);
  const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);

  // (b) spend this month vs ceiling
  const spent = toInt((one(q(
    `SELECT COALESCE(SUM(cost_pence),0) AS s FROM spend_log WHERE created_at >= ?`, [monthStart])) || {}).s);
  const ceilRow = one(q(`SELECT value FROM system_state WHERE key = 'monthly_ceiling_pence' LIMIT 1`));
  const ceiling = ceilRow ? toInt(ceilRow.value) : 0;
  const spendCount = toInt((one(q(
    `SELECT COUNT(*) AS c FROM spend_log WHERE created_at >= ?`, [monthStart])) || {}).c);

  // (a) derived activity signals — honest, board-visible facts only
  const lastEvent = toInt((one(q(`SELECT MAX(created_at) AS m FROM job_events`)) || {}).m);
  const lastEventRow = one(q(
    `SELECT created_at, kind, actor, job_id FROM job_events ORDER BY created_at DESC LIMIT 1`));
  const actorRows = rows(q(`SELECT actor, MAX(created_at) AS m FROM job_events GROUP BY actor`));
  const actorLast = {};
  for (const r of actorRows) {
    const a = String(r.actor || '').toLowerCase();
    if (a) actorLast[a] = toInt(r.m);
  }

  // (d) ingest freshness — review snapshot + (not-yet-wired) KPI feed
  const lastIngest = toInt((one(q(`SELECT MAX(fetched_at) AS f FROM review_snapshot`)) || {}).f);
  const snapCount = toInt((one(q(`SELECT COUNT(*) AS c FROM review_snapshot`)) || {}).c);
  const lastKpi = toInt((one(q(`SELECT MAX(fetched_at) AS f FROM kpi_snapshot`)) || {}).f);
  const kpiCount = toInt((one(q(`SELECT COUNT(*) AS c FROM kpi_snapshot`)) || {}).c);

  // (c) ships / deploys — done deploy|pr jobs, plus pr_opened events
  const shipJobs = rows(q(
    `SELECT id, type, status, updated_at FROM jobs
       WHERE status = 'done' AND (LOWER(type) LIKE '%deploy%' OR LOWER(type) LIKE '%pr%')
       ORDER BY updated_at DESC LIMIT 12`)).map((r) => ({
    when: toInt(r.updated_at),
    label: String(r.type || 'job'),
    ref: String(r.id || ''),
    kind: 'done',
  }));
  const prEvents = rows(q(
    `SELECT job_id, created_at, detail FROM job_events
       WHERE kind = 'pr_opened' ORDER BY created_at DESC LIMIT 12`)).map((r) => ({
    when: toInt(r.created_at),
    label: 'PR opened',
    ref: r.detail ? String(r.detail) : String(r.job_id || ''),
    kind: 'pr',
  }));
  // audit 2026-07-21: refs were raw JSON with the same PR listed 3× — parse to repo#N + link,
  // dedupe by the PR itself (newest kept), never print machine strings on a human surface.
  const parseRef = (s2) => {
    try {
      const j = JSON.parse(s2.ref);
      const url = j.prUrl || j.url || null;
      const num = j.number != null ? Number(j.number) : (url ? Number((String(url).match(/\/pull\/(\d+)/) || [])[1]) : null);
      const repo = url ? String(url).replace(/^https:\/\/github\.com\//, '').split('/pull/')[0].split('/').pop() : null;
      if (num != null && Number.isFinite(num)) return { ...s2, ref: `${repo || 'pr'} #${num}`, url, prKey: `${repo}#${num}` };
    } catch (e) { /* not JSON — leave as-is */ }
    return { ...s2, url: null, prKey: null };
  };
  const seen = new Set();
  const ships = shipJobs.concat(prEvents)
    .map(parseRef)
    .sort((a, b) => b.when - a.when)
    .filter((s) => {
      const key = s.prKey || (s.kind + '|' + s.ref + '|' + s.when);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);

  // (f) jobs breakdown — COUNT per status
  const jobsBreakdown = rows(q(
    `SELECT status, COUNT(*) AS c FROM jobs GROUP BY status`)).map((r) => ({
    status: String(r.status || 'unknown'),
    count: toInt(r.c),
  }));
  const totalJobs = jobsBreakdown.reduce((a, r) => a + r.count, 0);

  return {
    now,
    halt: ctx && ctx.halt ? ctx.halt : { halted: false, source: '' },
    spent, ceiling, spendCount, monthStart,
    lastEvent,
    lastEventKind: lastEventRow ? String(lastEventRow.kind || '') : '',
    lastEventActor: lastEventRow ? String(lastEventRow.actor || '') : '',
    actorLast,
    lastIngest, snapCount, lastKpi, kpiCount,
    ships,
    queueDepth,
    jobsBreakdown, totalJobs,
  };
}

// ---- render helpers ------------------------------------------------------

function freshInner(f) {
  if (f.cls === 'fresh') return `<b>${f.label}</b>`;
  return `<span class="${f.cls}">${f.label}</span>`;
}

function stampHtml(m, now) {
  // overall freshness = the most recent board-visible signal (agent activity or ingest)
  const overall = Math.max(toInt(m.lastEvent), toInt(m.lastIngest));
  const f = S.freshness(overall, now);
  return `system signal · ${freshInner(f)}`;
}

function statusStrip(m, now) {
  const esc = S.escapeHtml;
  const tiles = [];

  // (e) HALT STATE tile
  const halted = !!(m.halt && m.halt.halted);
  const src = m.halt && m.halt.source ? esc(String(m.halt.source)) : 'operator';
  tiles.push(`<div class="tile ${halted ? 'red' : 'green'}">
    <div class="lab">System state</div>
    <div class="val">${halted ? 'HALTED' : 'RUNNING'}</div>
    <div class="sub${halted ? ' r' : ' g'}">${halted ? ('halt · ' + src) : 'claims + poller running'}</div>
  </div>`);

  // (b) SPEND tile with % + bar
  tiles.push(spendTile(m));

  // last agent activity (derived)
  const fe = S.freshness(toInt(m.lastEvent), now);
  const eTone = fe.cls === 'fresh' ? 'green' : (fe.cls === 'stale' ? 'amber' : 'muted');
  const eVal = m.lastEvent ? S.agoLabel(Math.max(0, now - toInt(m.lastEvent))) : '—';
  const eCtx = m.lastEvent
    ? `${esc(m.lastEventActor || 'agent')}${m.lastEventKind ? ' · ' + esc(m.lastEventKind) : ''}`
    : 'no events logged yet';
  tiles.push(`<div class="tile ${eTone}">
    <div class="lab">Last agent activity</div>
    <div class="val">${esc(eVal)}</div>
    <div class="sub${fe.cls === 'stale' ? ' a' : ''}">${eCtx}</div>
  </div>`);

  // last ingest (glance)
  const fi = S.freshness(toInt(m.lastIngest), now);
  const iTone = fi.cls === 'fresh' ? 'green' : (fi.cls === 'stale' ? 'amber' : 'muted');
  const iVal = fi.cls === 'fresh' ? 'LIVE' : (fi.cls === 'stale' ? 'STALE' : '—');
  tiles.push(`<div class="tile ${iTone}">
    <div class="lab">Review ingest</div>
    <div class="val">${iVal}</div>
    <div class="sub${fi.cls === 'stale' ? ' a' : ''}">${fi.label}</div>
  </div>`);

  return `<div class="tiles" data-health="status">${tiles.join('')}</div>`;
}

function spendTile(m) {
  const spent = toInt(m.spent);
  const ceiling = toInt(m.ceiling);
  if (ceiling <= 0) {
    return `<div class="tile muted" data-health="spend">
      <div class="lab">Spend this month</div>
      <div class="val">${S.fmtGbpPence(spent)}</div>
      <div class="sub">no ceiling set</div>
    </div>`;
  }
  const pct = (spent / ceiling) * 100;
  let tone = 'green', subCls = ' g', barColor = 'var(--green)';
  if (pct >= 100) { tone = 'red'; subCls = ' r'; barColor = 'var(--red)'; }
  else if (pct >= 80) { tone = 'amber'; subCls = ' a'; barColor = 'var(--amber)'; }
  const w = Math.max(0, Math.min(100, pct));
  const pctTxt = `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
  return `<div class="tile ${tone}" data-health="spend">
    <div class="lab">Spend this month</div>
    <div class="val">${S.fmtGbpPence(spent)}</div>
    <div class="sub${subCls}">${S.escapeHtml(pctTxt)} of ${S.fmtGbpPence(ceiling)} ceiling</div>
    <div class="rate-bar" style="margin-top:2px"><i style="width:${w}%;background:${barColor}"></i></div>
  </div>`;
}

function queueAgeLabel(ageMs) {
  if (ageMs === null || ageMs === undefined || !Number.isFinite(Number(ageMs))) return '—';
  const minutes = Math.floor(Math.max(0, Number(ageMs)) / 60000);
  if (minutes < 60) return minutes + 'm';
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return hours + 'h';
  return Math.floor(hours / 24) + 'd';
}

function queueStrip(m) {
  const q = m.queueDepth || {
    queued: 0,
    inFlight: 0,
    awaitingSignoff: 0,
    oldestQueuedAgeMs: null,
    queuedOver15m: 0,
    queuedOver1h: 0,
  };
  const queued = toInt(q.queued);
  const inFlight = toInt(q.inFlight);
  const awaitingSignoff = toInt(q.awaitingSignoff);
  const over15m = toInt(q.queuedOver15m);
  const over1h = toInt(q.queuedOver1h);
  const ageKnown = q.oldestQueuedAgeMs !== null && q.oldestQueuedAgeMs !== undefined;
  const ageTone = over1h > 0 ? 'red' : (over15m > 0 ? 'amber' : (ageKnown ? 'green' : 'muted'));
  const ageState = over1h > 0 ? 'over-1h' : (over15m > 0 ? 'over-15m' : (ageKnown ? 'under-15m' : 'unknown'));
  const emptyAge = queued > 0 ? 'oldest timestamp unknown' : 'queue empty';

  return `<div class="tiles" data-health="queue-depth" style="grid-template-columns:repeat(4,minmax(150px,1fr))">
    <div class="tile ${queued > 0 ? 'blue' : 'muted'}">
      <div class="lab">Queued</div><div class="val" data-queue-bucket="queued">${S.fmtInt(queued)}</div>
      <div class="sub">fleet-only · unattributed</div>
    </div>
    <div class="tile ${inFlight > 0 ? 'green' : 'muted'}">
      <div class="lab">In-flight</div><div class="val" data-queue-bucket="in-flight">${S.fmtInt(inFlight)}</div>
      <div class="sub">preparing · dispatched · running</div>
    </div>
    <div class="tile ${awaitingSignoff > 0 ? 'red' : 'muted'}">
      <div class="lab">Awaiting signoff</div><div class="val" data-queue-bucket="awaiting-signoff">${S.fmtInt(awaitingSignoff)}</div>
      <div class="sub">waiting on the operator</div>
    </div>
    <div class="tile ${ageTone}" data-oldest-queued="${ageState}">
      <div class="lab">Oldest queued age</div><div class="val">${ageKnown ? queueAgeLabel(q.oldestQueuedAgeMs) : '—'}</div>
      <div class="sub">${ageKnown
        ? `<span class="${over15m > 0 ? 'a' : ''}">${S.fmtInt(over15m)} &gt;15m</span> · <span class="${over1h > 0 ? 'r' : ''}">${S.fmtInt(over1h)} &gt;1h</span>`
        : emptyAge}</div>
    </div>
  </div>`;
}

function unitSignal(u, m, now) {
  // Returns { dot, line } — an HONEST status. We never assert "live" we can't see; we surface the real
  // board-visible signal where one exists, otherwise we say liveness is the systemd layer's to assert.
  const esc = S.escapeHtml;
  if (u.signal === 'self') {
    return { dot: 'green', line: 'serving this page now' };
  }
  if (u.signal === 'ingest') {
    const f = S.freshness(toInt(m.lastIngest), now);
    if (f.cls === 'none') return { dot: 'idle', line: 'no ingest recorded yet' };
    return { dot: f.cls === 'fresh' ? 'green' : 'amber', line: 'last ingest · ' + f.label }; // f.label holds a <time> tag (numeric ts only) — render RAW
  }
  if (u.signal && u.signal.indexOf('actor:') === 0) {
    const actor = u.signal.slice('actor:'.length);
    const ts = toInt(m.actorLast && m.actorLast[actor]);
    if (!ts) return { dot: 'idle', line: 'unit · liveness via systemd' };
    const f = S.freshness(ts, now);
    return { dot: f.cls === 'fresh' ? 'green' : 'amber', line: 'last ' + esc(actor) + ' event · ' + f.label }; // actor is hardcoded UNITS; f.label holds a <time> tag — render RAW
  }
  if (u.signal === 'db') {
    // The DB answered our SELECTs (this page rendered from it), so it is reachable — an honest fact.
    return { dot: 'green', line: 'answering reads' };
  }
  return { dot: 'idle', line: 'unit · liveness via systemd' };
}

function daemonsPanel(m, now) {
  const esc = S.escapeHtml;
  const body = UNITS.map((u) => {
    const sig = unitSignal(u, m, now);
    return `<tr>
      <td><span class="sdot ${sig.dot}"></span> <b style="color:var(--text)">${esc(u.name)}</b></td>
      <td class="mono">${esc(u.role)}</td>
      <td class="mono">${sig.line}</td>
    </tr>`;
  }).join('');
  return `<div class="panel">
    <div class="panel-head"><h2>Daemons &amp; services</h2><span class="meta">${UNITS.length} units</span></div>
    <div class="panel-body" style="padding-top:4px">
      <table>
        <thead><tr><th>Unit</th><th>Role</th><th>Board-visible signal</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
      <div class="banner muted" style="margin:12px 0 0">The board cannot run a process probe — per-unit
        liveness is asserted by the <span class="mono">systemd</span> layer, not checked here. A green dot
        means the Librarian's own data shows real recent activity for that unit; an idle dot means no
        board-visible signal, not necessarily down.</div>
    </div>
  </div>`;
}

function shipsPanel(m) {
  const esc = S.escapeHtml;
  let inner;
  if (!m.ships || !m.ships.length) {
    inner = `<tr><td colspan="3" class="empty-row">No deploys or PRs recorded yet — ships appear here as the Coder merges and the deploy tap fires.</td></tr>`;
  } else {
    inner = m.ships.map((s) => {
      const when = s.when ? S.fmtTime(s.when) : '<span class="empty-row" style="padding:0">—</span>';
      const tag = s.kind === 'pr'
        ? '<span class="chip cyan" style="cursor:default">PR</span>'
        : '<span class="chip muted" style="cursor:default">deploy</span>';
      return `<tr>
        <td class="mono">${when}</td>
        <td>${tag} ${esc(s.label)}</td>
        <td class="mono">${s.url ? `<a href="${esc(s.url)}" style="color:var(--cyan,#22D3EE)">${esc(s.ref)}</a>` : esc(s.ref || '—')}</td>
      </tr>`;
    }).join('');
  }
  return `<div class="panel">
    <div class="panel-head"><h2>Ships &amp; deploys</h2><span class="meta">recent · done + pr_opened</span></div>
    <div class="panel-body" style="padding-top:4px">
      <table>
        <thead><tr><th>When</th><th>What</th><th>Ref</th></tr></thead>
        <tbody>${inner}</tbody>
      </table>
    </div>
  </div>`;
}

function ingestTiles(m, now) {
  const esc = S.escapeHtml;
  const tiles = [];

  const fi = S.freshness(toInt(m.lastIngest), now);
  const iTone = fi.cls === 'fresh' ? 'green' : (fi.cls === 'stale' ? 'amber' : 'muted');
  tiles.push(`<div class="tile ${iTone}">
    <div class="lab">Review snapshot</div>
    <div class="val">${m.snapCount ? S.fmtInt(m.snapCount) : '—'}</div>
    <div class="sub${fi.cls === 'stale' ? ' a' : ''}">${m.snapCount ? fi.label : 'not yet ingested'}</div>
  </div>`);

  // KPI feed — EMPTY until coyote-intel wired; never fake a number
  if (m.kpiCount > 0) {
    const fk = S.freshness(toInt(m.lastKpi), now);
    const kTone = fk.cls === 'fresh' ? 'green' : (fk.cls === 'stale' ? 'amber' : 'muted');
    tiles.push(`<div class="tile ${kTone}">
      <div class="lab">KPI feed</div>
      <div class="val">${S.fmtInt(m.kpiCount)}</div>
      <div class="sub${fk.cls === 'stale' ? ' a' : ''}">${esc(fk.label)}</div>
    </div>`);
  } else {
    tiles.push(`<div class="tile muted">
      <div class="lab">KPI feed</div>
      <div class="val">—</div>
      <div class="sub">not yet wired · coyote-intel</div>
    </div>`);
  }

  return `<div class="tiles" data-health="ingest">${tiles.join('')}</div>`;
}

function statusTone(status) {
  switch (status) {
    case 'running': return 'green';
    case 'queued':
    case 'preparing':
    case 'dispatched': return 'blue';
    case 'awaiting_signoff':
    case 'awaiting_plan_feedback':
    case 'failed': return 'red';
    case 'escalated': return 'amber';
    case 'done': return 'muted';
    default: return 'muted';
  }
}
function statusLabel(status) {
  return String(status).replace(/_/g, ' ');
}

function jobsTiles(m) {
  const esc = S.escapeHtml;
  if (!m.jobsBreakdown || !m.jobsBreakdown.length) {
    return `<div class="banner muted" data-health="jobs">No jobs in the Librarian yet — status counts appear here once work has been enqueued.</div>`;
  }
  // stable, meaningful order; unknown statuses fall to the end
  const order = ['queued', 'preparing', 'dispatched', 'running', 'awaiting_signoff',
    'awaiting_plan_feedback', 'escalated', 'failed', 'done'];
  const sorted = m.jobsBreakdown.slice().sort((a, b) => {
    const ia = order.indexOf(a.status); const ib = order.indexOf(b.status);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const tiles = sorted.map((r) => {
    const tone = statusTone(r.status);
    const blocked = r.status === 'awaiting_signoff' || r.status === 'awaiting_plan_feedback';
    const sub = r.status === 'awaiting_signoff'
      ? '<span class="r">waiting on the operator</span>'
      : (blocked ? '<span class="r">awaiting your tap</span>' : (r.status === 'failed' ? '<span class="r">needs attention</span>' : '&nbsp;'));
    return `<div class="tile ${tone}">
      <div class="lab">${esc(statusLabel(r.status))}</div>
      <div class="val">${S.fmtInt(r.count)}</div>
      <div class="sub">${sub}</div>
    </div>`;
  }).join('');
  return `<div class="tiles" data-health="jobs">${tiles}</div>`;
}

function render(section, ctx) {
  const m = section || {};
  const now = m.now || (ctx && ctx.now) || Date.now();
  const stamp = stampHtml(m, now);

  const parts = [];

  // (e) loud halt banner first, when halted
  if (m.halt && m.halt.halted) {
    parts.push(`<div class="banner red"><b>⛔ SYSTEM HALTED</b> · ${S.escapeHtml(String(m.halt.source || 'operator'))}.
      Claims and the poller are frozen; no agent will pick up new work until the brake is released with an explicit re-arm.</div>`);
  }

  parts.push(`<div class="sec-label">System status<span class="rule"></span></div>`);
  parts.push(statusStrip(m, now));

  parts.push(`<div class="sec-label">Fleet queue<span class="rule"></span></div>`);
  parts.push(queueStrip(m));

  parts.push(`<div class="sec-label">Daemons &amp; services<span class="rule"></span></div>`);
  parts.push(daemonsPanel(m, now));

  parts.push(`<div class="sec-label">Ships &amp; deploys<span class="rule"></span></div>`);
  parts.push(shipsPanel(m));

  parts.push(`<div class="sec-label">Ingest freshness<span class="rule"></span></div>`);
  parts.push(ingestTiles(m, now));

  parts.push(`<div class="sec-label">Jobs by status<span class="rule"></span>${m.totalJobs ? `<span class="mono" style="text-transform:none;letter-spacing:0">${S.fmtInt(m.totalJobs)} total</span>` : ''}</div>`);
  parts.push(jobsTiles(m));

  return { stamp, body: parts.join('\n') };
}

module.exports = {
  key: 'health',
  route: '/claw/health', workspace: 'claw',
  title: 'Health',
  sub: 'System · daemons, ships, spend, ingest freshness',
  getSection,
  render,
};
