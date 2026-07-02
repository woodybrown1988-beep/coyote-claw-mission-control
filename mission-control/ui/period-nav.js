'use strict';
// Shared period navigation for Reports + Labour. Resolves ?period=&start=&end= into ONE
// honest window per request (server-rendered links → bookmarkable/shareable URLs).
// Semantics (operator-locked): day = calendar day; week = CALENDAR Mon–Sun; month =
// calendar month; year = calendar year; custom = inclusive from/to with a same-length
// PRECEDING comparator. Partial current periods are LABELLED ("week to date") — never
// presented as a full period. Navigation is clamped forward at today (the future has no
// record by definition); backwards it is unclamped — pre-history periods render the
// honest "no record — history starts <date>" message instead of being unreachable.
// All inputs are validated; a malformed query falls back to the default view.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERIODS = ['day', 'week', 'month', 'year', 'custom'];
const MAX_CUSTOM_DAYS = 400; // guard the server; a year+ range is a deliberate cap

function addDays(d, n) { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
function mondayOf(d) { const t = new Date(d + 'T12:00:00Z'); const s = (t.getUTCDay() + 6) % 7; return addDays(d, -s); }
function monthStart(d) { return d.slice(0, 8) + '01'; }
function monthEnd(d) { const t = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)); return t.toISOString().slice(0, 10); }
function yearStart(d) { return d.slice(0, 4) + '-01-01'; }
function yearEnd(d) { return d.slice(0, 4) + '-12-31'; }
function daysBetween(a, b) { return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000); }
function clampDate(d, max) { return d > max ? max : d; }

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function fmtD(d) { return `${WD[new Date(d + 'T12:00:00Z').getUTCDay()]} ${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7))]} ${d.slice(0, 4)}`; }
function fmtShort(d) { return `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7))]}`; }

