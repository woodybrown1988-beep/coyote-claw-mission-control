'use strict';
// CUSTOMER GROWTH CENTRE (Reports section) — build-ahead scaffold (operator ruling 2026-07-22:
// "build it"), after the Stage-1 four-way probe (docs/customer-growth-centre/gap-map.md). The
// binding finding: this is the LEAST-sourced centre. ~10% LIVE (reputation/reviews + channel share),
// ~15% NEEDS-INTEGRATION (nameable external APIs), ~75% NO-SOURCE — and the NO-SOURCE bulk is a
// BUSINESS-MODEL gap, not a wiring gap: the venue captures no customer identity at all, so CRM / RFM /
// LTV / retention-by-customer / email have zero data and cannot until the business decides to capture
// identity. So every panel carries a FOUR-WAY VERDICT tag naming its source; no fabricated numbers.
// The genuinely-LIVE slice is the reputation heart (real review data, honest about the two dead engines,
// one-home to /coyote/reviews). The honest anchor is CRM & Consent: 0 unified profiles, ~100% unknown
// customer revenue — the truth that the venue is entirely anonymous-transaction. Contract: { key,
// route, workspace, title, sub, getSection, render }. SELECT-only via ctx.q. Canon = S.rcc.
const S = require('../../shared.js');

function rowsOf(res) { return res && res.ok && Array.isArray(res.rows) ? res.rows : []; }
function one(q, sql, p) { const r = rowsOf(q(sql, p || [])); return r[0] || null; }
function tableExists(q, name) { return rowsOf(q(`SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ? LIMIT 1`, [name])).length > 0; }
function dateOnly(v) { if (v == null) return null; const s = String(v); const m = s.match(/\d{4}-\d{2}-\d{2}/); return m ? m[0] : (Number.isFinite(Number(v)) ? new Date(Number(v)).toISOString().slice(0, 10) : s.slice(0, 10)); }

// ---------------------------------------------------------------------------------------------
// THE FOUR VERDICT CLASSES (the Stage-1 verdict encoded). Each panel declares its class; the tag +
// state name the source and what would light it. LIVE is the only class that carries real numbers.
// ---------------------------------------------------------------------------------------------
const VERDICT = {
  degraded: {
    tag: 'wired · degraded', tone: 'warn',
    blocker: 'the source is wired but BOTH review engines are down — ingestion (Google OAuth expired) and the issue/sentiment extractor (Anthropic credit, since 03 Jul). Anything reading fresh reviews or issue tags renders stale-since-a-date, not current.',
    unlock: 'the two standing operator items: re-auth Google OAuth + top up Anthropic credit',
  },
  integration: {
    tag: 'needs integration', tone: 'info',
    blocker: 'an external source EXISTS but is not connected — a named integration, not data waiting on a switch.',
    unlock: 'wire the named external API',
  },
  nosource: {
    tag: 'no source', tone: 'bad',
    blocker: 'the data is NOT captured anywhere. This needs a BUSINESS DECISION to start capturing customer identity (a loyalty scheme / CRM / booking-with-login) — you cannot integrate a source that does not exist. Lightspeed is aggregate-only (no per-receipt customer).',
    unlock: 'decide to capture customer identity (loyalty / CRM) — a strategy call, not an engineering task',
  },
};
function vPanel(title, sub, cls, sourceNote) {
  const g = VERDICT[cls];
  const blocker = sourceNote ? `${sourceNote} ${g.blocker}` : g.blocker;
  return S.rcc.panel({ title, sub, headRight: S.rcc.tag(g.tag, g.tone), body: S.rcc.emptyState({ title, blocker, unlock: g.unlock }) });
}
function homePanel(title, sub, home, route) {
  return S.rcc.panel({ title, sub, headRight: S.rcc.tag('one-home · surface', 'info'), body: `<div class="r-empty"><b>${S.escapeHtml(title)}</b> — not recomputed here.<br>This already has a home: <b>${S.escapeHtml(home)}</b>. Customer Growth surfaces the verdict, it does not fork it (one-home rule).${route ? `<div class="r-unlock">Go to: <a href="${route}" style="color:${S.rcc.tokens.blue}">${S.escapeHtml(route)}</a></div>` : ''}</div>` });
}
function dashKpi(label, sub) { return `<div class="r-card r-kpi"><div class="r-kpi-label">${S.escapeHtml(label)}</div><div class="r-kpi-value">—</div><div class="r-kpi-sub">${S.escapeHtml(sub)}</div></div>`; }
function realKpi(label, value, sub, tone) { return `<div class="r-card r-kpi"><div class="r-kpi-label">${S.escapeHtml(label)}</div><div class="r-kpi-value"${tone ? ` style="color:${tone}"` : ''}>${S.escapeHtml(value)}</div><div class="r-kpi-sub">${S.escapeHtml(sub)}</div></div>`; }

