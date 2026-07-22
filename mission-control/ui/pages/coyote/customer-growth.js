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
    // customer identity — the anonymous-transaction truth.
    const identityWired = ['customers', 'loyalty_members', 'crm_profiles', 'email_subscribers'].some((t) => tableExists(q, t));

    // source register state (per SOURCES; reviews reflects real wired-ness)
    const sources = SOURCES.map((s) => {
      if (s.key === 'reviews') return { ...s, state: rep.wired ? 'degraded' : 'integration' };
      if (s.key === 'channel') return { ...s, state: channelWired ? 'live' : 'integration' };
      if (s.key === 'crm') return { ...s, state: identityWired ? 'live' : 'nosource' };
      return s;
    });
    const counts = { live: 0, degraded: 0, integration: 0, nosource: 0 };
    for (const s of sources) counts[s.state] = (counts[s.state] || 0) + 1;
    return { rep, channelWired, identityWired, sources, counts };
  },

  render(sec, ctx) {
    const q = (ctx.query && ctx.query.tab) || 'executive';
    const tab = TABS.some(([k]) => k === q) ? q : 'executive';
    const T = S.rcc.tokens;
    const esc = S.escapeHtml;
    const rep = sec.rep;

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
      const kpis = ['Google profile interactions', 'Non-brand search clicks', 'Site-action conversion', 'New-customer conversion', 'Attribution coverage', 'Organic acquisition share'].map((l) => dashKpi(l, l.includes('conversion') || l.includes('Attribution') ? 'no source — needs identity' : 'needs Google/GA integration')).join('');
      body = `<div class="r-grid r-kpi-grid">${kpis}</div>
        <div class="r-two">${vPanel('Digital discovery funnel', 'Discovery → menu view → action', 'integration', 'Google Business Profile Insights — the SAME Google OAuth that reviews need (one re-auth unlocks both).')}${vPanel('Search opportunity', 'Non-brand search demand', 'integration', 'Google Search Console.')}</div>
        ${vPanel('Acquisition channel economics', 'Cost + conversion per channel', 'nosource', 'per-channel new-customer conversion needs identity + ad-spend attribution.')}`;
    } else if (tab === 'retention') {
      const kpis = ['Known local customers', '60-day second visit', '90-day active rate', 'Loyalty penetration', 'At-risk local value', 'Reward cost rate'].map((l) => dashKpi(l, 'no source — no CRM / loyalty')).join('');
      body = `<div class="r-grid r-kpi-grid">${kpis}</div>
        <div class="r-two">${vPanel('Local first-visit retention cohorts', 'Return behaviour by first-visit month', 'nosource', 'cohorts need a customer identity across visits — not captured.')}${vPanel('RFM customer portfolio', 'Recency / frequency / monetary segments', 'nosource', 'RFM needs a customer database — there is none.')}</div>
        <div class="r-two">${vPanel('Loyalty programme health', 'Enrolment, activity, reward economics', 'nosource', 'there is no loyalty scheme.')}${vPanel('Lifecycle automation economics', 'Triggered win-back / nurture value', 'nosource', 'needs a contactable customer list.')}</div>`;
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
