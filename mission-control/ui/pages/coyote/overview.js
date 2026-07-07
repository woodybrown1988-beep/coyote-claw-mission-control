'use strict';
// Overview page — the 4-layer cockpit (ops-centre skin). Contract: { key, route, title, sub, getSection(db,ctx), render(section,ctx) }.
// getSection: SELECT-only via ctx.q. render: returns { stamp, body } using ../shared.js helpers.
// Layers: (1) ACTION BAND — what needs you, (2) RISING-ISSUES STRIP, (3) KPI TILES, (4) SYSTEM STRIP.
// READ-ONLY / navigational only: the overview links to the page that owns each safe write — it never
// renders a write control itself (no data-op, no log-form). No fabricated numbers; honest freshness.
const S = require('../../shared.js');

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function row(res) {
  return res && res.ok && res.rows && res.rows.length ? res.rows[0] : null;
}
function rows(res) {
  return res && res.ok && res.rows ? res.rows : [];
}

module.exports = {
  key: "overview", route: "/coyote/overview", workspace: "coyote", title: "Overview", sub: "The cockpit · what needs you, at a glance",

  getSection(db, ctx) {
    const q = ctx.q;
    const now = ctx.now;
    const d = new Date(now);
    const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

    // (1a) jobs awaiting YOUR sign-off / plan feedback
    const signoff = toInt((row(q(
      `SELECT COUNT(*) c FROM jobs WHERE status = 'awaiting_signoff'`)) || {}).c);
    const planfb = toInt((row(q(
      `SELECT COUNT(*) c FROM jobs WHERE status = 'awaiting_plan_feedback'`)) || {}).c);

    // (1b) review reply queue — split manual (TA/OT, copy & post on-board) vs Google (Telegram tap, off-board)
    const draftRows = rows(q(
      `SELECT platform, COUNT(*) c FROM review_drafts
        WHERE draft_status NOT IN ('responded','skipped','posted')
          AND (snoozed_until IS NULL OR snoozed_until < ?)
        GROUP BY platform`, [ctx.now]));
    let manualReplies = 0, googleReplies = 0;
    for (const r of draftRows) {
      const c = toInt(r.c);
      if (String(r.platform).toLowerCase() === 'google') googleReplies += c;
      else manualReplies += c;
    }
    const replyTotal = manualReplies + googleReplies;

    // (1c) escalations — ALLERGEN prominent
    const escRows = rows(q(
      `SELECT issue_code, status, identified_at FROM review_actions
        WHERE escalate = 1 ORDER BY identified_at DESC`));
    let allergen = 0;
    for (const r of escRows) if (/allergen/i.test(String(r.issue_code || ''))) allergen += 1;

    const needsYou = signoff + planfb + replyTotal + escRows.length;

    // (2) rising issues — latest computed set, rising only
    const rising = rows(q(
      `SELECT issue_code, count_current, count_prior FROM issue_trends
        WHERE computed_at = (SELECT MAX(computed_at) FROM issue_trends) AND rising = 1
        ORDER BY count_current DESC`));

    // (3) KPI — latest snapshot (one period). EMPTY until coyote-intel wired.
    // COVERS-TRUTH CAVEAT: kpi_snapshot.covers comes from coyote-intel, which ingests Lightspeed exports
    // where "Covers" is a POS guest-count, NOT real covers (real covers = OpenTable, not wired). The
    // Reports tab already treats covers as "not wired". When coyote-intel is wired, this tile's `covers`
    // needs the SAME treatment (do not render the POS guest-count as covers). Currently empty → safe.
    const kpi = row(q(
      `SELECT period, covers, revenue_pence, labour_pct, atv_pence, source, as_of, fetched_at
         FROM kpi_snapshot ORDER BY fetched_at DESC LIMIT 1`));

    // (4) system strip
    const lastIngest = toInt((row(q(`SELECT MAX(fetched_at) f FROM review_snapshot`)) || {}).f);
    const spent = toInt((row(q(
      `SELECT COALESCE(SUM(cost_pence),0) s FROM spend_log WHERE created_at >= ?`, [monthStart])) || {}).s);
    const ceilRow = row(q(`SELECT value FROM system_state WHERE key = 'monthly_ceiling_pence' LIMIT 1`));
    const ceiling = ceilRow ? toInt(ceilRow.value) : 0;
    const doneToday = toInt((row(q(
      `SELECT COUNT(*) c FROM jobs WHERE status = 'done' AND updated_at >= ?`, [dayStart])) || {}).c);

    return {
      now,
      needsYou,
      signoff, planfb,
      manualReplies, googleReplies, replyTotal,
      escalations: escRows.length, allergen,
      rising: rising.map((r) => ({
        code: r.issue_code,
        cur: toInt(r.count_current),
        prior: toInt(r.count_prior),
      })),
      kpi,
      lastIngest,
      spent, ceiling,
      doneToday,
      halt: ctx.halt || { halted: false, source: '' },
    };
  },

  render(section, ctx) {
    const m = section || {};
    const now = m.now || (ctx && ctx.now) || Date.now();
    const esc = S.escapeHtml;
    const parts = [];

    // ---- stamp: freshness of the latest review_snapshot ----
    const stampFresh = S.freshness(m.lastIngest || 0, now);
    let stampInner;
    if (stampFresh.cls === 'fresh') stampInner = `<b>${stampFresh.label}</b>`;
    else if (stampFresh.cls === 'stale') stampInner = `<span class="stale">${stampFresh.label}</span>`;
    else stampInner = `<span class="none">${stampFresh.label}</span>`;
    const stamp = `review ingest · ${stampInner}`;

    // ============ (1) ACTION BAND ============
    parts.push(`<div class="sec-label">What needs you<span class="rule"></span></div>`);
    if (!m.needsYou) {
      parts.push(
        `<div class="banner muted"><span class="sdot green"></span>&nbsp; All clear — nothing is waiting on your tap right now. The fleet runs itself; you'll see a red marker here the moment a job or reply needs you.</div>`);
    } else {
      const tiles = [];

      // (a) sign-off
      const signTotal = (m.signoff || 0) + (m.planfb || 0);
      const signSubBits = [];
      if (m.signoff) signSubBits.push(`${S.fmtInt(m.signoff)} build sign-off`);
      if (m.planfb) signSubBits.push(`${S.fmtInt(m.planfb)} plan feedback`);
      tiles.push(
        `<div class="tile ${signTotal ? 'red' : 'muted'}">
           <div class="lab">Awaiting your sign-off</div>
           <div class="val">${S.fmtInt(signTotal)}</div>
           <div class="sub${signTotal ? ' r' : ''}">${signTotal ? esc(signSubBits.join(' · ')) : 'no jobs held at a gate'}</div>
           <div><a class="tag" href="/claw/agents">Open Agents →</a></div>
         </div>`);

      // (b) review reply queue
      const replySub = m.replyTotal
        ? `${S.fmtInt(m.manualReplies)} to copy &amp; post · ${S.fmtInt(m.googleReplies)} Google (tap)`
        : 'reply queue clear';
      tiles.push(
        `<div class="tile ${m.replyTotal ? '' : 'muted'}">
           <div class="lab">Review replies</div>
           <div class="val">${S.fmtInt(m.replyTotal || 0)}</div>
           <div class="sub">${replySub}</div>
           <div><a class="tag" href="/coyote/reviews">Go to queue →</a></div>
         </div>`);

      // (c) escalations — ALLERGEN prominent
      const escSub = m.allergen
        ? `<span class="sub r">⚠ ALLERGEN · ${S.fmtInt(m.allergen)}</span>`
        : (m.escalations ? `${S.fmtInt(m.escalations)} open` : 'none escalated');
      tiles.push(
        `<div class="tile ${m.escalations ? 'amber' : 'muted'}">
           <div class="lab">Escalations</div>
           <div class="val">${S.fmtInt(m.escalations || 0)}</div>
           <div class="sub${m.allergen ? '' : (m.escalations ? ' a' : '')}">${escSub}</div>
           <div><a class="tag" href="/coyote/issues">Open Issues →</a></div>
         </div>`);

      parts.push(`<div class="tiles">${tiles.join('')}</div>`);
    }

    // ============ (2) RISING-ISSUES STRIP ============
    parts.push(`<div class="sec-label">Rising issues<span class="rule"></span></div>`);
    if (m.rising && m.rising.length) {
      const chips = m.rising.map((r) => {
        const sharp = (r.prior === 0) || ((r.cur - r.prior) >= r.prior);
        const tone = sharp ? 'amber' : 'cyan';
        return `<a class="chip ${tone}" href="/coyote/issues">${esc(r.code)} ↑${S.fmtInt(r.cur)} <span class="muted">(was ${S.fmtInt(r.prior)})</span></a>`;
      }).join('');
      parts.push(`<div class="tiles" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">${chips}</div>`);
    } else {
      parts.push(`<div class="banner muted">No rising issues in the latest trend window.</div>`);
    }

    // ============ (3) KPI TILES ============
    parts.push(`<div class="sec-label">Today's numbers<span class="rule"></span></div>`);
    const k = m.kpi;
    if (k) {
      const f = S.freshness(toInt(k.fetched_at), now);
      const fsub = f.cls === 'fresh' ? f.label : `<span class="${f.cls === 'stale' ? 'a' : ''}">${f.label}</span>`;
      const labour = (k.labour_pct === null || k.labour_pct === undefined || !Number.isFinite(Number(k.labour_pct)))
        ? '—' : `${Number(k.labour_pct)}%`;
      const labourHot = Number.isFinite(Number(k.labour_pct)) && Number(k.labour_pct) > 35;
      const ktiles = [
        `<div class="tile blue"><div class="lab">Covers${k.period ? ' · ' + esc(String(k.period)) : ''}</div><div class="val">${S.fmtInt(k.covers)}</div><div class="sub">${fsub}</div></div>`,
        `<div class="tile green"><div class="lab">Revenue</div><div class="val">${S.fmtGbpPence(k.revenue_pence)}</div><div class="sub">${fsub}</div></div>`,
        `<div class="tile ${labourHot ? 'amber' : ''}"><div class="lab">Labour</div><div class="val">${labour}</div><div class="sub${labourHot ? ' a' : ''}">${labourHot ? 'above target' : fsub}</div></div>`,
        `<div class="tile"><div class="lab">ATV</div><div class="val">${S.fmtGbpPence(k.atv_pence)}</div><div class="sub">${fsub}</div></div>`,
      ];
      parts.push(`<div class="tiles">${ktiles.join('')}</div>`);
    } else {
      parts.push(
        `<div class="tiles"><div class="tile muted"><div class="lab">KPIs</div><div class="val">—</div><div class="sub">KPI feed not yet wired</div></div></div>`);
      parts.push(
        `<div class="banner muted">Covers, revenue, labour % and ATV appear here once <span class="mono">coyote-intel</span> is connected. No numbers are shown until the feed is live.</div>`);
    }

    // ============ (4) SYSTEM STRIP ============
    parts.push(`<div class="sec-label">System<span class="rule"></span></div>`);
    const stiles = [];

    // ingest freshness
    const ing = S.freshness(m.lastIngest || 0, now);
    const ingTone = ing.cls === 'fresh' ? 'green' : (ing.cls === 'stale' ? 'amber' : 'muted');
    const ingVal = ing.cls === 'fresh' ? 'LIVE' : (ing.cls === 'stale' ? 'STALE' : '—');
    stiles.push(
      `<div class="tile ${ingTone}"><div class="lab">Review ingest</div><div class="val">${ingVal}</div><div class="sub${ing.cls === 'stale' ? ' a' : ''}">${ing.label}</div></div>`);

    // spend this month vs ceiling
    const spent = m.spent || 0;
    const ceiling = m.ceiling || 0;
    let spendTone = 'green', spendCls = ' g';
    if (ceiling > 0 && spent >= ceiling) { spendTone = 'red'; spendCls = ' r'; }
    else if (ceiling > 0 && spent >= ceiling * 0.8) { spendTone = 'amber'; spendCls = ' a'; }
    const ceilSub = ceiling > 0 ? `of ${S.fmtGbpPence(ceiling)} ceiling` : 'no ceiling set';
    stiles.push(
      `<div class="tile ${spendTone}"><div class="lab">Spend this month</div><div class="val">${S.fmtGbpPence(spent)}</div><div class="sub${ceiling > 0 ? spendCls : ''}">${ceilSub}</div></div>`);

    // jobs done today
    stiles.push(
      `<div class="tile blue"><div class="lab">Jobs done today</div><div class="val">${S.fmtInt(m.doneToday || 0)}</div><div class="sub">since 00:00 UTC</div></div>`);

    // halt state
    const halted = !!(m.halt && m.halt.halted);
    const haltSrc = m.halt && m.halt.source ? esc(String(m.halt.source)) : '';
    stiles.push(
      `<div class="tile ${halted ? 'red' : 'green'}"><div class="lab">System state</div><div class="val">${halted ? 'HALTED' : 'LIVE'}</div><div class="sub${halted ? ' r' : ' g'}">${halted ? ('halt · ' + (haltSrc || 'operator')) : 'claims + poller running'}</div></div>`);

    parts.push(`<div class="tiles">${stiles.join('')}</div>`);

    return { stamp, body: parts.join('\n') };
  },
};