/** London calendar date of an epoch-ms instant. */
function londonDateOf(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

/**
 * @param query   plain object from the URL (?period=&start=&end=)
 * @param maxDate latest SETTLED business date (the default anchor)
 * @param nowMs   for "today" (partial labelling + forward clamp)
 * @param route   page route for link building ('/labour' | '/reports')
 */
function resolveNav(query, maxDate, nowMs, route) {
  const today = londonDateOf(nowMs);
  const qp = query && typeof query === 'object' ? query : {};
  let period = PERIODS.includes(qp.period) ? qp.period : (qp.period != null ? null : 'day');
  if (period == null) period = 'day'; // unknown value → default, never an error page
  const startQ = DATE_RE.test(String(qp.start || '')) ? String(qp.start) : null;
  const endQ = DATE_RE.test(String(qp.end || '')) ? String(qp.end) : null;

  let from; let to; let label; let partial = false; let comparator = null;
  const anchor = startQ != null ? clampDate(startQ, today) : maxDate;

  if (period === 'custom') {
    // custom needs both dates, ordered, bounded — else fall back to the default day view.
    if (startQ == null || endQ == null || endQ < startQ || daysBetween(startQ, endQ) + 1 > MAX_CUSTOM_DAYS) {
      period = 'day'; from = maxDate; to = maxDate; label = fmtD(maxDate);
    } else {
      from = startQ; to = clampDate(endQ, today);
      const len = daysBetween(from, to) + 1;
      label = `${fmtShort(from)} – ${fmtShort(to)} ${to.slice(0, 4)} (custom, ${len} day${len === 1 ? '' : 's'})`;
      // Comparator: the same-length PRECEDING window — a lookup, never a projection.
      comparator = { from: addDays(from, -len), to: addDays(from, -1), label: `preceding ${len} day${len === 1 ? '' : 's'} (${fmtShort(addDays(from, -len))} – ${fmtShort(addDays(from, -1))})` };
    }
  }
  if (period === 'day') {
    from = to = startQ != null ? clampDate(startQ, today) : maxDate;
    label = fmtD(from);
  } else if (period === 'week') {
    from = mondayOf(anchor);
    const end = addDays(from, 6);
    to = clampDate(end, today);
    partial = end > maxDate;
    label = `Mon ${fmtShort(from)} – Sun ${fmtShort(end)}${partial ? ' (week to date)' : ''}`;
  } else if (period === 'month') {
    from = monthStart(anchor);
    const end = monthEnd(anchor);
    to = clampDate(end, today);
    partial = end > maxDate;
    label = `${MONTHS[Number(from.slice(5, 7))]} ${from.slice(0, 4)}${partial ? ' (month to date)' : ''}`;
  } else if (period === 'year') {
    from = yearStart(anchor);
    const end = yearEnd(anchor);
    to = clampDate(end, today);
    partial = end > maxDate;
    label = `${from.slice(0, 4)}${partial ? ' (year to date)' : ''}`;
  }

  const href = (p, s, e) => `${route}?period=${p}${s ? `&start=${s}` : ''}${e ? `&end=${e}` : ''}`;
  let prev = null; let next = null;
  if (period === 'day') {
    prev = href('day', addDays(from, -1));
    if (from < today) next = href('day', addDays(from, 1));
  } else if (period === 'week') {
    prev = href('week', addDays(from, -7));
    if (addDays(from, 7) <= today) next = href('week', addDays(from, 7));
  } else if (period === 'month') {
    prev = href('month', addDays(monthStart(anchor), -1).slice(0, 8) + '01');
    const nm = addDays(monthEnd(anchor), 1);
    if (nm <= today) next = href('month', nm);
  } else if (period === 'year') {
    prev = href('year', `${Number(from.slice(0, 4)) - 1}-01-01`);
    const ny = `${Number(from.slice(0, 4)) + 1}-01-01`;
    if (ny <= today) next = href('year', ny);
  } else if (period === 'custom' && comparator != null) {
    const len = daysBetween(from, to) + 1;
    prev = href('custom', comparator.from, comparator.to);
    if (addDays(to, len) <= today || addDays(to, 1) <= today) next = href('custom', addDays(to, 1), clampDate(addDays(to, len), today));
  }

  return { period, from, to, label, partial, comparator, prev, next, today, links: { day: href('day', period === 'day' ? from : to), week: href('week'), month: href('month'), year: href('year') } };
}

/** The nav strip: D/W/M/Y links + arrows + the custom range form (GET → URL state free). */
function renderNavStrip(nav, route, escapeHtml) {
  const esc = escapeHtml;
  const seg = ['day', 'week', 'month', 'year'].map((p) =>
    `<a class="pn-seg${nav.period === p ? ' active' : ''}" href="${esc(nav.links[p])}">${p[0].toUpperCase() + p.slice(1)}</a>`).join('');
  return `<div class="pn-bar">
    <a class="pn-arrow" href="${esc(nav.prev || '#')}"${nav.prev ? '' : ' aria-disabled="true" style="opacity:.3;pointer-events:none"'}>‹</a>
    <span class="pn-label">${esc(nav.label)}</span>
    <a class="pn-arrow" href="${esc(nav.next || '#')}"${nav.next ? '' : ' aria-disabled="true" style="opacity:.3;pointer-events:none"'} title="${nav.next ? '' : 'the future has no record'}">›</a>
    <span class="pn-segwrap">${seg}</span>
    <form class="pn-custom" method="GET" action="${esc(route)}">
      <input type="hidden" name="period" value="custom"/>
      <input type="date" name="start" value="${esc(nav.period === 'custom' ? nav.from : '')}" required/>
      <span class="ash">→</span>
      <input type="date" name="end" value="${esc(nav.period === 'custom' ? nav.to : '')}" required/>
      <button type="submit">Go</button>
    </form>
  </div>`;
}

const NAV_CSS = `
  .pn-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:2px 0 14px}
  .pn-arrow{font-size:18px;font-weight:700;text-decoration:none;color:var(--text-2,#9aa);padding:2px 10px;border-radius:7px;background:rgba(255,255,255,.05)}
  .pn-label{font-weight:600;min-width:200px}
  .pn-seg{font-size:13px;font-weight:600;color:var(--text-2,#9aa);text-decoration:none;padding:6px 13px;border-radius:7px}
  .pn-seg.active{background:var(--cyan-dim,rgba(34,211,238,.15));color:#CFF6FB}
  .pn-segwrap{display:inline-flex;gap:2px;background:rgba(255,255,255,.05);border-radius:9px;padding:3px}
  .pn-custom{display:inline-flex;gap:6px;align-items:center;margin-left:auto}
  .pn-custom input[type=date]{font:inherit;font-size:12px;background:rgba(255,255,255,.06);color:inherit;border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:4px 6px}
  .pn-custom button{font:inherit;font-size:12px;font-weight:600;background:var(--cyan-dim,rgba(34,211,238,.15));color:#CFF6FB;border:0;border-radius:6px;padding:5px 12px;cursor:pointer}
`;

module.exports = { resolveNav, renderNavStrip, NAV_CSS, addDays, mondayOf, monthStart, monthEnd, londonDateOf };