const TABS = [
  ['executive', 'Executive'], ['market', 'Inverness Demand'], ['acquisition', 'Acquisition'],
  ['retention', 'Retention & Loyalty'], ['campaigns', 'Campaign Profitability'], ['partners', 'Partnerships'],
  ['content', 'Content & Advocacy'], ['crm', 'CRM & Consent'],
];

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Retention derivation from the OpenTable guest_profiles aggregate (Customer Growth PR-B). Everything
// here is IDENTIFIED-guest only — the render captions the live identity ceiling on every panel. Returns
// null (→ the panels keep their nosource verdict) until guest_profiles carries data.
function buildRetention(q, minVisits) {
  if (!tableExists(q, 'guest_profiles')) return null;
  const gp = one(q, `SELECT COUNT(*) guests, COALESCE(SUM(marketing_opt_in),0) opted, COALESCE(SUM(window_covers),0) idcov FROM guest_profiles`);
  if (!gp || !num(gp.guests)) return null;
  const cov = one(q, `SELECT COALESCE(SUM(total_covers),0) tot FROM covers_day`) || { tot: 0 };
  const winStart = (one(q, `SELECT MIN(business_date) d FROM covers_day`) || {}).d || '2024-05-24';
  const winEnd = (one(q, `SELECT MAX(business_date) d FROM covers_day`) || {}).d || null;
  const r = {
    guests: num(gp.guests), opted: num(gp.opted),
    idCoveragePct: num(cov.tot) ? (100 * num(gp.idcov)) / num(cov.tot) : null,
    consentPct: num(gp.guests) ? (100 * num(gp.opted)) / num(gp.guests) : null,
    minVisits, winStart, winEnd,
  };
  // visit-frequency distribution (lifetime Completed Visits)
  const fb = { '1': 0, '2-5': 0, '6-10': 0, '11+': 0 };
  for (const row of rowsOf(q(`SELECT CASE WHEN completed_visits<=1 THEN '1' WHEN completed_visits<=5 THEN '2-5' WHEN completed_visits<=10 THEN '6-10' ELSE '11+' END b, COUNT(*) n FROM guest_profiles GROUP BY b`)))
    fb[row.b] = num(row.n);
  r.freq = fb;
  r.repeatGuests = fb['2-5'] + fb['6-10'] + fb['11+'];
  r.repeatRatePct = r.guests ? (100 * r.repeatGuests) / r.guests : null;   // the HEADLINE retention metric
  r.vip = one(q, `SELECT
      SUM(completed_visits >= 11) v11, SUM(completed_visits >= 11 AND marketing_opt_in = 1) v11opt,
      SUM(completed_visits BETWEEN 6 AND 10) v6, SUM(completed_visits BETWEEN 6 AND 10 AND marketing_opt_in = 1) v6opt
    FROM guest_profiles`) || { v11: 0, v11opt: 0, v6: 0, v6opt: 0 };
  // lapsed regulars: >= minVisits lifetime visits, last visit 90+ days before the feed's latest day
  r.lapsed = winEnd ? one(q,
    `SELECT COUNT(*) n, COALESCE(SUM(marketing_opt_in),0) opted FROM guest_profiles
      WHERE completed_visits >= ? AND recent_visit_date IS NOT NULL AND recent_visit_date < date(?, '-90 day')`,
    [minVisits, winEnd]) : { n: 0, opted: 0 };
  // second-visit conversion — TRUE new guests (lifetime first visit in our window) → did they return
  // within 30/60/90d? v2 = earliest visit AFTER the first. Trended by first-visit month.
  // subquery (NOT a WITH/CTE — the MC safeSelect read-guard only admits statements starting with SELECT)
  r.cohorts = rowsOf(q(
    `SELECT strftime('%Y-%m', fv) cohort, COUNT(*) firsts,
            SUM(v2 IS NOT NULL AND julianday(v2)-julianday(fv) <= 30) r30,
            SUM(v2 IS NOT NULL AND julianday(v2)-julianday(fv) <= 60) r60,
            SUM(v2 IS NOT NULL AND julianday(v2)-julianday(fv) <= 90) r90,
            SUM(v2 IS NOT NULL) rever
       FROM (
         SELECT identity_key, MIN(first_visit_date) fv,
                MIN(CASE WHEN visit_date > first_visit_date THEN visit_date END) v2
           FROM reservations
          WHERE identity_key IS NOT NULL AND status IN ('seated','finished') AND first_visit_date IS NOT NULL
          GROUP BY identity_key
       ) g WHERE fv >= ? GROUP BY cohort ORDER BY cohort`, [winStart]));
  // repeat vs new COVERS by month (identified) — a visit is NEW if it IS the guest's first-ever visit.
  r.rvn = rowsOf(q(
    `SELECT strftime('%Y-%m', visit_date) m,
            COALESCE(SUM(CASE WHEN visit_date = first_visit_date THEN party_size END),0) new_cov,
            COALESCE(SUM(CASE WHEN visit_date > first_visit_date THEN party_size END),0) repeat_cov
       FROM reservations
      WHERE identity_key IS NOT NULL AND status IN ('seated','finished') AND first_visit_date IS NOT NULL
      GROUP BY m ORDER BY m`));
  return r;
}

