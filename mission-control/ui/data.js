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
  // TWO MASKING LAYERS THIS MODEL ORIGINALLY HAD (2026-08-21, found by adversarial review).
  //
  // (a) A PLATFORM CAN HAVE TWO LEGS, AND ONE CAN DIE BEHIND THE OTHER. OpenTable arrives by two
  //     independent paths: the upstream app's feed ('api-v1') and a Gmail parser ('email'). The
  //     api-v1 leg stopped on 2026-07-28 — 23 days against its own longest gap of 13 — and the
  //     platform still read "current to 2026-08-16" because the email leg kept delivering. Grouping
  //     at PLATFORM grain made a dead source invisible behind a live sibling.
  //
  // (b) A ROW IS NOT NECESSARILY A REVIEW YOU CAN READ. Rating-only rows carry no text, so a
  //     platform can deliver steadily and supply nothing the extractor can classify. OpenTable's
  //     last row WITH TEXT is weeks older than its last row.
  //
  // THE CLASS: freshness must be measured at the grain that can independently fail, and on the
  // payload the consumer actually needs. Anything coarser lets a live sibling or an empty payload
  // stand in for a source that has stopped.
  const legRows = q(
    `SELECT platform, source_ingest AS src, COUNT(*) n, MAX(reviewed_date) latest
       FROM review_corpus GROUP BY platform, source_ingest`,
  ).rows || [];
  const gapFor = (where, params) => {
    const dates = (q(
      `SELECT DISTINCT substr(reviewed_date,1,10) d FROM review_corpus WHERE ${where} AND reviewed_date >= ? ORDER BY d`,
      params.concat([new Date(now - 365 * DAY).toISOString().slice(0, 10)]),
    ).rows || []).map((x) => Date.parse(x.d + 'T00:00:00Z')).filter(Number.isFinite);
    let g = 0;
    for (let i = 1; i < dates.length; i++) g = Math.max(g, Math.round((dates[i] - dates[i - 1]) / DAY));
    return { maxGap: g, n: dates.length };
  };
  const legs = legRows.map((r) => {
    const latestMs = Date.parse(String(r.latest || ''));
    const ageDays = Number.isFinite(latestMs) ? Math.floor((now - latestMs) / DAY) : null;
    const { maxGap, n } = gapFor('platform = ? AND source_ingest = ?', [r.platform, r.src]);
    return {
      platform: r.platform, source: r.src, n: toInt(r.n),
      latest: r.latest ? String(r.latest).slice(0, 10) : null, ageDays, maxGap,
      silent: ageDays != null && maxGap > 0 && n >= 5 && ageDays > maxGap,
    };
  });
  // Text-bearing freshness per platform: the payload the issue extractor actually consumes.
  const textRows = q(
    `SELECT platform, MAX(reviewed_date) latest FROM review_corpus
      WHERE text IS NOT NULL AND TRIM(text) <> '' GROUP BY platform`,
  ).rows || [];
  for (const p of platforms) {
    const t = textRows.find((x) => x.platform === p.platform);
    const tMs = t ? Date.parse(String(t.latest || '')) : NaN;
    p.latestWithText = t && t.latest ? String(t.latest).slice(0, 10) : null;
    p.textAgeDays = Number.isFinite(tMs) ? Math.floor((now - tMs) / DAY) : null;
    p.legs = legs.filter((l) => l.platform === p.platform);
    p.silentLegs = p.legs.filter((l) => l.silent && p.legs.length > 1);
  }
  const silentLegs = legs.filter((l) => l.silent);

  // The cross-check the board already had the numbers for.
  const snap = (q(`SELECT total, awaiting_recent_text FROM review_snapshot ORDER BY fetched_at DESC LIMIT 1`).rows || [])[0] || null;
  const g = platforms.find((p) => p.platform === 'google') || null;
  // NAMED HONESTLY (corrected 2026-08-21). `review_snapshot.total` is the number of review objects
  // OUR ingest paginated, not Google's own `totalReviewCount` — that field exists on the API
  // response and is never read anywhere in the codebase. Calling it "Google's profile reports N"
  // was a board lie of exactly the kind this file exists to prevent: a number labelled with an
  // authority it does not have.
  //
  // AND IT NOW COMPARES IN BOTH DIRECTIONS. The original only asked "does the platform have more
  // than we hold?" — so when the corpus held MORE than the fetch returned (1,432 rows against 1,386
  // reviews, because a retired writer's duplicates were still in place) the check returned 0 and
  // the banner stayed silent. Right outcome, wrong reason, and no branch existed for the direction
  // that was actually true. A discrepancy check with only one sign is half a check.
  // WITHDRAWN ROWS ARE HISTORY, NOT SURPLUS. A review the platform has since removed is still a
  // real review we once received; it is kept deliberately (its content is not re-derivable) and
  // flagged with withdrawn_at. Counting it as an unreconciled duplicate would make this banner
  // nag for ever about rows that are exactly where they should be — which is how a warning stops
  // being read. The column is absent on older DBs, so the query falls back rather than erroring.
  const wRow = (q(`SELECT COUNT(*) n FROM review_corpus WHERE platform = 'google' AND withdrawn_at IS NOT NULL`).rows || [])[0];
  const withdrawn = wRow ? toInt(wRow.n) : 0;
  const fetched = snap ? toInt(snap.total) : null;
  const google = g
    ? {
        ...g,
        fetchedTotal: fetched,          // reviews OUR ingest paginated from Google
        getTotal: fetched,              // retained name for existing callers
        corpusTotal: g.n,               // rows we hold for this platform
        withdrawn,
        // Compared on the rows that CLAIM to be current — withdrawn ones are excluded from both
        // directions, so they neither hide a real shortfall nor invent a surplus.
        currentTotal: g.n - withdrawn,
        missing: fetched != null && fetched > g.n - withdrawn ? fetched - (g.n - withdrawn) : 0,
        surplus: fetched != null && g.n - withdrawn > fetched ? g.n - withdrawn - fetched : 0,
      }
    : null;
  return { present: true, platforms, silent: platforms.filter((p) => p.silent), silentLegs, legs, google };
}

