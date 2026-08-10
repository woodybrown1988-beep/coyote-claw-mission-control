'use strict';
// Reporting v2 compute — PURE functions (no DB, no clock, no requires, no network). The Reports
// surface computes every value AT READ TIME from librarian.db per the canonical-source ruling;
// this module holds the projection maths + chart-string builders so they are testable against
// hand-computed expectations.
//
// SOURCE RULING (operator tap, Reporting v2 Stage 2; SUPERSEDED IN PART 2026-08-10, duplication
// wave): monthly net VALUES come from the canonical day-net view v_sales_day_all — the engine's
// revenue-of-record — never re-summed from receipt headers (the two bases disagreed 36/37
// months). Month-complete STILL = every calendar day has an 'ok' API ledger row
// (sales_api_ingest_runs — closed days get rows too, proven live). Months without complete
// coverage render as GAPS, never estimates. Premises guard: months before the first full
// current-premises month (move 2023-04-01) are never used as actuals or prior-year bases.
//
// FORECAST (operator ruling): headline = seasonality-aware — per-month YoY ratio over the trailing
// ≤6 complete month-pairs, recency-weighted ×3 newest / ×2 second-newest / ×1 otherwise, applied to
// each remaining month's prior-year actual. Sanity line = simple YTD-YoY ratio applied the same
// way. Band = the window's min–max ratio spread (the honest spread, no fabricated confidence).