// The eight architecture sources the mock's own data-architecture panel names, + how each is on this box.
const SOURCES = [
  { key: 'reviews', label: 'Reviews corpus', role: 'Reputation (Google/TripAdvisor/OpenTable)', state: 'degraded' },
  { key: 'channel', label: 'Lightspeed channel mix', role: 'Channel share (aggregate)', state: 'live' },
  { key: 'gbp', label: 'Google Business Profile', role: 'Discovery / acquisition', state: 'integration' },
  { key: 'social', label: 'Meta / TikTok', role: 'Social reach & UGC', state: 'integration' },
  { key: 'ads', label: 'Google / Meta Ads', role: 'Campaign spend & attribution', state: 'integration' },
  { key: 'opentable', label: 'OpenTable', role: 'Covers / repeat diners', state: 'integration' },
  { key: 'crm', label: 'CRM / loyalty / email', role: 'Customer identity & consent', state: 'nosource' },
  { key: 'ga', label: 'Website analytics (GA4)', role: 'Site-action funnel', state: 'integration' },
];

// ---- retention panel bodies (Customer Growth PR-B) — aggregates + segments only, never a name ----
function freqBody(ret) {
  const f = ret.freq, tot = ret.guests;
  const rows = [['1 visit (one-timers)', '1', S.rcc.tokens.muted], ['2-5 visits', '2-5', S.rcc.tokens.accent], ['6-10 visits', '6-10', S.rcc.tokens.accent2], ['11+ visits (VIPs)', '11+', S.rcc.tokens.good]]
    .map(([lab, k, c]) => S.rcc.meterRow({ label: lab, pct: tot ? Math.round((100 * f[k]) / tot) : 0, value: num(f[k]).toLocaleString(), color: c })).join('');
  return `<div class="r-meters">${rows}</div><div class="r-mini-note">lifetime Completed Visits (OpenTable rollup) across ${tot.toLocaleString()} identified guests · ${tot ? Math.round((100 * ret.repeatGuests) / tot) : 0}% are repeat (2+).</div>`;
}
function lapsedBody(ret) {
  const l = ret.lapsed, n = num(l.n), opted = num(l.opted);
  return `<div class="r-driver-grid g2">
      ${S.rcc.driver({ label: `Lapsed regulars (≥${ret.minVisits} visits)`, value: n.toLocaleString(), sub: '90+ days since last visit' })}
      ${S.rcc.driver({ label: 'Contactable (opted-in)', value: opted.toLocaleString(), sub: `${n ? Math.round((100 * opted) / n) : 0}% of lapsed — the win-back list` })}
    </div>
    <div class="cg-export"><a href="/api/lapsed-export?minVisits=${ret.minVisits}" class="cg-dl">⬇ Download the opted-in win-back list (CSV)</a><span>opted-in only · no names render on the board</span></div>`;
}
function rvnBody(ret) {
  const rows = ret.rvn.slice(-13);
  if (!rows.length) return S.rcc.emptyState({ title: 'Repeat vs new covers', blocker: 'no identified covers in the window yet.' });
  const max = Math.max(1, ...rows.map((r) => num(r.new_cov) + num(r.repeat_cov)));
  const bars = rows.map((r) => { const nw = num(r.new_cov), rp = num(r.repeat_cov);
    return `<div class="cg-rvn"><span class="m">${S.escapeHtml(r.m.slice(2))}</span><div class="t" title="${nw + rp} covers — ${rp} repeat / ${nw} new"><i style="width:${Math.round((100 * rp) / max)}%;background:${S.rcc.tokens.accent}"></i><i style="width:${Math.round((100 * nw) / max)}%;background:${S.rcc.tokens.cyan}"></i></div><span class="v">${nw + rp}</span></div>`;
  }).join('');
  return `<div class="cg-rvns">${bars}</div><div class="r-legend"><span><i style="background:${S.rcc.tokens.accent}"></i>Repeat</span><span><i style="background:${S.rcc.tokens.cyan}"></i>New</span></div>`;
}
function secondVisitBody(ret) {
  const rows = ret.cohorts.filter((c) => num(c.firsts) >= 5).slice(-8);
  if (!rows.length) return S.rcc.emptyState({ title: 'Second-visit conversion', blocker: 'not enough new-guest cohorts in the window yet.' });
  const tr = rows.map((c) => { const f = num(c.firsts); const p = (x) => (f ? `${Math.round((100 * num(x)) / f)}%` : '—');
    return `<tr><td>${S.escapeHtml(c.cohort)}</td><td class="r-num">${f}</td><td class="r-num">${p(c.r30)}</td><td class="r-num">${p(c.r60)}</td><td class="r-num">${p(c.r90)}</td></tr>`;
  }).join('');
  return `<div style="overflow:auto"><table><thead><tr><th>First-visit month</th><th class="r-num">New guests</th><th class="r-num">≤30d</th><th class="r-num">≤60d</th><th class="r-num">≤90d</th></tr></thead><tbody>${tr}</tbody></table></div>
    <div class="r-mini-note">TRUE new guests (lifetime first visit in-window) returning within N days · months with ≥5 new guests.</div>`;
}
function newGuestBody(ret) {
  const rows = ret.cohorts.slice(-13);
  if (!rows.length) return S.rcc.emptyState({ title: 'New identified guests', blocker: 'no new-guest cohorts yet.' });
  const max = Math.max(1, ...rows.map((r) => num(r.firsts)));
  const bars = rows.map((r) => `<div class="cg-rvn"><span class="m">${S.escapeHtml(r.cohort.slice(2))}</span><div class="t"><i style="width:${Math.round((100 * num(r.firsts)) / max)}%;background:${S.rcc.tokens.cyan}"></i></div><span class="v">${num(r.firsts)}</span></div>`).join('');
  return `<div class="cg-rvns">${bars}</div><div class="r-mini-note">first-ever-visit identified guests per month (acquisition of KNOWN guests only — anonymous walk-ins are unmeasurable).</div>`;
}