// One sentence naming exactly which feeds are silent and which are current — so no page has to
// hard-code a cause. A wrong cause is worse than none: the board spent two days telling the
// operator to re-auth an OAuth he had already re-consented and to top up an Anthropic account the
// system stopped using on 2026-08-04.
function coverageSentence(cov) {
  if (!cov || !cov.present) return null;
  const say = (p) => `${p.platform} has delivered no review since ${p.latest} (${p.ageDays} days; its longest gap in the last year was ${p.maxGap})`;
  if (cov.silent.length) {
    const ok = cov.platforms.filter((p) => !p.silent && p.latest);
    const tail = ok.length ? ` ${ok.map((p) => `${p.platform} is current to ${p.latest}`).join(', ')}.` : '';
    return `${cov.silent.map(say).join('; ')}.${tail}`;
  }
  // NO PLATFORM IS SILENT, BUT A LEG MAY BE. Reported separately and in different words, because
  // the operator action is different: the platform is still delivering, so nothing is missing from
  // the board today — but one of the two ways it arrives has stopped, and when the surviving leg
  // goes too there will be no warning left to give.
  // A RETIRED LEG IS NOT A DEAD LEG. google's 'api-v1' source stopped on purpose when the ingest
  // took over the fetch itself — reporting that as an outage every day is exactly the noise that
  // teaches an operator to stop reading these warnings. The distinguishing fact is in the data: a
  // sibling with MORE rows has taken the platform over (gmb-direct 1,386 vs api-v1 13), whereas
  // OpenTable's surviving 'email' leg is a small side-channel (34) next to the api-v1 leg that
  // stopped (251) and cannot be standing in for it.
  //
  // So: a silent leg is reported only when nothing bigger replaced it. Handover, silence.
  const deadLegs = (cov.silentLegs || []).filter((l) => {
    const p = cov.platforms.find((x) => x.platform === l.platform);
    if (!p || p.silent || !p.legs || p.legs.length <= 1) return false;
    const supersededBy = p.legs.some((o) => o.source !== l.source && !o.silent && o.n > l.n);
    return !supersededBy;
  });
  if (deadLegs.length) {
    return deadLegs
      .map((l) => {
        const p = cov.platforms.find((x) => x.platform === l.platform);
        const alive = p.legs.filter((o) => o.source !== l.source && !o.silent).map((o) => `${o.source} (latest ${o.latest})`).join(', ');
        return `${l.platform} still looks current because its ${alive || 'other'} source is delivering, but its ${l.source} source has produced nothing since ${l.latest} — ${l.ageDays} days, against a longest-ever gap of ${l.maxGap}`;
      })
      .join('; ') + '.';
  }
  return null;
}

