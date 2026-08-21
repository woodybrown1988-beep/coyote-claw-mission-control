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

// -----------------------------------------------------------------------------------------------
// reviewCoverage — ONE per-platform freshness model, read by every review surface (2026-08-21).
//
// Until today every freshness signal on this board keyed on review_snapshot.fetched_at — the time
// of the FETCH, never on whether any review CONTENT arrived. The nightly ingest exited clean, so
// six surfaces rendered "fresh / LIVE / green" through 22 days in which Google delivered nothing.
// A pipeline that reports on its own execution rather than its own output cannot see itself fail.
//
// The threshold is the platform's OWN history, not a constant: a feed is SILENT when its current
// gap exceeds the longest gap it has ever gone. That way a quiet platform is not accused of being
// broken, a chatty one is caught within days, and nobody has to maintain a number.
//
// Cross-check: Google's lifetime count (review_snapshot.total, the Business Profile GET) against
// the corpus. The board has held both numbers all along and never compared them — the GET said
// 1,386 while the corpus held 232, on the same screen, for three weeks.
function reviewCoverage(q, now) {
  const rows = q(`SELECT platform, COUNT(*) n, MAX(reviewed_date) latest FROM review_corpus GROUP BY platform`).rows || [];
  if (!rows.length) return { present: false, platforms: [], silent: [], google: null };
  const DAY = 86400000;
  const platforms = rows.map((r) => {
    const latestMs = Date.parse(String(r.latest || ''));
    const ageDays = Number.isFinite(latestMs) ? Math.floor((now - latestMs) / DAY) : null;
    // Longest gap this platform has ever gone between consecutive reviews, over the trailing year.
    const dates = (q(
      `SELECT DISTINCT substr(reviewed_date,1,10) d FROM review_corpus WHERE platform = ? AND reviewed_date >= ? ORDER BY d`,
      [r.platform, new Date(now - 365 * DAY).toISOString().slice(0, 10)],
    ).rows || []).map((x) => Date.parse(x.d + 'T00:00:00Z')).filter(Number.isFinite);
    let maxGap = 0;
    for (let i = 1; i < dates.length; i++) maxGap = Math.max(maxGap, Math.round((dates[i] - dates[i - 1]) / DAY));
    return {
      platform: r.platform,
      n: toInt(r.n),
      latest: r.latest ? String(r.latest).slice(0, 10) : null,
      ageDays,
      maxGap,
      // Needs BOTH a history to judge against and a gap that beats it — a platform with two rows
      // has no meaningful maxGap and must not be declared broken on that basis.
      silent: ageDays != null && maxGap > 0 && dates.length >= 5 && ageDays > maxGap,
    };
  });
  // The cross-check the board already had the numbers for.
  const snap = (q(`SELECT total, awaiting_recent_text FROM review_snapshot ORDER BY fetched_at DESC LIMIT 1`).rows || [])[0] || null;
  const g = platforms.find((p) => p.platform === 'google') || null;
  const google = g
    ? { ...g, getTotal: snap ? toInt(snap.total) : null, corpusTotal: g.n,
        missing: snap && toInt(snap.total) > g.n ? toInt(snap.total) - g.n : 0 }
    : null;
  return { present: true, platforms, silent: platforms.filter((p) => p.silent), google };
}

// One sentence naming exactly which feeds are silent and which are current — so no page has to
// hard-code a cause. A wrong cause is worse than none: the board spent two days telling the
// operator to re-auth an OAuth he had already re-consented and to top up an Anthropic account the
// system stopped using on 2026-08-04.
function coverageSentence(cov) {
  if (!cov || !cov.present) return null;
  if (!cov.silent.length) return null;
  const say = (p) => `${p.platform} has delivered no review since ${p.latest} (${p.ageDays} days; its longest gap in the last year was ${p.maxGap})`;
  const ok = cov.platforms.filter((p) => !p.silent && p.latest);
  const tail = ok.length ? ` ${ok.map((p) => `${p.platform} is current to ${p.latest}`).join(', ')}.` : '';
  return `${cov.silent.map(say).join('; ')}.${tail}`;
}

module.exports = { safeSelect, toInt, intOrNull, ratingOrNull, ms, navBadges, footModel, reviewCoverage, coverageSentence };