module.exports = {
  key: 'customer-growth',
  route: '/coyote/customer-growth',
  workspace: 'coyote',
  title: 'Customer Growth',
  sub: 'Reputation, acquisition, retention & advocacy — build-ahead scaffold (most of it is not captured yet)',

  getSection(db, ctx) {
    const q = ctx.q;
    // LIVE reputation read (the one real slice) — surfaced from the reviews corpus, home = /coyote/reviews.
    const rep = { wired: tableExists(q, 'review_corpus') };
    if (rep.wired) {
      rep.total = (one(q, `SELECT count(*) n FROM review_corpus`) || {}).n || 0;
      rep.byPlatform = rowsOf(q(`SELECT platform, count(*) n, round(avg(overall),2) avg, max(reviewed_date) latest, sum(coalesce(has_reply,0)) replied FROM review_corpus GROUP BY platform ORDER BY n DESC`));
      rep.overall = (one(q, `SELECT round(avg(overall),2) a FROM review_corpus WHERE overall IS NOT NULL`) || {}).a;
      rep.backlog = tableExists(q, 'review_drafts') ? ((one(q, `SELECT count(*) n FROM review_drafts WHERE draft_status='draft'`) || {}).n || 0) : null;
      rep.googleLatest = dateOnly((one(q, `SELECT max(reviewed_date) d FROM review_corpus WHERE platform='google'`) || {}).d);
      rep.extractorLatest = tableExists(q, 'review_issues') ? dateOnly((one(q, `SELECT max(extracted_at) d FROM review_issues`) || {}).d) : null;
    }
    // channel share (live, aggregate) — one-home to Revenue; here only a presence flag.
    const channelWired = tableExists(q, 'sales_by_channel');
    // customer identity — OpenTable now provides a resolved guest profile (partial, ceiling-capped);
    // a full CRM/loyalty source would still be a business decision on top.
    const minVisits = Math.max(2, Math.min(20, parseInt((ctx.query && ctx.query.minVisits) || '3', 10) || 3));
    const ret = buildRetention(q, minVisits);
    const identityWired = !!ret || ['customers', 'loyalty_members', 'crm_profiles', 'email_subscribers'].some((t) => tableExists(q, t));

    // source register state (per SOURCES; reviews reflects real wired-ness)
    const sources = SOURCES.map((s) => {
      if (s.key === 'reviews') return { ...s, state: rep.wired ? 'degraded' : 'integration' };
      if (s.key === 'channel') return { ...s, state: channelWired ? 'live' : 'integration' };
      if (s.key === 'opentable') return { ...s, state: ret ? 'live' : 'integration', role: ret ? 'Covers / repeat diners — LIVE (identified ' + Math.round(ret.idCoveragePct) + '% of covers)' : s.role };
      if (s.key === 'crm') return { ...s, state: identityWired ? 'degraded' : 'nosource', role: ret ? 'Guest identity via OpenTable (35% ceiling); a full CRM/loyalty is still a business call' : s.role };
      return s;
    });
    const counts = { live: 0, degraded: 0, integration: 0, nosource: 0 };
    for (const s of sources) counts[s.state] = (counts[s.state] || 0) + 1;
    return { rep, channelWired, identityWired, ret, sources, counts };
  },

  render(sec, ctx) {
    const q = (ctx.query && ctx.query.tab) || 'executive';
    const tab = TABS.some(([k]) => k === q) ? q : 'executive';
    const T = S.rcc.tokens;
    const esc = S.escapeHtml;
    const rep = sec.rep;
    const ret = sec.ret;
    // THE CEILING CAPTION (hard rule — appended to EVERY identity-derived panel via retPanel). Live-
    // computed, never hardcoded. Identity ceiling ≠ consent ceiling (consent is smaller).
    const ceilingCaption = ret
      ? `<div class="r-mini-note cg-ceiling"><b>identified guests only — ${ret.idCoveragePct.toFixed(1)}% of covers</b>; ${(100 - ret.idCoveragePct).toFixed(1)}% walk-in and anonymous · consent: ${ret.consentPct.toFixed(0)}% of identified opted-in (the contactable ceiling, smaller than identity). <b>Measures re-BOOKING</b> among identified guests — walk-in returns are invisible (${(100 - ret.idCoveragePct).toFixed(1)}% of covers), so this UNDERSTATES true repeat behaviour.</div>`
      : '';
    const retPanel = (title, sub, bodyHtml) => S.rcc.panel({ title, sub, headRight: S.rcc.tag('OpenTable identity', 'info'), body: bodyHtml + ceilingCaption });

    const styles = `<style>${S.rcc.css()}</style><style>
      .rcc .r-tabs{display:flex;gap:4px;border-bottom:1px solid var(--rline);margin:0 0 14px;overflow:auto}
      .rcc .r-tab{color:#9ba4ae;padding:11px 14px;font-weight:700;border-bottom:2px solid transparent;white-space:nowrap;text-decoration:none;font-size:13px}
      .rcc .r-tab.active{color:#fff;border-bottom-color:var(--raccent)}
      .rcc .r-grid{display:grid;gap:14px}
      .rcc .r-kpi-grid{grid-template-columns:repeat(6,minmax(0,1fr));margin-bottom:8px}
      @media(max-width:1200px){.rcc .r-kpi-grid{grid-template-columns:repeat(3,1fr)}}
      @media(max-width:820px){.rcc .r-kpi-grid{grid-template-columns:repeat(2,1fr)}}
      .rcc .r-two{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
      @media(max-width:980px){.rcc .r-two{grid-template-columns:1fr}}
      .rcc .r-mini-note{color:#8f99a4;font-size:10px;margin-top:10px}
      .cg-degrade{border-left:4px solid var(--rwarn);background:#1b1810;color:#e8cf9c;padding:11px 13px;border-radius:0 10px 10px 0;font-size:11px;line-height:1.5;margin-top:12px}
      .cg-src{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
      @media(max-width:980px){.cg-src{grid-template-columns:repeat(2,1fr)}}
      .cg-src .s{border:1px solid var(--rline);border-radius:12px;background:#12161a;padding:12px}
      .cg-src .s h4{margin:0 0 4px;font-size:11px}.cg-src .s p{margin:0;color:#8f99a4;font-size:9.5px;line-height:1.45}
      .cg-src .s .st{margin-top:9px;font-size:9px;font-weight:900;letter-spacing:.04em}
      .cg-src .s.live .st{color:#7fe0ae}.cg-src .s.degraded .st{color:#f3c76f}.cg-src .s.integration .st{color:#9fc2ff}.cg-src .s.nosource .st{color:#f0a58f}
      .cg-rep{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
      @media(max-width:820px){.cg-rep{grid-template-columns:1fr}}
      .cg-rep .p{border:1px solid var(--rline);border-radius:12px;background:#12161a;padding:12px}
      .cg-rep .p h4{margin:0;font-size:11px;text-transform:capitalize}.cg-rep .p strong{display:block;font-size:20px;margin:7px 0 2px}
      .cg-rep .p p{margin:0;color:#8f99a4;font-size:9.5px}
      .cg-anchor{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      @media(max-width:820px){.cg-anchor{grid-template-columns:1fr}}
      .cg-big{border:1px solid #5d2e30;background:#1d1213;border-radius:14px;padding:16px}
      .cg-big small{color:#f0a58f;font-size:9px;text-transform:uppercase;font-weight:900;letter-spacing:.06em}
      .cg-ceiling{border-top:1px dashed var(--rline);padding-top:8px;margin-top:12px;color:#c3ccd6}
      .cg-rvns{display:grid;gap:5px}
      .cg-rvn{display:grid;grid-template-columns:46px 1fr 46px;gap:8px;align-items:center}
      .cg-rvn .m{font-size:10px;color:#8f99a4;font-variant-numeric:tabular-nums}
      .cg-rvn .t{height:13px;background:#12161a;border-radius:6px;overflow:hidden;display:flex}
      .cg-rvn .t i{display:block;height:100%}
      .cg-rvn .v{font-size:10px;text-align:right;color:#c3ccd6;font-variant-numeric:tabular-nums}
      .cg-export{display:flex;align-items:center;gap:12px;margin-top:12px;flex-wrap:wrap}
      .cg-export .cg-dl{background:#1c2530;border:1px solid #33465e;color:#bcd4f0;padding:8px 13px;border-radius:9px;font-size:11.5px;font-weight:700;text-decoration:none}
      .cg-export .cg-dl:hover{background:#22303f}
      .cg-export span{color:#8f99a4;font-size:9.5px}
      .cg-big strong{display:block;font-size:30px;margin-top:8px;color:#f4a09f}.cg-big p{margin:6px 0 0;color:#c99;font-size:10px;line-height:1.5}
    </style>`;
    const tabsNav = `<div class="r-tabs">${TABS.map(([k, lbl]) => `<a class="r-tab${k === tab ? ' active' : ''}" href="/coyote/customer-growth?tab=${k}">${esc(lbl)}</a>`).join('')}</div>`;

    // degradation banner (used on any tab surfacing reviews)
    const degradeBanner = `<div class="cg-degrade"><b>Two review engines are down (standing operator items):</b> ingestion — Google OAuth expired (Google reviews stale since ${esc(rep.googleLatest || '—')}); issue/sentiment extractor — Anthropic credit dead (tags stale since ${esc(rep.extractorLatest || '—')}). Reputation figures below are real but frozen at those dates until both are restored.</div>`;

    // LIVE reputation panel (the heart) — surfaced from the corpus, one-home to Reviews.
    const repBody = rep.wired ? `<div class="cg-rep">${(rep.byPlatform || []).map((p) => `<div class="p"><h4>${esc(p.platform)}</h4><strong>${p.avg != null ? '★ ' + p.avg : '—'}</strong><p>${p.n} reviews · latest ${esc(dateOnly(p.latest) || '—')}${p.replied ? ` · ${p.replied} replied` : ''}</p></div>`).join('')}</div>
      <div class="r-mini-note">${rep.total} reviews across platforms · overall ★ ${rep.overall != null ? rep.overall : '—'} · ${rep.backlog != null ? rep.backlog + ' unposted reply drafts (brand-voice backlog)' : 'reply drafts n/a'}. Surfaced from the <a href="/coyote/reviews" style="color:${T.blue}">Reviews page</a> — not recomputed here.</div>${degradeBanner}`
      : S.rcc.emptyState({ title: 'Reputation', blocker: 'the reviews corpus is not present on this box.', unlock: 'run the reviews ingest' });
    const repPanel = S.rcc.panel({ title: 'Reputation & reach', sub: 'The one genuinely-live slice — surfaced from the reviews corpus', headRight: S.rcc.tag('live · degraded', 'warn'), body: repBody });

    // source register (the mock's "recommended growth data architecture", made honest)
    const regBody = `<div class="cg-src">${sec.sources.map((s) => `<div class="s ${s.state}"><h4>${esc(s.label)}</h4><p>${esc(s.role)}</p><div class="st">${{ live: '● LIVE', degraded: '◐ WIRED · DEGRADED', integration: '○ NEEDS INTEGRATION', nosource: '○ NO SOURCE' }[s.state]}</div></div>`).join('')}</div>
      <div class="r-mini-note">${sec.counts.live} live · ${sec.counts.degraded} wired-degraded · ${sec.counts.integration} needs-integration · ${sec.counts.nosource} no-source. The two cheapest unlocks — Google OAuth re-auth + Anthropic credit — revive the whole reputation slice AND the Google discovery data.</div>`;
    const regPanel = S.rcc.panel({ title: 'Growth data architecture', sub: 'Each source and its real state on this box', headRight: S.rcc.tag(`${sec.counts.live} live · ${sec.counts.nosource} no-source`, sec.counts.live ? 'warn' : 'bad'), body: regBody });

    let body;
    if (tab === 'executive') {
      const kpis = [
        realKpi('Overall rating', rep.overall != null ? '★ ' + rep.overall : '—', `${rep.total || 0} reviews · degraded`, tint(rep.overall)),
        dashKpi('New identified customers', 'no source — no customer identity captured'),
        dashKpi('Local second-visit rate', 'no source — needs identity capture'),
        realKpi('Reply backlog', rep.backlog != null ? String(rep.backlog) : '—', 'unposted brand-voice drafts'),
        dashKpi('Direct customer share', 'channel share lives in Revenue (one-home)'),
        dashKpi('Blended new-customer cost', 'needs ad-platform integration + attribution'),
      ].join('');
      body = `<div class="r-grid r-kpi-grid">${kpis}</div>
        ${repPanel}
        <div class="r-two">${homePanel('Owner attention queue', 'What needs me today', 'Rex’s brief + the Reviews & Revenue centres', '/coyote/overview')}${regPanel}</div>
        <div class="r-two">${vPanel('13-week customer-growth trend', 'New + returning identified customers', 'nosource', 'requires customer identity over time.')}${vPanel('Customer revenue mix by geography', 'Local / Highland / North America / UK / Europe', 'nosource', 'customer origin is never captured.')}</div>
        <div class="r-two">${vPanel('Two customer growth engines', 'Locals vs visitors funnels', 'nosource', 'both funnels need identified-customer journeys.')}${homePanel('Direct customer share', 'Channel dependency', 'the Revenue Centre channel mix', '/coyote/revenue')}</div>`;
    } else if (tab === 'market') {
      body = `${vPanel('Inverness demand thesis', 'Local + visitor market context', 'integration', 'external Inverness tourism / visitor data — a research feed, not a wired source.')}
        <div class="r-two">${vPanel('External demand assets', 'Overnight visitors, long-haul share, stay length', 'integration', 'external tourism statistics (VisitScotland / cruise schedules).')}${homePanel('Destination demand calendar', 'Cruise + event demand by day', 'the Revenue Centre forecast (build it there, once)', '/coyote/revenue')}</div>
        ${vPanel('Demand-to-action workflow', 'Turn known demand into bookings + labour', 'nosource', 'needs booking identity + partner attribution to close the loop.')}`;
    } else if (tab === 'acquisition') {
      if (ret) {
        const kpis = [
          realKpi('New identified guests', ret.cohorts.reduce((a, c) => a + num(c.firsts), 0).toLocaleString(), 'first-ever visits in the window (identified)'),
          realKpi('Repeat-guest share', `${ret.guests ? Math.round((100 * ret.repeatGuests) / ret.guests) : 0}%`, 'of identified guests return (2+ visits)'),
          dashKpi('Google profile interactions', 'needs Google/GA integration'),
          dashKpi('Non-brand search clicks', 'needs Google Search Console'),
          dashKpi('New-customer cost', 'needs ad-platform attribution'),
          dashKpi('Attribution coverage', 'needs identity + ad-spend'),
        ].join('');
        body = `<div class="r-grid r-kpi-grid">${kpis}</div>
          <div class="r-two">${retPanel('New identified guests over time', 'first-ever-visit identified guests, by month', newGuestBody(ret))}${retPanel('Repeat vs new covers', 'within the identified population, by month', rvnBody(ret))}</div>
          <div class="r-two">${vPanel('Digital discovery funnel', 'Discovery → menu view → action', 'integration', 'Google Business Profile Insights — the SAME Google OAuth that reviews need (one re-auth unlocks both).')}${vPanel('Acquisition channel economics', 'Cost + conversion per channel', 'nosource', 'per-channel spend attribution needs ad-platform APIs; identity is now partial (OpenTable).')}</div>`;
      } else {
        const kpis = ['Google profile interactions', 'Non-brand search clicks', 'Site-action conversion', 'New-customer conversion', 'Attribution coverage', 'Organic acquisition share'].map((l) => dashKpi(l, l.includes('conversion') || l.includes('Attribution') ? 'no source — needs identity' : 'needs Google/GA integration')).join('');
        body = `<div class="r-grid r-kpi-grid">${kpis}</div>
          <div class="r-two">${vPanel('Digital discovery funnel', 'Discovery → menu view → action', 'integration', 'Google Business Profile Insights — the SAME Google OAuth that reviews need (one re-auth unlocks both).')}${vPanel('Search opportunity', 'Non-brand search demand', 'integration', 'Google Search Console.')}</div>
          ${vPanel('Acquisition channel economics', 'Cost + conversion per channel', 'nosource', 'per-channel new-customer conversion needs identity + ad-spend attribution.')}`;
      }
    } else if (tab === 'retention') {
      if (ret) {
        const l = ret.lapsed, vip = ret.vip;
        const vip6plus = num(vip.v6) + num(vip.v11), vip6plusOpt = num(vip.v6opt) + num(vip.v11opt);
        const kpis = [
          // HEADLINE: lifetime repeat rate (booked 2+). The short-window 30/60/90 cohort view sits in the panel below, not here.
          realKpi('Repeat rate (lifetime)', ret.repeatRatePct != null ? `${ret.repeatRatePct.toFixed(1)}%` : '—', `${ret.repeatGuests.toLocaleString()} of ${ret.guests.toLocaleString()} identified have booked 2+`, T.good),
          realKpi('Identified guests', ret.guests.toLocaleString(), `${ret.idCoveragePct.toFixed(1)}% of covers`),
          realKpi('VIPs (6+ bookings)', vip6plus.toLocaleString(), `${num(vip.v11)} at 11+ · ${num(vip.v6)} at 6-10`),
          realKpi('…contactable VIPs', vip6plusOpt.toLocaleString(), 'opted-in — your best win-back'),
          realKpi(`Lapsed regulars (≥${ret.minVisits})`, num(l.n).toLocaleString(), `90+ days lapsed · ${num(l.opted)} contactable`, T.warn),
          realKpi('Opted-in', ret.opted.toLocaleString(), `${ret.consentPct.toFixed(0)}% — the consent ceiling`),
        ].join('');
        body = `<div class="r-grid r-kpi-grid">${kpis}</div>
          <div class="r-two">${retPanel('Second-visit conversion', 'short-window view — the lifetime repeat rate above is the headline', secondVisitBody(ret))}${retPanel('Visit-frequency distribution', '1 / 2-5 / 6-10 / 11+ lifetime visits', freqBody(ret))}</div>
          <div class="r-two">${retPanel('Lapsed regulars', `≥${ret.minVisits} visits, 90+ days lapsed — count + segment, never a name`, lapsedBody(ret))}${retPanel('Repeat vs new covers', 'identified population, by month', rvnBody(ret))}</div>
          <div class="r-two">${vPanel('Loyalty programme health', 'Enrolment, activity, reward economics', 'nosource', 'there is no loyalty scheme (identity is captured, a loyalty MECHANISM is not).')}${vPanel('RFM monetary segments', 'Recency / frequency / MONETARY', 'integration', 'lifetime spend is captured per guest; the monetary RFM cut is the next build on this data.')}</div>`;
      } else {
        const kpis = ['Known local customers', '60-day second visit', '90-day active rate', 'Loyalty penetration', 'At-risk local value', 'Reward cost rate'].map((l) => dashKpi(l, 'no source — no CRM / loyalty')).join('');
        body = `<div class="r-grid r-kpi-grid">${kpis}</div>
          <div class="r-two">${vPanel('Local first-visit retention cohorts', 'Return behaviour by first-visit month', 'nosource', 'cohorts need a customer identity across visits — not captured.')}${vPanel('RFM customer portfolio', 'Recency / frequency / monetary segments', 'nosource', 'RFM needs a customer database — there is none.')}</div>
          <div class="r-two">${vPanel('Loyalty programme health', 'Enrolment, activity, reward economics', 'nosource', 'there is no loyalty scheme.')}${vPanel('Lifecycle automation economics', 'Triggered win-back / nurture value', 'nosource', 'needs a contactable customer list.')}</div>`;
      }
    } else if (tab === 'campaigns') {
      const kpis = ['Growth spend', 'Attributed net revenue', 'Incremental revenue', 'Incremental contribution', 'Contribution return', 'Test budget share'].map((l) => dashKpi(l, 'needs ad-platform integration + attribution')).join('');
      body = `<div class="r-grid r-kpi-grid">${kpis}</div>
        <div class="r-two">${vPanel('Growth-investment scenario', 'Model spend → incremental contribution', 'integration', 'Google Ads + Meta Ads spend APIs.')}${vPanel('Recommended budget architecture', 'Where growth spend should sit', 'nosource', 'needs attributed returns per channel (identity-gated).')}</div>
        ${vPanel('Campaign commercial scorecard', 'Per-campaign contribution return', 'nosource', 'campaign→revenue attribution needs customer identity; today marketing is only an aggregate cost line.')}`;
    } else if (tab === 'partners') {
      const kpis = ['Active growth partners', 'Partner-referred covers', 'Partner net revenue', 'Partner contribution', 'Tracked partner share', 'Trade pipeline value'].map((l) => dashKpi(l, 'no source — no partner tracking')).join('');
      body = `<div class="r-grid r-kpi-grid">${kpis}</div>
        <div class="r-two">${vPanel('Partner performance league', 'Covers + revenue per partner', 'nosource', 'partner-referred covers need attribution + OpenTable — neither wired.')}${S.rcc.panel({ title: 'Partnership operating standard', sub: 'How partner attribution SHOULD work (a standard, not data)', headRight: S.rcc.tag('standard', 'info'), body: `${S.rcc.formula(['Give each partner a UNIQUE tracked landing / booking link.', 'Attribute covers + net revenue to that link.', 'Review partner economics monthly; renew on contribution.', '', 'Blocked today: no per-partner link, no booking identity.'])}<div class="r-mini-note">The mock’s own finding: four partners share one landing page — so partner economics are unmeasurable until each gets a unique tracked link.</div>` })}</div>`;
    } else if (tab === 'content') {
      const kpis = ['Usable content assets', 'Tracked content actions', 'UGC mentions', 'UGC rights secured', 'Review-driven discovery', 'Cost per usable asset'].map((l) => dashKpi(l, l.includes('Review-driven') ? 'wired · degraded (reviews)' : (l.includes('UGC') ? 'needs social integration' : 'no source — no asset tracking'))).join('');
      body = `<div class="r-grid r-kpi-grid">${kpis}</div>
        <div class="r-two">${vPanel('Content economics', 'Cost + commercial return per asset', 'nosource', 'no content-asset tracking system exists.')}${vPanel('Visitor advocacy loop', 'Review / UGC / share → discovery', 'integration', 'social listening via Meta / TikTok APIs; the review half is live-degraded.')}</div>
        <div class="r-two">${vPanel('UGC mentions & rights', 'Tagged posts, rights secured', 'integration', 'Meta / TikTok APIs — no social source wired (13.5k FB followers historical = no API).')}${homePanel('Review-driven discovery', 'Reviews → new visits', 'the Reputation slice above + the Reviews page', '/coyote/reviews')}</div>`;
    } else { // crm — the honest anchor
      body = `<div class="cg-anchor" style="margin-bottom:14px">
        <div class="cg-big"><small>Unified customer profiles</small><strong>0</strong><p>The venue captures no customer identity — no CRM, no loyalty, no booking login, Lightspeed aggregate-only. There is nothing to unify.</p></div>
        <div class="cg-big"><small>Unknown customer revenue</small><strong>~100%</strong><p>Essentially every pound is an anonymous transaction. Known-customer revenue ≈ £0 because no customer is identified at point of sale.</p></div>
      </div>
      ${regPanel}
      <div class="r-two">${S.rcc.panel({ title: 'What capturing identity would unlock', sub: 'The adoption decision that lights up ~75% of this centre (a plan, not data)', headRight: S.rcc.tag('adoption plan', 'info'), body: `${S.rcc.formula(['Pick an identity capture: loyalty app / CRM / booking-with-login /', 'QR order-and-pay with sign-in / opt-in receipt email.', '', 'Once ANY of these runs, these light up:', '· Retention & Loyalty (cohorts, RFM, second-visit rate)', '· Campaign + partner attribution (spend → identified revenue)', '· Email / SMS reach + consent (this tab)', '', 'Until then every panel above stays NO-SOURCE — honestly.'])}` })}${vPanel('Permitted-contact logic & consent', 'Email / SMS reachability, suppression', 'nosource', 'there is no contactable list and no consent record to govern.')}</div>`;
    }

    const stamp = `customer growth · build-ahead scaffold · ${sec.counts.live} live · ${sec.counts.degraded} degraded · ${sec.counts.nosource} no-source · reputation real (stale since ${esc(rep.googleLatest || '—')}), the rest awaits sources`;
    return { stamp, body: `<div class="rcc">${styles}${tabsNav}${body}</div>` };
  },
};

function tint(v) { const T = S.rcc.tokens; if (v == null) return null; return v >= 4.3 ? T.good : v >= 3.8 ? T.warn : T.bad; }