// -----------------------------------------------------------------------------------------------
// reviewInputWindows — did the PLATFORM change, or did our PIPELINE break? (2026-08-21)
//
// The collapse guard on the issues page correctly refuses to read falling complaint counts as
// improvement when the text-bearing input has halved. But it then told the operator "these counts
// describe a feed, not the kitchen" — asserting a CAUSE it had no way to see. On 2026-08-21 that
// was wrong: OpenTable's written reviews fell 23 -> 5, and checking its two delivery legs
// separately showed BOTH had dropped (hub 12 -> 3, Gmail 11 -> 2). Two independent sources falling
// together is not a delivery fault; it is guests writing less while still leaving ratings.
//
// THE CLASS — and it is the one this file keeps re-learning: a guard may state WHAT it observed
// without stating WHY, and the why is only knowable when something in the data can distinguish the
// candidates. Here something can: a platform that arrives by more than one INDEPENDENT route
// carries its own control group. If every route fell, the change is upstream of all of them. If one
// fell while its sibling held, the fault is in that route. If there is only one route, the two
// explanations are indistinguishable and the honest verdict is UNKNOWN — which this returns rather
// than guessing, because a confident wrong cause is worse than an admitted absent one.
const INPUT_WINDOW_DAYS = 30;
const LEG_DROP_RATIO = 0.5;      // a leg counts as dropped below half its prior window
const LEG_MIN_PRIOR = 3;         // below this it has no baseline worth judging against

function reviewInputWindows(q, now) {
  const dayIso = (msBack) => new Date(now - msBack).toISOString().slice(0, 10);
  const curFrom = dayIso(INPUT_WINDOW_DAYS * 86400000);
  const priorFrom = dayIso(2 * INPUT_WINDOW_DAYS * 86400000);
  // Text-bearing only: a review with no words cannot produce an issue tag, so it is not input.
  // ROUTES COME FROM THE DELIVERY LEDGER, NOT FROM THE ROW. review_corpus.source_ingest can only
  // hold ONE value, so the moment two routes converged on a single row (as OpenTable's did, to stop
  // them storing 34 reviews twice) it would have reported a single route — and a platform with one
  // observable route can never be diagnosed, only guessed at. review_deliveries records that route
  // X delivered review Y, so one row can be credited to both without existing twice.
  const deliveryRows = q(
    `SELECT c.platform, d.source AS src,
       SUM(CASE WHEN c.reviewed_date >= ? AND c.text IS NOT NULL AND TRIM(c.text) <> '' THEN 1 ELSE 0 END) cur,
       SUM(CASE WHEN c.reviewed_date >= ? AND c.reviewed_date < ? AND c.text IS NOT NULL AND TRIM(c.text) <> '' THEN 1 ELSE 0 END) prior
     FROM review_deliveries d JOIN review_corpus c ON c.review_id = d.review_id
     GROUP BY c.platform, d.source`,
    [curFrom, priorFrom, curFrom],
  );
  // FALLBACK, not a silent one: a database predating the ledger still gets a per-route answer from
  // the row's own provenance, which is exactly right for every review only one route ever touched.
  const legRows = (deliveryRows.ok && (deliveryRows.rows || []).length)
    ? deliveryRows.rows
    : (q(
        `SELECT platform, source_ingest AS src,
           SUM(CASE WHEN reviewed_date >= ? AND text IS NOT NULL AND TRIM(text) <> '' THEN 1 ELSE 0 END) cur,
           SUM(CASE WHEN reviewed_date >= ? AND reviewed_date < ? AND text IS NOT NULL AND TRIM(text) <> '' THEN 1 ELSE 0 END) prior
         FROM review_corpus GROUP BY platform, source_ingest`,
        [curFrom, priorFrom, curFrom],
      ).rows || []);
  if (!legRows.length) return { present: false, platforms: [], cur: 0, prior: 0, collapsed: [] };

  const byPlatform = new Map();
  for (const r of legRows) {
    const p = String(r.platform);
    const entry = byPlatform.get(p) || { platform: p, cur: 0, prior: 0, legs: [] };
    const cur = toInt(r.cur) || 0;
    const prior = toInt(r.prior) || 0;
    entry.cur += cur;
    entry.prior += prior;
    entry.legs.push({ source: String(r.src || 'unknown'), cur, prior, dropped: prior >= LEG_MIN_PRIOR && cur < prior * LEG_DROP_RATIO });
    byPlatform.set(p, entry);
  }
  const totalPrior = [...byPlatform.values()].reduce((a, p) => a + p.prior, 0);
  const totalCur = [...byPlatform.values()].reduce((a, p) => a + p.cur, 0);

  const platforms = [...byPlatform.values()].map((p) => {
    // Only legs with a real baseline can vote. A leg that delivered almost nothing last window
    // cannot tell you whether anything changed.
    const judged = p.legs.filter((l) => l.prior >= LEG_MIN_PRIOR);
    const dropped = judged.filter((l) => l.dropped);
    const steady = judged.filter((l) => !l.dropped);
    // A platform collapsed when it had enough history to judge AND supplied a material share of the
    // total, so a marginal platform cannot gate the page and a real contributor always does.
    const collapsed = p.prior >= 5 && totalPrior > 0 && p.prior / totalPrior >= 0.2 && p.cur < p.prior * LEG_DROP_RATIO;
    // A ROUTE DYING IS NEWS WHETHER OR NOT THE PLATFORM TOTAL COLLAPSED. Judging only collapsed
    // platforms reproduces, one level down, the exact masking this check was built to end: with two
    // routes of 12 and 11, one can fail COMPLETELY and the total still falls only 48% — under the
    // collapse threshold, so nothing is said, while half the delivery is gone. A sibling holding
    // steady is what makes that diagnosable, and it is the case most worth reporting because it is
    // the only one the operator can actually fix.
    let verdict = null;
    if (dropped.length > 0 && judged.length >= 2 && steady.length > 0) {
      verdict = 'pipeline';                                // one route fell, a sibling held
    } else if (collapsed) {
      if (judged.length < 2) verdict = 'unknown';          // one route: the two causes look identical
      else if (dropped.length === judged.length) verdict = 'platform';   // every route fell together
      else verdict = 'unknown';                            // the total fell but no single route did
    }
    return { ...p, judged, dropped, steady, collapsed, verdict };
  });
  return {
    present: true, platforms, cur: totalCur, prior: totalPrior,
    // What GATES the trend tiles: the input for a material platform genuinely collapsed.
    collapsed: platforms.filter((p) => p.collapsed),
    // What is worth SAYING: that, plus any route failure a sibling makes diagnosable even where
    // the platform total held up.
    reportable: platforms.filter((p) => p.collapsed || p.verdict === 'pipeline'),
  };
}

