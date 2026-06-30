'use strict';

// Shared read-contract — SELECT-only data access for the router + every page. `safeSelect` rejects any
// non-SELECT (the no-board-lies / read-only guarantee for DATA); the only writes in the whole board are
// the narrow POST /api/review-action allowlist in server.js. Pages receive `ctx.q` (bound safeSelect)
// and never open their own handles.

function safeSelect(db, sql, params) {
  const normalized = String(sql).trim().replace(/\s+/g, ' ').toLowerCase();
  if (!(normalized.startsWith('select ') || normalized.startsWith('select\n'))) {
    return { ok: false, rows: [] };
  }
  try {
    const stmt = db.prepare(sql);
    return { ok: true, rows: params && params.length ? stmt.all(...params) : stmt.all() };
  } catch (_) {
    return { ok: false, rows: [] };
  }
}

const toInt = (v) => {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
const intOrNull = (v) => (v === null || v === undefined ? null : toInt(v));
const ratingOrNull = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const ms = (v) => toInt(v);

// Live nav badges. RED = blocked-on-YOU (the action colour): jobs awaiting your sign-off + Reviews
// drafts/escalations needing you. AMBER = warn. CYAN = informational count. Honest counts only.
function navBadges(db) {
  const q = (sql, p) => safeSelect(db, sql, p);
  const blockedOnYou =
    toInt((q(`SELECT COUNT(*) c FROM jobs WHERE status IN ('awaiting_signoff','awaiting_plan_feedback')`).rows[0] || {}).c);
  const reviewQueue =
    toInt((q(`SELECT COUNT(*) c FROM review_drafts WHERE draft_status NOT IN ('responded','skipped','posted')`).rows[0] || {}).c);
  const escalations = toInt((q(`SELECT COUNT(*) c FROM review_actions WHERE escalate = 1`).rows[0] || {}).c);
  return {
    agents: { count: blockedOnYou, tone: 'red' },
    reviews: { count: reviewQueue, tone: 'cyan' },
    issues: { count: escalations, tone: 'amber' },
  };
}

// Sidebar footer: daemons (best-effort, not asserted live here — Health page is the real source),
// spend vs ceiling, ingest freshness. Honest: shows '—' when a value is unavailable.
function footModel(db, now) {
  const q = (sql, p) => safeSelect(db, sql, p);
  const ceilingRow = q(`SELECT value FROM system_state WHERE key='monthly_ceiling_pence' LIMIT 1`).rows[0];
  const ceiling = ceilingRow ? toInt(ceilingRow.value) : 7500;
  const monthStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1);
  const spentRow = q(`SELECT COALESCE(SUM(cost_pence),0) s FROM spend_log WHERE created_at >= ?`, [monthStart]).rows[0];
  const spent = spentRow ? toInt(spentRow.s) : 0;
  const snapRow = q(`SELECT MAX(fetched_at) f FROM review_snapshot`).rows[0];
  const lastIngest = snapRow ? toInt(snapRow.f) : 0;
  const gbp = (p) => `£${(p / 100).toFixed(2)}`;
  const lines = [];
  // daemon count is owned by the Health page; footer shows the spend + ingest grain it can read directly
  lines.push(`spend ${gbp(spent)} / ${gbp(ceiling)}`);
  if (lastIngest > 0) {
    const age = now - lastIngest;
    lines.push(`ingest ${age <= 36 * 3600 * 1000 ? 'fresh' : 'stale'}`);
  } else {
    lines.push('ingest · none yet');
  }
  return lines;
}

module.exports = { safeSelect, toInt, intOrNull, ratingOrNull, ms, navBadges, footModel };