const MONTHS_ABBR = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Calendar days in 'YYYY-MM'. */
function calDays(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 'YYYY-MM' + n months. */
function ymAdd(ym, n) {
  const [y, m] = String(ym).split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${String(Math.floor(t / 12)).padStart(4, '0')}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** Same month, prior year. */
function ymPriorYear(ym) { return `${Number(ym.slice(0, 4)) - 1}${ym.slice(4)}`; }

/** The 12 'YYYY-MM' of a year. */
function ymsOfYear(year) {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
}

/** Continuous inclusive month range 'from'..'to' — the REAL time axis (gaps stay visible). */
function monthRange(from, to) {
  const out = [];
  for (let ym = from; ym <= to && out.length < 600; ym = ymAdd(ym, 1)) out.push(ym);
  return out;
}

/** First month usable under the premises guard: the boundary month itself when the move is on the
 *  1st, else the following month (a mid-month move month is mixed-premises → unusable). */
function firstPremisesYm(boundaryDate) {
  const d = String(boundaryDate || '2023-04-01');
  const ym = d.slice(0, 7);
  return d.slice(8, 10) === '01' ? ym : ymAdd(ym, 1);
}

/**
 * Fold the monthly revenue-of-record + ingest ledger into a per-month record.
 *   apiMonths:    [{ ym, net, txn }]   (Σ net_sales_pence / Σ transactions from v_sales_day_all —
 *                                       the day-net canon, ruling 2026-08-10)
 *   ledgerMonths: [{ ym, days }]       (COUNT(DISTINCT business_date) of 'ok' ledger rows)
 *   nowYm:        the wall-clock month — that month is MTD, never 'complete'
 * Returns { ym → { netPence, txn, okDays, calDays, complete, mtd } }.
 */
function buildMonths({ apiMonths, ledgerMonths, nowYm }) {
  const out = {};
  const led = new Map((ledgerMonths || []).map((r) => [String(r.ym), Number(r.days) || 0]));
  for (const r of apiMonths || []) {
    const ym = String(r.ym);
    out[ym] = { netPence: Number(r.net) || 0, txn: Number(r.txn) || 0, okDays: led.get(ym) || 0, calDays: calDays(ym), complete: false, mtd: ym === nowYm };
  }
  for (const [ym, days] of led) {
    if (!out[ym]) out[ym] = { netPence: 0, txn: 0, okDays: days, calDays: calDays(ym), complete: false, mtd: ym === nowYm };
  }
  for (const ym of Object.keys(out)) {
    const m = out[ym];
    m.complete = ym < nowYm && m.okDays >= m.calDays;
  }
  return out;
}

/**
 * The projection for `year`, both methods, gap-honest. See the module header for the rulings.
 * Returns:
 *   { actuals: [{ym, kind:'actual'|'mtd'|'gap', netPence|null, reason|null}],   // the year's 12 months
 *     window: [{ym, ratio, weight}], ratio, ratioMin, ratioMax,                 // method ii inputs
 *     ytdRatio, ytdMonths,                                                      // method i inputs
 *     forecast: [{ym, seasonalPence|null, simplePence|null, lowPence|null, highPence|null, reason|null}],
 *     fullYear:  { seasonalPence|null, simplePence|null, lowPence|null, highPence|null, missing: [ym] },
 *     mtdPence|null }
 */
function computeProjection({ months, year, nowYm, boundaryDate, windowN = 6 }) {
  const guardYm = firstPremisesYm(boundaryDate);
  const usable = (ym) => ym >= guardYm && months[ym] && months[ym].complete && months[ym].netPence > 0;

  // The year's month statuses (past months only; nowYm and later are forecast territory).
  const actuals = ymsOfYear(year).map((ym) => {
    if (ym >= nowYm) return { ym, kind: ym === nowYm ? 'mtd' : 'gap', netPence: months[ym] ? months[ym].netPence : null, reason: null };
    if (ym < guardYm) return { ym, kind: 'gap', netPence: null, reason: 'previous premises — excluded' };
    const m = months[ym];
    if (m && m.complete) return { ym, kind: 'actual', netPence: m.netPence, reason: null };
    if (m && m.okDays > 0) return { ym, kind: 'gap', netPence: null, reason: `partial API coverage (${m.okDays}/${m.calDays} days)` };
    return { ym, kind: 'gap', netPence: null, reason: 'no API record' };
  });

  // Ratio pairs: complete months of `year` before nowYm whose prior-year month is also usable.
  const pairs = [];
  for (const ym of ymsOfYear(year)) {
    if (ym >= nowYm) break;
    const ly = ymPriorYear(ym);
    if (usable(ym) && usable(ly)) pairs.push({ ym, ratio: months[ym].netPence / months[ly].netPence });
  }
  const window = pairs.slice(-windowN).map((p, i, arr) => ({ ...p, weight: i === arr.length - 1 ? 3 : i === arr.length - 2 ? 2 : 1 }));
  const wSum = window.reduce((s, p) => s + p.weight, 0);
  const ratio = window.length >= 3 ? window.reduce((s, p) => s + p.ratio * p.weight, 0) / wSum : null;
  const ratioMin = window.length ? Math.min(...window.map((p) => p.ratio)) : null;
  const ratioMax = window.length ? Math.max(...window.map((p) => p.ratio)) : null;

  // Method i: simple YTD-YoY over ALL complete pairs (not just the window).
  const ytdCur = pairs.reduce((s, p) => s + months[p.ym].netPence, 0);
  const ytdLy = pairs.reduce((s, p) => s + months[ymPriorYear(p.ym)].netPence, 0);
  const ytdRatio = pairs.length >= 1 && ytdLy > 0 ? ytdCur / ytdLy : null;

  // Remaining months (nowYm..Dec when nowYm falls in `year`; every non-actual month otherwise).
  const forecast = ymsOfYear(year).filter((ym) => ym >= nowYm).map((ym) => {
    const ly = ymPriorYear(ym);
    if (!usable(ly)) {
      const reason = ly < guardYm ? 'prior year pre-move' : (months[ly] && months[ly].okDays > 0 ? `prior-year month has partial API coverage` : 'no prior-year API record');
      return { ym, seasonalPence: null, simplePence: null, lowPence: null, highPence: null, reason };
    }
    const base = months[ly].netPence;
    return {
      ym,
      seasonalPence: ratio != null ? base * ratio : null,
      simplePence: ytdRatio != null ? base * ytdRatio : null,
      lowPence: ratioMin != null ? base * ratioMin : null,
      highPence: ratioMax != null ? base * ratioMax : null,
      reason: ratio == null ? `projection window too thin (${window.length} usable month-pairs, need 3)` : null,
    };
  });

  // Full-year figures: every month must be an actual or a computable forecast — else null + missing.
  // Tracked PER METHOD: when the seasonality window is too thin the simple method may still cover
  // the year (the promote-simple state); a coverage-gap month blocks both.
  const missing = [];
  const missingSimple = [];
  let seasonal = 0, simple = 0, low = 0, high = 0;
  for (const a of actuals) {
    if (a.kind === 'actual') { seasonal += a.netPence; simple += a.netPence; low += a.netPence; high += a.netPence; continue; }
    const f = forecast.find((x) => x.ym === a.ym);
    if (f && f.seasonalPence != null) { seasonal += f.seasonalPence; low += f.lowPence; high += f.highPence; } else missing.push(a.ym);
    if (f && f.simplePence != null) simple += f.simplePence; else missingSimple.push(a.ym);
  }
  const ok = missing.length === 0 && ratio != null;
  const okSimple = missingSimple.length === 0 && ytdRatio != null;
  return {
    actuals, window, ratio, ratioMin, ratioMax, ytdRatio, ytdMonths: pairs.length,
    forecast,
    fullYear: {
      seasonalPence: ok ? seasonal : null,
      simplePence: okSimple ? simple : null,
      lowPence: ok ? low : null,
      highPence: ok ? high : null,
      missing,
      missingSimple,
    },
    mtdPence: months[nowYm] && months[nowYm].okDays > 0 ? months[nowYm].netPence : null,
  };
}

// ---------- chart builders (pure string → inline SVG; the design system's IBCS-style notation:
// actual solid, forecast dashed same hue, band = the ratio spread, prior years light grey) ----------

function niceCeil(v) {
  if (!(v > 0)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (v <= m * mag) return m * mag;
  return 10 * mag;
}

/**
 * Monthly multi-series line chart (x = Jan..Dec). series: [{ label, color, dash?, width?, dots?,
 * points: [{ i:0..11, v: pence|null }] }] — null breaks the path (a GAP, drawn as absence).
 * band: { color, points: [{ i, low, high }] } drawn behind. Returns an <svg> string.
 */
function svgMonthlyLines({ width = 960, height = 280, series = [], band = null, yFmt = (v) => String(v) }) {
  const padL = 64, padR = 16, padT = 14, padB = 26;
  const iw = width - padL - padR, ih = height - padT - padB;
  let vMax = 0;
  for (const s of series) for (const p of s.points) if (p.v != null && p.v > vMax) vMax = p.v;
  if (band) for (const p of band.points) if (p.high != null && p.high > vMax) vMax = p.high;
  vMax = niceCeil(vMax);
  const X = (i) => padL + (iw * i) / 11;
  const Y = (v) => padT + ih - (ih * v) / vMax;
  const px = (n) => Math.round(n * 10) / 10;
  const parts = [];
  // grid + y labels (4 ticks) + x labels
  for (let t = 0; t <= 4; t++) {
    const v = (vMax * t) / 4;
    parts.push(`<line x1="${padL}" y1="${px(Y(v))}" x2="${width - padR}" y2="${px(Y(v))}" stroke="rgba(125,165,205,.12)" stroke-width="1"/>`);
    parts.push(`<text x="${padL - 8}" y="${px(Y(v) + 3.5)}" text-anchor="end" font-size="10" fill="rgba(170,195,225,.5)" font-family="IBM Plex Mono,monospace">${yFmt(v)}</text>`);
  }
  for (let i = 0; i < 12; i++) {
    parts.push(`<text x="${px(X(i))}" y="${height - 8}" text-anchor="middle" font-size="10" fill="rgba(170,195,225,.5)" font-family="IBM Plex Mono,monospace">${MONTHS_ABBR[i + 1]}</text>`);
  }
  // band behind everything else
  if (band) {
    for (const run of contiguousRuns(band.points, (p) => p.low != null && p.high != null)) {
      const up = run.map((p) => `${px(X(p.i))},${px(Y(p.high))}`);
      const down = run.slice().reverse().map((p) => `${px(X(p.i))},${px(Y(p.low))}`);
      parts.push(`<polygon points="${up.concat(down).join(' ')}" fill="${band.color}" stroke="none"/>`);
    }
  }
  for (const s of series) {
    for (const run of contiguousRuns(s.points, (p) => p.v != null)) {
      const d = run.map((p, j) => `${j === 0 ? 'M' : 'L'}${px(X(p.i))},${px(Y(p.v))}`).join(' ');
      if (run.length === 1) {
        parts.push(`<circle cx="${px(X(run[0].i))}" cy="${px(Y(run[0].v))}" r="3" fill="${s.color}"/>`);
      } else {
        parts.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''} stroke-linejoin="round" stroke-linecap="round"/>`);
      }
      if (s.dots) for (const p of run) parts.push(`<circle cx="${px(X(p.i))}" cy="${px(Y(p.v))}" r="3.2" fill="${s.color}"/>`);
    }
  }
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" preserveAspectRatio="xMidYMid meet">${parts.join('')}</svg>`;
}

function contiguousRuns(points, ok) {
  const runs = [];
  let cur = [];
  for (const p of points) {
    if (ok(p)) { cur.push(p); continue; }
    if (cur.length) runs.push(cur);
    cur = [];
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/** Small-multiple sparkline (ATV trends). points: [{v|null}] in order; rule = horizontal reference.
 *  SPARSE RULE: fewer than 2 real points returns '' — a lone dot on an empty grid is noise; the
 *  caller renders a labelled value instead. */
function svgSparkline({ width = 150, height = 40, points = [], color = '#22D3EE', rulePence = null, ruleColor = 'rgba(251,191,36,.7)' }) {
  const vals = points.filter((p) => p.v != null).map((p) => p.v);
  if (vals.length < 2) return '';
  let vMax = Math.max(...vals, rulePence || 0), vMin = Math.min(...vals, rulePence || vals[0]);
  if (vMax === vMin) { vMax += 1; vMin -= 1; }
  const pad = 4;
  const X = (i) => pad + ((width - 2 * pad) * i) / Math.max(1, points.length - 1);
  const Y = (v) => pad + (height - 2 * pad) * (1 - (v - vMin) / (vMax - vMin));
  const px = (n) => Math.round(n * 10) / 10;
  const parts = [];
  if (rulePence != null) parts.push(`<line x1="${pad}" y1="${px(Y(rulePence))}" x2="${width - pad}" y2="${px(Y(rulePence))}" stroke="${ruleColor}" stroke-width="1" stroke-dasharray="3 3"/>`);
  const idx = points.map((p, i) => ({ i, v: p.v }));
  for (const run of contiguousRuns(idx, (p) => p.v != null)) {
    const d = run.map((p, j) => `${j === 0 ? 'M' : 'L'}${px(X(p.i))},${px(Y(p.v))}`).join(' ');
    if (run.length === 1) parts.push(`<circle cx="${px(X(run[0].i))}" cy="${px(Y(run[0].v))}" r="2" fill="${color}"/>`);
    else parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`);
  }
  const last = idx.filter((p) => p.v != null).pop();
  if (last) parts.push(`<circle cx="${px(X(last.i))}" cy="${px(Y(last.v))}" r="2.4" fill="${color}"/>`);
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">${parts.join('')}</svg>`;
}

module.exports = {
  MONTHS_ABBR, calDays, ymAdd, ymPriorYear, ymsOfYear, monthRange, firstPremisesYm,
  buildMonths, computeProjection, svgMonthlyLines, svgSparkline, contiguousRuns, niceCeil,
};