/**
 * One sentence per collapsed platform, saying what fell and — only where the data can support it —
 * whether the cause is upstream of us or inside our own delivery.
 */
function inputDropSentence(win) {
  if (!win || !win.present || !(win.reportable || win.collapsed || []).length) return null;
  const leg = (l) => `${l.source} ${l.cur} of ${l.prior}`;
  return (win.reportable || win.collapsed)
    .map((p) => {
      const head = `${p.platform} written reviews fell ${p.prior} → ${p.cur}`;
      if (p.verdict === 'platform') {
        // NARROWED (2026-08-21). This used to end "so guests are writing less while still leaving
        // ratings" — a claim about GUEST BEHAVIOUR that the routes cannot support. Comparing routes
        // separates "upstream of our pipeline" from "inside our pipeline"; it cannot separate
        // "guests wrote fewer words" from "the platform stopped sending us the words", because
        // both produce identical evidence: ratings arriving, text not.
        //
        // Which is the same overreach this whole check was built to end, one notch quieter. It
        // states what the routes prove and stops there.
        return `${head}, and EVERY source fell with it (${p.dropped.map(leg).join(', ')}) — independent routes do not break together, so the change is upstream of us rather than in our pipeline: the ratings still arrive, the words do not. Nothing in our delivery to fix.`;
      }
      if (p.verdict === 'pipeline') {
        // Worth naming even when the platform total held: a route is gone and it can be restored.
        return `${head}, but only ${p.dropped.map((l) => l.source).join(', ')} fell (${p.dropped.map(leg).join(', ')}) while ${p.steady.map(leg).join(', ')} held — that is a delivery fault in our pipeline, not a change in what guests are writing. Restore it.`;
      }
      return `${head}. It arrives by a single route, so a delivery fault and a genuine drop in written reviews cannot be told apart from here — cause unknown.`;
    })
    .join(' ');
}

module.exports = { safeSelect, toInt, intOrNull, ratingOrNull, ms, navBadges, footModel, reviewCoverage, coverageSentence, reviewInputWindows, inputDropSentence };
